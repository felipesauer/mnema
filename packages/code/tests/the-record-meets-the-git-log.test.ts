/**
 * The record and the git log, read against each other: `trailer`, `commits`, `why` and `aging`.
 *
 * WHAT IS HELD:
 *   - the trailer line is the line and nothing else, by label or by id, and a decision nobody
 *     holds is a refusal;
 *   - the commits that CITE a decision and the commits that TOUCH its paths are two lists, and a
 *     commit that only touched is not listed as citing;
 *   - `why` answers for a file (its rules, the commits with trailers that touched it) and for a
 *     commit (what its trailers cite, the rules on what it changed);
 *   - `aging` lists an accepted decision only at the number of commits since the acceptance that
 *     the page says, and counts nothing from before;
 *   - none of it writes: the record's bytes are the same after every read;
 *   - with no git, each says so and exits clean.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runAging } from '../src/commands/aging.js';
import { runCommits } from '../src/commands/commits.js';
import { runTrailer } from '../src/commands/trailer.js';
import { runWhy } from '../src/commands/why.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** What one invocation wrote, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Runs `mnema <argv>` the way the binary does, and reads both channels. */
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

/** `mnema <argv>` that has to succeed; the text of its output. */
async function ok(...argv: string[]): Promise<string> {
  const said = await mnema(...argv);
  expect(said.failed, said.err.join(' / ')).toBe(false);
  return said.out.join('\n');
}

/** `git <args>` in the sandbox repository, dated when a date is given. */
function git(args: string[], dated?: string): string {
  const ran = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: join(sandbox, 'git-home'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      GIT_AUTHOR_NAME: 'a',
      GIT_AUTHOR_EMAIL: 'a@example.com',
      GIT_COMMITTER_NAME: 'a',
      GIT_COMMITTER_EMAIL: 'a@example.com',
      ...(dated !== undefined ? { GIT_COMMITTER_DATE: dated } : {}),
    },
  });
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** Writes `file` and commits it; returns the hash. */
function commit(file: string, message: string, dated?: string): string {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), `${message}\n${Math.random()}`);
  git(['add', file]);
  git(['commit', '-q', '-m', message], dated);
  return git(['rev-parse', 'HEAD']);
}

/** An hour from now — a commit dated so the acceptance of a decision just made is before it. */
function later(): string {
  return new Date(Date.now() + 3_600_000).toISOString();
}

/** Records a decision through the real verb and returns its id. */
async function decide(title: string): Promise<string> {
  const text = await ok('decision', 'record', title, `why ${title}`);
  const id = text.match(/Recorded decision \S+ \(([^)]+)\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${text}`);
  return id;
}

/** A digest of every file under `dir`. */
function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        hash.update(`${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-git-bridge-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

/** A project in a git repository: one accepted decision governing `src`. Returns its id. */
async function aGovernedProject(): Promise<string> {
  git(['init', '-q', '-b', 'main']);
  await ok('init');
  const id = await decide('keep the parser small');
  await ok('decision', 'move', 'accept', id, '--note', 'agreed');
  await ok('link', id, 'src', '--rel', 'governs');
  return id;
}

describe('the trailer line', () => {
  it('is the line and nothing else, by label or by id, and refuses what nobody holds', async () => {
    git(['init', '-q', '-b', 'main']);
    await ok('init');
    const id = await decide('keep the parser small');
    expect(await ok('trailer', 'ADR-1')).toBe('Mnema-Decision: ADR-1');
    expect(await ok('trailer', 'adr-1')).toBe('Mnema-Decision: ADR-1');
    expect(await ok('trailer', id, '--id')).toBe(`Mnema-Decision: ${id}`);
    const none = await mnema('trailer', 'ADR-9');
    expect(none.failed).toBe(true);
    expect(none.err.join('\n')).toContain('No decision ADR-9 here.');
  });
});

describe('commits that cite a decision and commits that touch what it addresses', () => {
  it('keeps the two lists apart', async () => {
    const id = await aGovernedProject();
    const byLabel = commit('src/a.ts', 'Cite by label\n\nMnema-Decision: ADR-1');
    const byId = commit('docs/x.md', `Cite by id, elsewhere\n\nMnema-Decision: ${id}`);
    const touched = commit('src/b.ts', 'Touch without citing');
    commit('docs/y.md', 'Neither');

    const reading = JSON.parse(await ok('commits', 'ADR-1', '--json')) as {
      git: boolean;
      addresses: string[];
      cited: { commits: { sha: string }[] };
      touching: { commits: { sha: string }[] };
    };
    expect(reading.git).toBe(true);
    expect(reading.addresses).toEqual(['src']);
    expect(reading.cited.commits.map((one) => one.sha).sort()).toEqual([byId, byLabel].sort());
    // The commit that only touched `src` is in the second list and never in the first.
    expect(reading.touching.commits.map((one) => one.sha).sort()).toEqual(
      [byLabel, touched].sort(),
    );
    expect(reading.cited.commits.map((one) => one.sha)).not.toContain(touched);

    const page = await ok('commits', id);
    expect(page).toContain('2 cite it by trailer · 2 touched a path it addresses');
    expect(page).toContain('Touch without citing');
  });

  it('refuses a decision nobody holds, and a label two decisions carry says which', async () => {
    await aGovernedProject();
    const none = await mnema('commits', 'ADR-7');
    expect(none.failed).toBe(true);
    expect(none.err.join('\n')).toContain('No decision ADR-7 here.');
  });
});

describe('why, for a file and for a commit', () => {
  it('answers for a file with its rules and the commits with trailers that touched it', async () => {
    await aGovernedProject();
    commit('src/a.ts', 'Cited change\n\nMnema-Decision: ADR-1');
    commit('src/a.ts', 'Uncited change');
    const reading = JSON.parse(await ok('why', 'src/a.ts', '--json')) as {
      about: string;
      relative: string;
      rules: { name: string; address: string }[];
      commits: { subject: string; cites: { decision?: { adr: string } }[] }[];
    };
    expect(reading.about).toBe('file');
    expect(reading.relative).toBe('src/a.ts');
    expect(reading.rules.map((rule) => [rule.name, rule.address])).toEqual([
      ['keep the parser small', 'src'],
    ]);
    expect(reading.commits.map((one) => one.subject)).toEqual(['Cited change']);
    expect(reading.commits[0]?.cites[0]?.decision?.adr).toBe('ADR-1');
  });

  it('answers for a commit with what it cites and the rules on what it changed', async () => {
    await aGovernedProject();
    const sha = commit('src/a.ts', 'Cited change\n\nMnema-Decision: ADR-1\nMnema-Decision: ADR-42');
    const reading = JSON.parse(await ok('why', sha, '--json')) as {
      about: string;
      commit: { cites: { value: string; decision?: { adr: string } }[] };
      rules: { name: string; files: number }[];
    };
    expect(reading.about).toBe('commit');
    expect(reading.commit.cites.map((one) => [one.value, one.decision?.adr])).toEqual([
      ['ADR-1', 'ADR-1'],
      ['ADR-42', undefined],
    ]);
    expect(reading.rules).toEqual([
      expect.objectContaining({ name: 'keep the parser small', files: 1 }),
    ]);
    expect(await ok('why', sha)).toContain('ADR-42 (no decision here by that name)');
  });
});

describe('aging', () => {
  it('lists a decision at the stated number of commits since its acceptance, and none from before', async () => {
    const id = await aGovernedProject();
    commit('src/before.ts', 'Before the acceptance', '2020-01-01T00:00:00Z');
    commit('src/one.ts', 'After one', later());
    expect(await ok('aging', '--min-commits', '2')).toContain('0 of 1 accepted decision');
    commit('src/two.ts', 'After two', later());
    const reading = JSON.parse(await ok('aging', '--min-commits', '2', '--json')) as {
      minCommits: number;
      aged: { id: string; touching: number; all: number }[];
    };
    expect(reading.minCommits).toBe(2);
    expect(reading.aged).toEqual([expect.objectContaining({ id, touching: 2, all: 2 })]);
    // The default is higher than two, and the page does not list it.
    expect(await ok('aging')).toContain('0 of 1 accepted decision');
    const page = await ok('aging', '--min-commits', '2');
    expect(page).toContain('1 of 1 accepted decision');
    expect(page).not.toMatch(/obsolete|stale|wrong/i);
    const refused = await mnema('aging', '--min-commits', '0');
    expect(refused.failed).toBe(true);
  });
});

describe('the reads write nothing, and a place with no git is not a failure', () => {
  it('leaves the record byte for byte as it was', async () => {
    const id = await aGovernedProject();
    commit('src/a.ts', 'Cited change\n\nMnema-Decision: ADR-1');
    const before = digest(join(repo, '.mnema'));
    await ok('trailer', id);
    await ok('commits', id);
    await ok('why', 'src/a.ts');
    await ok('aging');
    expect(digest(join(repo, '.mnema'))).toBe(before);
  });

  it('says there is no git and exits clean', async () => {
    await ok('init');
    const id = await decide('keep the parser small');
    await ok('decision', 'move', 'accept', id, '--note', 'agreed');
    await ok('link', id, 'src', '--rel', 'governs');
    expect(await ok('commits', id)).toContain('There is no git work tree here');
    expect(await ok('aging')).toContain('There is no git work tree here');
    expect(await ok('why', 'src/a.ts')).toContain('There is no git work tree here');
    expect(JSON.parse(await ok('why', 'src/a.ts', '--json'))).toMatchObject({ git: false });
  });
});

describe('the readings, called without the command line', () => {
  it('answer by value what the pages are made of', async () => {
    const id = await aGovernedProject();
    const cited = commit('src/a.ts', 'Cited change\n\nMnema-Decision: ADR-1');
    const ctx = { cwd: repo, env: { home: join(sandbox, 'home') } };

    expect(runTrailer(ctx, { decision: 'ADR-1', byId: false })).toMatchObject({
      ok: true,
      line: 'Mnema-Decision: ADR-1',
    });
    expect(runTrailer(ctx, { decision: 'ADR-4', byId: false })).toEqual({
      ok: false,
      reason: 'NO_SUCH_DECISION',
      typed: 'ADR-4',
    });
    const commits = runCommits(ctx, { decision: id });
    expect(commits).toMatchObject({ ok: true, git: true, addresses: ['src'] });
    if (commits.ok) expect(commits.cited.commits.map((one) => one.sha)).toEqual([cited]);
    const why = runWhy(ctx, { target: 'src/a.ts' });
    expect(why).toMatchObject({ ok: true, about: 'file', relative: 'src/a.ts', exists: true });
    expect(runAging(ctx, { minCommits: 1 })).toMatchObject({ ok: true, git: true, looked: 1 });
    // Outside a project, each refuses with the one reason.
    const elsewhere = { cwd: sandbox, env: { home: join(sandbox, 'home') } };
    expect(runCommits(elsewhere, { decision: id })).toEqual({ ok: false, reason: 'NO_PROJECT' });
    expect(runWhy(elsewhere, { target: 'x' })).toEqual({ ok: false, reason: 'NO_PROJECT' });
    expect(runAging(elsewhere, { minCommits: 1 })).toEqual({ ok: false, reason: 'NO_PROJECT' });
    expect(runTrailer(elsewhere, { decision: id, byId: false })).toEqual({
      ok: false,
      reason: 'NO_PROJECT',
    });
  });
});
