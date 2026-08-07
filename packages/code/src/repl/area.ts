/**
 * HOW MUCH OF THE INPUT AREA FITS — the arithmetic, and nothing about what it says.
 *
 * The row being typed used to be one row with two rows under it. It is an AREA now: a
 * badge in the corner saying what the record proved, a rule across the terminal, the row
 * itself, a second rule, and the hint. That is five rows where there were three, and the
 * two extra ones are not free — they are rows the layout REDRAWS, and the library that
 * redraws them gives up on redrawing PART of the screen once the region is as tall as the
 * viewport. What it does instead is redraw all of it, with a sequence that carries, inside
 * it, the one erase this product refuses to write: the caller's own history
 * (`a-page-that-opens-clean.test.ts` measures the boundary in both directions).
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
 * EVERY ROW THE AREA WILL DRAW IS COUNTED, including the one that comes and goes. A Tab
 * that could not choose between two verbs puts a row of them above the area, and a form
 * chosen as though that row did not exist would be arithmetic about a region that is not
 * the one on the screen — which is the exact shape of instrument this bench has been
 * wrong with before. The cost is that a Tab pressed on a terminal one row above the
 * threshold drops the badge for as long as the words are up, and that is the right trade:
 * the words answer the key that was just pressed.
 *
 * NOTHING HERE DRAWS AND NOTHING HERE COMPOSES. It receives three facts about what there
 * is to show and answers with which arrangement there is room for and where the caret
 * goes; the drawing is the layout's (`region.ts`) and the words are the session's
 * (`session.ts`).
 */

/**
 * The three forms, tallest first — the same shape of choice the panel makes.
 *
 *   - `full` — the badge in the corner, a rule, the row being typed, a rule, the hint.
 *     What the reference this was drawn from shows.
 *   - `ruled` — the same without the badge. A terminal that has room for the two rules
 *     and not for the row above them, and the arrangement a session outside a project
 *     gets at any height, because there is no record to name a level of.
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
  /** Whether there is a badge at all. Outside a project there is no level to name. */
  readonly badge: boolean;
  /** Whether a Tab left words it could not choose between on the page. */
  readonly candidates: boolean;
  /** Whether there is a hint under the row being typed. */
  readonly hint: boolean;
}

/** Which arrangement the terminal has room for, and the two numbers that follow from it. */
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
}

/** The row being typed. The one row every form has. */
const TYPED = 1;
/** The badge's row, above the first rule. */
const BADGE = 1;
/** One rule. There are two of them in the forms that have any. */
const RULE = 1;
/** The row of words a Tab could not choose between, when there is one. */
const OFFERED = 1;
/** The hint's row, under everything. */
const HINT = 1;

/**
 * How much shorter than the viewport a region has to be to be redrawn in PART.
 *
 * One row, and it is measured rather than chosen: the library treats a region as tall as
 * the viewport as a fullscreen one and redraws the whole screen for it, which is the path
 * that writes the erase this product will not write. Under it by one, it redraws the rows
 * it owns and nothing else.
 */
const BELOW_THE_VIEWPORT = 1;

/** How tall each form is, given what there is to show around the row being typed. */
function heightOf(form: AreaForm, request: AreaRequest): number {
  const extras = (request.candidates ? OFFERED : 0) + (request.hint ? HINT : 0);
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
function aboveIn(form: AreaForm, request: AreaRequest): number {
  const offered = request.candidates ? OFFERED : 0;
  switch (form) {
    case 'full':
      return offered + BADGE + RULE;
    case 'ruled':
      return offered + RULE;
    case 'bare':
      return offered;
  }
}

/**
 * Which arrangement this terminal has room for: the tallest that fits, and the floor
 * when none does.
 *
 * "NO PROJECT, NO BADGE" IS DECIDED BY THE FORM NOT EXISTING rather than by a form that
 * draws an empty row, and the difference is arithmetic rather than taste: an arrangement
 * that reserved a row for a badge nobody has would count a row nothing draws, and every
 * number this file answers with would be one too many.
 */
function formFor(request: AreaRequest): AreaForm {
  const fits = (form: AreaForm): boolean =>
    heightOf(form, request) + BELOW_THE_VIEWPORT <= request.rows;
  if (request.badge && fits('full')) return 'full';
  if (fits('ruled')) return 'ruled';
  // The floor, answered whatever the height: a terminal too short for the row being typed
  // has nowhere to put a prompt, and there is nothing shorter to give it.
  return 'bare';
}

/**
 * The area for a terminal of a given height: the form, where the caret goes, and how tall
 * the whole of it is.
 *
 * Pure, and asked again on every frame. It reads three booleans and a number, so a caller
 * that held the answer would be holding a stale one the moment a Tab offered a word.
 */
export function areaFor(request: AreaRequest): Area {
  const form = formFor(request);
  return { form, above: aboveIn(form, request), height: heightOf(form, request) };
}
