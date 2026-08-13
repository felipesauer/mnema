/**
 * THE NAME IN FULL BLOCKS — the drawing that replaced the nine rows of shades, and the floor
 * that follows it instead of being told what it is.
 *
 * WHERE THE REQUIREMENT CAME FROM: the name was asked to be drawn *better and more robust*,
 * now that a floor under the window guarantees the room for it. Four samples were drawn in the
 * real arrangement and one was chosen — full blocks with a contour round them, six rows by
 * forty-eight columns. What was turned down is worth as much as what was kept: the nine-row
 * drawing whose last three rows are the dust of a drop shadow, which disappears in a thin font,
 * and a compact three-row one, which is the opposite of what was asked for.
 *
 * AND THE INTERACTION IT FORCED IS WHAT THIS FILE IS REALLY ABOUT. The delivery before this one
 * defined the shortest window this console draws on as *the height the name is drawn whole at*
 * and left the answer as a NUMBER — fifty-one, measured on a real pseudo-terminal one row at a
 * time. A number measured once is true of the drawing it was measured against: swap in a
 * drawing three rows shorter and fifty-one is a floor nine rows above where the name is drawn
 * whole, and every window in between draws the screen that says it is too small for no reason
 * at all. That is the class this console has already paid for three times, so the floor is a
 * FUNCTION of the drawing now (`src/repl/floor.ts`, `theFloorFor`) and this file is what says
 * the function is live.
 *
 * WHAT IT HOLDS, and what each part needs its instrument for:
 *
 *   - THE ART ITSELF, measured by the function the page is measured by — never by counting
 *     characters here, which would be a second opinion about how wide a row is.
 *   - THE FLOOR AS A FUNCTION: the old drawing handed back puts the floor back at fifty-one,
 *     a row of drawing is worth three rows of window, and a drawing too wide for the page moves
 *     the other measurement too. The fixtures are drawings, never edits to the product.
 *   - THE FLOOR AGAINST A PAGE THAT IS COMPOSED RATHER THAN DECLARED: the shortest screen the
 *     whole name is chosen on is SEARCHED for, through the modules that really compose an
 *     opening, and it has to be the floor. That is the case that would go red if the page the
 *     floor is defined against stopped being the page the console draws.
 *   - AND THE LADDER, STILL TOTAL: every window of a grid gets a drawing, and no smaller window
 *     ever gets a richer one.
 *
 * WHAT IS NOT HERE, deliberately: the floor ON A REAL DEVICE. A session driven on a
 * pseudo-terminal at the floor draws every row of the art and one row under it says the window
 * is too small — that is `tests/the-floor-is-where-the-name-is-drawn.test.ts`, which reads the
 * drawing off the module and the size off the floor, so it moved with both. A second copy of
 * that run would cost four minutes to assert what is already asserted.
 */

import { describe, expect, it } from 'vitest';
import { bannerFor, THE_BIGGEST_DRAWING, widthOfTheDrawing } from '../src/presentation/banner.js';
import { aside, fact, subjectLine } from '../src/presentation/detail.js';
import type { Line } from '../src/presentation/line.js';
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { areaFor } from '../src/repl/area.js';
import { THE_FLOOR, theFloorFor } from '../src/repl/floor.js';
import { insideTheMargin } from '../src/repl/inset.js';
import { openingFor, theShortestScreenFor } from '../src/repl/panel.js';

// ---------------------------------------------------------------------------
// The art
// ---------------------------------------------------------------------------

/** The drawing as it reaches a screen: the module's lines, rendered by the plain renderer. */
const THE_ART: readonly string[] = THE_BIGGEST_DRAWING.map(renderPlain);

/** How many columns the drawing claims, asked of the function the page asks it of. */
const ACROSS = widthOfTheDrawing(THE_BIGGEST_DRAWING);

describe('the drawing is six rows of one width, in glyphs the product measures at one column', () => {
  it('is forty-eight columns, and every row reaches them but the one whose letter ends in a blank', () => {
    // THE WIDTH IS ASKED OF THE PRODUCT'S OWN MEASUREMENT — `widthOf`, which is what the panel
    // chooses an arrangement by and what the floor works its columns out of. Counting the
    // characters here instead would be this file's opinion about how wide a row is, and the
    // arrangement would go on believing its own.
    expect(THE_BIGGEST_DRAWING).toHaveLength(6);
    expect(ACROSS, 'the drawing is not forty-eight columns wide').toBe(48);

    // AND EVERY ROW IS THAT WIDTH BUT ONE, WHICH IS THE TRIM RULE SEEN FROM THE OTHER END. No
    // row of a form may end in a blank — the layout trims what it writes, so a padded row would
    // arrive narrower than the arithmetic that chose it believes — and the last letter's top row
    // ends in a blank of its own shape. So that blank came off with the padding and the top row
    // is one column short of the rest. What matters is that NOTHING is wider than the drawing
    // says and nothing is short by more than that blank.
    const measured = THE_BIGGEST_DRAWING.map((row) => widthOf(row));
    const short = measured.filter((width) => width !== ACROSS);
    expect(Math.max(...measured), 'a row is wider than the drawing says it is').toBe(ACROSS);
    expect(short, 'more than the top row is short of the drawing').toEqual([ACROSS - 1]);
    expect(measured[0], 'the short row is not the top one').toBe(ACROSS - 1);
    // AND NO ROW ENDS IN A BLANK, which is the rule the paragraph above is the consequence of.
    // It is asserted over every form in `the-opening-fits-the-screen.test.ts`; here it is what
    // makes the sentence about the short row true rather than a hedge.
    for (const row of THE_ART) {
      expect(row, 'a row of the drawing is padded at its end').toBe(row.replace(/[ \t]+$/, ''));
    }
  });

  it('measures every glyph it is drawn with at one column, by the product own measurement', () => {
    // WHAT THE HANDOFF ASKED FOR, ASKED OF THE PRODUCT RATHER THAN OF THE STANDARD: the blocks
    // and the box drawing are EAST ASIAN AMBIGUOUS, which is one column here and two on a
    // terminal in a CJK locale.
    //
    // AND THE ANSWER IS HALF AN ANSWER, WHICH IS WHY IT IS WRITTEN OUT. What the product
    // measures with counts CODE POINTS (`presentation/plain.ts`), so every one of these glyphs
    // is one column to it — the measurement is self-consistent, which is what keeps the
    // arrangement, the floor and the fold agreeing with each other, and it says nothing about
    // what a CJK terminal draws. That debt is declared in the module and it did not change kind
    // when this drawing arrived: it was one ambiguous glyph and it is seven.
    const glyphs = [...new Set([...THE_ART.join('')])].filter((glyph) => glyph !== ' ');
    expect(glyphs.length, 'the drawing is drawn with nothing at all').toBeGreaterThan(1);
    for (const glyph of glyphs) {
      expect(widthOf(subjectLine(glyph)), `${JSON.stringify(glyph)} is not one column`).toBe(1);
    }
    // NOT VACUOUS: the measurement really can answer more than one. A single code point is one
    // column to it whatever it is, so a case that only ever showed it a single code point would
    // be affirming the counter rather than the drawing — this is what it says about something
    // it counts as two.
    expect(widthOf(subjectLine(`${glyphs[0] as string}${glyphs[0] as string}`))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The floor is a function of the drawing
// ---------------------------------------------------------------------------

/** A drawing of a given height, as a fixture: rows of ink, never an edit to the product. */
function aDrawingOf(rows: number, across = 20): readonly Line[] {
  return Array.from({ length: rows }, () => subjectLine('#'.repeat(across)));
}

/**
 * THE DRAWING THIS CONSOLE HAD UNTIL THIS DELIVERY — nine rows, as a FIXTURE.
 *
 * It is the shape of the old art and not the art: what the floor is a function of is how many
 * rows a drawing has and how wide it is, so a fixture of the right shape asks the same question
 * the real one did without keeping a copy of a drawing nothing draws any more.
 */
const THE_NINE_ROW_DRAWING: readonly Line[] = aDrawingOf(9, 50);

describe('the floor follows the drawing, because it is worked out from it', () => {
  it('is what the drawing there is asks for, and the drawing before it asked for fifty-one', () => {
    // THE PROMISE OF THE DELIVERY, IN TWO LINES. The floor is the function applied to the art
    // there is, and the art there was puts it back where it was written down — which is the one
    // statement that could not be made while the floor was a number, because a number does not
    // answer questions about drawings it was not measured against.
    expect(THE_FLOOR, 'the floor is not what the drawing there is asks for').toEqual(
      theFloorFor(THE_BIGGEST_DRAWING),
    );
    expect(THE_FLOOR.rows, 'the floor is not forty-two rows').toBe(42);
    expect(
      theFloorFor(THE_NINE_ROW_DRAWING).rows,
      'the drawing this replaced does not put the floor back at fifty-one',
    ).toBe(51);
    // AND THE NINE ROWS OF WINDOW ARE THE THREE ROWS OF ART, which is what says the two numbers
    // are one arithmetic rather than two measurements that happen to differ.
    expect(theFloorFor(THE_NINE_ROW_DRAWING).rows - THE_FLOOR.rows).toBe(
      theShortestScreenFor(THE_NINE_ROW_DRAWING.length - THE_BIGGEST_DRAWING.length),
    );
  });

  it('spends three rows of window on every row of drawing, at every height', () => {
    // THE LADDER OF THE DERIVATION ITSELF, walked rather than sampled: what a row of art costs
    // is the share a fixed region may hold (`repl/panel.ts`, `A_THIRD`), and it is the same at
    // every height. A case that only compared two drawings could not tell a function from a
    // table with two entries in it.
    const aRowOfArt = theShortestScreenFor(1);
    for (let rows = 1; rows <= 12; rows += 1) {
      expect(
        theFloorFor(aDrawingOf(rows + 1)).rows - theFloorFor(aDrawingOf(rows)).rows,
        `a row of drawing at ${rows} rows`,
      ).toBe(aRowOfArt);
    }
    // Not vacuous: a row of art really does cost something, so the loop ruled on more than
    // nought.
    expect(aRowOfArt).toBeGreaterThan(0);
  });

  it('keeps the width everything was measured across, until a drawing wants more', () => {
    // THE OTHER MEASUREMENT, AND IT WAS A NUMBER TOO. Eighty columns is what every ladder on
    // this surface was measured across, and the drawing has to be INSIDE the page — which keeps
    // a margin — so the floor's width is the larger of the two demands rather than the first of
    // them. The art there is does not dispute it, and the case says so by measuring rather than
    // by asserting the number alone.
    expect(THE_FLOOR.columns, 'the floor is not eighty columns').toBe(80);
    expect(ACROSS, 'the drawing does not fit inside the page at the floor').toBeLessThanOrEqual(
      insideTheMargin(THE_FLOOR.columns),
    );
    // AND A DRAWING TOO WIDE FOR THAT PAGE MOVES IT, which is what makes the maximum a
    // mechanism rather than a decoration on a constant. The fixture is as wide as the page has
    // room for and one column more.
    const wide = aDrawingOf(6, insideTheMargin(THE_FLOOR.columns) + 1);
    expect(theFloorFor(wide).columns, 'a drawing wider than the page left the floor alone').toBe(
      THE_FLOOR.columns + 1,
    );
    // AND THE HEIGHT DID NOT MOVE WITH IT: the two measurements are answered separately, so a
    // wider drawing of the same height is the same floor down the screen.
    expect(theFloorFor(wide).rows).toBe(THE_FLOOR.rows);
  });
});

// ---------------------------------------------------------------------------
// The floor against a page that is composed rather than declared
// ---------------------------------------------------------------------------

/**
 * A PAGE OF THE SHAPE THE CONSOLE OPENS WITH, composed out of the real modules.
 *
 * IT IS THE INSTRUMENT THAT MAKES THE CASE BELOW INDEPENDENT. The floor DECLARES what the page
 * it is defined against costs — the title, the place, the record's heading and the two trees a
 * project keeps (`repl/floor.ts`) — and a case that read those constants back would agree with
 * whatever they said. So the page is COMPOSED here instead, through the arrangement's own
 * chooser, the fold, and the input area, and the shortest screen the whole name survives on is
 * searched for through it.
 *
 * The lines are of the shape the session composes rather than its bytes: one row of title, one
 * of place, a heading and a line per tree (`repl/session.ts`). What binds this shape to the one
 * a console really draws is a pseudo-terminal, and that measurement is in
 * `tests/the-floor-is-where-the-name-is-drawn.test.ts` — where the arrangement is read off the
 * page's own seam and compared with this floor.
 */
const A_PAGE = {
  title: subjectLine('mnema 0.0.0 - a session over this project'),
  standing: [aside('~/projects/a-project - signed as somebody')] as readonly Line[],
  record: [
    subjectLine('The record'),
    fact('public - proven, with a signature over every event'),
    fact('private - proven, with a signature over every event'),
  ] as readonly Line[],
  beneath: [
    aside('It runs the same words the command line does, and refuses the ones that would write'),
  ] as readonly Line[],
} as const;

/**
 * HOW TALL A SCREEN A DRAWING NEEDS ON THAT PAGE — the composer's own question, written out.
 *
 * It is the taller of two demands: the rows the page takes with this drawing in it plus the
 * input area under it, and the shortest screen on which the arrangement this drawing would
 * produce is still inside the share a fixed region may hold (`repl/session.ts`, the question
 * `bannerFor` is asked). Written out rather than imported because it lives inside the closure
 * that opens a console; what keeps it honest is that every number in it is asked of the module
 * that owns it.
 */
function needsOnThatPage(drawing: readonly Line[], columns: number, rows: number): number {
  const openingWith = (within: number) =>
    openingFor({
      columns: insideTheMargin(columns),
      rows: within,
      render: renderPlain,
      title: A_PAGE.title,
      mark: drawing,
      standing: A_PAGE.standing,
      record: A_PAGE.record,
      beneath: A_PAGE.beneath,
    });
  const underneath = areaFor({
    rows,
    columns,
    badge: 0,
    hint: 0,
    palette: 0,
    header: 0,
  }).height;
  return Math.max(
    openingWith(rows).rows + underneath,
    theShortestScreenFor(openingWith(Number.MAX_SAFE_INTEGER).above),
  );
}

/** What a window of a given size is given, on that page. */
function drawnOn(columns: number, rows: number): readonly string[] {
  return bannerFor({
    columns,
    rows,
    needs: (drawing) => needsOnThatPage(drawing, columns, rows),
  }).map(renderPlain);
}

describe('the floor is the shortest screen the whole name survives on, searched for', () => {
  it('finds the floor by walking a composed page one row at a time', () => {
    // THE CASE THAT WOULD GO RED IF THE FLOOR AND THE PAGE CAME APART. Nothing here reads the
    // floor's arithmetic: the page is composed, the drawing is chosen by the module that
    // chooses it, and the shortest screen the biggest one comes back on is SEARCHED for one row
    // at a time. That number has to be the floor, because the floor is defined as that number.
    let shortest: number | undefined;
    for (let rows = 1; rows <= 80; rows += 1) {
      if (drawnOn(THE_FLOOR.columns, rows).join('\n') === THE_ART.join('\n')) {
        shortest = rows;
        break;
      }
    }
    expect(shortest, 'the whole name is drawn on no screen at all').toBeDefined();
    expect(shortest, 'the floor is not where the whole name starts being drawn').toBe(
      THE_FLOOR.rows,
    );
    // AND ONE ROW UNDER IT IS A SMALLER DRAWING, which is the half that says the floor is a
    // threshold rather than a height that happens to work.
    expect(
      drawnOn(THE_FLOOR.columns, THE_FLOOR.rows - 1).join('\n'),
      'one row under the floor still drew the whole name',
    ).not.toBe(THE_ART.join('\n'));
  });
});

// ---------------------------------------------------------------------------
// The ladder is still total
// ---------------------------------------------------------------------------

/**
 * EVERY DRAWING THERE IS, richest first — walked off the module rather than written down.
 *
 * A form is what a size answers with, so the forms are what the answers CHANGE at: the widths
 * are walked from a terminal wider than anything down to one with no width at all, on a page
 * that costs nothing. A list written here would be a second copy of the art.
 */
function everyForm(): readonly string[] {
  const forms: string[] = [];
  for (let columns = 200; columns >= 0; columns -= 1) {
    const form = bannerFor({ columns, rows: 200, needs: () => 0 })
      .map(renderPlain)
      .join('\n');
    if (forms[forms.length - 1] !== form) forms.push(form);
  }
  return forms;
}

describe('the ladder is total: every window gets a drawing, and never a richer one than a bigger window', () => {
  it('answers every size of a grid, and never richer on a smaller window it draws on', () => {
    // WHAT TOTALITY MEANS ON TWO MEASUREMENTS, asserted over a grid rather than at the sizes
    // this delivery happened to think about. Two properties, and they are not asked over the
    // same region — which is a MEASUREMENT this file made rather than a hedge it chose:
    //
    //   - THERE IS ALWAYS A DRAWING, AT EVERY SIZE OF THE GRID. The floor of the ladder is the
    //     name as it is typed, and it is answered at every width and every height there is —
    //     including sizes no device reports, because a function of a number has to answer for
    //     the number.
    //   - AND RICHNESS ONLY EVER GOES ONE WAY ON A WINDOW THIS CONSOLE DRAWS ON. A window one
    //     column narrower, or one row shorter, gets the same drawing or a poorer one, never a
    //     richer one.
    //
    // THE SECOND ONE IS FALSE UNDER THE FLOOR, and the numbers are the point. Walking the whole
    // grid finds THIRTY inversions, every one of them at the same width step — fifty-eight
    // columns to fifty-nine — and the tallest window that has one is FORTY-ONE rows, which is
    // one row under the floor. What happens there is that fifty-nine columns is where the page
    // first has room for an ARRANGEMENT across, and an arrangement has to be inside its share of
    // the screen: a window too short for that share is refused the drawing it was being given
    // while the same lines were landing on the roll. Above the floor there is always room for
    // the share, so it cannot happen — measured as ZERO over the same grid, not argued.
    //
    // IT IS NOT THIS DELIVERY'S TO CLOSE and it is not a consequence of it: the step is a
    // property of the arrangement's own budget, which this delivery did not touch, and every
    // size it happens at is a window that draws the screen saying it is too small.
    const forms = everyForm();
    const rankOf = (columns: number, rows: number): number => {
      const at = forms.indexOf(drawnOn(columns, rows).join('\n'));
      expect(at, `${columns}x${rows}: what was drawn is no form of the name`).toBeGreaterThan(-1);
      return at;
    };
    const WIDTHS = 90;
    const HEIGHTS = 60;
    const rank: number[][] = [];
    for (let columns = 0; columns <= WIDTHS; columns += 1) {
      const row: number[] = [];
      for (let rows = 0; rows <= HEIGHTS; rows += 1) row.push(rankOf(columns, rows));
      rank.push(row);
    }
    const richerOnTheSmaller: string[] = [];
    for (let columns = 0; columns <= WIDTHS; columns += 1) {
      for (let rows = 0; rows <= HEIGHTS; rows += 1) {
        const here = (rank[columns] as number[])[rows] as number;
        const narrower = columns > 0 ? ((rank[columns - 1] as number[])[rows] as number) : here;
        const shorter = rows > 0 ? ((rank[columns] as number[])[rows - 1] as number) : here;
        if (narrower < here)
          richerOnTheSmaller.push(`${columns - 1}x${rows} over ${columns}x${rows}`);
        if (shorter < here)
          richerOnTheSmaller.push(`${columns}x${rows - 1} over ${columns}x${rows}`);
      }
    }
    // ON THE WINDOWS THIS CONSOLE DRAWS ON, THERE ARE NONE.
    const heightOf = (said: string): number => Number(said.split(' over ')[1]?.split('x')[1]);
    expect(
      richerOnTheSmaller.filter((said) => heightOf(said) >= THE_FLOOR.rows),
      'a smaller window above the floor was given a richer drawing',
    ).toEqual([]);
    // AND THE CHECK IS NOT VACUOUS, which is the half an empty list may never stand on alone:
    // the product really can invert, every place it does is under the floor, and the tallest of
    // them is one row under it.
    expect(richerOnTheSmaller.length, 'nothing on this grid could have gone red').toBeGreaterThan(
      0,
    );
    expect(
      Math.max(...richerOnTheSmaller.map(heightOf)),
      'an inversion reaches a window the console draws a page on',
    ).toBe(THE_FLOOR.rows - 1);
    // AND THE GRID REALLY CROSSES THE THRESHOLDS, so more than one rung was walked — and the
    // richest of them is the drawing this delivery is about.
    const walked = new Set(rank.flat());
    expect(walked.size, 'the grid never left one rung of the ladder').toBeGreaterThan(1);
    expect(rank[WIDTHS]?.[HEIGHTS], 'the biggest window of the grid is not given the art').toBe(0);
    expect(forms[0], 'the richest form is not the drawing this file is about').toBe(
      THE_ART.join('\n'),
    );
  });
});
