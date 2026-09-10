/**
 * What the DEFAULT of `mnema verify` does not catch, and what `--require=signed` does.
 *
 * WHERE THIS COMES FROM. `packages/code/README.md` promised that `verify` "exits
 * non-zero when the record is broken", and a reader takes that as a promise about
 * forgery. Measured against the built binary in an isolated sandbox: a record whose
 * fact was rewritten, whose hash links were RECOMPUTED with this product's own
 * `entryHash`, and whose `checkpoints.jsonl` was emptied, exits **0** — and `search`
 * serves the forged fact. Nothing is broken there, which is the point: the chain is
 * internally consistent and the signatures that would have contradicted it are gone.
 *
 * AND THE SAME MEASUREMENT KILLED A SECOND SENTENCE. `--require=signed` was glossed in
 * the help as *expect this to fail while a session is in flight*. It fails in no state
 * this product reaches: every path that writes seals a checkpoint, so the residual that
 * sentence rested on is empty whenever nothing is mid-write. What it DOES fail on is
 * the forgery above — so one record, read at two declared minimums, is where both
 * sentences are settled, and that is why the two live in one file.
 *
 * WHY THE CRUDE EDIT IS HERE. Case 1 asserts an exit of **0**, and an exit of 0 is what
 * a product that never fails at all would also give. The `sed`-style edit — the same
 * fact rewritten, the hash links left alone — is the contrast that makes it a finding
 * about the ATTACK and not about the gate being dead: it exits 1, through the same
 * verb, over the same record, differing only in whether the attacker rehashed.
 *
 * WHAT IT DOES NOT CLAIM. `--require=signed` catches one of three ways to forge this
 * record; the other two (removing a whole tail, or writing a fact after the edit) go
 * green at every value of `--require`, and `README.md` states that beside the promise.
 * Nothing here is a case for them — they are named so this file is not read as proving
 * more than it does.
 *
 * The fixture is built by the PRODUCT — `mnema init`, `mnema task` — and then edited on
 * disk the way an adversary would. Nothing writes an event by hand.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { entryHash, listTails, orderedSegments } from '@mnema/chain';
import { resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** What one invocation said on each channel, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string;
  readonly err: string;
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

/** Runs one verb the way the binary does, and reads both channels. */
async function mnema(...argv: readonly string[]): Promise<Said> {
  const c = capture();
  await run([...argv], c.io);
  return { out: c.out.join('\n'), err: c.err.join('\n'), failed: c.failed() };
}

/** The one tail's only segment file, and the checkpoints beside it. */
function storedFiles(): { segment: string; checkpoints: string } {
  const root = resolveTrees(repo, {
    xdgDataHome: join(sandbox, 'data'),
    home: join(sandbox, 'home'),
  }).projectPublic as string;
  const tail = listTails({ root })[0] as string;
  const segment = orderedSegments({ root }, tail)[0] as string;
  return { segment, checkpoints: join(dirname(segment), 'checkpoints.jsonl') };
}

/** The stored lines of a file, without the empty tail element. */
function lines(file: string): string[] {
  return readFileSync(file, 'utf-8').split('\n').filter(Boolean);
}

/**
 * Rewrites `needle` to `replacement` in every stored event of the one tail.
 *
 * `rehash` is the whole discriminant of this file. With it, the T1 chain is rebuilt
 * with the product's own `entryHash` — the attacker who knows how the format works —
 * and every link recomputes to what it claims. Without it, the stored hash still
 * commits to the bytes that were there, which is the `sed` a verifier catches.
 */
function rewriteFact(needle: string, replacement: string, opts: { rehash: boolean }): number {
  const { segment } = storedFiles();
  const out: string[] = [];
  let prev: string | null = null;
  let touched = 0;
  for (const raw of lines(segment)) {
    const entry = JSON.parse(raw) as {
      event: unknown;
      link: { tail: string; seq: number; prev: string | null; hash: string };
    };
    const before = JSON.stringify(entry.event);
    const after = before.split(needle).join(replacement);
    if (before !== after) touched += 1;
    entry.event = JSON.parse(after);
    if (opts.rehash) {
      entry.link.prev = prev;
      // The written form is the canonical value the line carries — see chain/hash.ts.
      entry.link.hash = entryHash({
        event: { value: entry.event } as Parameters<typeof entryHash>[0]['event'],
        tail: entry.link.tail,
        seq: entry.link.seq,
        prev,
      });
    }
    prev = entry.link.hash;
    out.push(JSON.stringify(entry));
  }
  writeFileSync(segment, `${out.join('\n')}\n`, 'utf-8');
  return touched;
}

/** Founds a project and records one task carrying `title` — signed as it is written. */
async function record(title: string): Promise<void> {
  const founded = await mnema('init');
  if (founded.failed) throw new Error(`setup: init failed: ${founded.err}`);
  const written = await mnema('task', title);
  if (written.failed) throw new Error(`setup: task failed: ${written.err}`);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-strict-gate-'));
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

describe('the forged record — the one the README used to promise a non-zero exit on', () => {
  it('1 — rehashed and stripped of its checkpoints: the DEFAULT exits 0 and search serves it', async () => {
    await record('the fact as it was written');
    expect(rewriteFact('as it was written', 'as somebody rewrote it', { rehash: true })).toBe(1);
    writeFileSync(storedFiles().checkpoints, '', 'utf-8');

    const said = await mnema('verify');
    // The honest limit, asserted as the VALUE the exit code carries and not as prose:
    // this is what a stranger's CI step gets over a record that was tampered with.
    expect(said.failed).toBe(false);
    expect(said.out).toContain('local integrity verified (T1 only) — no signature was checked');

    // And the reader downstream serves the forgery without a word — which is why the
    // exit code above is the whole of what a CI step learns.
    const found = await mnema('search', 'as somebody rewrote it');
    expect(found.failed).toBe(false);
    expect(found.out).toContain('as somebody rewrote it');
    // Non-vacuity: the original wording is gone, so the match above is the forged
    // fact and not the record still holding both.
    expect(found.out).not.toContain('as it was written');
  });

  it('2 — the same record under --require=signed: exits 1, and names what it wanted', async () => {
    // THE PROMISE THE README NOW MAKES, over the same bytes as case 1. Only the
    // declared minimum differs, which is what makes this a fact about the gate.
    await record('the fact as it was written');
    rewriteFact('as it was written', 'as somebody rewrote it', { rehash: true });
    writeFileSync(storedFiles().checkpoints, '', 'utf-8');

    const gated = await mnema('verify', '--require=signed');
    expect(gated.failed).toBe(true);
    expect(gated.err).toContain('requirement not met: --require=signed needs fully-signed');
    expect(gated.err).toContain('this record is hash-chain-only');
  });

  it('3 — the CONTRAST: the same edit WITHOUT the rehash is caught by the default', async () => {
    // Without this case, case 1 would pass over a `verify` that never fails at all.
    // The attacker's rehash is the only difference between the two records.
    await record('the fact as it was written');
    expect(rewriteFact('as it was written', 'as somebody rewrote it', { rehash: false })).toBe(1);
    writeFileSync(storedFiles().checkpoints, '', 'utf-8');

    const said = await mnema('verify');
    expect(said.failed).toBe(true);
    expect(said.out).toContain('local integrity FAILED');
    expect(said.err).toContain('entry hash mismatch: content or link was altered');
  });
});

describe('the strict gate in the state the help said it would fail in', () => {
  it('passes with a run OPEN and a fact pinned to it — the premise that was false', async () => {
    // The help read *expect this to fail while a session is in flight*, so this is the
    // state it named, built through the product: a run open, and a fact written INTO
    // it. Every write seals a checkpoint, so the residual the sentence rested on is
    // never there. Asserted as an exit code, because the sentence is not what was
    // wrong — the behaviour it described never existed.
    await record('a fact written before the run');
    const started = await mnema('run', 'start', '--which', 'a-person-at-a-terminal');
    expect(started.failed, started.err).toBe(false);
    const opened = /^Started run ([0-9a-f-]{36})$/m.exec(started.out)?.[1] as string;
    expect(opened).toBeDefined();
    // What the printed export line does in a shell, done here.
    process.env.MNEMA_RUN = opened;

    const inFlight = await mnema('task', 'a fact written inside the open run');
    expect(inFlight.failed, inFlight.err).toBe(false);

    const gated = await mnema('verify', '--require=signed');
    expect(gated.failed).toBe(false);
    expect(gated.err).toBe('');
    // Non-vacuity, both halves. The gate really did rule on a record with coverage to
    // check — a verdict over an empty tree would pass too — and the run really was
    // still open at the moment it ruled, which `run end` is what can say: it names the
    // run it closed, and it has nothing to close unless one was open.
    expect(gated.out).toContain('all events are signature-covered');
    const ended = await mnema('run', 'end', '--which', 'a-person-at-a-terminal');
    expect(ended.failed, ended.err).toBe(false);
    expect(ended.out).toContain(`Ended run ${opened}`);
  });
});
