/**
 * `restoreAgentKey` puts the key of an agent into the agent's own folder on the machine it will
 * sign from — a CI runner that has no home to keep it in — and nowhere else.
 *
 * The folder is the one the agent's host reads (`agentKeyRoot`), so the key lands there and the
 * person's key root, the tree's anchors and the record stay exactly as they were: the restore
 * appends nothing and records no anchor, because the agent's key is read from the record it is
 * enrolled in. It is refused, before anything is written, for every key the record does not enrol
 * as that agent under that name.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  catalogUpcasters,
  generateKeyPair,
  openChainForWriting,
  persistKeyPair,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../workflow/clock.js';
import { ensureFounded } from '../workflow/identity-operations.js';
import { requestAgentEnrollment } from './handshake.js';
import { restoreAgentKey, restoreKey } from './restore.js';
import { enrollAgentFromRequest, retireAgentKey } from './roster.js';

const upcasters = catalogUpcasters();

let scratch: string[] = [];
let tree: string;
let personsRoot: string;
let ctx: Parameters<typeof ensureFounded>[0];
let anchor: string;
/** The key the record enrols as the agent "ci", kept in a folder of its own that the test treats as the person's copy. */
let copy: { path: string; fingerprint: string };

beforeEach(() => {
  scratch = [];
  tree = tmp('mnema-restore-agent-tree-');
  personsRoot = tmp('mnema-restore-agent-person-');
  const writer = openChainForWriting(tree, { keyRoot: personsRoot });
  const layout: ChainLayout = { root: tree };
  ctx = { writer, layout, upcasters, clock };
  anchor = ensureFounded(ctx);
  copy = enrolled('ci');
  writer.checkpoint();
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-10-13T01:00:${String(tick % 60).padStart(2, '0')}.000Z`;
};

/** An agent key made where nothing else is, enrolled under `name`; its private half is the file. */
function enrolled(name: string): { path: string; fingerprint: string } {
  const root = tmp('mnema-restore-agent-made-');
  const made = requestAgentEnrollment({ anchor, name, keyRoot: root });
  if (!made.ok) throw new Error(made.code);
  const result = enrollAgentFromRequest(ctx, { request: made.request });
  if (!result.ok) throw new Error(result.code);
  return { path: join(root, 'keys', `${made.fingerprint}.key`), fingerprint: made.fingerprint };
}

/** Every file under `dir` with its bytes, so "nothing was written" is a comparison and not a hope. */
function digestOf(dir: string): string {
  const hash = createHash('sha256');
  const walk = (at: string): void => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at).sort()) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) {
        hash.update(`d:${path}\n`);
        walk(path);
      } else {
        hash.update(`f:${path}\n`).update(readFileSync(path));
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function restore(over: Partial<Parameters<typeof restoreAgentKey>[0]> = {}) {
  return restoreAgentKey({
    privateKeyPath: copy.path,
    name: 'ci',
    agentKeyRoot: join(runner, 'agents', 'ci'),
    tree,
    upcasters,
    ...over,
  });
}

let runner: string;
beforeEach(() => {
  runner = tmp('mnema-restore-agent-runner-');
});

describe('restoring the key of an agent', () => {
  it('installs it in the agent folder, in the clear, and records and signs nothing', () => {
    const before = digestOf(tree);

    const result = restore();

    const folder = join(runner, 'agents', 'ci');
    expect(result).toEqual({
      ok: true,
      fingerprint: copy.fingerprint,
      anchor,
      name: 'ci',
      installedAt: join(folder, 'keys', `${copy.fingerprint}.key`),
    });
    expect(statSync(join(folder, 'keys', `${copy.fingerprint}.key`)).mode & 0o777).toBe(0o600);
    expect(existsSync(join(folder, 'keys', `${copy.fingerprint}.pub`))).toBe(true);
    expect(readdirSync(join(folder, 'keys')).sort()).toEqual([
      `${copy.fingerprint}.key`,
      `${copy.fingerprint}.pub`,
    ]);
    expect(existsSync(join(runner, 'identity'))).toBe(false);
    expect(digestOf(tree)).toBe(before);
    // The file it read is where it was.
    expect(existsSync(copy.path)).toBe(true);
  });

  it('does it again without a second key in the folder', () => {
    expect(restore().ok).toBe(true);
    expect(restore().ok).toBe(true);

    expect(
      readdirSync(join(runner, 'agents', 'ci', 'keys')).filter((f) => f.endsWith('.key')),
    ).toEqual([`${copy.fingerprint}.key`]);
  });

  describe('is refused, and nothing is written, for', () => {
    function refused(over: Partial<Parameters<typeof restoreAgentKey>[0]> = {}) {
      const before = { tree: digestOf(tree), runner: digestOf(runner) };
      const result = restore(over);
      expect(digestOf(tree)).toBe(before.tree);
      expect(digestOf(runner)).toBe(before.runner);
      if (result.ok) throw new Error('expected a refusal');
      return result;
    }

    it('a name that is no agent name', () => {
      const result = refused({ name: '../x', agentKeyRoot: join(runner, 'x') });
      expect(result.code).toBe('BAD_AGENT_NAME');
    });

    it('a file that is no private key', () => {
      const path = join(tmp('mnema-restore-agent-junk-'), 'junk.pem');
      writeFileSync(path, 'not a key');
      const result = refused({ privateKeyPath: path });
      expect(result.code).toBe('UNREADABLE_KEY');
      expect(result.message).toBe(`${path} could not be read as a private key`);
    });

    it.each([
      ['a P-256 key', 'ec' as const, { namedCurve: 'prime256v1' }, 'an EC key'],
      ['an RSA key', 'rsa' as const, { modulusLength: 2048 }, 'an RSA key'],
    ])('%s', async (_what, type, options, said) => {
      const { generateKeyPairSync } = await import('node:crypto');
      const made =
        type === 'ec'
          ? generateKeyPairSync('ec', options as { namedCurve: string })
          : generateKeyPairSync('rsa', options as { modulusLength: number });
      const path = join(tmp('mnema-restore-agent-other-'), 'other.pem');
      writeFileSync(path, made.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
      const result = refused({ privateKeyPath: path });
      expect(result.code).toBe('UNREADABLE_KEY');
      expect(result.message).toContain(`is ${said}, and an agent's key is an Ed25519 one`);
    });

    it('a key that is protected by a passphrase', () => {
      const keys = tmp('mnema-restore-agent-protected-');
      const path = persistKeyPair({ root: keys }, generateKeyPair(), {
        passphrase: 'a passphrase',
      });
      const result = refused({ privateKeyPath: path });
      expect(result.code).toBe('PROTECTED_AGENT_KEY');
      expect(result.message).toContain(`${path} is protected by a passphrase`);
    });

    it('a key the record never enrolled', () => {
      const path = persistKeyPair(
        { root: tmp('mnema-restore-agent-stranger-') },
        generateKeyPair(),
      );
      const result = refused({ privateKeyPath: path });
      expect(result.code).toBe('NOT_A_MEMBER');
    });

    it('a key of a person of the identity', () => {
      const [personal] = readdirSync(join(personsRoot, 'keys')).filter((f) => f.endsWith('.key'));
      const result = refused({ privateKeyPath: join(personsRoot, 'keys', personal as string) });
      expect(result.code).toBe('NOT_AN_AGENT_KEY');
      expect(result.message).toContain('mnema key restore <file>');
    });

    it('a name other than the one the record enrolled the key under', () => {
      const result = refused({ name: 'codex', agentKeyRoot: join(runner, 'agents', 'codex') });
      expect(result.code).toBe('AGENT_UNDER_ANOTHER_NAME');
      expect(result.message).toBe(
        `the record enrols the key ${copy.fingerprint} as the agent "ci" of ${anchor}, not as "codex" — ` +
          'a key keeps the name it was enrolled under, so restore it with --agent ci',
      );
    });

    it('a key the record retired', () => {
      const retired = retireAgentKey(ctx, { fingerprint: copy.fingerprint, reason: 'leaked' });
      expect(retired.ok).toBe(true);
      const result = refused();
      expect(result.code).toBe('REVOKED_KEY');
    });

    it('a folder that already holds another live key', () => {
      const folder = join(runner, 'agents', 'ci');
      mkdirSync(folder, { recursive: true });
      const other = generateKeyPair();
      persistKeyPair({ root: folder }, other);
      const result = refused();
      expect(result.code).toBe('KEY_PRESENT');
      expect(result.message).toContain(other.fingerprint);
    });
  });
});

describe('restoring the key of an agent as a person’s', () => {
  it('names the verb that does it, with the name the record gave the key', () => {
    const fresh = tmp('mnema-restore-agent-fresh-');
    const result = restoreKey({ privateKeyPath: copy.path, keyRoot: fresh, tree, upcasters });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AN_AGENT_KEY');
    expect(result.message).toContain('`mnema key restore --agent ci <file>`');
    expect(existsSync(join(fresh, 'keys'))).toBe(false);
  });
});
