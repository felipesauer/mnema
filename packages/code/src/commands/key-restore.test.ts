/**
 * `mnema key restore` as an adapter: it resolves the project, resolves the path,
 * and forwards. The judgements it must NOT make of its own are the interesting
 * part — a refusal reaches the person in the core's own words, and no project
 * means no restore, because the proof of membership lives in a project's record.
 *
 * The recovery itself (the anchor is the one from before the loss) is pinned in
 * the core's suite and end to end through the real CLI; here the concern is the
 * seam.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '@mnema/chain';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runKeyRestore } from './key-restore.js';
import { runVerify } from './verify.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-key-restore-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv; keyRoot: string } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  const env = { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
  return { repo, env, keyRoot: join(sandbox, 'data', 'mnema', 'identity') };
}

/**
 * Inits a project, takes the vault copy of the cold backup key, and deletes the
 * machine's own private key — the state a person is in when they reach for this
 * command: the disk is alive, the key is not.
 */
function initThenLoseTheKey(
  repo: string,
  env: DiscoveryEnv,
  keyRoot: string,
): { anchorBefore: string; backupFp: string; vaultCopy: string } {
  const init = runInit({ cwd: repo, env });
  const backupFp = init.identity?.backup?.fingerprint as string;

  // The person moved the cold private half off the machine, as init told them to.
  const vaultCopy = join(sandbox, 'vault.key');
  writeFileSync(vaultCopy, readFileSync(init.identity?.backup?.privateKeyPath as string, 'utf-8'));
  rmSync(join(keyRoot, 'backup'), { recursive: true, force: true });

  // Only the PRIVATE half of the machine's own key goes: the public material and
  // the committed tree survive, as they would a key lost on a live disk.
  const primaryFp = readdirSync(join(keyRoot, 'keys'))
    .filter((name) => name.endsWith('.key'))
    .map((name) => name.slice(0, -'.key'.length))
    .find((fp) => fp !== backupFp) as string;
  unlinkSync(join(keyRoot, 'keys', `${primaryFp}.key`));

  return { anchorBefore: init.anchor, backupFp, vaultCopy };
}

describe('mnema key restore', () => {
  it('restores the identity of the project, and the project still verifies', () => {
    const { repo, env, keyRoot } = setup();
    const lost = initThenLoseTheKey(repo, env, keyRoot);

    const done = runKeyRestore({ cwd: repo, env }, { privateKeyPath: lost.vaultCopy });

    expect(done).toMatchObject({
      ok: true,
      fingerprint: lost.backupFp,
      anchor: lost.anchorBefore,
      membership: 'enrolled',
    });
    const verified = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
    expect(verified.ok && verified.record.ok).toBe(true);
  });

  it('resolves a RELATIVE path against the injected cwd, not the process one', () => {
    const { repo, env, keyRoot } = setup();
    const lost = initThenLoseTheKey(repo, env, keyRoot);
    // The person types a path relative to where they are standing.
    const inside = join(repo, 'vault-copy.key');
    writeFileSync(inside, readFileSync(lost.vaultCopy, 'utf-8'));

    const done = runKeyRestore({ cwd: repo, env }, { privateKeyPath: 'vault-copy.key' });

    expect(done).toMatchObject({ ok: true, anchor: lost.anchorBefore });
    expect(readFileSync(inside, 'utf-8')).toBe(readFileSync(lost.vaultCopy, 'utf-8'));
  });

  it('refuses NO_PROJECT outside a project — the proof of membership lives in one', () => {
    const { env } = setup();
    const bare = join(sandbox, 'not-a-project');
    mkdirSync(bare, { recursive: true });
    const someKey = join(sandbox, 'some.key');
    writeFileSync(someKey, generateKeyPair().privateKey.export({ type: 'pkcs8', format: 'pem' }));

    expect(runKeyRestore({ cwd: bare, env }, { privateKeyPath: someKey })).toEqual({
      ok: false,
      reason: 'NO_PROJECT',
    });
  });

  it("forwards the core's refusal verbatim — the surface judges nothing itself", () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const stranger = join(sandbox, 'stranger.key');
    writeFileSync(stranger, generateKeyPair().privateKey.export({ type: 'pkcs8', format: 'pem' }));

    // The machine still holds its key, so the core refuses KEY_PRESENT — and the
    // adapter reports that code and message, inventing neither.
    const refused = runKeyRestore({ cwd: repo, env }, { privateKeyPath: stranger });

    expect(refused).toMatchObject({ ok: false, reason: 'REFUSED', code: 'KEY_PRESENT' });
    expect((refused as { message: string }).message).toContain('two');
  });

  it('reports UNREADABLE_KEY for a file that is not a key', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const junk = join(sandbox, 'notes.txt');
    writeFileSync(junk, 'my key is in the drawer\n');

    expect(runKeyRestore({ cwd: repo, env }, { privateKeyPath: junk })).toMatchObject({
      ok: false,
      reason: 'REFUSED',
      code: 'UNREADABLE_KEY',
    });
  });
});
