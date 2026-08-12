/**
 * HOW MUCH OF THE INPUT AREA FITS — the arithmetic, and nothing about what it says.
 *
 * The row being typed used to be one row with two rows under it. It is an AREA now: the
 * palette of words a caller could type next, a badge in the corner saying what the record
 * proved, a rule across the terminal, the row itself, a second rule, and the hint. It is the
 * BOTTOM of the three regions the page is made of — always at the foot, never moving, and
 * redrawn on every frame like the other two (`region.ts`).
 *
 * ⚠️ AND THIS FILE USED TO BE ABOUT A BOUNDARY THAT NO LONGER EXISTS. Every number in it was
 * chosen against one rule of the layout library: a region as tall as the viewport is redrawn
 * WHOLE, with a sequence carrying the erase of the caller's history inside it, and a region one
 * row shorter is redrawn in PART. So the area gave a row back, the opening was budgeted against
 * that row, and the palette was cut to whatever the page had left over the floor. All of it was
 * arithmetic about a console living in the caller's own buffer, using their scrollback as its
 * roll.
 *
 * THE CONSOLE OWNS THE SCREEN NOW, and the boundary went with the model. The frame is exactly
 * as tall as the terminal on every frame — that is what three fixed regions MEANS — so it is
 * fullscreen by construction and there is nothing to stay under. What the library does at that
 * height is measured rather than feared: a frame equal to the viewport is written in place,
 * and only a frame TALLER than it makes the library start the page over. The row that used to
 * be kept back is a row the page gets to use.
 *
 * SO THE AREA HAS FORMS, AND THEY ARE CHOSEN BY HEIGHT. It is the panel's rule (`panel.ts`)
 * applied to the other measurement: the widest form that fits is the one drawn, a form gives
 * way when it stops fitting, and the floor is what this console drew before there was an area
 * at all. A terminal with no room for the badge loses the badge; one with no room for the rules
 * loses the rules; what is left is the row being typed and the hint under it, which is what a
 * session has always had.
 *
 * ⚠️ AND *A TERMINAL* MEANT ANY TERMINAL, which is the premise a floor under the window took
 * away. This file was written on the rule every ladder of this surface was written on — whatever
 * the size, there is a rung — and what that produced at the bottom was a prompt with the product's
 * identity gone from the screen. Under eighty by twenty-four nothing is laid out at all now
 * (`floor.ts`), so the forms below `full` are reached by what is DRAWN rather than by how small a
 * window is: a list of words that grows, or a window too narrow for the badge to be one row.
 *
 * WHAT IT HAS TO FIT IN IS THE SCREEN LESS THE REGION ABOVE IT ({@link AreaRequest.header}),
 * and that is one rule where there used to be two. The top region is fixed: it is the same
 * height for a terminal of a given size whatever the session says, so an arrangement chosen
 * against what it leaves cannot come and go as lines land. What GROWS is the list of words, on
 * a keystroke, and it grows into the middle region — which costs nothing at all, because the
 * middle is a WINDOW onto what the session said and not the saying of it (`scrolling.ts`). A
 * list that takes the whole middle gives the whole middle back on the next key, and nothing
 * scrolled away in between.
 *
 * ⚠️ WHICH IS WHY THE PALETTE HAS ONE LIMIT WHERE IT USED TO HAVE THREE. It was a PREFERENCE
 * (what the page had left over), a FLOOR (one word, because a page with nothing to spare drew
 * the count of what had no room and not one word) and a CEILING (the library's boundary). The
 * preference and the floor were both about rows that were about to be lost — on a page whose
 * top scrolled into the caller's own history, taking a row was spending something. Nothing is
 * spent here. So the list takes what is left of the screen, and the only limit is that the
 * three regions together may not be taller than the terminal.
 *
 * WIDTH IS THE OTHER MEASUREMENT, AND IT WAS MISSING. The arithmetic counted a row per
 * thing to draw and the terminal counted two whenever a thing was wider than the screen —
 * a hint of seventy columns on a window of sixty is two rows, and every number this file
 * answered with was one too few. So a row that would be FOLDED is not drawn, which is the
 * same rule the forms already are, turned on the other axis: the hint and the badge each
 * have an "absent" form already, and this is what chooses it.
 *
 * NOTHING HERE DRAWS AND NOTHING HERE COMPOSES. It receives what there is to show as
 * numbers — how wide each thing is, how many rows the palette wants, how many rows the region
 * above it takes — and answers with which arrangement there is room for, what is in it, and
 * where the caret goes; the drawing is the layout's (`region.ts`) and the words are the
 * session's (`session.ts`).
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
 *
 * ⚠️ AND THE HEIGHT NO LONGER WALKS THIS LADDER, which is worth saying where the ladder is
 * defined rather than leaving a reader to work it out. There is a FLOOR under the window
 * (`floor.ts`): no page is laid out under eighty by twenty-four, the region above may hold at most
 * a third of the screen (`panel.ts`), and the whole of the `full` form is five rows — so on every
 * window a caller can open, the height alone answers `full`. What still reaches the rungs under it
 * is the LIST of words growing into what is left ({@link roomForThePalette}) and a window too
 * narrow for the badge to be one row. The arithmetic is unchanged and it is still total; what
 * changed is which of its answers a device can produce.
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
   * HOW MANY ROWS THE REGION ABOVE TAKES — the fixed top of the page, which is the opening
   * (`panel.ts`).
   *
   * ⚠️ IT WAS THE FLOW ON THE SCREEN, and the two are opposites rather than variants. That one
   * was everything the session had said that a reader could still see: it GREW as lines landed,
   * it shrank when a window carried rows off the top, and it had to be followed from frame to
   * frame because scrolling cannot be undone. This one is a function of the terminal's size and
   * of nothing else — it is the same number on the first frame and the ten-thousandth — because
   * what the session says goes in the MIDDLE region now and never above.
   *
   * IT IS WHY THE ARRANGEMENT IS STABLE. An area budgeted against something that grows is an
   * area that gives way while a session prints, which is the foot of the page changing shape on
   * every line; budgeted against the region above it, nothing but a resize can move it.
   *
   * ZERO IS A PAGE WITH NOTHING ABOVE THE AREA, and it is what the opening asks with
   * (`session.ts`): the drawing is being CHOSEN at that moment, so its height is what the
   * question is about and cannot also be an input to it. Every number this file gave before this
   * field existed is the answer it gives at zero.
   */
  readonly header: number;
}

/** Which arrangement the terminal has room for, and the numbers that follow from it. */
export interface Area {
  /** The arrangement to draw. */
  readonly form: AreaForm;
  /**
   * How many rows sit ABOVE the row being typed, inside the area — which is where the caret
   * goes, once the two regions over it have been counted.
   *
   * The layout puts the real caret at an offset into the frame it draws, and the row being
   * typed stopped being the first of those the moment anything was drawn over it. A layout
   * that worked this out itself would be a second opinion about the shape this file just
   * chose.
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
 * row the layout draws and this file does not count is a frame one row taller than the screen
 * it is drawn on. It is spent only when there is a palette, because a blank row over nothing is
 * a blank row.
 */
const ABOVE_THE_PALETTE = 1;

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
 * Which arrangement this terminal has room for: the tallest that fits under the region above
 * it, and the floor when none does.
 *
 * "NO PROJECT, NO BADGE" IS DECIDED BY THE FORM NOT EXISTING rather than by a form that
 * draws an empty row, and the difference is arithmetic rather than taste: an arrangement
 * that reserved a row for a badge nobody has would count a row nothing draws, and every
 * number this file answers with would be one too many. A badge too wide for the window is
 * the same absence by the same construction.
 *
 * ⚠️ IT ASKED TWO QUESTIONS AND IT ASKS ONE. The old rule measured the chrome against the whole
 * SCREEN while the list was shut and against the page while it was open, because the chrome had
 * to be stable as a session printed and the list had to be stopped from pushing the page off
 * the top. There is no page to push now: what a session says is a window onto a roll of its own
 * ({@link AreaRequest.header}), so both halves collapse into what is left of the screen after
 * the region above.
 */
function formFor(request: AreaRequest, drawing: Drawing): AreaForm {
  const within = Math.max(0, request.rows - request.header);
  const fits = (form: AreaForm): boolean => heightOf(form, drawing) <= within;
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
 * HOW MANY ROWS THE PALETTE MAY HAVE — what is left of the screen under the region above and
 * over the area's own floor, and never more than the list asked for.
 *
 * ⚠️ IT WAS THREE LIMITS AND IT IS ONE, and what took the other two away is the model rather
 * than a simplification. The PREFERENCE was what the page had left over: taking more than that
 * carried the top of the page into the caller's scrollback, permanently, so the list was held
 * to the emptiness. The FLOOR was one word underneath it, because holding the list to a page
 * with nothing spare made it draw the count of what had no room and NOT ONE WORD — a console
 * answering *what can I type* with *nineteen things, none of them*. Both were about rows that
 * were about to be lost.
 *
 * NOTHING IS LOST NOW. The rows the list takes come out of the middle region, which is a WINDOW
 * onto what the session said: a list twenty rows tall hides twenty rows of the roll, and the
 * next keystroke shows them again, in the same order, having never gone anywhere
 * (`scrolling.ts`). So there is nothing to prefer and nothing to floor — the list shows what
 * fits, and what fits is everything the screen has under the opening.
 *
 * THE BLANK ROW COMES OFF FIRST, because the palette does not get to spend a row the drawing is
 * going to take.
 */
function roomForThePalette(request: AreaRequest, floor: number): number {
  const room = request.rows - request.header - floor - ABOVE_THE_PALETTE;
  return Math.min(request.palette, Math.max(0, room));
}

/**
 * The area for a terminal of a given size: the form, what is in it, where the caret goes,
 * and how tall the whole of it is.
 *
 * Pure, and asked again on every frame. It reads five numbers, so a caller that held the
 * answer would be holding a stale one the moment a Tab offered a word, the window moved or a
 * different drawing was chosen above it.
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
