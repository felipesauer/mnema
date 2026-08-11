/**
 * HOW MUCH OF THE INPUT AREA FITS — the arithmetic, and nothing about what it says.
 *
 * The row being typed used to be one row with two rows under it. It is an AREA now: the
 * palette of words a caller could type next, a badge in the corner saying what the record
 * proved, a rule across the terminal, the row itself, a second rule, and the hint. Those
 * are rows the layout REDRAWS, and the library that redraws them gives up on redrawing
 * PART of the screen once the region is as tall as the viewport. What it does instead is
 * redraw all of it, with a sequence that carries, inside it, the one erase this product
 * refuses to write: the caller's own history (`a-page-that-opens-clean.test.ts` measures
 * the boundary in both directions).
 *
 * SO THE AREA HAS FORMS, AND THEY ARE CHOSEN BY HEIGHT. It is the panel's rule
 * (`panel.ts`) applied to the other measurement: the widest form that fits is the one
 * drawn, a form gives way when it stops fitting, and the floor is what this console drew
 * before there was an area at all. A terminal with no room for the badge loses the badge;
 * one with no room for the rules loses the rules; what is left is the row being typed and
 * the hint under it, which is what a session has always had.
 *
 * WHAT FITTING MEANS IS ONE ROW MORE THAN THE FORM TAKES, and that number is the
 * library's rather than a margin somebody liked. A region exactly as tall as the viewport
 * is a region the library calls fullscreen, and a fullscreen region is redrawn whole on
 * the way out. Under the viewport by one row, it is not — so the threshold is where the
 * behaviour changes and not where a drawing looks cramped.
 *
 * ⛔ AND FITTING THE VIEWPORT IT IS DRAWN ON IS NECESSARY AND NOT SUFFICIENT, which a window the
 * caller makes SHORTER is what falsifies. The library asks the question TWICE about one frame:
 * once about the frame it is drawing, which is what this arithmetic answers, and once about the
 * frame it LAST drew against the viewport of the moment — and the second is asked again on every
 * change of size, so a region that was one row short of its own screen is over the boundary as
 * soon as that screen becomes shorter. Nothing here can answer it: the frame it judges is already
 * on the page. Measured, declared and asserted as a hole where a resize is the subject
 * (`tests/the-page-follows-the-terminal.test.ts`), which is also where the frontier is written
 * down.
 *
 * EVERY ROW THE AREA WILL DRAW IS COUNTED, including the ones that come and go. THIS USED
 * TO BE ONE ROW — the words a Tab could not choose between — and what replaced it is a
 * LIST: the palette, which is as many rows as there are words to show and is opened by a
 * slash as well as by a Tab (`palette.ts`). A form chosen as though those rows did not
 * exist would be arithmetic about a region that is not the one on the screen, which is
 * the exact shape of instrument this bench has been wrong with before.
 *
 * AND THE PALETTE IS SERVED BEFORE THE CHROME, which is a trade rather than an oversight.
 * It answers the key that was just pressed, so on a terminal that cannot hold both it is
 * the badge and the rules that give way — the same call the single row of candidates
 * already forced, made explicit now that the list can be long. What the palette may never
 * do is take the row being typed or crowd the region past the boundary above, and the cut
 * is REPORTED, so what it cannot show it says (`palette.ts`).
 *
 * ⚠️ AND WHAT IT WAS CUT TO WAS THE SCREEN, which is the premise this delivery falsified. It
 * was written here in these words — *it is cut to what is left over the floor* — and the floor
 * was measured against the whole viewport, which really did keep the REGION short of the
 * screen. What it could not keep is the PAGE: everything the session has already said is
 * above the region, so a list cut to twenty rows on a page with four to spare takes the other
 * sixteen off the top of the caller's own screen, and nothing un-scrolls. Measured on the
 * merged binary, at a hundred by thirty and at eighty by twenty-four: ONE opening of the list
 * and the drawing of the name was gone for good, on the first keystroke a person presses to
 * see what they can type. So what is left over is counted UNDER THE FLOW
 * ({@link AreaRequest.flow}), and the two measurements it takes are named in the next
 * paragraph.
 *
 * ⚠️ AND WHAT IS LEFT OVER IS A PREFERENCE AND NOT THE WHOLE RULE, which is the second premise
 * this frontier had to correct. Cutting the list to the page was measured on a page that had
 * just opened, where there is room to spare; on the page a session spends its life on — one
 * ordinary verb printed — there is none, and the list drew the count of what had no room and
 * NOT ONE WORD. So the room is a preference with a FLOOR of one word under it and the
 * library's own limit over it ({@link roomForThePalette}), and the floor bites exactly where
 * it costs nothing: on a page with nothing to spare, what it takes is the top of the flow,
 * which is one scroll away in the caller's own scrollback.
 *
 * THE LIST IS BUDGETED BY THE PAGE AND THE ARRANGEMENT BY THE SCREEN, and that is one
 * decision rather than two measures that disagree. The chrome is the FLOOR of this area and
 * has to be STABLE: a badge and two rules that came and went as the session printed would be
 * the foot of the page changing shape on every line landed. The list is the only part that
 * GROWS, and it grows on a keystroke — so it takes what the page has left over the floor, and
 * the chrome takes what is left after the list ({@link formFor}). A list open is therefore the
 * one thing that can still make an arrangement give way, which is what it has always been.
 *
 * WIDTH IS THE OTHER MEASUREMENT, AND IT WAS MISSING. The arithmetic counted a row per
 * thing to draw and the terminal counted two whenever a thing was wider than the screen —
 * a hint of seventy columns on a window of sixty is two rows, and every number this file
 * answered with was one too few. So a row that would be FOLDED is not drawn, which is the
 * same rule the forms already are, turned on the other axis: the hint and the badge each
 * have an "absent" form already, and this is what chooses it.
 *
 * NOTHING HERE DRAWS AND NOTHING HERE COMPOSES. It receives what there is to show as
 * numbers — how wide each thing is, how many rows the palette wants — and answers with
 * which arrangement there is room for, what is in it, and where the caret goes; the
 * drawing is the layout's (`region.ts`) and the words are the session's (`session.ts`).
 */

/**
 * The three forms, tallest first — the same shape of choice the panel makes.
 *
 *   - `full` — the badge in the corner, a rule, the row being typed, a rule, the hint.
 *     What the reference this was drawn from shows.
 *   - `ruled` — the same without the badge. A terminal that has room for the two rules
 *     and not for the row above them, a terminal too narrow for the badge to be one row,
 *     and the arrangement a session outside a project gets at any size, because there is
 *     no record to name a level of.
 *   - `bare` — the row being typed and the hint, with nothing around them. What this
 *     console drew before the input had a place of its own, and the floor: it is
 *     answered whatever the height, because a terminal too short for it is a terminal
 *     too short for a prompt.
 */
export type AreaForm = 'full' | 'ruled' | 'bare';

/** What there is to show, and how much room the device is giving it. */
export interface AreaRequest {
  /** How tall the terminal is, asked of the DEVICE by whoever owns the streams. */
  readonly rows: number;
  /** How wide it is, asked of the same device in the same place. */
  readonly columns: number;
  /**
   * How wide the badge is, in columns, and zero when there is none.
   *
   * A WIDTH RATHER THAN A YES, and the two are different questions: outside a project
   * there is no level to name, and on a window narrower than the badge there is a level
   * that would be drawn across two rows. Both end in the same absence and only one of
   * them is about the record, so the caller answers what it knows — how wide the row it
   * composed is — and the choice is made here.
   */
  readonly badge: number;
  /** How wide the hint is, in columns, and zero when the console offers none. */
  readonly hint: number;
  /** How many rows the palette would like. Zero when it is not open. */
  readonly palette: number;
  /**
   * HOW MANY ROWS OF THE FLOW ARE ON THE SCREEN — everything the session has already said
   * that a reader can still SEE, in rows rather than in lines.
   *
   * IT IS THE OTHER HALF OF THE PAGE, and it is here because the palette is the only thing
   * this file answers that GROWS. The rest of the area is a floor and some chrome, chosen by
   * the height of the terminal and by nothing else; the list is as long as there are words,
   * and the rows it takes have to come from somewhere. They come from what the page has left
   * over ({@link BELOW_THE_VIEWPORT}, `page.ts`, `theGap`) — which is the same subtraction
   * the emptiness under the flow is, one row deeper.
   *
   * IT IS THE FLOW ON THE SCREEN AND NOT THE FLOW THE SESSION HAS SAID, and the difference is
   * a page that scrolled: rows the terminal has already carried into the scrollback are not
   * rows this area may grow into. The console follows the one and not the other
   * (`console.ts`, `flowOnScreen`), and hands the SAME number to both readers on a frame —
   * two answers to *how much of the flow is on the screen* would be the emptiness and the
   * area disagreeing about one page.
   *
   * ZERO IS A PAGE WITH NOTHING ON IT, and it is what the opening asks with (`session.ts`):
   * at that moment nothing has landed, and with no palette open the number cannot change the
   * answer. Every number this file gave before this field existed is the answer it gives at
   * zero, which is what makes the field additive rather than a new arithmetic.
   */
  readonly flow: number;
}

/** Which arrangement the terminal has room for, and the numbers that follow from it. */
export interface Area {
  /** The arrangement to draw. */
  readonly form: AreaForm;
  /**
   * How many rows sit ABOVE the row being typed — which is where the caret goes.
   *
   * The layout puts the real caret at an offset into the region it redraws, and the row
   * being typed stopped being the first of those the moment anything was drawn over it.
   * A layout that worked this out itself would be a second opinion about the shape this
   * file just chose.
   */
  readonly above: number;
  /** How many rows the whole area takes. What the form was chosen by. */
  readonly height: number;
  /** Whether the hint is drawn under it all. */
  readonly hint: boolean;
  /** How many rows the palette gets — what it wanted, or what was left over. */
  readonly palette: number;
}

/** The row being typed. The one row every form has. */
const TYPED = 1;
/** The badge's row, above the first rule. */
const BADGE = 1;
/** One rule. There are two of them in the forms that have any. */
const RULE = 1;
/** The hint's row, under everything. */
const HINT = 1;
/**
 * THE BLANK ROW OVER THE PALETTE — what separates the list of words from whatever the
 * arrangement puts under it.
 *
 * It exists because the list read as part of what was above it: the palette is the console's
 * own affordance and the row under it is the badge or a rule, so a list that began on the
 * very next row was a paragraph continuing rather than an answer to the key just pressed.
 *
 * IT IS COUNTED HERE AND DRAWN IN `region.ts`, and what makes that safe is the reason rather
 * than the arrangement: the arithmetic and the drawing have to agree about the geometry, and a
 * row the layout draws and this file does not count is a region one row taller than the
 * boundary this whole file exists to keep. It is spent only when there is a palette, because a
 * blank row over nothing is a blank row.
 *
 * ⚠️ THE PANEL'S ROW COSTS WERE CITED HERE AS THE PRECEDENT, and the precedent moved: this said
 * the number is in both files *for the reason the panel's row costs are in `panel.ts`*, and the
 * panel's two surviving numbers are ONE constant with two readers now — the arithmetic exports
 * them and the drawing imports them (`panel.ts`, `BETWEEN_COLUMNS`). This one is still a copy,
 * and saying so is the point of writing it down: the debt is here rather than there.
 */
const ABOVE_THE_PALETTE = 1;

/**
 * WHAT IT TAKES TO DRAW ONE WORD OF THE LIST — three rows, and they are read off what the
 * palette does with them rather than chosen: the word, the row that accounts for everything
 * with no room, and the row that says which keys move the list (`palette.ts`, `paletteFor`).
 * At two rows the account and the keys fill both and no word is drawn at all.
 *
 * IT IS A FLOOR AND NOT A RESERVATION, and the difference is the whole of why it is safe: it is
 * what the list gets when the page has nothing to spare, never what it is held to when the page
 * has more. A key that draws no word is indistinguishable from a key that does nothing, and
 * *nineteen things, none of them* is a worse answer than *one of nineteen*.
 */
const A_WORD = 3;

/**
 * How much shorter than the viewport a region has to be to be redrawn in PART.
 *
 * One row, and it is measured rather than chosen: the library treats a region as tall as
 * the viewport as a fullscreen one and redraws the whole screen for it, which is the path
 * that writes the erase this product will not write. Under it by one, it redraws the rows
 * it owns and nothing else.
 *
 * EXPORTED BECAUSE THE OPENING ASKS THE SAME QUESTION OF THE WHOLE PAGE. The drawing of the
 * name gives way when the page it is on stops fitting on the screen, and "fitting" there is
 * this same boundary for this same reason — so it is the one number, read twice, rather
 * than a margin the opening chose to agree with (`session.ts`, `presentation/banner.ts`).
 *
 * AND A THIRD READER, WHICH IS THE ROW UNDER THE AREA. The page is written so that the flow
 * ends on the last row the layout leaves to it, and the row it stops short of is this one
 * (`page.ts`): measured on a real terminal, the library writes a newline after the last row
 * of its frame, so a flow that reached the very last row would scroll the screen by one and
 * land in the same place — the identical row, kept for the other of the two reasons. What the
 * two readings together buy is that the arithmetic cannot go negative: the drawing is chosen
 * so that the opening, the area and this row fit, so the page always has room to be placed.
 */
export const BELOW_THE_VIEWPORT = 1;

/** What the area is drawing, once the two widths have been ruled on. */
interface Drawing {
  /** Whether the badge fits on one row, and there is one. */
  readonly badge: boolean;
  /** Whether the hint does. */
  readonly hint: boolean;
  /** How many rows the palette gets. */
  readonly palette: number;
}

/**
 * How many rows the palette takes, its own blank row counted — and none at all when it is
 * shut.
 *
 * ONE FUNCTION, READ BY BOTH ARITHMETICS below, because the height of the area and the depth
 * of the caret are the same sum read from two ends: a blank row counted in one and not in the
 * other is a caret one row away from the line it is meant to be on.
 */
function paletteRows(drawing: Drawing): number {
  return drawing.palette === 0 ? 0 : ABOVE_THE_PALETTE + drawing.palette;
}

/** How tall each form is, given what there is to draw around the row being typed. */
function heightOf(form: AreaForm, drawing: Drawing): number {
  const extras = paletteRows(drawing) + (drawing.hint ? HINT : 0);
  switch (form) {
    case 'full':
      return BADGE + RULE + TYPED + RULE + extras;
    case 'ruled':
      return RULE + TYPED + RULE + extras;
    case 'bare':
      return TYPED + extras;
  }
}

/** How many rows a form puts above the row being typed. */
function aboveIn(form: AreaForm, drawing: Drawing): number {
  switch (form) {
    case 'full':
      return paletteRows(drawing) + BADGE + RULE;
    case 'ruled':
      return paletteRows(drawing) + RULE;
    case 'bare':
      return paletteRows(drawing);
  }
}

/**
 * Which arrangement this terminal has room for: the tallest that fits, and the floor
 * when none does.
 *
 * "NO PROJECT, NO BADGE" IS DECIDED BY THE FORM NOT EXISTING rather than by a form that
 * draws an empty row, and the difference is arithmetic rather than taste: an arrangement
 * that reserved a row for a badge nobody has would count a row nothing draws, and every
 * number this file answers with would be one too many. A badge too wide for the window is
 * the same absence by the same construction.
 *
 * WHAT IT HAS TO FIT IN IS THE SCREEN WHILE THE LIST IS SHUT AND THE PAGE WHILE IT IS OPEN,
 * and the asymmetry is the decision above rather than a special case: the chrome is stable
 * because nothing but a list can make it give way, and a list may not push the page. With no
 * palette the two are the same question asked of a page that has none of the area's rows in
 * it yet, so nothing about a session that prints reaches this — which is exactly the
 * property that was wanted. With one, the list has already been cut to what the page has
 * left over the FLOOR ({@link roomForThePalette}), so the bare form always fits and the
 * ladder is asking which chrome fits on top of it.
 */
function formFor(request: AreaRequest, drawing: Drawing): AreaForm {
  const within = drawing.palette === 0 ? request.rows : request.rows - request.flow;
  const fits = (form: AreaForm): boolean => heightOf(form, drawing) + BELOW_THE_VIEWPORT <= within;
  if (drawing.badge && fits('full')) return 'full';
  if (fits('ruled')) return 'ruled';
  // The floor, answered whatever the height: a terminal too short for the row being typed
  // has nowhere to put a prompt, and there is nothing shorter to give it.
  return 'bare';
}

/**
 * Whether something of a given width is drawn on one row of this terminal.
 *
 * Zero is nothing to draw, and wider than the window is something that would be FOLDED —
 * which costs a second row nothing counted. It said the TERMINAL would fold it, and the
 * renderer that folds took that over (`presentation/folded.ts`); the answer here is the
 * same either way, because what this rules on is whether one row is enough, and a row that
 * has to become two is not one whoever breaks it. A window whose width the device never
 * reported answers no to both, for the reason the panel gives about the same silence: a
 * width nobody reported is not a width to guess at.
 */
function onOneRow(width: number, columns: number): boolean {
  return width > 0 && width <= columns;
}

/**
 * HOW MANY ROWS THE PALETTE MAY HAVE — a PREFERENCE, a FLOOR and a CEILING, in that order of
 * softness, and never more than the list asked for.
 *
 * ONE FUNCTION AND ONE SITE, because the three are one rule and they answer three different
 * questions:
 *
 *   - THE PREFERENCE IS WHAT THE PAGE HAS LEFT OVER, under the flow and over the area's own
 *     floor. It is what the list takes wherever there is anything to take, and taking it costs
 *     the caller nothing at all: those rows are the emptiness the region redraws (`page.ts`),
 *     so the list grows into them and the page does not move.
 *   - THE FLOOR IS ONE WORD, and it is what the list gets when the page has nothing to spare:
 *     {@link A_WORD} rows, which is a word, the count of what had no room, and the row of keys.
 *   - THE CEILING IS THE LIBRARY'S AND IT DOES NOT BEND: what is left of the SCREEN over the
 *     floor. Past it the region is as tall as the viewport and the layout stops redrawing part
 *     of the screen — the one path that carries the erase this product refuses to write. The
 *     floor may reach it and may not pass it.
 *
 * ⚠️ THE FLOOR WAS LEFT OUT, AND THE PREMISE FOR LEAVING IT OUT WAS HALF-MEASURED. It was
 * argued that a floor *carries the top of the drawing away, which is the defect this closes* —
 * true on a page that has just opened, where the drawing is on the screen and the page has
 * rows to spare anyway, and FALSE where the floor actually bites. What bites is a page with
 * nothing left over, and on that page the drawing has already scrolled away with the flow: what
 * the floor takes is the top of the FLOW, which is in the caller's scrollback and one scroll
 * away. Measured on the binary, at a hundred and twenty by forty and by thirty: after ONE
 * ordinary verb the list drew `… 19 not shown` and NOT ONE WORD, which is a console answering
 * *what can I type* with *nineteen things, none of them*. The rare loss was traded for a daily
 * one.
 *
 * SO THE PREFERENCE IS UNTOUCHED WHERE IT WAS RIGHT: a page with room to spare answers exactly
 * what it answered before the floor came back, because `max(floor, spare)` is `spare` there.
 *
 * ⚠️ AND AT A FLOW OF ZERO on a terminal with room for a word, every answer is still the one
 * this gave before the flow existed — `rows − 1 − floor − 1` — which is what the cases that pin
 * those numbers read.
 *
 * THE BLANK ROW COMES OFF ALL THREE FIRST, because the palette does not get to spend a row the
 * drawing is going to take.
 */
function roomForThePalette(request: AreaRequest, floor: number): number {
  const ceiling = Math.max(0, request.rows - BELOW_THE_VIEWPORT - floor - ABOVE_THE_PALETTE);
  const spare = Math.max(0, ceiling - request.flow);
  const least = Math.min(request.palette, A_WORD);
  return Math.min(request.palette, ceiling, Math.max(least, spare));
}

/**
 * The area for a terminal of a given size: the form, what is in it, where the caret goes,
 * and how tall the whole of it is.
 *
 * Pure, and asked again on every frame. It reads five numbers, so a caller that held the
 * answer would be holding a stale one the moment a Tab offered a word, a line landed or a
 * window moved.
 */
export function areaFor(request: AreaRequest): Area {
  const hint = onOneRow(request.hint, request.columns);
  const floor = TYPED + (hint ? HINT : 0);
  const drawing: Drawing = {
    badge: onOneRow(request.badge, request.columns),
    hint,
    palette: roomForThePalette(request, floor),
  };
  const form = formFor(request, drawing);
  return {
    form,
    above: aboveIn(form, drawing),
    height: heightOf(form, drawing),
    hint,
    palette: drawing.palette,
  };
}
