/**
 * THE PAGE SHOWS ITS SEAMS — where a region begins, where it ends, and which row is the
 * caller's own.
 *
 * IT CAME OUT OF THREE SCREENSHOTS WITH LINES DRAWN ON THEM, and the three asked for one thing:
 * a page a reader can find their way around. Under the banner there was nothing saying the
 * banner had ended; the roll started against the left edge of the terminal; and the line a
 * caller had TYPED read at exactly the weight of the answer to it, so scrolling a session meant
 * hunting for it. What answers all three is chrome — a rule, a margin with a guide down it, and
 * the echo composed like every other line so a renderer can weigh it.
 *
 * WHAT IS ASSERTED HERE, and every one of them is a measurement off a page rather than a
 * picture:
 *
 *   - THREE RULES AND ONE DRAWING. The page has three seams now and they come out of one
 *     function in one hue — a third way to draw a line across a terminal would be a third thing
 *     to keep in step with the other two.
 *   - THE BREATH IS ONE ROW, and the top region still fits inside the third of the screen the
 *     chrome is allowed. This delivery SPENDS rows on a screen where every row is somebody's
 *     answer, so the bound is asked where it is tightest: eighty by twenty-four.
 *   - THE ECHO IS TOLD FROM THE ANSWER, with colour and without it. The prompt carries the
 *     accent this product is marked by and the words carry a weight; with colour off the row is
 *     still the caller's, because the prompt is still there in words.
 *   - THE TREE STOPS COMPETING WITH THE TITLE, in the list a reader actually reads.
 *   - AND THE GUIDE COSTS A COLUMN AND NOT A CHARACTER. The margin takes four columns of the
 *     page and everything the session says is folded to what is left, so nothing is cut and
 *     nothing is broken mid-word at the narrowest window there is.
 *
 * WHY THE ACCENT IS ASKED FOR HERE RATHER THAN CLEARED, against what most of this bench does:
 * the paint IS the subject of two of the cases. A stream that said it took no colour would make
 * them pass by drawing nothing at all.
 *
 * AND IT USED TO BE ASKED FOR BY THE FIXTURE, which is the instrument this file gave back. The
 * setup wrote `FORCE_COLOR=1` into the process before anything imported the layout, because
 * that variable was the only thing the layout's own colour resolver would listen to and this
 * product had no way of reaching it. It has one now — the decision is handed over on that same
 * channel, once, before the library is loaded (`src/repl/painting.ts`) — so the two painted
 * cases below are painted because the invocation asked for colour, which is what they claim to
 * be about. Nothing here forces it any more.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import { foldedAt } from '../src/presentation/folded.js';
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { dispositionOf } from '../src/repl/gate.js';
import { BEFORE_THE_BAR, insideTheMargin, THE_INSET } from '../src/repl/inset.js';
import { openSession } from '../src/repl/session.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { refusalSentence } from '../src/wiring/report.js';
import {
  ENDS_THE_INPUT,
  fakeTerminal,
  hooksNothing,
  until,
  withoutLayout,
} from './support/console.js';
import {
  aFrameSince,
  inPty as drive,
  type Fixture,
  leavesTheSession,
  opensAConsole,
  type Step,
} from './support/pty.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';
import { theSettledScreen } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** `packages/code/src`, for the scans that read this product's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** What the opening always says on a window that serves. */
const OPENED = 'a session over this project';

/** The glyph a rule is drawn out of, and the one the guide is — both by code point. */
const RUN = '\u2500';
const GUIDE = '\u2502';

/** The verb the caller types, and the first words of what it answers. */
const A_VERB = 'search';
const THE_ANSWER = 'record(s)';

/** A third of the screen, rounded down — the share the chrome may hold (`repl/panel.ts`). */
const A_THIRD_OF = (rows: number): number => Math.floor(rows / 3);

/** Every style sequence in some bytes, in the order they appear. */
function sgrOf(text: string): string[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
  return text.match(/\u001b\[[0-9;]*m/g) ?? [];
}

/** The same bytes with every style sequence taken out — what a pipe would have received. */
function stripped(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Whether a row of a page is a rule and nothing else — the discriminant for a seam. */
function isRule(row: string): boolean {
  const drawn = stripped(row).replace(/ +$/, '');
  return drawn.length > 0 && [...drawn].every((glyph) => glyph === RUN);
}

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** A port that throws everything away, for the calls made for their return value. */
const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

beforeAll(async () => {
  // A6: a sandbox of this run's own. Nothing here writes into the working tree.
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-seams-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  delete process.env.NO_COLOR;
  // NOTHING FORCES COLOUR HERE ANY MORE: see the header for what this line was and what
  // took it. The invocation asks, and the product tells the layout.
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  await run(['init'], quiet);
  await run(['task', 'the task the seams are measured over'], quiet);

  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

/** Runs `mnema repl` on a pseudo-terminal of a given size. */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
  readonly environment?: NodeJS.ProcessEnv;
}) {
  const fixture: Fixture = {
    cli: CLI,
    verb: REPL_VERB,
    project,
    scratch: sandbox,
    environment: options.environment ?? environment,
  };
  return drive(fixture, options);
}

/**
 * THE WRITE A SESSION REFUSES, and a fragment of the refusal that is inside one part of it.
 *
 * The fragment is short on purpose: what the session prints is folded between WORDS at the
 * width of the page, so a long one could be looked for across two rows.
 */
const A_WRITE = 'task';
const IN_THE_REFUSAL = 'from your shell.';

/** The step every session begins with, the one that asks a verb, and the one that leaves. */
const opens: Step = opensAConsole(PROMPT);
const asks: Step = { types: `${A_VERB}\r`, until: aFrameSince(PROMPT), what: `asked ${A_VERB}` };
const leaves: Step = leavesTheSession;

/**
 * A session driven in THIS process over a pair of streams, and every byte it wrote.
 *
 * IT IS THE INSTRUMENT FOR THE PAINT, where the pseudo-terminal is the instrument for the
 * GEOMETRY. What a case about a hue needs is the escapes around a row, and a replayed screen
 * deliberately throws those away — it answers what is on the page, not what colour it is
 * (`support/screen.ts`). What it needs of the layout is real, and it is: the same components,
 * the same library, the same accent.
 */
async function drivenHere(typed: readonly string[]): Promise<string> {
  const terminal = fakeTerminal({ columns: 200, rows: 40 });
  const closed = openSession({
    io: quiet,
    renderingAt: () => renderStyled,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes(PROMPT), 'opened');
  for (const line of typed) {
    terminal.type(`${line}\r`);
    await until(() => stripped(terminal.bytes()).includes(`${PROMPT} ${line}`), `typed ${line}`);
  }
  terminal.type(ENDS_THE_INPUT);
  await closed;
  return terminal.bytes();
}

/** The rows of what a console wrote, with everything a layout writes to place a line taken out. */
function rowsOf(page: string): string[] {
  return withoutLayout(page).split('\n');
}

// ---------------------------------------------------------------------------
// Three seams, one drawing
// ---------------------------------------------------------------------------

describe('the page has three rules, and they are the same drawing in the same hue', () => {
  it('closes the top region with one, and keeps the two the input area sits between', async () => {
    const columns = 100;
    const rows = 30;
    const ran = await inPty({ columns, rows, steps: [opens, asks, leaves] });
    const screen = theSettledScreen(ran.bytes, columns, rows, THE_ANSWER);
    const rules = screen.rows.map(isRule);
    const at = rules.flatMap((rule, row) => (rule ? [row] : []));
    expect(at, `not three rules:\n${screen.text}`).toHaveLength(3);
    // WHERE EACH OF THEM IS, which is what makes three rules three SEAMS rather than one drawn
    // three times: the first closes the region at the top, and the row being typed sits between
    // the other two.
    const typed = screen.rows.map((row) => row.includes(PROMPT)).lastIndexOf(true);
    expect(at[1], 'the row being typed is not under the second rule').toBe(typed - 1);
    expect(at[2], 'the row being typed is not over the third').toBe(typed + 1);
    expect(at[0], 'the first rule is not up at the top region').toBeLessThan(at[1] as number);
    // AND EVERY ONE OF THEM IS AS WIDE AS THE TERMINAL. A seam that stopped short would be the
    // page saying a region ends somewhere it does not.
    for (const row of at) {
      expect(
        [...(screen.rows[row] as string).replace(/ +$/, '')].length,
        `the rule on row ${row} stops short`,
      ).toBe(columns);
    }
  }, 240_000);

  it('draws all three out of one function, in one hue, and the guide in the same one', async () => {
    // THE BYTES, in this process, where the paint survives. Three rows of a page cannot be
    // compared for colour on a replayed screen: a screen model answers what is on the page.
    const page = await drivenHere([A_VERB]);
    const drawn = new Set(rowsOf(page).filter(isRule));
    expect(drawn.size, `the rules are not one drawing: ${[...drawn].join(' | ')}`).toBe(1);
    const rule = [...drawn][0] as string;
    // ONE HUE AND ITS CLOSER, and nothing else on the row: a rule carries no weight, because
    // nothing composed it — it is an edge the library drew (`repl/region.ts`, `rule`).
    const escapes = sgrOf(rule);
    expect(escapes, 'a rule carries something other than one hue').toHaveLength(2);
    const [accent, closer] = escapes as [string, string];
    // AND THE GUIDE DOWN THE MARGIN CARRIES THE SAME PAIR. It is the other edge this page draws
    // ({@link GUIDE}), and one accent means one accent whichever way the line runs.
    const guided = rowsOf(page).find((row) => stripped(row).includes(GUIDE)) as string;
    expect(guided, 'nothing on the page draws the guide').toBeDefined();
    expect(guided, 'the guide is not in the accent the rules are').toContain(
      `${accent}${GUIDE}${closer}`,
    );
    // AND THE ACCENT IS NONE OF THE THREE A VERDICT CARRIES, which is the rule the whole
    // surface's colour rests on: hue means news, and this one means the product.
    for (const severity of ['\u001b[31m', '\u001b[32m', '\u001b[33m']) {
      expect(accent, 'the chrome took a hue a severity uses').not.toBe(severity);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// One row of breath, and the share it comes out of
// ---------------------------------------------------------------------------

describe('the banner ends in a rule and one row of breath', () => {
  it('leaves exactly one blank row between the seam and what the session says', async () => {
    // AT THE FLOOR, which is where a row costs the most: eighty by twenty-four is the screen
    // everybody has and the narrowest one this console draws a page on.
    const columns = 80;
    const rows = 24;
    const ran = await inPty({ columns, rows, steps: [opens, asks, leaves] });
    const screen = theSettledScreen(ran.bytes, columns, rows, THE_ANSWER);
    const seam = screen.rows.findIndex(isRule);
    expect(seam, 'the top region is not closed by a rule').toBeGreaterThan(0);
    const blank = (row: number): boolean => (screen.rows[row] as string).trim().length === 0;
    expect(blank(seam + 1), 'there is no row of breath under the seam').toBe(true);
    expect(blank(seam + 2), 'the breath is more than one row').toBe(false);
    // AND WHAT IS ON THE ROW UNDER IT IS THE SESSION'S, drawn inside the margin with the guide
    // beside it — so the breath separates the banner from the roll rather than from nothing.
    expect([...(screen.rows[seam + 2] as string)][BEFORE_THE_BAR], 'the roll has no guide').toBe(
      GUIDE,
    );
  }, 240_000);

  it('keeps the whole top region inside a third of the screen it never moves on', async () => {
    // THE BOUND THIS DELIVERY SPENDS AGAINST, asked where it is tightest. The seam is chrome and
    // it is counted where the arrangement's rows are counted (`repl/panel.ts`, `THE_SEAM`), so a
    // window that can no longer afford the drawing it had gets the next one down — never a top
    // region that quietly grew by two.
    const columns = 80;
    const rows = 24;
    const ran = await inPty({ columns, rows, steps: [opens, asks, leaves] });
    const screen = theSettledScreen(ran.bytes, columns, rows, THE_ANSWER);
    const seam = screen.rows.findIndex(isRule);
    // THE REGION IS EVERYTHING DOWN TO THE ROW OF BREATH, seam and breath included.
    const fixed = seam + 2;
    expect(fixed, `the top region holds more than a third:\n${screen.text}`).toBeLessThanOrEqual(
      A_THIRD_OF(rows),
    );
    // AND IT REALLY IS SPENT — a region that had collapsed to nothing would satisfy the bound
    // and lose the identity the whole opening exists to keep.
    expect(fixed, 'the top region spends nothing at all').toBeGreaterThan(2);
    const chrome = screen.rows.slice(0, fixed).join('\n');
    expect(chrome, 'the top region does not say what the session is').toContain(OPENED);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The echo, with colour and without it
// ---------------------------------------------------------------------------

describe('the line a caller sent is told from the answer to it', () => {
  it('paints the prompt in the accent and weighs the words, where an answer has neither', async () => {
    const page = await drivenHere([A_VERB]);
    const rows = rowsOf(page);
    const echo = rows.find((row) => stripped(row).includes(`${PROMPT} ${A_VERB}`)) as string;
    expect(echo, 'the caller’s line is nowhere on the page').toBeDefined();
    const answer = rows.find((row) => stripped(row).includes(THE_ANSWER)) as string;
    expect(answer, 'the answer to it is nowhere on the page').toBeDefined();
    // THE PROMPT IS WRAPPED IN THE VERY PAIR A RULE CARRIES, which is the elo between the two
    // alphabets one accent is now spelled in: the layout says a word to its library and the
    // renderer writes an escape (`repl/region.ts`, `presentation/styled.ts`).
    const rule = rowsOf(page).find(isRule) as string;
    const [accent, closer] = sgrOf(rule) as [string, string];
    expect(echo, 'the prompt does not carry the accent').toContain(`${accent}${PROMPT} ${closer}`);
    // AND WHAT WAS TYPED CARRIES A WEIGHT OF ITS OWN, which is the half that survives a
    // colour-blind reader and a theme nobody expected.
    expect(echo, 'what the caller typed carries no weight').toContain(`\u001b[1m${A_VERB}`);
    // AND THE ANSWER CARRIES NEITHER, which is what makes the echo an anchor rather than a
    // second thing shouting on the same page.
    //
    // ASKED OF THE LINE AND NOT OF THE ROW, because every row of the roll begins with the guide
    // and the guide is in the accent — a reading over the whole row would find the page's own
    // edge and call it paint on the answer. What is taken off is exactly the guide and its
    // wrapping; what is left is the line the session composed.
    const withoutTheGuide = (row: string): string =>
      row.slice(row.indexOf(`${accent}${GUIDE}${closer}`) + `${accent}${GUIDE}${closer}`.length);
    expect(
      sgrOf(withoutTheGuide(answer)),
      'the answer is painted like the line that asked for it',
    ).not.toContain(accent);
    expect(stripped(answer), 'the answer is not the answer').toContain(THE_ANSWER);
    // AND THE ECHO'S OWN LINE IS PAINTED, past the same guide — so the comparison above is
    // between two lines rather than between a line and a row that lost its paint.
    expect(sgrOf(withoutTheGuide(echo)), 'the echo lost its accent with the guide').toContain(
      accent,
    );
  }, 120_000);

  it('is still the caller’s line when there is no colour at all', async () => {
    // WHAT `NO_COLOR` REACHES, measured rather than assumed — and this paragraph is where a
    // premise fell.
    //
    // EVERY LINE THE PRODUCT COMPOSES GOES QUIET, because the rule that chooses a renderer is
    // this product's own and it reads the variable (`wiring/color.ts`). That is what the echo
    // becoming a LINE bought: it obeys the same rule as a verdict and a hit, without the console
    // asking a question no module on that side may ask.
    //
    // AND THE ACCENT THE LAYOUT DRAWS WITH GOES QUIET TOO, WHICH IS WHAT THIS CASE USED TO
    // DENY. It read: *the hue on a rule, on the guide and on the mark is the layout library's,
    // and that resolver has no entry for this variable at all — measured on a real terminal, a
    // session with it set writes thirty-two accents and not one byte from our renderer*. Both
    // halves of that were TRUE and the conclusion drawn from them was not: the library reads no
    // `NO_COLOR` anywhere, so nothing was ever going to reach it by that name — what it does
    // read is `FORCE_COLOR`, and this product's answer is handed to it on that channel before a
    // byte of the library is loaded (`repl/painting.ts`). Measured again after the fix, at this
    // size and with these steps: a hundred and twenty style sequences became NONE. The case
    // that owns both directions of it is `one-authority-over-colour.test.ts`; what is asserted
    // here is the ECHO, which is this file's subject.
    const columns = 100;
    const rows = 30;
    // AND NOTHING FORCING IT THE OTHER WAY.
    const quietly = { ...environment, NO_COLOR: '1' };
    delete quietly.FORCE_COLOR;
    const ran = await inPty({
      columns,
      rows,
      steps: [opens, asks, leaves],
      environment: quietly,
    });
    const screen = theSettledScreen(ran.bytes, columns, rows, THE_ANSWER);
    // THE ROW IS THERE AND IT SAYS WHOSE IT IS, in words: the prompt is the carrier and the
    // colour only ever repeated it.
    expect(screen.text, 'the echo is not on the page without colour').toContain(
      `${PROMPT} ${A_VERB}`,
    );
    // AND THE PAGE IS THE SAME PAGE: the guide still holds its column, so what went is the tone
    // and never the structure.
    const echoed = screen.rows.find((row) => row.includes(`${PROMPT} ${A_VERB}`)) as string;
    expect([...echoed][BEFORE_THE_BAR], 'the roll lost its guide with the colour').toBe(GUIDE);
    // AND NOT ONE BYTE OF COLOUR IS LEFT on the frame — ours OR the library's. It used to let
    // the layout's own accent and its closer through, and that pair was the half of the page
    // that was not obeying the caller.
    const frame = ran.bytes.slice(ran.at[0] as number, ran.at[1] as number);
    const left = [...new Set(sgrOf(frame))].sort();
    expect(left, `the frame still carries colour: ${left.join(' ')}`).toEqual([]);
    const painted = rowsOf(ran.bytes).find((row) => stripped(row).includes(`${PROMPT} ${A_VERB}`));
    expect(
      sgrOf((painted as string).slice((painted as string).indexOf(PROMPT))),
      'the echo is still painted with NO_COLOR set',
    ).toEqual([]);
    // NOT VACUOUS: the same session with colour on paints that same frame, and paints the echo.
    const loud = await inPty({ columns, rows, steps: [opens, asks, leaves] });
    const shown = loud.bytes.slice(loud.at[0] as number, loud.at[1] as number);
    expect(sgrOf(shown).length, 'nothing is painted even with colour on').toBeGreaterThan(0);
    const echo = rowsOf(shown).find((row) => stripped(row).includes(`${PROMPT} ${A_VERB}`));
    // FROM THE SAME PLACE ON THE ROW as the reading above, so the pair is one measurement taken
    // twice rather than two questions: past the prompt, the quiet page has no escape and the
    // painted one has the weight what was typed carries.
    expect(
      sgrOf((echo as string).slice((echo as string).indexOf(PROMPT))).length,
      'the echo carries no paint with colour on either',
    ).toBeGreaterThan(0);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The tree, out of the way of the title
// ---------------------------------------------------------------------------

describe('the tree column stops competing with the title beside it', () => {
  it('wraps it exactly as the id and the instant, and leaves the title bare', async () => {
    // OVER THE READING A PERSON REALLY READS, and not over the primitive: what is asked is
    // whether the CALL SITE says what the column is, which a case over `itemLine` cannot see.
    const said: string[] = [];
    await run(['--color=always', 'search'], {
      out: (line) => said.push(line),
      err: (line) => said.push(line),
      fail: () => undefined,
    });
    const row = said.find((line) =>
      stripped(line).includes('the task the seams are measured over'),
    );
    expect(row, `no hit is on the page:\n${said.join('\n')}`).toBeDefined();
    const hit = row as string;
    // WHAT WRAPS EACH COLUMN, read off the row: the pair of escapes around the word.
    const wrapping = (word: string): string => {
      const at = stripped(hit).indexOf(word);
      expect(at, `no ${word} on the row`).toBeGreaterThanOrEqual(0);
      const before = hit.slice(0, hit.indexOf(word));
      return sgrOf(before).slice(-1)[0] ?? '';
    };
    const tree = wrapping('public');
    expect(tree, 'the tree is not dimmed').toBe('\u001b[2m');
    // THE SAME AS THE TWO COLUMNS NOBODY READS, which is the whole argument for the change.
    expect(tree, 'the tree is not dimmed the way the instant is').toBe(wrapping('2026-'));
    // AND THE TITLE IS UNTOUCHED: emphasis by subtraction paints nothing.
    expect(wrapping('the task the seams are measured over'), 'the title is painted').not.toBe(
      '\u001b[2m',
    );
    // AND THE PLAIN LINE IS UNMOVED, byte for byte — which is what keeps a recorded transcript
    // and a CI log saying exactly what they said before this delivery.
    const plain: string[] = [];
    await run(['--color=never', 'search'], {
      out: (line) => plain.push(line),
      err: (line) => plain.push(line),
      fail: () => undefined,
    });
    expect(
      plain.map((line) => line),
      'the plain reading moved',
    ).toEqual(said.map(stripped));
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The guide costs a column, and nothing else
// ---------------------------------------------------------------------------

describe('the margin takes columns of the page and never a character of a line', () => {
  it('puts every row of the widest answer on the page whole, at the narrowest window', async () => {
    const columns = 80;
    const rows = 24;
    // THE WIDEST THING THE SESSION SAYS, asked of the product rather than retyped. IT WAS THE
    // TABLE `/help` PRINTED and that word is gone — the list under the prompt answers it, and a
    // list is CUT to the terminal rather than folded by it. What is left that a fold has
    // anything to do to is the REFUSAL of a write, composed off the declaration by the one
    // funnel every no on this surface goes through (`src/repl/gate.ts`, `src/wiring/report.ts`).
    const built = buildProgram(quiet, [], renderPlain);
    const refused = dispositionOf(A_WRITE, built.verbs, REPL_VERB);
    expect(refused.does, `\`${A_WRITE}\` is not refused by this session`).toBe('refuse');
    if (refused.does !== 'refuse') throw new Error('unreachable');
    const widest = refusalSentence(refused.sentence, refused.detail);
    expect(widthOf(widest), 'the widest line already fits inside the margin').toBeGreaterThan(
      insideTheMargin(columns),
    );
    const broken = foldedAt(insideTheMargin(columns), renderPlain)(widest).split('\n');
    expect(broken.length, 'the widest line does not fold here').toBeGreaterThan(1);

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: `${A_WRITE}\r`, until: aFrameSince(PROMPT), what: `asked for ${A_WRITE}` },
        leaves,
      ],
    });
    const screen = theSettledScreen(ran.bytes, columns, rows, IN_THE_REFUSAL);
    // EVERY ROW OF THE FOLD IS ON THE PAGE, in order, each of them inside the margin — so
    // nothing was cut, nothing was clipped, and the break is the product's own rather than the
    // terminal's.
    const page = screen.rows.map((row) => row.slice(THE_INSET).replace(/ +$/, ''));
    const found = page.findIndex((_row, at) =>
      broken.every((wanted, step) => page[at + step] === wanted.replace(/ +$/, '')),
    );
    expect(found, `the widest answer is not on the page whole:\n${screen.text}`).toBeGreaterThan(0);
    // AND NOT ONE ROW OF THE PAGE IS WIDER THAN THE WINDOW, margin and guide included: the
    // screen it is replayed on is exactly this wide, so a row that overflowed would have
    // wrapped onto the next and the rows above would not line up at all.
    for (const row of screen.rows) {
      expect([...row].length, 'a row is wider than the window').toBeLessThanOrEqual(columns);
    }
  }, 240_000);
});

// ---------------------------------------------------------------------------
// A1: the sites, found by the discriminant
// ---------------------------------------------------------------------------

/** Every module of this surface that ships, with its comments and strings blanked. */
function sources(): readonly { readonly where: string; readonly code: string }[] {
  return sourceFiles(SRC).map((file) => ({
    where: file.slice(SRC.length + 1),
    code: codeOnly(readFileSync(file, 'utf-8')),
  }));
}

describe('A1: every site that echoes, every site that draws an edge, every site that lists a tree', () => {
  it('puts the prompt in front of what was typed in ONE place, and it is not the echo', () => {
    // THE DISCRIMINANT IS THE COMPOSITION, never a list of files: anything that puts the prompt
    // and the caller's words together. THE ECHO USED TO BE THREE OF THEM — `land(prompt + line)`
    // at the three ways a row leaves the input — and they are one call to one function now
    // (`repl/console.ts`, `echoed`).
    const composing = /\bprompt\s*\+|\+\s*prompt\b/;
    const found = sources().filter((file) => composing.test(file.code));
    expect(found.map((file) => file.where)).toEqual(['repl/console.ts']);
    // AND THE ONE THAT IS LEFT IS THE FINDING, rather than a site the list forgot: it is the row
    // being TYPED, drawn in the input area, and it may not become a composed line — the caret is
    // an offset in columns into it, and escapes a terminal does not print would be arithmetic on
    // the one number that has to be exact.
    const console_ = (found[0] as { code: string }).code;
    expect(console_.match(/\bprompt\s*\+/g), 'more than one site composes with the prompt').toEqual(
      ['prompt +'],
    );
    expect(console_).toContain('present: prompt + editing.typed');
    // AND THE ECHO ITSELF IS ONE CALL TO ONE FUNCTION, with the shape somewhere else entirely.
    const echoing = sources().filter((file) => /echoLine\(/.test(file.code));
    expect(echoing.map((file) => file.where).sort()).toEqual([
      'presentation/echo.ts',
      'repl/console.ts',
    ]);
    expect((console_.match(/echoLine\(/g) ?? []).length, 'the echo is composed twice').toBe(1);
  });

  it('draws every edge of the page out of one module, and composes none of them', () => {
    // A RULE AND A GUIDE ARE THE SAME KIND OF THING — a box with nothing in it and one edge
    // switched on — so the discriminant is the library's own word for an edge.
    const drawing = sources().filter((file) => /borderStyle/.test(file.code));
    expect(drawing.map((file) => file.where)).toEqual(['repl/region.ts']);
    const region = (drawing[0] as { code: string }).code;
    expect((region.match(/borderStyle/g) ?? []).length, 'the page draws more than two edges').toBe(
      2,
    );
    // AND NOTHING ANYWHERE COMPOSES ONE OUT OF GLYPHS, which is what keeps the run the
    // library's: a row of dashes typed into a source would be a third way to draw a line.
    for (const file of sources()) {
      for (const glyph of [RUN, GUIDE]) {
        expect(file.code.includes(glyph), `${file.where} writes an edge of its own`).toBe(false);
      }
    }
  });

  it('says which column is a tree at every list that has one, and nowhere else', () => {
    // THE FOUR READINGS THAT PUT A TREE IN A COLUMN — found by the marker, and then read back
    // against every site that names a scope at all.
    const marking = sources()
      .filter((file) => /asScope\(/.test(file.code))
      .map((file) => file.where)
      .sort();
    expect(marking).toEqual([
      // the reading a caller had the screenshot of: id, tree, date, title
      'presentation/exposure.ts',
      // where the marker is declared
      'presentation/items.ts',
      // the tree of the edge, in brackets, at the end of the row
      'presentation/provenance.ts',
      'presentation/references.ts',
      'presentation/search.ts',
    ]);
    // AND THE SITES THAT NAME A TREE AND ARE NOT A COLUMN, which is the other half of the
    // enumeration and the part a list of files cannot answer. Each of them puts the tree where a
    // reader is MEANT to read it: as half of a heading, or as the label a verdict leads with.
    const naming = sources()
      .filter((file) => /\.scope\b/.test(file.code))
      .map((file) => file.where);
    for (const where of ['presentation/record.ts', 'wiring/verify.ts']) {
      expect(naming, `${where} stopped naming a tree`).toContain(where);
      expect(marking, `${where} dimmed a tree that is not a column`).not.toContain(where);
    }
  });
});
