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
import { type CliIo, buildProgram, run } from '../src/cli.js';
import type { CompletionWord } from '../src/completion/tree.js';
import { completionTree } from '../src/completion/tree.js';
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { areaFor } from '../src/repl/area.js';
import { verbsOffered } from '../src/repl/gate.js';
import { CUT, offeredBy, paletteFor } from '../src/repl/palette.js';
import { badgeLine, theSessionsOwnWords, tips } from '../src/repl/session.js';
import { PREFIX, SESSION_WORDS } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import { type Fixture, inPty as drive, type Ran, type Step } from './support/pty.js';
import { screenOf } from './support/screen.js';

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
/** The sequence that erases the caller's history. It is not this product's to write. */
const ERASES_THE_HISTORY = `${ESC}[3J`;

/** How wide a terminal has to be for nothing in these lists to be cut. */
const NOTHING_IS_CUT = 160;

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

// ---------------------------------------------------------------------------
// What is offered: the two triggers
// ---------------------------------------------------------------------------

describe('one palette, two triggers, and the slash counts only at the start of the line', () => {
  const words = theSessionsOwnWords();
  const tabOffered: readonly CompletionWord[] = [
    { word: 'search', description: 'a read' },
    { word: 'show', description: 'another read' },
  ];

  it('opens the session’s own words on a slash, and narrows them as they are typed', () => {
    expect(offeredBy(PREFIX, [], words)).toEqual(words);
    // Narrowing REDUCES, and to the words that really start that way rather than to a
    // number: the case reads the vocabulary rather than counting to one.
    const narrowed = offeredBy(`${PREFIX}c`, [], words);
    expect(narrowed.length).toBeLessThan(words.length);
    expect(narrowed.map((offer) => offer.word)).toEqual(
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
      expect(offeredBy(line, [], words), line).toEqual([]);
    }
    expect(offeredBy(`${PREFIX}help`, [], words).length).toBe(1);
  });

  it('offers what a Tab could not choose between when the line has no slash', () => {
    expect(offeredBy('s', tabOffered, words)).toEqual(tabOffered);
    // And nothing at all when a Tab offered nothing, which is a palette that is shut.
    expect(offeredBy('s', [], words)).toEqual([]);
  });

  it('lets the slash win over what a Tab left, because the slash is live', () => {
    // Typing a slash after an ambiguous Tab is a caller asking a different question. Both
    // answers exist here, so this says which one is given.
    expect(offeredBy(PREFIX, tabOffered, words)).toEqual(words);
  });
});

// ---------------------------------------------------------------------------
// What the rows say, and the one thing that is cut
// ---------------------------------------------------------------------------

/** How many of the offers a set of composed rows actually shows. */
function rowsFor(offers: readonly CompletionWord[], room: number, columns: number): string[] {
  return [...paletteFor({ offers, room, columns, render: renderPlain })];
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
    const rows = rowsFor(offers, offers.length, NOTHING_IS_CUT);
    expect(rows).toHaveLength(offers.length);
    for (const [index, offer] of offers.entries()) {
      const row = rows[index] as string;
      expect(row, offer.word).toContain(offer.word);
      if (offer.description.length > 0) expect(row, offer.word).toContain(offer.description);
    }
    // The corpus is real: this product has more than a handful of reads, and every one of
    // them has something to say about itself.
    expect(offers.length).toBeGreaterThan(10);
    expect(offers.every((offer) => offer.description.length > 0)).toBe(true);
  });

  it('lines the second column up, which is what makes it a column', () => {
    const rows = rowsFor(offers, offers.length, NOTHING_IS_CUT);
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
    const wide = rowsFor(offers, offers.length, NOTHING_IS_CUT);
    expect(wide.some((row) => row.includes(CUT)), 'something was cut at a width that fits').toBe(
      false,
    );

    const narrow = rowsFor(offers, offers.length, 60);
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
        for (const row of rows) expect([...row].length, `${room}/${columns}`).toBeLessThanOrEqual(columns);
        // And it never draws more rows than it was given room for.
        expect(rows.length, `${room}/${columns}`).toBeLessThanOrEqual(room);
        const missing = saidToBeMissing(rows);
        const shown = missing === undefined ? rows.length : rows.length - 1;
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
    const rows = rowsFor(offers, 3, NOTHING_IS_CUT);
    expect(rows).toHaveLength(3);
    expect(saidToBeMissing(rows)).toBe(offers.length - 2);
    // And with room for exactly one row, that row is the one that accounts for all of them.
    const only = rowsFor(offers, 1, NOTHING_IS_CUT);
    expect(only).toHaveLength(1);
    expect(saidToBeMissing(only)).toBe(offers.length);
  });

  it('says nothing when everything fits, so the row is a signal and not furniture', () => {
    const rows = rowsFor(offers, offers.length, NOTHING_IS_CUT);
    expect(saidToBeMissing(rows)).toBeUndefined();
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
  const tall = { rows: 40, palette: 0 };

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
// The budget: the palette is cut by what is left over the prompt
// ---------------------------------------------------------------------------

describe('the palette gets what is left over the row being typed, and never more', () => {
  it('is cut by the height, and the cut is reported rather than taken', () => {
    const wanted = 20;
    const columns = 100;
    const roomAt = (rows: number) =>
      areaFor({ rows, columns, badge: BADGE_IS, hint: HINT_IS, palette: wanted }).palette;
    // Tall enough for all of it, and then one row less at a time.
    expect(roomAt(40)).toBe(wanted);
    expect(roomAt(10)).toBe(10 - 1 - 2);
    expect(roomAt(4)).toBe(1);
    expect(roomAt(3)).toBe(0);
    // The region never grows past the boundary: whatever the height, what the area takes
    // leaves the library a row to work in.
    for (const rows of [3, 4, 6, 10, 24, 40]) {
      const area = areaFor({ rows, columns, badge: BADGE_IS, hint: HINT_IS, palette: wanted });
      expect(area.height, `${rows}`).toBeLessThanOrEqual(rows - 1);
    }
  });

  it('gives up the chrome before it gives up a word, which is the trade it makes', () => {
    // The palette answers the key that was just pressed, so on a terminal that cannot hold
    // both it is the badge and the rules that go — the same call the single row of
    // candidates already forced, made explicit now the list can be long.
    const columns = 100;
    const shut = areaFor({ rows: 8, columns, badge: BADGE_IS, hint: HINT_IS, palette: 0 });
    const open = areaFor({ rows: 8, columns, badge: BADGE_IS, hint: HINT_IS, palette: 20 });
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
const opens: Step = { until: (bytes) => bytes.includes(PROMPT), what: 'opened its console' };

/** The step every session ends with. */
const leaves: Step = {
  types: `${CLEARS_THE_LINE}${PREFIX}exit\r`,
  what: 'left',
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(`${PREFIX}exit`),
};

/** Every row of a screen that begins, after the indent, with one of these words. */
function rowsNaming(
  screen: { readonly rows: readonly string[] },
  words: readonly string[],
): string[] {
  return screen.rows.filter((row) => {
    const said = row.trimStart();
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
        { types: PREFIX, until: (bytes) => bytes.includes(gone[0] as string), what: 'listed them' },
        {
          types: 'c',
          until: (bytes) => bytes.includes(`${PREFIX}c`),
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

describe('a terminal without the height shows fewer, and says how many it could not', () => {
  it('names a number that adds up to everything there was', async () => {
    // THE NUMBER IS ASSERTED AGAINST THE TOTAL rather than written down: what is on the
    // screen plus what the last row names is every word the session offers.
    const columns = 100;
    const rows = 8;
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
    expect(listed.length + missing, `${listed.length} shown, ${missing} named`).toBe(offers.length);
    // Not vacuous: it really did leave some out, and it really did show some.
    expect(missing).toBeGreaterThan(0);
    expect(listed.length).toBeGreaterThan(0);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// The boundary, measured again with the palette open
// ---------------------------------------------------------------------------

/**
 * THE HEIGHT THE LIBRARY GIVES UP AT, MEASURED WITH THE TALLEST THING THE REGION HOLDS.
 *
 * The palette is that thing, so if a budget were going to reopen the hole the last two
 * deliveries closed, this is where it would show. Measured on this delivery: at a hundred
 * columns the boundary is ONE row with the palette open and one row with it shut, and at
 * sixty — where the hint is not drawn — it is not reached at any height at all.
 */
const TOO_SHORT_TO_REDRAW_IN_PART = 1;

describe('opening the palette does not move the height the library erases at', () => {
  it('reaches the boundary at the same row it reaches it with the palette shut', async () => {
    const columns = 100;
    const short = await inPty({
      columns,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [
        opens,
        { types: COMPLETES, until: () => true, what: 'was asked for the words' },
        leaves,
      ],
    });
    expect(short.bytes, 'the boundary moved down with the palette').toContain(ERASES_THE_HISTORY);

    for (const rows of [TOO_SHORT_TO_REDRAW_IN_PART + 1, 4, 8]) {
      const taller = await inPty({
        columns,
        rows,
        steps: [
          opens,
          { types: PREFIX, until: (bytes) => bytes.includes(PREFIX), what: 'opened the palette' },
          { types: COMPLETES, until: () => true, what: 'was asked for the words' },
          leaves,
        ],
      });
      expect(taller.bytes, `${rows} rows with the palette open`).not.toContain(
        ERASES_THE_HISTORY,
      );
      expect(taller.bytes, `${rows} rows never opened`).toContain(PROMPT);
    }
  }, 300_000);
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
