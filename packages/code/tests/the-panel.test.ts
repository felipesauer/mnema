/**
 * THE PANEL THE CONSOLE OPENS WITH — the name drawn, the text beside it, and the decisions
 * it forced.
 *
 * ⚠️ IT WAS A BOX WITH A TITLE ON ITS BORDER, and this file was written around the frame:
 * which rows were the box's, which of the two boxed forms was drawn, how wide the frame ran.
 * THE FRAME IS GONE — the console this was measured against writes its name, its build and
 * its context as text beside its logo and draws none — so every one of those questions had to
 * be asked of something that is still there. What replaced each is named where it is, and the
 * absence itself is a case: *nothing on the page is a frame, at any size*.
 *
 * Everything else this surface draws is a line. This is a DRAWING: it has a width, it has an
 * arrangement, and it has a hue that says nothing about the record. Each of those is a way for
 * a surface built on "say exactly what is true and nothing more" to start saying something
 * else, so each has a case here:
 *
 *   - CHROME IS NOT DATA, AND THE TWO MAY NOT MEET. Colour on this surface means severity
 *     (`presentation/styled.ts`, and the three hues it paints). The mark and the row that says
 *     what the session is are chrome, so the rule gained a second axis rather than an
 *     exception: chrome carries ONE accent, it is spent in one module, and it is none of the
 *     three. Both halves are asserted, and the second against the escapes a severity really
 *     produces rather than against a number typed here.
 *   - THE PANEL SAYS LESS THAN `verify` AND NEVER SOMETHING ELSE. It has room for one line
 *     per tree, so it shows the clause that IS the verdict and drops the ones that qualify
 *     it — which is safe only if what is left is literally a PREFIX of the sentence the
 *     verb prints. That is what is asserted, tree by tree, over a real record.
 *   - THE FORM COMES OUT OF THE CONTENT. A row wider than the terminal is folded, and nothing
 *     inside an arrangement may fold, so there are three forms and the widest that fits is
 *     drawn. The threshold is asserted as a PROPERTY — at the width a form gives way at, it
 *     still fits; one column narrower it is gone — so no number in this file can drift from
 *     the drawing.
 *
 * WHY COLOUR IS FORCED ON HERE, against what every other test of this surface does. The
 * others clear `FORCE_COLOR` because what a session prints may not depend on the
 * developer's shell. Here the paint IS the subject: the layout asks its own library whether
 * the stream takes colour, and a stream that said no would make every case about the accent
 * pass by drawing nothing at all.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runVerify, type TreeReport } from '../src/commands/verify.js';
import { bannerFor } from '../src/presentation/banner.js';
import { SEVERITIES } from '../src/presentation/line.js';
import { renderPlain } from '../src/presentation/plain.js';
import type { Render } from '../src/presentation/render.js';
import { renderStyled } from '../src/presentation/styled.js';
import { statement } from '../src/presentation/verdict.js';
import { type PanelForm, panelFor } from '../src/repl/panel.js';
import { openSession, tips } from '../src/repl/session.js';
import { LEAVE } from '../src/session-words.js';
import { here } from '../src/wiring/context.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { DEFAULT_REQUIREMENT, treeHeadline } from '../src/wiring/verify.js';
import { fakeTerminal, hooksNothing, until, withoutLayout } from './support/console.js';

/** `packages/code/src`, for the guard that reads the product's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';

/**
 * WHAT A FRAME IS MADE OF: the four corners it turns at, the vertical its sides run down,
 * and the horizontal its edges run along.
 *
 * Named by their code points rather than typed, like every other unusual byte in this
 * repository's sources: a rule is one keystroke away from a pipe and a run from a hyphen,
 * and a character a reader cannot tell from another one is a character an edit destroys
 * without anybody seeing it happen.
 *
 * \u26a0\ufe0f THREE OF THEM WERE ALL THIS FILE NEEDED, because a frame was drawn and finding it was
 * enough. What is asked now is the opposite \u2014 that there is NONE \u2014 and the difference is why
 * the corners are all four: absence has to be asked of every character the thing is made of,
 * where presence only ever needed one.
 */
const CORNERS = ['\u256d', '\u256e', '\u256f', '\u2570'];
const RULE = '\u2502';
const RUN = '\u2500';

/** Ctrl-C, which abandons the row being typed. Spelled out, for the same reason. */
const CLEARS_THE_LINE = '\u0003';

/** How deep a line of a section sits under its heading — the session's own constant. */
const UNDER_A_HEADING = 1;

/** What the chain says about a tree in order, and the panel repeats: the words to look for. */
const VERIFIED = 'local integrity verified';

/** What the record's one section is called — the session's own heading. */
const THE_RECORD = 'The record';

/**
 * The first words of the one sentence the session lands UNDER the panel.
 *
 * It is what bounds the opening's rows from below now that no bottom edge does, and it is the
 * FIRST words rather than the whole sentence because a narrow terminal folds it
 * (`session.ts`, `whatItRefuses`; `presentation/folded.ts`).
 */
const UNDER_THE_PANEL = 'It runs the';

/** How rich each form is, so "never richer on a narrower terminal" can be an ordering. */
const RICHNESS: Readonly<Record<PanelForm, number>> = { columns: 2, stacked: 1, bare: 0 };

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` at the shell, in this process, and every line it wrote. */
async function shell(...argv: string[]): Promise<string[]> {
  const said: string[] = [];
  await run(argv, {
    out: (line) => said.push(line),
    err: (line) => said.push(line),
    fail: () => undefined,
  });
  return said;
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-panel-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  delete process.env.NO_COLOR;
  // The one place on this surface that asks for colour rather than clearing it: see the
  // header. Set before anything imports the layout, which is loaded on the first open.
  process.env.FORCE_COLOR = '1';
  process.chdir(project);

  await shell('init');
  await shell('task', 'the task the console is opened over');
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

/** What a console drew, opened on a terminal `columns` wide and left again. */
async function openedAt(columns: number, render: Render = renderPlain): Promise<string> {
  const terminal = fakeTerminal({ columns });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    render,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes(OPENED), 'opened');
  terminal.type(`${LEAVE}\r`);
  await closed;
  return terminal.bytes();
}

/** Every SGR sequence in some bytes, in the order they appear. */
function sgrOf(text: string): string[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
  return text.match(/\u001b\[[0-9;]*m/g) ?? [];
}

/** The same bytes with every style sequence taken out — what a pipe would have received. */
function stripped(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** The page as rows, with everything a layout writes to place a line taken out. */
function rowsOf(page: string): string[] {
  return stripped(withoutLayout(page)).split('\n');
}

/**
 * THE ROWS OF THE OPENING: from the first row with anything on it down to the sentence the
 * session lands under the panel.
 *
 * ⚠️ IT WAS `boxRows`, AND THE FRAME WAS THE INSTRUMENT: a row of the box began at the left
 * edge of the screen with a corner or a side, which no row inside it ever did. There is no
 * frame to ask, so what bounds the panel is what is above it and what is below it — a page
 * that has been carried into the scrollback and the one sentence that is landed rather than
 * arranged (`session.ts`, `whatItRefuses`). Renamed, because it answers a different set of
 * rows: it holds the ones the frame's own edges used to be.
 */
function openingRows(page: string): string[] {
  const rows = rowsOf(page);
  const first = rows.findIndex((row) => row.trim().length > 0);
  const under = rows.findIndex((row) => row.includes(UNDER_THE_PANEL));
  expect(first, 'nothing at all was drawn').toBeGreaterThanOrEqual(0);
  expect(under, 'the sentence under the panel is not on the page').toBeGreaterThan(first);
  return rows.slice(first, under);
}

/**
 * WHERE A FRAME WOULD BE ON THESE ROWS — one complaint per reason to think one was drawn, and
 * none at all when there is none.
 *
 * TWO CHARACTERS, TWO RULES, AND NEITHER IS *any glyph of a box*. That distinction is the
 * whole instrument: the input area draws two rules of its own out of {@link RUN}, and a drawing
 * of the name is one edit away from being inked with {@link RULE} again — the isometric form
 * was, and it made four cases of this surface mistake the art for the frame. So:
 *
 *   - A CORNER IS ALWAYS A FRAME. Nothing else on this surface turns a corner, and all four
 *     are asked rather than one, because absence has to be asked of every character the thing
 *     is made of where presence only ever needed one.
 *   - A SIDE IS THE VERTICAL IN THE SAME COLUMN OF TWO ROWS RUNNING. A rule of a frame runs
 *     down; a vertical of the art is in a different column on every row of it, and a row of
 *     text holds none.
 *
 * A run of {@link RUN} is NOT accused, and that is deliberate rather than an omission: an edge
 * made of it ends at corners, which the first rule already catches, and the two rules the
 * input sits between are made of nothing else (`region.ts`, `rule`).
 */
function theFrameOn(rows: readonly string[]): string[] {
  const found: string[] = [];
  for (const [at, row] of rows.entries()) {
    for (const corner of CORNERS) {
      if (row.includes(corner)) found.push(`the corner ${corner} on row ${at}`);
    }
  }
  for (let at = 1; at < rows.length; at++) {
    const above = [...(rows[at - 1] as string)];
    const below = [...(rows[at] as string)];
    for (let column = 0; column < Math.min(above.length, below.length); column++) {
      if (above[column] === RULE && below[column] === RULE) {
        found.push(`a side down column ${column} of rows ${at - 1} and ${at}`);
      }
    }
  }
  return found;
}

/**
 * Which arrangement is on the page, judged by what only that arrangement has.
 *
 * ⚠️ IT WAS JUDGED BY THE FRAME, twice over, and both readings are gone with it. It counted
 * the rules on one row first — three of them meant a column on each side of a divider — and
 * the art put as many as it liked on a row of its own; then it looked for a rule running
 * THROUGH the box, which is true of a frame whatever the art is made of and is true of nothing
 * now.
 *
 * WHAT REPLACES IT IS THE ARRANGEMENT ITSELF, which is what the name always meant:
 *
 *   - BESIDE THE MARK is the row that says what the session is beginning with a row of the ART.
 *     The art is asked of the module that draws it at the width this page was opened at, so a
 *     fifth form moves this case with it — and no stacked or landed row ever begins with it,
 *     because those begin at the left edge.
 *   - UNDER THE MARK is told from LANDED by the blank row over the record's section. The
 *     arrangement spends it and a landed line never can (`panel.ts`, `BETWEEN_SECTIONS`).
 */
function formOf(page: string, columns: number): PanelForm {
  const rows = openingRows(page);
  const title = rows.find((row) => row.includes(OPENED));
  expect(title, 'nothing on the page says what the session is').toBeDefined();
  const art = drawnAt(columns).filter((row) => row.trim().length > 0);
  if (art.some((row) => (title as string).startsWith(row))) return 'columns';
  const heading = rows.findIndex((row) => row.includes(THE_RECORD));
  expect(heading, 'the record has no section on this page').toBeGreaterThan(0);
  return (rows[heading - 1] as string).trim().length === 0 ? 'stacked' : 'bare';
}

/** How wide a row is on a screen, in characters. */
const widthOf = (row: string): number => [...row].length;

/**
 * The drawing of the name a terminal this wide gets, as the rows a plain renderer writes.
 *
 * The page it is on costs nothing, which is what holds the height out of the answer: this
 * file opens every console at one height and asks only about widths, and the name gives way
 * when the PAGE stops fitting rather than when the drawing does
 * (`presentation/banner.ts`).
 */
const drawnAt = (columns: number): string[] =>
  bannerFor({ columns, rows: 0, needs: () => 0 }).map(renderPlain);

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

// ---------------------------------------------------------------------------
// One accent, and it is none of the three
// ---------------------------------------------------------------------------

/**
 * Every colour a terminal layout takes BY NAME — the basic eight, both spellings of the
 * ninth, and the bright half.
 *
 * A NAME and not a code, and the two axes of colour on this surface are separated by
 * exactly that: `presentation/styled.ts` writes SGR numbers for severity, and the layout
 * says a word for chrome. So a scan for the words finds the chrome and nothing else.
 */
const HUES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray',
  'grey',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
];

/** The three that MEAN something about the record, and are therefore not chrome's to take. */
const SEMANTIC = ['red', 'green', 'yellow'];

/** Every `.ts` source of the product, recursively, tests excluded. */
function sourcesOf(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesOf(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

/** A source with its comments taken out, so prose cannot be read as code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Which hues a source NAMES: every quoted run that is one of them, whatever it is for. */
function huesIn(source: string): string[] {
  const literals = withoutComments(source).match(/'[^'\\\n]*'/g) ?? [];
  return literals.map((literal) => literal.slice(1, -1)).filter((word) => HUES.includes(word));
}

/** The hues a SEVERITY paints: what one adds to a line that carries none. */
function severityHues(): Set<string> {
  const bare = new Set(sgrOf(renderStyled(statement('LABEL', 'a detail'))));
  const hues = new Set<string>();
  for (const severity of SEVERITIES) {
    for (const code of sgrOf(renderStyled(statement('LABEL', 'a detail', severity)))) {
      if (!bare.has(code)) hues.add(code);
    }
  }
  // A renderer that painted nothing would make every comparison against this set pass.
  expect(hues.size).toBeGreaterThan(0);
  return hues;
}

/** The row of the page that says what the session is, with its escapes. */
function titleRow(page: string): string {
  const row = withoutLayout(page)
    .split('\n')
    .find((line) => line.includes(OPENED));
  expect(row, 'nothing on the page says what the session is').toBeDefined();
  return row as string;
}

/**
 * THE ACCENT AND THE ESCAPE THAT GIVES THE FOREGROUND BACK, read off the one row on the page
 * that carries nothing but them: a rule of the input area.
 *
 * ⚠️ IT WAS READ OFF THE BOX'S TOP EDGE — `boxLine`, found by the corner — and that worked for
 * a reason the frame's departure took away: a border is nothing but accent, so the first two
 * escapes on that row were the accent and its closer, adjacent. Every row the accent is on now
 * also carries a WEIGHT, because everything the panel paints came through a renderer that
 * emboldens a heading — so the second escape on the row is the bold, and a pair read from there
 * would be `magenta` and `bold` and would match nothing. Measured: two empty runs.
 *
 * A RULE IS WHAT IS LEFT that is drawn and not written (`region.ts`, `rule`), and reading the
 * pair there makes the case STRONGER rather than weaker: what is asserted below is that the
 * panel's chrome is wrapped in the very escapes the input area's rule is wrapped in, which is
 * `one accent` as an elo instead of as two readings.
 */
function theAccent(page: string): readonly [string, string] {
  const row = withoutLayout(page)
    .split('\n')
    .find((line) => {
      const bare = stripped(line).replace(/ +$/, '');
      return bare.length > 0 && [...bare].every((glyph) => glyph === RUN);
    });
  expect(row, 'no rule of the input area was drawn').toBeDefined();
  const [accent, closer] = sgrOf(row as string);
  expect(accent, 'the rule carries no colour at all').toBeDefined();
  expect(closer, 'the rule never gives the foreground back').toBeDefined();
  return [accent as string, closer as string];
}

/** The row of the page holding `what`, with its escapes. */
function rowHolding(page: string, what: string): string {
  const row = withoutLayout(page)
    .split('\n')
    .find((line) => line.includes(what));
  expect(row, `nothing on the page said ${what}`).toBeDefined();
  return row as string;
}

/**
 * Everything the accent WRAPS on one row: each run between an opener and its closer.
 *
 * Asking which characters the accent is around, rather than whether the accent is on the
 * row at all, is the only question worth asking here: what may not happen is the accent around
 * a word of the RECORD, and a row can carry chrome and a fact at once — the title's row does,
 * beside the mark. ⚠️ THE REASON GIVEN USED TO BE THE FRAME — *a row of the box has the frame at
 * each end of it* — and the frame is gone; the question it justified is the one that survived.
 */
function accented(row: string, accent: string, closer: string): string[] {
  const wrapped: string[] = [];
  for (let at = row.indexOf(accent); at >= 0; at = row.indexOf(accent, at + accent.length)) {
    const from = at + accent.length;
    const to = row.indexOf(closer, from);
    wrapped.push(row.slice(from, to < 0 ? row.length : to));
  }
  return wrapped;
}

describe('the chrome spends exactly one hue, and it is none of the three severities', () => {
  it('names one colour in the whole product, in one module', () => {
    // THE GUARD. Two accents is a second thing a border could mean; an accent that is one
    // of the severities is a frame that reads as a verdict about what it frames. The scan
    // is over the SOURCE and over all of it, because "the chrome is one hue" is a statement
    // about the product rather than about the file that happens to hold the box today.
    const named = new Map<string, string[]>();
    for (const file of sourcesOf(SRC)) {
      const hues = huesIn(readFileSync(file, 'utf-8'));
      if (hues.length > 0) named.set(file, hues);
    }
    const spent = [...new Set([...named.values()].flat())];
    expect(spent).toHaveLength(1);
    expect(SEMANTIC).not.toContain(spent[0]);
    // And in ONE place, so there is no second module that could come to disagree with it.
    expect([...named.keys()]).toHaveLength(1);
    // The scan read something: an empty corpus passes every line above saying nothing.
    expect(sourcesOf(SRC).length).toBeGreaterThan(50);
  });

  it('would accuse a second hue and a semantic one', () => {
    // The vacuous form is a scan whose pattern stopped matching. Composed against the two
    // lines somebody would actually write: a border painted green, and an accent that
    // acquired a companion.
    expect(huesIn("node(Box, { borderColor: 'green' })")).toEqual(['green']);
    expect(huesIn("const A = 'cyan';\nconst B = 'magenta';")).toEqual(['cyan', 'magenta']);
    // And it accuses neither prose nor a word that is not a colour.
    expect(huesIn("/* the border is green */\nconst a = 'round';")).toEqual([]);
  });

  it('paints the chrome in a hue no severity uses, and paints no line of the record', async () => {
    // THE OTHER HALF, asked of the BYTES rather than of the source: what the chrome is wrapped
    // in must not be what a verdict is wrapped in. The severities' escapes are taken from the
    // renderer itself — what a severity ADDS to a line that has none — so nothing here is a
    // number somebody typed.
    //
    // ⚠️ THE ACCENT USED TO BE READ OFF THE BOX'S TOP EDGE, and where it is read from now is
    // {@link theAccent}, which says why.
    const page = await openedAt(200, renderStyled);
    const [accent, closer] = theAccent(page);
    expect([...severityHues()]).not.toContain(accent);
    // WHAT THE ACCENT IS AROUND, which is the only form of the question worth asking. What may
    // not happen is the accent around a WORD OF THE RECORD.
    const verdict = rowHolding(page, VERIFIED);
    for (const run of accented(verdict, accent as string, closer as string)) {
      expect(stripped(run), run).not.toContain(VERIFIED);
    }
    // Not vacuous, in both directions. The verdict really is painted — by the severity it
    // carries, on the row the accent was just cleared of…
    expect([...severityHues()].some((hue) => sgrOf(verdict).includes(hue))).toBe(true);
    // …and the accent really is around the two things that ARE chrome: what the session is,
    // and the mark. A layout that had stopped painting would satisfy the loop above saying
    // nothing.
    //
    // ⚠️ THE THIRD USED TO BE THE FRAME, and it was asserted by looking for a run of nothing
    // but the frame's own glyph inside an accented span. There is no frame, so what is asked is
    // the pair that is left — and the title is the one that MOVED into the switch this
    // delivery, so a layout that had stopped painting it would go red here rather than quietly.
    expect(
      accented(titleRow(page), accent as string, closer as string).map(stripped),
      'what the session is is not painted',
    ).toContainEqual(expect.stringContaining(OPENED));
    // ⚠️ THE MARK USED TO BE FOUND BY ITS GLYPH, and a change of drawing is what falsified
    // that: the widest form was inked with diagonals rather than with blocks, so a page two
    // hundred columns wide held no full block at all. ⚠️ AND THE DRAWING AFTER IT IS FULL OF
    // BLOCKS AGAIN, which is exactly why the glyph is not what this asks: the art has changed
    // twice under this case and both times the answer to *which glyph is the mark made of*
    // moved. What the drawing IS is asked of the module that draws it, at the size this page
    // was opened at, so the next form moves this case with it.
    const widest = drawnAt(200).reduce((most, row) => (row.length > most.length ? row : most));
    const mark = rowHolding(page, widest);
    expect(
      accented(mark, accent as string, closer as string).some((run) => run.includes(widest)),
      'the mark is not painted',
    ).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// There is no frame, on any screen
// ---------------------------------------------------------------------------

describe('nothing on the page is a frame, at any size', () => {
  it('draws no corner and no side, at seven widths and both extremes', async () => {
    // WHAT THIS DELIVERY REMOVED, asked as an absence — and asked across the whole ladder,
    // because the frame was drawn by the two arranged forms and not by the landed one: a sweep
    // that only looked at wide terminals would be looking at one of the three answers.
    for (const columns of [200, 140, 120, 102, 80, 48, 46, 40, 30]) {
      const rows = openingRows(await openedAt(columns));
      expect(theFrameOn(rows), `${columns}: ${theFrameOn(rows).join('; ')}`).toEqual([]);
      // And the page really was drawn, so the absence is about a drawing rather than an empty
      // slice of rows.
      expect(rows.join('\n'), `${columns}: nothing was drawn`).toContain(OPENED);
    }
  }, 300_000);

  it('would accuse a frame, and accuses neither the rules nor the art', () => {
    // THE INSTRUMENT'S OWN CASE, because a scan for an absence is the shape of guard that is
    // born vacuous. Composed against the box this delivery took out, row for row.
    expect(theFrameOn(['╭─ a title ─╮', '│  inside   │', '╰───────────╯']).length).toBeGreaterThan(
      0,
    );
    // Each half on its own, so neither is carried by the other: a corner with no side, and a
    // side with no corner.
    expect(theFrameOn([`${CORNERS[0]}${RUN.repeat(4)}`])).toHaveLength(1);
    expect(theFrameOn([`${RULE} a`, `${RULE} b`])).toHaveLength(1);
    // ⛔ AND IT ACCUSES NEITHER OF THE TWO THINGS THIS SURFACE REALLY DRAWS. The input area's
    // rules are runs of the horizontal with nothing at either end, and the art is one edit away
    // from holding the vertical again — in a different column on every row, which is what tells
    // it from a side.
    expect(theFrameOn([RUN.repeat(40), RUN.repeat(40)])).toEqual([]);
    expect(theFrameOn([`${RULE}  x`, `  ${RULE}x`, `x  ${RULE}`])).toEqual([]);
    expect(theFrameOn(drawnAt(200))).toEqual([]);
    expect(theFrameOn(drawnAt(46))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The panel says less than the verb, and never something else
// ---------------------------------------------------------------------------

/** Every tree of this project's record, and the verdict over each. */
function everyTree(): readonly TreeReport[] {
  const verdict = runVerify({ ...here(), requirement: DEFAULT_REQUIREMENT, global: false });
  if (!verdict.ok) throw new Error('the fixture is not a project');
  return verdict.trees;
}

describe('what the panel says about a tree is a prefix of what verify says', () => {
  it('holds for every tree of a real record, and shortens at least one of them', async () => {
    // THE INVARIANT that makes a one-line verdict safe on a surface that must never upgrade
    // a guarantee. The panel drops the clauses that QUALIFY the verdict; if what were left
    // was reworded rather than cut, it would stop being a prefix.
    const trees = everyTree();
    expect(trees.length).toBeGreaterThan(1);
    // Stripped, because this fixture forces colour on and what is compared is the words:
    // that the two renderings say the same thing is the promise of another file.
    const said = (await shell('verify')).map(stripped);
    let shortened = 0;
    for (const tree of trees) {
      const short = renderPlain(treeHeadline(tree, UNDER_A_HEADING)).trimStart();
      const whole = said.find((line) => line.startsWith(tree.scope));
      expect(whole, tree.scope).toBeDefined();
      expect((whole as string).startsWith(short), `${tree.scope}: ${whole}`).toBe(true);
      if ((whole as string).length > short.length) shortened++;
    }
    // A panel that showed the whole sentence would satisfy every line above. At least one
    // tree really is shortened, which is what the panel exists to make room for.
    expect(shortened).toBeGreaterThan(0);
  }, 120_000);

  it('puts those very lines on the page', async () => {
    // THE ELO. The invariant above is about a function; this is about what a reader sees,
    // because a panel that composed its record section any other way would satisfy it and
    // still print something else.
    const page = stripped(withoutLayout(await openedAt(200)));
    for (const tree of everyTree()) {
      expect(page, tree.scope).toContain(renderPlain(treeHeadline(tree, UNDER_A_HEADING)).trim());
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// How much fits, and what gives way first
// ---------------------------------------------------------------------------

/**
 * The widths this file walks, and the form the console draws at each of them — scanned
 * once, because every question below is about the same ladder.
 *
 * ⚠️ IT WAS A BINARY SEARCH, on the premise that a wider terminal never gets a simpler
 * drawing. WHAT FALSIFIED IT is the fourth form of the name: a terminal wide enough for the
 * biggest drawing buys a drawing wider than a box has room for, so there is a band where the
 * box is given up and the art is landed bare — and a search that halves an interval over a
 * predicate that goes false and true again lands wherever the halving took it. The window is
 * wide enough to hold both edges and the case below asserts that it does.
 */
const A_WINDOW = { widest: 140, narrowest: 40 } as const;

/**
 * A TERMINAL A PERSON OPENS — a hundred and twenty columns, and it is a SIZE rather than a
 * threshold.
 *
 * It is the width the defect this panel's last two deliveries were reported from was measured
 * at: a window that wide got the stacked form and a column of blank rows beside the record,
 * because the two-column arrangement cost 124 columns while the art was seventy wide. Nothing
 * below asserts what the threshold IS — that is searched for — only that it is under a size
 * somebody really has.
 */
const A_WORKING_TERMINAL = 120;

/** The scan, done once and kept: about a hundred openings, twenty milliseconds each. */
let theLadder: Map<number, PanelForm> | undefined;
async function everyWidth(): Promise<ReadonlyMap<number, PanelForm>> {
  if (theLadder !== undefined) return theLadder;
  const walked = new Map<number, PanelForm>();
  for (let columns = A_WINDOW.widest; columns >= A_WINDOW.narrowest; columns -= 1) {
    walked.set(columns, formOf(await openedAt(columns), columns));
  }
  theLadder = walked;
  return walked;
}

/**
 * The narrowest terminal of the TOP band on which the drawing is still at least this rich
 * — walked down from the widest, so a band below a gap cannot be mistaken for this one.
 */
async function narrowestFor(richness: number): Promise<number> {
  const ladder = await everyWidth();
  const rich = (columns: number): boolean => RICHNESS[ladder.get(columns) as PanelForm] >= richness;
  expect(rich(A_WINDOW.widest), 'the window does not start rich enough').toBe(true);
  let edge = A_WINDOW.widest;
  while (edge > A_WINDOW.narrowest && rich(edge - 1)) edge -= 1;
  expect(edge, 'the window has no edge in it for this form').toBeGreaterThan(A_WINDOW.narrowest);
  return edge;
}

describe('the form comes out of the content, and the narrowest still says the essential', () => {
  it('puts the ONE section IN THE ARRANGEMENT, heading and all', async () => {
    // What the panel is FOR, asserted where the panel is.
    //
    // ⚠️ IT USED TO SAY `both sections`, and the second was `Hints` — a heading over one
    // sentence naming the word that lists the verbs. It went, and this case is renamed
    // rather than shortened: what a caller can type is said under the prompt, where it
    // does not scroll away, and a panel that repeated it was the copy nobody could see after
    // ten reads. So the assertion is now two-sided — the record's section is in the panel,
    // and nothing of the second one is.
    //
    // ⚠️ AND `INSIDE THE BOX` BECAME `IN THE ARRANGEMENT`, which is the rename the frame's
    // departure forced: the rows were found by the box's own sides, and they are bounded by
    // what is above and below the panel now ({@link openingRows}).
    const rows = openingRows(await openedAt(200));
    for (const said of ['The record', VERIFIED]) {
      expect(
        rows.some((row) => row.includes(said)),
        said,
      ).toBe(true);
    }
    for (const gone of ['Hints', 'says what it runs']) {
      expect(
        rows.some((row) => row.includes(gone)),
        gone,
      ).toBe(false);
    }
  }, 120_000);

  it('draws all three, and never a richer one on a narrower terminal', async () => {
    // ⚠️ THIS CASE HAS BEEN WRITTEN THREE TIMES AND THE ART MOVED IT EVERY TIME. It began as
    // `never a richer one on a narrower terminal` over five sampled widths; a seventy-column
    // drawing FALSIFIED that, because a terminal wide enough to be given the art was not
    // always wide enough to put a BOX around it, so there was a band — one column of the
    // ladder — where widening the window cost the frame. The five widths it sampled all
    // missed it, so it was rewritten to walk every width in the window and to allow the
    // exception on one condition: where a narrower terminal is richer, the ART is what grew.
    //
    // ⚠️ AND THE EXCEPTION IS GONE, WHICH IS WHY THE NAME IS THE FIRST ONE AGAIN. Measured:
    // the drawing is fifty columns now and the line under it — a project's path and an
    // identity — is about forty-nine, so giving the art up buys the column almost nothing and
    // the stacked form is unreachable either way. The band closed by ARITHMETIC rather than by
    // anybody's intention, and the assertion is written as the count so that the day it
    // reopens this case says which width it reopened at.
    //
    // WHAT SURVIVES IS THE RULE WITH ITS REASON, and it survives as a guard rather than as an
    // observation: the drawing only gets simpler as the terminal narrows, and where it does
    // not, the ART has to be what changed. The loop rules on every step of the ladder; that
    // no step needs the excuse today is the assertion under it.
    const ladder = await everyWidth();
    expect(new Set(ladder.values())).toEqual(new Set(['columns', 'stacked', 'bare']));
    let boughtArtInstead = 0;
    let steps = 0;
    for (let columns = A_WINDOW.widest; columns > A_WINDOW.narrowest; columns -= 1) {
      steps += 1;
      const wider = RICHNESS[ladder.get(columns) as PanelForm];
      const narrower = RICHNESS[ladder.get(columns - 1) as PanelForm];
      if (narrower <= wider) continue;
      boughtArtInstead += 1;
      expect(
        widthOf(drawnAt(columns).reduce((most, row) => (row.length > most.length ? row : most))),
        `${columns} is simpler than ${columns - 1} and the drawing did not grow`,
      ).toBeGreaterThan(
        widthOf(
          drawnAt(columns - 1).reduce((most, row) => (row.length > most.length ? row : most)),
        ),
      );
    }
    // THE LADDER IS ONE-WAY, with no step needing the art to explain it.
    expect(boughtArtInstead, 'a narrower terminal is richer somewhere in the window').toBe(0);
    // NOT VACUOUS: the walk really covered the window, so "no step" is a statement about a
    // hundred steps rather than about an empty loop — and the window really holds three
    // different forms, asserted above, so the ladder it walked is not one answer repeated.
    expect(steps).toBe(A_WINDOW.widest - A_WINDOW.narrowest);
    expect(new Set(ladder.values()).size).toBe(3);
  }, 180_000);

  it('stands in two columns on the terminal a person opens, with the biggest art in it', async () => {
    // WHAT THE NEW DRAWING BOUGHT, and the reason it is a case rather than a note: the box
    // gave the two columns up at 124 columns while the art was seventy wide, so a window of
    // a hundred and twenty — an ordinary one, and the one this was reported from — got the
    // stacked form and nine blank rows beside the record. The art is fifty columns now and
    // the threshold is the content's, so it moved with it.
    //
    // THE THRESHOLD IS NOT WRITTEN HERE. {@link A_WORKING_TERMINAL} is a SIZE — a window a
    // person has — and where the form gives way is searched for off the ladder, so this case
    // says the threshold is under that size rather than what the threshold is.
    const edge = await narrowestFor(RICHNESS.columns);
    expect(edge, 'the two columns cost more than a terminal a person opens').toBeLessThanOrEqual(
      A_WORKING_TERMINAL,
    );
    expect(formOf(await openedAt(A_WORKING_TERMINAL), A_WORKING_TERMINAL)).toBe('columns');
    // AND THE ART DID NOT PAY FOR THEM. The two columns are worth nothing if the drawing gave
    // way to get them, so the mark on that page is the biggest form there is.
    expect(drawnAt(A_WORKING_TERMINAL), 'the art gave way to buy the columns').toEqual(
      drawnAt(200),
    );
    // Not vacuous: the ladder really does have a stacked band under that width, so the
    // comparison above is about a threshold that exists.
    expect(edge, 'every width in the window draws two columns').toBeGreaterThan(A_WINDOW.narrowest);
  }, 300_000);

  it('gives each form up at the width its own content stops fitting at', async () => {
    // THE THRESHOLD, asserted as a property of the DRAWING rather than as a number. For
    // each of the two arranged forms: at the width it gives way at it is drawn and every row of
    // it fits across the terminal; one column narrower it is not that form any more. Nothing in
    // this case knows how wide anything is.
    //
    // ⚠️ WHAT `FITS` MEANT WAS THE FRAME, and the frame is what this delivery removed. It read
    // the widths of the box's own rows, refused a ragged one, and asserted that they were the
    // width of the TERMINAL — the box was drawn corner to corner, so its own edge was the
    // witness. Nothing is drawn to an edge now, so the property is asked of the rows the panel
    // really has: none of them is WIDER than the terminal, which is the invariant the form was
    // ever chosen for (`panel.ts`, `panelRows`: nothing inside an arrangement folds).
    for (const [form, richness] of [
      ['columns', RICHNESS.columns],
      ['stacked', RICHNESS.stacked],
    ] as const) {
      const edge = await narrowestFor(richness);
      const page = await openedAt(edge);
      expect(formOf(page, edge), `${form} at ${edge}`).toBe(form);
      const rows = openingRows(page).map(widthOf);
      // BOTH HALVES IN ONE NUMBER, and that is why it is an equality rather than a bound: the
      // width a form gives way at IS the width its widest row takes, so `not wider than the
      // terminal` and `not vacuously narrower` are the same assertion. A bound alone would be
      // satisfied by a panel that had shrunk to nothing.
      expect(
        Math.max(...rows),
        `${form}: the widest row is not the width the form gives way at`,
      ).toBe(edge);
      expect(formOf(await openedAt(edge - 1), edge - 1), `${form}: did not give way`).not.toBe(form);
    }
  }, 300_000);

  it('says the name, where it is and what the record is, with no arrangement at all', async () => {
    // The floor. A terminal too narrow for an arrangement loses the placing and not a fact —
    // the same lines, in the same order, landed the way every other line of this session lands.
    const page = stripped(withoutLayout(await openedAt(40)));
    expect(theFrameOn(page.split('\n'))).toEqual([]);
    expect(page).toContain(OPENED);
    expect(page).toContain(project);
    expect(page).toContain(VERIFIED);
    // ⚠️ IT ALSO ASKED FOR THE `Hints` HEADING HERE, and the comment said why it was the
    // heading rather than the sentence under it: the row that never scrolls away says the
    // same words, so looking for THEM would be looking at the wrong row — measured, by a
    // mutation that dropped the section and left this case green. The section is gone on
    // purpose now, so the same reasoning inverts: the heading is what says it is gone from
    // the floor as well, and it is the one thing on this page that only the panel wrote.
    expect(page).not.toContain('Hints');
    // And the floor really is the panel's own lines rather than an empty page: the record's
    // heading, which is the section that stayed.
    expect(page).toContain('The record');
  }, 120_000);

  it('gives each form up one column below where its own content stops fitting', () => {
    // The same property on the arithmetic alone, where a width can be ASKED FOR. This is
    // the half a terminal cannot reach, because a session cannot be asked to draw a panel
    // out of lines its project does not hold.
    //
    // IT USED TO ASK THE PANEL HOW WIDE IT WAS, and that question no longer has an
    // answer: the box is drawn at the width of the terminal, so what the drawing costs
    // and what it covers came apart, and the field that used to say the first was
    // REPLACED rather than redefined. The width each form gives way at is searched for
    // instead, which is what the console's own case above already does — so nothing in
    // this case knows how wide anything is.
    const made = (columns: number) =>
      panelFor({
        columns,
        render: renderPlain,
        title: statement('a title'),
        mark: [statement('MARK')],
        standing: [statement('where it is standing')],
        record: [statement('The record'), statement('public', 'verified', 'good', 1)],
      });
    const narrowestFor = (form: PanelForm): number => {
      let low = 0;
      let high = 400;
      expect(RICHNESS[made(high).form], form).toBeGreaterThanOrEqual(RICHNESS[form]);
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (RICHNESS[made(middle).form] >= RICHNESS[form]) high = middle;
        else low = middle;
      }
      return high;
    };
    for (const [form, simpler] of [
      ['columns', 'stacked'],
      ['stacked', 'bare'],
    ] as const) {
      const edge = narrowestFor(form);
      expect(made(edge).form, `${form} at ${edge}`).toBe(form);
      expect(made(edge - 1).form, `${form} at ${edge - 1}`).toBe(simpler);
    }
    // ⚠️ AND IT ASKED THE PANEL FOR THE TERMINAL'S WIDTH HERE — *the width the box is DRAWN
    // at, the other of the two questions, and the one the layout reads*. There is no second
    // question: the panel carried the terminal's width because the box was drawn corner to
    // corner, and nothing is drawn to an edge. The field is gone, so the assertion is gone with
    // it rather than rewritten against something else.
    //
    // WHAT REPLACES IT IS THE OTHER DIRECTION OF THE SAME ELO: the arithmetic composes the same
    // groups the drawing places, so what it hands over is every line and no width at all.
    expect(Object.keys(made(100)).sort()).toEqual(['form', 'mark', 'record', 'standing', 'title']);
  });
});

// ---------------------------------------------------------------------------
// Painted or plain, it says the same thing — and it is said once
// ---------------------------------------------------------------------------

describe('the panel is the plain panel, wrapped, and it is drawn once', () => {
  it('says exactly what the unpainted one says, art and all', async () => {
    // The promise three colour deliveries made, on the richest shape this surface has. The
    // ARRANGEMENT is in BOTH — it is the layout's and not the renderer's — so what stripping
    // leaves is the same drawing either way, and what differs is only what a renderer put
    // around a part. ⚠️ IT SAID `frame and all`, and there is no frame; what the sentence needed
    // is that the layout puts glyphs on the page of its own, and the art and the gaps are
    // still that.
    const plain = await openedAt(200);
    const painted = await openedAt(200, renderStyled);
    expect(stripped(withoutLayout(painted))).toBe(stripped(withoutLayout(plain)));
    // Not vacuous: the painted one really carries escapes the plain one does not.
    expect(sgrOf(painted).length).toBeGreaterThan(sgrOf(plain).length);
  }, 120_000);

  it('draws the panel once, however many frames the caller causes', async () => {
    // The panel is what is KEPT and the tips are what is REDRAWN, which is the same
    // distinction the banner and the tips were separated by. A panel redrawn on every
    // keystroke would be a session redrawing its own front page under the caller's hands.
    const terminal = fakeTerminal({ columns: 200 });
    const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    const closed = openSession({
      io,
      render: renderPlain,
      self: REPL_VERB,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: true,
      leaving: hooksNothing,
    });
    await until(() => terminal.bytes().includes(OPENED), 'opened');
    const typed = 'searc';
    for (const key of typed) {
      const grown = terminal.bytes().length;
      terminal.type(key);
      await until(() => terminal.bytes().length > grown, `redrew after ${key}`);
    }
    terminal.type(CLEARS_THE_LINE);
    terminal.type(`${LEAVE}\r`);
    await closed;
    const page = stripped(withoutLayout(terminal.bytes()));
    // What the session is is said once, and so is the widest row of the art.
    //
    // ⚠️ THE SECOND WAS THE CORNER, counted once, and it was the whole witness that a DRAWING
    // rather than a line had been written. The art is what says that now — asked of the module
    // that draws it, so a fifth form moves this case with it.
    expect(times(page, OPENED)).toBe(1);
    expect(
      times(page, drawnAt(200).reduce((most, row) => (row.length > most.length ? row : most))),
    ).toBe(1);
    // The frames really happened: the row under the prompt was written once per keystroke.
    // ⚠️ THE WITNESS USED TO BE A CLAUSE OF THE HINT, and the hint stopped saying it: it
    // names the KEY that lists the session's words now rather than one of the words. The
    // witness is the hint itself, composed by the module that composes it, so a reworded
    // hint moves the case with it instead of quietly counting to zero.
    expect(times(page, renderPlain(tips()).trim())).toBeGreaterThan(typed.length);
    // ⚠️ AND THE LAST LINE SAID *what was drawn once really was a box*, by looking for the run
    // the border was made of. There is one on the page still and it is not the panel's — it is a
    // rule of the input AREA, which is redrawn every frame — so keeping it would have been this
    // case counting the wrong region. What it is for is that the DRAWING is there, and the row
    // above already asks for it by the art.
  }, 120_000);
});

// ---------------------------------------------------------------------------
// What the chrome costs, and the floor under it
// ---------------------------------------------------------------------------

describe('the chrome costs the drawing of the name and nothing more', () => {
  it('spends exactly the mark\u2019s rows whenever the text goes beside it', async () => {
    // WHAT THE FRAME'S DEPARTURE BOUGHT, as a property rather than as a number: with the text
    // beside the mark the panel is as tall as the TALLER of the two, and the mark is the taller
    // one on the terminal a person opens \u2014 so what the opening costs is the drawing the caller
    // chose and not one row more. Twelve rows to nine, measured at a hundred and twenty by
    // forty; the number is in the report and the property is here.
    // THE NARROWEST IS SEARCHED FOR rather than written down, for the reason the whole of this
    // file is: the threshold is the CONTENT's, so a project whose path is a character longer
    // moves it. A number here would be a case that passes on one sandbox and not another.
    for (const columns of [200, 140, A_WORKING_TERMINAL, await narrowestFor(RICHNESS.columns)]) {
      const page = await openedAt(columns);
      expect(formOf(page, columns), `${columns}`).toBe('columns');
      expect(openingRows(page), `${columns}`).toHaveLength(drawnAt(columns).length);
    }
  }, 300_000);

  it('never spends fewer rows than the mark has, in any arrangement', async () => {
    // THE FLOOR, and it is the honest half of the same claim: nine rows is not a target anybody
    // can beat by rearranging, it is the height of the art. Under the mark the panel costs the
    // art PLUS the text, which is more \u2014 so the floor holds at every width and the arrangement
    // is what decides how far above it the panel sits.
    for (const columns of [200, A_WORKING_TERMINAL, 80, 60, 48, 46, 40]) {
      const page = await openedAt(columns);
      expect(openingRows(page).length, `${columns}`).toBeGreaterThanOrEqual(
        drawnAt(columns).length,
      );
    }
  }, 300_000);
});
