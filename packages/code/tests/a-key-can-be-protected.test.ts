/**
 * A passphrase can be put on the private key at rest — and the record cannot tell.
 *
 * WHAT WAS DECIDED: the key was never encrypted and never documented as not being (the
 * README's security page said nothing of where it lives). The person who owns the product asked
 * for the baseline written down and for an OPTIONAL passphrase, now, on one condition: it must
 * not change the signed format or what `verify` reads. This file holds the condition from the
 * outside, on the built binary and over the server:
 *   - a machine that never protects anything behaves as before (the ordinary suite is the proof,
 *     and the first case here repeats the one thing that would differ: the file stays a PEM);
 *   - a protected key is not a PEM, signs the same events, and the record that was written with it
 *     verifies with no passphrase and no key at all, because `verify` never opens a private key;
 *   - with no passphrase, or the wrong one, a write is refused by code, nothing is written, and
 *     the machine does NOT mint a second identity on the way (the failure that would make a
 *     passphrase more dangerous than none);
 *   - the agent's server refuses the same way, saying the fact was not recorded;
 *   - `unprotect` puts the file back, and a wrong passphrase changes none of them.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const VARIABLE = 'MNEMA_KEY_PASSPHRASE';

let sandbox: string;
let home: string;
let project: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-key-protected-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(home);
  mkdirSync(project);
  spawnSync('git', ['init', '-q', '-b', 'main', project], {
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
  });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(passphrase: string | undefined, ...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: project,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      ...(passphrase === undefined ? {} : { [VARIABLE]: passphrase }),
    },
  });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

function keyFiles(): string[] {
  const dirs = [
    join(home, '.mnema', 'identity', 'keys'),
    join(home, '.mnema', 'identity', 'backup'),
  ];
  return dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.key'))
      .map((name) => join(dir, name)),
  );
}

const IS_A_PEM = '-----BEGIN PRIVATE KEY-----';
const IS_PROTECTED = '-----BEGIN MNEMA PROTECTED KEY-----';

function aProjectWithAProtectedKey(): void {
  expect(mnema(undefined, 'init').status).toBe(0);
  expect(mnema(undefined, 'memory', 'written before the key was protected').status).toBe(0);
  const protectedNow = mnema('correct horse', 'key', 'protect');
  expect(protectedNow.status, protectedNow.out).toBe(0);
}

describe('a key nobody protected', () => {
  it('stays the PEM it was, readable by its owner alone', () => {
    expect(mnema(undefined, 'init').status).toBe(0);
    for (const file of keyFiles()) {
      expect(readFileSync(file, 'utf-8').startsWith(IS_A_PEM)).toBe(true);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});

describe('protecting the key', () => {
  it('needs the passphrase to be somewhere it can be read, and says where', () => {
    expect(mnema(undefined, 'init').status).toBe(0);
    const refused = mnema(undefined, 'key', 'protect');
    expect(refused.status).toBe(1);
    expect(refused.out).toContain('NO_PASSPHRASE');
    expect(refused.out).toContain(VARIABLE);
    for (const file of keyFiles())
      expect(readFileSync(file, 'utf-8').startsWith(IS_A_PEM)).toBe(true);
  });

  it('encrypts the key and its cold backup, and leaves the mode and the public halves alone', () => {
    expect(mnema(undefined, 'init').status).toBe(0);
    const publics = readdirSync(join(home, '.mnema', 'identity', 'keys')).filter((name) =>
      name.endsWith('.pub'),
    );
    const done = mnema('correct horse', 'key', 'protect');
    expect(done.status, done.out).toBe(0);
    expect(done.out).toContain('Protected 2 of 2 private key file(s)');
    for (const file of keyFiles()) {
      const text = readFileSync(file, 'utf-8');
      expect(text.startsWith(IS_PROTECTED)).toBe(true);
      expect(text).not.toContain('PRIVATE KEY');
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(
      readdirSync(join(home, '.mnema', 'identity', 'keys')).filter((name) => name.endsWith('.pub')),
    ).toEqual(publics);
    // Again: nothing to do, and it says so rather than protecting a protected file twice.
    expect(mnema('correct horse', 'key', 'protect').out).toContain('Protected 0 of 2');
  });
});

describe('signing with a protected key', () => {
  it('writes with the passphrase, and the record verifies with neither the passphrase nor the key', () => {
    aProjectWithAProtectedKey();
    const wrote = mnema('correct horse', 'memory', 'written with a protected key');
    expect(wrote.status, wrote.out).toBe(0);
    // `verify` reads no private key: no variable, and the exit is the one it always had.
    const verified = mnema(undefined, 'verify', '--require', 'signed');
    expect(verified.status, verified.out).toBe(0);
    expect(verified.out).toContain('all events are signature-covered');
    // Nor is it a second identity: the same one signed before and after.
    const who = mnema(undefined, 'accountability').out.match(/mnid:[0-9a-f]{8}/g) ?? [];
    expect(new Set(who).size).toBe(1);
  });

  it('refuses a write with no passphrase, by code, and mints no second key', () => {
    aProjectWithAProtectedKey();
    const before = keyFiles();
    const refused = mnema(undefined, 'memory', 'no passphrase here');
    expect(refused.status).toBe(1);
    expect(refused.out).toContain('is protected by a passphrase');
    expect(refused.out).toContain(VARIABLE);
    expect(keyFiles()).toEqual(before);
    expect(mnema(undefined, 'search').out).not.toContain('no passphrase here');
  });

  it('refuses a write with the wrong passphrase, and writes nothing', () => {
    aProjectWithAProtectedKey();
    const refused = mnema('wrong horse', 'memory', 'wrong passphrase');
    expect(refused.status).toBe(1);
    expect(refused.out).toContain('does not open the private key');
    expect(refused.out).toContain('Nothing was written.');
    expect(mnema(undefined, 'search').out).not.toContain('wrong passphrase');
  });

  it('is refused by the agent’s server as a refusal that says the fact was not recorded', async () => {
    aProjectWithAProtectedKey();
    const call = async (passphrase: string | undefined) => {
      const before = process.env[VARIABLE];
      if (passphrase === undefined) delete process.env[VARIABLE];
      else process.env[VARIABLE] = passphrase;
      try {
        const { server } = buildMcpServer({ cwd: sandbox, env: { home }, log: () => {} });
        const client = new Client(
          { name: 'claude-code', version: '1.0.0' },
          { capabilities: { roots: {} } },
        );
        client.setRequestHandler(ListRootsRequestSchema, () => ({
          roots: [{ uri: pathToFileURL(project).href }],
        }));
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
        const reply = (await client.callTool({
          name: 'capture_memory',
          arguments: { content: 'from the agent', scope: 'public' },
        })) as { isError?: boolean; content: { text: string }[] };
        await client.close();
        return reply;
      } finally {
        if (before === undefined) delete process.env[VARIABLE];
        else process.env[VARIABLE] = before;
      }
    };
    const without = await call(undefined);
    const text = without.content.map((block) => block.text).join('\n');
    expect(without.isError, text).toBe(true);
    expect(text.startsWith('Refused (KEY_IS_PROTECTED): '), text).toBe(true);
    expect(text).toContain('The fact was NOT recorded.');
    const wrong = await call('wrong horse');
    expect(wrong.content[0]?.text.startsWith('Refused (KEY_PASSPHRASE_WRONG): ')).toBe(true);
    const right = await call('correct horse');
    expect(right.isError, right.content.map((block) => block.text).join('\n')).not.toBe(true);
  }, 60_000);
});

describe('taking the passphrase off', () => {
  it('puts every file back in the clear — or none of them, on a wrong passphrase', () => {
    aProjectWithAProtectedKey();
    const kept = keyFiles().map((file) => readFileSync(file, 'utf-8'));
    const refused = mnema('wrong horse', 'key', 'unprotect');
    expect(refused.status).toBe(1);
    expect(refused.out).toContain('KEY_PASSPHRASE_WRONG');
    expect(keyFiles().map((file) => readFileSync(file, 'utf-8'))).toEqual(kept);

    const done = mnema('correct horse', 'key', 'unprotect');
    expect(done.status, done.out).toBe(0);
    for (const file of keyFiles())
      expect(readFileSync(file, 'utf-8').startsWith(IS_A_PEM)).toBe(true);
    // And it signs again with no variable, as a machine that never protected anything does.
    expect(mnema(undefined, 'memory', 'back in the clear').status).toBe(0);
  });

  it('says nothing changed on a machine that was never protected', () => {
    expect(mnema(undefined, 'init').status).toBe(0);
    const done = mnema(undefined, 'key', 'unprotect');
    expect(done.status, done.out).toBe(0);
    expect(done.out).toContain('Unprotected 0 of 2');
  });
});
