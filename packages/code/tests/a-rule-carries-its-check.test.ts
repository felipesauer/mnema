/**
 * A rule carries its check, and a runner's key records whether it held — driven the way the
 * binary drives it, over a real git repository in a sandbox, with two homes: the person's and
 * the runner's. Held:
 *   - `check declare` records a program and its arguments on a rule;
 *   - `key request --checker` / `key enroll --checker` enroll a key that signs check results
 *     only, and `key enroll` without `--checker` does not take that line;
 *   - `check run --key <file>` runs the check of each rule in force without a shell, records
 *     one result per rule at HEAD under the runner's own identity, and exits non-zero when one
 *     failed; the record verifies with them in it;
 *   - a person's key runs nothing, and a tree with changes outside the record runs nothing;
 *   - `accountability` says the runner is a machine;
 *   - `key revoke --checker` retires the runner's key: it runs nothing after, `verify` still
 *     passes and names the results it signed before, and `accountability` says who retired it.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/program.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
const saved: Record<string, string | undefined> = {};

interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

async function mnema(...argv: string[]): Promise<Said> {
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
  return { out, err, failed };
}

async function did(...argv: string[]): Promise<Said> {
  const said = await mnema(...argv);
  expect(said.failed, `mnema ${argv.join(' ')}: ${said.err.join(' / ')}`).toBe(false);
  return said;
}

function git(...args: string[]): string {
  const ran = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: env.home,
      GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    },
  });
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

const events = (): CatalogEvent[] =>
  orderedEvents({ root: resolveTrees(repo, env).projectPublic as string }, catalogUpcasters());

function idIn(said: Said): string {
  const id = said.out
    .join('\n')
    .match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said.out.join(' / ')}`);
  return id;
}

async function acceptedRule(title: string): Promise<string> {
  const id = idIn(await did('decision', 'record', title, `why ${title}`));
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  return id;
}

/** The runner's line, made under the runner's own home; and where its private key is. */
async function runnerRequest(): Promise<{ line: string; keyFile: string }> {
  const anchor = events().find((e) => e.kind === 'identity.founded')?.subject as string;
  const runnerHome = join(sandbox, 'runner');
  process.env.MNEMA_HOME = runnerHome;
  try {
    const said = await did('key', 'request', '--checker', '--anchor', anchor);
    const line = said.out.find((l) => l.startsWith('mnema-checker-request:1:'));
    if (line === undefined) throw new Error(`no checker request in ${said.out.join(' / ')}`);
    const keys = join(runnerHome, 'identity', 'keys');
    const file = readdirSync(keys).find((n) => n.endsWith('.key')) as string;
    return { line, keyFile: join(keys, file) };
  } finally {
    delete process.env.MNEMA_HOME;
  }
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-check-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  for (const name of ['XDG_DATA_HOME', 'HOME', 'MNEMA_HOME', 'MNEMA_RUN']) {
    saved[name] = process.env[name];
  }
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  git('init', '-q');
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

describe('mnema check', () => {
  it('a runner key checks every rule in force at HEAD, signs as a machine, and the record verifies', async () => {
    const held = await acceptedRule('Money is kept in integer cents');
    const broken = await acceptedRule('Every query is parameterized');
    // A `;` in an argument reaches the program as text: there is no shell to split it.
    await did('check', 'declare', held, 'node', '--', '-e', 'console.log("ok;" + "fine")');
    await did('check', 'declare', broken, 'node', '--', '-e', 'process.exit(3)');
    const declared = events().filter((e) => e.kind === 'check.declared');
    expect(declared.map((e) => (e.kind === 'check.declared' ? e.payload.args : []))).toEqual([
      ['-e', 'console.log("ok;" + "fine")'],
      ['-e', 'process.exit(3)'],
    ]);

    const { line, keyFile } = await runnerRequest();
    const wrongDoor = await mnema('key', 'enroll', line);
    expect(wrongDoor.failed).toBe(true);
    await did('key', 'enroll', '--checker', line);

    git('add', '-A');
    git('commit', '-q', '-m', 'the record');
    const head = git('rev-parse', 'HEAD');

    const ran = await mnema('check', 'run', '--key', keyFile);
    expect(ran.failed, 'a failed check makes the run fail').toBe(true);
    expect(ran.out.join('\n')).toContain(`1 passed · 1 failed at ${head}`);
    expect(ran.out.join('\n')).toContain(`failed ${broken}: exited with code 3`);

    const results = events().filter((e) => e.kind === 'check.passed' || e.kind === 'check.failed');
    expect(results.map((e) => [e.kind, e.subject])).toEqual(
      expect.arrayContaining([
        ['check.passed', held],
        ['check.failed', broken],
      ]),
    );
    for (const e of results) {
      if (e.kind !== 'check.passed' && e.kind !== 'check.failed') continue;
      expect(e.payload.commit).toBe(head);
    }
    const passed = results.find((e) => e.kind === 'check.passed');
    expect(passed?.kind === 'check.passed' ? passed.payload.output : '').toBe('ok;fine');

    await did('verify');
    const account = await did('audit', 'accountability');
    expect(account.out.join('\n')).toContain('machine (signs check results only)');
    const json = JSON.parse((await did('audit', 'accountability', '--json')).out.join('\n')) as {
      byWho: { who: string; machine: boolean }[];
    };
    expect(json.byWho.filter((w) => w.machine).map((w) => w.who)).toEqual([results[0]?.who]);
  });

  it('a person’s key runs nothing, and records nothing', async () => {
    const rule = await acceptedRule('Money is kept in integer cents');
    await did('check', 'declare', rule, 'node', '--', '-e', 'process.exit(0)');
    git('add', '-A');
    git('commit', '-q', '-m', 'the record');
    const before = events().length;

    const said = await mnema('check', 'run');
    expect(said.failed).toBe(true);
    expect(said.err.join('\n')).toContain('not enrolled as a checker');
    expect(events()).toHaveLength(before);
  });

  it('a tree with changes outside the record runs nothing', async () => {
    const rule = await acceptedRule('Money is kept in integer cents');
    await did('check', 'declare', rule, 'node', '--', '-e', 'process.exit(0)');
    const { line, keyFile } = await runnerRequest();
    await did('key', 'enroll', '--checker', line);
    git('add', '-A');
    git('commit', '-q', '-m', 'the record');
    writeFileSync(join(repo, 'money.ts'), 'export const cents = 1.5;\n');
    const before = events().length;

    const said = await mnema('check', 'run', '--key', keyFile);
    expect(said.failed).toBe(true);
    expect(said.err.join('\n')).toContain('changes outside the record');
    expect(events()).toHaveLength(before);
  });

  it('a retired runner key runs nothing, and what it signed before is named by verify', async () => {
    const rule = await acceptedRule('Money is kept in integer cents');
    await did('check', 'declare', rule, 'node', '--', '-e', 'process.exit(0)');
    const { line, keyFile } = await runnerRequest();
    await did('key', 'enroll', '--checker', line);
    git('add', '-A');
    git('commit', '-q', '-m', 'the record');
    await did('check', 'run', '--key', keyFile);
    git('add', '-A');
    git('commit', '-q', '-m', 'the results');

    const fingerprint = basename(keyFile, '.key');
    const retired = await did(
      'key',
      'revoke',
      '--checker',
      fingerprint,
      '--reason',
      'the runner secret was printed in a build log',
    );
    expect(retired.out.join('\n')).toContain(`Retired checker ${fingerprint}`);
    expect(events().filter((e) => e.kind === 'checker.retired')).toHaveLength(1);
    git('add', '-A');
    git('commit', '-q', '-m', 'the retirement');

    const before = events().length;
    const refused = await mnema('check', 'run', '--key', keyFile);
    expect(refused.failed).toBe(true);
    expect(refused.err.join('\n')).toContain('was retired as a checker');
    expect(events()).toHaveLength(before);

    const verified = await did('verify');
    expect(verified.out.join('\n')).toContain('census [retired-checker]');
    const account = await did('audit', 'accountability');
    expect(account.out.join('\n')).toContain('retired by');
  });
});
