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
import { SEVERITIES } from '../src/presentation/line.js';
import { renderPlain } from '../src/presentation/plain.js';
import type { Render } from '../src/presentation/render.js';
import { renderStyled } from '../src/presentation/styled.js';
import { statement } from '../src/presentation/verdict.js';
import { type PanelForm, panelFor } from '../src/repl/panel.js';
import { openSession } from '../src/repl/session.js';
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
 * horizontal run, and the glyph the name is drawn with.
 *
 * Named by their code points rather than typed, like every other unusual byte in this
 * repository's sources: a rule is one keystroke away from a pipe and a run from a hyphen,
 * and a character a reader cannot tell from another one is a character an edit destroys
 * without anybody seeing it happen.
 */
const CORNER = '\u256d';
const RULE = '\u2502';
const DASH = '\u2500';
const INK = '\u2588';

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

/** The rows of the page that are part of the box. */
function boxRows(page: string): string[] {
  return rowsOf(page).filter((row) => row.includes(RULE) || row.includes(CORNER));
}

/** Which drawing is on the page, judged by what only that drawing has. */
function formOf(page: string): PanelForm {
  const rows = boxRows(page);
  if (rows.length === 0) return 'bare';
  // A row with three rules on it is a row with a column on each side of one, which is the
  // only thing that tells the two boxed forms apart.
  return rows.some((row) => [...row].filter((glyph) => glyph === RULE).length >= 3)
    ? 'columns'
    : 'stacked';
}

/** How wide a row is on a screen, in characters. */
const widthOf = (row: string): number => [...row].length;

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
    const mark = rowHolding(page, INK);
    expect(
      accented(mark, accent as string, closer as string).some((run) => run.includes(INK)),
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

/** The narrowest terminal on which the drawing is still at least this rich. */
async function narrowestFor(richness: number): Promise<number> {
  let low = 0;
  let high = 400;
  expect(RICHNESS[formOf(await openedAt(high))]).toBeGreaterThanOrEqual(richness);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (RICHNESS[formOf(await openedAt(middle))] >= richness) high = middle;
    else low = middle;
  }
  return high;
}

describe('the form comes out of the content, and the narrowest still says the essential', () => {
  it('puts both sections INSIDE the box, headings and all', async () => {
    // What the box is FOR, asserted where the box is. It is a case of its own because the
    // floor case below cannot say it: the row under the prompt says the same words as the
    // panel's one hint, out of the same constant, so a page that had lost the section
    // entirely would still hold that sentence. Here the rows are the box's own.
    const rows = boxRows(await openedAt(200));
    for (const said of ['The record', VERIFIED, 'Hints', 'says what it runs']) {
      expect(
        rows.some((row) => row.includes(said)),
        said,
      ).toBe(true);
    }
  }, 120_000);

  it('draws all three, and never a richer one on a narrower terminal', async () => {
    // The sweep, and it is ORDERED rather than a list of widths that happen to work: what
    // is asserted is that the drawing only ever gets simpler as the terminal narrows, and
    // that all three of the forms are reachable over a record this ordinary.
    const forms: PanelForm[] = [];
    for (const columns of [200, 120, 80, 60, 40]) forms.push(formOf(await openedAt(columns)));
    expect(new Set(forms)).toEqual(new Set(['columns', 'stacked', 'bare']));
    for (const [at, form] of forms.entries()) {
      if (at === 0) continue;
      const richer = forms[at - 1] as PanelForm;
      expect(RICHNESS[form], `${form} came after ${richer}`).toBeLessThanOrEqual(RICHNESS[richer]);
    }
  }, 180_000);

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
    // The HEADING and not the hint under it: the row that never scrolls away says the same
    // words as that hint, so looking for them here would be looking at the wrong row —
    // measured, by a mutation that dropped the section and left this case green.
    expect(page).toContain('Hints');
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
        hints: [statement('Hints'), statement('what to type')],
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
    expect(times(page, 'says what it runs')).toBeGreaterThan(typed.length);
    // And what was drawn once really was a box.
    expect(page).toContain(DASH);
  }, 120_000);
});
