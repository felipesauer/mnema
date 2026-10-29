/**
 * A TAIL IS NOT FORKED (ADR-123), over real git: the cases the probe of 29 October ran on the
 * binary of 0.1.4, each turned into a case here.
 *
 * A tail's files are committed and its installation id is not (`keys/<fp>.inst`, ignored by the
 * tree's `.gitignore`), so two checkouts never share a tail. ONE checkout switched between two
 * branches, and a checkout whose id was copied from another, did: the writer appended to
 * whatever end the branch left, git conflicted on the segment and on the checkpoints, and a
 * merge that kept both sides was refused by both readers as a `seq gap` with no word for what
 * had happened.
 *
 * Two halves, and each case below fails with its half taken out:
 *
 *   - THE WRITER keeps the last entry it wrote to its tail (`kept-head.ts`, in `locks/`, which
 *     git does not see) and opens a new tail when the tail no longer ends there, or holds
 *     entries it has no note of writing. The git switch and the copied id then merge clean.
 *   - THE READERS name a fork that still happens (a `cp -a` of the checkout carries the note
 *     too, so the writer cannot see it): both say `fork`, at the seq two different entries
 *     hold, and both still refuse the record.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, memoryCaptured } from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';
import { keptHeadPath, readKeptHead } from './kept-head.js';
import { installationIdPath } from './layout.js';
import { listTails } from './store.js';
import { ensureTree } from './tree.js';
import type { NewTail } from './writer.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const GIT_WITHOUT_MAINTENANCE = fileURLToPath(
  new URL('../../../code/tests/support/without-maintenance.gitconfig', import.meta.url),
);

let sandbox: string;
let keyRoot: string;
let told: NewTail[];

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-not-forked-'));
  keyRoot = join(sandbox, 'home', 'keys');
  told = [];
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `git <args>` in `repo`, isolated from the machine's configuration. */
function git(repo: string, ...args: string[]) {
  return spawnSync(
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
      cwd: repo,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git-home'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
}

/** `git <args>` that has to succeed: setup, not the thing measured. */
function must(repo: string, ...args: string[]): string {
  const ran = git(repo, ...args);
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout;
}

const recordOf = (repo: string): string => join(repo, '.mnema');

/** A repository whose record holds a founding, committed on `main`. Returns its tail. */
function foundedRepository(repo: string): string {
  mkdirSync(repo, { recursive: true });
  must(repo, 'init', '-q');
  const root = recordOf(repo);
  ensureTree({ root });
  const w = openChainForWriting(root, { keyRoot });
  w.append(
    identityFounded(
      { at: new Date().toISOString(), who: w.anchor, signerFp: w.signerFingerprint, subject: w.anchor },
      { foundingFp: w.signerFingerprint },
    ),
  );
  w.checkpoint();
  commit(repo, 'founded');
  return w.tail;
}

/** One act, as the product writes one: a writer opened for it, an append, a checkpoint. */
function write(repo: string, content: string): string {
  const w = openChainForWriting(recordOf(repo), {
    keyRoot,
    onNewTail: (opened) => told.push(opened),
  });
  w.append(
    memoryCaptured(
      { at: new Date().toISOString(), who: w.anchor, signerFp: w.signerFingerprint, subject: content },
      { content },
    ),
  );
  w.checkpoint();
  return w.tail;
}

function commit(repo: string, message: string): void {
  must(repo, 'add', '.mnema');
  must(repo, 'commit', '-q', '-m', message);
}

/** The second reader's verdict over a record, and its refusals. */
function secondReading(record: string) {
  const run = spawnSync('python3', ['-I', VERIFIER, '--json', 'record', record], {
    encoding: 'utf-8',
  });
  if (run.stdout === '') throw new Error(`the second reader produced no verdict: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout) as {
    verdict: string;
    findings: { level: string; section: string; what: string }[];
  };
  return {
    verdict: parsed.verdict,
    exit: run.status,
    refusals: parsed.findings.filter((finding) => finding.level === 'FAIL'),
  };
}

/** Resolves every conflicted file by keeping both sides: the marker lines go, the lines stay. */
function resolveByUnion(repo: string): void {
  const conflicted = must(repo, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
  expect(conflicted.length).toBeGreaterThan(0);
  for (const file of conflicted) {
    const path = join(repo, file);
    const kept = readFileSync(path, 'utf-8')
      .split('\n')
      .filter((line) => !/^(<<<<<<< |=======$|>>>>>>> )/.test(line));
    writeFileSync(path, kept.join('\n'));
  }
  commit(repo, 'merged by keeping both sides');
}

describe('one checkout written on two branches', () => {
  it('writes the second branch to a new tail, says so, and the merge is clean and verifies', () => {
    const a = join(sandbox, 'a');
    const tail = foundedRepository(a);

    must(a, 'switch', '-q', '-c', 'bx');
    expect(write(a, 'from x')).toBe(tail);
    commit(a, 'x');

    // Back to where both branches start: the tail ends one entry before the one written last.
    must(a, 'switch', '-q', '-c', 'by', 'main');
    const second = write(a, 'from y');
    expect(second).not.toBe(tail);
    expect(told).toEqual([
      { from: tail, to: second, kept: { seq: 1, hash: expect.any(String) }, found: { seq: 0, hash: expect.any(String) } },
    ]);
    commit(a, 'y');

    expect(git(a, 'merge', '-q', '--no-edit', 'bx').status).toBe(0);
    const merged = verify(recordOf(a));
    expect(merged.issues).toEqual([]);
    expect(merged.tails.map((t) => t.tail).sort()).toEqual([tail, second].sort());
    expect(secondReading(recordOf(a)).verdict).toBe('VERIFIED');
  });

  it('goes on writing the new tail after the merge, and says nothing more', () => {
    const a = join(sandbox, 'a');
    foundedRepository(a);
    must(a, 'switch', '-q', '-c', 'bx');
    write(a, 'from x');
    commit(a, 'x');
    must(a, 'switch', '-q', '-c', 'by', 'main');
    const second = write(a, 'from y');
    commit(a, 'y');
    must(a, 'merge', '-q', '--no-edit', 'bx');

    expect(write(a, 'after the merge')).toBe(second);
    expect(told).toHaveLength(1);
    expect(verify(recordOf(a)).issues).toEqual([]);
  });
});

describe('an installation id copied into another checkout', () => {
  it('writes the copy to a new tail, since it has no note of writing the one the id names', () => {
    const a = join(sandbox, 'a');
    const tail = foundedRepository(a);
    const b = join(sandbox, 'b');
    must(sandbox, 'clone', '-q', a, b);
    const [fingerprint] = tail.split('-');
    copyFileSync(
      installationIdPath({ root: recordOf(a) }, fingerprint as string),
      installationIdPath({ root: recordOf(b) }, fingerprint as string),
    );

    must(b, 'switch', '-q', '-c', 'by');
    const copy = write(b, 'from the copy');
    expect(copy).not.toBe(tail);
    expect(told.map((opened) => [opened.from, opened.kept])).toEqual([[tail, undefined]]);
    commit(b, 'y');

    must(a, 'switch', '-q', '-c', 'bx');
    expect(write(a, 'from a')).toBe(tail);
    commit(a, 'x');

    must(a, 'fetch', '-q', b, 'by');
    expect(git(a, 'merge', '-q', '--no-edit', 'FETCH_HEAD').status).toBe(0);
    expect(verify(recordOf(a)).issues).toEqual([]);
    expect(secondReading(recordOf(a)).verdict).toBe('VERIFIED');
  });
});

describe('a checkout copied whole, note and all', () => {
  /** `a` and its `cp -a` each write one entry on its own branch, and `a` merges the copy. */
  function forkedByACopy(): { a: string; tail: string } {
    const a = join(sandbox, 'a');
    const tail = foundedRepository(a);
    const c = join(sandbox, 'c');
    cpSync(a, c, { recursive: true });

    must(a, 'switch', '-q', '-c', 'bx');
    expect(write(a, 'from a')).toBe(tail);
    commit(a, 'x');
    // The copy carries the installation id AND the note of the last entry: its writer cannot
    // tell it is not the checkout that wrote it, which is why the readers have to say it.
    must(c, 'switch', '-q', '-c', 'by');
    expect(write(c, 'from the copy')).toBe(tail);
    commit(c, 'y');
    expect(told).toEqual([]);

    must(a, 'fetch', '-q', c, 'by');
    expect(git(a, 'merge', '-q', '--no-edit', 'FETCH_HEAD').status).not.toBe(0);
    resolveByUnion(a);
    return { a, tail };
  }

  it('is refused by the product, which names a fork at the seq two entries hold', () => {
    const { a, tail } = forkedByACopy();
    const verdict = verify(recordOf(a));
    expect(verdict.ok).toBe(false);
    const chain = verdict.issues.filter((issue) => issue.layer === 'T1');
    expect(chain).toEqual([
      {
        tail,
        layer: 'T1',
        seq: 1,
        detail:
          'fork: two different entries hold seq 1 and follow the same entry: the tail was written ' +
          'from one head in two places (a copied checkout, a restored backup) and the two were joined',
      },
    ]);
  });

  it('is refused by the second reader, which names the same fork in section 3', () => {
    const { a } = forkedByACopy();
    const second = secondReading(recordOf(a));
    expect(second.verdict).toBe('REFUSED');
    expect(second.exit).toBe(1);
    const chain = second.refusals.filter((finding) => finding.section === '3');
    expect(chain.map((finding) => finding.what)).toEqual([
      'a fork in the sequence: two different lines hold seq 1 and follow the same line, so the ' +
        'tail was written from one head in two places and the two were joined',
    ]);
  });

  it('is not appended to by the checkout whose entry is not the end: it opens a new tail', () => {
    const { a, tail } = forkedByACopy();
    // Kept both sides, ours first: the tail ends with the copy's entry, not with `a`'s.
    const after = write(a, 'after the merge');
    expect(after).not.toBe(tail);
    expect(told.map((opened) => [opened.from, opened.kept?.seq, opened.found?.seq])).toEqual([
      [tail, 1, 1],
    ]);
  });
});

describe('the note of the last entry', () => {
  it('lives in locks/, which the tree keeps out of git, and names the entry the tail ends with', () => {
    const a = join(sandbox, 'a');
    const tail = foundedRepository(a);
    const root = recordOf(a);
    const [last] = listTails({ root });
    expect(last).toBe(tail);
    expect(readKeptHead({ root }, tail)?.seq).toBe(0);
    expect(git(a, 'check-ignore', '-q', keptHeadPath({ root }, tail)).status).toBe(0);
  });

  it('leaves the founding tail as it is when the note is gone: a tail more, never a fork', () => {
    const a = join(sandbox, 'a');
    const tail = foundedRepository(a);
    rmSync(keptHeadPath({ root: recordOf(a) }, tail));
    const next = write(a, 'no note');
    expect(next).not.toBe(tail);
    expect(verify(recordOf(a)).issues).toEqual([]);
  });
});
