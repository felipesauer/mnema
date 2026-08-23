/**
 * What `mnema verify` SAYS, and what it EXITS, over a record somebody edited.
 *
 * Six probes were run against the shipped binary in a sandbox before any of this
 * was written, and they are the requirement of this file rather than an
 * illustration. Five of the six are reproduced here; the sixth is the baseline.
 * The one that mattered: two events deleted and the signatures deleted with them —
 * `search` then showed one task where there had been two — and the product
 * answered `local integrity verified (T1/T2/T4)`, exit 0.
 *
 * Both channels of the verdict are asserted on every case, because the defect was
 * in both. The SENTENCE is what a person reads; the EXIT CODE is what a CI step, a
 * git hook or a script reads, and "serving every reader" includes the reader that
 * never sees a sentence. They are derived from one value now (see level.ts), and
 * these cases are what proves they cannot come apart.
 *
 * THE CASE THIS FILE EXISTS TO PROTECT is `FAILED`. A sentence that qualifies can
 * become a sentence that EXCUSES, and if a real break were softened to "no
 * signature was checked" because there happened to be no coverage, this change
 * would have made the product worse at exactly what its defence already gets
 * right. Two truncations are here for that reason: one where earlier checkpoints
 * still verify, and one deep enough that NONE of them do — the second is the one
 * that discriminates, and the shallow one alone does not (measured: the mutation
 * that reorders the derivation leaves the shallow case green).
 *
 * Every fixture is built by the PRODUCT — `mnema init`, `mnema task` — and then
 * edited on disk the way an adversary would. Nothing writes an event by hand.
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
  return { summary: c.out.join('\n'), issues: c.err, failed: c.failed() };
}

/** The public tree of the project in the sandbox. */
function chainRoot(): string {
  return resolveTrees(repo, {
    xdgDataHome: join(sandbox, 'data'),
    home: join(sandbox, 'home'),
  }).projectPublic as string;
}

/** The one tail's only segment file, and the checkpoints beside it. */
function storedFiles(): { segment: string; checkpoints: string } {
  const root = chainRoot();
  const tail = listTails({ root })[0] as string;
  const segments = orderedSegments({ root }, tail);
  const segment = segments[0] as string;
  return { segment, checkpoints: join(dirname(segment), 'checkpoints.jsonl') };
}

/** The stored lines of a file, without the empty tail element. */
function lines(file: string): string[] {
  return readFileSync(file, 'utf-8').split('\n').filter(Boolean);
}

/** Founds a project and records `count` tasks through the CLI — each one signed. */
async function record(count: number): Promise<void> {
  await run(['init'], capture().io);
  for (let i = 0; i < count; i += 1) {
    const c = capture();
    await run(['task', `task number ${i}`], c.io);
    if (c.failed()) throw new Error(`setup: task ${i} failed: ${c.err.join(' / ')}`);
  }
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-verdict-'));
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

describe('the six probes, as the verdict answers them now', () => {
  it('A — a record whose every event is signed: verified (T1/T2/T4), exit 0', async () => {
    // The wording that must NOT change. A reader learned this line; the whole point
    // of naming levels is that the fully proven record keeps saying what it said.
    await record(3);
    const said = await verify();
    expect(said.summary).toContain('local integrity verified (T1/T2/T4);');
    expect(said.summary).toContain('all events are signature-covered');
    expect(said.summary).not.toContain('T1 only');
    expect(said.issues).toEqual([]);
    expect(said.failed).toBe(false);
  });

  it('B — the signatures deleted: T1 only, and it says NO signature was checked', async () => {
    // Measured before: `verified (T1/T2/T4)` beside `6 event(s) … NOT yet
    // signature-covered` — two claims about one chain, contradicting each other on
    // one line, and exit 0. The first clause is the level now, and the second stops
    // presupposing a last checkpoint that is not there.
    await record(3);
    const { checkpoints } = storedFiles();
    writeFileSync(checkpoints, '', 'utf-8');

    const said = await verify();
    expect(said.summary).toContain('local integrity verified (T1 only) — no signature was checked');
    expect(said.summary).toMatch(/\d+ event\(s\) are hash-chained but NOT yet signature-covered/);
    expect(said.summary).not.toContain('above the last checkpoint');
    // Exit stays 0 by default — nothing verifiable is broken, and a project between
    // its first event and its first checkpoint is a legitimate state.
    expect(said.failed).toBe(false);
    // A caller that needs signatures says so, and gets a non-zero exit for it.
    const gated = await verify('--require=signed');
    expect(gated.failed).toBe(true);
    expect(gated.issues.join('\n')).toContain('requirement not met: --require=signed');
    expect(gated.issues.join('\n')).toContain('this record is hash-chain-only');
  });

  it('C — a fragment at the END of the tail: reported as an ambiguity, still ok', async () => {
    // The silent one. A complete append ends in a newline, so an unterminated final
    // line is what a crash leaves — the read drops it and keeps going, which is
    // right. Doing that WITHOUT a word made it indistinguishable from an appended
    // fragment, and the doctrine is to report what could not be checked.
    await record(3);
    const { segment } = storedFiles();
    writeFileSync(segment, `${readFileSync(segment, 'utf-8')}{"event":{"kind":"task.cre`, 'utf-8');

    const said = await verify();
    expect(said.summary).toContain('1 tail(s) ending in a dropped partial line');
    expect(said.summary).toContain('informational, not a break');
    // Still a pass: the ambiguity is a note, not a break, so `ok` and the exit hold.
    expect(said.summary).toContain('local integrity verified (T1/T2/T4);');
    expect(said.failed).toBe(false);
  });

  it('C2 — the same garbage TERMINATED by a newline is UNREADABLE, not a note', async () => {
    // The distinction is the newline, and it is the whole tolerance: a terminated
    // line was written completely, so it is not a torn write and gets no pardon.
    await record(3);
    const { segment } = storedFiles();
    writeFileSync(
      segment,
      `${readFileSync(segment, 'utf-8')}{"event":{"kind":"task.cre\n`,
      'utf-8',
    );

    const said = await verify();
    expect(said.summary).toContain('local integrity FAILED — part of the record is UNREADABLE');
    expect(said.failed).toBe(true);
  });

  it('D — a corrupted line in the MIDDLE: a verdict with the position, not a parser message', async () => {
    // Measured before: `not valid JSON: Unexpected end of JSON input`, exit 1.
    // Right in the exit code and not a finding — no tail, no line, no word for
    // "unreadable", and `issues` empty because nothing returned at all.
    await record(3);
    const { segment } = storedFiles();
    const stored = lines(segment);
    stored[1] = '{garbage not json';
    writeFileSync(segment, `${stored.join('\n')}\n`, 'utf-8');

    const said = await verify();
    expect(said.summary).toContain('local integrity FAILED — part of the record is UNREADABLE');
    expect(said.summary).toContain('the event count is INCOMPLETE');
    expect(said.failed).toBe(true);
    // The evidence names the tail, the file INSIDE the chain, and the line.
    const evidence = said.issues.join('\n');
    expect(evidence).toContain('issue [T1]');
    expect(evidence).toContain('UNREADABLE: tails/');
    expect(evidence).toContain('line 2');
    expect(evidence).toContain('not valid JSON');
    // And it never prints `#undefined` where a finding has no seq to give.
    expect(evidence).not.toContain('#undefined');
  });

  it('E — a truncated tail with its checkpoints intact: still FAILED, exit 1', async () => {
    // THE CASE THAT MUST NOT SOFTEN. The defence works here — the checkpoint covers
    // a range that no longer exists — and this change is not allowed to trade that
    // for a nicer sentence.
    await record(3);
    const { segment } = storedFiles();
    const stored = lines(segment);
    writeFileSync(segment, `${stored.slice(0, -2).join('\n')}\n`, 'utf-8');

    const said = await verify();
    expect(said.summary).toContain('local integrity FAILED — see issues');
    expect(said.summary).not.toContain('T1 only');
    expect(said.failed).toBe(true);
    expect(said.issues.join('\n')).toContain('issue [T2/T4]');
    expect(said.issues.join('\n')).toContain('checkpoint failed');
  });

  it('E2 — a truncation deep enough that NO checkpoint verifies: still FAILED, exit 1', async () => {
    // The discriminating one. In E the earlier checkpoints still verify, so a
    // derivation that asked "was any signature checked?" BEFORE "is anything
    // broken?" would still answer `broken` there and look correct. Cut the tail back
    // to its first event and every checkpoint fails: no signature was checked AND
    // there is a break, which is the pair that the wrong order excuses.
    await record(3);
    const { segment } = storedFiles();
    writeFileSync(segment, `${lines(segment)[0] as string}\n`, 'utf-8');

    const said = await verify();
    expect(said.summary).toContain('local integrity FAILED');
    expect(said.summary).not.toContain('verified');
    expect(said.failed).toBe(true);
  });

  it('F — truncated AND the signatures deleted: no longer says verified (T1/T2/T4)', async () => {
    // The probe that is the product failing at its central claim. Two events gone,
    // the signatures that covered them gone, the record reading clean — and it said
    // `local integrity verified (T1/T2/T4)`, exit 0. It cannot say that any more:
    // nothing here was checked beyond the hash chain, and the sentence says so.
    await record(3);
    const { segment, checkpoints } = storedFiles();
    writeFileSync(segment, `${lines(segment).slice(0, -2).join('\n')}\n`, 'utf-8');
    writeFileSync(checkpoints, '', 'utf-8');

    const said = await verify();
    expect(said.summary).not.toContain('verified (T1/T2/T4)');
    expect(said.summary).toContain('local integrity verified (T1 only) — no signature was checked');
    // The honest residual: the default exit stays 0 (there is no break to point at —
    // that is the gap an external witness closes), and the caller who cannot live
    // with that says `--require=signed` and gets a non-zero exit.
    expect(said.failed).toBe(false);
    expect((await verify('--require=signed')).failed).toBe(true);
  });
});

describe('the caller declares the minimum — `--require`', () => {
  it('reaches the verdict: the same record passes by default and fails under --require=signed', async () => {
    // The flag's own wire test. A residual is made the way a truncation makes one —
    // the last checkpoint dropped — so events the record holds are no longer covered
    // while the earlier signatures still verify.
    await record(3);
    const { checkpoints } = storedFiles();
    const stored = lines(checkpoints);
    expect(stored.length).toBeGreaterThan(1);
    writeFileSync(checkpoints, `${stored.slice(0, -1).join('\n')}\n`, 'utf-8');

    const said = await verify();
    expect(said.summary).toContain('local integrity verified (T1/T2/T4) up to the last checkpoint');
    expect(said.summary).toMatch(/event\(s\) above the last checkpoint/);
    expect(said.failed).toBe(false);

    const gated = await verify('--require=signed');
    // Same record, same sentence — only the minimum the caller declared differs.
    expect(gated.summary).toBe(said.summary);
    expect(gated.failed).toBe(true);
    expect(gated.issues.join('\n')).toContain(
      'requirement not met: --require=signed needs fully-signed, ' +
        'this record is signed-through-last-checkpoint',
    );
  });

  it('exits zero under --require=signed when every event really is signed', async () => {
    await record(2);
    const said = await verify('--require=signed');
    expect(said.failed).toBe(false);
    expect(said.issues).toEqual([]);
  });

  it('fails --require=witnessed on a record nobody stamped, and says which layer is missing', async () => {
    // THIS CASE USED TO SAY *NEVER PASSES*, and that was true for as long as nothing
    // could produce an attestation. `mnema witness` can now, so what is pinned is the
    // half that governs every record that has not been stamped — which is all of them
    // until somebody runs the verb — and the words are unchanged down to the byte before
    // the dash.
    await record(2);
    const said = await verify('--require=witnessed');
    expect(said.failed).toBe(true);
    expect(said.issues.join('\n')).toContain('needs externally-witnessed');
    expect(said.summary).toContain('external witness (T3): not covered');
  });

  it('refuses a --require nobody defined, naming the ones that exist', async () => {
    await record(1);
    const said = await verify('--require=probably-fine');
    expect(said.failed).toBe(true);
    expect(said.issues.join('\n')).toContain(
      'Invalid --require "probably-fine". Use one of: chained, signed, witnessed.',
    );
    // It answered nothing about the record: a minimum nobody defined is a usage
    // error, not a verdict.
    expect(said.summary).toBe('');
  });

  it('leaves the DEFAULT exit exactly where it was on a healthy record', async () => {
    // The half of the decision that is about not breaking anything: the bare
    // invocation fails on a break and on nothing else.
    await record(2);
    expect((await verify()).failed).toBe(false);
    expect((await verify('--require=chained')).failed).toBe(false);
  });
});
