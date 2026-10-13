/**
 * A RETIRED AGENT KEY WITH NO TAIL IS CALLED RETIRED, NOT "ENROLLED".
 *
 * The census sentence for a committed key with no tail that the record enrols as an agent says
 * "the record enrols it". Once `key revoke --agent` has retired the key that is no longer true —
 * the key is a member of nothing — and the sentence says that it was retired instead, in the
 * private and the global tree as in the committed one.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/program.js';

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

/** The census lines `verify` prints for the key `fingerprint`, by tree. */
async function censusLines(fingerprint: string, ...flags: string[]): Promise<string[]> {
  const said = await mnema('verify', ...flags);
  return (said.out + said.err)
    .split('\n')
    .filter((one) => one.includes('[key-without-tail]') && one.includes(fingerprint));
}

let agentFp: string;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-retired-no-tail-'));
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
});

describe('the census of a retired agent key that never signed', () => {
  it('says the key was retired, in every tree that carries its half', async () => {
    const anchor = orderedEvents(
      { root: resolveTrees(repo, { home }).projectPublic as string },
      catalogUpcasters(),
    ).find((event) => event.kind === 'identity.founded')?.subject as string;
    await did('key', 'revoke', agentFp, '--agent', '--reason', 'rotated');

    const lines = await censusLines(agentFp, '--global');

    const said = (tree: string) =>
      `[key-without-tail] ${tree} ${agentFp}: the key of the agent "claude" of ${anchor}: the record retired it, and it has no tail on disk — it may have signed nothing here, or its tail may have been dropped (a botched merge) or removed; nothing here can tell which`;
    expect(lines.map((line) => line.replace(/^.*?(?=\[key-without-tail\])/, ''))).toEqual([
      said('public'),
      said('private'),
      said('global'),
    ]);
  });
});
