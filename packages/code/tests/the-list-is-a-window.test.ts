/**
 * THE LIST IS A WINDOW, AND THE WINDOW FOLLOWS THE CHOICE — the halves of one residual,
 * measured on the merged binary before any of them was written.
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
 * ⚠️ AND THE THIRD HALF IS THE PAGE THE FIRST TWO WERE NEVER MEASURED ON. Both were read off a
 * page that had just OPENED, where the emptiness is a long run and there is room to spare. The
 * page a session spends its life on has one ordinary verb printed on it and no room at all, and
 * there the list drew the account of what had no room and NOT ONE WORD — measured on the binary
 * of the delivery before this one, at a hundred and twenty by forty and by thirty after
 * `brief`, and by twenty after either verb: `… 19 not shown`, which is a console answering *what
 * can I type* with *nineteen things, none of them*. So the leftover is a PREFERENCE with a floor
 * of one word under it and the library's own limit over it (`repl/area.ts`,
 * `roomForThePalette`), and what the floor takes on a full page is the top of the FLOW, which is
 * in the caller's own scrollback one scroll away.
 *
 * WHAT IS ASKED HERE, and the pure ones are pure because they are statements about every size
 * and every list rather than about one screen:
 *
 *   - THE BUDGET IS THE PAGE. One row less of list per row of flow, down to ONE WORD — and at a
 *     flow of nothing, every number the area gave before this field existed. Nothing at all is
 *     still an answer, and it is the SCREEN's: a terminal with no room over the area's own floor
 *     has no palette, which is the absence a window too narrow for a row already gets.
 *   - THE REGION NEVER REACHES THE VIEWPORT AND A PAGE WITH ROOM IS NEVER CHARGED, over a grid
 *     of heights, widths, lists and flows. ⚠️ IT WAS ONE STATEMENT — *the flow, the emptiness,
 *     the area and the row the library keeps fit the screen* — and the floor falsified it in
 *     eleven hundred and eighty of the twenty-six hundred geometries the grid holds, ON PURPOSE:
 *     that is the trade, and what replaces it is the pair it comes apart into.
 *   - A TALLER TERMINAL NEVER DRAWS FEWER WORDS of the same page, which is the shape the ladder
 *     of heights had lost.
 *   - THE WINDOW HOLDS THE PICK, at every room and every position of it, and everything that is
 *     not drawn is counted in ONE number that a reader can check by adding up what they see.
 *   - AND THEN THE SCREEN: the mark still on the page after eleven arrows on a cut list, the
 *     list on the page as long as the arithmetic says it is — the ELO for the number the console
 *     hands over, which nothing else can see (`repl/console.ts`, `onScreen`) — and a word of the
 *     list on a page a session has really USED, which is the case the two halves above were
 *     never asked on.
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
  aFrameAfter,
  aFrameWithout,
  arrivedSince,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { endsAtTheFoot, type Screen, screenOf, theGapOn } from './support/screen.js';

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

/**
 * THE LEAST ROOM THE PALETTE DRAWS A WORD IN — asked of the palette rather than written down.
 *
 * It is three today, and what makes it three is the palette's own arrangement: the row that
 * accounts for what had no room and the row that says which keys move the list are both spent
 * before a word is (`repl/palette.ts`, `theWindow`). A case that spelled the number would be a
 * case that goes on passing the day the palette gains or loses a row of furniture, which is
 * exactly when the floor under the list stops being one word.
 */
function leastRoomForAWord(): number {
  const offers = everythingOffered();
  const room = [0, 1, 2, 3, 4, 5, 6].find((many) => theWindow(offers, many, NOBODY).length > 0);
  expect(room, 'the palette draws no word at any room at all').toBeDefined();
  return room as number;
}

/**
 * WHAT ONE WORD OF LIST COSTS THE REGION — the rows a page gives up so that a key that was
 * pressed answers with something rather than with an account of nothing.
 *
 * MEASURED OFF THE AREA, on a terminal tall enough that nothing else is giving way: the height
 * with the least list that draws a word in it, less the height with the list shut. So it is the
 * word and the blank row over it ({@link leastRoomForAWord}, `repl/area.ts`), and neither number
 * is written here — a delivery that changed either would move this with it instead of leaving a
 * bound that quietly stopped bounding anything.
 */
function whatOneWordOfListCosts(): number {
  const tall = { ...showingEverything, columns: 100, rows: 120 };
  return areaFor({ ...tall, palette: leastRoomForAWord() }).height - areaFor(tall).height;
}

// ---------------------------------------------------------------------------
// The budget: what the PAGE has left over, and not what the screen has
// ---------------------------------------------------------------------------

describe('the list of words is cut to what the page has left over', () => {
  it('⚠️ gives up one row of list per row of flow, down to one word', () => {
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
    // ⚠️ AND WHERE IT STOPS IS ONE WORD, WHICH IS THE PREMISE THIS DELIVERY FALSIFIED. What
    // stood here was *it reaches NOTHING rather than going negative: a page whose flow has taken
    // the room gets no palette, which is the same absence a window too narrow for a row gets* —
    // and the absence is what a person met, because that page is the ordinary one. A window too
    // narrow claims nothing and a key that draws nothing does NOT claim nothing: it draws `… 19
    // not shown`, which is a console answering *what can I type* with *nineteen things, none of
    // them*. So the leftover is a preference and the floor is one word under it
    // (`repl/area.ts`, `roomForThePalette`).
    const aWord = leastRoomForAWord();
    expect(roomAt(overTheFloor), 'a full page answered with no word at all').toBe(aWord);
    expect(roomAt(rows + 100), 'a flow longer than the screen took the word too').toBe(aWord);
    // AND NOTHING IS STILL AN ANSWER — it is the SCREEN's rather than the page's. A terminal with
    // no room over the area's own floor gets no palette at all, which is the same absence a
    // window too narrow for a row gets, and it is the one the floor may not overrule.
    expect(
      areaFor({ ...showingEverything, rows: floor + 1 + BELOW_THE_VIEWPORT, palette: wanted })
        .palette,
      'a terminal with no room over the floor was given a list anyway',
    ).toBe(0);
    // Not vacuous: the flows above really do span the whole ladder, from the list it wants to the
    // one word under it.
    expect(roomAt(0)).toBeGreaterThan(roomAt(12));
    expect(roomAt(12)).toBeGreaterThan(aWord);
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

  it('⛔ never reaches the viewport, and never charges a page that had the room', () => {
    // ⛔ THE GUARD THIS DELIVERY EXISTS FOR, and it is a COMPOSITION rather than a property of
    // either function: the area is budgeted against the page and the emptiness is the rest of
    // the same subtraction (`repl/page.ts`), so what the region takes is what the page had to
    // give — and scrolling is the one thing that cannot be undone.
    //
    // ⚠️ IT WAS ONE INEQUALITY AND THE FLOOR FALSIFIED IT. What stood here was *the flow, the
    // emptiness, the area and the row the library keeps fit on the screen*, over every geometry
    // in the grid — and it is false in eleven hundred and eighty of the twenty-six hundred with
    // a list open, measured, because that is exactly what a floor IS: on a page with nothing
    // left over, one word of list is one row the flow gives up. The inequality was never the
    // promise; it was the promise and its mechanism written as one line, and the mechanism is
    // what moved.
    //
    // SO IT COMES APART INTO THE TWO IT ALWAYS WAS, and both are asked of every geometry:
    //
    //   - THE CEILING, which does not bend. The region is never as tall as the viewport, because
    //     that is the height at which the library redraws the WHOLE screen with the erase this
    //     product refuses to write inside the sequence. The floor may REACH it and may not pass
    //     it, and the count below says how often it reaches.
    //   - THE PAGE, which is charged only when it had nothing. A page with as much left over as
    //     one word of list costs pays NOTHING for opening one — the rows come out of the
    //     emptiness, which is what the first half of this file bought — and no page anywhere
    //     pays more than that one word, whatever the flow.
    //
    // THREE BRANCHES, STATED TOGETHER, so none of them can go unasserted: the list took rows and
    // the page paid nothing, the list took rows and the page paid, and the list took nothing at
    // all.
    const mostAPageCanBeCharged = whatOneWordOfListCosts();
    let held = 0;
    let tookNothing = 0;
    let reachedTheCeiling = 0;
    let paid = 0;
    let free = 0;
    for (const rows of [2, 3, 4, 5, 6, 8, 10, 24, 30, 40, 120]) {
      for (const columns of [20, 60, 100, 200]) {
        for (const badge of BADGES) {
          for (const palette of [1, 7, 21, 80]) {
            for (const flow of [0, 1, 5, 14, 200]) {
              const request: AreaRequest = { rows, columns, badge, hint: HINT, palette, flow };
              const area = areaFor(request);
              const shut = areaFor({ ...request, palette: 0 });
              const at = `${columns}x${rows} flow ${flow} palette ${palette} badge ${badge}`;
              if (area.palette === 0) {
                // THE LIST TOOK NOTHING, so the frame is the frame the page already had — the
                // same arrangement, the same height, the same caret.
                expect(area, at).toEqual(shut);
                tookNothing += 1;
                continue;
              }
              held += 1;
              // ⛔ THE CEILING. Nothing about the flow is in it: it is the SCREEN, and it is the
              // library's boundary rather than this product's taste.
              expect(area.height + BELOW_THE_VIEWPORT, at).toBeLessThanOrEqual(rows);
              if (area.height + BELOW_THE_VIEWPORT === rows) reachedTheCeiling += 1;
              // WHAT THE PAGE PAID FOR THE LIST: how many rows of the caller's own page a region
              // this tall carries off the top, less what the same page was already paying with
              // the list SHUT. A difference rather than a total, because a flow longer than the
              // screen is already over the edge and the list did not put it there.
              const carriedAway = (height: number): number =>
                Math.max(0, flow + height + BELOW_THE_VIEWPORT - rows);
              const charged = carriedAway(area.height) - carriedAway(shut.height);
              expect(charged, at).toBeLessThanOrEqual(mostAPageCanBeCharged);
              // ⚠️ CHARGED MORE AND NOT MERELY CHARGED DIFFERENTLY. A difference of nothing and a
              // difference BELOW nothing are both pages that paid the list nothing — the second
              // is a page whose chrome gave up more rows than the list took — and a counter that
              // called the second one "paid" would be answered by a grid with no floor in it at
              // all: measured, seventy-two of them.
              if (charged > 0) paid += 1;
              else free += 1;
              // ⛔ AND A PAGE THAT HAD THE ROOM IS NOT CHARGED AT ALL, which is the half of the
              // old inequality that survives untouched — and it is the half a person meets, on
              // every page with an emptiness on it.
              if (theGap({ rows, flow, area: shut.height }) >= mostAPageCanBeCharged) {
                expect(charged, `${at}: a page with room to spare paid for the list`).toBe(0);
                expect(
                  flow + theGap({ rows, flow, area: area.height }) + area.height,
                  at,
                ).toBeLessThanOrEqual(rows - BELOW_THE_VIEWPORT);
              }
            }
          }
        }
      }
    }
    // NOT VACUOUS IN ANY DIRECTION: the grid really holds pages with room to spare and pages
    // with none, geometries where the floor reaches the ceiling and geometries where a page pays
    // — so no branch above is the branch nobody took. ⚠️ AND `paid` IS THE ONE THAT ANSWERS FOR
    // THE FLOOR: it is zero without one, because a list cut to what is left over can never take
    // a row the page did not have.
    expect(held, 'no size in the grid had room for a list at all').toBeGreaterThan(100);
    expect(tookNothing, 'every size in the grid had room for a list').toBeGreaterThan(10);
    expect(reachedTheCeiling, 'no geometry in the grid reached the ceiling').toBeGreaterThan(10);
    expect(
      paid,
      'no page in the grid paid for its list, so the floor is not under test',
    ).toBeGreaterThan(100);
    expect(free, 'every page in the grid paid for its list').toBeGreaterThan(100);
  });

  it('⚠️ gives the list the chrome AND one word, so a key on a full page draws a word', () => {
    // WHAT A PAGE WITH NOTHING TO SPARE STILL ANSWERS WITH, and it is the one thing that keeps
    // a key from looking broken. The badge and the two rules are the AREA's rather than its
    // floor, so a list has them to take even when the flow has taken everything else — the
    // trade this area has always made, *the palette is served before the chrome*, and what is
    // measured here is what that trade is worth on a page that is full.
    //
    // ⚠️ AND THE CHROME WAS NOT ENOUGH, WHICH IS WHAT THIS DELIVERY MEASURED. This case pinned
    // the answer at *what the chrome gave up, less its own blank row — which is two rows at every
    // height: the account of what had no room, and the row of keys under it* and called that
    // "still draws something". Two rows draw NO WORD: the account and the keys fill both
    // (`repl/palette.ts`, `theWindow`), so what "something" meant was a count of what the caller
    // could not see. The floor is one WORD now, and the row it needs over the chrome comes off
    // the top of the flow — which is one scroll away in the caller's own scrollback, where the
    // drawing had already gone.
    //
    // THE FLOW IS THE MOST A FRAME COULD HAVE LEFT, which is what makes this a full page rather
    // than an arbitrary number: the console follows what the frame left room for
    // (`repl/console.ts`, `whatTheFrameLeft`), so the flow is never longer than the screen less
    // the row the library keeps and less the area that was drawn.
    const offers = everythingOffered();
    const aWord = leastRoomForAWord();
    for (const rows of [10, 24, 30, 40]) {
      const at = { ...showingEverything, columns: 100, rows };
      const shut = areaFor(at);
      const spent = rows - BELOW_THE_VIEWPORT - shut.height;
      const open = areaFor({ ...at, palette: 21, flow: spent });
      // The page really is full: there is no emptiness left under the flow.
      expect(theGap({ rows, flow: spent, area: shut.height }), `${rows}`).toBe(0);
      // ⛔ AND WHAT THE LIST GETS IS A WORD, at every height — which is the least a console may
      // answer a key with, and the whole of what the floor under the list bought.
      expect(open.palette, `${rows}`).toBe(aWord);
      expect(
        theWindow(offers, open.palette, NOBODY).length,
        `${rows}: a full page answered with a count and no word`,
      ).toBeGreaterThanOrEqual(1);
      expect(open.form, `${rows}`).toBe('bare');
      expect(shut.form, `${rows}`).toBe('full');
      // ⚠️ AND THE PAGE PAID FOR THE WORD, which is the trade rather than an oversight — and it
      // is bounded: what the region takes past the page is what the FLOW gives up, never more
      // than one word and its blank row, and it comes off the top, where the caller's own
      // scrollback holds it.
      const carried = spent + theGap({ rows, flow: spent, area: open.height }) + open.height;
      expect(carried, `${rows}: the page paid more than one word`).toBeLessThanOrEqual(
        rows - BELOW_THE_VIEWPORT + whatOneWordOfListCosts(),
      );
      // ⛔ AND THE REGION IS STILL SHORT OF THE VIEWPORT, which is the limit that does not bend:
      // past it the library redraws the whole screen with the erase this product will not write.
      expect(open.height + BELOW_THE_VIEWPORT, `${rows}`).toBeLessThanOrEqual(rows);
    }
  });

  it('⚠️ never draws fewer words on a taller terminal, at every page', () => {
    // ⚠️ THE SHAPE THE LADDER OF HEIGHTS HAD LOST, and it is what a person meets by dragging the
    // corner of their window. Measured on the binary of the delivery before this one, at a
    // hundred and twenty columns on a page that had just opened: FOURTEEN rows drew one word,
    // SIXTEEN drew none, and EIGHTEEN drew two. A terminal that answers with less for being
    // bigger is a console a reader cannot form a rule about — and the middle of that ladder is a
    // key that looks broken at a size between two that work.
    //
    // ASKED OF THE PAGE RATHER THAN OF THE SCREEN, which is what makes it a statement and not a
    // photograph: the flow is held still and the height is walked, so what moves is the one thing
    // under test. The ladder above moved TWO things at once — the drawing of the name is a
    // different height at different sizes (`presentation/banner.ts`), so each rung had a
    // different page on it — and the case that reads a real device is the one further down this
    // file.
    //
    // AND IT IS THE WORDS AND THE ROOM TOGETHER. The room is what the area answers and the words
    // are what the palette makes of it, and a room that climbed while the words did not would be
    // this defect with the arithmetic looking innocent (`repl/palette.ts`, `theWindow`).
    const offers = everythingOffered();
    const wanted = paletteRowsFor(offers);
    const columns = 120;
    for (const flow of [0, 5, 12, 20, 26]) {
      const ladder = [];
      for (let rows = 2; rows <= 60; rows += 1) {
        const room = areaFor({
          ...showingEverything,
          columns,
          rows,
          palette: wanted,
          flow,
        }).palette;
        ladder.push({ rows, room, words: theWindow(offers, room, NOBODY).length });
      }
      for (const [step, rung] of ladder.entries()) {
        const under = ladder[step - 1];
        if (under === undefined) continue;
        const at = `flow ${flow}: ${rung.rows} rows against ${under.rows}`;
        expect(rung.words, `${at}, in words`).toBeGreaterThanOrEqual(under.words);
        expect(rung.room, `${at}, in rows of list`).toBeGreaterThanOrEqual(under.room);
      }
      // NOT VACUOUS: every ladder really climbs the whole way, from a terminal with no room for a
      // word to one that draws the vocabulary — so the comparison above is over a run of numbers
      // that move rather than over a column of zeroes.
      expect(ladder[0]?.words, `flow ${flow}: the shortest terminal drew a word`).toBe(0);
      expect(ladder.at(-1)?.words, `flow ${flow}: the tallest drew less than the list`).toBe(
        offers.length,
      );
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

/**
 * Every row of a screen that names one of these words, mark or no mark.
 *
 * ⚠️ IT TOOK A SCREEN, and it takes ROWS because a page a session has USED is not a page whose
 * only rows are the list's: what a verb printed is above, and a line of it that begins with a
 * verb's name reads to this exactly as a drawn offer does. The callers that mean the whole page
 * hand it the whole page; the one that means the list hands it the list's own rows
 * ({@link wordsOfTheListOn}).
 */
function rowsNaming(rows: readonly string[], words: readonly string[]): readonly string[] {
  return rows.filter((row) => {
    const shown = row.trimStart();
    const said = shown.startsWith(PICK) ? shown.slice(PICK.length).trimStart() : shown;
    return words.some((word) => said === word || said.startsWith(`${word} `));
  });
}

/**
 * HOW MANY WORDS OF THE LIST ARE DRAWN — counted inside the palette, on a page that has
 * something else on it too.
 *
 * WHERE THE LIST BEGINS AND ENDS IS READ OFF THE DRAWING. It ends at the row that accounts for
 * what had no room, which is the palette's own ({@link CUT}, `repl/palette.ts`), and it begins
 * under the last row with nothing on it above that — the blank row the area spends over the
 * list, which is drawn whenever there is one at all (`repl/area.ts`, `ABOVE_THE_PALETTE`). So
 * the count is bounded by the palette at both ends and cannot be swelled by a line the session
 * printed.
 *
 * A LIST THAT WAS NOT CUT HAS NO SUCH ROW, and then the answer is the whole page's: nothing was
 * left out, so every row naming an offer is one of the list's.
 */
function wordsOfTheListOn(screen: Screen, words: readonly string[]): number {
  const account = screen.rows.findIndex((row) => row.trimStart().startsWith(CUT));
  if (account < 0) return rowsNaming(screen.rows, words).length;
  const above = screen.rows.slice(0, account);
  const from = above.map((row) => row.trim().length === 0).lastIndexOf(true) + 1;
  return rowsNaming(above.slice(from), words).length;
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
      listed.rows,
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
    expect(rowsNaming(listed.rows, [first]), 'the list opened without its first word').toHaveLength(
      1,
    );
    expect(rowsNaming(walked.rows, [first]), 'the window did not move at all').toHaveLength(0);
    // AND THE PAGE PAID NOTHING FOR ANY OF IT: the input is still on the last row the layout
    // leaves, and the count still adds up to every word there is.
    endsAtTheFoot(walked, rows, 'the page after eleven arrows');
    const said = walked.rows.find((row) => row.trimStart().startsWith(CUT));
    expect(said, `no row said how many had no room:\n${walked.text}`).toBeDefined();
    const missing = Number(/(\d+)/.exec(said as string)?.[1]);
    expect(
      rowsNaming(
        walked.rows,
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
        listed.rows,
        offers.map((offer) => offer.word),
      ).length + 2;
    expect(drawn, `${said.palette} budgeted, ${drawn} drawn`).toBe(said.palette);
    // Not vacuous: the list really was cut, so the number is a measurement rather than the
    // whole vocabulary counted twice.
    expect(said.palette).toBeLessThan(paletteRowsFor(offers));
    expect(said.palette).toBeGreaterThan(2);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// On a page a session has really USED: a key that was pressed answers with a word
// ---------------------------------------------------------------------------

/** What takes the last key back off the row being typed, spelled by its code point. */
const RUBS_OUT = '\u007f';

/**
 * TWO VERBS THE SESSION REALLY RUNS, and what they are for here is the LENGTH of what they
 * print rather than what they say.
 *
 * ⚠️ A FIXTURE THAT DOES NOT FILL THE PAGE DOES NOT EXERCISE THIS AT ALL, and that is the way
 * this case fails silently: the floor is what a list gets when the page has nothing left over,
 * so a page with an emptiness on it answers the same whether there is a floor or not, and the
 * assertion becomes a green about a geometry nobody was worried about. So the longer of the two
 * is asserted to have left the page with less to spare than one word of list needs — measured on
 * this fixture at all three sizes, where it leaves ONE row.
 *
 * AND THE SHORTER ONE IS ASKED TOO, because what it leaves is a function of the RECORD and not
 * of this file: on this fixture it leaves thirteen rows at forty and one at twenty, so the same
 * pair of verbs walks the whole range without either of them being chosen for a number.
 */
const FILLS_THE_PAGE = 'brief';

/** The other one, which fills a tall page and not a short one. */
const A_SHORTER_ANSWER = 'status';

/** Types a verb into the row, and waits for the frame that answered it. */
function runs(verb: string): Step {
  return {
    types: `${verb}\r`,
    until: (bytes, since) =>
      aFrameAfter(PROMPT)(bytes) && bytes.slice(since).includes(`${PROMPT} ${verb}`),
    what: `ran \`${verb}\``,
  };
}

/**
 * Types a verb, and waits until what it printed has FILLED THE PAGE.
 *
 * ⚠️ WAITING FOR THE FRAME THAT ANSWERED IT IS NOT ENOUGH, and the whole suite is where that was
 * measured: an answer lands one line at a time and every line is a frame, so a step that waits
 * for a frame after the echo is answered by the FIRST of twenty-five lines. On its own the
 * stream never pauses long enough for it to matter and the case was green; under the load of the
 * whole suite it ended eleven lines in, on a page with twelve rows still to spare — and what
 * failed was the premise rather than the promise, which is the honest half of how it showed.
 *
 * SO THE STEP WAITS FOR WHAT THE CASE NEEDS, which is a page with less left over than one word of
 * list takes. It is read off the SCREEN, on the same instrument the case reads it with
 * (`support/screen.ts`, `theGapOn`), so there is one idea of "the page is full" rather than a
 * predicate that approximates the assertion. A fixture that stopped filling the page fails here,
 * by name, instead of leaving every assertion downstream green about a page that had room.
 */
function fills(verb: string, columns: number, rows: number, aWord: number): Step {
  return {
    types: `${verb}\r`,
    until: (bytes, since) =>
      aFrameAfter(PROMPT)(bytes) &&
      bytes.slice(since).includes(`${PROMPT} ${verb}`) &&
      theGapOn(screenOf(bytes, columns, rows), PROMPT) < aWord,
    what: `filled the page with \`${verb}\``,
  };
}

/**
 * Opens the list, and waits for THE LIST rather than for a frame.
 *
 * WHAT IT WAITS FOR IS EITHER OF THE TWO THINGS A PALETTE CAN ARRIVE AS — a word of it, or the
 * row that accounts for what had no room — because WHICH of the two a page gets is exactly what
 * is under test. A step that waited for a word would time out on the defect this closes instead
 * of failing on it, and a timeout is not an assertion (`repl/palette.ts`, {@link CUT}).
 */
function listsTheWords(offers: readonly CompletionWord[]): Step {
  const first = offers[0]?.word as string;
  return {
    types: PREFIX,
    until: (bytes, since) =>
      aFrameAfter(PROMPT)(bytes) &&
      (bytes.slice(since).includes(CUT) || bytes.slice(since).includes(first)),
    what: 'listed the words',
  };
}

/**
 * Takes the key back off the row, and waits for a frame with no palette written into it.
 *
 * ⚠️ IT WAS SPELLED OUT HERE TOO, and spelled out it is true before the key has been drawn — the
 * third of three sites with one rule between them (`support/pty.ts`, {@link aFrameWithout}).
 */
const shutsTheList: Step = {
  types: RUBS_OUT,
  until: aFrameWithout(PROMPT, CUT),
  what: 'shut the list',
};

describe('a key pressed on a page a session has used answers with a word', () => {
  // THREE SIZES A PERSON REALLY HAS, and the shortest of them is the one the defect was worst
  // at: at a hundred and twenty by twenty, EITHER verb filled the page and the list drew nothing.
  for (const [columns, rows] of [
    [120, 40],
    [120, 30],
    [120, 20],
  ] as const) {
    it(`⚠️ draws a word of the list after a verb at ${columns}x${rows}`, async () => {
      // ⚠️ THE DEFECT, ON THE PAGE A SESSION SPENDS ITS LIFE ON. Every other case in this file
      // reads a page that has just OPENED, where there is an emptiness for the list to grow
      // into. Measured on the binary of the delivery before this one, after ONE ordinary
      // verb: `… 19 not shown` and NOT ONE WORD — at a hundred and twenty by forty and by thirty
      // after `brief`, and at a hundred and twenty by twenty after either verb. Four of these six
      // screens drew nothing a caller could read, and the key that drew them is the one a person
      // presses to ask what they can type.
      //
      // TWO VERBS IN ONE SESSION, because the pair is the measurement: the same three sizes
      // answer differently depending on how much the last verb printed, and a case that ran only
      // the longer one would not show that the page with room over is untouched.
      const offers = everythingOffered();
      const words = offers.map((offer) => offer.word);
      const aWord = leastRoomForAWord();
      const ran = await inPty({
        columns,
        rows,
        steps: [
          opens,
          runs(A_SHORTER_ANSWER),
          listsTheWords(offers),
          shutsTheList,
          fills(FILLS_THE_PAGE, columns, rows, aWord),
          listsTheWords(offers),
          { ...leaves, types: `${ABANDONS_THE_LINE}${LEAVE}\r` },
        ],
      });
      const screenAt = (step: number): Screen =>
        screenOf(ran.bytes.slice(0, ran.at[step] as number), columns, rows);
      const ranTheVerb = { shorter: screenAt(1), filled: screenAt(4) };
      const listed = { shorter: screenAt(2), filled: screenAt(5) };
      // BOTH VERBS REALLY RAN, or the screens below are one screen read four times. ⚠️ ASKED OF
      // THE BYTES AND NOT OF THE SCREEN, and the reason is the case itself: the row a caller
      // typed is the FIRST thing a long answer carries into the scrollback, so on the page this
      // is about the echo is exactly what is no longer on the screen — measured, at all three
      // sizes, where the page holds the end of what `brief` printed and nothing of the line that
      // asked for it.
      for (const verb of [A_SHORTER_ANSWER, FILLS_THE_PAGE]) {
        expect(ran.bytes, `${verb} never ran`).toContain(`${PROMPT} ${verb}`);
      }
      // ⚠️ AND THE PAGE REALLY IS FULL, which is the premise the whole case rests on: what the
      // longer verb printed left less over than one word of list takes, so there is nothing for
      // the list to grow into and the floor is the only thing that can answer the key. A fixture
      // that stopped filling the page would make every assertion below a green about a page that
      // was never short of room. It is what the step itself waited for ({@link fills}) and it is
      // asked again here, because a step is also over when the SESSION is — so a console that
      // died would satisfy the wait and nothing else would say so.
      expect(
        theGapOn(ranTheVerb.filled, PROMPT),
        `${columns}x${rows}: the page had room to spare, so the floor is not under test`,
      ).toBeLessThan(aWord);
      // ⛔ AND THE KEY ANSWERS WITH A WORD, on both pages. One is the least a console may say
      // when it is asked what can be typed: a key that draws no word is indistinguishable from a
      // key that does nothing.
      for (const [what, screen] of [
        [A_SHORTER_ANSWER, listed.shorter],
        [FILLS_THE_PAGE, listed.filled],
      ] as const) {
        const drawn = wordsOfTheListOn(screen, words);
        expect(
          drawn,
          `${columns}x${rows} after \`${what}\`: the list drew the count and no word\n${screen.text}`,
        ).toBeGreaterThanOrEqual(1);
        // AND WHAT IT DID NOT SHOW IT STILL SAYS, which is the honesty the floor may not cost:
        // what is drawn plus what the count names is everything there was.
        const said = screen.rows.find((row) => row.trimStart().startsWith(CUT));
        const missing = said === undefined ? 0 : Number(/(\d+)/.exec(said)?.[1]);
        expect(
          drawn + missing,
          `${columns}x${rows} after \`${what}\`: the count does not add up`,
        ).toBe(offers.length);
        // AND THE INPUT IS STILL ON THE LAST ROW THE LAYOUT LEAVES, which is the promise the
        // floor may not cost either: what it takes comes off the TOP of the flow, and the foot of
        // the page does not move for it.
        endsAtTheFoot(screen, rows, `${columns}x${rows} after \`${what}\``);
      }
    }, 240_000);
  }
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
