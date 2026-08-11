/**
 * THE EMPTINESS GOES UNDER THE BOX — and it is what the LIST OF WORDS takes its room out of, so
 * that a menu opening and shutting costs the page nothing.
 *
 * The input sits on the last row the layout leaves, and what puts it there is as many rows with
 * nothing on them as the page has to spare (`repl/page.ts`). ⚠️ THEY WENT OVER THE OPENING, and
 * that was written down as *the blank rows go BEFORE the opening, so what the session says fills
 * the page downwards*. Both halves of the sentence were true and the page was still wrong:
 * measured on a real terminal at a hundred and twenty by forty, it opened with TWENTY-ONE empty
 * rows at the top and the box shoved down against the input, so the first thing a reader looks at
 * was the last thing on the screen. What was falsified is not the anchoring but the DIRECTION,
 * and the rows go under the flow now.
 *
 * ⚠️ AND THEN THEY WERE LINES OF THE FLOW, which is the premise the delivery this file now
 * describes falsified. It was written here that the region the layout redraws had not grown —
 * *the rows are lines of the FLOW; in the region instead, they would walk it into the height at
 * which this library gives up on redrawing part of a screen* — and the guard for it was that the
 * region is the same size on a tall terminal as on a short one. True of the rows, and it is
 * exactly what made the anchoring one-way: a line of the flow can only be APPENDED. So an area
 * that GREW scrolled the page, an area that shrank was answered with more empty rows, and what
 * had scrolled away never came back. Measured at a hundred and twenty by forty, on the binary of
 * the delivery before this one: ONE opening and shutting of the list, and the box was gone for
 * good — the panel, the mark, the verdict, all of it in the scrollback, on the first keystroke a
 * caller presses to see what they can type.
 *
 * SO THE EMPTINESS IS PART OF WHAT IS REDRAWN, and the list takes its twenty rows out of THAT:
 * the two move in opposite directions on the same frame, the region's height does not change, and
 * nothing scrolls at all. The old guard is not weakened, it is replaced by the arithmetic that
 * makes it unnecessary — the region is the leftover and the area, and the leftover is what is
 * left after the row the library needs, so `gap + area` is at most one row short of the screen
 * whatever the flow, at every height.
 *
 * FIVE THINGS ARE ASKED HERE, and the last three of them are asked of a real pseudo-terminal:
 *
 *   - THE ARITHMETIC, which is one subtraction asked on every frame — and, composed with the
 *     arrangement the area chose, never a region as tall as the viewport.
 *   - THE BYTES A PAGE IS TURNED WITH, which no longer place it: the leftover cannot be written
 *     there, because the opening is drawn after them and nothing written there can land under it.
 *   - THE ORDER ON THE SCREEN: the box, then the emptiness, then the input.
 *   - THE LIST OPENED AND SHUT TEN TIMES OVER, at three sizes, which is the defect above and the
 *     case this file is for: the input at the foot in every one of them, and the box on the first
 *     row. ⚠️ AND THE BOX WAS ASKED FOR AT ONE SIZE OF THE THREE, because at the other two it
 *     went: the palette was budgeted against the room over the PROMPT rather than against the
 *     leftover, so a list wanting twenty-one rows on a page with two to spare took the other
 *     nineteen off the top. The delivery after this one cut the list to the leftover instead
 *     (`repl/area.ts`, `AreaRequest.flow`), the third column of the table went red as it was
 *     written to, and the box is asked for at all three sizes now.
 *   - ⛔ AND THE ERASE, still absent, bracketed at the height where the library writes it — with
 *     the list open, which is the region at its tallest.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVEL_REQUIREMENTS, requiredLevel } from '@mnema/chain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { bannerFor } from '../src/presentation/banner.js';
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { areaFor, BELOW_THE_VIEWPORT } from '../src/repl/area.js';
import { carriedIntoTheScrollback, type ThePage, theGap } from '../src/repl/page.js';
import { CUT } from '../src/repl/palette.js';
import { badgeLine, tips } from '../src/repl/session.js';
import { LEAVE } from '../src/session-words.js';
import { VERSION } from '../src/version.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import {
  aFrameAfter,
  aFrameWithout,
  arrivedSince,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import {
  endsAtTheFoot,
  firstDrawnRow,
  promptRow,
  type Screen,
  screenOf,
  theGapOn,
} from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/**
 * The first words of the one sentence the session lands UNDER the panel — the last row the
 * opening draws (`src/repl/session.ts`, `whatItRefuses`).
 *
 * ⚠️ IT WAS THE BOX'S BOTTOM-LEFT CORNER, and the row above the emptiness was found by it. The
 * frame is gone, so what the opening ENDS with is the one line it lands rather than an edge.
 */
const UNDER_THE_PANEL = 'It runs the';

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';

/** A word only the palette shows, so a screen can be asked whether the list is open. */
const ONLY_THE_LIST_SAYS = 'start the page over';

/**
 * WHAT THE PALETTE SAYS WHEN IT HAD MORE WORDS THAN ROWS: the mark, a count, and what the count
 * is — the row that accounts for the offers there was no room for (`repl/palette.ts`).
 *
 * A PATTERN AND NOT THE MARK ALONE, and the difference is an instrument that accuses the wrong
 * thing: the same mark ends a DESCRIPTION too long for the row, so a case that looked for it
 * would be satisfied by a palette that fitted perfectly and had one wordy entry. The count is
 * left as a number to match rather than written down, because how many had no room is a function
 * of the height and a case that spelled it would be asserting the geometry twice.
 */
const SAYS_WHAT_IT_CUT = new RegExp(`${CUT} \\d+ not shown`);

/** How wide the row of affordances under the input is, as the session composes it. */
const HINT = widthOf(tips());

/**
 * WIDTHS A BADGE REALLY IS, and none at all for a session with no record to name a level of.
 *
 * Composed out of the levels a caller can DEMAND rather than written down, for the reason the
 * amarra about fixtures gives: a width nothing can produce would make the grid below assert the
 * geometry of a console that cannot exist.
 */
const BADGES = [
  0,
  ...LEVEL_REQUIREMENTS.map((requirement) => widthOf(badgeLine(requiredLevel(requirement)))),
];

// ---------------------------------------------------------------------------
// The arithmetic: one subtraction, asked on every frame
// ---------------------------------------------------------------------------

describe('the gap is what the flow does not fill', () => {
  it('answers one row fewer for every row the flow, the area or the screen takes', () => {
    // THE SUBTRACTION, and it is the only place an off-by-one in the SAFE direction can be
    // caught. One row too many is invisible on a screen — the layout's own newline scrolls the
    // page back into exactly the same place — and what it costs is one row of the caller's
    // history carried away for nothing.
    const page: ThePage = { rows: 30, flow: 17, area: 5 };
    expect(theGap(page)).toBe(30 - 17 - 5 - BELOW_THE_VIEWPORT);
    // Not a coincidence of one arrangement: every number in it moves the answer one for one.
    expect(theGap({ ...page, rows: 31 })).toBe(31 - 17 - 5 - BELOW_THE_VIEWPORT);
    expect(theGap({ ...page, flow: 21 })).toBe(30 - 21 - 5 - BELOW_THE_VIEWPORT);
    expect(theGap({ ...page, area: 6 })).toBe(30 - 17 - 6 - BELOW_THE_VIEWPORT);
  });

  it('gives a page that already fills the screen nothing at all', () => {
    // AND IT IS NOT A NEW BRANCH: nothing fits into a negative number of rows, so a terminal
    // with no room over the flow gets what it got before there was an anchor, which is none.
    for (const rows of [3, 5, 22]) expect(theGap({ rows, flow: 17, area: 5 })).toBe(0);
    // Including the exact boundary, where the leftover is nothing rather than negative.
    expect(theGap({ rows: 23, flow: 17, area: 5 })).toBe(0);
    // And a terminal that reported no height at all is answered with nothing either.
    expect(theGap({ rows: 0, flow: 0, area: 0 })).toBe(0);
    // Not vacuous: one row over the boundary really is one row of leftover, so the answers
    // above are the absence of a gap rather than a function that never finds one.
    expect(theGap({ rows: 24, flow: 17, area: 5 })).toBe(1);
  });

  it('⚠️ gives the area exactly what the area takes, so the two of them are one height', () => {
    // THE WHOLE MECHANISM OF THIS DELIVERY, as arithmetic. The leftover and the area are drawn
    // together, so what matters is their SUM: a list of words twenty rows tall takes twenty rows
    // out of the leftover and the region is the same height it was, which is why the page does
    // not move and nothing of the caller's is carried away.
    //
    // ⚠️ IT USED TO BE ASKED THE OTHER WAY ROUND, and that case is what this replaces: the rows
    // were the flow's, so a frame whose area had SHRUNK worked its flow out backwards from where
    // the area had been anchored (`theFlowAbove`, gone) and the difference was landed as more
    // empty lines. The window cancelled in that subtraction, which was the point of it. Here
    // there is nothing to cancel: one height, one flow, one answer per frame.
    const rows = 40;
    const flow = 14;
    const region = (area: number): number => theGap({ rows, flow, area }) + area;
    expect(region(5), 'the region is not the leftover and the area').toBe(
      rows - flow - BELOW_THE_VIEWPORT,
    );
    // A list of words open, at the height the palette really asks for at this size, and the
    // region has not moved a row.
    expect(region(25), 'the list of words changed the height of the region').toBe(region(5));
    // AND THE LEFTOVER REALLY DID GIVE THE ROWS UP, or the equality above is two zeroes: it is
    // twenty rows shorter for an area twenty rows taller.
    expect(theGap({ rows, flow, area: 5 }) - theGap({ rows, flow, area: 25 })).toBe(20);
    // AND AN AREA THAT OUTGROWS THE PAGE takes what there is and no more: the leftover is
    // nothing, and the region is the area alone. This is the one case where the sum is not the
    // page — because there is no page left to share.
    expect(region(rows), 'a page with no room to spare invented some').toBe(rows);
  });

  it('⛔ never asks for a region as tall as the screen, at any size a terminal has', () => {
    // ⛔ THE GUARD THE WHOLE DELIVERY RESTS ON, and it is a COMPOSITION of the two functions
    // rather than a property of either: the arrangement the area has room for is chosen so that
    // it fits with a row to spare (`repl/area.ts`), and the leftover is what is left after that
    // row — so the region the layout redraws is at most one row short of the viewport, which is
    // the height at which the same library redraws the WHOLE screen with the erase this product
    // refuses to write inside the sequence.
    //
    // IT IS ASKED OVER EVERY SIZE AND EVERY LIST, and over a flow of NOTHING, which is the
    // worst case: the shorter the flow, the taller the leftover.
    let withRoom = 0;
    let withNone = 0;
    for (const rows of [2, 3, 4, 5, 6, 8, 10, 24, 40, 120]) {
      for (const columns of [20, 60, 100, 200]) {
        for (const badge of BADGES) {
          for (const palette of [0, 1, 7, 20, 80]) {
            for (const flow of [0, 1, 5, 14, 200]) {
              // ONE FLOW, TWO SUBTRACTIONS, and the sweep hands the same number to both — which
              // is what the console does on a frame (`repl/console.ts`, `onScreen`). The area
              // budgets the list of words against what the page has left over and the leftover
              // is the rest of that same subtraction, so a case that fed them two different
              // numbers would be measuring a page that does not exist.
              const area = areaFor({ rows, columns, badge, hint: HINT, palette, flow });
              const at = `${columns}x${rows} flow ${flow} palette ${palette} badge ${badge}`;
              const region = theGap({ rows, flow, area: area.height }) + area.height;
              // THE SUM IS THE PAGE MINUS THE FLOW, or the area alone when there is no page
              // left to share — one statement, both branches, so neither can go unasserted.
              expect(region, at).toBe(Math.max(area.height, rows - flow - BELOW_THE_VIEWPORT));
              // AND THE FLOOR IS THE ONE THING THAT CAN REACH THE VIEWPORT, which it could
              // before this delivery and can still: a terminal too short for the row being
              // typed and its hint has nowhere to put a prompt, and there is nothing shorter
              // to give it. Everywhere else the region is short of the screen.
              if (area.height + BELOW_THE_VIEWPORT <= rows) {
                expect(region + BELOW_THE_VIEWPORT, at).toBeLessThanOrEqual(rows);
                withRoom += 1;
              } else withNone += 1;
            }
          }
        }
      }
    }
    // NOT VACUOUS IN EITHER DIRECTION: the grid really contains sizes with room to spare and
    // sizes with none, so the branch that asserts the boundary is not the branch nobody took.
    expect(withRoom, 'no size in the grid had room for an area at all').toBeGreaterThan(100);
    expect(withNone, 'no size in the grid was too short for the floor').toBeGreaterThan(0);
  });

  it('⚠️ carries the page away and no longer places it, byte for byte', () => {
    // THE GUARD THAT THE LEFTOVER LEFT THESE BYTES. It used to end with them, and that is what
    // put the emptiness at the top of the screen: the opening is the LAYOUT's to draw and it is
    // drawn after these bytes, so a row written here can only ever land above the box. What is
    // left is the cursor on the last row, a page's worth of rows that scroll, and back to the
    // top — and nothing else at any height.
    for (const rows of [3, 24, 40]) {
      expect(carriedIntoTheScrollback(rows)).toBe(`${ESC}[${rows};1H${'\n'.repeat(rows)}${ESC}[H`);
    }
    // A terminal that reported no height gets nothing rather than a guess.
    expect(carriedIntoTheScrollback(0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` at the shell, in this process. */
async function shell(...argv: string[]): Promise<void> {
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(argv, io);
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-gap-'));
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
  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 240_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

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
  types: `${LEAVE}\r`,
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(LEAVE),
  what: 'left',
};

/** What abandons the row being typed, spelled by its code point rather than typed. */
const ABANDONS_THE_LINE = '\u0003';

/** What takes the last key back off the row being typed. */
const RUBS_OUT = '\u007f';

/** The key that opens the palette, which is also the one the hint names. */
const LISTS_THE_WORDS = '/';

/**
 * Opens the list of words, which is the area at its tallest — waiting for a frame, whatever is in
 * it.
 *
 * THE TOLERANT FORM, and it is the one a sweep over HEIGHTS needs: on a terminal of three rows the
 * palette is cut to nothing at all, so a step waiting for a word of the list would wait forever.
 * Every case that uses this one asserts an ABSENCE, which a frame with no list in it satisfies
 * honestly. ⚠️ AND ONE USED IT WHILE ASSERTING A PRESENCE, which is what
 * {@link opensTheListAndWaitsForTheCut} is: the promise in the sentence before this one was made
 * here and broken one screenful below it.
 */
const opensTheList: Step = { types: LISTS_THE_WORDS, until: aFrameAfter(PROMPT), what: 'listed' };

/**
 * The same key, waiting for THE LIST — for the cases that then read it off a screen.
 *
 * ⚠️ THOSE CASES USED THE TOLERANT FORM, and a frame is not the list: measured in the full suite,
 * under load, the second cycle of ten ended on a frame the palette was not in yet and the screen
 * read as though the key had done nothing. It is the rule this bench has already written down once
 * — a step in a pty waits for what IT caused, which is what `since` is for (`support/pty.ts`,
 * `arrivedSince`) — applied to the site that did not have it. The two forms are separate rather
 * than one clever predicate, because *the list may be cut to nothing* and *the list must be on the
 * screen* are two different cases and a step cannot be both.
 */
const opensTheListAndWaitsForIt: Step = {
  ...opensTheList,
  until: arrivedSince(ONLY_THE_LIST_SAYS),
};

/**
 * The same key, waiting for the row that ACCOUNTS FOR WHAT HAD NO ROOM — for the one case whose
 * subject is a list that did not fit.
 *
 * ⚠️ IT IS THE SITE THE REPAIR ABOVE DID NOT REACH, and the paragraph above says why in advance:
 * every case on the tolerant form asserts an ABSENCE, and this one asserts a PRESENCE. Measured in
 * a whole-suite run of the delivery that narrowed the resize guard: the step ended on a frame the
 * palette was not in, and the case read a screen with the record, the prompt and the hint on it
 * and no list at all — *the list was not cut, so nothing here is about a cut list* — while the
 * same case was green on its own three times over. Nothing of the product is in that difference;
 * what is in it is a step that waited for something other than what it was about.
 */
const opensTheListAndWaitsForTheCut: Step = {
  ...opensTheList,
  until: (bytes, since) => SAYS_WHAT_IT_CUT.test(bytes.slice(since)),
  what: 'listed with a row for what it could not show',
};

/**
 * Shuts it again, by taking back the key that opened it — and waits for a frame that does NOT
 * hold the list.
 *
 * THE OTHER HALF OF THE SAME REPAIR, and it cannot be `arrivedSince` because what it waits for is
 * an absence: the frame the keystroke causes is one the palette is not written into at all.
 *
 * ⚠️ AND IT WAS SPELLED OUT HERE AND WAS TRUE BEFORE THE KEY HAD BEEN DRAWN. `aFrameAfter(PROMPT)`
 * approves the frame that arrived BEFORE the keystroke, and *nothing of the list in what arrived*
 * is satisfied by an EMPTY slice — so under load this step ended on the frame that still had the
 * list on it: measured, *cycle 10: the list was open* at a hundred by thirty in a whole-suite run,
 * green on its own. The rule is one function now, and it is the shared instrument's
 * (`support/pty.ts`, {@link aFrameWithout}): an absence is waited for in two parts, and the first
 * is the PRESENCE of a frame this step caused.
 */
const shutsTheList: Step = {
  types: RUBS_OUT,
  until: aFrameWithout(PROMPT, ONLY_THE_LIST_SAYS),
  what: 'shut the list',
};

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/** Which row the opening's last one is, and −1 when the opening is not on the screen at all. */
function openingEndsOn(screen: Screen): number {
  return screen.rows.findIndex((row) => row.includes(UNDER_THE_PANEL));
}

/**
 * Which row the opening BEGINS on — the first row of the MARK — and −1 when it has scrolled away.
 *
 * ⚠️ IT WAS THE BOX'S TOP EDGE, found by its corner: the row that goes first when a page is
 * pushed up. The frame is gone and the row that goes first is the first row of the drawing, which
 * is asked of the module that draws it at the width this screen was replayed at — so a fifth form
 * of the art moves this instrument with it instead of leaving it looking for a glyph nobody
 * writes.
 */
function openingBeginsOn(screen: Screen, columns: number): number {
  return screen.rows.findIndex((row) => row.startsWith(theFirstRowOfTheMark(columns)));
}

/** The first row of the drawing of the name a terminal this wide gets, as the layout writes it. */
function theFirstRowOfTheMark(columns: number): string {
  const art = bannerFor({ columns, rows: 0, needs: () => 0 }).map(renderPlain);
  const first = art[0];
  expect(first, 'the name is drawn with no rows at all').toBeDefined();
  return first as string;
}

/**
 * How many rows BETWEEN THE OPENING AND THE ROW BEING TYPED have nothing at all on them.
 *
 * ⚠️ IT WAS EVERY BLANK ROW ABOVE THE ROW BEING TYPED, and the frame is what made that the same
 * question. The stacked arrangement has always had a blank row inside it — the margin over the
 * record's section (`src/repl/panel.ts`, `BETWEEN_SECTIONS`) — and while there was a border, the
 * row was `│ … │` and therefore DRAWN. With the border gone the row is genuinely blank, so a
 * count from the top of the screen answers with the leftover PLUS the panel's own margin:
 * measured at eighty by twenty-four, three against a leftover of two.
 *
 * WHAT THE CALLERS ARE FOR IS UNCHANGED — the emptiness above the input is ONE run, because a
 * page with emptiness in two places is a page that was placed twice — and the run they are about
 * begins below the opening. A margin the PANEL draws inside itself is not a placement, and it is
 * counted by neither this nor {@link theGapOn}.
 */
function emptyRowsAbove(screen: Screen): number {
  const from = openingEndsOn(screen);
  return screen.rows
    .slice(from + 1, promptRow(screen, PROMPT))
    .filter((row) => row.trim().length === 0).length;
}

/**
 * HOW MANY WORDS OF THE LIST ARE DRAWN — the rows between the blank one over the palette and the
 * row that accounts for what had no room.
 *
 * COUNTED BY POSITION AND NOT BY VOCABULARY, which is what keeps it in this file: what a word of
 * the list IS belongs to the palette, and a case here that knew the verbs of this product would
 * be a second reading of a list built somewhere else (`the-list-is-a-window.test.ts` counts them
 * against the offers, because that is what that file is about). Both ends are the palette's own —
 * the account row it draws when it cut, and the blank row the area spends over it
 * (`repl/area.ts`, `ABOVE_THE_PALETTE`) — so nothing above the list can be counted into it.
 *
 * NOTHING WAS CUT MEANS THERE IS NO SUCH ROW, and the answer is then a refusal rather than a
 * zero: this instrument cannot tell where a list that fits ends, and the caller asks it only
 * where the list is cut.
 */
function wordsOfTheListOn(screen: Screen): number | undefined {
  const account = screen.rows.findIndex((row) => row.trimStart().startsWith(CUT));
  if (account < 0) return undefined;
  const above = screen.rows.slice(0, account);
  return above.length - 1 - above.map((row) => row.trim().length === 0).lastIndexOf(true);
}

// ---------------------------------------------------------------------------
// The order on the screen: the box, the emptiness, the input
// ---------------------------------------------------------------------------

describe('the box opens at the top and the emptiness goes under it', () => {
  // Three sizes: the one every terminal has had since before they were on screens, a common
  // laptop window, and a large one — the last because a page whose emptiness only moved where
  // the defect was photographed is a page that moved a case rather than the product.
  for (const [columns, rows] of [
    [80, 24],
    [100, 30],
    [120, 40],
  ] as const) {
    it(`opens with the box on the first row of ${columns}x${rows}`, async () => {
      const ran = await inPty({ columns, rows, steps: [opens, leaves] });
      const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
      expect(screen.text, `${columns}x${rows}: the session never opened`).toContain(OPENED);
      // NOTHING IS ABOVE THE BOX, which is the inversion: the page began as far down the screen
      // as the leftover was long, and it begins at the top now.
      expect(firstDrawnRow(screen), `${columns}x${rows}: the page does not begin at the top`).toBe(
        0,
      );
      expect(
        openingBeginsOn(screen, columns),
        `${columns}x${rows}: the first row is not the mark's`,
      ).toBe(0);
      // AND THE EMPTINESS IS UNDER IT: it begins below the box's last row and it ends where the
      // input area begins, which is what makes it the leftover rather than a gap in the drawing.
      const gap = theGapOn(screen, PROMPT);
      expect(
        gap,
        `${columns}x${rows}: nothing was left over, so nothing was anchored`,
      ).toBeGreaterThan(0);
      // ⚠️ AND THE FIRST BLANK ROW ON THE SCREEN USED TO BE THE ONE THIS ASKED ABOUT, on the
      // premise that the drawing had no blank row in it. The frame is what made that true: the
      // margin over the record's section was a row of the box, `│ … │`, and it is genuinely
      // blank now — measured, at eighty by twenty-four, where the first blank row is row 11 and
      // the opening ends on row 15. So what is asked is that the run touching the INPUT begins
      // below the opening, which is what the emptiness being under it means.
      const emptyFrom = screen.rows.findIndex(
        (row, at) => at > openingEndsOn(screen) && row.trim().length === 0,
      );
      expect(emptyFrom, `${columns}x${rows}: nothing is empty under the opening`).toBe(
        openingEndsOn(screen) + 1,
      );
      // AND IT IS ONE RUN AND NOT SEVERAL: everything above the input with nothing on it is the
      // run that touches the input. A page with emptiness anywhere else is a page placed twice.
      expect(emptyRowsAbove(screen), `${columns}x${rows}: the emptiness is in two places`).toBe(
        gap,
      );
      // And the input is still on the last row the layout leaves, which is the promise the
      // direction of these rows may not cost (`the-prompt-sits-at-the-foot.test.ts`).
      endsAtTheFoot(screen, rows, `${columns}x${rows}`);
    }, 240_000);
  }

  it('⚠️ lands what the session says INTO the emptiness, and the page does not move', async () => {
    // ⚠️ THE INVERSION, AND IT IS THIS DELIVERY'S. This case used to say the opposite, in its own
    // title — *lands what the session says UNDER the emptiness, and takes it off the top* — and
    // the reason given was true of the design it described: the rows were lines of the flow and
    // the flow is written once, so a line could only land BELOW them, which pushed the whole page
    // up by one. What was named as the cost of that is what is gone: *an anchored page fills the
    // screen by construction, so the FIRST row the session says carries the box's top row into
    // the scrollback even though a third of the screen is empty*.
    //
    // WITH THE EMPTINESS IN THE REGION IT IS THE OTHER WAY ROUND, and it is better: a line lands
    // at the end of the FLOW, which is above the emptiness, and the leftover is one row shorter
    // on the next frame because the flow is one row longer. So the page fills downwards into the
    // room it had, and nothing goes into the scrollback until the room runs out
    // (`the-prompt-sits-at-the-foot.test.ts` reads the end where it has).
    const columns = 120;
    const rows = 40;
    const typed = 'verify';
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: typed, until: (bytes) => bytes.includes(`${PROMPT} ${typed}`), what: 'echoed' },
        // ABANDONED RATHER THAN RUN, because what this case needs is exactly ONE line landed:
        // the row being typed is landed as it stands and nothing answers it.
        { types: ABANDONS_THE_LINE, until: aFrameAfter(PROMPT), what: 'abandoned the line' },
        leaves,
      ],
    });
    const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const said = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    // THE LINE REALLY LANDED, and the page really had room to spare when it opened.
    expect(said.text, 'the abandoned line never landed').toContain(`${PROMPT} ${typed}`);
    expect(theGapOn(opened, PROMPT), 'the page opened with nothing left over').toBeGreaterThan(0);
    // THE LINE IS ABOVE THE EMPTINESS, which is the direction now: it is the last row of the flow
    // and the flow is above the region the layout redraws.
    const landedOn = said.rows.findIndex((row) => row.includes(`${PROMPT} ${typed}`));
    const emptyFrom = said.rows.findIndex((row) => row.trim().length === 0);
    expect(landedOn, 'the line landed below the emptiness').toBeLessThan(emptyFrom);
    // AND THE EMPTINESS IS ONE ROW SHORTER, not one row higher: the row the session said came out
    // of the room the page had, so nothing was carried away for it.
    expect(theGapOn(said, PROMPT), 'the emptiness did not give the row up').toBe(
      theGapOn(opened, PROMPT) - 1,
    );
    expect(openingEndsOn(said), 'the page moved for a line it had room for').toBe(
      openingEndsOn(opened),
    );
    // And the input is where it was through all of it.
    endsAtTheFoot(opened, rows, 'the page that opened');
    endsAtTheFoot(said, rows, 'the page with a line on it');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The list takes the emptiness, and gives it back — as many times as a caller asks
// ---------------------------------------------------------------------------

describe('the list of words takes its room out of the emptiness', () => {
  it('⚠️ opens the list of words and shuts it, and the input comes back to the foot', async () => {
    // THE CASE THIS FILE IS FOR. The area is not one height: the palette is as many rows as
    // there are words to show, and it opens on a keystroke and shuts on the next one. Both
    // directions are answered by the leftover, which is drawn with it — so the region is one
    // height throughout and the terminal is never asked to scroll for a menu.
    const columns = 120;
    const rows = 40;
    const ran = await inPty({
      columns,
      rows,
      steps: [opens, opensTheListAndWaitsForIt, shutsTheList, leaves],
    });
    const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const listed = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const shut = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    // THE LIST REALLY OPENED AND REALLY SHUT, or the three screens are one screen read thrice.
    expect(listed.text, 'the list never opened').toContain(ONLY_THE_LIST_SAYS);
    expect(shut.text, 'the list is still open').not.toContain(ONLY_THE_LIST_SAYS);
    expect(opened.text, 'the list was open before a key was pressed').not.toContain(
      ONLY_THE_LIST_SAYS,
    );
    // AND ALL THREE END ON THE LAST ROW THE LAYOUT LEAVES — the one it grew into, and the one it
    // came back from, which is the half that was missing.
    endsAtTheFoot(opened, rows, 'the page that opened');
    endsAtTheFoot(listed, rows, 'the page with the list open');
    endsAtTheFoot(shut, rows, 'the page after the list was shut');
  }, 240_000);

  it('⚠️ fits a list too long for the room, and says how many it could not show', async () => {
    // ⚠️ THE ADVERSARIAL CASE OF THIS DELIVERY: a list that does not fit. The palette's budget is
    // what is left over UNDER THE FLOW (`repl/area.ts`, `AreaRequest.flow`) — it was what is left
    // over the row being typed, which is the residual the delivery after this one closed — and the
    // emptiness is what it grows into, so on a page with barely any room the list is CUT and the
    // question is whether the region still ends where the layout leaves it or whether the cut list
    // pushes past.
    //
    // A SHORT TERMINAL AND A WIDE ONE, chosen so the list really is cut: at ten rows there is room
    // for a handful of the words there are.
    const columns = 100;
    const rows = 10;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        opensTheListAndWaitsForTheCut,
        { ...leaves, types: `${ABANDONS_THE_LINE}${LEAVE}\r` },
      ],
    });
    const listed = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    // THE LIST WAS REALLY CUT, and it says so — the row that accounts for what had no room.
    expect(listed.text, 'the list was not cut, so nothing here is about a cut list').toMatch(
      SAYS_WHAT_IT_CUT,
    );
    // AND THE PAGE IS STILL A PAGE: the input on the last row the layout leaves, and nothing
    // drawn under it.
    endsAtTheFoot(listed, rows, 'the page with a cut list on it');
    // AND THE SCREEN IS AS TALL AS IT WAS, which is what a region that pushed past would cost.
    expect(listed.rows.length, 'the screen changed size').toBe(rows);
    // ⛔ AND THE LIBRARY DID NOT REACH FOR THE ERASE at the one geometry where the region is the
    // whole page but for a row.
    expect(ran.bytes, 'the cut list walked the region into the erase').not.toContain(
      ERASES_THE_HISTORY,
    );
  }, 240_000);

  // ⚠️ THREE SIZES, AND THE THIRD COLUMN WAS THE RESIDUAL — it is gone, and this is what it
  // said: *where the room is not enough the difference still comes off the screen and the box
  // still goes, because the palette is budgeted against the room over the PROMPT rather than
  // against the leftover; red the day the list is cut to the room*. That day is the delivery
  // this file now describes: the list is cut to what the page has left over UNDER THE FLOW
  // (`repl/area.ts`, `AreaRequest.flow`), so the two sizes that used to lose the drawing keep
  // it — measured, and the column really did go red before it went away.
  //
  // WHAT THE THREE SIZES ARE FOR IS UNCHANGED: the list wants twenty rows and one over them,
  // and what the page has to spare is twenty-three at a hundred and twenty by forty, EIGHT at a
  // hundred by thirty and TWO at eighty by twenty-four. So the same list is drawn whole, cut to
  // eight words, and cut to two — three regimes of one arithmetic, with the anchor and the
  // drawing asserted in all of them.
  //
  // ⚠️ AND THE THIRD COLUMN IS HOW MANY WORDS EACH OF THEM DRAWS, which is what the delivery
  // after this one may not move. A floor was put under the list so that a key pressed on a page
  // with NOTHING to spare still answers with a word (`repl/area.ts`, `roomForThePalette`), and
  // the whole safety of a floor is that it is not a reservation: where the page has room the
  // leftover is what it always was, so these numbers are the same on both sides of it —
  // measured, on the binary of each. A page that had room and now draws MORE is the floor having
  // become a floor for everybody, which is what this column would go red for.
  for (const [columns, rows, wordsDrawn] of [
    [120, 40, undefined],
    [100, 30, 8],
    [80, 24, 2],
  ] as const) {
    it(`⚠️ comes back to the foot through ten openings at ${columns}x${rows}`, async () => {
      // ⛔ THE DEFECT, AND IT IS THE WHOLE REASON THIS DELIVERY EXISTS. This case used to assert
      // the opposite and called it the price of the fix: *a list twenty rows tall pushes twenty
      // rows of the page into the scrollback when it opens, and the rows that come back when it
      // shuts are EMPTY ones, because the flow is written once and what went up cannot be pulled
      // down — so a caller who opens and shuts the list twice has spent the box*. It was true, and
      // it was measured on the binary: at every size the box was gone after the FIRST cycle and
      // never came back.
      //
      // WHAT WAS WRONG WITH THE TRADE is that the alternative it was weighed against was reemitting
      // the whole page on every keystroke (linear in what the session has said, about 33 ms over 200
      // lines, and it flickers). There is a third way and where there is room it costs nothing: the
      // rows the list needs come out of the EMPTINESS, which is redrawn with it, so the region's
      // height never changes and the terminal never scrolls.
      //
      // TEN CYCLES, because one is the defect and a fix that drifts by a row per cycle would pass a
      // case that asked for two. Every screen is asked, so the answer is a table rather than an end
      // state.
      const cycles = 10;
      const steps: Step[] = [opens];
      for (let round = 0; round < cycles; round += 1) {
        steps.push(opensTheListAndWaitsForIt, shutsTheList);
      }
      steps.push(leaves);
      const ran = await inPty({ columns, rows, steps });
      // EVERY ONE OF THEM, and the last step (the word that leaves) is left out of the walk: it
      // lands a line, which is the case above.
      for (const [step, at] of ran.at.slice(0, -1).entries()) {
        const screen = screenOf(ran.bytes.slice(0, at), columns, rows);
        const what = step === 0 ? 'the page that opened' : `cycle ${Math.ceil(step / 2)}`;
        const open = step > 0 && step % 2 === 1;
        // THE LIST REALLY IS OPEN ON THE ODD STEPS AND SHUT ON THE EVEN ONES, or the walk below is
        // one screen read twenty-one times. This is what makes the geometry a measurement.
        expect(screen.text, `${what}: the list was ${open ? 'not open' : 'open'}`).toSatisfy(
          (text: string) => text.includes(ONLY_THE_LIST_SAYS) === open,
        );
        // ⛔ THE ANCHOR, AT EVERY SIZE AND IN BOTH STATES. This is what the first fix of this
        // frontier bought and what this one may not cost: measured before the flow on the SCREEN
        // was followed, a list opened and shut left the input FOURTEEN rows above the foot at a
        // hundred by thirty and SEVENTEEN at eighty by twenty-four — because the leftover was
        // worked out from a flow whose top the terminal had already scrolled away.
        endsAtTheFoot(screen, rows, `${columns}x${rows} ${what}`);
        // AND THE SCREEN IS AS TALL AS IT WAS.
        expect(screen.rows.length, `${what}: the screen changed size`).toBe(rows);
        // AND THE EMPTINESS IS ONE RUN AND IT IS WHERE IT WAS: everything above the input with
        // nothing on it is the run that touches the area. With the list open the palette's own
        // blank row is part of that run, which is the area's (`repl/area.ts`).
        expect(emptyRowsAbove(screen), `${what}: the emptiness is in two places`).toBe(
          theGapOn(screen, PROMPT),
        );
        // THE BOX IS ON THE FIRST ROW — the defect, and the promise. Not merely present: the top
        // edge is the row that goes first when a page is pushed up, so the row it is on is the
        // measurement. ⚠️ AND IT WAS ASKED AT ONE SIZE OF THE THREE, because at the other two the
        // list took the rows off the top of the page; it is asked at all three now.
        expect(openingBeginsOn(screen, columns), `${what}: the mark is not on the first row`).toBe(
          0,
        );
        expect(firstDrawnRow(screen), `${what}: something is above the opening`).toBe(0);
      }
      // AND THE ROOM REALLY DID MOVE, which is what says the cycles were not a screen that never
      // changed: with the list open there are a handful of rows over the input, with it shut there
      // are more.
      const shut = screenOf(ran.bytes.slice(0, ran.at[cycles * 2] as number), columns, rows);
      const listed = screenOf(ran.bytes.slice(0, ran.at[cycles * 2 - 1] as number), columns, rows);
      expect(theGapOn(listed, PROMPT), 'the list took no room at all').toBeLessThan(
        theGapOn(shut, PROMPT),
      );
      // AND THE PAGE OPENED WITH ITS MARK, so the walk above is about a drawing that was there to
      // lose rather than about one that never arrived.
      expect(
        openingBeginsOn(screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows), columns),
        'the page opened without its mark',
      ).toBe(0);
      // THE FIRST ROW AND NOT THE LAST ONE, which is what "the opening went" means: a page pushed
      // up by a list keeps the opening's LAST rows on the screen — measured at a hundred by
      // thirty, the sentence under the panel was on row 2 while the top of the drawing was in the
      // scrollback. A case that asked whether the opening was gone ALTOGETHER would be asserting
      // something else and would pass on a frame with half a drawing on it. So after twenty
      // openings the row is still the FIRST one.
      expect(openingBeginsOn(shut, columns), 'the opening did not survive').toBe(0);
      // AND THE LIST REALLY WAS CUT AT THE TWO SIZES WITHOUT THE ROOM FOR IT, or "the drawing
      // stayed" is a page where nothing was ever asked of the room. Read off the screen with the
      // list OPEN: the row that accounts for what had no room is there at eighty by twenty-four
      // and at a hundred by thirty, and absent at a hundred and twenty by forty, where the whole
      // list fits.
      expect(SAYS_WHAT_IT_CUT.test(listed.text), `${columns}x${rows}: the list was cut`).toBe(
        rows < 40,
      );
      // ⚠️ AND IT DRAWS THE SAME WORDS IT DREW BEFORE THERE WAS A FLOOR UNDER IT, which is the
      // half a floor is dangerous for: a floor that had become a RESERVATION would show here as
      // one of these numbers going UP, on a page that never needed one.
      expect(
        wordsOfTheListOn(listed),
        `${columns}x${rows}: the list drew a different number of words`,
      ).toBe(wordsDrawn);
    }, 240_000);
  }
});

// ---------------------------------------------------------------------------
// ⛔ And the region the layout redraws is short of the screen, whatever it holds
// ---------------------------------------------------------------------------

/**
 * WHAT THE LAYOUT WRITES TO TAKE BACK A ROW IT REDREW: erase the row it is on, and move up.
 *
 * Counting the erases in one frame is how many rows the library thinks it owns — which is the
 * number this delivery MOVES, on purpose: the emptiness that puts the input at the foot is part
 * of what is redrawn now, so the count is the leftover and the area together, plus the row the
 * library writes under its own frame. Measured at a hundred columns: seven at twenty-four rows
 * and twenty-three at forty, against a leftover of one and seventeen.
 */
const TAKES_A_ROW_BACK = `${ESC}[2K`;

/** ⛔ The sequence that erases the caller's history. It is not ours to write. */
const ERASES_THE_HISTORY = `${ESC}[3J`;

/**
 * THE HEIGHT AT WHICH THE LAYOUT STOPS REDRAWING PART OF THE PAGE — measured, and measured
 * again here because this delivery is the one that could have moved it.
 *
 * One row, at a width with room for the hint on a single row: the region is then the row
 * being typed and the hint under it, and a viewport of one row is shorter than that. Two rows
 * is the first height at which the library redraws the rows it owns and nothing else, which
 * is what makes this a bracket rather than a number.
 */
const TOO_SHORT_TO_REDRAW_IN_PART = 1;

/** The width the number above was taken at: one with room for the hint on a single row. */
const WIDE_ENOUGH_FOR_THE_HINT = 100;

describe('the region redrawn holds the emptiness, and is still short of the screen', () => {
  it('⚠️ redraws MORE rows on a tall terminal, and exactly the rows it has to spare', async () => {
    // ⚠️ THE GUARD THAT WAS INVERTED, and it was the one the delivery before this one rested on:
    // *redraws the same number of rows on a tall terminal as on a short one* — because the rows a
    // taller terminal spends were rows of the FLOW, so the region was the input area and nothing
    // else. It is false now and it is false on purpose. The rows are the region's, so a terminal
    // with more to spare has a TALLER region, which is the whole mechanism: those are the rows a
    // list of words grows into instead of pushing the page off the screen.
    //
    // WHAT REPLACES THE OLD GUARD IS THE ARITHMETIC OF THE DIFFERENCE, which is stronger than the
    // equality was: the region grows by exactly the emptiness the page gained and by nothing else
    // — the area is the same arrangement at both heights — so the count and the screen are two
    // instruments answering the same number. And the count stays SHORT of the height it was drawn
    // at, which is the condition the erase hangs on (bracketed in the case below, and asserted
    // over every size in `the gap is what the flow does not fill`).
    const columns = WIDE_ENOUGH_FOR_THE_HINT;
    const typed = 'v';
    const redrawn = new Map<number, number>();
    const leftOver = new Map<number, number>();
    const short = 24;
    const tall = 40;
    for (const rows of [short, tall]) {
      const ran = await inPty({
        columns,
        rows,
        steps: [
          opens,
          { types: typed, until: (bytes) => bytes.includes(`${PROMPT} ${typed}`), what: 'echoed' },
          // AND THE ROW IS ABANDONED BEFORE THE WORD THAT LEAVES, because there is a keystroke
          // on it: the word that leaves is typed INTO the row, and `v/exit` is not a word.
          { ...leaves, types: `${ABANDONS_THE_LINE}${LEAVE}\r` },
        ],
      });
      const frame = ran.bytes.slice(ran.at[0] as number, ran.at[1] as number);
      redrawn.set(rows, times(frame, TAKES_A_ROW_BACK));
      leftOver.set(
        rows,
        theGapOn(screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows), PROMPT),
      );
    }
    // THE PROMISE: what the taller terminal redraws is what the shorter one redraws plus the rows
    // it had over — the emptiness, read off the SCREEN, against the erases, read off the BYTES.
    expect(
      (redrawn.get(tall) ?? 0) - (redrawn.get(short) ?? 0),
      'the region grew by something other than the room the page gained',
    ).toBe((leftOver.get(tall) ?? 0) - (leftOver.get(short) ?? 0));
    // NOT VACUOUS IN EITHER DIRECTION. There really is a redraw to count, the two terminals really
    // were left with different amounts over, and the difference is the sixteen rows between them.
    expect(redrawn.get(short) ?? 0, 'nothing was redrawn at all').toBeGreaterThan(1);
    expect((leftOver.get(tall) ?? 0) - (leftOver.get(short) ?? 0), 'the room did not grow').toBe(
      tall - short,
    );
    // ⛔ AND NEITHER REGION IS AS TALL AS THE SCREEN IT WAS DRAWN ON, which is the condition under
    // which this library redraws the whole page and erases the caller's history on the way.
    for (const rows of [short, tall]) {
      expect(redrawn.get(rows) ?? 0, `${rows}: the region is as tall as the screen`).toBeLessThan(
        rows,
      );
    }
  }, 240_000);

  it('⚠️ leaves the erase where it was: absent at two rows, and the library’s own at one', async () => {
    // THE BOUNDARY, BRACKETED, and it is the LIBRARY'S rather than this product's: on a
    // terminal shorter than the region it redraws, the layout redraws the whole screen and
    // the sequence it uses for that carries, inside it, the one this product refuses to
    // write. Nothing of ours writes it (guarded over the source in `the-console-on-ink.test.ts`).
    // Pinned in BOTH directions so the rows with nothing on them cannot have moved it: one row
    // more than the boundary and the erase is gone, and at the boundary it is still there.
    const short = await inPty({
      columns: WIDE_ENOUGH_FOR_THE_HINT,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [opens, leaves],
    });
    expect(short.bytes, 'the library no longer erases the history at the boundary').toContain(
      ERASES_THE_HISTORY,
    );
    const over = await inPty({
      columns: WIDE_ENOUGH_FOR_THE_HINT,
      rows: TOO_SHORT_TO_REDRAW_IN_PART + 1,
      steps: [opens, leaves],
    });
    expect(over.bytes, 'one row over the boundary saw the erase').not.toContain(ERASES_THE_HISTORY);
    // Both sessions really opened, so the difference between them is the height alone.
    for (const ran of [short, over]) expect(ran.bytes).toContain(PROMPT);
  }, 240_000);

  it('⛔ leaves it absent with the LIST OPEN, which is the region at its tallest', async () => {
    // ⛔ THE RISK OF THIS DELIVERY, MEASURED BEFORE IT WAS WRITTEN. The region is the emptiness
    // and the area, so it comes within one row of the screen when the flow is short — and a list
    // of words open is the area at its tallest ON TOP of that, which is the geometry where the
    // library would reach for the erase if the arithmetic were one out anywhere.
    //
    // TWO WIDTHS, because the width decides what the area draws: at sixty columns the hint does
    // not fit on one row and the palette's rows are cut, which is the geometry the study that
    // designed this console recorded the erase appearing at with ONE row of slack.
    //
    // AND THE HEIGHTS GO DOWN TO THE FLOOR, so the sweep passes through every arrangement: the
    // full form, the form without the badge, and the bare one that is answered whatever the
    // height. What a person uses is at the other end of the same sweep.
    for (const columns of [60, WIDE_ENOUGH_FOR_THE_HINT]) {
      for (const rows of [TOO_SHORT_TO_REDRAW_IN_PART + 1, 3, 5, 8, 24, 40]) {
        const ran = await inPty({
          columns,
          rows,
          steps: [
            opens,
            opensTheList,
            shutsTheList,
            opensTheList,
            // THE ROW IS ABANDONED BEFORE THE WORD THAT LEAVES: the list was opened by a slash
            // typed INTO the row, and `//exit` is not a word — a session that never leaves is a
            // case that times out instead of failing.
            { ...leaves, types: `${ABANDONS_THE_LINE}${LEAVE}\r` },
          ],
        });
        const at = `${columns}x${rows}`;
        expect(ran.bytes, `${at}: the library erased the caller's history`).not.toContain(
          ERASES_THE_HISTORY,
        );
        // AND EVERY ONE OF THEM REALLY RAN, or the absence above is the absence of a session.
        expect(ran.bytes, `${at}: the session never opened`).toContain(PROMPT);
      }
    }
    // AND THE LIST REALLY IS DRAWN at a height where there is room for it, which is what makes
    // the sweep about a region with a palette in it rather than about a bare prompt.
    const tall = await inPty({
      columns: WIDE_ENOUGH_FOR_THE_HINT,
      rows: 40,
      steps: [
        opens,
        opensTheListAndWaitsForIt,
        { ...leaves, types: `${ABANDONS_THE_LINE}${LEAVE}\r` },
      ],
    });
    expect(
      screenOf(tall.bytes.slice(0, tall.at[1] as number), WIDE_ENOUGH_FOR_THE_HINT, 40).text,
      'the list was never drawn, so nothing above was measured with one open',
    ).toContain(ONLY_THE_LIST_SAYS);
  }, 240_000);

  it('puts the caret on the row being typed, wherever on the screen that row is', async () => {
    // WHAT THE ANCHOR MAY NOT COST. The caret is placed at an offset INTO the region the
    // layout redraws (`repl/area.ts`, `above`), and the region is as far down the screen as the
    // flow and its leftover reach — so a caret placed against the top of the page rather than
    // against the region would be off by exactly that many rows.
    const columns = WIDE_ENOUGH_FOR_THE_HINT;
    const rows = 40;
    const ran = await inPty({ columns, rows, steps: [opens, leaves] });
    const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    expect(screen.cursor.row, 'the caret is not on the row being typed').toBe(
      promptRow(screen, PROMPT),
    );
    // Not vacuous: the row being typed is a long way down a page whose emptiness is a long run,
    // so a caret left at the top of the page or at the end of the frame would be somewhere else.
    expect(promptRow(screen, PROMPT)).toBeGreaterThan(firstDrawnRow(screen));
    expect(theGapOn(screen, PROMPT)).toBeGreaterThan(0);
    // And the version really was drawn, so the page is the whole page. ⚠️ IT ASKED FOR IT ON ROW
    // ZERO, and row zero was the box's top border, which the version was on. It is beside the mark
    // now, so the row it is on is the mark's height away from the top.
    expect(screen.rows.slice(0, promptRow(screen, PROMPT)).join('\n')).toContain(`v${VERSION}`);
  }, 240_000);
});
