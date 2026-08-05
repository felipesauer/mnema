/**
 * WHICH TREES `mnema verify` covered, said in both channels.
 *
 * A project's record is two trees: the committed one every clone gets, and this
 * machine's private one beside it. The verdict covered the first and said nothing
 * about the second, which held signed facts nobody ever verified — a task, a decision,
 * a skill written `--scope private`. So the sentence read as a verdict over the record
 * while half the record was outside it, and the exit code agreed with the sentence.
 *
 * Every case here is driven through the CLI entry the binary uses, and BOTH channels
 * are asserted: the lines a person reads and the exit a CI step reads. The previous
 * delivery's lesson holds — a verdict that qualifies can become a verdict that
 * EXCUSES — so the cases that must stay red are here beside the ones that must go
 * green.
 *
 * THE CASE THIS FILE EXISTS TO PROTECT is the clone. The private tree is gitignored,
 * so a machine that has just cloned the repository has none. If its absence were a
 * break, `verify` would fail on every fresh clone; if it were a tree verified over
 * nothing, the record's level would drop to "no signature was checked" for that same
 * everyone, and `--require=signed` would fail forever. Both halves are asserted, and
 * the second is the one that discriminates: a note that merely printed differently
 * would still pass the exit assertion.
 *
 * Every fixture is built by the PRODUCT — `mnema init`, `mnema task` — and then edited
 * on disk the way an adversary or a `git clone` would. Nothing writes an event by hand.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listTails, orderedSegments } from '@mnema/chain';
import { resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** What one invocation said, and whether it asked for a non-zero exit. */
interface Said {
  readonly lines: readonly string[];
  readonly summary: string;
  readonly issues: readonly string[];
  readonly failed: boolean;
}

function capture(): { io: CliIo; out: string[]; err: string[]; failed: () => boolean } {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  return {
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    },
    out,
    err,
    failed: () => failed,
  };
}

/** Runs `mnema verify [args]` the way the binary does, and reads both channels. */
async function verify(...args: readonly string[]): Promise<Said> {
  const c = capture();
  await run(['verify', ...args], c.io);
  return { lines: c.out, summary: c.out.join('\n'), issues: c.err, failed: c.failed() };
}

/** The line the report gave one tree of the record. */
function lineFor(said: Said, scope: 'public' | 'private' | 'global'): string | undefined {
  return said.lines.find((line) => line.startsWith(`${scope}: `));
}

/** The trees the project resolves to from the sandbox. */
function trees(): { publicRoot: string; privateRoot: string; globalRoot: string } {
  const resolved = resolveTrees(repo, {
    xdgDataHome: join(sandbox, 'data'),
    home: join(sandbox, 'home'),
  });
  return {
    publicRoot: resolved.projectPublic as string,
    privateRoot: resolved.projectPrivate as string,
    globalRoot: resolved.global,
  };
}

/** The first tail's only segment file in a tree, and the checkpoints beside it. */
function storedFiles(root: string): { segment: string; checkpoints: string } {
  const tail = listTails({ root })[0] as string;
  const segment = orderedSegments({ root }, tail)[0] as string;
  return { segment, checkpoints: join(dirname(segment), 'checkpoints.jsonl') };
}

/** The stored lines of a file, without the empty tail element. */
function lines(file: string): string[] {
  return readFileSync(file, 'utf-8').split('\n').filter(Boolean);
}

/** Founds a project through the CLI. */
async function found(): Promise<void> {
  await run(['init'], capture().io);
}

/** Records one task through the CLI, in the tree `scope` names — each one signed. */
async function record(title: string, ...scope: readonly string[]): Promise<void> {
  const c = capture();
  await run(['task', title, ...scope], c.io);
  if (c.failed()) throw new Error(`setup: "${title}" failed: ${c.err.join(' / ')}`);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-covered-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
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

describe('the record is two trees, and the verdict names both', () => {
  it('covers a fact that lives ONLY in the private tree', async () => {
    // The defect, through the surface. Before this, the whole sentence was about the
    // committed tree; the private tree held a signed task and no verdict mentioned it.
    await found();
    await record('rotate the local credentials', '--scope', 'private');

    const said = await verify();
    expect(lineFor(said, 'public')).toContain('local integrity verified (T1/T2/T4)');
    expect(lineFor(said, 'private')).toContain('local integrity verified (T1/T2/T4)');
    // Not an empty pass over the private tree: its tail was read and its events were
    // covered by a signature that was checked.
    expect(lineFor(said, 'private')).toContain('1 tail(s)');
    expect(lineFor(said, 'private')).toContain('all events are signature-covered');
    expect(said.failed).toBe(false);
  });

  it('names the tree even when BOTH are sound', async () => {
    // Where a report is allowed to go quiet is where a reader learns to assume. Two
    // trees, two lines, whatever the answer is.
    await found();
    await record('write the runbook');
    await record('rotate the local credentials', '--scope', 'private');

    const said = await verify();
    expect(said.lines.filter((line) => /^(public|private): /.test(line))).toHaveLength(2);
    expect(said.failed).toBe(false);
  });

  it('FAILS on a break in the private tree, and says which tree it is in', async () => {
    // The aggregate is the worst tree's. The committed tree is untouched here — a
    // verdict that passed because that half is fine would be worse than no verdict.
    await found();
    await record('write the runbook');
    await record('rotate the local credentials', '--scope', 'private');
    const { segment } = storedFiles(trees().privateRoot);
    const stored = lines(segment);
    const first = JSON.parse(stored[0] as string) as { event: { at: string } };
    first.event.at = '1999-01-01T00:00:00.000Z';
    stored[0] = JSON.stringify(first);
    writeFileSync(segment, `${stored.join('\n')}\n`, 'utf-8');

    const said = await verify();
    expect(lineFor(said, 'private')).toContain('local integrity FAILED');
    // And the committed tree keeps its own verdict: the report does not smear the
    // break across the record, it points at the tree that has it.
    expect(lineFor(said, 'public')).toContain('local integrity verified (T1/T2/T4)');
    expect(lineFor(said, 'public')).not.toContain('FAILED');
    expect(said.failed).toBe(true);
    // The evidence names the tree too, because stderr is read on its own by whatever
    // redirected it.
    const evidence = said.issues.join('\n');
    expect(evidence).toContain('issue [T1] private ');
    expect(evidence).not.toContain('issue [T1] public ');
  });

  it('holds --require=signed over the AGGREGATE, not over the covered tree', async () => {
    // The gate cannot pass on the good half. Every event of the committed tree is
    // signature-covered; the private tree's last checkpoint is dropped, so events it
    // holds are not. Exit 1, and the line says which tree is the weak one.
    await found();
    await record('write the runbook');
    await record('rotate the local credentials', '--scope', 'private');
    await record('archive the old keys', '--scope', 'private');
    const { checkpoints } = storedFiles(trees().privateRoot);
    const stored = lines(checkpoints);
    expect(stored.length).toBeGreaterThan(1);
    writeFileSync(checkpoints, `${stored.slice(0, -1).join('\n')}\n`, 'utf-8');

    const bare = await verify();
    expect(lineFor(bare, 'public')).toContain('all events are signature-covered');
    expect(lineFor(bare, 'private')).toMatch(/event\(s\) above the last checkpoint/);
    // Nothing is broken, so the default minimum still passes — that is the residual
    // the product declares rather than fails on.
    expect(bare.failed).toBe(false);

    const gated = await verify('--require=signed');
    expect(gated.failed).toBe(true);
    expect(gated.issues.join('\n')).toContain(
      'requirement not met: --require=signed needs fully-signed, ' +
        'this record is signed-through-last-checkpoint (private)',
    );
  });
});

describe('a line in the SECOND tree that will not parse', () => {
  it('is a verdict about that tree, not an exception out of the loop', async () => {
    // The verdict stopped being a parser message when it learned to name the tail and
    // the line. Reading a second tree must not undo that: an unreadable line in the
    // private tree has to come back as an issue against `private`, with the committed
    // tree's own verdict still beside it — not as a stack out of the fold.
    await found();
    await record('write the runbook');
    await record('rotate the local credentials', '--scope', 'private');
    await record('archive the old keys', '--scope', 'private');
    const { segment } = storedFiles(trees().privateRoot);
    const stored = lines(segment);
    stored[1] = '{garbage not json';
    writeFileSync(segment, `${stored.join('\n')}\n`, 'utf-8');

    const said = await verify();
    expect(lineFor(said, 'private')).toContain(
      'local integrity FAILED — part of the record is UNREADABLE',
    );
    expect(lineFor(said, 'public')).toContain('local integrity verified (T1/T2/T4)');
    const evidence = said.issues.join('\n');
    expect(evidence).toContain('issue [T1] private ');
    expect(evidence).toContain('UNREADABLE: tails/');
    expect(evidence).toContain('line 2');
    expect(said.failed).toBe(true);
  });
});

describe('a tree with nothing in it', () => {
  it('a fresh CLONE has no private tree: a note, and the verdict is untouched', async () => {
    // THE CASE THAT MUST NOT BREAK. `private/` is gitignored, so it never travels: a
    // clone has the committed tree and nothing else. What is not there is reported as
    // not there, and it moves neither the verdict nor the exit.
    await found();
    await record('write the runbook');
    await record('rotate the local credentials', '--scope', 'private');
    // What `git clone` gives you — the gitignored subtree is simply not in the copy.
    rmSync(trees().privateRoot, { recursive: true, force: true });

    const said = await verify();
    expect(lineFor(said, 'private')).toBe(
      'private: no record here — nothing has been written to this tree on this machine, ' +
        'so there is nothing to rule on',
    );
    // The note claims nothing: no level, no layer, and not the word a pass uses.
    expect(lineFor(said, 'private')).not.toContain('verified');
    expect(lineFor(said, 'private')).not.toContain('FAILED');
    expect(lineFor(said, 'public')).toContain('local integrity verified (T1/T2/T4)');
    expect(said.issues).toEqual([]);
    expect(said.failed).toBe(false);

    // The half that discriminates: the record's level is the committed tree's, so the
    // strictest signature gate a caller can declare still passes on a clone. A tree
    // verified over nothing would have dropped it to `hash-chain-only` and failed here.
    const gated = await verify('--require=signed');
    expect(gated.failed).toBe(false);
    expect(gated.issues).toEqual([]);
  });
});

describe("this machine's global tree — only when asked", () => {
  it('is left out by default and covered by --global, over the same broken record', async () => {
    // The flag's own wire test, and the decision under it: the global tree belongs to
    // no project and is present in every one, so a weakness there must not lower the
    // verdict of a project that never wrote to it. Broken global, sound project.
    await found();
    await record('write the runbook');
    await record('read the release notes', '--scope', 'global');
    const { segment } = storedFiles(trees().globalRoot);
    const stored = lines(segment);
    const first = JSON.parse(stored[0] as string) as { event: { at: string } };
    first.event.at = '1999-01-01T00:00:00.000Z';
    stored[0] = JSON.stringify(first);
    writeFileSync(segment, `${stored.join('\n')}\n`, 'utf-8');

    const quiet = await verify();
    expect(lineFor(quiet, 'global')).toBeUndefined();
    expect(quiet.summary).not.toContain('global');
    expect(quiet.issues).toEqual([]);
    expect(quiet.failed).toBe(false);

    const asked = await verify('--global');
    expect(lineFor(asked, 'global')).toContain('local integrity FAILED');
    expect(lineFor(asked, 'public')).toContain('local integrity verified (T1/T2/T4)');
    expect(asked.issues.join('\n')).toContain('issue [T1] global ');
    expect(asked.failed).toBe(true);
  });
});
