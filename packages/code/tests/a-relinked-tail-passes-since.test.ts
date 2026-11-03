/**
 * A TAIL ITS OWNER RELINKED PASSES `verify --since` WHERE THE RELINK COUNTS (ADR-155, FORMAT.md
 * section 6.11).
 *
 * One person ran `mnema init` twice, on two branches: two records, X and Y, of one key. Merged,
 * the directory held tails of both, and `verify --since` named the tail of X as one of another
 * record. The owner's relink of that tail, from a tail of the same key that names Y, moves it into
 * Y in both readers; `--since` names each side's tails as the readers do, so the change that brings
 * the tail and its relink passes, with a line that says it, and the change whose relink does not
 * count is still refused as `another-record`, by the line it always had.
 *
 * WHAT IS RUN. The built binary, over sandbox git repositories whose record `mutate.py` builds the
 * way the readers' own tests do (`second-reader-agrees-on-a-relink.test.ts`), every signature real:
 * no command writes a relink on this base. The base is the trunk at Y alone, or at Y and the tail
 * of X already merged; the branch brings what is left of the record.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { ROOT } from './support/published-examples.js';

const BINARY = join(ROOT, 'packages/code/dist/cli.js');
const VERIFIER_DIR = join(ROOT, 'packages/chain/verifier');
const MUTATE = join(VERIFIER_DIR, 'mutate.py');
const WITNESSED = join(ROOT, 'packages/chain/src/chain/__fixtures__/witnessed-record');

/** The tails `mutate.py` writes, by the installation half of their id. */
const GENESIS_OF_Y = 'ab'.repeat(16);
const RELINKED = 'cd'.repeat(16);
const HOST = 'ef'.repeat(16);

/**
 * Splits the host tail's one segment in two, a note before the relink in the first and the relink
 * in the second, every signature remade by `mutate.py`'s own writer: a base holding the relink in
 * a segment other than its first.
 */
const RELINK_IN_A_SECOND_SEGMENT = `
import json, os, shutil, sys
sys.path.insert(0, sys.argv[1])
import mutate as m
root = sys.argv[2]
host = m._tail_name(m.CHECKER_SECRET, "ef")
y = m.record_name(m._tail_name(m.CHECKER_SECRET, "ab"))
folder = os.path.join(root, "tails", host)
relink = json.loads(open(os.path.join(folder, "000001.jsonl"), "rb").read().splitlines()[0])["event"]
note = m._event(m.CHECKER_SECRET, relink["at"], "memory.captured",
                "01a02d24-730d-7000-988d-ac7784b4a4a7", {"content": "before the relink"}, relink["who"])
shutil.rmtree(folder)
m._write_tail(root, m.CHECKER_SECRET, host, [note, relink], y)
first, second = open(os.path.join(folder, "000001.jsonl"), "rb").read().splitlines(keepends=True)
open(os.path.join(folder, "000001.jsonl"), "wb").write(first)
open(os.path.join(folder, "000002.jsonl"), "wb").write(second)
`;

let sandbox: string;

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

function python(...args: string[]): void {
  const ran = spawnSync('python3', args, { encoding: 'utf-8' });
  if (ran.status !== 0) throw new Error(`python3 ${args[0]}: ${ran.stderr}`);
}

/** The record `mutate.py` builds by `name`, in a folder of its own. */
function built(name: string, then?: string): string {
  const record = join(sandbox, `built-${name}${then === undefined ? '' : '-then'}`);
  cpSync(WITNESSED, record, { recursive: true });
  python(MUTATE, name, record);
  if (then !== undefined) python('-c', then, VERIFIER_DIR, record);
  return record;
}

/** The tail of `record` whose id ends in `installation`. */
function tailOf(record: string, installation: string): string {
  const tail = readdirSync(join(record, 'tails')).find((id) => id.endsWith(installation));
  if (tail === undefined) throw new Error(`no tail ${installation}`);
  return tail;
}

/**
 * A repository whose trunk holds the keys and the tails of `record` ending in one of `onTrunk`,
 * and a branch `change` that brings the rest; returns the repository.
 */
function pullRequest(name: string, record: string, onTrunk: readonly string[]): string {
  const repo = join(sandbox, `repo-${name}`);
  mkdirSync(repo);
  git(repo, 'init', '-q');
  const into = join(repo, '.mnema');
  cpSync(join(record, 'keys'), join(into, 'keys'), { recursive: true });
  const tails = readdirSync(join(record, 'tails'));
  const copy = (tail: string): void =>
    cpSync(join(record, 'tails', tail), join(into, 'tails', tail), { recursive: true });
  for (const tail of tails) if (onTrunk.some((end) => tail.endsWith(end))) copy(tail);
  git(repo, 'add', '.mnema');
  git(repo, 'commit', '-q', '-m', 'the trunk');
  git(repo, 'switch', '-q', '-c', 'change');
  for (const tail of tails) if (!onTrunk.some((end) => tail.endsWith(end))) copy(tail);
  git(repo, 'add', '.mnema');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'the change');
  return repo;
}

function since(repo: string) {
  const ran = spawnSync(
    process.execPath,
    [BINARY, 'verify', '--require=signed', '--since', 'main'],
    {
      cwd: repo,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(sandbox, 'machine') },
    },
  );
  return { status: ran.status ?? -1, out: ran.stdout, err: ran.stderr };
}

/** The lines `--since` says of a relinked tail. */
const relinkedLines = (said: string): string[] =>
  said
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('(relinked)'));

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-relink-since-'));
  for (const machine of ['git-home', 'machine']) mkdirSync(join(sandbox, machine));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('verify --since over a change that brings a relink', () => {
  it('passes the tail of one person’s second init and its relink, saying the tail arrived', () => {
    const record = built('relinked-by-the-genesis-founder');
    const relinked = tailOf(record, RELINKED);
    const ran = since(pullRequest('arrived', record, [GENESIS_OF_Y]));
    expect(ran.status, `${ran.out}\n${ran.err}`).toBe(0);
    expect(ran.err).not.toContain('(another-record)');
    const lines = relinkedLines(ran.out);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      new RegExp(
        `^since main \\([0-9a-f]{12}\\): tail ${relinked} arrived since, record [0-9a-f]{12}\\.\\.\\., relinked into this record by its own key, 2 event\\(s\\) from \\d{4}-\\d\\d-\\d\\dT[0-9:.]+Z \\(relinked\\)$`,
      ),
    );
    expect(ran.out).toContain('the record only grew');
  });

  it('passes the relink of a tail the trunk already held, saying it was in the record there', () => {
    // The trunk merged the second init and holds both records; the change brings the relink only.
    // Read off the disk, the base would hold the relink and the line would not be said.
    const record = built('relinked-by-the-genesis-founder');
    const relinked = tailOf(record, RELINKED);
    const ran = since(pullRequest('held', record, [GENESIS_OF_Y, RELINKED]));
    expect(ran.status, `${ran.out}\n${ran.err}`).toBe(0);
    const lines = relinkedLines(ran.out);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`tail ${relinked} was in the record there, record `);
  });

  it('reads the base whole, out of its own bytes: a relink it held in a second segment is not said again', () => {
    const record = built('relinked-by-the-genesis-founder', RELINK_IN_A_SECOND_SEGMENT);
    expect(readdirSync(join(record, 'tails', tailOf(record, HOST))).sort()).toContain(
      '000002.jsonl',
    );
    const ran = since(pullRequest('whole', record, [GENESIS_OF_Y, RELINKED, HOST]));
    expect(ran.status, `${ran.out}\n${ran.err}`).toBe(0);
    expect(ran.out).toContain('relinked into this record by its own key at tail');
    expect(relinkedLines(ran.out)).toEqual([]);
  });

  it.each([
    ['relink-uncovered', 'above its host’s last checkpoint'],
    ['relinked-by-a-key-that-founded-itself-here', 'by a key that founded itself in the record'],
  ])('still refuses the tail as another record where the relink does not count: %s (%s)', (name) => {
    const record = built(name);
    const relinked = tailOf(record, RELINKED);
    const ran = since(pullRequest(name, record, [GENESIS_OF_Y]));
    expect(ran.status, ran.out).toBe(1);
    const said = ran.err.split('\n').find((line) => line.includes('arrived since'));
    expect(said).toContain(`tail ${relinked} arrived since and names record`);
    expect(said).toContain('(another-record)');
    expect(relinkedLines(ran.out)).toEqual([]);
  });
});
