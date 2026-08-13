/**
 * A PALETTE FOR THE WORDS — what a caller could type next, and what each of them is.
 *
 * IT CAME OUT OF ONE MARK ON A SCREENSHOT: the slash, and the list under it. What was
 * there before was two half-affordances — the session's own words, which you had to know
 * before you could ask for them, and a Tab that printed a row of bare tokens when it could
 * not decide. One list serves both now, and every case here asks the question that shape
 * can fail:
 *
 *   - IT OPENS ON THE KEY AND NARROWS AS YOU TYPE. On a real pseudo-terminal, because
 *     "the list is on the screen" is a statement about a screen.
 *   - THE SLASH IS THE FIRST CHARACTER OR IT IS NOTHING. Inside a word it is a character.
 *   - WHAT IT SAYS A VERB IS, IS WHAT `--help` SAYS IT IS. Asserted against the bytes the
 *     built binary prints, never against a sentence retyped here.
 *   - IT FITS, AND WHEN IT DOES NOT IT SAYS SO. The rows are budgeted by the same
 *     arithmetic the rest of the area is (`repl/area.ts`), and the number of offers with
 *     no room is asserted against the TOTAL rather than written down. The property is
 *     checked over a grid of heights and widths, because "does it ever hide one quietly"
 *     is a question about all of them.
 *   - THE BOUNDARY DID NOT MOVE. The palette is the tallest thing the region can hold, so
 *     the height at which the layout library gives up on redrawing PART of the screen —
 *     and writes the one erase this product refuses to write — is measured again with it
 *     OPEN, at two widths, and against the same height with it shut.
 *   - A ROW THAT WOULD FOLD IS NOT DRAWN, and the two numbers it happens at are the
 *     product's own widths rather than constants chosen here.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import type { CompletionWord } from '../src/completion/tree.js';
import { completionTree } from '../src/completion/tree.js';
import { echoLine } from '../src/presentation/echo.js';
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { areaFor } from '../src/repl/area.js';
import { type Completer, completerFor } from '../src/repl/complete.js';
import { erasesTheScreen } from '../src/repl/erasing.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { verbsOffered } from '../src/repl/gate.js';
import {
  CUT,
  NOBODY,
  offeredBy,
  PICK,
  paletteFor,
  paletteRowsFor,
  theNextPicked,
  thePicked,
} from '../src/repl/palette.js';
import { badgeLine, pickingTips, theSessionsOwnWords, tips } from '../src/repl/session.js';
import { CLEAR, PREFIX, SESSION_WORDS } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ENDS_THE_INPUT, ESC } from './support/console.js';
import {
  aFrameAfter,
  aFrameWithout,
  arrivedSince,
  arrivedUnpainted,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  rowsOfTheFrames,
  type Step,
} from './support/pty.js';
import {
  fillsTheScreen,
  type Screen,
  screenOf,
  theScreenBeforeLeaving,
  theSettledScreen,
} from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;
/** `packages/code/src`, for the guards that read the surface's own source. */
const SRC = new URL('../src', import.meta.url).pathname;

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';
/** Ctrl-C, which abandons the row being typed. Spelled as an escape, never typed. */
const CLEARS_THE_LINE = '\u0003';
/** Tab, likewise. */
const COMPLETES = '\u0009';
/** The two keys that move through the list, as a terminal sends them. */
const MOVES_DOWN = '\u001b[B';
const MOVES_UP = '\u001b[A';
/** Escape, which shuts the list. One byte, and the library tells it from an arrow's own. */
const SHUTS_THE_LIST = '\u001b';
/** The chord that empties the row. */
const CLEARS_THE_ROW = '\u0015';
/** The sequence that erases the caller's history. It is not this product's to write. */
const ERASES_THE_HISTORY = `${ESC}[3J`;

/**
 * ANY SEQUENCE THAT PAINTS — a hue, a weight, or the end of either.
 *
 * Built rather than written as a literal, because a control byte inside a regular expression is
 * refused at the door of this repository (and rightly: it is a byte a reader cannot see).
 */
const PAINTED = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** A line with everything that paints taken off it — what a pipe would have received. */
const stripped = (line: string): string => line.replace(PAINTED, '');

/** How wide a terminal has to be for nothing in these lists to be cut. */
const NOTHING_IS_CUT = 160;

/**
 * NOTHING ABOVE THE AREA — how tall the fixed region at the top is taken to be here.
 *
 * IT WAS THE FLOW, and the field it fills is not the field it used to. The list took its rows
 * out of what the PAGE had left over under everything the session had said, so the number GREW
 * as lines landed; what a session says is a window onto a roll now, inside the middle region, so
 * what the list is budgeted against is the ARRANGEMENT at the top (`repl/area.ts`,
 * `AreaRequest.header`). Nought leaves every number in this file about the height of a terminal
 * alone, which is what it was about before either field existed.
 */
const NOTHING_ABOVE_YET = 0;

/**
 * A SENTENCE ONLY THE LIST SAYS, so a screen can be asked whether it is open.
 *
 * Read off the vocabulary rather than retyped: it is what the session says about the word that
 * clears the page, and the day that is reworded this moves with it.
 */
const ONLY_A_LIST_SAYS = theSessionsOwnWords().find((entry) => entry.word === CLEAR)
  ?.description as string;

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` at the shell, in this process, with the output thrown away. */
async function shell(...argv: string[]): Promise<void> {
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(argv, io);
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-palette-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  await shell('init');
  await shell('task', 'the task the palette is opened over');

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

// ---------------------------------------------------------------------------
// What the session offers, read off the declarations
// ---------------------------------------------------------------------------

/**
 * Every word a Tab offers on an empty row, out of the same program a session builds.
 *
 * Read rather than listed, so the cases below are about however many verbs this product
 * has today: the reads it runs, and the words it answers to itself.
 */
function everythingOffered(): readonly CompletionWord[] {
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const built = buildProgram(io, [], renderPlain);
  const offered = verbsOffered(built.verbs, REPL_VERB);
  const described = new Map(
    (completionTree(built.program).nodes.find((node) => node.path === '')?.commands ?? []).map(
      (child) => [child.word, child.description] as const,
    ),
  );
  return [
    ...offered.map((word) => ({ word, description: described.get(word) ?? '' })),
    ...theSessionsOwnWords(),
  ].sort((one, other) => (one.word < other.word ? -1 : one.word > other.word ? 1 : 0));
}

/**
 * WHAT CAN BE TYPED WHERE THE CARET IS, as the console asks it — the real completer, over the
 * same program a session builds.
 *
 * IT IS THE ONE LIST, and that is why the cases below take it rather than a vocabulary. Both
 * keys ask this: a Tab asks about the line up to the caret, and a slash asks about the line it
 * is the first character of. A fake here would be a case about a shape rather than about the
 * answer a caller gets.
 *
 * A session that has named nothing, because what a record adds to the offers is asked where
 * the memory of the page is (`repl/session.test.ts`).
 */
function theCompleter(): Completer {
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const built = buildProgram(io, [], renderPlain);
  return completerFor(
    completionTree(built.program),
    verbsOffered(built.verbs, REPL_VERB),
    theSessionsOwnWords(),
    () => [],
  );
}

// ---------------------------------------------------------------------------
// What is offered: the two triggers
// ---------------------------------------------------------------------------

describe('one palette, one list, and the slash counts only at the start of the line', () => {
  const tabOffered: readonly CompletionWord[] = [
    { word: 'search', description: 'a read' },
    { word: 'show', description: 'another read' },
  ];
  /** What can be typed here, as the console asks it: the real completer over a real tree. */
  const asked = theCompleter();
  /** The words of what a key asks for on a given line. */
  const wordsOf = (offers: readonly CompletionWord[]): readonly string[] =>
    offers.map((offer) => offer.word);

  it('opens the whole list on a bare slash, and the letter narrows THAT list', () => {
    // THIS CASE SAID *opens NOTHING on a bare slash*, and the argument was that a bare slash is
    // a caller asking WHAT EXISTS while a slash with a letter is a verb being written. The
    // premise it rests on — that *what exists* is not a question — is what a caller reading the
    // page falsified: a bar with a slash in it and nothing under it is somebody asking what there
    // is, and nothing is the wrong answer. What made the old fear groundless is the CEILING: four
    // rows and an account of the rest, which is a preview rather than a menu of everything.
    expect(offeredBy(PREFIX, [], asked), 'a bare slash opened nothing').toEqual(asked(PREFIX)[0]);
    expect(offeredBy(PREFIX, [], asked).length, 'the whole list is empty').toBeGreaterThan(4);
    // AND THE LETTER OPENS IT, over BOTH vocabularies: the slash is a key rather than a letter
    // of the word behind it, so `/c` reaches the verbs beginning with `c` and the session's own
    // word that does (`complete.ts`, `theStem`).
    const narrowed = wordsOf(offeredBy(`${PREFIX}c`, [], asked));
    expect(narrowed.length, 'the letter opened nothing').toBeGreaterThan(0);
    expect(narrowed, 'the session\u2019s own word is not in the list').toContain(CLEAR);
    expect(
      narrowed.some((word) => !word.startsWith(PREFIX)),
      'no verb is in the list',
    ).toBe(true);
    // AND IT IS THE COMPLETER'S OWN ANSWER, whichever key asked — nothing is filtered twice.
    expect(narrowed).toEqual(wordsOf(asked(`${PREFIX}c`)[0]));
  });

  it('narrows to the words that can still be typed as the caller types them', () => {
    // Narrowing REDUCES, and to the words that really start that way rather than to a
    // number: the case reads the vocabulary rather than counting to one.
    const whole = offeredBy(`${PREFIX}c`, [], asked);
    const narrowed = offeredBy(`${PREFIX}cl`, [], asked);
    expect(narrowed.length).toBeLessThan(whole.length);
    expect(wordsOf(narrowed)).toEqual([CLEAR]);
    // Not vacuous: there was more than one word to narrow away from, and what survives is a
    // real word with a real gloss.
    expect(whole.length).toBeGreaterThan(1);
    for (const offer of narrowed) expect(offer.description.length).toBeGreaterThan(3);
  });

  it('neither of the two words that went is offered anywhere', () => {
    // THE REMOVAL, ASKED OF THE LIST. `/help` and `/exit` are not in the vocabulary any more —
    // the list IS the help, and the key that ends the input is the way out — so no keystroke
    // can put either of them on the screen. Asked over every prefix of each word, because a
    // word half-removed shows up under the letters nobody thought to type.
    for (const gone of [`${PREFIX}help`, `${PREFIX}exit`]) {
      for (let at = PREFIX.length + 1; at <= gone.length; at += 1) {
        const typed = gone.slice(0, at);
        expect(wordsOf(offeredBy(typed, [], asked)), typed).not.toContain(gone);
      }
      // And a Tab on the whole word answers with nothing at all, which is what a word the
      // session does not run looks like from here.
      expect(asked(gone)[0], gone).toEqual([]);
    }
    // Not vacuous: the same walk over a word that IS offered finds it at every prefix.
    for (let at = PREFIX.length + 1; at <= CLEAR.length; at += 1) {
      const typed = CLEAR.slice(0, at);
      expect(wordsOf(offeredBy(typed, [], asked)), typed).toContain(CLEAR);
    }
  });

  it('offers nothing for a slash that is not the first character', () => {
    // A slash inside a path, an argument or a word is a character like any other. Both
    // halves are asserted: the palette is shut, and it is shut BECAUSE of the position —
    // the same characters at the start of the line do open it.
    for (const line of [`show a${PREFIX}b`, `search ${PREFIX}clear`, `a${PREFIX}`]) {
      expect(offeredBy(line, [], asked), line).toEqual([]);
    }
    expect(offeredBy(`${PREFIX}cl`, [], asked).length).toBe(1);
    // AND IT DOES NOT SUPPRESS WHAT A TAB OFFERED, WHICH IS THE OTHER HALF AND THE ONE
    // THE FIRST DRAFT OF THIS CASE MISSED. Reading the slash anywhere in the line is a
    // mutation that leaves every assertion above green — asking about a whole line that has a
    // verb in it answers with nothing either way — and what it really breaks is the OTHER
    // key: a Tab pressed on a line holding a path would stop offering anything at all.
    // Measured: the mutation lit zero cases until this line existed.
    expect(offeredBy(`show a${PREFIX}`, tabOffered, asked)).toEqual(tabOffered);
    expect(offeredBy(`show ${PREFIX}tmp${PREFIX}x`, tabOffered, asked)).toEqual(tabOffered);
  });

  it('offers what a Tab could not choose between when the line has no slash', () => {
    expect(offeredBy('s', tabOffered, asked)).toEqual(tabOffered);
    // And nothing at all when a Tab offered nothing, which is a palette that is shut.
    expect(offeredBy('s', [], asked)).toEqual([]);
  });

  it('lets a word being typed win over what a Tab left, because it is live', () => {
    // Typing a slash and a letter after an ambiguous Tab is a caller asking a different
    // question. Both answers exist here, so this says which one is given.
    const typed = `${PREFIX}c`;
    expect(offeredBy(typed, tabOffered, asked)).toEqual(offeredBy(typed, [], asked));
    expect(offeredBy(typed, tabOffered, asked)).not.toEqual(tabOffered);
    // AND THE BARE SLASH IS A QUESTION TOO, so it wins over what a Tab left exactly as `/c`
    // does. IT SAID *the bare slash is not a question, so what a Tab left stands under it*, and
    // the sentence went with the decision it was written for: a slash typed on a row is the
    // caller asking what there is, and answering with the last thing a Tab happened to offer
    // would be answering a different question.
    expect(offeredBy(PREFIX, tabOffered, asked)).toEqual(asked(PREFIX)[0]);
    expect(offeredBy(PREFIX, tabOffered, asked)).not.toEqual(tabOffered);
  });
});

// ---------------------------------------------------------------------------
// What the rows say, and the one thing that is cut
// ---------------------------------------------------------------------------

/**
 * The rows a palette composes, as the console asks for them — with a word picked, or none.
 *
 * IT PASSES THE PRODUCT'S OWN ROW OF KEYS rather than a line invented here, because that row is
 * one of the palette's rows: a fixture with a different one would make every count below about a
 * palette this product does not compose (`repl/session.ts`, `pickingTips`).
 */
function rowsFor(
  offers: readonly CompletionWord[],
  room: number,
  columns: number,
  picked: string = NOBODY,
): string[] {
  return [...paletteFor({ offers, room, columns, render: renderPlain, picked, picking: THE_KEYS })];
}

/** The row that says which keys move the list, as the palette draws it. */
const THE_KEYS = pickingTips();

/** The same row as bytes — what a case looks for at the bottom of a palette. */
const THE_KEYS_ROW = renderPlain(THE_KEYS);

/** The rows of the LIST: everything the palette drew except the row of keys under it. */
function listIn(rows: readonly string[]): string[] {
  return rows.filter((row) => row !== THE_KEYS_ROW);
}

/** The number on the row that says how many offers had no room, or nothing when there is none. */
function saidToBeMissing(rows: readonly string[]): number | undefined {
  const said = rows.find((row) => row.includes(CUT) && /\d/.test(row));
  if (said === undefined) return undefined;
  const digits = /(\d+)/.exec(said);
  return digits === null ? undefined : Number(digits[1]);
}

describe('the palette is two columns, and the only thing it cuts is a description', () => {
  /**
   * A LIST WITHIN THE CEILING, so that every row drawn is an OFFER.
   *
   * These cases are about the TABLE — a row per offer, the second column lined up, and the one
   * thing that is ever shortened — and the ceiling put a row of a different kind at the bottom
   * of a list of everything ({@link atMost}): the account of what had no room, which carries
   * the same mark a cut does and is not an offer. What is asked here is unchanged; what it is
   * asked OF is a list the ceiling does not bite on.
   */
  const offers = everythingOffered().slice(0, atMost());

  it('puts every offer on one row, with what it is beside it', () => {
    const rows = rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT);
    const listed = listIn(rows);
    expect(listed).toHaveLength(offers.length);
    // AND THE ROW OF KEYS IS UNDER THEM, which is the one row of a palette that is not an offer.
    expect(rows.at(-1), 'the keys are not the last row of the list').toBe(THE_KEYS_ROW);
    for (const [index, offer] of offers.entries()) {
      const row = listed[index] as string;
      expect(row, offer.word).toContain(offer.word);
      if (offer.description.length > 0) expect(row, offer.word).toContain(offer.description);
    }
    // The corpus is real: it is the head of a vocabulary of more than a handful of reads, and
    // every one of them has something to say about itself.
    expect(offers.length).toBeGreaterThan(1);
    expect(everythingOffered().length).toBeGreaterThan(10);
    expect(offers.every((offer) => offer.description.length > 0)).toBe(true);
  });

  it('lines the second column up, which is what makes it a column', () => {
    const rows = listIn(rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT));
    const at = rows.map((row, index) => row.indexOf((offers[index] as CompletionWord).description));
    expect(new Set(at).size, `the descriptions start at ${[...new Set(at)].join()}`).toBe(1);
    // Not vacuous: the words are of different lengths, so an unpadded list would not line
    // up at all.
    expect(new Set(offers.map((offer) => offer.word.length)).size).toBeGreaterThan(1);
  });

  it('cuts a description that is too long, and says so with a mark', () => {
    // NARROW ENOUGH THAT SOMETHING HAS TO GO. The width is derived from the longest thing
    // there is to say rather than chosen, so this case cannot stop discriminating the day
    // a description is reworded.
    const longest = offers.reduce((most, offer) =>
      offer.description.length > most.description.length ? offer : most,
    );
    const wide = rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT);
    expect(
      wide.some((row) => row.includes(CUT)),
      'something was cut at a width that fits',
    ).toBe(false);

    const narrow = rowsFor(offers, paletteRowsFor(offers), 60);
    const cut = narrow.filter((row) => row.endsWith(CUT));
    expect(cut.length, 'nothing was cut on a narrow window').toBeGreaterThan(0);
    // WHAT A CUT ROW IS: no wider than the terminal, and ending in the mark that says
    // there is more. Never silently short.
    for (const row of narrow) expect([...row].length, row).toBeLessThanOrEqual(60);
    const longestRow = narrow.find((row) => row.trimStart().startsWith(longest.word)) as string;
    expect(longestRow, longest.word).toBeDefined();
    expect(longestRow.endsWith(CUT), longestRow).toBe(true);
    // AND WHAT IS LEFT IS THE BEGINNING OF WHAT IT SAYS, so the mark stands for the rest
    // rather than for a sentence that was replaced.
    const said = longestRow.trimStart().slice(longest.word.length).trimStart();
    expect(longest.description.startsWith(said.slice(0, -1)), said).toBe(true);
    // Not vacuous: something survived the cut, so the assertion above is over a real
    // prefix rather than over the empty string.
    expect(said.length, said).toBeGreaterThan(3);
    expect(said.length).toBeLessThan(longest.description.length);
  });
});

// ---------------------------------------------------------------------------
// The invariant: it never hides an offer without saying
// ---------------------------------------------------------------------------

describe('whenever it draws a row, what it shows plus what it names is everything there was', () => {
  const offers = everythingOffered();

  it('holds over every height and width a terminal has', () => {
    // THE ADVERSARIAL QUESTION, ASKED OVER A GRID. "Does the palette ever hide an offer
    // without saying" cannot be answered by one case: the answer is a property of every
    // pair of a room and a width, including the ones where there is room for a single row
    // and the ones too narrow for a table at all.
    let drew = 0;
    let stayedAway = 0;
    for (const room of [0, 1, 2, 3, 5, 8, offers.length, offers.length + 4]) {
      for (const columns of [0, 8, 14, 20, 30, 40, 60, 80, 100, NOTHING_IS_CUT]) {
        const rows = rowsFor(offers, room, columns);
        if (rows.length === 0) {
          stayedAway += 1;
          continue;
        }
        drew += 1;
        // Every row fits, so nothing the arithmetic counted as one row is two.
        for (const row of rows)
          expect([...row].length, `${room}/${columns}`).toBeLessThanOrEqual(columns);
        // And it never draws more rows than it was given room for.
        expect(rows.length, `${room}/${columns}`).toBeLessThanOrEqual(room);
        // AND IT DRAWS EXACTLY WHAT THE AREA BUDGETED, which is the property the caret and
        // the foot of the page rest on: the same function answers how many rows the list wants
        // and how many it spends (`repl/palette.ts`, `paletteRowsFor`), so a row drawn and not
        // counted — the shape a row of KEYS added to one side alone would have — is a page whose
        // input is a row off the last one the layout leaves.
        expect(rows.length, `${room}/${columns}: what the area budgeted`).toBe(
          Math.min(paletteRowsFor(offers), room),
        );
        const listed = listIn(rows);
        const missing = saidToBeMissing(listed);
        const shown = missing === undefined ? listed.length : listed.length - 1;
        expect(shown + (missing ?? 0), `${room}/${columns}: ${rows.length} rows`).toBe(
          offers.length,
        );
      }
    }
    // NOT VACUOUS IN EITHER DIRECTION: the grid really contains cases where it drew and
    // cases where it stayed away, so neither branch above is being skipped.
    expect(drew, 'the palette never drew anything in the whole grid').toBeGreaterThan(10);
    expect(stayedAway, 'the palette drew something at every size').toBeGreaterThan(0);
  });

  it('spends a row on saying so, rather than showing one more and going quiet', () => {
    // THE NUMBERS MOVED BY ONE ROW, AND THE ROW IS THE KEYS'. Three rows of room is now one
    // offer, the account of the rest, and the row that says which keys move the list — so what
    // it names is one more than it used to be. The count is still asserted against the TOTAL
    // rather than written down, which is what keeps it a measurement.
    const rows = rowsFor(offers, 3, NOTHING_IS_CUT);
    expect(rows).toHaveLength(3);
    expect(rows.at(-1)).toBe(THE_KEYS_ROW);
    expect(saidToBeMissing(listIn(rows))).toBe(offers.length - 1);
    // AND WITH ROOM FOR EXACTLY ONE ROW, THAT ROW IS THE ACCOUNT AND THE KEYS GIVE THEIRS UP: a
    // row saying how to move a list nobody can see would be furniture where the honesty goes.
    const only = rowsFor(offers, 1, NOTHING_IS_CUT);
    expect(only).toHaveLength(1);
    expect(only).not.toContain(THE_KEYS_ROW);
    expect(saidToBeMissing(only)).toBe(offers.length);
  });

  it('says nothing when everything fits, so the row is a signal and not furniture', () => {
    // A LIST WITHIN THE CEILING, which is what *everything fits* means now: the room a
    // terminal has is not the only limit any more ({@link AT_MOST}), so a list of eighteen
    // says how many it left out at every height there is. Read off the product rather than
    // written down — the ceiling is not this file's number.
    const few = offers.slice(0, atMost());
    const rows = rowsFor(few, paletteRowsFor(few), NOTHING_IS_CUT);
    expect(listIn(rows)).toHaveLength(few.length);
    expect(saidToBeMissing(listIn(rows))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The ceiling: four offers, whatever the terminal has room for
// ---------------------------------------------------------------------------

/**
 * HOW MANY OFFERS THE PALETTE DRAWS AT MOST, read off the product rather than written here.
 *
 * The ceiling is a decision of the module that draws the list, so a case that typed the number
 * would be asserting its own arithmetic — and the number a reader wants to see is what the
 * PRODUCT does with a vocabulary bigger than the ceiling on a screen with room to spare.
 */
function atMost(): number {
  const room = 100;
  return listIn(rowsFor(everythingOffered(), room, NOTHING_IS_CUT)).length - 1;
}

describe('the list shows four offers, and the room a terminal has can only make it fewer', () => {
  const offers = everythingOffered();

  it('shows the same four at every height a caller can open', () => {
    // THE CASE THAT TELLS *four* FROM *what fits*. One height cannot: a list cut to the screen
    // shows whatever the screen leaves, and at any single size that number can be four by
    // luck. Three heights, an ordinary window and two much taller ones, and the answer does
    // not move.
    const shownAt = (rows: number): number => {
      const room = areaFor({
        rows,
        columns: NOTHING_IS_CUT,
        badge: BADGE_IS,
        hint: HINT_IS,
        palette: paletteRowsFor(offers),
        header: NOTHING_ABOVE_YET,
      }).palette;
      const drawn = listIn(rowsFor(offers, room, NOTHING_IS_CUT));
      return drawn.length - (saidToBeMissing(drawn) === undefined ? 0 : 1);
    };
    /** More rows than the tallest window here, so what answers is the SCREEN and not the ask. */
    const MORE_THAN_ANY_SCREEN = 500;
    const heights = [24, 40, 64];
    const counts = heights.map((rows) => shownAt(rows));
    expect(new Set(counts).size, `the height decided how many: ${counts.join(', ')}`).toBe(1);
    expect(counts[0]).toBe(atMost());
    // NOT VACUOUS: the room really does grow with the height, so the counts above are equal
    // because of the ceiling and not because the three windows are the same window.
    const roomAt = (rows: number): number =>
      areaFor({
        rows,
        columns: NOTHING_IS_CUT,
        badge: BADGE_IS,
        hint: HINT_IS,
        palette: MORE_THAN_ANY_SCREEN,
        header: NOTHING_ABOVE_YET,
      }).palette;
    expect(roomAt(64)).toBeGreaterThan(roomAt(24));
  });

  it('asks for the same rows at every height, so the area cannot budget more', () => {
    // THE OTHER END OF THE SAME RULE. What the area budgets is what the palette ASKS for
    // (`repl/area.ts`), so a ceiling applied when the rows are drawn and not when they are
    // counted would be a region taller than what is drawn in it — the caret and the foot of
    // the page a row out.
    // The account of what had no room, and the row that says which keys move the list: one
    // row each, and they are the two rows a list of this size has beyond its offers.
    const beyondTheOffers = 2;
    expect(paletteRowsFor(offers)).toBe(atMost() + beyondTheOffers);
    expect(offers.length, 'the vocabulary is within the ceiling anyway').toBeGreaterThan(atMost());
  });

  it('shows what there is when there is less than the ceiling', () => {
    // A CEILING AND NOT A QUOTA: a list of two is two rows, not two rows and two blanks.
    for (const many of [1, 2, atMost()]) {
      const few = offers.slice(0, many);
      const drawn = listIn(rowsFor(few, paletteRowsFor(few), NOTHING_IS_CUT));
      expect(drawn, `${many}`).toHaveLength(many);
      expect(saidToBeMissing(drawn), `${many}`).toBeUndefined();
    }
  });

  it('shows fewer than the ceiling when the room is the smaller limit', () => {
    // AND THE ROOM STILL CUTS, which is what makes it a second limit rather than a
    // replacement: at three rows the list is one offer, the account of the rest and the keys,
    // exactly as it was before there was a ceiling.
    const drawn = listIn(rowsFor(offers, 3, NOTHING_IS_CUT));
    expect(drawn.length - 1).toBeLessThan(atMost());
    expect(saidToBeMissing(drawn)).toBe(offers.length - 1);
  });
});

// ---------------------------------------------------------------------------
// The mark: which row is picked, and how a reader can tell
// ---------------------------------------------------------------------------

describe('the mark says which row is picked, and it is a column of the table', () => {
  const offers = everythingOffered();
  const picked = (offers[2] as CompletionWord).word;
  /** Every row of a list that carries the mark. */
  const marked = (rows: readonly string[]): string[] =>
    rows.filter((row) => row.trimStart().startsWith(PICK));

  it('marks exactly one row, and it is the row of the picked word', () => {
    const rows = listIn(rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT, picked));
    expect(marked(rows), `two rows carry ${PICK}`).toHaveLength(1);
    expect(marked(rows)[0], `${PICK} is on the wrong row`).toContain(picked);
    // NOT VACUOUS: the marked row is not the first one, so a mark that never moved would fail
    // rather than land on the right row by luck.
    expect(rows.indexOf(marked(rows)[0] as string)).toBe(2);
  });

  it('marks nothing at all until a word is picked', () => {
    const rows = rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT);
    expect(marked(rows), 'a palette nobody moved through has a mark on it').toHaveLength(0);
  });

  it('marks nothing when what was picked is not one of the offers', () => {
    // THE BRANCH A FILTER TAKES. What is picked is a word, so a list narrowed past it has no row
    // to mark — and the composition asks the same function the keys ask (`repl/palette.ts`,
    // `thePicked`) rather than deciding again.
    const rows = rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT, 'a word nobody offers');
    expect(marked(rows)).toHaveLength(0);
    expect(thePicked(offers, 'a word nobody offers')).toBe(NOBODY);
    expect(thePicked(offers, picked)).toBe(picked);
  });

  it('keeps the second column lined up, mark or no mark', () => {
    // THE MARK IS A COLUMN, and this is what says so: a glyph put on the picked row alone would
    // move that row right of its neighbours by the width of the mark and its separator.
    //
    // A LIST WITHIN THE CEILING, so that every row of what is drawn is an OFFER: with more
    // offers than the ceiling the last row is the account of the rest, and a case that looked
    // for the fifth offer's description in it would be reading a row about a different thing
    // ({@link atMost}).
    const shown = offers.slice(0, atMost());
    const withMark = listIn(rowsFor(shown, paletteRowsFor(shown), NOTHING_IS_CUT, picked));
    const without = listIn(rowsFor(shown, paletteRowsFor(shown), NOTHING_IS_CUT));
    const at = (rows: readonly string[]): number[] =>
      rows.map((row, index) => row.indexOf((shown[index] as CompletionWord).description));
    expect(new Set(at(withMark)).size, 'a mark moved the column it is beside').toBe(1);
    expect(at(withMark)).toEqual(at(without));
    // AND THE WORDS DID NOT MOVE EITHER, which is the same statement about the first column.
    expect(withMark.map((row) => row.indexOf('/'))).toEqual(without.map((row) => row.indexOf('/')));
  });

  it('is in the TEXT of the row, which is what makes it work with no colour', () => {
    // THE DECISION THIS DELIVERY TOOK ON PURPOSE. This product paints with the eight colours a
    // reader's theme defines, so a hue is a weak signal; the mark is a glyph in the line, so it
    // survives a pipe, `--color=never`, a monochrome terminal and a reader who does not separate
    // two tones. The renderer here is the PLAIN one — what all three of those get — and the mark
    // is in its bytes.
    const rows = rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT, picked);
    const row = marked(rows)[0] as string;
    expect(row).toContain(PICK);
    expect(row, 'the mark is an escape rather than a glyph').not.toContain(ESC);
    // AND IT IS ONE GLYPH WIDE, so what pads an unmarked row is what the mark takes.
    expect([...PICK]).toHaveLength(1);
  });

  it('paints the mark and nothing else, and paints it as a PART of the line', () => {
    // THE SECOND AXIS, AND IT IS OVER THE COLUMN RATHER THAN INSTEAD OF IT. This module used
    // to say *the colour is not an axis at all*; what that argument really supported is that
    // the hue may not be the CARRIER — which the case above holds — and it was read as a ban
    // on hue. The mark is chrome, so it takes the one accent this surface spends, as a role
    // (`presentation/line.ts`, `pick`).
    const painted = paletteFor({
      offers,
      room: paletteRowsFor(offers),
      columns: NOTHING_IS_CUT,
      render: renderStyled,
      picked,
      picking: THE_KEYS,
    });
    const row = painted.find((line) => stripped(line).trimStart().startsWith(PICK)) as string;
    expect(row, 'no row of the painted list carries the mark').toBeDefined();
    // THE ACCENT IS ON THE MARK, and it is the accent this surface already spends rather than
    // a hue chosen here: the same escapes the echo's prompt is wrapped in (`presentation/
    // styled.ts`, `ACCENT`), read off a line the product composes rather than typed.
    const accent = renderStyled(echoLine(PROMPT, ''));
    const opens = accent.slice(0, accent.indexOf(PROMPT));
    expect(opens, 'the accent is not an escape at all').toContain(ESC);
    expect(row, 'the mark is not painted in the accent').toContain(`${opens}${PICK}`);
    // AND STRIPPING WHAT WRAPS IT LEAVES THE PLAIN ROW, byte for byte — the word, the padding
    // and what the word is, exactly as a pipe gets them.
    const plain = rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT, picked).find((line) =>
      line.trimStart().startsWith(PICK),
    ) as string;
    expect(stripped(row)).toBe(plain);
    // AND THE COLUMN IS IN BOTH, which is what makes the hue an addition rather than the
    // answer: the glyph is in the text either way, and the rows around it are padded to the
    // same width by the same function.
    expect(stripped(row).indexOf(PICK)).toBe(plain.indexOf(PICK));
    // AND THE WORD CARRIES THE ACCENT TOO, WHICH IS WHAT THIS DELIVERY ADDED. The case read
    // *NOT VACUOUS: an UNPICKED row carries no escape at all*, and that was true while the mark
    // was the only part of this list with a role. The word a caller could type is a part with a
    // role now (`presentation/items.ts`, `asWord`), so what says the paint is not decoration is
    // COUNTED instead: the word takes one wrap, the mark takes another on the row that has one,
    // and the description takes none at all.
    const wrapped = (line: string): number => line.split(ESC).length - 1;
    // A ROW OF AN OFFER IS ONE THAT DOES NOT BEGIN WITH THE MARK THAT SAYS THERE IS MORE. It
    // was *a row naming one of the offers*, and the account of what had no room reads `… 13 not
    // shown` — which NAMES the verb `show`, so the account was being read as an offer's row.
    // Nothing is cut at this width, so the mark at the start belongs to that row alone.
    const named = (line: string): boolean => !stripped(line).trimStart().startsWith(CUT);
    const others = painted.filter((line) => line !== row && line !== renderStyled(THE_KEYS));
    expect(others.length).toBeGreaterThan(1);
    for (const other of others.filter(named)) {
      // TWO OPENERS AND TWO CLOSERS IS ONE WRAP: the accent and the escape that returns the
      // terminal's own foreground, around the word and around nothing else.
      expect(wrapped(other), 'an unmarked row is painted somewhere other than its word').toBe(2);
      expect(other, 'the word does not carry the accent').toContain(opens);
    }
    // AND THE MARKED ROW CARRIES EXACTLY ONE WRAP MORE — the mark's.
    expect(wrapped(row), 'the marked row is painted somewhere else as well').toBe(4);
    // AND THE ROW THAT NAMES NO WORD CARRIES NONE AT ALL, which is what says the hue belongs to
    // the word rather than to a row of this list: the account of what had no room is a row here
    // like any other and it comes out of the renderer bare.
    const account = others.find((line) => !named(line));
    expect(account, 'nothing accounted for the words with no room').toBeDefined();
    expect(account as string, 'the account of what had no room is painted').not.toContain(ESC);
  });
});

describe('the pick is a word, and the ends of the list hold', () => {
  const offers = everythingOffered();
  const words = offers.map((offer) => offer.word);

  it('steps one word at a time, in both directions', () => {
    expect(theNextPicked(offers, words[1] as string, 1)).toBe(words[2]);
    expect(theNextPicked(offers, words[1] as string, -1)).toBe(words[0]);
  });

  it('holds at both ends rather than wrapping round', () => {
    // THE REASON WAS *the list is CUT to the room a terminal has, so a wrap would put the mark
    // on a row the caller cannot see*, and the window falsified it: what is drawn follows the
    // pick now (`repl/palette.ts`, `theWindow`), so a wrapped pick would be drawn. The decision
    // stands on the list instead of on the drawing — the ends of it are where the vocabulary
    // ends, and a caller holding a key down finds that out by arriving at it.
    expect(theNextPicked(offers, words[0] as string, -1)).toBe(words[0]);
    expect(theNextPicked(offers, words.at(-1) as string, 1)).toBe(words.at(-1));
  });

  it('takes the first with a step down and the last with a step up when nothing is picked', () => {
    expect(theNextPicked(offers, NOBODY, 1)).toBe(words[0]);
    expect(theNextPicked(offers, NOBODY, -1)).toBe(words.at(-1));
  });

  it('picks nothing out of a list with nothing in it', () => {
    // The adversarial pair: a list of ONE, where every step is the same word, and a list of NONE,
    // where there is nothing to pick and the arrows are the history's again (`repl/editing.ts`).
    const one = [offers[0] as CompletionWord];
    expect(theNextPicked(one, NOBODY, 1)).toBe(words[0]);
    expect(theNextPicked(one, words[0] as string, 1)).toBe(words[0]);
    expect(theNextPicked(one, words[0] as string, -1)).toBe(words[0]);
    expect(theNextPicked([], NOBODY, 1)).toBe(NOBODY);
    expect(theNextPicked([], words[0] as string, -1)).toBe(NOBODY);
  });
});

// ---------------------------------------------------------------------------
// The width rule: a row of the area that would fold is not drawn
// ---------------------------------------------------------------------------

/**
 * The two widths the rule fires at, measured off the rows this surface composes.
 *
 * NOT CONSTANTS CHOSEN HERE. The area rules on whether a thing is ONE row of the terminal,
 * so the threshold is the thing's own width — the day the hint is reworded, the rule fires
 * at the new number and this case still asks the right question.
 */
const HINT_IS = widthOf(tips());
const BADGE_IS = widthOf(badgeLine('fully-signed'));

describe('a row of the area the terminal would fold is not drawn at all', () => {
  // A PAGE WITH NOTHING ON IT: these cases are about WIDTH, and the flow is the other
  // measurement the area takes (`repl/area.ts`, `AreaRequest.flow`).
  const tall = { rows: 40, palette: 0, header: NOTHING_ABOVE_YET };

  it('draws the hint at its own width and not one column under it', () => {
    const at = (columns: number) => areaFor({ ...tall, columns, badge: BADGE_IS, hint: HINT_IS });
    expect(at(HINT_IS).hint, `the hint is ${HINT_IS} columns`).toBe(true);
    expect(at(HINT_IS - 1).hint, `the hint is ${HINT_IS} columns`).toBe(false);
    // And the row it does not draw is a row it does not COUNT, which is the whole reason
    // the rule exists: an arrangement one row taller than the screen shows is the shape
    // that reaches the library's boundary.
    expect(at(HINT_IS).height - at(HINT_IS - 1).height).toBe(1);
  });

  it('draws the badge at its own width and not one column under it', () => {
    // The badge has no form of its own — a badge that would fold is a badge the FULL
    // arrangement does not exist for, exactly as it is outside a project.
    const at = (columns: number) => areaFor({ ...tall, columns, badge: BADGE_IS, hint: 0 });
    expect(at(BADGE_IS).form, `the badge is ${BADGE_IS} columns`).toBe('full');
    expect(at(BADGE_IS - 1).form, `the badge is ${BADGE_IS} columns`).toBe('ruled');
  });

  it('measures two different numbers, so neither case is reading the other’s', () => {
    // The two thresholds are the two rows' own widths and they are not the same width.
    expect(HINT_IS).not.toBe(BADGE_IS);
    expect(HINT_IS).toBeGreaterThan(BADGE_IS);
    // And the hint still fits the terminal every reader can be assumed to have.
    expect(HINT_IS).toBeLessThanOrEqual(80);
  });
});

// ---------------------------------------------------------------------------
// The budget: the palette is cut by what is left over the row being typed — on a page
// with nothing on it. What a page with something on it leaves is
// `the-list-is-a-window.test.ts`.
// ---------------------------------------------------------------------------

describe('the palette gets what is left over on a page with nothing on it, and never more', () => {
  it('is cut by the height, and the cut is reported rather than taken', () => {
    const wanted = 20;
    const columns = 100;
    const roomAt = (rows: number) =>
      areaFor({
        rows,
        columns,
        badge: BADGE_IS,
        hint: HINT_IS,
        palette: wanted,
        header: NOTHING_ABOVE_YET,
      }).palette;
    // Tall enough for all of it, and then one row less at a time.
    //
    // EVERY NUMBER IS A ROW BIGGER THAN IT WAS, AND THE ROW IS THE LIBRARY'S BOUNDARY. The
    // area used to be held one row short of the viewport, because a region as tall as the
    // viewport was one the library redrew whole — with the erase of the caller's history inside
    // the sequence. The console owns the screen and its frame IS the viewport on every frame, so
    // there is nothing to stay under and the page gets that row back (`repl/area.ts`). Written
    // as the subtraction rather than as a total, so which row is which stays legible: the row
    // being typed, the hint, and the blank one over the list.
    expect(roomAt(40)).toBe(wanted);
    expect(roomAt(10)).toBe(10 - 1 - 1 - 1);
    expect(roomAt(5)).toBe(2);
    expect(roomAt(3)).toBe(0);
    // AND THE FRAME NEVER OUTGROWS THE SCREEN, which is what replaces the old boundary:
    // whatever the height, what the area takes leaves the two regions above it a page to be on.
    for (const rows of [3, 4, 6, 10, 24, 40]) {
      const area = areaFor({
        rows,
        columns,
        badge: BADGE_IS,
        hint: HINT_IS,
        palette: wanted,
        header: NOTHING_ABOVE_YET,
      });
      expect(area.height, `${rows}`).toBeLessThanOrEqual(rows);
    }
  });

  it('gives up the chrome before it gives up a word, which is the trade it makes', () => {
    // The palette answers the key that was just pressed, so on a terminal that cannot hold
    // both it is the badge and the rules that go — the same call the single row of
    // candidates already forced, made explicit now the list can be long.
    const columns = 100;
    const at = { rows: 7, columns, badge: BADGE_IS, hint: HINT_IS, header: NOTHING_ABOVE_YET };
    const shut = areaFor({ ...at, palette: 0 });
    const open = areaFor({ ...at, palette: 20 });
    expect(shut.form).toBe('full');
    expect(open.form).toBe('bare');
    expect(open.palette).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// A real pty: the list on a screen
// ---------------------------------------------------------------------------

/** The fixture every case below drives the built binary over. */
const fixture = (): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

/** Runs `mnema repl` on a pseudo-terminal of a given size. */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
}): Promise<Ran> {
  return drive(fixture(), options);
}

/** The step every session begins with. */
const opens: Step = opensAConsole(PROMPT);

/**
 * The step every session ends with: the row abandoned, then the key that ends the input.
 *
 * IT WAS A WORD — `/exit`, typed and submitted — and the word is gone from the vocabulary.
 * The row is still cleared first, for the reason it always was: the key that leaves is the END
 * of the input, and a row with characters on it is not the end of anything.
 */
const leaves: Step = {
  types: `${CLEARS_THE_LINE}${ENDS_THE_INPUT}`,
  what: 'left',
  until: () => true,
};

/**
 * Every row of a screen that begins, after the indent, with one of these words.
 *
 * A MARKED ROW STILL NAMES ITS WORD, and this helper did not know it. The picked row carries
 * the mark in a column BEFORE the word (`repl/palette.ts`), so a scan that read the row's first
 * token as the word missed exactly the row the caller had chosen — measured, as two cases of this
 * file counting one row fewer than the list had. The mark is taken off the front before the
 * comparison, and only off the front: it is punctuation nowhere else, and a description that
 * happened to contain the glyph is not a marked row.
 */
function rowsNaming(
  screen: { readonly rows: readonly string[] },
  words: readonly string[],
): string[] {
  return screen.rows.filter((row) => {
    const shown = row.trimStart();
    const said = shown.startsWith(PICK) ? shown.slice(PICK.length).trimStart() : shown;
    return words.some((word) => said === word || said.startsWith(`${word} `));
  });
}

describe('a slash and a letter open the list on the screen, and typing narrows it', () => {
  it('shows the session\u2019s own words, each with what it does', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const words = theSessionsOwnWords();
    // THE LETTER IS THE ONE THE SESSION'S OWN WORD BEGINS WITH, read off the vocabulary: what
    // this case is about is the words the session answers to, and the row that reaches them is
    // the prefix with the first letter of one behind it.
    const narrows = (words[0] as CompletionWord).word.slice(PREFIX.length, PREFIX.length + 1);
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: `${PREFIX}${narrows}`,
          until: (bytes) => words.every((entry) => bytes.includes(entry.description)),
          what: 'listed the words the session answers to',
        },
        leaves,
      ],
    });
    const screen = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const listed = rowsNaming(
      screen,
      words.map((entry) => entry.word),
    );
    expect(listed, 'the letter listed nothing').toHaveLength(words.length);
    for (const entry of words) {
      const row = listed.find((line) => line.trimStart().startsWith(entry.word)) as string;
      expect(row, entry.word).toBeDefined();
      expect(row, entry.word).toContain(entry.description);
    }
  }, 180_000);

  it('opens the preview on a bare slash, and the letter narrows it', async () => {
    // THE OTHER HALF OF THE SAME KEY, ON A SCREEN. IT SAID *opens nothing at all on a bare
    // slash*, and it was written for the delivery that shut the list on a bare prefix. A caller
    // reading the page took that back: a bar with a slash in it and nothing under it is somebody
    // asking what there is. So the slash opens the list — with the same ceiling of four and the
    // same account of the rest — and the letter narrows THAT list rather than opening a second.
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const offers = everythingOffered();
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: PREFIX,
          until: arrivedSince(`${PROMPT} ${PREFIX}`),
          what: 'typed a bare slash',
        },
        { types: 'c', until: arrivedSince(ONLY_A_LIST_SAYS), what: 'typed the letter' },
        leaves,
      ],
    });
    const bare = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const narrowed = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    // THE ROW REALLY WAS TYPED, so the absence below is about the list rather than about a
    // keystroke that never arrived.
    expect(bare.text, 'the slash was never echoed').toContain(`${PROMPT} ${PREFIX}`);
    const words = offers.map((offer) => offer.word);
    const onTheBare = rowsNaming(bare, words);
    // FOUR ROWS AND NOT THE WHOLE VOCABULARY, which is what makes this a PREVIEW: the ceiling
    // is the list's own and the account of the rest is on the page beside it.
    expect(onTheBare, 'a bare slash opened nothing').toHaveLength(atMost());
    expect(offers.length, 'the vocabulary is no bigger than the ceiling').toBeGreaterThan(atMost());
    expect(bare.text, 'the bare slash did not say what it had no room for').toContain(CUT);
    // AND THE LETTER NARROWS IT rather than opening a second list: every row still on the page
    // is a row that was offered before the letter was typed.
    const onTheLetter = rowsNaming(narrowed, words);
    expect(onTheLetter.length, 'the letter shut the list').toBeGreaterThan(0);
    expect(onTheLetter.length, 'the letter did not narrow anything').toBeLessThanOrEqual(
      onTheBare.length,
    );
  }, 180_000);

  it('narrows to what is still possible as the caller types', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    // WHAT THE TWO ROWS OFFER, asked of the completer the console asks: the case is about a
    // list GOING somewhere, so both ends of the narrowing are read rather than written down.
    const asked = theCompleter();
    const wordsAt = (line: string): readonly string[] => asked(line)[0].map((hit) => hit.word);
    const word = (theSessionsOwnWords()[0] as CompletionWord).word;
    const opening = word.slice(0, PREFIX.length + 1);
    const then = word.slice(opening.length, opening.length + 1);
    const survives = wordsAt(opening + then);
    const gone = wordsAt(opening).filter((offer) => !survives.includes(offer));
    // The instrument first: there is something to narrow away, and something to keep.
    expect(survives.length).toBeGreaterThan(0);
    expect(gone.length).toBeGreaterThan(0);

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        // AND BOTH WAITS ARE ABOUT WHAT THE STEP CAUSED, which neither was: the first read the
        // WHOLE stream, and the second waited for `/c` — which the LIST already holds, because
        // `/clear` starts with it. So the second step was over before the key was drawn, and the
        // screen below was read with the un-narrowed list on it: measured red in a whole-suite run
        // under load and green on its own. Narrowing is something GOING, so the wait is the shared
        // instrument's (`support/pty.ts`, `aFrameWithout`).
        { types: opening, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed them' },
        {
          types: then,
          until: aFrameWithout(PROMPT, gone[0] as string),
          what: 'narrowed what it listed',
        },
        leaves,
      ],
    });
    const screen = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    expect(rowsNaming(screen, survives), 'the surviving word is not listed').toHaveLength(
      survives.length,
    );
    expect(rowsNaming(screen, gone), 'a word that cannot match is still listed').toHaveLength(0);
  }, 180_000);

  it('opens nothing for a slash in the middle of a word', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const words = theSessionsOwnWords();
    const typed = `show a${PREFIX}`;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: typed,
          until: (bytes) => bytes.includes(typed),
          what: 'echoed a slash inside a word',
        },
        leaves,
      ],
    });
    const screen = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    expect(screen.text, 'the row was never typed').toContain(typed);
    expect(
      rowsNaming(
        screen,
        words.map((entry) => entry.word),
      ),
      'a slash inside a word opened the list',
    ).toHaveLength(0);
    // Not vacuous: the panel names one of those words in prose, so the scan is looking at
    // rows that BEGIN with one rather than at rows that mention one.
    expect(screen.text).toContain(PROMPT);
  }, 180_000);
});

describe('a Tab shows the verbs with the description the declaration gives them', () => {
  it('says about each verb exactly what `--help` says about it', async () => {
    // THE ELO, END TO END. The description on the screen is compared to the bytes the
    // BUILT BINARY prints for `--help`, so nothing here is a sentence somebody retyped —
    // and a verb reworded in its declaration moves both sides at once.
    //
    // AND WHAT IS ON THE SCREEN IS FOUR OF THEM, WHICH IS THE CEILING. A Tab offers the whole
    // vocabulary and the list draws four of it and says how many it left out
    // (`src/repl/palette.ts`, `AT_MOST`), so the screen is asked about the rows it really has
    // and the whole vocabulary is compared where every one of them can be: against the same
    // `--help`, off the value both the screen and the shell read.
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const offers = everythingOffered();
    const help = execFileSync('node', [CLI, '--help'], {
      cwd: project,
      env: { ...environment, COLUMNS: String(NOTHING_IS_CUT) },
      encoding: 'utf-8',
    });

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: COMPLETES,
          until: arrivedSince(CUT),
          what: 'offered what it runs, and said what had no room',
        },
        leaves,
      ],
    });
    const screen = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const listed = rowsNaming(
      screen,
      offers.map((offer) => offer.word),
    );
    expect(listed, 'the Tab listed nothing').toHaveLength(atMost());

    // WHAT IS ON THE SCREEN SAYS WHAT THE DECLARATION SAYS, row by row.
    let checked = 0;
    for (const offer of offers) {
      const row = listed.find((line) => line.trimStart().startsWith(offer.word));
      if (row === undefined) continue;
      expect(row, offer.word).toContain(offer.description);
      checked += 1;
    }
    expect(checked, 'no row of the list was compared at all').toBe(listed.length);

    // AND EVERY VERB THERE IS SAYS IT, which is the half a ceiling took off the screen: the
    // list and the shell read one value (`src/completion/tree.ts`), so this is the elo for the
    // whole vocabulary rather than for the four that fitted.
    let verbs = 0;
    for (const offer of offers) {
      if (offer.word.startsWith(PREFIX)) continue;
      expect(help, `--help does not say this about ${offer.word}`).toContain(offer.description);
      verbs += 1;
    }
    expect(verbs).toBeGreaterThan(10);
  }, 240_000);
});

describe('the two keys open one list, and it stands off the row under it', () => {
  it('lists the same words whether a slash or a Tab asked, with a blank row over them', async () => {
    // THE PROMISE OF THIS DELIVERY, ASKED OF A SCREEN AND NOT OF A FUNCTION. Both keys go
    // through one function (`palette.ts`, `offeredBy`), so a case over that function can
    // only restate the implementation; what a caller MET was two menus — the slash listed
    // three words, a Tab listed those three and sixteen verbs — and the only place that is
    // observable is the page. So the same session is asked twice and the two screens are
    // compared with each other.
    //
    // AND THE TWO ROWS ARE THE SAME ROW, which is what the bare slash stopped being able to
    // say. A slash alone opens nothing now, so the question *do the two keys answer alike*
    // has to be asked where both of them answer: a caller typing a letter, and a caller
    // typing the same letter behind a slash. The slash is a KEY rather than a letter of the
    // word (`complete.ts`, `theStem`), so those two rows are the same question.
    //
    // AND THE BLANK ROW IS ASKED HERE for the same reason: the list used to begin on the row
    // directly over the badge, so it read as a continuation of what was above it rather than
    // as an answer to the key just pressed. It is a row of the page and nothing else — no
    // string, empty or otherwise — so a screen is the only place it exists.
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const asked = theCompleter();
    const letter = 's';
    const offers = asked(letter)[0];
    expect(offers.length, 'the letter narrows to nothing').toBeGreaterThan(1);
    expect(offers.length, 'the letter reaches more than the ceiling').toBeLessThanOrEqual(atMost());
    // AND A LINE IS LANDED BEFORE THE KEY IS PRESSED, which is not scenery: the page is
    // PLACED with rows that have nothing on them, so that the input ends on the last row the
    // layout leaves, and since those rows go under the flow (`repl/page.ts`) the row above the
    // list's own blank one is one of THEM on a page nothing has been said on. What the session
    // says lands under them, so one landed line is what puts something back over the gap — and
    // the non-vacuity below is a statement about the separation again rather than about a screen
    // with room to spare. It is abandoned rather than run, because one line is all it takes.
    const typed = 'x';
    const listedBy = async (keys: string): Promise<readonly string[]> => {
      const ran = await inPty({
        columns,
        rows,
        steps: [
          opens,
          {
            types: typed,
            until: (bytes) => bytes.includes(`${PROMPT} ${typed}`),
            what: 'echoed a keystroke',
          },
          {
            types: CLEARS_THE_LINE,
            // WITH THE PAINT OUT, because what this waits for is the line LANDING rather than
            // the row being typed: an echo is composed and painted (`src/presentation/echo.ts`),
            // so its bytes are not a run on the wire ({@link arrivedUnpainted}).
            until: arrivedUnpainted(`${PROMPT} ${typed}`),
            what: 'landed the abandoned line',
          },
          {
            types: keys,
            until: (bytes) => offers.every((offer) => bytes.includes(offer.description)),
            what: 'listed what can be typed',
          },
          leaves,
        ],
      });
      const screen = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, rows);
      const listed = rowsNaming(
        screen,
        offers.map((offer) => offer.word),
      );
      // THE ROW OVER THE LIST IS EMPTY. Found off the list rather than counted from the top:
      // where the palette begins depends on how tall the box above it is, and this case is
      // about the row before it whatever that is.
      const first = screen.rows.indexOf(listed[0] as string);
      expect(first, `${keys}: the list is not on the screen`).toBeGreaterThan(0);
      expect(
        (screen.rows[first - 1] as string).trim(),
        `${keys}: the list has no blank row over it`,
      ).toBe('');
      // NOT VACUOUS, AND THE WITNESS FOR IT CHANGED. It used to be the row above THAT: with one
      // line landed the page had no room to spare, so the row two above the list was the landed
      // line and the blank row between them could only be the palette's. What falsified it is the
      // delivery that took the FRAME off the panel: the opening is three rows shorter at this
      // size, so the page has room over again and the row two above the list is one of the
      // leftover's — measured, as this very assertion going red on an empty string.
      //
      // WHAT REPLACES IT IS STRONGER THAN WHAT IT WAS, because it does not depend on how much
      // room the page happens to have: the blank row is COUNTED as well as drawn (`repl/area.ts`,
      // `ABOVE_THE_PALETTE`), and a row drawn and not counted — or counted and not drawn — puts
      // the input off the last row the layout leaves. So the separation is asserted by the anchor,
      // which no amount of spare room can satisfy by accident.
      fillsTheScreen(screen, rows, `${keys}: with the list open`);
      // And what is above the whole run of emptiness really is the page rather than the top of
      // the screen, so the list is not being read on an empty page.
      const above = screen.rows.slice(0, first).findLastIndex((row) => row.trim().length > 0);
      expect(above, `${keys}: nothing at all is above the list`).toBeGreaterThanOrEqual(0);
      return listed.map((row) => row.trimStart().split(/\s{2,}/)[0] as string);
    };

    const bySlash = await listedBy(`${PREFIX}${letter}`);
    const byTab = await listedBy(`${letter}${COMPLETES}`);
    expect(bySlash, 'the two keys answer with two lists').toEqual(byTab);
    // And the ONE list is everything that word can still become, which is what neither key
    // used to show on its own.
    expect([...bySlash].sort()).toEqual(offers.map((offer) => offer.word).sort());
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The picker, on a real device: the mark moves, Return takes, Escape shuts
// ---------------------------------------------------------------------------

/** The row of a screen the mark is on, and nothing when no row carries one. */
function markedOn(screen: Screen): string | undefined {
  return screen.rows.find((row) => row.trimStart().startsWith(PICK));
}

/** The word on the marked row — the first column after the mark. */
function pickedOn(screen: Screen): string | undefined {
  const row = markedOn(screen);
  if (row === undefined) return undefined;
  return row
    .trimStart()
    .slice(PICK.length)
    .trim()
    .split(/\s{2,}/)[0];
}

/** How many times the prompt is on a screen. One is the row being typed and nothing else. */
function prompts(screen: Screen): number {
  return screen.text.split(PROMPT).length - 1;
}

/**
 * A step that waits for the MARK to arrive on a given word's row.
 *
 * The mark, two spaces and the word, contiguous: the layout draws a row as one string, so the
 * separator between the mark's column and the word is in the same write. It is about what
 * arrived SINCE the step began rather than about the whole stream, because the mark is in every
 * frame from the first arrow on — what a step has to know is that a frame arrived because of ITS
 * keystroke (`support/pty.ts`).
 *
 * AND THE PAINT COMES OUT FIRST, which is what this delivery had to add: the mark carries the
 * accent now (`src/repl/palette.ts`), so the glyph and the word beside it are no longer a run of
 * bytes on the wire — there is a closer between them. Measured as three cases waiting out their
 * whole budget for a mark that was on the screen the whole time.
 */
function marks(word: string): (bytes: string, since: number) => boolean {
  return arrivedUnpainted(`${PICK}  ${word}`);
}

describe('the arrows move the mark, and the ends of the list hold', () => {
  it('marks nothing until an arrow, then walks the list from its end', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const offers = everythingOffered();
    const last = offers.at(-1)?.word as string;
    const before = offers.at(-2)?.word as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        // THE KEY THAT OPENS THE WHOLE LIST IS THE TAB, and it is the one that can: a slash
        // needs a letter behind it now, and a letter narrows to the words that start with it.
        // What this case is about is the ENDS of the vocabulary, so it asks for all of it.
        { types: COMPLETES, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
        { types: MOVES_UP, until: marks(last), what: 'marked the last word' },
        // THE END HOLDS, AND WHAT IS ASSERTED IS AN ABSENCE — so the step waits for a frame
        // rather than for something in one: a Down that wrapped WOULD write a frame, and the
        // settle this waits out is long enough to have caught it (`support/pty.ts`, `endOf`).
        { types: MOVES_DOWN, until: aFrameAfter(PROMPT), what: 'was asked to step past the end' },
        { types: MOVES_UP, until: marks(before), what: 'stepped back up the list' },
        leaves,
      ],
    });
    const at = (step: number): Screen =>
      screenOf(ran.bytes.slice(0, ran.at[step] as number), columns, rows);
    expect(markedOn(at(1)), 'the list opened with a row already marked').toBeUndefined();
    expect(pickedOn(at(2)), 'an Up on a list nobody had moved through missed the last word').toBe(
      last,
    );
    expect(pickedOn(at(3)), 'a Down walked off the end of the list').toBe(last);
    expect(pickedOn(at(4)), 'an Up did not step back up the list').toBe(before);
    // AND THE PAGE IS STILL A PAGE THROUGH ALL OF IT: nothing about a mark moves the input off
    // the last row the layout leaves.
    for (const step of [1, 2, 3, 4]) fillsTheScreen(at(step), rows, `after step ${step}`);
    // NOT VACUOUS: the two words are two different words, so the walk really moved.
    expect(last).not.toBe(before);
  }, 240_000);

  it('reaches every word of a list four rows long, and marks a row that is drawn', async () => {
    // THE DEFECT A CEILING WOULD BRING BACK, walked to the END rather than stepped once. The
    // arrows move through the whole vocabulary and four rows of it are drawn, so a drawing that
    // showed the FIRST four would leave the mark on a row nobody drew from the fifth Down on —
    // which is exactly what happened here before the window followed the pick, measured on the
    // merged binary. One step cannot catch it; this presses Down as many times as there are
    // offers and reads the screen after every one of them.
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const offers = everythingOffered();
    const words = offers.map((offer) => offer.word);
    const steps: Step[] = [
      opens,
      { types: COMPLETES, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
    ];
    for (const [at, word] of words.entries()) {
      steps.push({ types: MOVES_DOWN, until: marks(word), what: `stepped to ${at + 1}: ${word}` });
    }
    steps.push(leaves);
    const ran = await inPty({ columns, rows, steps });

    // EVERY STEP: the mark is on the word the arrows have reached, and that row is ON THE
    // SCREEN — the second half is the one a window that did not follow would fail.
    for (const [at, word] of words.entries()) {
      const screen = screenOf(ran.bytes.slice(0, ran.at[at + 2] as number), columns, rows);
      expect(pickedOn(screen), `step ${at + 1} lost the mark`).toBe(word);
      expect(markedOn(screen), `step ${at + 1} marked a row nobody drew`).toBeDefined();
      // AND THE LIST IS STILL FOUR ROWS AND STILL HONEST: what it shows plus what it says is
      // left over is everything there was, at every position of the walk.
      const listed = rowsNaming(screen, words);
      expect(listed.length, `step ${at + 1} drew ${listed.length} rows`).toBe(atMost());
      const said = screen.rows.find((row) => row.trimStart().startsWith(CUT));
      const missing = Number(/(\d+)/.exec(said as string)?.[1]);
      expect(listed.length + missing, `step ${at + 1}: what it drew plus what it named`).toBe(
        words.length,
      );
    }
    // NOT VACUOUS: the walk really did go past what a page of four rows can show.
    expect(words.length).toBeGreaterThan(atMost());
  }, 300_000);

  it('holds at the other end too, and keeps the list showing everything', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const offers = everythingOffered();
    const first = offers[0]?.word as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: COMPLETES, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
        { types: MOVES_DOWN, until: marks(first), what: 'marked the first word' },
        { types: MOVES_UP, until: aFrameAfter(PROMPT), what: 'was asked to step past the start' },
        leaves,
      ],
    });
    const at = (step: number): Screen =>
      screenOf(ran.bytes.slice(0, ran.at[step] as number), columns, rows);
    expect(pickedOn(at(2)), 'a Down on a list nobody had moved through missed the first word').toBe(
      first,
    );
    expect(pickedOn(at(3)), 'an Up walked off the start of the list').toBe(first);
    // AND MOVING THROUGH IT DOES NOT CHANGE WHAT IT SHOWS: the same number of words, and the
    // row of keys still under them.
    const listed = rowsNaming(
      at(3),
      offers.map((offer) => offer.word),
    );
    expect(listed, 'the mark cost the list a row').toHaveLength(atMost());
    expect(at(3).text, 'the keys that move the list are not said under it').toContain(
      renderPlain(pickingTips()).trim(),
    );
  }, 240_000);
});

describe('Return takes the picked word, and Escape shuts the list', () => {
  it('puts the word on the row, runs nothing, and gives the row back on Escape', async () => {
    // T-d, END TO END. The Return that submits is the same key, so what is asserted is not only
    // that the row holds the word but that the session never SAW a line: a submitted line is
    // echoed into the flow (`repl/console.ts`), so a page with one prompt on it is a page where
    // nothing was run.
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const offers = everythingOffered();
    const first = offers[0]?.word as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: COMPLETES, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
        { types: MOVES_DOWN, until: marks(first), what: 'marked the first word' },
        { types: '\r', until: arrivedSince(`${PROMPT} ${first}`), what: 'took the word' },
        // AND THE WAIT FOR THE LIST TO HAVE GONE IS THE SHARED INSTRUMENT'S, because spelled out
        // here it was true before the key had been drawn: measured, *the list is still open* in a
        // whole-suite run and green on its own (`support/pty.ts`, `aFrameWithout`).
        {
          types: SHUTS_THE_LIST,
          until: aFrameWithout(PROMPT, ONLY_A_LIST_SAYS),
          what: 'shut the list',
        },
        leaves,
      ],
    });
    const at = (step: number): Screen =>
      screenOf(ran.bytes.slice(0, ran.at[step] as number), columns, rows);
    // THE ROW HOLDS THE WORD, AND THE PAGE HOLDS NOTHING ELSE.
    const taken = at(3);
    expect(taken.text, 'the picked word is not on the row being typed').toContain(
      `${PROMPT} ${first}`,
    );
    expect(prompts(taken), 'Return ran the word instead of typing it').toBe(1);
    expect(markedOn(taken), 'the pick outlived being taken').toBeUndefined();
    // AND ESCAPE SHUTS IT AND GIVES THE ROW BACK — the row it was before the list was asked for,
    // which on a row that is nothing but a word of the session is an empty one.
    const shut = at(4);
    expect(shut.text, 'the list is still open').not.toContain(ONLY_A_LIST_SAYS);
    expect(shut.text, 'the row still holds what the pick put there').not.toContain(
      `${PROMPT} ${first}`,
    );
    expect(prompts(shut)).toBe(1);
    fillsTheScreen(shut, rows, 'the page with the list shut');
  }, 240_000);

  it('narrows to the word it had picked, and takes that one', async () => {
    // THE ADVERSARIAL SEQUENCE: open, move, type until one word is left, take it. What is picked
    // is a WORD, so the mark cannot drift onto a neighbour while the list narrows — the case
    // reads which word the mark is on AFTER the filter, and then which one Return brought.
    //
    // AND THE OTHER HALF OF THE SAME QUESTION — a filter that EXCLUDES the picked word — is
    // asserted where a value can be read: nothing is picked afterwards and Return hands the row
    // over exactly as it does on a list nobody moved through (`src/repl/editing.test.ts`).
    //
    // THE ROW IS THE PREFIX AND A LETTER, because that is what opens a list at all now: the
    // word this narrows to is the session's own, so the letter is read off it.
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const word = (theSessionsOwnWords()[0] as CompletionWord).word;
    const opening = word.slice(0, PREFIX.length + 1);
    const then = word.slice(opening.length, opening.length + 1);
    const asked = theCompleter();
    const offers = asked(opening)[0];
    expect(offers.length, 'the letter narrows to one word already').toBeGreaterThan(1);
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: opening, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
        { types: MOVES_DOWN, until: marks(word), what: 'marked the first word' },
        { types: then, until: arrivedSince(then), what: 'narrowed the list' },
        { types: '\r', until: arrivedSince(`${PROMPT} ${word}`), what: 'took what was left' },
        leaves,
      ],
    });
    const narrowed = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, rows);
    const taken = screenOf(ran.bytes.slice(0, ran.at[4] as number), columns, rows);
    // THE FILTER LEFT THE PICKED WORD, and the mark is still on it — which is the property the
    // pick being a word rather than a row number buys.
    const listed = rowsNaming(
      narrowed,
      offers.map((offer) => offer.word),
    );
    expect(listed.length, 'the filter narrowed nothing').toBeLessThan(offers.length);
    expect(pickedOn(narrowed), 'the filter lost a pick it was still showing').toBe(word);
    expect(taken.text, 'Return did not bring the word that was left').toContain(
      `${PROMPT} ${word}`,
    );
    expect(prompts(taken), 'Return ran the word instead of typing it').toBe(1);
  }, 240_000);
});

describe('a list of one, a list of none, and the arrows in both', () => {
  it('marks the only word there is, and browses the history when there is no list', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const words = theSessionsOwnWords().map((entry) => entry.word);
    const one = CLEAR;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        // A LIST OF ONE: the whole word typed out, which narrows the list to itself.
        { types: one, until: arrivedSince(`${PROMPT} ${one}`), what: 'typed a whole word' },
        { types: MOVES_DOWN, until: marks(one), what: 'marked the only word' },
        // AND A LIST OF NONE. A line is submitted, so there is a history to browse and nothing
        // offered — which is where the arrows go back to doing what they always did.
        {
          types: `${CLEARS_THE_ROW}xyzzy\r`,
          // AND THIS ONE WAITS FOR THE ECHO TOO: a submitted line clears the row it was typed
          // on, so the only place those words are is the roll, painted.
          until: arrivedUnpainted(`${PROMPT} xyzzy`),
          what: 'submitted a line nothing answers to',
        },
        { types: MOVES_UP, until: arrivedSince(`${PROMPT} xyzzy`), what: 'browsed back to it' },
        leaves,
      ],
    });
    const at = (step: number): Screen =>
      screenOf(ran.bytes.slice(0, ran.at[step] as number), columns, rows);
    // A LIST OF ONE IS A LIST: it has a row, the row can be marked, and the keys are under it.
    const alone = at(2);
    expect(rowsNaming(alone, words), 'a whole word left more than itself in the list').toHaveLength(
      1,
    );
    expect(pickedOn(alone), 'the only word in the list could not be marked').toBe(one);
    // AND WITH NO LIST OPEN, AN ARROW IS THE HISTORY'S AGAIN — the row holds the line that was
    // submitted, and no mark was drawn anywhere.
    const browsed = at(4);
    expect(browsed.text, 'the arrow did not browse back to what was typed').toContain(
      `${PROMPT} xyzzy`,
    );
    expect(markedOn(browsed), 'a mark was drawn with no list open').toBeUndefined();
  }, 240_000);
});

describe('the mark survives what changes around it', () => {
  it('is still on its word after the caller resizes their window', async () => {
    // A RESIZE IS A PAGE AGAIN (`repl/console.ts`), so the question is whether what the caller
    // picked belongs to the page or to the row being typed. It belongs to the row: the pick
    // travels on the value the keys build, so a window dragged to another size redraws the list
    // with the same word still marked.
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const narrower = 100;
    const offers = everythingOffered();
    const first = offers[0]?.word as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: COMPLETES, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
        { types: MOVES_DOWN, until: marks(first), what: 'marked the first word' },
        {
          resize: { columns: narrower, rows },
          until: marks(first),
          what: 'was resized with a word picked',
        },
        leaves,
      ],
    });
    // FOUND BY THE WIDTH IT WAS DRAWN AT rather than by where the step ended: a resize
    // produces more than one frame, and a step ends wherever the stream happened to be quiet, so
    // on a loaded machine an index reads the page from BEFORE the resize — and the red then says
    // *the resize lost what the caller had picked*, which is an accusation against the product
    // for something the instrument did (`support/screen.ts`, {@link theSettledScreen}).
    const after = theSettledScreen(ran.bytes, narrower, rows, PICK);
    expect(pickedOn(after), 'the resize lost what the caller had picked').toBe(first);
    fillsTheScreen(after, rows, 'the page after a resize with a pick on it');
  }, 240_000);

  it('paints the mark in a session that has colour, and marks the row in one that has none', async () => {
    // THE DECISION THIS DELIVERY REVOKED, and the shape of the case that held the old one. It
    // read *the pick spends no colour*, and it compared the paint on the frame that moved the
    // mark with the paint on the frame that opened the list: equal sets meant the mark was the
    // whole of the difference. The argument under it was right about what it defended — a hue
    // is a weak signal here, and a mark has to work in a pipe, in monochrome and for a reader
    // who does not separate two tones — and it was read as a ban. The hue is a SECOND axis
    // over the column now, so what is asked is BOTH halves, on two real sessions.
    const columns = NOTHING_IS_CUT;
    const rows = THE_FLOOR.rows;
    const offers = everythingOffered();
    const first = offers[0]?.word as string;
    const walk = (): readonly Step[] => [
      opens,
      { types: COMPLETES, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
      { types: MOVES_DOWN, until: marks(first), what: 'marked the first word' },
      leaves,
    ];
    const withColour = await inPty({ columns, rows, steps: walk() });
    const without = await drive(
      { ...fixture(), environment: { ...environment, NO_COLOR: '1' } },
      { columns, rows, steps: walk() },
    );

    // THE COLUMN IS IN BOTH, which is the half that may never go: the glyph is in the text of
    // the row, so the mark is on the screen whether or not anything painted it.
    for (const [ran, said] of [
      [withColour, 'with colour'],
      [without, 'with none'],
    ] as const) {
      const screen = screenOf(
        (ran as Ran).bytes.slice(0, (ran as Ran).at[2] as number),
        columns,
        rows,
      );
      expect(pickedOn(screen), `the mark is not on the screen ${said}`).toBe(first);
    }

    // AND THE HUE IS ON THE MARK IN ONE OF THEM AND NOWHERE IN THE OTHER. The accent is read
    // off a line the product composes rather than typed here (`src/presentation/styled.ts`), and
    // what is looked for is the accent IMMEDIATELY BEFORE the glyph — the mark painted, rather
    // than a page that happens to carry the hue somewhere (the rules of the input area are drawn
    // in it, on every frame of both sessions).
    const accent = renderStyled(echoLine(PROMPT, ''));
    const opensWith = accent.slice(0, accent.indexOf(PROMPT));
    const painted = (ran: Ran, from: number, to: number): boolean =>
      ran.bytes.slice(ran.at[from] as number, ran.at[to] as number).includes(`${opensWith}${PICK}`);
    expect(painted(withColour, 1, 2), 'the mark was drawn without the accent').toBe(true);
    expect(painted(without, 1, 2), 'the accent survived NO_COLOR').toBe(false);
    // NOT VACUOUS — AND THE INSTRUMENT IT USED FOR THAT IS GONE. It read: *the session with no
    // colour is still a painted page — the layout draws the rules and dims the list out of its
    // own vocabulary — so the absence above is about the MARK and not about a page that has no
    // escapes at all*. That page no longer exists: a caller who asks for no colour now gets
    // none of it, the layout's own accent included, because this product hands its answer to
    // that library on the channel the library reads (`src/repl/painting.ts`, and
    // `one-authority-over-colour.test.ts` for both directions of it).
    //
    // WHAT REPLACES IT IS THE SAME PROTECTION FROM THE OTHER SIDE: the frames the absence was
    // read off DREW the mark, so they are frames with a mark on them rather than frames with
    // nothing in them — and the page they are is quiet all the way through, which is the
    // stronger half of what the old sentence was reaching for.
    const paint = new RegExp(PAINTED.source, 'g');
    const quiet = without.bytes.slice(without.at[1] as number, without.at[2] as number);
    expect(quiet, 'the frames the absence was read off never drew the mark').toContain(PICK);
    expect(
      (quiet.match(paint) ?? []).length,
      'colour survived NO_COLOR somewhere on the page',
    ).toBe(0);
  }, 300_000);
});

describe('a page shows four, says how many it could not, and does it at every height', () => {
  // TWO SIZES, AND THEY USED TO BE TWO REGIMES OF THE SAME PROMISE — a page with room showed
  // what it had room for and a shorter one showed fewer, so the counts here moved every time
  // the geometry did: eleven and fifteen, before that thirteen and seventeen, before that
  // fifteen and nineteen. Every one of those numbers was *what fitted*, which is the thing a
  // caller could not predict and did not ask for.
  //
  // THERE IS A CEILING NOW, so the two sizes are the same answer twice ({@link atMost}): four
  // offers, and a row saying how many had no room. What the two sizes are FOR is exactly that —
  // a claim about *four* rather than about *what fits* needs more than one height, and a third
  // is asked of the same product where a screen is not needed (the case over `areaFor` above).
  // The number is still read off the product rather than written down, and what it names is
  // still asserted against the TOTAL.
  // AND THE TWO HEIGHTS MOVED WITH THE FLOOR. They were twenty-four and twenty-eight, and both
  // are under the shortest window this console draws a page on (`src/repl/floor.ts`) — so a
  // session driven at either draws the screen that says so, and a list nobody can see says
  // nothing about a ceiling. The pair is the floor and a window over it, which is what *more than
  // one height* needs to be.
  for (const rows of [THE_FLOOR.rows, THE_FLOOR.rows + 4]) {
    it(`names a number that adds up to everything there was, at 80x${rows}`, async () => {
      const columns = 80;
      const offers = everythingOffered();
      const ran = await inPty({
        columns,
        rows,
        steps: [
          opens,
          {
            types: COMPLETES,
            until: (bytes) => bytes.includes(CUT),
            what: 'said it had no room for the rest',
          },
          leaves,
        ],
      });
      const screen = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
      const listed = rowsNaming(
        screen,
        offers.map((offer) => offer.word),
      );
      const said = screen.rows.find((row) => row.trimStart().startsWith(CUT));
      expect(said, `no row said how many had no room:\n${screen.text}`).toBeDefined();
      const missing = Number(/(\d+)/.exec(said as string)?.[1]);
      expect(listed.length + missing, `${listed.length} shown, ${missing} named`).toBe(
        offers.length,
      );
      // Not vacuous: it really did leave some out.
      expect(missing).toBeGreaterThan(0);
      // AND IT IS THE CEILING RATHER THAN THE HEIGHT that decided how many, which is what the
      // second size is here to say.
      expect(listed.length, `${rows}: ${listed.length} shown`).toBe(atMost());
      // AND THE PAGE DID NOT PAY FOR THE LIST at either size, which is what the cut buys:
      // the row the caller types on is still the last one the layout leaves.
      fillsTheScreen(screen, rows, `${columns}x${rows} with a cut list`);
    }, 180_000);
  }
});

// ---------------------------------------------------------------------------
// The boundary, measured again with the palette open
// ---------------------------------------------------------------------------

describe('opening the palette never makes the frame outgrow the screen', () => {
  // THIS BLOCK MEASURED A BOUNDARY THAT NO LONGER EXISTS, and what it was for is worth
  // keeping: the palette is the tallest thing the bottom region holds — eighteen rows on a Tab —
  // so if a budget were going to reopen the hole two deliveries closed, this is where it would
  // show. It used to prove that by bracketing the height at which the layout library stops
  // redrawing PART of the page, because that path's sequence carried the erase of the caller's
  // history and the palette had to be cut short of it.
  //
  // THE FRAME IS THE VIEWPORT AT EVERY HEIGHT NOW, so the library takes that path on every
  // session there is and there is no boundary to be on one side of. What replaces the bracket is
  // the property the bracket was protecting, asked at the sizes where a list is tallest: the
  // frame ends on the last row of the terminal with the list open, and not one row of the
  // caller's history is erased — with the library's own request as the witness that the
  // absence is merited (`src/repl/erasing.ts`, `erasesTheScreen`).
  // THE SIZES MOVED WITH THE FLOOR AND NOT WITH THIS PROMISE, TWICE. Sixty columns, eight rows
  // and twelve rows were all under the shortest window a console is drawn on, and so are
  // twenty-four, thirty and forty now that the floor is where the name is drawn whole
  // (`src/repl/floor.ts`): a session driven at any of them draws the screen that says so, and a
  // frame with no list on it says nothing about whether a list can make the frame outgrow the
  // screen. What is left is the floor's own width and three heights above it, read off the floor
  // rather than written down, which is where a caller can really open one.
  for (const columns of [80, 100]) {
    it(`ends on the last row with the list open, at ${columns} columns`, async () => {
      for (const rows of [THE_FLOOR.rows, THE_FLOOR.rows + 6, THE_FLOOR.rows + 16]) {
        const ran = await inPty({
          columns,
          rows,
          steps: [
            opens,
            // WHAT THIS KEYSTROKE PUT ON THE PAGE, and not the character anywhere in the
            // stream: the opening writes a slash three ways over — the project's path, the
            // record's `T1/T2/T4`, and the hint that names this very key — so a predicate over
            // the whole stream was over before the key was pressed
            // (`support/pty.ts`, `arrivedSince`).
            { types: PREFIX, until: arrivedSince(PREFIX), what: 'opened the palette' },
            // AND THESE TWO WAIT FOR NOTHING ON PURPOSE, which is a thing to say out loud
            // rather than a shortcut. A Tab on a list that is already open can leave the page
            // exactly as it was, and the layout writes NOTHING for a frame identical to the one
            // on the screen — so a step waiting for a frame here waits for ever. What makes the
            // case honest is not the wait but the READ: it does not depend on where a step ended
            // at all ({@link theFirstScreenWith}).
            { types: COMPLETES, until: () => true, what: 'was asked for the words' },
            // AND WITH A ROW OF IT MARKED, which is the keystroke this delivery added: a mark
            // that had grown the region would be seen here and nowhere else.
            { types: MOVES_DOWN, until: () => true, what: 'was asked to mark a row' },
            leaves,
          ],
        });
        // AND IT IS ASKED OF EVERY FRAME rather than of one screen found by an index. The
        // subject is that no key can make the frame outgrow the screen, and a single screen read
        // at a step boundary answers about one frame and about whichever one the machine's load
        // happened to leave under the boundary. Cut on the sequence the layout closes a frame
        // with, every frame of the run is measured — the ones with the list open among them.
        const frames = rowsOfTheFrames(ran.bytes);
        expect(frames.length, `${columns}x${rows}: no frame was drawn at all`).toBeGreaterThan(1);
        expect(
          Math.max(...frames),
          `${columns}x${rows}: a frame of ${Math.max(...frames)} rows on a ${rows}-row screen`,
        ).toBeLessThanOrEqual(rows);
        // AND THE PAGE THE SESSION LEFT IS WHOLE. IT WAS FOUND BY THE WIDTH IT WAS DRAWN AT
        // and that locator REFUSED these sizes, correctly: at eight rows the area is the bare
        // form, which has no rules — and the rules are what a width is read off. What every
        // session has instead is an end (`support/screen.ts`, {@link theScreenBeforeLeaving}).
        const screen = theScreenBeforeLeaving(ran.bytes, columns, rows);
        expect(screen.alternate, `${columns}x${rows}: the screen stopped being ours`).toBe(true);
        fillsTheScreen(screen, rows, `${columns}x${rows} after the list`);
        // AND NOT ONE ROW OF THE CALLER'S HISTORY WAS ERASED — with the witness that the
        // library really did ask, so the absence is merited rather than vacuous.
        expect(ran.bytes, `${columns}x${rows}: the history was erased`).not.toContain(
          ERASES_THE_HISTORY,
        );
        expect(
          erasesTheScreen(ran.bytes),
          `${columns}x${rows}: the library never started the page over`,
        ).toBe(true);
      }
      // Not vacuous: the hint IS drawn at this width, which is what makes the region two rows
      // and the list something the height has to be shared with.
      expect(widthOf(tips()), `${columns}`).toBeLessThanOrEqual(columns);
    }, 300_000);
  }
});

// ---------------------------------------------------------------------------
// A1: the mark that says there is more, spelled in one module
// ---------------------------------------------------------------------------

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

/** Every string a source writes, quotes included. */
function literalsOf(code: string): string[] {
  return code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
}

/**
 * Whether a source writes the mark AS a mark — a literal that is the glyph and nothing
 * else.
 *
 * THE FIRST FORM OF THIS SCAN LOOKED FOR THE GLYPH ANYWHERE IN THE FILE, and it
 * accused seven modules on its first run. Every one of them was innocent: the glyph is
 * ordinary punctuation in a sentence, and `mnema observe --help` says "a task, decision,
 * …" the way English does. An instrument that fires on prose says nothing about code, and
 * this bench has been wrong with that exact shape before. The discriminant is a literal
 * whose WHOLE content is the mark, which is what a value shortened to fit is given.
 */
function cutsALine(source: string): boolean {
  return literalsOf(withoutComments(source)).some((literal) => literal.slice(1, -1) === CUT);
}

describe('the mark that says a line was cut is written in one place', () => {
  it('is in the module that composes the row, and in no other source', () => {
    // A1, BY THE DISCRIMINANT. A cut is a declared exception to this surface's rule about
    // never shortening a line, so a second module that could write one is a second place
    // the exception would have to be argued — and the argument holds for an affordance and
    // does not hold for a line of the record.
    const writing = sourcesOf(SRC).filter((file) => cutsALine(readFileSync(file, 'utf-8')));
    expect(writing.map((file) => file.slice(SRC.length + 1))).toEqual([join('repl', 'palette.ts')]);
    // The scan read something, and it would accuse the line a careful author would write.
    expect(sourcesOf(SRC).length).toBeGreaterThan(50);
    expect(cutsALine(`const short = [...text].slice(0, room).join('') + '${CUT}';`)).toBe(true);
    // And it does NOT accuse the glyph used as punctuation, which is what the first form
    // of it did to seven innocent modules.
    expect(cutsALine(`option('--id <id>', 'a task, decision, skill, ${CUT}')`)).toBe(false);
    expect(cutsALine(`/** what it says, ${CUT} and the rest. */`)).toBe(false);
  });

  it('and no line of the record is shortened anywhere, which is the rule it excepts', () => {
    // THE OTHER HALF, and the one with teeth. `presentation/` is where every line of this
    // product is composed, and nothing in it cuts: a value cut to fit is a value a reader
    // cannot check. The palette is outside it for exactly that reason, and the padding
    // function it uses says so in as many words — it pads and never truncates.
    const shortening = sourcesOf(join(SRC, 'presentation')).filter((file) =>
      cutsALine(readFileSync(file, 'utf-8')),
    );
    expect(shortening).toEqual([]);
    expect(sourcesOf(join(SRC, 'presentation')).length).toBeGreaterThan(10);
  });
});

/**
 * Whether a source writes the MARK as a mark — a literal that is the glyph and nothing else.
 *
 * The same discriminant the cut's own scan uses, and for the same reason: the glyph is ordinary
 * punctuation in prose (this very file's doc-comments quote the reference's selector with it), so
 * a scan for it anywhere in a file would accuse an innocent module. What is refused is a source
 * that could DRAW one.
 */
function marksARow(source: string): boolean {
  return literalsOf(withoutComments(source)).some(
    (literal) => named(literal.slice(1, -1)) === PICK,
  );
}

/**
 * A literal's content with its `\uXXXX` escapes resolved.
 *
 * WITHOUT IT THE SCAN FOUND NOTHING AT ALL, which is how it was caught: the one module that
 * draws the mark NAMES it by its code point rather than typing it, so a comparison against the
 * raw glyph accused nobody and would have gone on accusing nobody however many modules started
 * drawing marks. A guard that cannot fire is worse than no guard, and this is the line that makes
 * this one total over both spellings.
 */
function named(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) =>
    String.fromCodePoint(Number.parseInt(code, 16)),
  );
}

describe('the mark that says which row is picked is written in one place', () => {
  it('is in the module that composes the row, and in no other source', () => {
    // A1, BY THE DISCRIMINANT AND NOT BY THIS FILE'S LIST. A second module that drew the mark
    // would be a second answer to *which row is picked* — the question already has exactly one
    // (`repl/palette.ts`, `thePicked`), and a drawing that decided it again could disagree with
    // the key that fills the row.
    const marking = sourcesOf(SRC).filter((file) => marksARow(readFileSync(file, 'utf-8')));
    expect(marking.map((file) => file.slice(SRC.length + 1))).toEqual([join('repl', 'palette.ts')]);
    // The scan would accuse the line a careful author would write — in EITHER spelling, which is
    // the half that was missing — and does not accuse prose.
    expect(marksARow(`const row = isPicked ? '${PICK}' : ' ';`)).toBe(true);
    expect(marksARow("const mark = '\\u276f';")).toBe(true);
    expect(marksARow(`/** the reference draws '${PICK}' on the row it has selected. */`)).toBe(
      false,
    );
    // AND IT IS SPELLED BY ITS CODE POINT, like every unusual byte in this repository: the source
    // of the one module that draws it does not hold the character itself outside a comment.
    const spelled = withoutComments(
      readFileSync(join(SRC, 'repl', 'palette.ts'), 'utf-8'),
    ).includes(PICK);
    expect(spelled, 'the mark is typed into the source rather than named').toBe(false);
  });
});

describe('the words the slash lists are the words the gate answers to', () => {
  it('is one list, so a menu cannot offer what the next line refuses', () => {
    // The vocabulary the console filters and the list the gate is total over come from one
    // table. Two derivations would be a palette advertising a word nothing answers to.
    expect(theSessionsOwnWords().map((entry) => entry.word)).toEqual([...SESSION_WORDS]);
    // And every one of them says something, because a word with no gloss cannot be in the
    // table it is read from.
    for (const entry of theSessionsOwnWords()) {
      expect(entry.description.length, entry.word).toBeGreaterThan(3);
    }
  });
});
