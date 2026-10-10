/**
 * THE DOCS SAY WHAT THEIR SOURCES SAY — each number the pages show and each table they draw is read
 * off the file it came from, so the page cannot go on saying a fact its source stopped saying.
 *
 * THE PAGE COUNTS AND DRAWS TWO THINGS THAT ARE NOT ITS OWN, and this reads both from where they
 * live:
 *
 *   - THE HISTORICAL RESULT. `docs/evidence.md` keeps one round's rates as history, with the day, the
 *     model and the number of cells, and with no link, because nothing in the tree reruns it. The
 *     sentence that says what the rates moved from and to is read off the table beside it, and the
 *     section is held to carrying no link at all: a link there would promise a source the page
 *     says it does not have.
 *   - THE DECISION'S STATES. `docs/how-it-works.md`, under `## Three things it does`, draws the workflow a decision moves through,
 *     and that workflow is the gate's table (`DECISION_TRANSITIONS`) with the proof each move owes.
 *     The state a decision is born into and the one in force are the core's and the context package's
 *     answers, asked here rather than assumed.
 *   - TWO COUNTS THE PAGE HAD CARRIED FOR A WHILE, and one of them had gone wrong: the plugin's row
 *     said *"two hooks"* after the notes arrived beside the opening document and made them three.
 *     The hooks are counted off `plugin/hooks/hooks.json`, and the points where the format's
 *     document did not suffice off what the second reader itself lists (`mnema_verify.py gaps`).
 *
 * WHAT IT DOES NOT CHECK: the prose between them. "Handing the decision over moves the agent from
 * 33.3% to 100.0%" is held to the table's rates, but whether the sentence says what they MEAN is a
 * reviewer's question; so is every diagram on the page that draws a flow rather than a table.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { decisionDisposition } from '@mnema/context';
import { DECISION_STATES, DECISION_TRANSITIONS, INITIAL_DECISION_STATE } from '@mnema/core';
import { describe, expect, it } from 'vitest';
import { ROOT, read } from './support/published-examples.js';
import { linesOf } from './support/reading-a-shell-line.js';

/**
 * The pages this file rules on: each fact lives on the page that carries its section, since the
 * front page keeps only the sentence and the grid and the long form moved under `docs/`.
 */
const EVIDENCE = 'docs/evidence.md';
const HOW_IT_WORKS = 'docs/how-it-works.md';
const PACKAGES = 'docs/packages.md';
const VERIFY = 'docs/verify-without-installing.md';

/**
 * The body of a `##` section of the page — from under its heading to the next `##` that is a
 * heading, which a `##` inside a fence is not. It throws when the section is gone, because a case
 * that read an empty section would be a case saying nothing is wrong with what it never read.
 */
function sectionOf(page: string, heading: string, name = 'the page'): string {
  const raw = page.split('\n');
  const at = raw.indexOf(heading);
  if (at < 0) throw new Error(`${name} no longer carries "${heading}"`);
  const next = linesOf(page).find(
    (line) => line.fence === null && line.at > at + 1 && line.source.startsWith('## '),
  );
  return raw.slice(at + 1, next === undefined ? raw.length : next.at - 1).join('\n');
}

/** A table row's cells, trimmed. */
const cellsOf = (row: string): string[] =>
  row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());

/** A cell as a reader reads it: emphasis and code marks off. */
const plain = (cell: string): string => cell.replace(/\*\*|`/g, '');

/** How a small count is written in prose on this page. */
const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

/** The tens this page could write a count in, from twenty. */
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** A count in words — and a count this page would never write in words is refused, not guessed. */
function inWords(count: number): string {
  const word = WORDS[count];
  if (word !== undefined) return word;
  if (count < 20 || count > 99) throw new Error(`no word here for ${count}`);
  const [tens, units] = [Math.floor(count / 10), count % 10];
  return units === 0 ? (TENS[tens] as string) : `${TENS[tens]}-${WORDS[units]}`;
}

/** The rates the page shows, by arm: every table row whose first cell names one. */
function ratesOnThePage(section: string): Record<string, string> {
  return Object.fromEntries(
    section
      .split('\n')
      .filter((line) => line.startsWith('  | `'))
      .map((row) => {
        const cells = cellsOf(row.trim());
        return [plain(cells[0] as string), plain(cells[cells.length - 1] as string)];
      }),
  );
}

describe('the historical result the evidence page keeps', () => {
  const section = sectionOf(read(EVIDENCE), '## Historical', EVIDENCE);
  const prose = section.replace(/\s+/g, ' ');

  it('shows every arm, at the rate the sentence beside it moves from and to', () => {
    const rates = ratesOnThePage(section);
    expect(Object.keys(rates)).toEqual(['base', 'host', 'mnema-doc', 'mnema+']);
    expect(prose).toContain(`from ${rates['base']} to ${rates['mnema-doc']}`);
  });

  it('says what the rates are over — the day, the model, the cells and the runs', () => {
    expect(prose).toContain('21 August 2026');
    expect(prose).toContain('Claude Haiku 4.5');
    expect(prose).toContain('160 cells');
    expect(prose).toContain('four runs of each in every arm');
  });

  it('carries no link, because nothing in the tree reruns it', () => {
    expect(section.match(/\]\(/g) ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The decision's states
// ---------------------------------------------------------------------------

/** What each proof a move owes is called on the page. */
const OWED: Readonly<Record<string, string>> = { note: 'a note', reason: 'a reason' };

/** The transitions the page's state diagram draws, one line each, as written. */
function theDiagramDrawn(page: string): string[] {
  const section = sectionOf(page, '## Three things it does', HOW_IT_WORKS);
  const blocks: string[][] = [];
  let last = -2;
  for (const line of linesOf(section)) {
    if (line.fence !== 'mermaid') continue;
    if (line.at !== last + 1) blocks.push([]);
    (blocks.at(-1) as string[]).push(line.source.trim());
    last = line.at;
  }
  const diagram = blocks.find((block) => block[0] === 'stateDiagram-v2');
  if (diagram === undefined)
    throw new Error(`${HOW_IT_WORKS} no longer draws the decision's states`);
  return diagram.filter((line) => line.includes('-->'));
}

/** The same transitions, as the gate's own table has them. */
function theGatesTable(): string[] {
  return [
    `[*] --> ${INITIAL_DECISION_STATE}: recorded, with its rationale`,
    ...DECISION_TRANSITIONS.map(
      (move) =>
        `${move.from} --> ${move.to}: ${[move.action, ...move.requires.map((proof) => OWED[proof] ?? `<${proof}>`)].join(' · ')}`,
    ),
  ];
}

describe("the decision's states the how-it-works page draws", () => {
  const page = read(HOW_IT_WORKS);

  it('are the gate’s transitions, each with the proof it owes', () => {
    expect(theDiagramDrawn(page)).toEqual(theGatesTable());
  });

  it('say where a decision is born and which state is in force, as the product answers', () => {
    const prose = sectionOf(page, '## Three things it does', HOW_IT_WORKS).replace(/\s+/g, ' ');
    const inForce = DECISION_STATES.filter((state) => decisionDisposition(state) === 'in-force');
    expect(inForce).toHaveLength(1);
    expect(prose).toContain(
      `A decision enters \`${INITIAL_DECISION_STATE}\` and is in force once \`${inForce[0]}\``,
    );
  });

  it('reads a diagram that is there', () => {
    // NON-VACUITY: four moves and the birth, as the table has today.
    expect(theDiagramDrawn(page)).toHaveLength(DECISION_TRANSITIONS.length + 1);
    expect(DECISION_TRANSITIONS.length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// The counts the page takes from the rest of the repository
// ---------------------------------------------------------------------------

describe('the counts the docs take from the rest of the repository', () => {
  const packages = read(PACKAGES).replace(/\s+/g, ' ');
  const verifier = read(VERIFY).replace(/\s+/g, ' ');

  it('counts the plugin’s hooks as its declaration declares them, and when each runs', () => {
    const declared = JSON.parse(read('plugin/hooks/hooks.json')) as {
      hooks: Record<string, { hooks: unknown[] }[]>;
    };
    const per = (event: string): number =>
      (declared.hooks[event] ?? []).reduce((total, matcher) => total + matcher.hooks.length, 0);
    const all = Object.keys(declared.hooks).reduce((total, event) => total + per(event), 0);
    expect(packages).toContain(
      `The Claude Code plugin: ${inWords(all)} hooks — ${inWords(per('SessionStart'))} as a session opens, ${inWords(per('PreToolUse'))} at each edit (the one Claude Code runs, the one VS Code runs and the one Cursor runs, each skipped by the others), ${inWords(per('Stop'))} at the end of a response, ${inWords(per('PreCompact'))} before a compaction, ${inWords(per('SubagentStop'))} when a subagent stops —`,
    );
    // NON-VACUITY: the declaration is read, not assumed to be empty.
    expect(all).toBeGreaterThan(1);
  });

  it('counts the points the second reader lists where the document did not suffice', () => {
    const listed = execFileSync(
      'python3',
      [join(ROOT, 'packages/chain/verifier/mnema_verify.py'), 'gaps'],
      { encoding: 'utf-8' },
    );
    const counted = /^(\d+) gaps:/m.exec(listed);
    expect(counted, 'the second reader no longer says how many gaps it lists').not.toBeNull();
    expect(verifier).toContain(
      `found ${inWords(Number(counted?.[1]))} points where the specification was not enough`,
    );
  });
});
