/**
 * THE PANEL THE CONSOLE OPENS WITH — a box with a title on its border, and the decisions
 * it forced.
 *
 * Everything else this surface draws is a line. This is a DRAWING: it has a width, it has
 * a frame, and it has a hue that says nothing about the record. Each of those is a way for
 * a surface built on "say exactly what is true and nothing more" to start saying something
 * else, so each has a case here:
 *
 *   - CHROME IS NOT DATA, AND THE TWO MAY NOT MEET. Colour on this surface means severity
 *     (`presentation/styled.ts`, and the three hues it paints). A box has a border and a
 *     border has a colour, so the rule gained a second axis rather than an exception: the
 *     frame carries ONE accent, it is spent in one module, and it is none of the three.
 *     Both halves are asserted, and the second against the escapes a severity really
 *     produces rather than against a number typed here.
 *   - THE PANEL SAYS LESS THAN `verify` AND NEVER SOMETHING ELSE. It has room for one line
 *     per tree, so it shows the clause that IS the verdict and drops the ones that qualify
 *     it — which is safe only if what is left is literally a PREFIX of the sentence the
 *     verb prints. That is what is asserted, tree by tree, over a real record.
 *   - THE FORM COMES OUT OF THE CONTENT. A box wider than the terminal is folded into
 *     nonsense, so there are three forms and the widest that fits is drawn. The threshold
 *     is asserted as a PROPERTY — at the width a form gives way at, it still fits; one
 *     column narrower it is gone — so no number in this file can drift from the drawing.
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
 * The characters this file looks for: the box's top-left corner, its vertical rule, its
 * horizontal run.
 *
 * Named by their code points rather than typed, like every other unusual byte in this
 * repository's sources: a rule is one keystroke away from a pipe and a run from a hyphen,
 * and a character a reader cannot tell from another one is a character an edit destroys
 * without anybody seeing it happen.
 */
const CORNER = '\u256d';
const RULE = '\u2502';
const DASH = '\u2500';

/** Ctrl-C, which abandons the row being typed. Spelled out, for the same reason. */
const CLEARS_THE_LINE = '\u0003';

/** How deep a line of a section sits under its heading — the session's own constant. */
const UNDER_A_HEADING = 1;

/** What the chain says about a tree in order, and the panel repeats: the words to look for. */
const VERIFIED = 'local integrity verified';

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
 * The rows of the page that are part of the box.
 *
 * ⚠️ IT USED TO BE ANY ROW HOLDING THE RULE, and a drawing of the name falsified that: the
 * isometric form was inked with three glyphs and one of them was {@link RULE}, the very
 * character the frame's sides are drawn with. So a page with no box at all came back as
 * eleven box rows of six different widths, and the case that reads their widths called the
 * box ragged.
 *
 * THE COLLISION IS GONE AND THE DISCRIMINANT STAYS. The drawing that replaced it is made of
 * blocks and shades and holds no frame glyph at all, so this would work either way now — and
 * it is kept as it is because what makes it right is not which glyphs the art happens to use:
 * a row of the box BEGINS at the left edge of the screen, which no drawing inside the box
 * ever does. A fifth form is one edit away from bringing the collision back.
 */
function boxRows(page: string): string[] {
  return rowsOf(page).filter((row) => row.startsWith(RULE) || row.startsWith(CORNER));
}

/**
 * Which drawing is on the page, judged by what only that drawing has.
 *
 * ⚠️ IT COUNTED THE RULES ON ONE ROW — three of them meant a column on each side of a
 * divider — and a drawing of the name put as many as it liked on a row of its own. What tells
 * the two boxed forms apart is a rule that runs THROUGH the box: a column of the screen
 * carrying the glyph on every interior row. The frame's two sides are two of them and the
 * divider is the third; a vertical of the art was in a different column on every row of it,
 * and the rows the place and the record are on hold none.
 *
 * THE ART NO LONGER HOLDS THAT GLYPH, and this is not written back to counting one row for it:
 * *a rule of the frame is in the same column on every row* is true of a frame whatever the art
 * is made of, and *there are three of them on this row* was only ever true of the art there
 * was. The weaker reading is the one that already went red once.
 */
function formOf(page: string): PanelForm {
  const rows = boxRows(page).filter((row) => !row.includes(CORNER));
  if (rows.length === 0) return 'bare';
  const through = [...(rows[0] as string)].filter((_, at) =>
    rows.every((row) => [...row][at] === RULE),
  );
  return through.length >= 3 ? 'columns' : 'stacked';
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

/** The first row of the page that is the box's own top edge, with its escapes. */
function boxLine(page: string): string {
  const row = withoutLayout(page)
    .split('\n')
    .find((line) => line.includes(CORNER));
  expect(row, 'no box was drawn').toBeDefined();
  return row as string;
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
 * row at all, is the only question worth asking here — a row of the box has the frame at
 * each end of it and, in the two-column form, a rule through the middle, so "the accent
 * appears on this row" is true of every row of the drawing.
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

  it('paints the frame in a hue no severity uses, and paints no line of the record', async () => {
    // THE OTHER HALF, asked of the BYTES rather than of the source: what the border is
    // wrapped in must not be what a verdict is wrapped in. The severities' escapes are
    // taken from the renderer itself — what a severity ADDS to a line that has none — so
    // nothing here is a number somebody typed.
    const page = await openedAt(200, renderStyled);
    const [accent, closer] = sgrOf(boxLine(page));
    expect(accent, 'the border carries no colour at all').toBeDefined();
    expect(closer, 'the border never gives the foreground back').toBeDefined();
    expect([...severityHues()]).not.toContain(accent);
    // WHAT THE ACCENT IS AROUND, which is the only form of the question worth asking: the
    // frame runs down both sides of every row of the box, so "the accent is on this row" is
    // true of all of them. What may not happen is the accent around a WORD OF THE RECORD.
    const verdict = rowHolding(page, VERIFIED);
    const wrapped = accented(verdict, accent as string, closer as string);
    expect(wrapped.length, 'no frame on the row the verdict is on').toBeGreaterThan(0);
    for (const run of wrapped) expect(stripped(run), run).not.toContain(VERIFIED);
    // Not vacuous, in both directions. The verdict really is painted — by the severity it
    // carries, on the row the accent was just cleared of…
    expect([...severityHues()].some((hue) => sgrOf(verdict).includes(hue))).toBe(true);
    // …and the accent really is around the two things that ARE chrome: the frame, and the
    // mark. A layout that had stopped painting would satisfy the loop above saying nothing.
    expect(wrapped.some((run) => [...stripped(run)].every((glyph) => glyph === RULE))).toBe(true);
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
    ).toBe(true);
  }, 120_000);
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
    walked.set(columns, formOf(await openedAt(columns)));
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
  it('puts the ONE section INSIDE the box, heading and all', async () => {
    // What the box is FOR, asserted where the box is.
    //
    // ⚠️ IT USED TO SAY `both sections`, and the second was `Hints` — a heading over one
    // sentence naming the word that lists the verbs. It went, and this case is renamed
    // rather than shortened: what a caller can type is said under the prompt, where it
    // does not scroll away, and a box that repeated it was the copy nobody could see after
    // ten reads. So the assertion is now two-sided — the record's section is in the box,
    // and nothing of the second one is.
    const rows = boxRows(await openedAt(200));
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
    expect(formOf(await openedAt(A_WORKING_TERMINAL))).toBe('columns');
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
    // each of the two boxed forms: at the width it gives way at, the box is drawn and fits
    // inside the terminal exactly; one column narrower it is not that form any more.
    // Nothing in this case knows how wide anything is.
    for (const [form, richness] of [
      ['columns', RICHNESS.columns],
      ['stacked', RICHNESS.stacked],
    ] as const) {
      const edge = await narrowestFor(richness);
      const page = await openedAt(edge);
      expect(formOf(page), `${form} at ${edge}`).toBe(form);
      const rows = boxRows(page).map(widthOf);
      expect(new Set(rows).size, `${form}: the box is ragged`).toBe(1);
      // Corner to corner. The box takes the width of the TERMINAL — the form is what the
      // content chose, and how much of the screen the frame covers is not the content's
      // to decide. Asked of a real console here; asked of a real terminal in
      // `tests/a-page-that-opens-clean.test.ts`, at three widths.
      expect(rows[0], `${form}: the box is not the width of the terminal`).toBe(edge);
      expect(formOf(await openedAt(edge - 1)), `${form}: did not give way`).not.toBe(form);
    }
  }, 300_000);

  it('says the name, where it is and what the record is, even with no box at all', async () => {
    // The floor. A terminal too narrow for a box loses the frame and not a fact — the same
    // lines, in the same order, landed the way every other line of this session lands.
    const page = stripped(withoutLayout(await openedAt(40)));
    expect(page).not.toContain(CORNER);
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
    // And the panel reports the terminal it was measured for, which is the width the box
    // is DRAWN at — the other of the two questions, and the one the layout reads.
    for (const columns of [40, 100, 200]) expect(made(columns).columns).toBe(columns);
  });
});

// ---------------------------------------------------------------------------
// Painted or plain, it says the same thing — and it is said once
// ---------------------------------------------------------------------------

describe('the panel is the plain panel, wrapped, and it is drawn once', () => {
  it('says exactly what the unpainted one says, frame and all', async () => {
    // The promise three colour deliveries made, on the richest shape this surface has. The
    // frame is in BOTH — it is the layout's and not the renderer's — so what stripping
    // leaves is the same drawing either way, and what differs is only what a renderer put
    // around a part.
    const plain = await openedAt(200);
    const painted = await openedAt(200, renderStyled);
    expect(stripped(withoutLayout(painted))).toBe(stripped(withoutLayout(plain)));
    // Not vacuous: the painted one really carries escapes the plain one does not.
    expect(sgrOf(painted).length).toBeGreaterThan(sgrOf(plain).length);
  }, 120_000);

  it('draws the box once, however many frames the caller causes', async () => {
    // The panel is what is KEPT and the tips are what is REDRAWN, which is the same
    // distinction the banner and the tips were separated by. A box redrawn on every
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
    // The title is on the top border and nowhere else, and the corner is drawn once.
    expect(times(page, OPENED)).toBe(1);
    expect(times(page, CORNER)).toBe(1);
    // The frames really happened: the row under the prompt was written once per keystroke.
    // ⚠️ THE WITNESS USED TO BE A CLAUSE OF THE HINT, and the hint stopped saying it: it
    // names the KEY that lists the session's words now rather than one of the words. The
    // witness is the hint itself, composed by the module that composes it, so a reworded
    // hint moves the case with it instead of quietly counting to zero.
    expect(times(page, renderPlain(tips()).trim())).toBeGreaterThan(typed.length);
    // And what was drawn once really was a box.
    expect(page).toContain(DASH);
  }, 120_000);
});
