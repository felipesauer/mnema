/**
 * `key revoke --agent` REFUSED IN THE FIRST TREE: by code, and with an advice that fits.
 *
 * A first tree that refuses with the core's own refusal (a recorded identity that no longer
 * counts the key) stops the verb with that refusal's code. A first tree whose key of the person is
 * protected, with no passphrase to hand, stops it with `KEY_IS_PROTECTED` — in words for a person
 * at a terminal, not the advice a host that signs for an agent is given.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityUnavailableError } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CliIo, run } from '../src/program.js';

/** What the next `retireAgentKey` throws, where a case needs the core to refuse by throwing. */
let thrown: Error | undefined;

vi.mock('@mnema/core/write', async (original) => {
  const real = await original<typeof import('@mnema/core/write')>();
  return {
    ...real,
    retireAgentKey: (...args: Parameters<typeof real.retireAgentKey>) => {
      if (thrown !== undefined) throw thrown;
      return real.retireAgentKey(...args);
    },
  };
});

let sandbox: string;
let home: string;
let repo: string;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

async function mnema(...argv: string[]): Promise<{ out: string; err: string; failed: boolean }> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

async function did(...argv: string[]): Promise<string> {
  const said = await mnema(...argv);
  expect(said.failed, `${argv.join(' ')}: ${said.err}`).toBe(false);
  return said.out;
}

/** Makes the agent `claude` and enrols it; returns its fingerprint. */
async function anAgent(): Promise<string> {
  const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
  const requested = await did(
    'key',
    'request',
    '--agent',
    'claude',
    '--anchor',
    identity as string,
  );
  const line = requested.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  await did('key', 'enroll', '--agent', line as string);
  return requested.match(/\b[0-9a-f]{64}\b/)?.[0] as string;
}

let agentFp: string;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-revoke-refused-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  delete process.env.MNEMA_KEY_PASSPHRASE;
  process.chdir(repo);
  await did('init');
  agentFp = await anAgent();
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
  delete process.env.MNEMA_KEY_PASSPHRASE;
  thrown = undefined;
});

describe('key revoke --agent refused in the first tree', () => {
  it('says the core’s code when the recorded identity no longer counts this key', async () => {
    thrown = new IdentityUnavailableError(
      'STALE_ANCHOR',
      'the recorded identity does not count this key',
    );

    const said = await mnema('key', 'revoke', agentFp, '--agent', '--reason', 'rotated');

    expect(said.failed).toBe(true);
    expect((said.err + said.out).trim()).toBe(
      'Refused (STALE_ANCHOR): the recorded identity does not count this key',
    );
  });

  it('says the key of the person is protected in words for a terminal, not for a host', async () => {
    process.env.MNEMA_KEY_PASSPHRASE = 'correct horse';
    await did('key', 'protect');
    delete process.env.MNEMA_KEY_PASSPHRASE;

    const said = await mnema('key', 'revoke', agentFp, '--agent', '--reason', 'rotated');

    expect(said.failed).toBe(true);
    const mine = join(home, '.mnema', 'identity', 'keys');
    const file = readdirSync(mine).find((name) => name.endsWith('.key')) as string;
    expect((said.err + said.out).trim()).toBe(
      `Refused (KEY_IS_PROTECTED): the private key at ${join(mine, file)} is protected by a passphrase and MNEMA_KEY_PASSPHRASE is not set, and a retirement is signed with it: run the command in a terminal, which asks for the passphrase, or set MNEMA_KEY_PASSPHRASE for it`,
    );
  });
});
