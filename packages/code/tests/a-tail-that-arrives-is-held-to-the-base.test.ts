/**
 * A TAIL THAT ARRIVES IN A CHANGE IS HELD TO THE RECORD THE BASE IS (ADR-134, FORMAT.md 6.10).
 *
 * A directory alone cannot tell which of two records was there first, and it cannot tell a tail
 * written before records were named from one grafted out of another record written then: both
 * name no record. `verify --since <base>` knows what the base held, so it refuses a tail new since
 * the base that names no record, and names the tails new since the base that name another record
 * as the ones that arrived. A tail the base already held is not asked again.
 *
 * WHAT IS RUN. The built binary, with a `HOME` of its own per machine, over one sandbox git
 * repository: a base named by the record `init` began, and four branches a pull request could
 * bring: a second machine writing into the same record, a tail written before records were named
 * copied in with its key, a tail of another record copied in with its key, and the first machine
 * writing again.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { ROOT } from './support/published-examples.js';

const BINARY = join(ROOT, 'packages/code/dist/cli.js');
/** A record the 0.1.4 binary wrote: its one tail names no record. */
const WRITTEN_BEFORE = join(
  ROOT,
  'packages/chain/src/chain/__fixtures__/written-by-an-earlier-binary',
);

let sandbox: string;
let repo: string;
let base: string;

function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: join(sandbox, 'git-home'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** `mnema <args>` in `dir`, as the machine whose HOME is `machine`. */
function mnema(machine: string, dir: string, ...args: string[]) {
  const ran = spawnSync(process.execPath, [BINARY, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(sandbox, machine) },
  });
  return { status: ran.status ?? -1, out: ran.stdout, err: ran.stderr };
}

function written(machine: string, dir: string, ...args: string[]): void {
  const ran = mnema(machine, dir, ...args);
  if (ran.status !== 0) throw new Error(`mnema ${args.join(' ')}: ${ran.err}`);
}

/**
 * Copies the one tail of the record at `from`, and every public key beside it (the tail's own and
 * any key it enrolled), into the repo, as a graft that verifies on its own would be made.
 */
function graft(from: string): string {
  const tail = readdirSync(join(from, 'tails'))[0] as string;
  cpSync(join(from, 'tails', tail), join(repo, '.mnema', 'tails', tail), { recursive: true });
  for (const key of readdirSync(join(from, 'keys'))) {
    if (key.endsWith('.pub')) cpSync(join(from, 'keys', key), join(repo, '.mnema', 'keys', key));
  }
  return tail;
}

function branch(name: string, change: () => void): void {
  git(repo, 'switch', '-q', 'main');
  git(repo, 'switch', '-q', '-c', name);
  change();
  git(repo, 'add', '.mnema');
  git(repo, 'commit', '-q', '-m', name);
}

let unnamedTail: string;
let foreignTail: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-arrives-'));
  for (const machine of ['git-home', 'first', 'second', 'third', 'elsewhere']) {
    mkdirSync(join(sandbox, machine));
  }
  repo = join(sandbox, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  written('first', repo, 'init');
  written('first', repo, 'decision', 'record', 'Use the standard library', 'It is there');
  git(repo, 'add', '.mnema');
  git(repo, 'commit', '-q', '-m', 'base');
  base = git(repo, 'rev-parse', 'HEAD');

  const other = join(sandbox, 'other');
  mkdirSync(other);
  git(other, 'init', '-q');
  written('elsewhere', other, 'init');
  written('elsewhere', other, 'decision', 'record', 'Another project', 'Elsewhere');

  branch('same-record', () =>
    written('second', repo, 'decision', 'record', 'A second machine', 'Its own tail'),
  );
  branch('unnamed', () => {
    unnamedTail = graft(WRITTEN_BEFORE);
  });
  branch('another-record', () => {
    foreignTail = graft(join(other, '.mnema'));
  });
  branch('nothing-new', () =>
    written('first', repo, 'decision', 'record', 'The same machine', 'The same tail'),
  );
}, 120_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function since(name: string) {
  git(repo, 'switch', '-q', name);
  return mnema('first', repo, 'verify', '--require=signed', '--since', base);
}

describe('verify --since holds a tail that arrived to the record the base is', () => {
  it('passes a new tail of the same record, and a change that brings no tail', () => {
    for (const name of ['same-record', 'nothing-new']) {
      const ran = since(name);
      expect(ran.status, `${name}: ${ran.err}`).toBe(0);
      expect(ran.out, name).toContain('the record only grew');
    }
  });

  it('refuses a new tail that names no record, by its id', () => {
    const ran = since('unnamed');
    expect(ran.status, ran.out).toBe(1);
    expect(ran.err).toContain(`tail ${unnamedTail} arrived since and names no record`);
    expect(ran.err).toContain('(born-unnamed)');
    // The directory alone verifies: the refusal is the base's to make, not the bare verdict's.
    expect(mnema('first', repo, 'verify', '--require=signed').status).toBe(0);
  });

  it('refuses a new tail of another record, naming it as the one that arrived', () => {
    const ran = since('another-record');
    expect(ran.status, ran.out).toBe(1);
    const said = ran.err.split('\n').find((line) => line.includes('arrived since'));
    expect(said).toContain(`tail ${foreignTail} arrived since and names record`);
    expect(said).toContain('(another-record)');
  });

  it('leaves an unnamed tail the base already held to the census', () => {
    git(repo, 'switch', '-q', 'unnamed');
    const held = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'switch', '-q', '-c', 'after-the-graft');
    written('third', repo, 'decision', 'record', 'After the graft', 'A tail of this record');
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'after the graft');
    const ran = mnema('first', repo, 'verify', '--require=signed', '--since', held);
    expect(ran.status, ran.err).toBe(0);
    expect(ran.out).toContain('the record only grew');
    expect(ran.out).toContain(`census [unnamed-tail] public ${unnamedTail}`);
  });
});
