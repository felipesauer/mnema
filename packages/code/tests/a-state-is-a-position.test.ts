/**
 * A TASK'S STATE IS A POSITION, AND THE HUE SAYS WHAT THE READER DOES ABOUT IT.
 *
 * This surface refused to paint a state once, and wrote the reason at the call site:
 * *they are categories, and a hue per category is noise*. The rule was right and the
 * classification was wrong. A `scope` is a category — three trees, no order, nothing
 * following from which one a record lives in — and it is still unpainted. A task's state
 * is a POSITION IN A CYCLE, and the transition table gives each position a structurally
 * different set of exits, which is what makes "is there anything to do about this"
 * answerable from the machine instead of from taste. Seven states, five dispositions
 * (`core`'s `disposition.ts`), three hues (`presentation/state.ts`).
 *
 * WHAT IS ASSERTED HERE, and the order is the order the guarantees matter:
 *
 *   1. ALL SEVEN STATES, each with the hue its disposition earns — enumerated from
 *      `TASK_STATES`, so an eighth state cannot be added without this file naming what it
 *      looks like. Each state is REACHED THROUGH THE WORKFLOW'S OWN MOVES: a fixture that
 *      wrote `BLOCKED` into a record directly would be asserting over a value the product
 *      cannot produce.
 *   2. THE BYTES DID NOT MOVE. `--color=never` is the line the golden holds: the
 *      parenthesis, the single space before it and the position at the end of the title
 *      are what they were when the state was concatenated INTO the title. The golden over
 *      the whole surface is the acceptance test for that; here it is asserted per state,
 *      because the golden's fixture only ever reaches two of the seven.
 *   3. THE HUE ONLY REPEATS THE WORD. Strip the escapes and the painted line is the plain
 *      line, and the plain line names the state — so a pipe, a CI log, a monochrome
 *      terminal and `--color=never` lose nothing.
 *   4. IT ANSWERS FOR THE TASK MACHINE ONLY. A decision's and a pattern's position come
 *      through the same column of the same list and come out plain.
 *   5. NO READING COMPOSES A STATE INTO ANOTHER PART. The defect this delivery fixed was
 *      a state living inside the title's field, where nothing could paint one without
 *      painting the other; the guard is a scan of the source, because the shape can come
 *      back one template literal at a time.
 *
 * THE VACUOUS FORM of the per-state cases is a fixture that never reached the state it
 * claims to be about: every one of them would then assert over a line that is not there.
 * So the located line is asserted to exist and to carry the id it was found by, and the
 * set of states the fixture reached is compared against the whole tuple.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_STATES, type TaskState } from '@mnema/core';
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
/** The decision and the pattern, whose positions belong to the other machines. */
let decisionId = '';
let skillId = '';

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

  const decision = await invoke('decision', 'Keep the runbook in the record', 'a wiki goes stale');
  decisionId = /\(([^)]+)\)/.exec(decision.join('\n'))?.[1] ?? '';
  const skill = await invoke('skill', 'One slice per PR', '--body', 'A slice is one change.');
  skillId = /\(([^)]+)\)/.exec(skill.join('\n'))?.[1] ?? '';
}, 120_000);

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

describe('the record reached every position the machine has', () => {
  it('put a task in all seven, by moving it there', async () => {
    // The fixture's own non-vacuity, and the reason it comes first: every case below is
    // an assertion about a line, and a state the fixture never reached would have no
    // line to be wrong about.
    expect([...taskIn.keys()].sort()).toEqual([...TASK_STATES].sort());
    const shown = await invoke('--color=never', 'search', '--kind', 'task');
    for (const state of TASK_STATES) {
      const id = taskIn.get(state) as string;
      expect(lineFor(shown, id), state).toContain(` (${state})`);
    }
    expect(decisionId).not.toBe('');
    expect(skillId).not.toBe('');
  }, 60_000);
});

describe('every position reads as what it is, and paints only where it is news', () => {
  it('gives each of the seven the hue its disposition earns, and no other', async () => {
    const plain = await invoke('--color=never', 'search', '--kind', 'task');
    const styled = await invoke('--color=always', 'search', '--kind', 'task');
    for (const state of TASK_STATES) {
      const id = taskIn.get(state) as string;
      const bare = lineFor(plain, id);
      const painted = lineFor(styled, id);
      const hue = HUE_OF[state];
      // The words, either way: the state is named in both, so nothing lives in the hue.
      // Asserted as the END of the line and with the DOUBLE space refused, because
      // `toContain` alone reads a state joined as a column as if nothing had moved — which
      // is exactly the mutation that turned the golden red and left this case green.
      expect(bare, state).toMatch(new RegExp(`[^ ] \\(${state}\\)$`));
      expect(stripped(painted), state).toBe(bare);
      if (hue === undefined) {
        // Unpainted is asserted as the PLAIN sequence surviving verbatim — the space, the
        // parenthesis and the state with nothing between them. An escape anywhere in that
        // gap would break it, which is what makes this the same assertion as "no hue".
        expect(painted, state).toContain(` (${state})`);
        continue;
      }
      expect(painted, state).toContain(`${hue}(${state})${DEFAULT_HUE}`);
      // And the title beside it is NOT painted: the hue opens at the parenthesis, so the
      // plain form of the pair cannot be in the line at all.
      expect(painted, state).not.toContain(` (${state})`);
    }
  }, 60_000);

  it('paints three of the seven — the count, so the table is not all one thing', () => {
    // The vacuous form of the case above is a table that says `undefined` everywhere: it
    // would then assert only that nothing paints, over and over. Three hues, three states,
    // and each hue used once.
    const painted = TASK_STATES.filter((state) => HUE_OF[state] !== undefined);
    expect(painted).toEqual(['BLOCKED', 'IN_REVIEW', 'DONE']);
    expect(new Set(painted.map((state) => HUE_OF[state])).size).toBe(3);
  });

  it('says the same thing in `show`, where the state ends a fact instead of a list', async () => {
    // The second reading that shows a position, and the one where it was concatenated into
    // a sentence rather than into a column. Same three hues, same words, same bytes.
    for (const state of TASK_STATES) {
      const id = taskIn.get(state) as string;
      const bare = (await invoke('--color=never', 'show', id)).join('\n');
      const painted = (await invoke('--color=always', 'show', id)).join('\n');
      expect(bare, state).toContain('the task the fixture wrote number ');
      // One space between the title and the position, and the position ends the line.
      expect(bare, state).toMatch(new RegExp(`[^ ] \\(${state}\\)$`, 'm'));
      expect(stripped(painted), state).toBe(bare);
      const hue = HUE_OF[state];
      if (hue === undefined) expect(painted, state).toContain(` (${state})`);
      else expect(painted, state).toContain(`${hue}(${state})${DEFAULT_HUE}`);
    }
  }, 60_000);

  it('carries no escape at all when the reader asks for none', async () => {
    // `--color=never` is what someone on a monochrome terminal or reading through a filter
    // types, and it is the flag the acceptance criterion is written on: the bytes are the
    // ones the golden holds, whatever the terminal would have allowed.
    for (const argv of [
      ['search', '--kind', 'task'],
      ['show', taskIn.get('BLOCKED') as string],
      ['show', taskIn.get('DONE') as string],
    ]) {
      const never = await invoke('--color=never', ...argv);
      expect(never.join('\n'), argv.join(' ')).not.toContain(ESC);
      // And it is the same report the default gives where output is not a terminal, line
      // for line — so the flag is a second spelling of the transcript, not a third form.
      expect(await invoke(...argv), argv.join(' ')).toEqual(never);
    }
  }, 60_000);
});

describe('and it answers for the task machine only', () => {
  it('leaves a decision’s and a pattern’s position plain, in the same column', async () => {
    // Both come through `asState` — a search lists all three kinds in one list — and
    // neither is painted. Their machines answer a different question ("does this govern"),
    // each keeps its own classification off its package's surface by declaration, and a
    // surface that painted them would be re-deriving a meaning it cannot ask for.
    const styled = await invoke('--color=always', 'search');
    expect(lineFor(styled, decisionId)).toContain(' (proposed)');
    expect(lineFor(styled, skillId)).toContain(' (proposed)');
    // Not because nothing in this report paints: the same invocation paints a task.
    expect(lineFor(styled, taskIn.get('BLOCKED') as string)).toContain(`${RED}(BLOCKED)`);
  }, 60_000);
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
