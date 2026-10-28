/**
 * `FORMAT.md` §4 LISTS EVERY ENTRY A REAL WRITER LEAVES AT THE ROOT OF A TREE.
 *
 * The layout in §4 said what a reader enumerates (`keys/` and `tails/`) and listed the files beside
 * them that are not part of the proof, but it did not list `locks/`, which the writer creates on
 * the first append (the lock of each tail, the note of which heads a tail last cited, and the
 * projection a reader keeps) and which the tree's own `.gitignore` leaves out. A person who diffs
 * a tree against the document found a directory the document never named.
 *
 * WHAT IS HELD, over the real binary: a repository is founded, written to and read, and every
 * entry at the root of the tree it left, and every entry of `locks/`, is named by the listing of
 * §4. A root entry the writer starts to leave without a line there is red.
 *
 * NOT HELD: that each line says the right thing about its entry beyond naming it as "not part of
 * the proof" where it is not; the second reader's own cases hold what a reader reads
 * (`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { read } from './support/published-examples.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const FORMAT = 'packages/chain/FORMAT.md';

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-format-root-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function run(command: string, argv: readonly string[]): void {
  const ran = spawnSync(command, [...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  expect(ran.status, `${command} ${argv.join(' ')}: ${ran.stderr}`).toBe(0);
}

const mnema = (...argv: string[]): void => run(process.execPath, [CLI, ...argv]);

/** The lines of the §4 listing, that is, the fenced block whose lines begin with `<record>/`. */
function theListingOf(format: string): string[] {
  const lines = format.split('\n').filter((line) => line.startsWith('<record>/'));
  if (lines.length === 0) throw new Error(`${FORMAT} has no listing of the layout`);
  return lines;
}

/** The entry a listing line names at the root: `<record>/locks/` is `locks`, `<record>/keys/x.pub` is `keys`. */
function theRootEntryOf(line: string): string {
  return (line.slice('<record>/'.length).split(/\s/)[0] ?? '').split('/')[0] ?? '';
}

/** A tree founded, written to and read, as a person's repository comes to be. */
function aTreeThatWasWrittenAndRead(): string {
  run('git', ['init', '-q']);
  mnema('init');
  mnema('task', 'create', 'leave what a writer leaves');
  mnema('decision', 'record', 'Name every entry', 'a reader should find each one in the document');
  mnema('verify');
  mnema('search', 'entry');
  return join(repo, '.mnema');
}

describe('the layout of FORMAT §4', () => {
  it('names every entry a writer leaves at the root of a tree it wrote to and read', () => {
    const tree = aTreeThatWasWrittenAndRead();
    const listed = new Set(theListingOf(read(FORMAT)).map(theRootEntryOf));
    const left = readdirSync(tree);
    // NON-VACUITY: the tree has the entries the document is about, and the one it forgot.
    expect(left).toEqual(expect.arrayContaining(['keys', 'tails', 'locks', '.gitignore']));
    for (const entry of left) {
      expect(listed.has(entry), `the root entry ${entry} has no line in §4`).toBe(true);
    }
  });

  it('names what is inside locks/, and says it is not part of the proof', () => {
    const tree = aTreeThatWasWrittenAndRead();
    const line = theListingOf(read(FORMAT)).find((one) => theRootEntryOf(one) === 'locks');
    expect(line, 'no line for locks/').toBeDefined();
    expect(line).toContain('not part of the proof');
    for (const entry of readdirSync(join(tree, 'locks'))) {
      // The file SQLite keeps beside the projection is named by the projection it belongs to.
      const stem = entry.replace(/-(?:wal|shm|journal)$/, '');
      const kind = stem === 'projection.db' ? 'projection.db' : stem.slice(stem.lastIndexOf('.'));
      expect(line, `locks/${entry}: the line for locks/ does not name ${kind}`).toContain(kind);
    }
    // The three things the line promises exist under this name in the writer.
    for (const named of ['.lock', '.cited', 'projection.db']) expect(line).toContain(named);
  });

  it('reads the listing off the document and is not satisfied by an empty one', () => {
    // The ruler: the root entry of a line is its first component, and a document without the
    // listing is an error, not an empty list that every tree is "named" by.
    expect(theRootEntryOf('<record>/locks/   the locks')).toBe('locks');
    expect(theRootEntryOf('<record>/keys/<fingerprint>.pub   the public keys')).toBe('keys');
    expect(theRootEntryOf('<record>/.gitignore    what git leaves out')).toBe('.gitignore');
    expect(() => theListingOf('no listing here')).toThrow(/no listing/);
  });
});
