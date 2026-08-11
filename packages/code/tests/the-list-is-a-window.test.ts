/**
 * THE LIST IS A WINDOW, AND THE WINDOW FOLLOWS THE CHOICE — the two halves of one residual,
 * measured on the merged binary before either was written.
 *
 * THE FIRST HALF IS WHAT THE LIST IS CUT TO. The emptiness between the flow and the input is
 * what the area grows into, so a menu that opens and shuts costs the page nothing
 * (`the-gap-goes-under-the-box.test.ts`) — but the list was budgeted against the SCREEN and
 * not against that emptiness, so wherever the two differed the difference came off the top of
 * the caller's own page. Measured, at a hundred by thirty and at eighty by twenty-four: ONE
 * opening of the list and the drawing of the name was gone, and shutting it brought back empty
 * rows rather than the drawing, because nothing un-scrolls. So the room the palette gets is
 * counted under the flow now (`repl/area.ts`, `AreaRequest.flow`), and what it cannot show it
 * says.
 *
 * THE SECOND HALF IS WHERE THE MARK GOES WHEN THE LIST IS CUT. The arrows walk the whole
 * vocabulary and the drawing showed the FIRST offers, so the pick left the drawn rows and
 * never came back: measured at a hundred and twenty by sixteen, where the eleventh Down left
 * the screen with no marked row at all while Return went on taking a word nobody could see.
 * What is drawn is a WINDOW over the offers now, it holds the pick, and it is DERIVED on every
 * frame from the offers, the room and the picked word (`repl/palette.ts`, `theWindow`) — so
 * there is nothing between two frames that could name a different offer on the second.
 *
 * WHAT IS ASKED HERE, and the first three are asked of pure functions because they are
 * statements about every size and every list rather than about one screen:
 *
 *   - THE BUDGET IS THE PAGE. One row less of list per row of flow, down to none — and at a
 *     flow of nothing, every number the area gave before this field existed.
 *   - THE PAGE IS NEVER PUSHED, over a grid of heights, widths, lists and flows: with a list
 *     open, the flow, the emptiness, the area and the row the library keeps fit the screen.
 *     The two branches are stated together, so neither can go unasserted.
 *   - THE WINDOW HOLDS THE PICK, at every room and every position of it, and everything that is
 *     not drawn is counted in ONE number that a reader can check by adding up what they see.
 *   - AND THEN THE SCREEN: the mark still on the page after eleven arrows on a cut list, and
 *     the list on the page as long as the arithmetic says it is — the ELO for the number the
 *     console hands over, which nothing else can see (`repl/console.ts`, `onScreen`).
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVEL_REQUIREMENTS, requiredLevel } from '@mnema/chain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import type { CompletionWord } from '../src/completion/tree.js';
import { completionTree } from '../src/completion/tree.js';
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { type Area, type AreaRequest, areaFor, BELOW_THE_VIEWPORT } from '../src/repl/area.js';
import { verbsOffered } from '../src/repl/gate.js';
import { theGap } from '../src/repl/page.js';
import {
  CUT,
  NOBODY,
  PICK,
  paletteFor,
  paletteRowsFor,
  theNextPicked,
  theWindow,
} from '../src/repl/palette.js';
import { badgeLine, pickingTips, theSessionsOwnWords, tips } from '../src/repl/session.js';
import { LEAVE, PREFIX } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import {
  arrivedSince,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { endsAtTheFoot, type Screen, screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** How wide the row of affordances under the input is, as the session composes it. */
const HINT = widthOf(tips());

/** How wide the badge is, for a record that proved the most it can. */
const BADGE = widthOf(badgeLine('fully-signed'));

/**
 * WIDTHS A BADGE REALLY IS, and none at all for a session with no record to name a level of.
 *
 * Composed out of the levels a caller can DEMAND rather than written down, for the reason the
 * amarra about fixtures gives: a width nothing can produce would make the grids below assert
 * the geometry of a console that cannot exist.
 */
const BADGES = [
  0,
  ...LEVEL_REQUIREMENTS.map((requirement) => widthOf(badgeLine(requiredLevel(requirement)))),
];

/** A request with everything to show, so a case only says what it is changing. */
const showingEverything = { columns: 200, badge: BADGE, hint: HINT, palette: 0, flow: 0 };

// ---------------------------------------------------------------------------
// The budget: what the PAGE has left over, and not what the screen has
// ---------------------------------------------------------------------------

describe('the list of words is cut to what the page has left over', () => {
  it('gives up one row of list per row of flow, down to none', () => {
    const wanted = 20;
    const rows = 30;
    const roomAt = (flow: number): number =>
      areaFor({ ...showingEverything, rows, palette: wanted, flow }).palette;
    // THE WHOLE MECHANISM, AS ARITHMETIC. What is left over is the height, less the row the
    // library keeps, less the flow, less the floor of the area, less the blank row over the
    // list — so a page with more on it has less list, one for one, and nothing else moves.
    const floor = 1 + 1;
    const overTheFloor = rows - BELOW_THE_VIEWPORT - floor - 1;
    expect(roomAt(0), 'a page with nothing on it does not get the whole leftover').toBe(
      Math.min(wanted, overTheFloor),
    );
    for (const flow of [1, 5, 12]) {
      expect(roomAt(flow), `${flow}`).toBe(Math.min(wanted, overTheFloor - flow));
    }
    // AND IT REACHES NOTHING RATHER THAN GOING NEGATIVE: a page whose flow has taken the room
    // gets no palette, which is the same absence a window too narrow for a row gets.
    expect(roomAt(overTheFloor)).toBe(0);
    expect(roomAt(rows + 100)).toBe(0);
    // Not vacuous: the flows above really do span the whole ladder, from the list it wants to
    // none of it.
    expect(roomAt(0)).toBeGreaterThan(roomAt(12));
    expect(roomAt(12)).toBeGreaterThan(0);
  });

  it('answers at a flow of nothing exactly what it answered before there was a flow', () => {
    // ⚠️ THE FIELD IS ADDITIVE, AND THIS IS WHAT SAYS SO. Every number the rest of this suite
    // pins was measured on a page with nothing on it, and the new subtraction has the old one
    // inside it: `rows − 1 − 0 − floor − 1`. A case that only asserted the new behaviour would
    // leave "did the old arithmetic move" unasked, which is where a delivery like this one
    // breaks something nobody was looking at.
    const wanted = 20;
    for (const rows of [4, 5, 8, 10, 24, 30, 40]) {
      const area = areaFor({ ...showingEverything, columns: 100, rows, palette: wanted });
      expect(area.palette, `${rows}`).toBe(
        Math.max(0, Math.min(wanted, rows - BELOW_THE_VIEWPORT - 1 - 1 - 1)),
      );
    }
  });

  it('⛔ never lets the list push the page, at any size and any flow', () => {
    // ⛔ THE GUARD THIS DELIVERY EXISTS FOR, and it is a COMPOSITION rather than a property of
    // either function: the area is budgeted against the page and the emptiness is the rest of
    // the same subtraction (`repl/page.ts`), so the flow, the emptiness, the area and the row
    // the library keeps fit on the screen — which is what "nothing scrolled" means, and
    // scrolling is the one thing that cannot be undone.
    //
    // TWO BRANCHES, STATED TOGETHER. Where the page has room over the area's floor the list
    // takes some of it and everything fits; where it has none the list takes NOTHING, and the
    // frame is the one the page would have had with the list shut. A case that asserted only
    // the first would pass on an area that quietly refused to open a list at all.
    let held = 0;
    let tookNothing = 0;
    for (const rows of [2, 3, 4, 5, 6, 8, 10, 24, 30, 40, 120]) {
      for (const columns of [20, 60, 100, 200]) {
        for (const badge of BADGES) {
          for (const palette of [1, 7, 21, 80]) {
            for (const flow of [0, 1, 5, 14, 200]) {
              const request: AreaRequest = { rows, columns, badge, hint: HINT, palette, flow };
              const area = areaFor(request);
              const at = `${columns}x${rows} flow ${flow} palette ${palette} badge ${badge}`;
              if (area.palette > 0) {
                expect(
                  flow + theGap({ rows, flow, area: area.height }) + area.height,
                  at,
                ).toBeLessThanOrEqual(rows - BELOW_THE_VIEWPORT);
                held += 1;
              } else {
                // THE LIST TOOK NOTHING, so the frame is the frame the page already had — the
                // same arrangement, the same height, the same caret.
                expect(area, at).toEqual(areaFor({ ...request, palette: 0 }));
                tookNothing += 1;
              }
            }
          }
        }
      }
    }
    // NOT VACUOUS IN EITHER DIRECTION: the grid really holds pages with room to spare and
    // pages with none, so neither branch is the branch nobody took.
    expect(held, 'no size in the grid had room for a list at all').toBeGreaterThan(100);
    expect(tookNothing, 'every size in the grid had room for a list').toBeGreaterThan(10);
  });

  it('gives the list the chrome, so a key on a full page still draws something', () => {
    // WHAT A PAGE WITH NOTHING TO SPARE STILL ANSWERS WITH, and it is the one thing that keeps
    // a key from looking broken. The badge and the two rules are the AREA's rather than its
    // floor, so a list has them to take even when the flow has taken everything else — the
    // trade this area has always made, *the palette is served before the chrome*, and what is
    // measured here is what that trade is worth on a page that is full.
    //
    // THE FLOW IS THE MOST A FRAME COULD HAVE LEFT, which is what makes this a full page rather
    // than an arbitrary number: the console follows what the frame left room for
    // (`repl/console.ts`, `whatTheFrameLeft`), so the flow is never longer than the screen less
    // the row the library keeps and less the area that was drawn.
    const floor = 1 + 1;
    for (const rows of [10, 24, 30, 40]) {
      const at = { ...showingEverything, columns: 100, rows };
      const shut = areaFor(at);
      const spent = rows - BELOW_THE_VIEWPORT - shut.height;
      const open = areaFor({ ...at, palette: 21, flow: spent });
      // The page really is full: there is no emptiness left under the flow.
      expect(theGap({ rows, flow: spent, area: shut.height }), `${rows}`).toBe(0);
      // AND THE LIST GETS WHAT THE CHROME GAVE UP, less its own blank row — which is two rows
      // at every height: the account of what had no room, and the row of keys under it.
      expect(open.palette, `${rows}`).toBe(shut.height - floor - 1);
      expect(open.palette, `${rows}: a full page answered with no list at all`).toBeGreaterThan(0);
      expect(open.form, `${rows}`).toBe('bare');
      expect(shut.form, `${rows}`).toBe('full');
      // ⛔ AND THE PAGE STILL DID NOT MOVE, which is what says the rows came from the chrome
      // rather than from the top of the caller's screen.
      expect(
        spent + theGap({ rows, flow: spent, area: open.height }) + open.height,
        `${rows}`,
      ).toBe(rows - BELOW_THE_VIEWPORT);
    }
  });
});

// ---------------------------------------------------------------------------
// The window: which offers are drawn, and where the pick is in them
// ---------------------------------------------------------------------------

/**
 * Every word a Tab offers on an empty row, out of the same program a session builds.
 *
 * Read rather than listed, so the cases below are about however many verbs this product has
 * today: the reads it runs, and the words it answers to itself.
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

describe('what is drawn is a window over the offers, and it holds the pick', () => {
  const offers = everythingOffered();
  const words = offers.map((offer) => offer.word);

  it('holds the pick at every room and every position it can be in', () => {
    // THE ADVERSARIAL QUESTION, ASKED OVER A GRID. "Can a caller reach an offer the window
    // never draws" is not a question one case can answer: it is a property of every pair of a
    // room and a picked word, including the first offer, the last, and the rooms with space
    // for a single row.
    let cut = 0;
    let whole = 0;
    for (const room of [0, 1, 2, 3, 4, 8, offers.length, offers.length + 4]) {
      for (const [at, word] of words.entries()) {
        const window = theWindow(offers, room, word);
        const where = `room ${room}, picked ${word}`;
        // THE WINDOW IS CONTIGUOUS AND IT IS IN ORDER, which is what makes it a window rather
        // than a selection: it is a run of the offers as they were given.
        const from = offers.indexOf(window[0] as CompletionWord);
        if (window.length > 0) {
          expect(window, where).toEqual(offers.slice(from, from + window.length));
        }
        if (window.length === offers.length) {
          whole += 1;
          continue;
        }
        cut += 1;
        // A CUT LIST DRAWS THE PICK, at every room with space for a word at all. Where there
        // is space for none — a room of one or two is the account of what had no room, and the
        // keys — there is nothing to hold it, and that is the same absence a shut palette is.
        if (window.length === 0) continue;
        expect(
          window.map((offer) => offer.word),
          where,
        ).toContain(word);
        // AND IT IS THE LEAST IT CAN BE: the window begins at the first offer until the pick
        // would fall past its last row, and from then on it ENDS on the pick. So a list nobody
        // has moved through shows what it always showed, and one step of an arrow moves the
        // window by one row rather than by a page.
        expect(from, where).toBe(Math.max(0, at - window.length + 1));
      }
    }
    // NOT VACUOUS IN EITHER DIRECTION: the grid really holds rooms that cut the list and rooms
    // that do not.
    expect(cut, 'no room in the grid cut the list').toBeGreaterThan(10);
    expect(whole, 'no room in the grid held the whole list').toBeGreaterThan(10);
  });

  it('draws nothing of its own and everything of the offers, over the rooms and the picks', () => {
    // ⛔ THE PROPERTY THE WHOLE PALETTE RESTS ON, asked again with a window in it: how many
    // rows come back is exactly what the area budgeted, and what is drawn plus what the count
    // names is everything there was. A window is where that could have broken — it is the one
    // change that moves WHICH rows are drawn without moving how many.
    const columns = 160;
    for (const room of [0, 1, 2, 3, 5, 9, offers.length, offers.length + 4]) {
      for (const picked of [NOBODY, words[0], words[4], words.at(-1)] as readonly string[]) {
        const rows = paletteFor({
          offers,
          room,
          columns,
          render: renderPlain,
          picked,
          picking: pickingTips(),
        });
        const where = `room ${room}, picked ${picked || 'nobody'}`;
        expect(rows.length, where).toBe(Math.min(paletteRowsFor(offers), room));
        if (rows.length === 0) continue;
        const listed = rows.filter((row) => row !== renderPlain(pickingTips()));
        const said = listed.find((row) => row.includes(CUT) && /\d/.test(row));
        const missing = said === undefined ? 0 : Number(/(\d+)/.exec(said)?.[1]);
        const shown = said === undefined ? listed.length : listed.length - 1;
        // ONE COUNT AND NOT TWO. What is not drawn is not drawn, whether the window left it
        // above or below — a reader checks the number by adding up what they can see, and two
        // numbers would be two claims to check instead of one.
        expect(shown + missing, `${where}: ${rows.length} rows`).toBe(offers.length);
        // AND THE PICK IS MARKED WHENEVER THERE IS A ROW TO MARK, which is the pair of the
        // property above: a window that held the pick and a drawing that did not mark it would
        // be the same defect with an extra step.
        if (picked === NOBODY || shown === 0) continue;
        expect(
          rows.filter((row) => row.trimStart().startsWith(PICK)),
          `${where}: the marked row`,
        ).toHaveLength(1);
      }
    }
  });

  it('reaches every offer, walking the list the way the arrows walk it', () => {
    // THE QUESTION A PROPERTY CANNOT ANSWER BY ITSELF: the window holds whatever is PICKED, but
    // can a caller pick everything? The arrows are what say so, so the walk here is the arrows'
    // own function (`repl/palette.ts`, `theNextPicked`) rather than a loop over indexes — and
    // what it proves is that a list cut to three rows is still a list a caller can reach the
    // end of.
    const room = 4;
    const drawn = new Set<string>();
    let picked = NOBODY;
    for (let step = 0; step < offers.length + 2; step += 1) {
      picked = theNextPicked(offers, picked, 1);
      for (const offer of theWindow(offers, room, picked)) drawn.add(offer.word);
    }
    expect([...drawn].sort(), 'an offer no walk of the arrows can draw').toEqual([...words].sort());
    // Not vacuous: the window at this room really is a fraction of the list, so the set above
    // was built by MOVING rather than by one drawing that had everything in it.
    expect(theWindow(offers, room, NOBODY).length).toBeLessThan(offers.length);
    expect(theWindow(offers, room, NOBODY).length).toBeGreaterThan(0);
  });

  it('keeps the columns where they are as the window moves', () => {
    // WHAT A SCROLL MAY NOT COST. The left column is as wide as the widest word in the whole
    // palette rather than in the window (`repl/palette.ts`), so the table does not shuffle
    // sideways as a caller arrows down it — which is what a column measured over the drawn
    // rows would do on every step.
    const columns = 160;
    const room = 6;
    const rowsAt = (picked: string): readonly string[] =>
      paletteFor({ offers, room, columns, render: renderPlain, picked, picking: pickingTips() });
    /** Which column what each drawn offer SAYS begins in, for the window a pick produces. */
    const startsAt = (picked: string): readonly number[] => {
      const drawn = theWindow(offers, room, picked);
      const rows = rowsAt(picked);
      return drawn.map((offer, at) => (rows[at] as string).indexOf(offer.description));
    };
    const first = startsAt(words[0] as string);
    const later = startsAt(words.at(-1) as string);
    expect(new Set([...first, ...later]).size, `the column moved: ${[...first, ...later]}`).toBe(1);
    // Not vacuous: the two windows really are different offers, and both really drew some.
    expect(theWindow(offers, room, words[0] as string)).not.toEqual(
      theWindow(offers, room, words.at(-1) as string),
    );
    expect(first.length).toBeGreaterThan(0);
  });
});

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
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-window-'));
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

/** The key a terminal sends for a step down the list. */
const MOVES_DOWN = '\u001b[B';

/** The row of a screen the mark is on, and nothing when no row carries one. */
function markedOn(screen: Screen): string | undefined {
  return screen.rows.find((row) => row.trimStart().startsWith(PICK));
}

/** The word on the marked row — the first column after the mark. */
function pickedOn(screen: Screen): string | undefined {
  const row = markedOn(screen);
  return row
    ?.trimStart()
    .slice(PICK.length)
    .trim()
    .split(/\s{2,}/)[0];
}

/** Every row of a screen that names one of these words, mark or no mark. */
function rowsNaming(screen: Screen, words: readonly string[]): readonly string[] {
  return screen.rows.filter((row) => {
    const shown = row.trimStart();
    const said = shown.startsWith(PICK) ? shown.slice(PICK.length).trimStart() : shown;
    return words.some((word) => said === word || said.startsWith(`${word} `));
  });
}

// ---------------------------------------------------------------------------
// On a real device: the mark stays on the page, and the page pays for nothing
// ---------------------------------------------------------------------------

describe('the mark stays on the screen however far down a cut list it goes', () => {
  it('⚠️ marks the eleventh word of a list that only draws eight', async () => {
    // ⛔ THE SECOND DEFECT OF THIS DELIVERY, ON THE DEVICE IT WAS MEASURED ON. The list at a
    // hundred by thirty is CUT — the page has eight rows to spare and the vocabulary is longer
    // than that — and the arrows walk the whole vocabulary, so before the window existed the
    // ninth Down put the pick on a word no row drew: the screen had NO marked row on it, and
    // Return went on taking a word the caller could not see.
    //
    // ELEVEN ARROWS IN ONE KEYSTROKE, because what is under test is where the eleventh lands
    // rather than the ten before it: a paste of eleven arrows is eleven keystrokes to the
    // console (`repl/editing.ts`, `keystrokesOf`), and the step waits for the mark to arrive on
    // the word the eleventh one names.
    const columns = 100;
    const rows = 30;
    const offers = everythingOffered();
    const steps = 11;
    const eleventh = offers[steps - 1]?.word as string;
    const first = offers[0]?.word as string;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: PREFIX, until: arrivedSince(first), what: 'listed the words' },
        {
          types: MOVES_DOWN.repeat(steps),
          until: arrivedSince(`${PICK}  ${eleventh}`),
          what: 'walked eleven rows down the list',
        },
        { ...leaves, types: `${ABANDONS_THE_LINE}${LEAVE}\r` },
      ],
    });
    const listed = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const walked = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    // THE LIST REALLY IS CUT, or nothing here is about a window: what is drawn is fewer rows
    // than there are offers, and the row that accounts for the rest says so.
    const drawn = rowsNaming(
      listed,
      offers.map((offer) => offer.word),
    );
    expect(drawn.length, 'the list was not cut at all').toBeLessThan(offers.length);
    expect(drawn.length, 'the list drew nothing').toBeGreaterThan(0);
    expect(
      steps,
      'eleven arrows land inside the drawn rows, so nothing is under test',
    ).toBeGreaterThan(drawn.length);
    // ⛔ AND THE MARK IS ON THE PAGE, on the word the eleventh arrow names.
    expect(markedOn(walked), 'no row on the screen carries the mark').toBeDefined();
    expect(pickedOn(walked), 'the mark is on the wrong word').toBe(eleventh);
    // AND THE WINDOW REALLY MOVED: the first offer was drawn when the list opened and is not
    // drawn now, which is what says the rows follow the pick rather than being the first of
    // them forever.
    expect(rowsNaming(listed, [first]), 'the list opened without its first word').toHaveLength(1);
    expect(rowsNaming(walked, [first]), 'the window did not move at all').toHaveLength(0);
    // AND THE PAGE PAID NOTHING FOR ANY OF IT: the input is still on the last row the layout
    // leaves, and the count still adds up to every word there is.
    endsAtTheFoot(walked, rows, 'the page after eleven arrows');
    const said = walked.rows.find((row) => row.trimStart().startsWith(CUT));
    expect(said, `no row said how many had no room:\n${walked.text}`).toBeDefined();
    const missing = Number(/(\d+)/.exec(said as string)?.[1]);
    expect(
      rowsNaming(
        walked,
        offers.map((offer) => offer.word),
      ).length + missing,
      'what is shown plus what is named is not everything there was',
    ).toBe(offers.length);
  }, 240_000);

  it('⚠️ draws exactly as many rows as the arithmetic says the page has left', async () => {
    // A2 · THE ELO, AND IT IS THE ONE THING NO PURE CASE CAN SEE. The area is budgeted with a
    // number the console follows from frame to frame — how much of the flow is on the SCREEN
    // (`repl/console.ts`, `flowOnScreen`) — and a field that arrived as a zero, or as the flow
    // the session has SAID rather than the flow a reader can see, would leave every case above
    // green with the whole defect back. So the rows are counted on a real screen and compared
    // with what the arithmetic answers for the flow READ OFF THAT SAME SCREEN.
    //
    // NOTHING HERE IS WRITTEN DOWN: the flow is the rows above the emptiness, the offers are
    // the program's own, and the answer is `areaFor`'s.
    const columns = 100;
    const rows = 30;
    const offers = everythingOffered();
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: PREFIX, until: arrivedSince(offers[0]?.word as string), what: 'listed the words' },
        { ...leaves, types: `${ABANDONS_THE_LINE}${LEAVE}\r` },
      ],
    });
    const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const listed = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    // HOW MUCH OF THE FLOW IS ON THE SCREEN, read off the page that opened: the rows above the
    // emptiness that touches the area.
    const flow = flowOn(opened);
    expect(flow, 'the page that opened has no flow on it').toBeGreaterThan(0);
    expect(
      flow,
      'the flow is the whole screen, so there is nothing left over to measure',
    ).toBeLessThan(rows - 1);
    const said: Area = areaFor({
      rows,
      columns,
      badge: BADGE,
      hint: HINT,
      palette: paletteRowsFor(offers),
      flow,
    });
    // WHAT IS DRAWN, COUNTED ON THE SCREEN: the words, the row that accounts for the rest, and
    // the row of keys under them — which is exactly what the area budgeted.
    const drawn =
      rowsNaming(
        listed,
        offers.map((offer) => offer.word),
      ).length + 2;
    expect(drawn, `${said.palette} budgeted, ${drawn} drawn`).toBe(said.palette);
    // Not vacuous: the list really was cut, so the number is a measurement rather than the
    // whole vocabulary counted twice.
    expect(said.palette).toBeLessThan(paletteRowsFor(offers));
    expect(said.palette).toBeGreaterThan(2);
  }, 240_000);
});

/**
 * HOW MANY ROWS OF THE FLOW ARE ON A SCREEN — the rows above the emptiness that touches the
 * input area.
 *
 * IT IS THE SAME WALK THE EMPTINESS IS MEASURED BY (`support/screen.ts`, `theGapOn`), one leg
 * further: up from the row being typed through everything the area draws, then up through the
 * run of nothing, and what is left above is the flow. So the number a case compares against the
 * arithmetic is read off the PAGE rather than counted from a fixture — a page whose opening is
 * one row longer moves it, exactly as it moves the product's own.
 */
function flowOn(screen: Screen): number {
  const drawn = screen.rows.map((row) => row.trim().length > 0);
  let at = screen.rows.map((row) => row.includes(PROMPT)).lastIndexOf(true);
  while (at > 0 && drawn[at] === true) at -= 1;
  while (at >= 0 && drawn[at] === false) at -= 1;
  return at + 1;
}
