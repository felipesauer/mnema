/**
 * `key revoke` and `key revoke --checker` with the key of the person protected and no passphrase
 * to hand: `KEY_IS_PROTECTED`, in words for a person at a terminal, with no advice for a host that
 * signs for an agent (a key of its own) — a retirement is signed by THEIR key, and the agent's
 * key has nothing to do with it. Each way of retiring is proved on its own.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let home: string;
let repo: string;
let originalCwd: string;
const saved: Record<string, string | undefined> = {};

async function mnema(...argv: string[]): Promise<{ text: string; failed: boolean }> {
  const out: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { text: out.join('\n'), failed };
}

async function did(...argv: string[]): Promise<string> {
  const said = await mnema(...argv);
  expect(said.failed, `${argv.join(' ')}: ${said.text}`).toBe(false);
  return said.text;
}

/** The sentence a person is given: where their key is, and what to do about it. */
function protectedFor(file: string): string {
  return `Refused (KEY_IS_PROTECTED): the private key at ${file} is protected by a passphrase and MNEMA_KEY_PASSPHRASE is not set, and a retirement is signed with it: run the command in a terminal, which asks for the passphrase, or set MNEMA_KEY_PASSPHRASE for it`;
}

function mineFile(): string {
  const keys = join(home, '.mnema', 'identity', 'keys');
  return join(keys, readdirSync(keys).find((name) => name.endsWith('.key')) as string);
}

async function protectMine(): Promise<void> {
  process.env.MNEMA_KEY_PASSPHRASE = 'correct horse';
  await did('key', 'protect');
  delete process.env.MNEMA_KEY_PASSPHRASE;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-revoke-protected-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  for (const name of ['XDG_DATA_HOME', 'HOME', 'MNEMA_HOME', 'MNEMA_RUN', 'MNEMA_KEY_PASSPHRASE']) {
    saved[name] = process.env[name];
  }
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  delete process.env.MNEMA_KEY_PASSPHRASE;
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a retirement with the key of the person protected', () => {
  it('key revoke <fingerprint> says it in words for a terminal, without the advice for an agent', async () => {
    const anchor = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0] as string;
    const second = join(sandbox, 'second');
    process.env.MNEMA_HOME = second;
    const request = await did('key', 'request', '--anchor', anchor);
    delete process.env.MNEMA_HOME;
    await did(
      'key',
      'enroll',
      request.split('\n').find((one) => one.startsWith('mnema-key-request:')) as string,
    );
    const fingerprint = basename(
      readdirSync(join(second, 'identity', 'keys')).find((n) => n.endsWith('.key')) as string,
      '.key',
    );
    await protectMine();

    const said = await mnema('key', 'revoke', fingerprint, '--reason', 'lost');

    expect(said.failed).toBe(true);
    expect(said.text.trim()).toBe(protectedFor(mineFile()));
  });

  it('key revoke --checker says it the same way', async () => {
    const anchor = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0] as string;
    const runner = join(sandbox, 'runner');
    process.env.MNEMA_HOME = runner;
    const request = await did('key', 'request', '--checker', '--anchor', anchor);
    delete process.env.MNEMA_HOME;
    await did(
      'key',
      'enroll',
      '--checker',
      request.split('\n').find((one) => one.startsWith('mnema-checker-request:')) as string,
    );
    const fingerprint = basename(
      readdirSync(join(runner, 'identity', 'keys')).find((n) => n.endsWith('.key')) as string,
      '.key',
    );
    await protectMine();

    const said = await mnema('key', 'revoke', '--checker', fingerprint, '--reason', 'leaked');

    expect(said.failed).toBe(true);
    expect(said.text.trim()).toBe(protectedFor(mineFile()));
  });
});
