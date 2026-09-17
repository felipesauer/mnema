/**
 * THE CONVERTER THIS PACKAGE PUBLISHES IS A CONVERTER THAT RUNS — and what it writes is
 * what the door takes.
 *
 * WHY IT IS PUBLISHED AT ALL, which is the measurement this guard stands over. The reader
 * takes ONE shape: a decision per file, a level-1 title, a why. Of four real decision
 * corpora on one machine, two follow it and two do not, and one project keeps 416 decided
 * things in a markdown TABLE — which this product will not learn, because a generic table
 * reader would still need somebody to declare which column is the title, which holds the
 * why, and which half of the file is history rather than agenda. Declaring all of that IS
 * writing the converter, in a worse language. So the page publishes the converter instead
 * of the product growing a door, and this holds the page to it.
 *
 * WHAT WENT WRONG THE FIRST TIME, said out loud because it is the thing this guards
 * against. The study that produced this section wrote its converter in twenty minutes with
 * the corpus open, the build in hand, and knowledge of which table section was which — and
 * called the cost cheap. That was the wrong cost measured: the reader of a published
 * converter has none of those. So what is published is generic, is thirty lines, names the
 * three things nobody can work out for them at the top, and is RUN HERE against a table
 * this test writes rather than against the one it was born from.
 *
 * THE PAGE'S OWN BYTES RUN, unedited. The block is lifted from `packages/code/README.md`
 * between its two markers and executed by `node` in a sandbox whose `DECISIONS.md` and
 * `docs/decisions` are the paths the published script already names — so a script that
 * only works after a reader edits something this test quietly supplied would not pass. A
 * page that publishes a converter that throws, or that writes files the import refuses,
 * goes red here rather than on somebody's first afternoon with this product.
 *
 * AND THE VERBS ON THAT PAGE ARE SOMEBODY ELSE'S SUBJECT.
 * `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts` resolves every `mnema …`
 * line of every tracked page against the real command tree, so the two shell blocks in
 * this section are covered there and are not restated here.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAdrDirectory } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecisionImport } from '../src/commands/decision-import.js';
import { runInit } from '../src/commands/init.js';
import { ROOT, read } from './support/published-examples.js';

/** The page, and the two markers that bound the block a reader is meant to copy. */
const PAGE = 'packages/code/README.md';
const BEGIN = '<!-- BEGIN converter -->';
const END = '<!-- END converter -->';

/**
 * The published converter's source, with the fence removed and nothing else touched.
 *
 * It throws rather than returning empty when a marker is gone: a guard that silently ran
 * nothing would be a guard reporting that a script it never executed works.
 */
function publishedConverter(): string {
  const page = read(PAGE);
  const from = page.indexOf(BEGIN);
  const to = page.indexOf(END);
  if (from < 0 || to < 0) throw new Error(`${PAGE} no longer marks the converter block`);
  const between = page.slice(from + BEGIN.length, to);
  const fence = /```js\n([\s\S]*?)```/.exec(between);
  if (fence === null) throw new Error(`${PAGE} marks the converter but publishes no js block`);
  return fence[1] as string;
}

/**
 * The table a reader would be converting FROM — written here, never taken from a corpus.
 *
 * It carries the two rows a table really has and a converter really has to survive: one
 * whose why cell is empty, and one whose why cell is a markdown rule. Both are what the
 * reader refuses by name, so skipping them here is the converter agreeing with the door
 * rather than a second opinion about what a reason is.
 */
const TABLE = `# The decisions of this project

| id | decision | why | ticket |
|----|----------|-----|--------|
| D1 | Store timestamps in UTC | three services send three zones | ABC-1 |
| D2 | Mint ids as uuidv7 | they sort by time, so a listing needs no index | ABC-2 |
| D3 | Retry three times | the budget is three and the fourth never helped | ABC-3 |
| D4 | Cache the projection |  | ABC-4 |
| D5 | Drop the legacy table | --- | ABC-5 |

Some prose after the table, which is not a row.
`;

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-converter-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A project, with the table at the root and the script beside it, as the page describes. */
function setup(): { repo: string; env: { home: string; xdgData?: string } } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'DECISIONS.md'), TABLE);
  writeFileSync(join(repo, 'convert-decisions.mjs'), publishedConverter());
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  const env = { home, xdgData: join(home, '.local', 'share') };
  runInit({ cwd: repo, env });
  return { repo, env };
}

describe('the converter this package publishes', () => {
  it('runs as published, and writes one document per row that states a decision', () => {
    const { repo } = setup();
    const said = execFileSync(process.execPath, ['convert-decisions.mjs'], {
      cwd: repo,
      encoding: 'utf8',
    });
    // Three of the five rows: the empty why and the `---` why are skipped, which is the
    // converter agreeing with the reader about what a reason is.
    expect(said.trim()).toBe('3 document(s) in docs/decisions, from 5 row(s) of DECISIONS.md');

    const written = readdirSync(join(repo, 'docs', 'decisions')).sort();
    expect(written).toEqual([
      '0001-store-timestamps-in-utc.md',
      '0002-mint-ids-as-uuidv7.md',
      '0003-retry-three-times.md',
    ]);
    // The shape the page says the door takes, in the bytes it produced.
    expect(readFileSync(join(repo, 'docs', 'decisions', written[0] as string), 'utf8')).toBe(
      '# Store timestamps in UTC\n\n## Context\n\nthree services send three zones\n',
    );
  });

  it('and the import reads every document it wrote, refusing none', () => {
    // THE POINT OF THE WHOLE SECTION. A converter whose output the door refuses is a
    // converter that wastes the afternoon it was published to save.
    const { repo, env } = setup();
    execFileSync(process.execPath, ['convert-decisions.mjs'], { cwd: repo, encoding: 'utf8' });

    // The dry run the page tells the reader to do first: nothing is written.
    const planned = runDecisionImport({ cwd: repo, env }, { from: 'docs/decisions', write: false });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.refused).toEqual([]);
    expect(planned.proposals.map((one) => one.title)).toEqual([
      'Store timestamps in UTC',
      'Mint ids as uuidv7',
      'Retry three times',
    ]);
    // The provenance is the file the converter wrote, so the plan a reader reads names
    // something they can open beside the row it came from.
    expect(planned.proposals.map((one) => one.path)).toEqual([
      'docs/decisions/0001-store-timestamps-in-utc.md',
      'docs/decisions/0002-mint-ids-as-uuidv7.md',
      'docs/decisions/0003-retry-three-times.md',
    ]);
    // The WHY survived the conversion. Asked through the same door the import uses, over
    // the bytes the converter wrote, so what is asserted is the reason that would be
    // recorded and not a second reading of the table.
    const scanned = scanAdrDirectory(join(repo, 'docs', 'decisions'));
    expect(scanned.refused).toEqual([]);
    expect(scanned.read.map((one) => one.rationale)).toEqual([
      'three services send three zones',
      'they sort by time, so a listing needs no index',
      'the budget is three and the fourth never helped',
    ]);
  });

  it('is really running the page and not a copy of it', () => {
    // NOT VACUOUS, and the cheapest way this whole file could lie: if the block were read
    // from anywhere but the tracked page, every case above would pass over a page nobody
    // had looked at since. The source must come out of the file `git` holds, and must be
    // the script the cases ran.
    const source = publishedConverter();
    expect(readFileSync(join(ROOT, PAGE), 'utf8')).toContain(source);
    expect(source).toContain("const SOURCE = 'DECISIONS.md';");
    expect(source).toContain("const OUT = 'docs/decisions';");
    // The three things the page says nobody can work out for the reader are the three
    // named at the top, where a reader looking for what to edit will find them.
    expect(source.split('\n').findIndex((line) => line.startsWith('const COLUMN'))).toBeLessThan(
      15,
    );
  });
});
