/**
 * THE FRONT PAGE SAYS WHAT ITS SOURCES SAY — each number it shows and each table it draws is read
 * off the file it came from, so the page cannot go on saying a fact its source stopped saying.
 *
 * THE PAGE COUNTS AND DRAWS TWO THINGS THAT ARE NOT ITS OWN, and this reads both from where they
 * live:
 *
 *   - THE MEASUREMENT. `## What was measured` shows four rates, the tasks and the runs they are
 *     over, the model, the day and the cells — and they are one round's, the report that section
 *     links to. Each is read out of that report here (its capture table, its rates, its task
 *     tables), and the report is found by the page's OWN link, so the page and this case cannot
 *     come to be about two different rounds. A number on the page that the report does not carry
 *     is red, and so is a report the page stopped citing.
 *   - THE DECISION'S STATES. `## Three things it does` draws the workflow a decision moves through,
 *     and that workflow is the gate's table (`DECISION_TRANSITIONS`) with the proof each move owes.
 *     The state a decision is born into and the one in force are the core's and the copilot's
 *     answers, asked here rather than assumed.
 *
 * WHAT IT DOES NOT CHECK: the prose between them. "Handing the decision over moves the agent from
 * 33.3% to 100.0%" is held to the rates, but whether the sentence says what they MEAN is a
 * reviewer's question; so is every diagram on the page that draws a flow rather than a table.
 */

import { decisionDisposition } from '@mnema/copilot';
import { DECISION_STATES, DECISION_TRANSITIONS, INITIAL_DECISION_STATE } from '@mnema/core';
import { describe, expect, it } from 'vitest';
import { read } from './support/published-examples.js';
import { linesOf } from './support/reading-a-shell-line.js';

/** The page this file rules on. */
const PAGE = 'README.md';

/**
 * The body of a `##` section of the page — from under its heading to the next `##` that is a
 * heading, which a `##` inside a fence is not. It throws when the section is gone, because a case
 * that read an empty section would be a case saying nothing is wrong with what it never read.
 */
function sectionOf(page: string, heading: string): string {
  const raw = page.split('\n');
  const at = raw.indexOf(heading);
  if (at < 0) throw new Error(`${PAGE} no longer carries "${heading}"`);
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
];

/** A count in words — and a count this page would never write in words is refused, not guessed. */
function inWords(count: number): string {
  const word = WORDS[count];
  if (word === undefined) throw new Error(`no word here for ${count}`);
  return word;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

/** What the page's measurement section says, and what the round's report behind it says. */
interface Round {
  /** The rate of every arm, as the report prints it: `33.3%`. */
  readonly rates: Readonly<Record<string, string>>;
  readonly headline: number;
  readonly controls: number;
  readonly development: number;
  readonly cells: number;
  readonly tasks: number;
  readonly arms: number;
  readonly runs: number;
  /** The model, as a reader names it: `Claude Haiku 4.5`. */
  readonly model: string;
  /** The day it ran, as the page writes a day: `21 August 2026`. */
  readonly day: string;
}

/** The report the section cites for its numbers: the one link it carries that ends in `report.md`. */
function theReportCited(section: string): string {
  const cited = [...section.matchAll(/\]\(([^)\s]+\/report\.md)\)/g)].map((link) => link[1]);
  if (cited.length !== 1) {
    throw new Error(
      `the measurement section cites ${cited.length} reports, where it should cite one`,
    );
  }
  return cited[0] as string;
}

/** The row of a report's key-value table whose key is `key`, or a refusal. */
function rowOf(lines: readonly string[], key: string): string[] {
  const row = lines.find((line) => line.startsWith(`| ${key} |`));
  if (row === undefined) throw new Error(`the report has no "${key}" row`);
  return cellsOf(row);
}

/** Everything the page's numbers are measured against, read out of the round's report. */
function theRound(report: string): Round {
  const lines = report.split('\n');
  // THE RATES: the row that says it is the mean over the headline tasks, under the header naming
  // the arms — which is how the report prints its headline table.
  const mean = lines.findIndex((line) => line.startsWith('| **mean of the per-task rates** |'));
  if (mean < 0) throw new Error('the report has no mean over its headline tasks');
  let header = mean;
  while (header >= 0 && !(lines[header] as string).startsWith('| task |')) header -= 1;
  const arms = cellsOf(lines[header] as string)
    .slice(1)
    .map(plain);
  const rates = cellsOf(lines[mean] as string)
    .slice(1)
    .map(plain);
  // THE TASKS: the headline table's rows between its header and its mean, and the other table's
  // rows marked as a control or as a development task.
  const headline = lines.slice(header + 2, mean).filter((line) => line.startsWith('| `')).length;
  const rowsOfTasks = lines.filter((line) => /^\| `[a-z0-9-]+` \(/.test(line));
  const controls = rowsOfTasks.filter((line) => line.includes('(control)')).length;
  const development = rowsOfTasks.filter((line) => line.includes('(dev')).length;
  const capture = /(\d+) cells — (\d+) tasks × (\d+) arms × (\d+) runs/.exec(
    rowOf(lines, 'capture')[1] as string,
  );
  if (capture === null) throw new Error('the report no longer says what its capture is made of');
  const model = /`claude-([a-z]+)-(\d+)-(\d+)-\d{8}`/.exec(rowOf(lines, 'model')[1] as string);
  if (model === null) throw new Error('the report no longer names its model');
  const family = model[1] as string;
  const ran = /^(\d{4})-(\d{2})-(\d{2})/.exec(rowOf(lines, 'ran')[1] as string);
  if (ran === null) throw new Error('the report no longer says the day it ran');
  return {
    rates: Object.fromEntries(arms.map((arm, at) => [arm, rates[at] as string])),
    headline,
    controls,
    development,
    cells: Number(capture[1]),
    tasks: Number(capture[2]),
    arms: Number(capture[3]),
    runs: Number(capture[4]),
    model: `Claude ${family[0]?.toUpperCase()}${family.slice(1)} ${model[2]}.${model[3]}`,
    day: `${Number(ran[3])} ${MONTHS[Number(ran[2]) - 1]} ${ran[1]}`,
  };
}

/** The rates the page shows, by arm: every table row whose first cell names one. */
function ratesOnThePage(section: string): Record<string, string> {
  return Object.fromEntries(
    section
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((row) => {
        const cells = cellsOf(row);
        return [plain(cells[0] as string), plain(cells[cells.length - 1] as string)];
      }),
  );
}

describe('the measurement the front page shows', () => {
  const section = sectionOf(read(PAGE), '## What was measured');
  const cited = theReportCited(section);
  const round = theRound(read(cited));

  it('shows every arm of the round, at the rate its report gives it', () => {
    expect(ratesOnThePage(section)).toEqual(round.rates);
  });

  it('says what the rates are over — the tasks, the runs, the model, the day and the cells', () => {
    const prose = section.replace(/\s+/g, ' ');
    const said = [
      `${inWords(round.headline).replace(/^./, (first) => first.toUpperCase())} tasks`,
      `${inWords(round.runs)} runs`,
      round.model,
      round.day,
      `${round.cells} cells`,
      `the ${inWords(round.controls)} negative controls`,
      `the ${inWords(round.development)} development tasks`,
    ];
    expect(said.filter((phrase) => !prose.includes(phrase))).toEqual([]);
    // The column says what the rate is over, in the same count.
    expect(prose).toContain(`over the ${inWords(round.headline)} tasks`);
  });

  it('says the rise the table shows, in the table’s own numbers', () => {
    const prose = section.replace(/\s+/g, ' ');
    expect(prose).toContain(`from ${round.rates.base} to ${round.rates['mnema-doc']}`);
  });

  it('reads a report whose own numbers add up, so the page is not agreeing with a broken one', () => {
    // NON-VACUITY, and a check on the reading: the capture is every task in every arm, four runs
    // each, and the tasks are the headline, the controls and the development tasks — nothing else.
    expect(cited).toBe('measurements/p1/results/2026-08-21-full/report.md');
    expect(round.cells).toBe(round.tasks * round.arms * round.runs);
    expect(round.tasks).toBe(round.headline + round.controls + round.development);
    expect(Object.keys(round.rates)).toHaveLength(round.arms);
    expect(round.model).toBe('Claude Haiku 4.5');
  });
});

// ---------------------------------------------------------------------------
// The decision's states
// ---------------------------------------------------------------------------

/** What each proof a move owes is called on the page. */
const OWED: Readonly<Record<string, string>> = { note: 'a note', reason: 'a reason' };

/** The transitions the page's state diagram draws, one line each, as written. */
function theDiagramDrawn(page: string): string[] {
  const section = sectionOf(page, '## Three things it does');
  const blocks: string[][] = [];
  let last = -2;
  for (const line of linesOf(section)) {
    if (line.fence !== 'mermaid') continue;
    if (line.at !== last + 1) blocks.push([]);
    (blocks.at(-1) as string[]).push(line.source.trim());
    last = line.at;
  }
  const diagram = blocks.find((block) => block[0] === 'stateDiagram-v2');
  if (diagram === undefined) throw new Error(`${PAGE} no longer draws the decision's states`);
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

describe("the decision's states the front page draws", () => {
  const page = read(PAGE);

  it('are the gate’s transitions, each with the proof it owes', () => {
    expect(theDiagramDrawn(page)).toEqual(theGatesTable());
  });

  it('say where a decision is born and which state is in force, as the product answers', () => {
    const prose = sectionOf(page, '## Three things it does').replace(/\s+/g, ' ');
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
