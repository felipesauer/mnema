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
 * do is take the row being typed or crowd the region past the boundary above: it is cut to
 * what is left over the floor, and the cut is REPORTED, so what it cannot show it says
 * (`palette.ts`).
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
 * IT IS COUNTED HERE AND DRAWN IN `region.ts`, and the number is in both files for the reason
 * the panel's row costs are in `panel.ts`: the arithmetic and the drawing have to agree about
 * the geometry, and a row the layout draws and this file does not count is a region one row
 * taller than the boundary this whole file exists to keep. It is spent only when there is a
 * palette, because a blank row over nothing is a blank row.
 */
const ABOVE_THE_PALETTE = 1;

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
 */
function formFor(request: AreaRequest, drawing: Drawing): AreaForm {
  const fits = (form: AreaForm): boolean =>
    heightOf(form, drawing) + BELOW_THE_VIEWPORT <= request.rows;
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
 * The area for a terminal of a given size: the form, what is in it, where the caret goes,
 * and how tall the whole of it is.
 *
 * Pure, and asked again on every frame. It reads four numbers, so a caller that held the
 * answer would be holding a stale one the moment a Tab offered a word or a window moved.
 */
export function areaFor(request: AreaRequest): Area {
  const hint = onOneRow(request.hint, request.columns);
  // WHAT IS LEFT OVER THE FLOOR is what the palette may have, and the floor is the bare
  // form without it: the row being typed, and the hint when there is one. So a palette
  // never pushes the region past the boundary the whole of this file exists to keep, and
  // a palette longer than the screen is CUT rather than drawn off the top.
  //
  // THE BLANK ROW COMES OFF IT FIRST, because the palette does not get to spend a row the
  // drawing is going to take. A terminal with room for one row of the list gets that row and
  // its separation; one with room for neither gets no palette, which is the same absence a
  // terminal that offered nothing gets.
  const floor = TYPED + (hint ? HINT : 0);
  const room = Math.max(0, request.rows - BELOW_THE_VIEWPORT - floor - ABOVE_THE_PALETTE);
  const drawing: Drawing = {
    badge: onOneRow(request.badge, request.columns),
    hint,
    palette: Math.min(request.palette, room),
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
