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
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { areaFor } from '../src/repl/area.js';
import { type Completer, completerFor } from '../src/repl/complete.js';
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
import { CLEAR, LEAVE, PREFIX, SESSION_WORDS } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import {
  aFrameAfter,
  aFrameWithout,
  arrivedSince,
  carriedPages,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { endsAtTheFoot, type Screen, screenOf } from './support/screen.js';

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

/** How wide a terminal has to be for nothing in these lists to be cut. */
const NOTHING_IS_CUT = 160;

/**
 * A PAGE WITH NOTHING ON IT — how many rows of the flow the area is asked about here.
 *
 * The list of words takes its rows out of what the page has LEFT OVER (`repl/area.ts`,
 * `AreaRequest.flow`), so every number in this file is about the height of a terminal alone,
 * which is what it was about before that field existed. The cases about a page with something
 * on it are `the-list-is-a-window.test.ts`.
 */
const NOTHING_SAID_YET = 0;

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
  const words = theSessionsOwnWords();
  const tabOffered: readonly CompletionWord[] = [
    { word: 'search', description: 'a read' },
    { word: 'show', description: 'another read' },
  ];
  /** What can be typed here, as the console asks it: the real completer over a real tree. */
  const asked = theCompleter();
  /** The words of what a key asks for on a given line. */
  const wordsOf = (offers: readonly CompletionWord[]): readonly string[] =>
    offers.map((offer) => offer.word);

  it('opens the whole list on a slash — the words and the verbs, in one answer', () => {
    // ⚠️ THIS CASE SAID *opens the session's own words on a slash*, and asserted the palette
    // was those three words. That is the defect this delivery closes rather than a property to
    // keep: the slash listed three words, a Tab listed sixteen verbs and the three words, and a
    // console with two menus has no list of what you can type. So the slash asks what an empty
    // line asks, and the answer is one list with the slash's own words inside it.
    const listed = wordsOf(offeredBy(PREFIX, [], asked));
    expect(listed, 'the slash lists a list of its own').toEqual(wordsOf(asked('')[0]));
    for (const word of [CLEAR, LEAVE]) expect(listed, word).toContain(word);
    // Not vacuous: the list really is both vocabularies rather than either one of them.
    expect(listed.length).toBeGreaterThan(words.length);
    expect(listed.some((word) => !word.startsWith(PREFIX))).toBe(true);
  });

  it('narrows to the words that can still be typed as the caller types them', () => {
    // Narrowing REDUCES, and to the words that really start that way rather than to a
    // number: the case reads the vocabulary rather than counting to one.
    const whole = offeredBy(PREFIX, [], asked);
    const narrowed = offeredBy(`${PREFIX}c`, [], asked);
    expect(narrowed.length).toBeLessThan(whole.length);
    expect(wordsOf(narrowed)).toEqual(
      words.map((entry) => entry.word).filter((word) => word.startsWith(`${PREFIX}c`)),
    );
    // Not vacuous: there is more than one word to narrow away from, and what survives is
    // a real word with a real gloss.
    expect(words.length).toBeGreaterThan(1);
    expect(narrowed.length).toBeGreaterThan(0);
    for (const offer of narrowed) expect(offer.description.length).toBeGreaterThan(3);
  });

  it('offers nothing for a slash that is not the first character', () => {
    // A slash inside a path, an argument or a word is a character like any other. Both
    // halves are asserted: the palette is shut, and it is shut BECAUSE of the position —
    // the same characters at the start of the line do open it.
    for (const line of [`show a${PREFIX}b`, `search ${PREFIX}help`, `a${PREFIX}`]) {
      expect(offeredBy(line, [], asked), line).toEqual([]);
    }
    expect(offeredBy(`${PREFIX}help`, [], asked).length).toBe(1);
    // ⚠️ AND IT DOES NOT SUPPRESS WHAT A TAB OFFERED, WHICH IS THE OTHER HALF AND THE ONE
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

  it('lets the slash win over what a Tab left, because the slash is live', () => {
    // Typing a slash after an ambiguous Tab is a caller asking a different question. Both
    // answers exist here, so this says which one is given.
    expect(offeredBy(PREFIX, tabOffered, asked)).toEqual(offeredBy(PREFIX, [], asked));
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
  const offers = everythingOffered();

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
    // The corpus is real: this product has more than a handful of reads, and every one of
    // them has something to say about itself.
    expect(offers.length).toBeGreaterThan(10);
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
        // ⛔ AND IT DRAWS EXACTLY WHAT THE AREA BUDGETED, which is the property the caret and
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
    // ⚠️ THE NUMBERS MOVED BY ONE ROW, AND THE ROW IS THE KEYS'. Three rows of room is now one
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
    const rows = rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT);
    expect(saidToBeMissing(listIn(rows))).toBeUndefined();
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
    const withMark = listIn(rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT, picked));
    const without = listIn(rowsFor(offers, paletteRowsFor(offers), NOTHING_IS_CUT));
    const at = (rows: readonly string[]): number[] =>
      rows.map((row, index) => row.indexOf((offers[index] as CompletionWord).description));
    expect(new Set(at(withMark)).size, 'a mark moved the column it is beside').toBe(1);
    expect(at(withMark)).toEqual(at(without));
    // AND THE WORDS DID NOT MOVE EITHER, which is the same statement about the first column.
    expect(withMark.map((row) => row.indexOf('/'))).toEqual(without.map((row) => row.indexOf('/')));
  });

  it('is in the TEXT of the row, which is what makes it work with no colour', () => {
    // ⛔ THE DECISION THIS DELIVERY TOOK ON PURPOSE. This product paints with the eight colours a
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
});

describe('the pick is a word, and the ends of the list hold', () => {
  const offers = everythingOffered();
  const words = offers.map((offer) => offer.word);

  it('steps one word at a time, in both directions', () => {
    expect(theNextPicked(offers, words[1] as string, 1)).toBe(words[2]);
    expect(theNextPicked(offers, words[1] as string, -1)).toBe(words[0]);
  });

  it('holds at both ends rather than wrapping round', () => {
    // ⚠️ THE REASON WAS *the list is CUT to the room a terminal has, so a wrap would put the mark
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
  const tall = { rows: 40, palette: 0, flow: NOTHING_SAID_YET };

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
        flow: NOTHING_SAID_YET,
      }).palette;
    // Tall enough for all of it, and then one row less at a time.
    //
    // ⚠️ EVERY NUMBER BELOW A ROW SMALLER THAN IT WAS, AND THE ROW IS THE PALETTE'S OWN
    // BLANK ONE. The list is separated from what is under it now, and the separation comes
    // off the palette's budget rather than out of the region's height — a row the layout
    // draws and this arithmetic does not count is the region growing past the boundary this
    // file exists to keep. Written as the subtraction rather than as a total, so which row
    // is which stays legible: the row the library keeps, the row being typed, the hint, and
    // the blank one over the list.
    expect(roomAt(40)).toBe(wanted);
    expect(roomAt(10)).toBe(10 - 1 - 1 - 1 - 1);
    expect(roomAt(5)).toBe(1);
    expect(roomAt(4)).toBe(0);
    // The region never grows past the boundary: whatever the height, what the area takes
    // leaves the library a row to work in.
    for (const rows of [3, 4, 6, 10, 24, 40]) {
      const area = areaFor({
        rows,
        columns,
        badge: BADGE_IS,
        hint: HINT_IS,
        palette: wanted,
        flow: NOTHING_SAID_YET,
      });
      expect(area.height, `${rows}`).toBeLessThanOrEqual(rows - 1);
    }
  });

  it('gives up the chrome before it gives up a word, which is the trade it makes', () => {
    // The palette answers the key that was just pressed, so on a terminal that cannot hold
    // both it is the badge and the rules that go — the same call the single row of
    // candidates already forced, made explicit now the list can be long.
    const columns = 100;
    const at = { rows: 8, columns, badge: BADGE_IS, hint: HINT_IS, flow: NOTHING_SAID_YET };
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

/** The step every session ends with. */
const leaves: Step = {
  types: `${CLEARS_THE_LINE}${PREFIX}exit\r`,
  what: 'left',
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(`${PREFIX}exit`),
};

/**
 * Every row of a screen that begins, after the indent, with one of these words.
 *
 * ⚠️ A MARKED ROW STILL NAMES ITS WORD, and this helper did not know it. The picked row carries
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

describe('a slash opens the list on the screen, and typing narrows it', () => {
  it('shows the session’s own words, each with what it does', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = 40;
    const words = theSessionsOwnWords();
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: PREFIX,
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
    expect(listed, 'the slash listed nothing').toHaveLength(words.length);
    for (const entry of words) {
      const row = listed.find((line) => line.trimStart().startsWith(entry.word)) as string;
      expect(row, entry.word).toBeDefined();
      expect(row, entry.word).toContain(entry.description);
    }
  }, 180_000);

  it('narrows to what is still possible as the caller types', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = 40;
    const words = theSessionsOwnWords().map((entry) => entry.word);
    const survives = words.filter((word) => word.startsWith(`${PREFIX}c`));
    const gone = words.filter((word) => !word.startsWith(`${PREFIX}c`));
    // The instrument first: there is something to narrow away, and something to keep.
    expect(survives.length).toBeGreaterThan(0);
    expect(gone.length).toBeGreaterThan(0);

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        // ⚠️ AND BOTH WAITS ARE ABOUT WHAT THE STEP CAUSED, which neither was: the first read the
        // WHOLE stream, and the second waited for `/c` — which the LIST already holds, because
        // `/clear` starts with it. So the second step was over before the key was drawn, and the
        // screen below was read with the un-narrowed list on it: measured red in a whole-suite run
        // under load and green on its own. Narrowing is something GOING, so the wait is the shared
        // instrument's (`support/pty.ts`, `aFrameWithout`).
        { types: PREFIX, until: arrivedSince(gone[0] as string), what: 'listed them' },
        {
          types: 'c',
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
    const rows = 40;
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
    const columns = NOTHING_IS_CUT;
    const rows = 40;
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
          until: (bytes) => offers.every((offer) => bytes.includes(offer.word)),
          what: 'offered every word it runs',
        },
        leaves,
      ],
    });
    const screen = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const listed = rowsNaming(
      screen,
      offers.map((offer) => offer.word),
    );
    expect(listed, 'the Tab listed nothing').toHaveLength(offers.length);

    let checked = 0;
    for (const offer of offers) {
      const row = listed.find((line) => line.trimStart().startsWith(offer.word)) as string;
      expect(row, offer.word).toBeDefined();
      expect(row, offer.word).toContain(offer.description);
      // And for a VERB, the same sentence is what the shell's own help prints.
      if (offer.word.startsWith(PREFIX)) continue;
      expect(help, `--help does not say this about ${offer.word}`).toContain(offer.description);
      checked += 1;
    }
    // Not vacuous: most of the list is verbs, and every one of them was compared.
    expect(checked).toBeGreaterThan(10);
  }, 240_000);
});

describe('the two keys open one list, and it stands off the row under it', () => {
  it('lists the same words whether a slash or a Tab asked, with a blank row over them', async () => {
    // THE PROMISE OF THIS DELIVERY, ASKED OF A SCREEN AND NOT OF A FUNCTION. Both keys go
    // through one function now (`palette.ts`, `offeredBy`), so a case over that function can
    // only restate the implementation; what a caller MET was two menus — the slash listed
    // three words, a Tab listed those three and sixteen verbs — and the only place that is
    // observable is the page. So the same session is asked twice and the two screens are
    // compared with each other.
    //
    // AND THE BLANK ROW IS ASKED HERE for the same reason: the list used to begin on the row
    // directly over the badge, so it read as a continuation of what was above it rather than
    // as an answer to the key just pressed. It is a row of the page and nothing else — no
    // string, empty or otherwise — so a screen is the only place it exists.
    const columns = NOTHING_IS_CUT;
    const rows = 40;
    const offers = everythingOffered();
    // ⚠️ AND A LINE IS LANDED BEFORE THE KEY IS PRESSED, which is not scenery: the page is
    // PLACED with rows that have nothing on them, so that the input ends on the last row the
    // layout leaves, and since those rows go under the flow (`repl/page.ts`) the row above the
    // list's own blank one is one of THEM on a page nothing has been said on. What the session
    // says lands under them, so one landed line is what puts something back over the gap — and
    // the non-vacuity below is a statement about the separation again rather than about a screen
    // with room to spare. It is abandoned rather than run, because one line is all it takes.
    const typed = 'x';
    const listedBy = async (key: string): Promise<readonly string[]> => {
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
            until: arrivedSince(`${PROMPT} ${typed}`),
            what: 'landed the abandoned line',
          },
          {
            types: key,
            until: (bytes) => offers.every((offer) => bytes.includes(offer.word)),
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
      expect(first, `${key}: the list is not on the screen`).toBeGreaterThan(0);
      expect(
        (screen.rows[first - 1] as string).trim(),
        `${key}: the list has no blank row over it`,
      ).toBe('');
      // NOT VACUOUS, AND ⚠️ THE WITNESS FOR IT CHANGED. It used to be the row above THAT: with one
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
      endsAtTheFoot(screen, rows, `${key}: with the list open`);
      // And what is above the whole run of emptiness really is the page rather than the top of
      // the screen, so the list is not being read on an empty page.
      const above = screen.rows.slice(0, first).findLastIndex((row) => row.trim().length > 0);
      expect(above, `${key}: nothing at all is above the list`).toBeGreaterThanOrEqual(0);
      return listed.map((row) => row.trimStart().split(/\s{2,}/)[0] as string);
    };

    const bySlash = await listedBy(PREFIX);
    const byTab = await listedBy(COMPLETES);
    expect(bySlash, 'the two keys answer with two lists').toEqual(byTab);
    // And the ONE list is everything there is to type: the verbs, and the words the session
    // answers to itself, which is what neither key used to show on its own.
    expect([...bySlash].sort()).toEqual(offers.map((offer) => offer.word).sort());
    expect(bySlash).toContain(CLEAR);
    expect(bySlash).toContain(LEAVE);
    expect(bySlash.some((word) => !word.startsWith(PREFIX))).toBe(true);
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
 * separator between the mark's column and the word is in the same write. It is `arrivedSince`
 * rather than a predicate over the whole stream because the mark is in every frame from the first
 * arrow on — what a step has to know is that a frame arrived because of ITS keystroke
 * (`support/pty.ts`).
 */
function marks(word: string): (bytes: string, since: number) => boolean {
  return arrivedSince(`${PICK}  ${word}`);
}

describe('the arrows move the mark, and the ends of the list hold', () => {
  it('marks nothing until an arrow, then walks the list from its end', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = 40;
    const offers = everythingOffered();
    const last = offers.at(-1)?.word as string;
    const before = offers.at(-2)?.word as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: PREFIX, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
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
    for (const step of [1, 2, 3, 4]) endsAtTheFoot(at(step), rows, `after step ${step}`);
    // NOT VACUOUS: the two words are two different words, so the walk really moved.
    expect(last).not.toBe(before);
  }, 240_000);

  it('holds at the other end too, and keeps the list showing everything', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = 40;
    const offers = everythingOffered();
    const first = offers[0]?.word as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: PREFIX, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
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
    // AND MOVING THROUGH IT DOES NOT CHANGE WHAT IT SHOWS: the same words, and the row of keys
    // still under them.
    const listed = rowsNaming(
      at(3),
      offers.map((offer) => offer.word),
    );
    expect(listed, 'the mark cost the list a row').toHaveLength(offers.length);
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
    const rows = 40;
    const offers = everythingOffered();
    const first = offers[0]?.word as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: PREFIX, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
        { types: MOVES_DOWN, until: marks(first), what: 'marked the first word' },
        { types: '\r', until: arrivedSince(`${PROMPT} ${first}`), what: 'took the word' },
        // ⚠️ AND THE WAIT FOR THE LIST TO HAVE GONE IS THE SHARED INSTRUMENT'S, because spelled out
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
    endsAtTheFoot(shut, rows, 'the page with the list shut');
  }, 240_000);

  it('narrows to the word it had picked, and takes that one', async () => {
    // THE ADVERSARIAL SEQUENCE: open, move, type until one word is left, take it. What is picked
    // is a WORD, so the mark cannot drift onto a neighbour while the list narrows — the case
    // reads which word the mark is on AFTER the filter, and then which one Return brought.
    //
    // AND THE OTHER HALF OF THE SAME QUESTION — a filter that EXCLUDES the picked word — is
    // asserted where a value can be read: nothing is picked afterwards and Return hands the row
    // over exactly as it does on a list nobody moved through (`src/repl/editing.test.ts`).
    const columns = NOTHING_IS_CUT;
    const rows = 40;
    const offers = everythingOffered();
    const first = offers[0]?.word as string;
    const letter = first[PREFIX.length] as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: PREFIX, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
        { types: MOVES_DOWN, until: marks(first), what: 'marked the first word' },
        { types: letter, until: arrivedSince(letter), what: 'narrowed the list' },
        { types: '\r', until: arrivedSince(`${PROMPT} ${first}`), what: 'took what was left' },
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
    expect(pickedOn(narrowed), 'the filter lost a pick it was still showing').toBe(first);
    expect(taken.text, 'Return did not bring the word that was left').toContain(
      `${PROMPT} ${first}`,
    );
    expect(prompts(taken), 'Return ran the word instead of typing it').toBe(1);
  }, 240_000);
});

describe('a list of one, a list of none, and the arrows in both', () => {
  it('marks the only word there is, and browses the history when there is no list', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = 40;
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
          until: arrivedSince(`${PROMPT} xyzzy`),
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
    const rows = 40;
    const narrower = 100;
    const offers = everythingOffered();
    const first = offers[0]?.word as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: PREFIX, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
        { types: MOVES_DOWN, until: marks(first), what: 'marked the first word' },
        {
          resize: { columns: narrower, rows },
          until: arrivedSince(`${PICK}  ${first}`),
          what: 'was resized with a word picked',
        },
        leaves,
      ],
    });
    const after = screenOf(ran.bytes.slice(0, ran.at[3] as number), narrower, rows);
    expect(pickedOn(after), 'the resize lost what the caller had picked').toBe(first);
    endsAtTheFoot(after, rows, 'the page after a resize with a pick on it');
  }, 240_000);

  it('spends no colour, so a session with none still shows which row it is', async () => {
    // ⛔ THE REASON THE MARK IS A GLYPH AND NOT A HUE, asked of a real device twice over. The
    // session is driven with colour switched off at the environment — what a pipe, a CI log and
    // `--color=never` get — and the mark is still on the screen; and the paint on the frame that
    // MOVED the mark is the same paint as on the frame that opened the list, so nothing about
    // being picked is carried by a hue or a weight.
    //
    // ⚠️ AND SWITCHING COLOUR OFF DOES NOT MAKE THE PAGE PLAIN, which this case measured and is
    // worth writing down rather than asserting past: the capability the environment resolves is
    // the RECORD's renderer (`wiring/color.ts`), and the layout dims the palette and paints the
    // accent out of its own (`repl/region.ts`). So a page with `NO_COLOR` set still carries the
    // dim of the list and the magenta of the rules — 44 sequences of it, measured. That is a
    // decision this delivery did not take and did not touch; what it means here is that the claim
    // is *the pick spends no colour*, which is what the mark rests on, rather than *the page has
    // none*, which is not true today.
    const columns = NOTHING_IS_CUT;
    const rows = 40;
    const offers = everythingOffered();
    const first = offers[0]?.word as string;
    const ran = await drive(
      { ...fixture(), environment: { ...environment, NO_COLOR: '1' } },
      {
        columns,
        rows,
        steps: [
          opens,
          { types: PREFIX, until: arrivedSince(ONLY_A_LIST_SAYS), what: 'listed the words' },
          { types: MOVES_DOWN, until: marks(first), what: 'marked the first word' },
          leaves,
        ],
      },
    );
    const screen = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    expect(pickedOn(screen), 'the mark is not on the screen without colour').toBe(first);
    // THE PICK ADDED NO PAINT. The frame the arrow caused and the frame that opened the list are
    // compared by the SET of sequences that change how a glyph looks: equal sets mean the mark is
    // the whole of the difference a reader is being shown.
    const paintIn = (from: number, to: number): Set<string> =>
      new Set(ran.bytes.slice(ran.at[from] as number, ran.at[to] as number).match(PAINTED) ?? []);
    expect(paintIn(1, 2), 'the pick was painted rather than marked').toEqual(paintIn(0, 1));
    // NOT VACUOUS: there IS paint on both of those frames, so the comparison is over something.
    expect(paintIn(1, 2).size).toBeGreaterThan(0);
  }, 240_000);
});

describe('a page without the room shows fewer, and says how many it could not', () => {
  // TWO SIZES, AND THEY ARE THE TWO REGIMES OF THE SAME PROMISE. ⚠️ THIS WAS ONE CASE AT A
  // HUNDRED BY EIGHT, and it asserted that some were shown AND some were named — which is
  // what a list cut to the SCREEN did at that size. The list is cut to what the PAGE has left
  // over now (`repl/area.ts`, `AreaRequest.flow`), so the case that pinned "some are shown"
  // gained a size where the page really has some to spare.
  //
  // ⚠️ AND THE SHORT ONE ASSERTED THAT NOTHING WAS SHOWN, which is the premise the floor
  // falsified — and it was written down here as the other half of a promise rather than as the
  // defect it was: *at eight rows the opening spends the whole page: what is left over is the
  // chrome the list takes back, which is two rows, and two rows are the account and the row of
  // keys*. Both sentences were true of the arithmetic and neither was a promise worth keeping: a
  // list that draws `… 18 not shown` and NOT ONE WORD answers *what can I type* with *eighteen
  // things, none of them*, and a key that draws no word is indistinguishable from a key that does
  // nothing. There is a floor of one word under the leftover now (`repl/area.ts`,
  // `roomForThePalette`), so what the two sizes are two regimes OF has moved: it is how MANY are
  // shown — a page with room shows what it has room for, and a page with none shows one.
  for (const [rows, shown] of [
    [30, 8],
    [8, 1],
  ] as const) {
    it(`names a number that adds up to everything there was, at 100x${rows}`, async () => {
      // THE NUMBER IS ASSERTED AGAINST THE TOTAL rather than written down: what is on the
      // screen plus what the last row names is every word the session offers.
      const columns = 100;
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
      // Not vacuous: it really did leave some out, and the two sizes really are the two
      // regimes rather than one measured twice. ⚠️ THE SECOND OF THESE WAS A YES-OR-NO — *some
      // are shown* — and it is a COUNT now, because with a floor under the list both sizes show
      // some and what tells them apart is how many.
      expect(missing).toBeGreaterThan(0);
      expect(listed.length, `${rows}: ${listed.length} shown`).toBe(shown);
      // ⛔ AND THE PAGE DID NOT PAY FOR THE LIST at either size, which is what the cut buys:
      // the row the caller types on is still the last one the layout leaves.
      endsAtTheFoot(screen, rows, `100x${rows} with a cut list`);
    }, 180_000);
  }
});

// ---------------------------------------------------------------------------
// The boundary, measured again with the palette open
// ---------------------------------------------------------------------------

/**
 * THE HEIGHT THE LIBRARY GIVES UP AT, MEASURED WITH THE TALLEST THING THE REGION HOLDS.
 *
 * The palette is that thing — eighteen rows on a Tab — so if a budget were going to reopen
 * the hole the last two deliveries closed, this is where it would show. It does not: the
 * boundary is ONE row with the palette open and one row with it shut, and the palette is
 * CUT to what is left over rather than pushing the region past it. ⚠️ WHAT IT IS CUT TO
 * MOVED — it was what is left over the PROMPT and it is what is left over the FLOW
 * (`repl/area.ts`, `AreaRequest.flow`) — and the boundary did not, because the flow can only
 * ever make the cut deeper.
 *
 * BOTH WIDTHS ARE MEASURED, AND THE SECOND IS THE ONE THAT WAS IN DOUBT. Shortening the
 * hint gave it back to a sixty-column window, which grows that region by a row — so
 * "does the erase come back there too" had to be asked again rather than assumed. It does,
 * at ONE row: the same place a hundred columns is at, and one row lower than where this
 * front found it. Where the boundary sits as a FUNCTION of the hint is
 * `the-input-has-its-own-place.test.ts`; what this file adds is that the palette does not
 * move it.
 *
 * ⚠️ AND THE LIST IS ONE ROW TALLER THAN WHEN THIS WAS WRITTEN — the keys that move it are said
 * under it now — so the question had to be asked again rather than inherited: the row comes out of
 * the palette's OWN budget (`repl/palette.ts`, `paletteRowsFor`), which is what is left over, so
 * the region is bounded exactly where it was. The keystrokes below are the ones that could move
 * it: the key that opens the list, and the arrow that MARKS a row in it.
 *
 * ⚠️ AND *THE ERASE* IS WHAT THE BOUNDARY USED TO BE READ OFF, IN EVERY SENTENCE ABOVE. It does not
 * reach a terminal at any height any more — it is translated on the way out (`repl/page.ts`,
 * `theEraseAsAScroll`) — so the sentences survive as what they were always about, which is the
 * height the library gives up on redrawing PART of the page at, and the reading is the ANSWER to
 * its giving up: a page carried into the scrollback where nothing could have turned one.
 */
const TOO_SHORT_TO_REDRAW_IN_PART = 1;

describe('opening the palette does not move the height the library starts the page over at', () => {
  for (const columns of [60, 100]) {
    it(`reaches it at the same row with the palette open, at ${columns} columns`, async () => {
      const short = await inPty({
        columns,
        rows: TOO_SHORT_TO_REDRAW_IN_PART,
        steps: [
          opens,
          { types: COMPLETES, until: () => true, what: 'was asked for the words' },
          { types: MOVES_DOWN, until: () => true, what: 'was asked to mark a row' },
          leaves,
        ],
      });
      // ⚠️ THE BOUNDARY USED TO BE READ OFF THE ERASE and it is read off the ANSWER now: the
      // sequence the library starts the whole page over with is translated on the way out
      // (`src/repl/page.ts`, `theEraseAsAScroll`), so the erase reaches no terminal at any height
      // and a bracket made of it would be two absences. What the translation writes instead is a
      // page carried into the scrollback, and at a fixed height nothing else can carry one
      // (`support/pty.ts`, `carriedPages`).
      expect(
        carriedPages(short.bytes),
        `${columns}: the boundary moved with the palette`,
      ).toBeGreaterThan(1);

      for (const rows of [TOO_SHORT_TO_REDRAW_IN_PART + 1, 4, 8]) {
        const taller = await inPty({
          columns,
          rows,
          steps: [
            opens,
            // ⚠️ WHAT THIS KEYSTROKE PUT ON THE PAGE, and not the character anywhere in the
            // stream: the opening writes a slash three ways over — the project's path, the
            // record's `T1/T2/T4`, and the hint that names this very key — so a predicate over
            // the whole stream was over before the key was pressed
            // (`support/pty.ts`, `arrivedSince`).
            { types: PREFIX, until: arrivedSince(PREFIX), what: 'opened the palette' },
            { types: COMPLETES, until: () => true, what: 'was asked for the words' },
            // AND WITH A ROW OF IT MARKED, which is the keystroke this delivery added: a mark
            // that had grown the region would reach the erase here and nowhere else.
            { types: MOVES_DOWN, until: () => true, what: 'was asked to mark a row' },
            leaves,
          ],
        });
        expect(carriedPages(taller.bytes), `${columns}x${rows} with the palette open`).toBe(1);
        expect(taller.bytes, `${columns}x${rows} never opened`).toContain(PROMPT);
        // ⛔ AND NOT ONE ROW OF THE CALLER'S HISTORY WAS ERASED, on either side of the boundary.
        expect(taller.bytes, `${columns}x${rows}: the history was erased`).not.toContain(
          ERASES_THE_HISTORY,
        );
      }
      expect(short.bytes, `${columns}: the history was erased`).not.toContain(ERASES_THE_HISTORY);
      // Not vacuous: the hint IS drawn at this width, which is what makes the region two
      // rows and the boundary reachable at all.
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
 * ⚠️ THE FIRST FORM OF THIS SCAN LOOKED FOR THE GLYPH ANYWHERE IN THE FILE, and it
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
 * ⚠️ WITHOUT IT THE SCAN FOUND NOTHING AT ALL, which is how it was caught: the one module that
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
