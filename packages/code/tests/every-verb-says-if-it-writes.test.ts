/**
 * Every verb says whether it can change the record — and the record says whether it told
 * the truth.
 *
 * The thing built on this surface next was a session that offers a caller only the verbs
 * that CANNOT write (`mnema repl`), and it had to be default-deny: a write added
 * tomorrow must be refused because nobody classified it, not because somebody
 * remembered. So the classification had to exist, and it was looked for before it was
 * declared. It is not in the code:
 *
 *   - `grep writer` over the adapters names FIFTEEN files, and six of them are reads —
 *     `show`, `timeline`, `resume`, `next-actions`, `brief`, `accountability` — because
 *     the word appears in their PROSE. The usual trap on this bench is a phrase that
 *     under-counts; this one over-counts, which is worse, because the extra names look
 *     like the answer.
 *   - `pinnedRun()` is asked at ELEVEN sites, and `init`, `key` and `run` are not among
 *     them while all three write. It identifies "stamps a session", a different
 *     question, and a list built from it would have handed a read-only session the verb
 *     that founds an identity.
 *
 * So each verb declares it (`wiring/verb.ts`), the type makes the declaration
 * compulsory, and this file is the other half: a declaration nothing checks is a comment
 * with a type annotation.
 *
 * THE GUARD HAS TWO HALVES AND THE SECOND IS THE ONE WITH TEETH.
 *
 *   1. Everything the program routes is classified. The type already forces every member
 *      of the list to answer, so what is left to check is that the LIST is all there is:
 *      a command hung on the program by any other path would be a verb with no
 *      declaration, and a caller reading the declarations would never see it. Checked in
 *      both directions against what commander holds.
 *   2. A verb that claims to read does not write, MEASURED IN THE CHAIN. Every verb is
 *      exercised for real, in its own sandbox, through the same `run` entry the binary
 *      uses; what is counted before and after is the number of events in every tail of
 *      every tree, and the key material on the machine. A read that appends is accused
 *      by the record.
 *
 * WHY EVENTS AND KEYS RATHER THAN A DIGEST OF THE SANDBOX. `guard.test.ts` proves that
 * one verb writes nothing by hashing the whole sandbox, and that is the stronger
 * statement — but it is only available to a verb that opens no cache. Most reads rebuild
 * the projection cache, which writes a file, and a digest would accuse all of them. The
 * question this classification answers is not "does it touch the disk": it is "can this
 * reach the record" — an event in a chain, or the key material an identity is. Those two
 * are counted, and the cache is deliberately not.
 *
 * AND THE EXERCISE IS CHECKED FOR HAVING HAPPENED. A refused invocation writes nothing,
 * so a fixture that quietly stopped producing a valid id would leave every read passing
 * for the wrong reason — the shape that made ten cases of another guard green under
 * mutation. So every exercise must exit zero, and the WRITES are measured too: the count
 * of verbs that appended something is asserted, and the ones that appended nothing are
 * declared one by one with the reason. That is what makes a pass mean the measurement can
 * see a write.
 *
 * WHAT IT DOES NOT COVER, so a pass is not read as more than it is:
 *   - `mcp` is not exercised: it serves a connection for its lifetime and would never
 *     return. It is declared a WRITE from what it serves, and the sandbox says nothing
 *     about it either way.
 *   - `repl` is not exercised either, and this one is on the READ side, which is the
 *     side with the rule. It refuses without a terminal at both ends, so no invocation
 *     from a test process can reach its loop, and a row that ran it would be measuring a
 *     refusal — the shape this file already refuses everywhere else. Its claim to read
 *     is measured in `a-terminal-of-its-own.test.ts` instead, where the session is driven
 *     over a real record and what reached the chain is counted the same way: the
 *     measurement moved, it was not dropped.
 *   - The MCP tools are a second surface with the same rule and are NOT classified here.
 *     There are twenty-three of them (`mcp/server.ts`), they are reached only through a
 *     server this surface's `mcp` verb starts, and that verb is already declared a write —
 *     so a caller reading these declarations refuses the whole server in one, which is
 *     what a read-only session needs. Said out loud because the discriminant finds them
 *     and this file leaves them alone: they are the only other place in the product where
 *     a caller invokes something that may write.
 *   - The declaration is per TOP-LEVEL verb. No group mixes a read with a write today,
 *     and the exercise runs the invocation the table names, not every subcommand — a read
 *     group whose subcommand wrote would need a row of its own here.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import { renderPlain } from '../src/presentation/plain.js';
import { registerVerbs } from '../src/wiring/index.js';
import type { PinnedRun } from '../src/wiring/run-pin.js';
import type { Declared, RecordEffect } from '../src/wiring/verb.js';

// ---------------------------------------------------------------------------
// What the program declares
// ---------------------------------------------------------------------------

/**
 * Every verb's declaration, read off a throwaway program through the SAME function the
 * entry calls.
 *
 * It registers rather than reading the list, because the thing being checked is what a
 * caller can ask about what was REGISTERED: a loop of its own here would be a second
 * implementation of the wiring, and it would agree with itself.
 */
function declared(): readonly Declared[] {
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const pinnedRun: PinnedRun = () => undefined;
  return registerVerbs(new Command(), { io, render: renderPlain, pinnedRun });
}

const DECLARED = declared();

/** What each verb said, by the name commander routes it under. */
const EFFECT_BY_VERB = new Map<string, RecordEffect>(
  DECLARED.map((verb) => [verb.command.name(), verb.effect]),
);

/** The verbs on one side of the classification, in the order they were registered. */
function verbsThat(effect: RecordEffect): string[] {
  return DECLARED.filter((verb) => verb.effect === effect).map((verb) => verb.command.name());
}

// ---------------------------------------------------------------------------
// How each verb is exercised
// ---------------------------------------------------------------------------

/**
 * A verb no invocation can exercise, and why — the marker, so the row still exists.
 *
 * TWO verbs carry it, one on each side of the classification, and the reason is the same
 * shape: both serve the surface for the length of a connection instead of doing a piece
 * of work and returning. `mcp` would never come back; `repl` refuses outright without a
 * terminal at both ends, and this harness has neither. The consequence is stated in this
 * file's doc, because a read that is declared and never measured is exactly the gap this
 * file exists to close, and it is closed for `repl` somewhere else.
 */
const CANNOT_BE_EXERCISED = Symbol('cannot-be-exercised');

/** What the fixture hands an invocation: the values only a founded project can produce. */
interface Fixture {
  /** The identity `init` printed — what `--actor` takes. A `who` is derived, never typed. */
  readonly anchor: string;
  /** A task the fixture created — what the reads that take an id are asked about. */
  readonly task: string;
  /** The backup key `init` created, which `key revoke` retires. Named by the product. */
  readonly backupKey: string;
}

/** How one verb is exercised: the line it is invoked with, and where it is typed. */
interface Exercise {
  /** The command line, over the values the fixture produced. */
  readonly argv: (fixture: Fixture) => readonly string[];
  /**
   * Typed in a directory that is NOT a project yet.
   *
   * `init` is the one verb whose write depends on this. Inside a project that already has
   * one it reports what is there and records nothing, so a mis-declaration of the verb
   * that founds an identity would be the one the chain could not see — which was measured:
   * declaring `init` a read left the count table and the stale check red and this
   * measurement silent. It is typed where it founds.
   */
  readonly outsideAProject?: true;
}

/** How one verb is exercised, or the reason it cannot be. */
type Invocation = Exercise | typeof CANNOT_BE_EXERCISED;

/**
 * One real invocation per verb — the whole surface, exercised.
 *
 * Every row succeeds, and that is asserted: a refusal writes nothing, so a row that
 * decayed into one would make its verb pass this guard for a reason that has nothing to
 * do with reading. Each read is asked something it can answer over the fixture, and each
 * write is given what it needs to actually record.
 *
 * The table covers the WRITES as well as the reads, which is what lets the measurement
 * follow a re-classification: a verb wrongly declared a read is then EXERCISED, and the
 * events it appends accuse it — where a reads-only table would only report a missing row.
 * So each write's line is the one that RECORDS, not merely the one that is easiest: `key`
 * retires a key rather than printing a request, because a request records nothing and
 * would have left this verb's declaration unmeasured.
 */
const INVOCATION: Readonly<Record<string, Invocation>> = {
  // The eleven writes.
  init: { argv: () => ['init'], outsideAProject: true },
  task: { argv: () => ['task', 'a second task'] },
  decision: { argv: () => ['decision', 'a title', 'a rationale'] },
  skill: { argv: () => ['skill', 'a pattern', '--body', 'the pattern itself'] },
  memory: { argv: () => ['memory', 'something worth keeping'] },
  observe: {
    argv: (f) => ['observe', f.task, '--topic', 'review', '--text', 'it needs a rollback'],
  },
  handoff: { argv: (f) => ['handoff', f.task, 'agent-alpha', 'agent-beta'] },
  link: { argv: (f) => ['link', f.task, f.task, '--rel', 'relates-to'] },
  run: { argv: () => ['run', 'start', '--which', 'agent-alpha'] },
  key: { argv: (f) => ['key', 'revoke', f.backupKey, '--reason', 'it left this machine'] },
  mcp: CANNOT_BE_EXERCISED,
  // The seventeen reads.
  status: { argv: (f) => ['status', '--actor', f.anchor] },
  focus: { argv: (f) => ['focus', '--actor', f.anchor] },
  resume: { argv: (f) => ['resume', '--actor', f.anchor] },
  'next-actions': { argv: (f) => ['next-actions', f.task] },
  guard: { argv: (f) => ['guard', 'submit', f.task, '--actor', f.anchor] },
  search: { argv: () => ['search', 'task'] },
  show: { argv: (f) => ['show', f.task] },
  timeline: { argv: (f) => ['timeline', f.task] },
  accountability: { argv: () => ['accountability'] },
  antipatterns: { argv: () => ['antipatterns'] },
  exposure: { argv: () => ['exposure'] },
  refs: { argv: (f) => ['refs', f.task] },
  skills: { argv: () => ['skills'] },
  brief: { argv: () => ['brief'] },
  verify: { argv: () => ['verify'] },
  repl: CANNOT_BE_EXERCISED,
  completion: { argv: () => ['completion', 'bash'] },
};

/**
 * The WRITES whose exercise above records nothing, each with the reason.
 *
 * A verb declared a write that writes nothing on some invocation is NOT an error, and the
 * decision is deliberate: the classification is about the POWER, never the exercise. A
 * write refused for a missing project appended nothing and is still a write. Treating this
 * as a failure would make the guard demand a successful write from every row, and the way
 * to satisfy it would be to declare a verb a READ — the guard pushing the surface towards
 * the unsafe side of its own classification.
 *
 * What it is instead is DECLARED, and reconciled in both directions: a verb here that
 * starts recording has to leave, and one that stops recording has to arrive. So the write
 * side is not simply unmeasured — and it holds ONE entry, the verb no invocation can
 * exercise at all.
 */
const RECORDS_NOTHING: Readonly<Record<string, string>> = {
  mcp: 'not exercised: it serves a connection for its lifetime and would not return',
};

// ---------------------------------------------------------------------------
// What reached the record
// ---------------------------------------------------------------------------

/** A sealed segment of a tail: `NNNNNN.jsonl`, which is where events live. */
const SEGMENT = /^\d{6}\.jsonl$/;

/** Key material, wherever a tree or the key root keeps it. */
const KEY_MATERIAL = /\.(pub|key|enroll|inst|anchor)$/;

/** Everything under `dir`, as absolute paths. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/**
 * What the record holds right now: how many events are in it, and what its key material
 * is.
 *
 * The events are counted by READING THE LINES of every segment file in the sandbox, not
 * by asking the product to replay them. A count derived from the same code the verbs run
 * would move with it, and a verb that wrote an event the reader skipped would come out
 * even. The key material is hashed by path and content, so a key minted, adopted or
 * installed by a read is a change too — the other half of what "changes the record"
 * means.
 */
function held(dir: string): { events: number; keys: string } {
  let events = 0;
  const keys = createHash('sha256');
  for (const path of filesUnder(dir).sort()) {
    const name = basename(path);
    if (SEGMENT.test(name)) {
      events += readFileSync(path, 'utf-8')
        .split('\n')
        .filter((line) => line.trim().length > 0).length;
    }
    if (KEY_MATERIAL.test(name)) {
      keys.update(`${path}:`);
      keys.update(readFileSync(path));
      keys.update('\n');
    }
  }
  return { events, keys: keys.digest('hex') };
}

/** One verb, exercised: what it declared, and what its invocation did to the record. */
interface Exercised {
  readonly verb: string;
  readonly effect: RecordEffect;
  /** How many events the invocation added to the record. */
  readonly appended: number;
  /** Whether it minted, adopted or installed key material. */
  readonly touchedKeys: boolean;
  /** How many forms of the verb were run — the human one, and `--json` when it has one. */
  readonly forms: number;
}

/**
 * Every verb that CLAIMS TO READ and changed the record anyway, with what it did.
 *
 * Only the read side is accused, for the reason {@link RECORDS_NOTHING} gives.
 */
function accused(exercised: readonly Exercised[]): string[] {
  return exercised
    .filter((one) => one.effect === 'reads' && (one.appended > 0 || one.touchedKeys))
    .map((one) => `${one.verb} declares reads and appended ${one.appended}`)
    .sort();
}

/** Every verb that claims to write and recorded nothing when invoked. */
function recordedNothing(exercised: readonly Exercised[]): string[] {
  return exercised
    .filter((one) => one.effect === 'mutates' && one.appended === 0 && !one.touchedKeys)
    .map((one) => one.verb)
    .sort();
}

/** What a declaration table tolerates, and what it does not — checked both ways. */
function reconcile(
  found: readonly string[],
  declarations: Readonly<Record<string, string>>,
): { unexpected: string[]; stale: string[] } {
  const names = Object.keys(declarations);
  return {
    unexpected: found.filter((name) => !names.includes(name)).sort(),
    stale: names.filter((name) => !found.includes(name)).sort(),
  };
}

// ---------------------------------------------------------------------------
// The sandbox
// ---------------------------------------------------------------------------

let sandbox: string;
const before = { cwd: process.cwd(), home: process.env.HOME, xdg: process.env.XDG_DATA_HOME };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-effects-'));
});

afterEach(() => {
  process.chdir(before.cwd);
  process.env.HOME = before.home;
  process.env.XDG_DATA_HOME = before.xdg;
  rmSync(sandbox, { recursive: true, force: true });
});

/** Runs `mnema <argv>` against the fixture, and says whether it exited non-zero. */
async function mnema(argv: readonly string[]): Promise<{ out: string[]; failed: boolean }> {
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
  // The refusal goes in the returned lines too: an exercise that failed has to be able
  // to say WHY, or a red here is a hunt through an empty message.
  return { out: [...out, ...err], failed };
}

/**
 * A project with an identity and one task, in a directory of its own inside the sandbox.
 *
 * Each verb gets a fresh one, so what is measured is that verb's invocation and not the
 * residue of the one before it. The two values it hands over are both PRODUCED by the
 * product — an anchor derived from a key, an id minted at a birth — never invented here.
 */
async function fixture(name: string): Promise<Fixture> {
  const project = join(sandbox, name, 'project');
  mkdirSync(project, { recursive: true });
  // A machine of its own as well as a project of its own: the backup key is minted once
  // per machine, so a shared home would give the first verb a founding and every verb
  // after it a project that only re-enrolled — and the fingerprint one of them needs
  // would be reported by exactly one row.
  process.env.HOME = join(sandbox, name, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, name, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(project);

  const founded = await mnema(['init']);
  const identity = founded.out.find((line) => line.trim().startsWith('identity:'));
  if (identity === undefined) throw new Error(`fixture: init printed no identity: ${founded.out}`);
  // The backup key's fingerprint, taken from the path `init` reports its private half at.
  // It is not typed here for the reason the anchor is not: a fingerprint names a physical
  // key, and a value the product did not mint names none of them.
  const AT = 'private half at ';
  const backup = founded.out.find((line) => line.includes(AT));
  if (backup === undefined) throw new Error(`fixture: init named no backup key: ${founded.out}`);
  const created = await mnema(['task', 'the task the reads are asked about']);
  const id = created.out.join('\n').match(/\(([0-9a-f-]{36})\)/);
  if (id?.[1] === undefined) throw new Error(`fixture: task printed no id: ${created.out}`);
  return {
    anchor: identity.trim().slice('identity:'.length).trim(),
    task: id[1],
    backupKey: basename(backup.slice(backup.indexOf(AT) + AT.length).trim(), '.key'),
  };
}

/**
 * Whether a verb's own declaration offers `--json`, read off the command commander holds.
 *
 * Asked rather than listed: a verb that gains the flag is exercised in both its forms
 * without an edit here, and one that loses it stops being asked for a form it has not
 * got. {@link EXERCISED_IN_BOTH_FORMS} is what keeps the question from quietly finding
 * none.
 */
function offersJson(verb: string): boolean {
  const command = DECLARED.find((one) => one.command.name() === verb)?.command;
  return command?.options.some((option) => option.long === '--json') === true;
}

/**
 * How many verbs are exercised twice — the witness of the derivation above.
 *
 * A read's human summary and its `--json` object are two code paths, and a write behind
 * the one this file did not run would be invisible. The number is asserted so a
 * `command.options` that stopped answering cannot silently halve the exercise.
 */
const EXERCISED_IN_BOTH_FORMS = 13;

/** Exercises every verb the table names, each in its own project, and measures the record. */
async function exerciseEverything(): Promise<Exercised[]> {
  const measured: Exercised[] = [];
  for (const [verb, effect] of EFFECT_BY_VERB) {
    const invocation = INVOCATION[verb];
    if (invocation === undefined) throw new Error(`no invocation declared for ${verb}`);
    if (invocation === CANNOT_BE_EXERCISED) {
      measured.push({ verb, effect, appended: 0, touchedKeys: false, forms: 0 });
      continue;
    }
    const project = await fixture(verb);
    if (invocation.outsideAProject === true) {
      const elsewhere = join(sandbox, verb, 'elsewhere');
      mkdirSync(elsewhere, { recursive: true });
      process.chdir(elsewhere);
    }
    // Every form the verb has, not just the shortest one: the human summary and the
    // `--json` object are different code, and only one of them was being run.
    const lines = offersJson(verb)
      ? [invocation.argv(project), [...invocation.argv(project), '--json']]
      : [invocation.argv(project)];
    const started = held(sandbox);
    for (const argv of lines) {
      const outcome = await mnema(argv);
      expect(
        outcome.failed,
        `mnema ${argv.join(' ')} was refused: ${outcome.out.join(' / ')}`,
      ).toBe(false);
    }
    const ended = held(sandbox);
    measured.push({
      verb,
      effect,
      appended: ended.events - started.events,
      touchedKeys: ended.keys !== started.keys,
      forms: lines.length,
    });
  }
  return measured;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('every verb says if it writes', () => {
  it('classifies everything the program routes, and nothing else', () => {
    // The first half. The type already forces each member of the list to answer, so what
    // this adds is that the list is ALL of it: a command hung on the program by another
    // path would carry no declaration, and a caller reading them would never learn it
    // exists. Both directions, sorted, so a verb added or removed shows up here.
    //
    // IT ASKS THE ENTRY, not the wiring. It used to build a program of its own and
    // register the verbs into it, which made this direction a tautology — the same
    // function supplied both sides. Measured: a `program.command('smuggled')` added to
    // `buildProgram` right after `registerVerbs` left all five cases here GREEN. What
    // the caller of tomorrow parses is the entry's program, so that is what is walked.
    const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    const { program } = buildProgram(io);
    expect(program.commands.map((command) => command.name()).sort()).toEqual(
      [...EFFECT_BY_VERB.keys()].sort(),
    );
    // And the exercise covers the same set — a verb with no row would be a verb this
    // file never measured, silently.
    expect(Object.keys(INVOCATION).sort()).toEqual([...EFFECT_BY_VERB.keys()].sort());
  });

  it('counts eleven writes and seventeen reads over the whole surface', () => {
    // The count in the report, asserted rather than trusted, and the total against the
    // list: a verb that stopped being registered would otherwise leave both halves
    // looking healthy.
    expect(verbsThat('mutates')).toEqual([
      'init',
      'task',
      'decision',
      'skill',
      'memory',
      'observe',
      'handoff',
      'link',
      'run',
      'key',
      'mcp',
    ]);
    expect(verbsThat('reads')).toEqual([
      'status',
      'focus',
      'resume',
      'next-actions',
      'guard',
      'search',
      'show',
      'timeline',
      'accountability',
      'antipatterns',
      'exposure',
      'refs',
      'skills',
      'brief',
      'verify',
      'repl',
      'completion',
    ]);
    expect(verbsThat('mutates').length + verbsThat('reads').length).toBe(DECLARED.length);
  });

  it('measures every verb against the chain: a read appends nothing', async () => {
    const exercised = await exerciseEverything();

    // THE RULE. Every verb that declared itself a read was invoked for real, and the
    // record it left behind holds exactly what it held before — no event in any tail of
    // any tree, and not a byte of key material different.
    expect(accused(exercised)).toEqual([]);

    // The measurement's own teeth, on the same data: the writes that DID record are
    // counted, so a `held` that stopped seeing segments — or a fixture whose project
    // stopped being a project — cannot leave the assertion above passing over nothing.
    const wrote = exercised.filter((one) => one.appended > 0);
    expect(wrote.map((one) => one.verb).sort()).toEqual([
      'decision',
      'handoff',
      'init',
      'key',
      'link',
      'memory',
      'observe',
      'run',
      'skill',
      'task',
    ]);
    // Every one of those is on the write side. The count is the other half: reads and
    // writes were exercised through the same entry, in the same shape of sandbox.
    expect(wrote.every((one) => one.effect === 'mutates')).toBe(true);
    expect(exercised.length).toBe(DECLARED.length);
    // And both FORMS of every verb that has two were run, so a write behind `--json`
    // could not hide in the path this file did not take.
    expect(exercised.filter((one) => one.forms === 2).length).toBe(EXERCISED_IN_BOTH_FORMS);

    // And the writes that recorded nothing are declared one by one, both ways: one that
    // starts recording has to leave the table, one that stops has to arrive in it.
    expect(reconcile(recordedNothing(exercised), RECORDS_NOTHING)).toEqual({
      unexpected: [],
      stale: [],
    });
  }, 240_000);

  it('accuses a read that writes, and never a write that does not — on input of its own', () => {
    // The mechanism's non-vacuity. With the surface honest, the case above says only
    // "nothing is accused": it exercises neither the accusation nor its limit, so nothing
    // has ever shown these two functions can tell the four cases apart. The rows are
    // synthetic and never enter the product's tables.
    const rows: readonly Exercised[] = [
      { verb: 'reader', effect: 'reads', appended: 0, touchedKeys: false, forms: 2 },
      { verb: 'liar', effect: 'reads', appended: 1, touchedKeys: false, forms: 1 },
      { verb: 'thief', effect: 'reads', appended: 0, touchedKeys: true, forms: 1 },
      { verb: 'writer', effect: 'mutates', appended: 3, touchedKeys: false, forms: 1 },
      { verb: 'idle-writer', effect: 'mutates', appended: 0, touchedKeys: false, forms: 1 },
    ];

    // An appended event and a touched key are both accusations, and only on the read
    // side: the honest read and the writer that wrote come through clean.
    expect(accused(rows)).toEqual([
      'liar declares reads and appended 1',
      'thief declares reads and appended 0',
    ]);
    // A write that recorded nothing is reported for the declaration table, not accused —
    // and a write that recorded is not reported at all.
    expect(recordedNothing(rows)).toEqual(['idle-writer']);
    // The table's two directions, which is what keeps it from becoming an allowlist.
    expect(reconcile(['idle-writer'], { 'idle-writer': 'the reason' })).toEqual({
      unexpected: [],
      stale: [],
    });
    expect(reconcile(['idle-writer', 'another'], { 'idle-writer': 'the reason' })).toEqual({
      unexpected: ['another'],
      stale: [],
    });
    expect(reconcile([], { 'idle-writer': 'the reason' })).toEqual({
      unexpected: [],
      stale: ['idle-writer'],
    });
  });

  it('counts an event by reading the segments, so the count is not the product’s own', async () => {
    // `held` is what the rule is measured with, and it is the one thing here that could
    // be wrong in a way that makes everything pass. So it is exercised directly: a fresh
    // project holds events, one more write adds exactly one, and a read adds none.
    const project = await fixture('counting');
    const founded = held(sandbox);
    expect(founded.events).toBeGreaterThan(0);

    await mnema(['memory', 'one more fact']);
    const afterWrite = held(sandbox);
    expect(afterWrite.events).toBe(founded.events + 1);
    expect(afterWrite.keys).toBe(founded.keys);

    await mnema(['search', 'fact']);
    expect(held(sandbox).events).toBe(afterWrite.events);

    // And the KEY half, which no verb above is expected to move and which would otherwise
    // never be shown to work at all: founding a second project on this machine
    // materializes the key into that tree, so the digest changes.
    const other = join(sandbox, 'counting-again');
    mkdirSync(other, { recursive: true });
    process.chdir(other);
    await mnema(['init']);
    expect(held(sandbox).keys).not.toBe(afterWrite.keys);
    // The anchor the fixture produced is what the reads take, and it came from the
    // product rather than from this file — the one value here that could be invented.
    expect(project.anchor.startsWith('mnid:')).toBe(true);
  }, 60_000);
});
