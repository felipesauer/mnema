/**
 * THE FLOOR IS WHERE THE NAME IS DRAWN — four things a caller asked for on a page they
 * annotated, and the frontier one of them moved.
 *
 * WHERE THE REQUIREMENT CAME FROM: a print of the console with four marks on it. *The bar
 * should pull back a little into the side margin.* *The minimum terminal should be where the
 * ASCII art shows MNEMA at its biggest.* *When a slash is given, the preview of the navigable
 * verbs should appear.* *The verbs in the search should have colour.*
 *
 * THE SECOND ONE IS A DEFINITION AND NOT A PREFERENCE, and it is what this file is named
 * after. The shortest window this console draws a page on used to be the CANONICAL TERMINAL —
 * eighty by twenty-four, what a terminal has been since the VT100 — which is a true sentence
 * about terminals and was never a statement about this product. What replaces it is the
 * caller's own line: the smallest window is the one where the name still appears whole. The
 * height was MEASURED rather than chosen, by driving the built binary on a real
 * pseudo-terminal one row at a time (`src/repl/floor.ts` has the number and the arithmetic
 * behind it).
 *
 * THE THIRD REVERSES THE DELIVERY BEFORE IT, on purpose. That one was asked for *show it only
 * once you start typing* and delivered a bare bar with no list; the premise under it was that
 * *what exists* is not a question. The page falsified it: a bar with a slash in it and nothing
 * under it is a reader asking what there is, and nothing is the wrong answer. It is not a
 * regression — the premise is named where it was written, in `src/repl/palette.ts` and in the
 * cases that held it.
 *
 * WHAT THIS FILE HOLDS, and what each part needs its instrument for:
 *
 *   - THE FLOOR, ON A REAL DEVICE: at the exact floor a LINE of the whole drawing is on the
 *     page, and one row under it the screen that says the window is too small. Asserted by a
 *     row of the art read off the module, never by a count of rows.
 *   - AND THE FLOOR AGREES WITH THE RULE THAT PRODUCED IT: three times what the arrangement
 *     costs on that page IS the floor, which is the one statement that goes red if the two ever
 *     come apart.
 *   - THE PREVIEW: a bare slash shows four navigable words and says how many it could not, and
 *     the first letter narrows THAT list without moving the ceiling.
 *   - THE COLOUR: the accent is on the WORD and on nothing else beside it, and `NO_COLOR`
 *     takes the tone and leaves the word. Two real sessions, because the whole question is what
 *     a stream carries.
 *   - THE MARGIN: at the floor the widest thing the page draws is on it whole. A margin is
 *     columns of the PAGE, never a character of a line.
 *   - AND THE SITES, BY THE DISCRIMINANT: the floor, the margin, what decides whether the list
 *     opens, and what composes the line of an offer — each found by what it IS in the source
 *     rather than by a list kept here.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import type { CompletionWord } from '../src/completion/tree.js';
import { bannerFor } from '../src/presentation/banner.js';
import { asWord } from '../src/presentation/items.js';
import { ROLES, type Role } from '../src/presentation/line.js';
import { renderPlain } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { verbsOffered } from '../src/repl/gate.js';
import { AFTER_THE_BAR, BEFORE_THE_BAR, insideTheMargin, THE_INSET } from '../src/repl/inset.js';
import { CUT, PICK } from '../src/repl/palette.js';
import { theShortestScreenFor } from '../src/repl/panel.js';
import { theSessionsOwnWords, tips } from '../src/repl/session.js';
import { PREFIX } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import {
  arrivedSince,
  inPty as drive,
  type Fixture,
  leavesTheSession,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';
import { type Screen, screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guards that read this surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';
/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';
/** The first words of the screen a window under the floor is shown. */
const TOO_SMALL = 'The window is too small for the console';
/**
 * THE GUIDE DOWN THE MARGIN — BOX DRAWINGS LIGHT VERTICAL, U+2502.
 *
 * Spelled by its code point rather than typed, like every unusual byte in this repository: a
 * glyph a reader cannot tell from a pipe is a glyph an edit destroys without anybody seeing it
 * happen.
 */
const THE_GUIDE = '\u2502';

/** The key a caller sends to walk down a list. */
const MOVES_DOWN = `${ESC}[B`;
/**
 * WHAT ABANDONS THE ROW BEING TYPED — Ctrl-C, and every case here that types something needs
 * it before it leaves.
 *
 * The key that ends the input is answered on an EMPTY row, exactly as a shell answers it, so a
 * session left with a slash still on the row never comes back — measured, as a whole run timing
 * out rather than as a step failing.
 */
const CLEARS_THE_LINE = '\u0003';

/** A port nothing writes to: what a program built for its declarations alone is handed. */
const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

beforeAll(async () => {
  // A6: a sandbox of this run's own. Nothing here writes into the working tree.
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-floor-drawn-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  await run(['init'], quiet);
  await run(['task', 'the task the page is measured over'], quiet);

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

const fixture = (): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
}): Promise<Ran> {
  return drive(fixture(), options);
}

const opens: Step = opensAConsole(PROMPT);
const leaves: Step = leavesTheSession;

/**
 * A PAGE THAT COSTS NOTHING, so the drawing that comes back is the one the WIDTH allows —
 * which is how the biggest form is named without a copy of the art in this file.
 */
const drawnAcross = (columns: number): readonly string[] =>
  bannerFor({ columns, rows: THE_FLOOR.rows, needs: () => 0 }).map(renderPlain);

/** The whole drawing of the name, asked of the module that draws it. */
const THE_WHOLE_NAME = drawnAcross(200);

/**
 * ONE ROW OF THE DRAWING, and the widest one — which is what the two promises below need of
 * it. It is a LINE of the art rather than a count of rows, because a count is answered by any
 * nine rows of anything.
 */
const AN_UNMISTAKABLE_ROW = [...THE_WHOLE_NAME].reduce((widest, row) =>
  [...row.trimEnd()].length > [...widest.trimEnd()].length ? row : widest,
);

/**
 * EVERY WORD A CALLER COULD TYPE ON AN EMPTY ROW, asked of the product rather than retyped:
 * the verbs this session offers and the words it answers to itself, which is exactly the union
 * the completer builds (`src/repl/complete.ts`). A list written here would go stale the day a
 * verb is declared, and every case below would then be measuring a vocabulary nobody has.
 */
function everythingOffered(): readonly CompletionWord[] {
  const built = buildProgram(quiet, [], renderPlain);
  // IT IS A SET HERE, AND IT USED TO BE SORTED. The cases below ask HOW MANY words there are and
  // whether a row on a screen names one of them, never which comes first — and the sort was a
  // reading of the product's order kept in this file, which is a thing to keep in step with a
  // decision that lives somewhere else (`src/repl/complete.ts`, `theOrder`: the verbs first, the
  // words the session answers to itself after them). What is asserted about the order is
  // asserted where the list is (`tests/a-palette-for-the-words.test.ts`).
  return [
    ...verbsOffered(built.verbs, REPL_VERB).map((word) => ({ word, description: '' })),
    ...theSessionsOwnWords(),
  ];
}

/** The page a session opened at a size drew, as a screen. */
async function openedAt(columns: number, rows: number): Promise<Screen> {
  const ran = await inPty({ columns, rows, steps: [opens, leaves] });
  return screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
}

// ---------------------------------------------------------------------------
// The floor is the height the whole name is drawn at
// ---------------------------------------------------------------------------

describe('the floor is the height the whole name is drawn at', () => {
  it('draws the whole name at the exact floor, and no page one row under it', async () => {
    // THE PROMISE, ON THE PAGE. It is asserted by a ROW OF THE ART — the widest one, read off
    // the module — rather than by counting rows of chrome: a count is satisfied by nine rows of
    // anything, and what a caller asked for is that the name is there.
    const atTheFloor = await openedAt(THE_FLOOR.columns, THE_FLOOR.rows);
    expect(atTheFloor.text, 'the floor never opened a console').toContain(PROMPT);
    expect(atTheFloor.text, 'the whole name is not on the page at the floor').toContain(
      AN_UNMISTAKABLE_ROW.trimEnd(),
    );
    // AND IT IS THE WHOLE DRAWING and not the rows of it that happen to be on the screen: every
    // row of the art is on the page.
    for (const row of THE_WHOLE_NAME) {
      expect(atTheFloor.text, `a row of the drawing is missing at the floor: ${row}`).toContain(
        row.trimEnd(),
      );
    }

    // AND ONE ROW UNDER IT THERE IS NO PAGE AT ALL — which is what the floor being a floor
    // means, and it is the declared cost of the decision rather than a degradation.
    const under = await openedAt(THE_FLOOR.columns, THE_FLOOR.rows - 1);
    expect(under.text, 'one row under the floor still drew a console').not.toContain(OPENED);
    expect(under.text, 'one row under the floor did not say the window is too small').toContain(
      TOO_SMALL,
    );
    expect(under.text, 'one row under the floor still drew the name').not.toContain(
      AN_UNMISTAKABLE_ROW.trimEnd(),
    );
  }, 240_000);

  it('is three times what the arrangement costs on that page, which is the rule that chose it', async () => {
    // THE ELO BETWEEN THE NUMBER AND THE RULE THAT PRODUCED IT, and it is the case that catches
    // the floor drifting away from the drawing without anybody noticing. What refuses a drawing
    // is the SHARE a fixed region may hold — one part in three (`src/repl/panel.ts`,
    // `theShortestScreenFor`) — and the floor is the height at which the whole name stops being
    // refused. So three times what the arrangement really costs on the page at the floor has to
    // BE the floor, and the cost is measured on the page rather than worked out here.
    const columns = THE_FLOOR.columns;
    const rows = THE_FLOOR.rows;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        // A LINE IS SAID, so that the roll under the arrangement has moved: what the two pages
        // share at the top is then the region that does not move, which is the arrangement.
        { types: `verify\r`, until: arrivedSince(PROMPT), what: 'answered a read' },
        leaves,
      ],
    });
    const asked = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    // WHAT THE REGION COSTS IS READ OFF THE SEAM, which is the row the region closes with: a
    // rule across the page and one row of breath under it (`src/repl/region.ts`, `theTop`). IT
    // WAS THE ROWS TWO PAGES OF ONE SESSION SHARE AT THE TOP, and that is a measurement of
    // something else on a page whose roll has not yet overflowed — the first lines of the roll
    // do not move either, so the count came back two rows long and would have gone on agreeing
    // with itself.
    const isRule = (row: string): boolean => /^\u2500+$/.test(row.replace(/\s+$/, ''));
    const seam = asked.rows.findIndex(isRule);
    expect(seam, 'no rule closes the top region on this page').toBeGreaterThan(0);
    const fixed = seam + 2;
    expect(theShortestScreenFor(fixed), 'the floor is not the share of what it draws').toBe(
      THE_FLOOR.rows,
    );
    // AND ONE ROW MORE OF ARRANGEMENT WOULD WANT A TALLER SCREEN THAN THE FLOOR, which is what
    // says the mechanism is live rather than retired: a page heavier than this one — a project
    // with one more tree in its record, say — is still given a smaller drawing above this floor.
    expect(
      theShortestScreenFor(fixed + 1),
      'an arrangement one row taller would still fit the floor',
    ).toBeGreaterThan(THE_FLOOR.rows);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The bare bar answers what there is
// ---------------------------------------------------------------------------

/** How many rows of a page are a row of the list, found by what a row of the list LOOKS like. */
function listRowsOn(screen: Screen, words: readonly string[]): readonly string[] {
  return screen.rows.filter((row) => {
    const shown = row.trimStart();
    const said = shown.startsWith(PICK) ? shown.slice(PICK.length).trimStart() : shown;
    return words.some((word) => said === word || said.startsWith(`${word} `));
  });
}

/** Which word a page has the mark on, and the empty string when no row carries one. */
function pickedOn(screen: Screen): string {
  const row = screen.rows.find((line) => line.trimStart().startsWith(PICK));
  return row === undefined
    ? ''
    : (row
        .trimStart()
        .slice(PICK.length)
        .trim()
        .split(/\s{2,}/)[0] ?? '');
}

describe('a bare slash shows what there is, and the letter narrows THAT list', () => {
  it('shows four navigable words and says how many it could not, and a letter keeps the ceiling', async () => {
    // WHAT THE CALLER ASKED FOR: *when a slash is given, the preview of the navigable verbs
    // should appear*. Three claims in one run, because they are one behaviour — the list is
    // there, the arrows move through it, and a letter narrows the SAME list rather than opening
    // a second one.
    const columns = 120;
    const rows = THE_FLOOR.rows;
    const words = everythingOffered().map((offer) => offer.word);
    expect(words.length, 'this session offers no words at all').toBeGreaterThan(4);

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        // WHAT THIS KEYSTROKE PUT ON THE PAGE, and not the character anywhere in the stream: the
        // opening writes a slash three ways over — the project's path, the record's `T1/T2/T4`
        // and the hint that names this very key.
        { types: PREFIX, until: arrivedSince(CUT), what: 'opened the preview' },
        { types: MOVES_DOWN, until: arrivedSince(PICK), what: 'marked a row' },
        { types: 'v', until: arrivedSince(`${PROMPT} ${PREFIX}v`), what: 'typed a letter' },
        { types: CLEARS_THE_LINE, until: () => true, what: 'abandoned the row' },
        leaves,
      ],
    });
    const bare = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const marked = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    const narrowed = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, rows);

    // THE PREVIEW IS THERE, and it is the CEILING rather than the vocabulary: four rows, and a
    // row saying how many had no room. That is what makes it a preview and not a menu of
    // everything, which is the fear the delivery before this one shut the list over.
    const shown = listRowsOn(bare, words);
    expect(shown.length, 'a bare slash opened nothing at all').toBe(4);
    expect(bare.text, 'the preview did not say what it had no room for').toContain(CUT);

    // AND THE ROWS ARE NAVIGABLE: one arrow puts the mark on a row that is drawn.
    const picked = pickedOn(marked);
    expect(picked, 'no row of the preview carries the mark after an arrow').not.toBe('');
    expect(
      listRowsOn(marked, words).some((row) => row.includes(picked)),
      'the mark is on a row nothing drew',
    ).toBe(true);

    // AND THE LETTER FILTERS WITHOUT MOVING THE CEILING: what is left is a SUBSET of what was
    // there, and it is never more than the four.
    const after = listRowsOn(narrowed, words);
    expect(after.length, 'the letter shut the list').toBeGreaterThan(0);
    expect(after.length, 'the letter moved the ceiling').toBeLessThanOrEqual(shown.length);
    const wordOf = (row: string): string =>
      row.trimStart().replace(/^❯\s*/, '').split(/\s+/)[0] ?? '';
    for (const row of after) {
      expect(wordOf(row), 'a letter that narrows offered a word that starts with another').toMatch(
        /^v/,
      );
    }
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The word carries the accent, and NO_COLOR takes the tone
// ---------------------------------------------------------------------------

describe('the word in the list carries the accent, and the description does not', () => {
  it('paints the word in a session with colour, and leaves it spelled in one without', async () => {
    // WHAT THE CALLER ASKED FOR: *the verbs in the search should have colour*. Both halves on
    // two REAL sessions, because the whole question is what a stream carries: the tone is the
    // renderer's and it obeys the channel the delivery before this one wired
    // (`src/wiring/color.ts`).
    const columns = 120;
    const rows = THE_FLOOR.rows;
    const words = everythingOffered().map((offer) => offer.word);
    const walk = (): readonly Step[] => [
      opens,
      { types: PREFIX, until: arrivedSince(CUT), what: 'opened the preview' },
      { types: CLEARS_THE_LINE, until: () => true, what: 'abandoned the row' },
      leaves,
    ];
    const withColour = await inPty({ columns, rows, steps: walk() });
    const without = await drive(
      { ...fixture(), environment: { ...environment, NO_COLOR: '1' } },
      { columns, rows, steps: walk() },
    );

    // THE WORD IS ON THE PAGE IN BOTH, which is the half that may never go: what a reader
    // without colour loses is the tone, never the word.
    for (const [ran, said] of [
      [withColour, 'with colour'],
      [without, 'with none'],
    ] as const) {
      const screen = screenOf(
        (ran as Ran).bytes.slice(0, (ran as Ran).at[1] as number),
        columns,
        rows,
      );
      expect(listRowsOn(screen, words).length, `the list is not legible ${said}`).toBe(4);
    }

    // AND THE ACCENT IS ON THE WORD IN ONE AND NOWHERE IN THE OTHER. What is looked for is the
    // accent IMMEDIATELY BEFORE a word — the word painted, rather than paint anywhere on a page
    // that is full of it — and the escapes are read off a line the product composes rather than
    // typed here (`src/presentation/styled.ts`).
    const painted = renderStyled({ indent: 0, parts: [asWord('search')] });
    const accent = painted.slice(0, painted.indexOf('search'));
    expect(accent, 'the accent is not an escape at all').toContain(ESC);
    const listed = words.filter((word) => withColour.bytes.includes(`${accent}${word}`));
    expect(listed.length, 'no word of the list was painted in the accent').toBeGreaterThan(0);
    for (const word of listed) {
      expect(
        without.bytes.includes(`${accent}${word}`),
        `the accent on ${word} survived NO_COLOR`,
      ).toBe(false);
    }
    // AND THE DESCRIPTION BESIDE IT IS BARE, which is what makes the word the subject of its
    // row: paint both and neither is. The row is read off the page rather than composed here.
    const row = screenOf(
      withColour.bytes.slice(0, withColour.at[1] as number),
      columns,
      rows,
    ).rows.find((line) => listRowsOn({ rows: [line] } as Screen, words).length === 1);
    expect(row, 'no row of the list is on the page').toBeDefined();
    expect(row as string, 'the page carries the escapes rather than the glyphs').not.toContain(ESC);
    // AND NOTHING PAINTED SURVIVES `NO_COLOR` ANYWHERE ON THAT PAGE, which is the standing rule
    // this colour had to join rather than an exception to it.
    expect(without.bytes.includes(accent), 'the accent survived NO_COLOR somewhere').toBe(false);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The margin takes columns of the page and no character of a line
// ---------------------------------------------------------------------------

describe('the margin before the bar grew, and it eats nothing', () => {
  it('puts the widest thing the page draws on it whole, at the floor', async () => {
    // WHAT THE CALLER ASKED FOR: *the bar should pull back a little into the side margin*. What
    // a margin may never do is cost a line a character — a value a reader cannot check is the
    // one thing this surface refuses to print — so the promise is asked where the page is
    // tightest, which is the floor.
    const screen = await openedAt(THE_FLOOR.columns, THE_FLOOR.rows);
    expect(screen.text, 'the floor never opened a console').toContain(PROMPT);
    // THE WIDEST THING DRAWN INSIDE THE MARGIN IS THE ART, and every row of it is on the page
    // whole — asserted above as well, and here it is the WIDTH that is the subject.
    const widest = [...AN_UNMISTAKABLE_ROW.trimEnd()].length;
    expect(widest, 'the drawing has no width at all').toBeGreaterThan(0);
    expect(
      insideTheMargin(THE_FLOOR.columns),
      'the margin leaves less page than the drawing needs',
    ).toBeGreaterThanOrEqual(widest);
    expect(screen.text, 'the widest row of the drawing is not on the page whole').toContain(
      AN_UNMISTAKABLE_ROW.trimEnd(),
    );
    // AND NOTHING ON THE PAGE IS CUT. The one mark this surface cuts with is the palette's, and
    // no list is open on a page that has just opened — so the mark's absence is the statement
    // that nothing was truncated to make room for the margin.
    expect(screen.text, 'something on the page was cut to fit the margin').not.toContain(CUT);
    // AND NO ROW RAN PAST THE EDGE, which is the other way a margin can cost a line: a row wider
    // than the terminal is a row the terminal folds somewhere nobody counted.
    for (const row of screen.rows) {
      expect(
        [...row.replace(/\s+$/, '')].length,
        `a row ran past the edge of the window: ${row}`,
      ).toBeLessThanOrEqual(THE_FLOOR.columns);
    }
    // AND THE BAR CLEARS THE ROW UNDER THE PROMPT, which is WHY the margin grew and the only
    // thing here that a number written down could not have answered. At two columns the guide
    // landed on column three and column three is where the hint begins — the hint is an `aside`,
    // so it sits one indent in — and the page had two different things at one left edge. BOTH
    // COLUMNS ARE READ OFF THE PAGE: a case that asked the constant would agree with itself at
    // any value it took (measured: mutating the margin back to two left this file green).
    const guideAt = screen.rows
      .map((row) => [...row].indexOf(THE_GUIDE))
      .find((at) => at >= 0) as number;
    expect(guideAt, 'no row of the roll carries the guide at all').toBeGreaterThanOrEqual(0);
    expect(guideAt, 'the guide is not drawn where the margin says').toBe(BEFORE_THE_BAR);
    const hint = renderPlain(tips());
    const hintRow = screen.rows.find((row) => row.includes(hint.trim())) as string;
    expect(hintRow, 'the row under the prompt is not on the page').toBeDefined();
    const hintAt = [...hintRow].findIndex((glyph) => glyph !== ' ');
    expect(hintAt, 'the row under the prompt begins nowhere').toBeGreaterThanOrEqual(0);
    expect(
      guideAt,
      'the guide sits in the same column the row under the prompt begins in',
    ).toBeGreaterThan(hintAt);
    expect(THE_INSET, 'the margin is not the three parts it is made of').toBe(
      BEFORE_THE_BAR + 1 + AFTER_THE_BAR,
    );
  }, 240_000);
});

// ---------------------------------------------------------------------------
// A1 — the sites, by the discriminant
// ---------------------------------------------------------------------------

/** Every production source of this package, with comments and string literals blanked. */
function everySource(): readonly { readonly path: string; readonly code: string }[] {
  return sourceFiles(SRC).map((path) => ({
    path,
    code: codeOnly(readFileSync(path, 'utf-8')),
  }));
}

describe('the four rules this delivery touched hold at every site, found by the discriminant', () => {
  it('indents the page from ONE statement of the margin, wherever it is drawn', () => {
    // THE DISCRIMINANT IS THE LAYOUT'S OWN WORD FOR IT — `paddingLeft` — and not a list of
    // files. Wherever a component of this console pushes something right, the number has to be
    // the margin's (`src/repl/inset.ts`); a literal there is a second statement of where the
    // page begins, and the two would disagree the first time one of them moved.
    const sites: string[] = [];
    for (const { path, code } of everySource()) {
      for (const [, value] of code.matchAll(/paddingLeft\s*:\s*([A-Za-z0-9_]+)/g)) {
        sites.push(`${path}: ${value}`);
        expect(
          ['THE_INSET', 'BEFORE_THE_BAR', 'AFTER_THE_BAR'],
          `a component indents by a number of its own: ${path} (${value})`,
        ).toContain(value);
      }
    }
    // NOT VACUOUS: the discriminant really found the sites, and there is more than one of them.
    expect(sites.length, 'no module indents the page at all').toBeGreaterThan(1);
  });

  it('decides whether the list opens in ONE place, asked by everything that draws one', () => {
    // WHAT DECIDES IF THE LIST OPENS is `offeredBy`, and the rule this delivery changed lives
    // inside it. A second reading of *is there a list on this row* is how a console comes to
    // have two menus — which is the defect the palette was written to end.
    const declared = everySource().filter(({ code }) => /export function offeredBy\b/.test(code));
    expect(
      declared.map(({ path }) => path),
      'the rule is declared more than once',
    ).toHaveLength(1);
    const callers = everySource().filter(
      ({ code, path }) => /\bofferedBy\s*\(/.test(code) && path !== declared[0]?.path,
    );
    // TWO CALLERS AND ONE ANSWER, which is the shape this rule has to have rather than a
    // duplication to collapse: the DRAWING asks it before it composes a frame and the KEYS ask
    // it before they move a mark, and a console whose list and whose arrows disagreed about
    // whether there is a list is the defect the palette exists to make impossible.
    expect(callers.length, 'nothing asks the rule at all').toBeGreaterThan(1);
    // AND NOBODY ANSWERS IT THEMSELVES. The discriminant is the comparison the rule is MADE of
    // — what was typed, against the prefix — and the one other place in this package that
    // strips a prefix is the completer, which does it to a CANDIDATE and not to the row. A
    // second module asking whether the row begins with a slash would be a second answer to
    // *is there a list open*, arrived at without calling the function that decides.
    const decides = everySource().filter(({ code }) => /\btyped\.startsWith\s*\(/.test(code));
    expect(
      decides.map(({ path }) => path),
      'something other than the rule decides whether the row opens a list',
    ).toEqual([declared[0]?.path]);
  });

  it('gives every role a way to be drawn, so an offer’s line cannot acquire an emphasis nobody chose', () => {
    // THE SITES OF *WHAT COMPOSES THE LINE OF AN OFFER* ARE THE ROLE TABLES, and they are
    // enumerated from the union rather than from a list here. Totality is enforced by the TYPE —
    // the three tables are mapped over `Role`, so a role added without an entry does not build —
    // and this is the reading of that guard which says what the N is: every role the union
    // declares is answered by each of the three, and the union is walked rather than retyped.
    const tables = ['PRECEDED_BY', 'OPENED_BY', 'TINTED_BY'];
    const sources = new Map(everySource().map(({ path, code }) => [path, code]));
    for (const table of tables) {
      const holder = [...sources.entries()].find(([, code]) =>
        new RegExp(`const ${table}\\s*:`).test(code),
      );
      expect(holder, `nothing declares ${table}`).toBeDefined();
      const code = (holder as [string, string])[1];
      const body = code.slice(code.indexOf(`const ${table}`));
      const entries = body.slice(0, body.indexOf('};'));
      for (const role of ROLES) {
        expect(entries, `${table} has no entry for the role ${role}`).toMatch(
          new RegExp(`\\b${role}\\s*:`),
        );
      }
    }
    // AND THE WORD IS A ROLE THE PRODUCT REALLY PRODUCES, which is the half a table cannot say:
    // the console's list composes its first column with it.
    expect(
      ROLES as readonly Role[],
      'the union has no role for a word a caller could type',
    ).toContain('word');
    const palette = [...sources.entries()].find(([path]) => path.endsWith('repl/palette.ts'));
    expect(
      (palette as [string, string])[1],
      'the list does not compose its word as a part',
    ).toMatch(/asWord\s*\(/);
  });
});
