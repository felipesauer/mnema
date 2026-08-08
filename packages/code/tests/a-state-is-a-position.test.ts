/**
 * A STATE IS A POSITION, AND THE HUE SAYS WHAT THE READER DOES ABOUT IT — in all three
 * machines the product has.
 *
 * This surface refused to paint a state once, and wrote the reason at the call site:
 * *they are categories, and a hue per category is noise*. The rule was right and the
 * classification was wrong. A `scope` is a category — three trees, no order, nothing
 * following from which one a record lives in — and it is still unpainted. A workflow
 * state is a POSITION IN A CYCLE, and the transition table gives each position a
 * structurally different set of exits, which is what makes "is there anything to do about
 * this" answerable from the machine instead of from taste. Sixteen states, six
 * dispositions (`core`'s `disposition.ts` for tasks, `copilot`'s `decisions.ts` and
 * `skills.ts` for the other two), three hues (`presentation/state.ts`).
 *
 * THIS FILE USED TO SAY IT ANSWERED FOR THE TASK MACHINE ONLY, and held a case pinning
 * a decision and a pattern PLAIN, with the reason that *their machines answer a different
 * question, each keeps its own classification off its package's surface, and a surface
 * that painted them would be re-deriving a meaning it cannot ask for*. The classification
 * part was always true and is untouched; the conclusion was not. `copilot` publishes
 * `skillDisposition` and now `decisionDisposition` for exactly this kind of consumer, so
 * the surface ASKS and re-derives nothing. What the old case pinned was not a rule but a
 * gap, measured on screen: `(DONE)` green and `(BLOCKED)` red beside `(proposed)`,
 * `(accepted)`, `(superseded)` and `(adopted)` all white.
 *
 * WHAT IS ASSERTED HERE, and the order is the order the guarantees matter:
 *
 *   1. ALL SIXTEEN STATES, each with the hue its disposition earns — enumerated from
 *      `TASK_STATES`, `DECISION_STATES` and `SKILL_STATES`, so a state added to any
 *      machine cannot arrive without this file naming what it looks like. Each state is
 *      REACHED THROUGH THE WORKFLOW'S OWN MOVES: a fixture that wrote `BLOCKED` or
 *      `superseded` into a record directly would be asserting over a value the product
 *      cannot produce.
 *   2. THE BYTES DID NOT MOVE. `--color=never` is the line the golden holds: the
 *      parenthesis, the single space before it and the position at the end of the title
 *      are what they were when the state was concatenated INTO the title. The golden over
 *      the whole surface is the acceptance test for that; here it is asserted per state,
 *      because the golden's fixture only ever reaches a few of the sixteen.
 *   3. THE HUE ONLY REPEATS THE WORD. Strip the escapes and the painted line is the plain
 *      line, and the plain line names the state — so a pipe, a CI log, a monochrome
 *      terminal and `--color=never` lose nothing.
 *   4. A WORD TWO MACHINES SHARE MEANS THE SAME IN BOTH. The column carries a word and
 *      never a kind, so `asState` classifies by the word; `proposed` and `rejected`
 *      belong to two machines each, and the day the two tables disagree about one of
 *      them this file goes red rather than the surface quietly picking a winner.
 *   5. NO READING COMPOSES A STATE INTO ANOTHER PART. The defect this delivery fixed was
 *      a state living inside the title's field, where nothing could paint one without
 *      painting the other; the guard is a scan of the source, because the shape can come
 *      back one template literal at a time.
 *
 * THE VACUOUS FORM of the per-state cases is a fixture that never reached the state it
 * claims to be about: every one of them would then assert over a line that is not there.
 * So the located line is asserted to exist and to carry the id it was found by, and the
 * set of states the fixture reached is compared against each machine's whole tuple.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decisionDisposition, skillDisposition } from '@mnema/copilot';
import {
  DECISION_STATES,
  type DecisionState,
  SKILL_STATES,
  type SkillState,
  TASK_STATES,
  type TaskState,
  taskDisposition,
} from '@mnema/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

/**
 * The byte every sequence below opens with, written as its ESCAPE and never as itself: a
 * control character in source is invisible to a reader, and this bench has paid for that
 * eight times over — including once from the tool that wrote this file.
 */
const ESC = '\u001b';
/** The three hues the surface has, and the closer all of them take. */
const RED = `${ESC}[31m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const DEFAULT_HUE = `${ESC}[39m`;

/** Every sequence the styled renderer writes, so a line can be compared unpainted. */
const SGR = new RegExp(`${ESC}\\[(?:1|2|22|31|32|33|39)m`, 'g');
const stripped = (text: string): string => text.replace(SGR, '');

/**
 * What each of the seven positions looks like to a reader — the CLAIM, written out here
 * rather than asked of the code that implements it.
 *
 * Reading it against the transition table, which is where every entry comes from:
 * `BLOCKED` is the one position that cannot progress (its only exit undoes it, for free),
 * so it is the one a reader has to act on. `IN_REVIEW` owes a verdict, which is neither.
 * `DONE` arrived. The other four are the ordinary course of work and a cancellation, and
 * a hue on the ordinary case is a hue on everything.
 */
const HUE_OF: Readonly<Record<TaskState, string | undefined>> = {
  DRAFT: undefined,
  READY: undefined,
  IN_PROGRESS: undefined,
  BLOCKED: RED,
  IN_REVIEW: YELLOW,
  DONE: GREEN,
  CANCELED: undefined,
};

/** The moves that reach each state from birth — the workflow's own, never a shortcut. */
const REACHED_BY: Readonly<Record<TaskState, readonly (readonly string[])[]>> = {
  DRAFT: [],
  READY: [['submit']],
  IN_PROGRESS: [['submit'], ['start']],
  BLOCKED: [['submit'], ['start'], ['block', '--reason', 'the API is down']],
  IN_REVIEW: [['submit'], ['start'], ['submit_review']],
  DONE: [['submit'], ['start'], ['complete', '--note', 'it is written']],
  CANCELED: [['cancel', '--reason', 'it was the wrong idea']],
};

/**
 * What each of the decision machine's four positions looks like, read against
 * `DECISION_TRANSITIONS`.
 *
 * `proposed` is left by `accept` and `reject` and both are a verdict somebody owes, which
 * is the middle of the scale. `accepted` ARRIVED — it is what governs — and the one move
 * that undoes it costs a reason, which is the same shape as a task's `DONE` and takes the
 * same green. THE GREEN IS THE POINT OF THIS TABLE and not a detail of it: `supersede`
 * stays legal from `accepted` forever, so a rule built on "has a legal move" would paint
 * every settled call as a pendency that never clears. The two terminal states carry
 * nothing: the word says what happened and there is nothing to do about it.
 */
const DECISION_HUE_OF: Readonly<Record<DecisionState, string | undefined>> = {
  proposed: YELLOW,
  accepted: GREEN,
  rejected: undefined,
  superseded: undefined,
};

/**
 * What each of the skill machine's five positions looks like, read against
 * `SKILL_TRANSITIONS`.
 *
 * This machine's waiting side is TWO states — `proposed` needs someone to look and
 * `reviewed` needs someone to rule — and both are yellow for the one reason yellow
 * exists. `adopted` is the live pattern and takes the same green `accepted` does, for
 * the same reason: `deprecate` costs a reason, and being replaceable is not being
 * pending. `rejected` and `deprecated` are terminal and carry nothing.
 */
const SKILL_HUE_OF: Readonly<Record<SkillState, string | undefined>> = {
  proposed: YELLOW,
  reviewed: YELLOW,
  adopted: GREEN,
  rejected: undefined,
  deprecated: undefined,
};

/**
 * Where the record being moved goes in the argv, and where its successor goes.
 *
 * The task table above can append the id because every one of that machine's verbs ends
 * in one. `decision supersede` does not: it takes the PAIR, `<old-id> <new-id>`, because
 * a supersede needs the successor the generic `move` has nowhere to put. So these two
 * tables write the argv out in full and name the holes, which is also what keeps them
 * readable as the command a person would type.
 */
const SUBJECT = '<the record>';
const SUCCESSOR = '<the successor>';

/** The moves that reach each decision state from birth — the workflow's own. */
const DECISION_REACHED_BY: Readonly<Record<DecisionState, readonly (readonly string[])[]>> = {
  proposed: [],
  accepted: [['move', 'accept', SUBJECT, '--note', 'we agreed in review']],
  rejected: [['move', 'reject', SUBJECT, '--note', 'it costs more than it saves']],
  superseded: [['supersede', SUBJECT, SUCCESSOR, '--reason', 'a later call replaces it']],
};

/** The moves that reach each skill state from birth — the workflow's own. */
const SKILL_REACHED_BY: Readonly<Record<SkillState, readonly (readonly string[])[]>> = {
  proposed: [],
  reviewed: [['move', 'review', SUBJECT, '--note', 'it reads well']],
  adopted: [
    ['move', 'review', SUBJECT, '--note', 'it reads well'],
    ['move', 'adopt', SUBJECT, '--note', 'we work this way already'],
  ],
  rejected: [['move', 'reject', SUBJECT, '--note', 'we tried it and it did not hold']],
  deprecated: [
    ['move', 'review', SUBJECT, '--note', 'it reads well'],
    ['move', 'adopt', SUBJECT, '--note', 'we work this way already'],
    ['move', 'deprecate', SUBJECT, '--reason', 'nobody works this way any more'],
  ],
};

let sandbox: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };
let lines: string[] = [];
const io: CliIo = {
  out: (line) => lines.push(...line.split('\n')),
  err: (line) => lines.push(...line.split('\n')),
  fail: () => {},
};

/** Every line one invocation writes, on either stream, in order. */
async function invoke(...argv: string[]): Promise<string[]> {
  lines = [];
  await run(argv, io);
  return lines;
}

/** The id of each task the fixture put in a state, by the state it was left in. */
const taskIn = new Map<TaskState, string>();
/** The same, for the two machines whose positions used to come out plain. */
const decisionIn = new Map<DecisionState, string>();
const skillIn = new Map<SkillState, string>();

/**
 * The id a write acknowledged, taken from the line that acknowledged it.
 *
 * By the LINE's prefix and by the id's position at the end of it, rather than by the
 * first parenthesis anywhere in the report: a decision's line also carries `ADR-<n>`, a
 * pattern's carries the name it was given, and either could hold a bracket a fixture
 * chose. It throws instead of returning empty, because an empty id would find no line
 * later and turn every case about that state into an assertion about nothing.
 */
function mintedId(report: readonly string[], prefix: string): string {
  const line = report.find((text) => text.startsWith(prefix));
  if (line === undefined) throw new Error(`fixture: no "${prefix}" line in ${report.join(' / ')}`);
  const id = /\(([^()]+)\)$/.exec(line)?.[1];
  if (id === undefined) throw new Error(`fixture: no id at the end of ${line}`);
  return id;
}

/** One move's argv with the record it moves — and its successor, where one is asked for. */
function filled(move: readonly string[], id: string, successor?: string): string[] {
  return move.map((word) => {
    if (word === SUBJECT) return id;
    if (word !== SUCCESSOR) return word;
    if (successor === undefined) throw new Error(`fixture: ${move.join(' ')} has no successor`);
    return successor;
  });
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-position-'));
  const repo = join(sandbox, 'project');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The two conventional variables are cleared for the reason the golden clears them:
  // what is asserted is what the RULE resolves to, and a developer's shell holding one of
  // them would answer the question before the flag did.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(repo);
  await invoke('init');

  // One task per state, each walked there by the moves the gate authorizes. The title
  // deliberately does NOT name the state: a line is located by the id it carries, so no
  // assertion below can be satisfied by a word the fixture chose.
  for (const [index, state] of TASK_STATES.entries()) {
    const created = await invoke('task', `the task the fixture wrote number ${index + 1}`);
    const line = created.find((text) => text.startsWith('Created task ')) ?? '';
    const id = /\(([^)]+)\)/.exec(line)?.[1];
    if (id === undefined) throw new Error(`fixture: no task id in ${created.join(' / ')}`);
    for (const move of REACHED_BY[state]) await invoke('task', 'move', ...move, id);
    taskIn.set(state, id);
  }

  // One decision per state and one pattern per state, each walked there the same way.
  // `superseded` needs a successor and takes the one already accepted, which is why the
  // loop runs in the machine's own declared order: `DECISION_STATES` puts `accepted`
  // before `superseded`, and the missing successor is thrown on rather than defaulted —
  // a fixture that superseded a decision with an id nobody minted would be writing a
  // record the product refuses.
  for (const [index, state] of DECISION_STATES.entries()) {
    const created = await invoke(
      'decision',
      `the decision the fixture wrote number ${index + 1}`,
      'because the fixture needed one here',
    );
    const id = mintedId(created, 'Recorded decision ');
    for (const move of DECISION_REACHED_BY[state]) {
      await invoke('decision', ...filled(move, id, decisionIn.get('accepted')));
    }
    decisionIn.set(state, id);
  }

  for (const [index, state] of SKILL_STATES.entries()) {
    const created = await invoke(
      'skill',
      `the pattern the fixture wrote number ${index + 1}`,
      '--body',
      'A pattern is one way of working.',
    );
    const id = mintedId(created, 'Proposed skill ');
    for (const move of SKILL_REACHED_BY[state]) await invoke('skill', ...filled(move, id));
    skillIn.set(state, id);
  }
}, 180_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The one line of a report that carries `id`, or a failure that says it was not there. */
function lineFor(report: readonly string[], id: string): string {
  const found = report.filter((line) => line.includes(id));
  expect(found.length, `no single line for ${id} in ${report.join(' / ')}`).toBe(1);
  return found[0] as string;
}

/**
 * One machine as this file reads it: the kind a search filters by, the machine's own
 * tuple of states, where the fixture left a record in each, the hue each earns, and the
 * words the fixture titled them with.
 *
 * The three are walked by the SAME cases rather than by three copies of them: the rule
 * is one rule and a copy per machine is the shape that lets one machine drift out of it
 * unnoticed — which is the shape the surface itself was in until this delivery.
 */
interface Machine {
  readonly kind: string;
  readonly states: readonly string[];
  readonly placed: ReadonlyMap<string, string>;
  readonly hue: Readonly<Record<string, string | undefined>>;
  readonly titled: string;
}

const MACHINES: readonly Machine[] = [
  {
    kind: 'task',
    states: TASK_STATES,
    placed: taskIn,
    hue: HUE_OF,
    titled: 'the task the fixture wrote number ',
  },
  {
    kind: 'decision',
    states: DECISION_STATES,
    placed: decisionIn,
    hue: DECISION_HUE_OF,
    titled: 'the decision the fixture wrote number ',
  },
  {
    kind: 'skill',
    states: SKILL_STATES,
    placed: skillIn,
    hue: SKILL_HUE_OF,
    titled: 'the pattern the fixture wrote number ',
  },
];

/** The id the fixture left in `state`, or a failure that says the fixture never got there. */
function placedIn(machine: Machine, state: string): string {
  const id = machine.placed.get(state);
  expect(id, `fixture: nothing in ${machine.kind}.${state}`).toBeDefined();
  return id as string;
}

describe('the record reached every position each machine has', () => {
  it('put a record in all sixteen, by moving it there', async () => {
    // The fixture's own non-vacuity, and the reason it comes first: every case below is
    // an assertion about a line, and a state the fixture never reached would have no
    // line to be wrong about.
    for (const machine of MACHINES) {
      expect([...machine.placed.keys()].sort(), machine.kind).toEqual([...machine.states].sort());
      const shown = await invoke('--color=never', 'search', '--kind', machine.kind);
      for (const state of machine.states) {
        expect(lineFor(shown, placedIn(machine, state)), `${machine.kind}.${state}`).toContain(
          ` (${state})`,
        );
      }
    }
    // Sixteen, counted rather than trusted: seven task states, four decision, five skill.
    // A machine dropped from the list above would otherwise take its whole set of cases
    // with it and leave the remaining ones passing.
    expect(MACHINES.flatMap((machine) => machine.states)).toHaveLength(16);
  }, 120_000);
});

describe('every position reads as what it is, and paints only where it is news', () => {
  it('gives each of the sixteen the hue its disposition earns, and no other', async () => {
    for (const machine of MACHINES) {
      const plain = await invoke('--color=never', 'search', '--kind', machine.kind);
      const styled = await invoke('--color=always', 'search', '--kind', machine.kind);
      for (const state of machine.states) {
        const id = placedIn(machine, state);
        const where = `${machine.kind}.${state}`;
        const bare = lineFor(plain, id);
        const painted = lineFor(styled, id);
        const hue = machine.hue[state];
        // The words, either way: the state is named in both, so nothing lives in the hue.
        // Asserted as the END of the line and with the DOUBLE space refused, because
        // `toContain` alone reads a state joined as a column as if nothing had moved —
        // which is exactly the mutation that turned the golden red and left this green.
        expect(bare, where).toMatch(new RegExp(`[^ ] \\(${state}\\)$`));
        expect(stripped(painted), where).toBe(bare);
        if (hue === undefined) {
          // Unpainted is asserted as the PLAIN sequence surviving verbatim — the space,
          // the parenthesis and the state with nothing between them. An escape anywhere
          // in that gap would break it, which makes this the same assertion as "no hue".
          expect(painted, where).toContain(` (${state})`);
          continue;
        }
        expect(painted, where).toContain(`${hue}(${state})${DEFAULT_HUE}`);
        // And the title beside it is NOT painted: the hue opens at the parenthesis, so
        // the plain form of the pair cannot be in the line at all.
        expect(painted, where).not.toContain(` (${state})`);
      }
    }
  }, 120_000);

  it('paints eight of the sixteen — the count, so the tables are not all one thing', () => {
    // The vacuous form of the case above is a table that says `undefined` everywhere: it
    // would then assert only that nothing paints, over and over. Named per machine so a
    // hue that moved says WHICH position moved, and counted so a table quietly emptied
    // cannot pass as a table that simply has nothing to say.
    const painted = MACHINES.map((machine) => [
      machine.kind,
      machine.states.filter((state) => machine.hue[state] !== undefined),
    ]);
    expect(painted).toEqual([
      ['task', ['BLOCKED', 'IN_REVIEW', 'DONE']],
      ['decision', ['proposed', 'accepted']],
      ['skill', ['proposed', 'reviewed', 'adopted']],
    ]);
    // All three hues are still in use, and every machine still has at least one position
    // that says nothing — the two ways this could collapse into "everything paints" or
    // "nothing does".
    const hues = MACHINES.flatMap((machine) =>
      machine.states.map((state) => machine.hue[state]).filter((hue) => hue !== undefined),
    );
    expect(new Set(hues).size).toBe(3);
    expect(hues).toHaveLength(8);
    for (const machine of MACHINES) {
      expect(
        machine.states.filter((state) => machine.hue[state] === undefined).length,
        machine.kind,
      ).toBeGreaterThan(0);
    }
  });

  it('says the same thing in `show`, where the state ends a fact instead of a list', async () => {
    // The second reading that shows a position, and the one where it was concatenated
    // into a sentence rather than into a column. Same three hues, same words, same bytes.
    for (const machine of MACHINES) {
      for (const state of machine.states) {
        const id = placedIn(machine, state);
        const where = `${machine.kind}.${state}`;
        const bare = (await invoke('--color=never', 'show', id)).join('\n');
        const painted = (await invoke('--color=always', 'show', id)).join('\n');
        expect(bare, where).toContain(machine.titled);
        // One space between the title and the position, and the position ends the line.
        expect(bare, where).toMatch(new RegExp(`[^ ] \\(${state}\\)$`, 'm'));
        expect(stripped(painted), where).toBe(bare);
        const hue = machine.hue[state];
        if (hue === undefined) expect(painted, where).toContain(` (${state})`);
        else expect(painted, where).toContain(`${hue}(${state})${DEFAULT_HUE}`);
      }
    }
  }, 120_000);

  it('carries no escape at all when the reader asks for none', async () => {
    // `--color=never` is what someone on a monochrome terminal or reading through a filter
    // types, and it is the flag the acceptance criterion is written on: the bytes are the
    // ones the golden holds, whatever the terminal would have allowed.
    for (const argv of [
      ['search'],
      ['search', '--kind', 'task'],
      ['search', '--kind', 'decision'],
      ['search', '--kind', 'skill'],
      ['show', taskIn.get('BLOCKED') as string],
      ['show', taskIn.get('DONE') as string],
      ['show', decisionIn.get('accepted') as string],
      ['show', skillIn.get('adopted') as string],
    ]) {
      const never = await invoke('--color=never', ...argv);
      expect(never.join('\n'), argv.join(' ')).not.toContain(ESC);
      // And it is the same report the default gives where output is not a terminal, line
      // for line — so the flag is a second spelling of the transcript, not a third form.
      expect(await invoke(...argv), argv.join(' ')).toEqual(never);
    }
  }, 120_000);
});

describe('and it answers for all three machines, in the one column they share', () => {
  it('paints a decision and a pattern in the same list that paints a task', async () => {
    // The case this replaced pinned the OPPOSITE — a decision and a pattern plain — and
    // it was pinning a gap rather than a rule. One unfiltered `search` is the reading
    // where all three kinds meet in one column, which is where the gap was measured.
    const styled = await invoke('--color=always', 'search');
    expect(lineFor(styled, placedIn(MACHINES[1] as Machine, 'proposed'))).toContain(
      `${YELLOW}(proposed)`,
    );
    expect(lineFor(styled, placedIn(MACHINES[1] as Machine, 'accepted'))).toContain(
      `${GREEN}(accepted)`,
    );
    expect(lineFor(styled, placedIn(MACHINES[2] as Machine, 'reviewed'))).toContain(
      `${YELLOW}(reviewed)`,
    );
    expect(lineFor(styled, placedIn(MACHINES[2] as Machine, 'adopted'))).toContain(
      `${GREEN}(adopted)`,
    );
    expect(lineFor(styled, taskIn.get('BLOCKED') as string)).toContain(`${RED}(BLOCKED)`);
    // And it is not that everything in the list paints: the positions with nothing to
    // act on come through the same invocation with the plain bytes intact.
    expect(lineFor(styled, placedIn(MACHINES[1] as Machine, 'superseded'))).toContain(
      ' (superseded)',
    );
    expect(lineFor(styled, placedIn(MACHINES[2] as Machine, 'deprecated'))).toContain(
      ' (deprecated)',
    );
  }, 60_000);

  it('gives a word two machines share one meaning, so the column can classify by the word', () => {
    // THE COLUMN CARRIES A WORD AND NEVER A KIND. A reader looking at `(proposed)` in a
    // mixed list is not told which machine it belongs to, and neither is `asState`: it
    // asks every machine that has the word. That is only honest while the machines
    // AGREE about a shared word, and this is where the day they stop shows up.
    //
    // Enumerated from the product's own tuples and answered by the product's own
    // accessors, so a state added to either machine joins this case without an edit.
    const classified = [
      ...TASK_STATES.map((state) => ({ kind: 'task', state, means: taskDisposition(state) })),
      ...DECISION_STATES.map((state) => ({
        kind: 'decision',
        state,
        means: decisionDisposition(state),
      })),
      ...SKILL_STATES.map((state) => ({ kind: 'skill', state, means: skillDisposition(state) })),
    ];
    const byWord = new Map<string, { kind: string; means: string }[]>();
    for (const { kind, state, means } of classified) {
      byWord.set(state, [...(byWord.get(state) ?? []), { kind, means }]);
    }
    const shared = [...byWord.entries()].filter(([, holders]) => holders.length > 1);
    // TWO words, and naming them is what keeps this from passing on a day when the
    // machines happen to share none: an empty `shared` would make the loop below assert
    // nothing at all, which is exactly the vacuous form of a rule about collisions.
    expect(shared.map(([word]) => word).sort()).toEqual(['proposed', 'rejected']);
    for (const [word, holders] of shared) {
      expect(holders.map((holder) => holder.kind).sort(), word).toEqual(['decision', 'skill']);
      expect(new Set(holders.map((holder) => holder.means)).size, word).toBe(1);
    }
  });
});

describe('no reading composes a state into another part', () => {
  /**
   * One module's source with its COMMENTS blanked.
   *
   * A doc that quotes the defect is not the defect, and three of these modules quote it on
   * purpose — that is what a rewritten premise IS. Scanning the prose made this guard
   * accuse the two call sites it had just cleaned, which is the same lesson
   * `every-public-value-has-a-caller.test.ts` learned from a `{@link}`.
   */
  const codeOf = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

  /** Every module of `presentation/` that ships, as code. Tests excluded. */
  const composing = (): readonly { readonly file: string; readonly source: string }[] => {
    const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'presentation');
    return readdirSync(here)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort()
      .map((file) => ({ file, source: codeOf(readFileSync(join(here, file), 'utf-8')) }));
  };

  /**
   * A parenthesized state interpolated into a string — the shape this delivery removed.
   *
   * Written as a literal, which is what the lint asks for and what is safe HERE: the
   * pattern holds a `$` and braces and not one control character, so there is no escape
   * for a formatter to fold back into a byte. What it looks for is `(${…state…})`, which
   * is how the defect was spelled in both readings that show one.
   */
  const COMPOSED_STATE = /\(\$\{[^}]*[Ss]tate[^}]*\}\)/;

  it('builds the part in one module, and interpolates one nowhere else', () => {
    const guilty = composing()
      .filter(({ source }) => COMPOSED_STATE.test(source))
      .map(({ file }) => file);
    // ONE module composes those bytes, and it is the one whose whole job is the part:
    // `state.ts` writes `(${state})` once, with the disposition beside it.
    expect(guilty).toEqual(['state.ts']);
  });

  it('would accuse the line the careful author would write', () => {
    // The detector's non-vacuity, against the two sites this delivery changed — composed
    // rather than typed, because the lint refuses a template placeholder inside a plain
    // string and this repository opens no exception to a rule for a test.
    const hole = `$${'{'}`;
    const list = `\`${hole}oneLine(hit.title)} (${hole}hit.state})\``;
    const shown = `fact(\`${hole}body.record.title} (${hole}body.record.state})\`)`;
    expect(COMPOSED_STATE.test(list)).toBe(true);
    expect(COMPOSED_STATE.test(shown)).toBe(true);
    // And it is a filter and not a constant: the composed line the surface writes now —
    // the state as a part beside the title — is not accused.
    expect(COMPOSED_STATE.test('itemLine([oneLine(hit.title), asState(state)])')).toBe(false);
    expect(composing().length).toBeGreaterThan(10);
    // The comment-blanking does not blank CODE, which is the way this guard could have
    // gone vacuous while looking stricter: a relapse written between two doc comments is
    // still accused, and the doc that quotes the old shape is not.
    expect(COMPOSED_STATE.test(codeOf(`/** was ${list} */\nconst line = ${list};`))).toBe(true);
    expect(COMPOSED_STATE.test(codeOf(`/** was ${list} */`))).toBe(false);
    expect(COMPOSED_STATE.test(codeOf(`  // was ${list}`))).toBe(false);
  });
});
