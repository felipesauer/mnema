/**
 * A TAIL THAT ARRIVES IN A CHANGE IS HELD TO THE RECORD THE BASE IS (ADR-134, FORMAT.md 6.10).
 *
 * A directory alone cannot tell which of two records was there first, and it cannot tell a tail
 * written before records were named from one grafted out of another record written then: both
 * name no record. `verify --since <base>` knows what the base held, so it names the tails new since
 * the base that name another record as the ones that arrived, and, where a tail of the base names
 * the record, refuses a tail new since the base that names no record. Where none does (a record
 * written before records were named, or no record at all), the record has no name yet to hold
 * such a tail to: it passes, with a note that says so. A tail the base already held is not asked
 * again.
 *
 * WHAT IS RUN. The built binary, with a `HOME` of its own per machine, over sandbox git
 * repositories: a base named by the record `init` began, and four branches a pull request could
 * bring: a second machine writing into the same record, a tail written before records were named
 * copied in with its key, a tail of another record copied in with its key, and the first machine
 * writing again; then a base whose one tail was written before records were named, and a base
 * with no record, each brought a tail that names no record.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { ROOT } from './support/published-examples.js';

const BINARY = join(ROOT, 'packages/code/dist/cli.js');
/** A record an earlier binary wrote, before records were named: its one tail names none. */
const WRITTEN_BEFORE = join(
  ROOT,
  'packages/chain/src/chain/__fixtures__/written-by-an-earlier-binary',
);

/** Another record written before records were named, by another key: its one tail names none. */
const WITNESSED_BEFORE = join(ROOT, 'packages/chain/src/chain/__fixtures__/witnessed-record');

/**
 * A record whose genesis tail was born before records were named and took its name later, by a
 * checkpoint of the second scheme after one of the first: cut back to that first checkpoint, the
 * tail names no record; whole, it names the record its own genesis derives.
 */
const NAMED_LATER = join(ROOT, 'packages/chain/src/chain/__fixtures__/named-by-its-genesis');
const NAMED_LATER_TAIL = `8d6995a429f1ab61489f0b8391e9ae3ced5ff165eac004ee4572d56e1cad0616-${'0a'.repeat(16)}`;

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
function graft(from: string, into = repo): string {
  const tail = readdirSync(join(from, 'tails'))[0] as string;
  cpSync(join(from, 'tails', tail), join(into, '.mnema', 'tails', tail), { recursive: true });
  mkdirSync(join(into, '.mnema', 'keys'), { recursive: true });
  for (const key of readdirSync(join(from, 'keys'))) {
    if (key.endsWith('.pub')) cpSync(join(from, 'keys', key), join(into, '.mnema', 'keys', key));
  }
  return tail;
}

function branch(name: string, change: () => void, into = repo): void {
  git(into, 'switch', '-q', 'main');
  git(into, 'switch', '-q', '-c', name);
  change();
  git(into, 'add', '.mnema');
  git(into, 'commit', '-q', '-m', name);
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

  it('passes a new unnamed tail where no tail of the base names the record, with a note', () => {
    const unnamedBase = join(sandbox, 'unnamed-base');
    mkdirSync(unnamedBase);
    git(unnamedBase, 'init', '-q');
    graft(WRITTEN_BEFORE, unnamedBase);
    git(unnamedBase, 'add', '.mnema');
    git(unnamedBase, 'commit', '-q', '-m', 'a record written before records were named');
    const at = git(unnamedBase, 'rev-parse', 'HEAD');
    let arrived = '';
    branch(
      'unnamed-over-unnamed',
      () => {
        arrived = graft(WITNESSED_BEFORE, unnamedBase);
      },
      unnamedBase,
    );
    const ran = mnema('first', unnamedBase, 'verify', '--require=signed', '--since', at);
    expect(ran.status, ran.err).toBe(0);
    expect(ran.err).not.toContain('(born-unnamed)');
    const note = ran.out.split('\n').find((line) => line.includes(`tail ${arrived}`));
    expect(note).toContain('arrived since and names no record');
    expect(note).toContain('the record has no name yet');
    expect(note).toContain('a note, not a failure');
    expect(ran.out).toContain('the record only grew');
    const json = mnema('first', unnamedBase, 'verify', '--require=signed', '--since', at, '--json');
    expect(json.status, json.err).toBe(0);
    expect(JSON.parse(json.out).since.arrived).toEqual({
      records: [expect.any(String)],
      unnamed: [],
      noted: [arrived],
      foreign: [],
    });
  });

  it('passes a new unnamed tail where the base held no record, with a note', () => {
    const noRecord = join(sandbox, 'no-record');
    mkdirSync(noRecord);
    git(noRecord, 'init', '-q');
    git(noRecord, 'commit', '-q', '--allow-empty', '-m', 'no record yet');
    const at = git(noRecord, 'rev-parse', 'HEAD');
    let arrived = '';
    branch(
      'unnamed-over-none',
      () => {
        arrived = graft(WRITTEN_BEFORE, noRecord);
      },
      noRecord,
    );
    const ran = mnema('first', noRecord, 'verify', '--require=signed', '--since', at);
    expect(ran.status, ran.err).toBe(0);
    expect(ran.err).not.toContain('(born-unnamed)');
    const note = ran.out.split('\n').find((line) => line.includes(`tail ${arrived}`));
    expect(note).toContain('arrived since and names no record');
    expect(note).toContain('the record has no name yet');
  });

  /**
   * A repository whose base holds `NAMED_LATER_TAIL` as it was before it took a name (its entries
   * up to its first checkpoint, and that checkpoint), beside the tails of `others`, and whose head
   * holds the tail whole.
   */
  function namedSince(dir: string, ...others: string[]): string {
    const at = join(sandbox, dir);
    mkdirSync(at);
    git(at, 'init', '-q');
    for (const other of others) graft(other, at);
    const tail = join(at, '.mnema', 'tails', NAMED_LATER_TAIL);
    cpSync(join(NAMED_LATER, 'tails', NAMED_LATER_TAIL), tail, { recursive: true });
    for (const key of readdirSync(join(NAMED_LATER, 'keys'))) {
      cpSync(join(NAMED_LATER, 'keys', key), join(at, '.mnema', 'keys', key));
    }
    const whole = (file: string) => readFileSync(join(tail, file), 'utf-8');
    const [first] = whole('checkpoints.jsonl').split('\n');
    const covered = (JSON.parse(first as string) as { toSeq: number }).toSeq;
    const lines = whole('000001.jsonl').split('\n');
    const segment = whole('000001.jsonl');
    const checkpoints = whole('checkpoints.jsonl');
    writeFileSync(join(tail, '000001.jsonl'), `${lines.slice(0, covered + 1).join('\n')}\n`);
    writeFileSync(join(tail, 'checkpoints.jsonl'), `${first}\n`);
    git(at, 'add', '.mnema');
    git(at, 'commit', '-q', '-m', 'the tail before it took a name');
    const base = git(at, 'rev-parse', 'HEAD');
    writeFileSync(join(tail, '000001.jsonl'), segment);
    writeFileSync(join(tail, 'checkpoints.jsonl'), checkpoints);
    git(at, 'add', '.mnema');
    git(at, 'commit', '-q', '-m', 'the tail named');
    return base;
  }

  it('passes a tail the base held unnamed that names now the record its genesis derives', () => {
    const at = namedSince('named-as-its-genesis');
    const ran = mnema(
      'first',
      join(sandbox, 'named-as-its-genesis'),
      'verify',
      '--require=signed',
      '--since',
      at,
    );
    expect(ran.status, ran.err).toBe(0);
    expect(ran.out).toContain('the record only grew');
  });

  it('refuses a tail the base held unnamed that names now another record than its genesis, by its id', () => {
    const at = namedSince('named-otherwise', WITNESSED_BEFORE);
    const ran = mnema('first', join(sandbox, 'named-otherwise'), 'verify', '--since', at);
    const said = ran.err.split('\n').find((line) => line.includes(`tail ${NAMED_LATER_TAIL}`));
    expect(said, ran.err).toContain('arrived since and names record 56eec5ae4b56...');
    expect(said).toContain('(another-record)');
    expect(ran.status).toBe(1);
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
