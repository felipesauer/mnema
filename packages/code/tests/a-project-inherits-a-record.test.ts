/**
 * A PROJECT CAN INHERIT ANOTHER REPOSITORY'S DECISIONS, AT ONE COMMIT — through the binary.
 *
 * The origin is a local git repository built in the sandbox with the product's own commands, so no
 * network is touched. What is asserted is what a person at a terminal sees: `inherit set` shows
 * what would be inherited and writes nothing until `--write`; the brief then carries the origin's
 * decision in a section of its own, naming the repository and the commit; and an update shows what
 * changed between the two commits before it moves the pointer.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POINTER_FILE } from '../src/inherited-record.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-inherits-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(dir: string, home: string, ...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git-home'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** Records a decision in `dir` as `home` and accepts it. */
function decide(dir: string, home: string, title: string): void {
  const recorded = mnema(dir, home, 'decision', 'record', title, 'because we said so');
  const id = /^Recorded decision .*?\(([^)]+)\)/m.exec(recorded.out)?.[1];
  expect(recorded.status, recorded.err).toBe(0);
  const accepted = mnema(dir, home, 'decision', 'move', 'accept', id as string, '--note', 'agreed');
  expect(accepted.status, accepted.err).toBe(0);
}

/** Every stored line of every tail of the record at `dir`, read off the files themselves. */
function linesOf(dir: string): string[] {
  const tails = join(dir, '.mnema', 'tails');
  return readdirSync(tails, { recursive: true, encoding: 'utf-8' })
    .filter((name) => /\d+\.jsonl$/.test(name))
    .flatMap((name) => readFileSync(join(tails, name), 'utf-8').split('\n'))
    .filter((line) => line.length > 0);
}

function commit(dir: string): string {
  git(dir, 'add', '.mnema');
  git(dir, 'commit', '-q', '-m', 'record');
  return git(dir, 'rev-parse', 'HEAD');
}

describe('inheriting, as a person types it', () => {
  it('shows, then points, then prints the decision under the origin’s name — and updates only on request', () => {
    const source = join(sandbox, 'decisions');
    const project = join(sandbox, 'service');
    const homeS = join(sandbox, 'home-s');
    const homeP = join(sandbox, 'home-p');
    for (const dir of [source, project, homeS, homeP]) mkdirSync(dir, { recursive: true });
    git(source, 'init', '-q', '-b', 'main');
    expect(mnema(source, homeS, 'init').status).toBe(0);
    decide(source, homeS, 'Postgres in every new service');
    const first = commit(source);
    expect(mnema(project, homeP, 'init').status).toBe(0);

    const own = linesOf(project);
    const shown = mnema(project, homeP, 'inherit', 'set', source);
    expect(shown.status, shown.err).toBe(0);
    expect(shown.out).toContain('+ Postgres in every new service');
    expect(shown.out).toContain('Nothing written');
    expect(existsSync(join(project, '.mnema', POINTER_FILE))).toBe(false);

    const set = mnema(project, homeP, 'inherit', 'set', source, '--write');
    expect(set.status, set.err).toBe(0);
    expect(JSON.parse(readFileSync(join(project, '.mnema', POINTER_FILE), 'utf-8'))).toEqual({
      origin: source,
      commit: first,
    });

    const brief = mnema(project, homeP, 'brief');
    expect(brief.status, brief.err).toBe(0);
    const [own, inherited] = brief.out.split('## Inherited decisions');
    expect(own).not.toContain('Postgres');
    expect(inherited).toContain('Postgres in every new service');
    expect(inherited).toContain(source);
    expect(inherited).toContain(first);

    decide(source, homeS, 'Redis for queues');
    const second = commit(source);
    expect(mnema(project, homeP, 'brief').out).not.toContain('Redis');
    const update = mnema(project, homeP, 'inherit', 'update');
    expect(update.status, update.err).toBe(0);
    expect(update.out).toContain('+ Redis for queues');
    expect(update.out).toContain(`${first} -> ${second}`);
    expect(JSON.parse(readFileSync(join(project, '.mnema', POINTER_FILE), 'utf-8')).commit).toBe(
      first,
    );
    expect(mnema(project, homeP, 'inherit', 'update', '--write').status).toBe(0);
    expect(mnema(project, homeP, 'brief').out).toContain('Redis for queues');

    // Nothing was signed into the project's record by pointing at another's, or by moving the pointer.
    expect(linesOf(project)).toEqual(own);
    // The project's own verify counts its own record: the inherited one is not in it.
    const verified = mnema(project, homeP, 'verify');
    expect(verified.status, verified.err).toBe(0);
  }, 90_000);

  it('says it plainly when the origin is gone and nothing was copied, and the brief still prints', () => {
    const project = join(sandbox, 'service');
    const homeP = join(sandbox, 'home-p');
    for (const dir of [project, homeP]) mkdirSync(dir, { recursive: true });
    expect(mnema(project, homeP, 'init').status).toBe(0);
    const refused = mnema(project, homeP, 'inherit', 'set', join(sandbox, 'nowhere'), '--write');
    expect(refused.status).not.toBe(0);
    expect(refused.err).toContain('could not be reached');
    expect(existsSync(join(project, '.mnema', POINTER_FILE))).toBe(false);
  }, 60_000);
});
