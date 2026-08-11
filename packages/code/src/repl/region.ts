/**
 * WHERE A LINE LANDS — and nothing at all about what it says.
 *
 * This is the whole of the console's layout, and it is deliberately the only file on
 * this surface that a layout library reaches. Everything in it POSITIONS: a row for what
 * the session has already said, a row for what is being typed, the caret at the offset
 * the caller's arrows put it at, a place for the words a Tab could not choose between,
 * and a place for what the caller can do next.
 *
 * WHAT IS REDRAWN AND WHAT IS KEPT IS THE ONE DECISION THIS FILE MAKES ABOUT A LINE, and
 * it is about WHERE and never about what. The banner is written once and stays in the
 * scrollback, because it is the session's own opening and a caller scrolls back to the
 * top to find it. The TIPS are the other way round and for the reverse of the same
 * reason: a hint that has scrolled off the screen is not a hint, so they sit in the
 * region that is redrawn and stay under the row being typed for as long as the session
 * lives. Neither of them is composed here — both arrive as bytes a renderer produced.
 *
 * AND WHAT IS REDRAWN INCLUDES WHAT IS EMPTY, which is the one thing on the page that is not a
 * line at all: the rows between the flow and the input area ({@link theLeftover}). They are
 * there so the input ends on the last row the layout leaves, and they are HERE — in what is
 * redrawn — because that is what lets the area grow into them instead of into the screen. A
 * list of words twenty rows tall takes twenty rows of nothing and gives them back when it
 * shuts; the region is the same height throughout, so nothing of the caller's is carried away
 * by a menu that came and went (`page.ts`).
 *
 * NOTHING HERE COMPOSES A LINE, and that is the limit the whole decision to take a
 * layout library rests on. Five deliveries built ONE model of what a line of this
 * product says: `presentation/` answers with parts that carry a role, a renderer turns
 * them into bytes, and a golden holds the two renderers to saying the same thing. A
 * component that put a sentence together would be a SECOND model of that, and the most
 * expensive lesson of this series is that two ways of saying the same thing diverge in
 * silence — it was the opaque summary, the vocabulary typed out at twenty-seven sites,
 * the three READMEs that disagreed.
 *
 * So the rule is: a component receives strings and puts them somewhere. It never adds a
 * word, a separator, a padding or a punctuation mark of its own. That is not a habit,
 * it is checked — a scan over this file refuses a text literal, a template and a
 * concatenation, and the case that proves the scan works makes a component say
 * something and watches it go red.
 *
 * THE STYLE DECISIONS HERE ARE NOT ABOUT A REPORT, and there are two of them. The PALETTE
 * is dimmed — the words a caller could type next, whether a slash or a Tab asked for them
 * — and it is the console's own affordance rather than a line of the record. It used to be
 * one row and it is a list now; the decision is the same one and it did not grow.
 * THE TIPS ARE NOT A SECOND ONE, and the difference is the whole
 * reason they read the same: they are dim because the renderer made them dim
 * (`presentation/detail.ts`, `aside`), so what says "you may skip this" is the same table
 * that says it about an id and an instant, and this file did not decide anything about
 * them at all. THE BADGE IN THE CORNER IS NOT A THIRD: it says what the record proved, so
 * it is a line of the record, composed and rendered where every other one is
 * (`session.ts`) and only PLACED here — at the far end of its row, which is a position.
 *
 * THE SECOND IS THE ACCENT, AND IT IS CHROME. This sentence used to end "no line that
 * came from a renderer is touched, painted, padded or trimmed here", and the opening
 * panel is what falsified it: a box has a border, a border has a colour, and the title on
 * it and the mark inside it are the same object as the border — the frame the session
 * puts around itself. What survived, and what the guard now says, is the part that was
 * load-bearing: NO LINE OF THE RECORD is painted here. A verdict, a project's path, a
 * hint — everything that says something about what is written down — arrives with the
 * weight and the hue its renderer gave it and leaves with the same ones.
 *
 * ⚠️ AND THERE IS NO FRAME LEFT TO CARRY THE ACCENT. The box went — the console this was drawn
 * from writes its name and its context as text beside its logo and draws none — so what the
 * accent is spent on is the two things it was always really on: the MARK and the TITLE, which
 * say what the product is and nothing about the record. The rules the input area sits between
 * are the third and they are the frame's last surviving siblings ({@link rule}). The rule did
 * not change and the count did not change: ONE hue, spent in this file, and none of the three
 * severities.
 *
 * SO COLOUR ON THIS SURFACE HAS TWO AXES NOW, and they may not meet. DATA is painted by
 * severity and by nothing else, which is `presentation/styled.ts` and unchanged. CHROME
 * is painted by ONE accent, spent here, and the accent is MAGENTA — the hue this product
 * is marked by. ⚠️ IT WAS CYAN, AND THE ARGUMENT FOR IT WAS *chosen by elimination rather
 * than by taste*: red, green and yellow are the three severities, blue is a link, and cyan
 * was what was left. Elimination NARROWS and it does not choose — magenta survives the same
 * elimination, so what the argument really said was that any survivor would do, and the mark
 * of the product is a better reason than alphabetical luck. Nothing about the rule moved:
 * `tests/the-panel.test.ts` holds both halves, exactly one hue in this file and it is none of
 * the three severities.
 *
 * AND THERE IS NO ALTERNATE SCREEN, on purpose and against the first design. Measured:
 * this library redraws the changing rows in the NORMAL buffer and leaves everything the
 * session has already said permanently in the scrollback. The alternate screen — what
 * `vim` and `htop` take — DISCARDS the scrollback when the program exits, which is the
 * opposite of a session whose whole output a caller wants to keep reading afterwards.
 *
 * THAT PARAGRAPH USED TO BE THE WHOLE ANSWER TO "WHY DOES THE PAGE OPEN OVER SOMEBODY
 * ELSE'S OUTPUT", and it was answering a question nobody asked. The page opens CLEAN now,
 * and it is not the alternate screen and not an erase: everything on the screen is
 * SCROLLED into the scrollback and the cursor comes back to the top, which is the one
 * operation whose effect on the scrollback is defined (`page.ts`). Nothing of the
 * caller's is destroyed — it is one scroll up, where it always was. The same bytes are
 * what the caller gets when they ask for a clean page again, and the identity of the
 * region below is what makes the second one really clean rather than a redraw over the
 * first.
 */

import { Box, Static, type StaticProps, Text, useCursor, useInput, useStdout } from 'ink';
import { createElement as node, type ReactNode, useEffect, useSyncExternalStore } from 'react';
import type { Area } from './area.js';
import type { Keystroke } from './editing.js';
// THE TWO MEASUREMENTS OF THE ARRANGEMENT, read from where the arithmetic that chooses the
// form reads them. ⚠️ THEY WERE COPIED, and the copy was defended in as many words — *two
// copies of these numbers is two panels, one of which fits* — which named the risk and then
// took it. One constant, two readers.
import { BETWEEN_COLUMNS, BETWEEN_SECTIONS, type Panel } from './panel.js';

/**
 * The one hue this layout spends, on the things it draws — the mark, what the session is, and
 * the two rules the input area sits between.
 *
 * ⚠️ IT WAS SPENT ON A FRAME: the panel's border, the rule down the middle of it and the title
 * laid on its top edge. The frame is gone and the hue is not — what it is on is what the frame
 * was around.
 *
 * MAGENTA, and it is the mark of the product rather than the survivor of an elimination.
 * ⚠️ THE DOC HERE SAID *cyan by elimination* and the elimination is unchanged — the three
 * severities have red, green and yellow, so a frame in any of them would read as a verdict
 * about what it frames, and blue is a link. What that argument could not do is CHOOSE: it
 * leaves cyan and magenta both admissible, and this product is marked in one of the two.
 * There is still no second accent, and that is checked rather than intended.
 */
const ACCENT = 'magenta';

/**
 * How an EDGE is drawn — the library's own set, asked for by the only thing on this surface
 * that still has one: the two rules the input area sits between.
 *
 * ⚠️ IT WAS `How the box is drawn` AND IT NAMED THE PANEL'S FRAME. The frame is gone — the
 * console this was measured against writes its name and its context as text beside its logo
 * and draws no box at all — so what is left of the set is the top edge of a box with nothing
 * in it, which is how a rule across the terminal is drawn ({@link rule}). The four constants
 * that were the frame's geometry went with it: the stub of border before the title, the gap
 * inside the border, and the two halves of the gap on either side of the rule that divided the
 * columns.
 */
const BORDER = 'round';

/**
 * Where the badge sits on its row: at the far end of it.
 *
 * It is POSITION and nothing else, which is what makes it this file's to answer. The row
 * is as wide as the terminal, so the badge ends on the last column at every width and at
 * every length — no line is padded here, and no number about a terminal is written down.
 * A column chosen instead would be a badge that stops short on a wide screen and folds on
 * a narrow one, which is what the reference this was measured from does NOT do (its mark
 * lands on column 102 of 120, and the run after it ends on 120).
 */
const AT_THE_FAR_END = 'flex-end';

/**
 * THE MIDDLE — where the text beside the mark sits down the height the mark gave the row.
 *
 * ⚠️ IT ARRANGED BOTH COLUMNS AND IT ARRANGES ONE. ACROSS the left column its groups used to
 * sit in the middle of the widest of them, because the mark and the line under it were both in
 * there and one of the two was always much the wider. The place moved to the other column, so
 * the left one holds the drawing and nothing else — a column with one group in it has nothing
 * to centre, and an alignment kept there would be a word that could never change an answer.
 *
 * DOWN THE TEXT COLUMN it stayed, and it is the half with a measurement behind it. ⚠️ THE
 * SECTION SAT AT THE TOP and nothing said so — its top row lined up with the top row of the
 * drawing because that is where a column starts, not because anybody chose it. Measured at a
 * hundred and forty columns: fourteen rows of box, three of them the record, and NINE blank
 * rows under it. Centred, the gap is halved and shared, and what the text says sits at the
 * height of the mark it is beside.
 *
 * IT IS POSITION AND NOTHING ELSE. No line is padded, trimmed or lengthened; where a group
 * starts is exactly the kind of question a layout is allowed to answer.
 */
const IN_THE_MIDDLE = 'center';

/** Everything the console is showing, as one value read at one instant. */
export interface Shown {
  /** Every line the session has already said, oldest first. Never rewritten. */
  readonly past: readonly string[];
  /** The row being typed: the prompt and what is on it, already put together. */
  readonly present: string;
  /**
   * THE PALETTE: the words a caller could type next, one already-composed row each, top
   * first. Empty when there is none open.
   *
   * ⚠️ IT USED TO BE `candidates`, AND IT USED TO BE ONE STRING. What a Tab could not
   * choose between was joined into a row of bare tokens; it is a list of rows now, with a
   * column saying what each word is, and it is opened by a slash as well as by a Tab
   * (`palette.ts`). Renamed rather than redefined, because a field that keeps its
   * spelling while what it holds changes leaves whatever read it asserting the new shape
   * by accident.
   *
   * Composed and CUT before it arrives, like every other line here. How many rows there
   * are is the area's answer (`area.ts`) and how wide each one is is the palette's, so
   * this file has nothing to measure and nothing to shorten.
   */
  readonly palette: readonly string[];
  /** Which column of {@link present} the caret sits in. */
  readonly column: number;
  /**
   * WHICH PAGE THIS IS: the one the session opened with, and one more each time the
   * caller asked for a clean one.
   *
   * It is the IDENTITY of what is kept, and it is here rather than anywhere else because
   * the library reads it as one: a region written once and never taken back can only be
   * emptied by ceasing to be the same region. Handing it a new identity is also what
   * makes the library forget what it wrote there, which matters for a reason nothing on
   * the screen shows — it keeps a copy of everything written above, and there are frames
   * on which it replays the copy.
   */
  readonly page: number;
  /**
   * The arrangement the page opened with, or none when the terminal is too narrow for one.
   *
   * IT USED TO BE A PROP, on the argument that it was resolved once and never moved. What
   * falsified that is the width: a terminal narrowed past the threshold has the wrong
   * arrangement on it, and the console answers with the page again — the opening recomposed
   * for the new width, on a new {@link page}. It moves with the page it belongs to, so it
   * belongs where the page is.
   *
   * ⚠️ THE ARGUMENT USED TO BE SHARPER AND IT WAS THE FRAME'S: the box was drawn corner to
   * corner, so EVERY width was a width the drawing folded at. The frame is gone, so what
   * changes with a width is the arrangement and the art alone — the prop would be wrong less
   * often and still wrong, and less often is not a reason to hold a stale value.
   *
   * Nothing about it is READ here, and that has not changed: it arrives composed, out of
   * the read the session paid for when it opened, and this file only says where it goes.
   */
  readonly panel: Panel | undefined;
  /**
   * HOW MANY ROWS WITH NOTHING ON THEM SIT BETWEEN THE FLOW AND THE AREA — what is left of the
   * page once the flow and the area have taken their rows (`page.ts`, `theGap`).
   *
   * ⚠️ THEY USED TO BE LINES OF {@link past}, and that is the premise this delivery falsified.
   * The argument was that the region redrawn then stayed exactly as tall as the AREA, which is
   * true and was not the whole of it: the area changes height under a session, a region that
   * grows scrolls the screen, and what scrolls off the top does not come back. Measured on a
   * real terminal at a hundred and twenty by forty, one opening and shutting of the list of
   * words carried the whole opening away for good — the panel was a box then, and it was the
   * box that left.
   *
   * SO THE ROOM IS REDRAWN WITH THE AREA, and the list takes it out of HERE rather than out of
   * the screen: the two move in opposite directions on the same frame and the region's whole
   * height does not change, so nothing scrolls and the panel stays where the page put it. It
   * travels with {@link area} because it is a function of the same two things — how tall the
   * terminal is, and how tall the area is — and it is a number rather than rows, because a row
   * with nothing on it is a row this file draws and never a line it composes.
   */
  readonly gap: number;
  /**
   * WHICH ARRANGEMENT THE INPUT AREA IS IN, and where the caret goes inside it.
   *
   * It travels with what is shown rather than arriving as a prop, and the two reasons are
   * the two things it is a function of: how TALL the caller's terminal is, which changes
   * when they drag the bottom edge of their window, and whether a Tab left words on the
   * page, which changes on a keystroke. Both are answered before this value is built
   * (`area.ts`, `console.ts`); nothing is measured here.
   */
  readonly area: Area;
}

/** What the layout reads and what it reports back to. The console implements it. */
export interface Watched {
  /** What is showing right now. A new value whenever anything changed. */
  readonly now: () => Shown;
  /** Call back on every change; the answer stops the calling back. */
  readonly watch: (changed: () => void) => () => void;
  /** A key the caller pressed. What it means is decided elsewhere. */
  readonly pressed: (stroke: Keystroke) => void;
  /**
   * The layout is up: here is the door bytes of the console's own go through.
   *
   * The console has one thing to write that is not a line — the bytes that carry the
   * page into the scrollback — and while the layout is mounted it may not write them to
   * the device itself: the library keeps count of the rows it is redrawing, and a write
   * behind its back leaves that count pointing at the wrong ones. The door it offers
   * takes the frame down, writes, and puts the frame back.
   */
  readonly opened: (write: (bytes: string) => void) => void;
}

/**
 * The console: the opening panel, everything already said, and then the input — the badge
 * in the corner, the row being typed between two rules, and what to do next.
 *
 * THE TIPS AND THE BADGE ARE PROPS AND THE PANEL IS WATCHED, and that used to be one
 * sentence about the first and the last: they were resolved once when the session opened
 * and never moved again, so putting either in the value rebuilt on every keystroke would
 * have said they might. The tips are still that, and the badge joined them — it says what
 * the record proved, out of the one read this surface pays for, and nothing that happens
 * inside a session changes it. The panel is not — which ARRANGEMENT the terminal has room for
 * is a function of its width, so a caller who narrows theirs past the threshold gets the page
 * again with the text under the mark instead of beside it, which is a move. So it travels with
 * {@link Shown}, beside the page identity it changes with.
 *
 * WHAT THE OLD SENTENCE WAS PROTECTING IS UNTOUCHED, and it is worth saying plainly
 * because it is the expensive half: the panel is the one thing on this surface paid for
 * with a read of the record, and nothing here re-reads it. A recomposition is the console
 * calling a pure function over lines that already exist, once the terminal has stopped
 * changing size; a value the LAYOUT re-read on every frame would still be a replay loop,
 * and this is not one (`tests/the-name-and-the-hints.test.ts` counts the reads).
 *
 * WHAT IS WATCHED AND IS NOT A LINE is the SHAPE of the input area, and it is watched for
 * two reasons that have nothing to do with a read: how TALL the caller's terminal is, and
 * whether a Tab left words on the page. Which arrangement there is room for is answered
 * before this file is reached (`area.ts`); all this one does is draw the one it is handed.
 */
export function Region({
  watched,
  tips,
  badge,
}: {
  readonly watched: Watched;
  readonly tips: string;
  readonly badge: string;
}): ReactNode {
  const shown = useSyncExternalStore(watched.watch, watched.now, watched.now);
  const { setCursorPosition } = useCursor();
  const { write } = useStdout();

  useInput((input, key) => {
    watched.pressed({ input, ...key });
  });

  // The one thing handed back rather than received. See {@link Watched.opened}.
  useEffect(() => {
    watched.opened(write);
  }, [watched, write]);

  // THE REAL CARET, on the row being typed, at the offset the arrows moved it to — and at
  // the depth the arrangement puts that row at. IT USED TO BE THE FIRST ROW OF THE REGION
  // and the doc here said so: everything above it was in the scrollback and out of this
  // frame. What falsified it is the area, which draws up to three rows over the row being
  // typed. How many is arithmetic and it is answered before this file is reached
  // (`area.ts`), so the caret and the drawing cannot come to disagree about the shape.
  //
  // ⚠️ IT WAS HANDED OVER IN AN EFFECT, AND AN EFFECT IS ONE FRAME LATE. Measured: the
  // caret opened three rows BELOW the prompt — where the terminal leaves it after the last
  // row of a frame — and corrected itself on the first keystroke. The library keeps what it
  // is handed in a ref and pushes it to the page during the COMMIT (`ink`, `useCursor`: an
  // insertion effect, which runs before the frame is written); a passive effect runs after
  // that, so what it sets is a position for the NEXT frame, and on the opening frame there
  // is no next one until a key is pressed. Handing it over while the frame is being
  // composed is what puts the caret on the row a caller is about to type on — and it is a
  // ref rather than state, so nothing is rendered twice for it
  // (`tests/the-opening-fits-the-screen.test.ts` compares the opening with the frame after
  // one keystroke: they used to disagree).
  //
  // ⚠️ AND THE OFFSET IS INTO THE WHOLE REGION AND NOT INTO THE AREA, which the leftover is
  // what falsified: the rows with nothing on them are the FIRST rows of what is redrawn now
  // (`page.ts`), so a caret placed at the area's own depth would open as many rows above the
  // prompt as the page had room to spare — twenty-one of them, measured at a hundred and twenty
  // by forty. Both halves are counted where each is answered: the leftover here, and how many
  // rows the arrangement draws over the row being typed in `area.ts`.
  setCursorPosition({ x: shown.column, y: shown.gap + shown.area.above });

  return node(
    Box,
    { flexDirection: 'column' },
    node(Past, { panel: shown.panel, lines: shown.past, page: shown.page }),
    theLeftover(shown.gap),
    node(Present, {
      present: shown.present,
      palette: shown.palette,
      area: shown.area,
      tips,
      badge,
    }),
  );
}

/** One thing that stays on the page: the opening panel, or a line the session said. */
type Kept = Panel | string;

/**
 * What the session has already said, written once and never redrawn — with the opening
 * panel first, when there is one.
 *
 * THE PANEL IS AN ITEM OF THIS LIST AND NOT A ROW ABOVE IT, and the reason is the
 * library's rather than the design's: what is written once and kept is one region, so a
 * panel outside it would be redrawn on every keystroke and a panel in a second one would
 * be the second such region, which this library does not have. It is always the first
 * item and it is never added to, so the list only ever grows at the end — which is the
 * one thing this component requires of what it is handed.
 *
 * Each line gets a box of its own, and the box's two measurements are the two ways a
 * layout can quietly change a line it was only asked to place:
 *
 *   - A ROW TALL WHATEVER IS IN IT, because a line with NOTHING on it is still a line.
 *     Text alone occupies no rows, so a report that separates its sections with blank
 *     lines would arrive with the separations gone. Measured against two reads of this
 *     product that do exactly that.
 *   - AS WIDE AS THE LINE IS LONG, so the layout never re-wraps it. Left to itself the
 *     box is as wide as the terminal and a long line comes out broken across rows by the
 *     library's own arithmetic — which is not what the same verb writes at a shell, and
 *     is not where the break belongs. ⚠️ THE REASON GIVEN USED TO BE *the line is one
 *     line and the TERMINAL is what folds it*, and `presentation/folded.ts` falsified it:
 *     the line arrives at a terminal already folded, between words and with the
 *     continuation indented, by the one renderer the whole product shares. Which makes
 *     this measurement matter MORE rather than less — a layout that re-wrapped a line
 *     that had already been folded well would fold it twice, and the second fold is the
 *     one at the margin. One more than the string is long, so an empty line still has a
 *     box to be a row in; and a line carrying style is measured longer than it looks,
 *     which only ever makes the box roomier.
 *
 * The child is passed as a PROP rather than as an argument, against the lint's advice
 * and with its suppression: this component's child is a FUNCTION OF AN ITEM rather than a
 * node, and a variadic child argument can only be handed a node.
 */
function Past({
  panel,
  lines,
  page,
}: {
  readonly panel: Panel | undefined;
  readonly lines: readonly string[];
  readonly page: number;
}): ReactNode {
  const kept: Kept[] = panel === undefined ? [...lines] : [panel, ...lines];
  return node<StaticProps<Kept>>(Static, {
    // WHAT MAKES A CLEAN PAGE CLEAN. This region is written once and never taken back,
    // so the only way to empty it is for it to stop being the same region — and the
    // library answers a new identity by forgetting everything the old one wrote, which
    // is what keeps the cleared lines from coming back on a frame that replays them.
    key: String(page),
    items: kept,
    // biome-ignore lint/correctness/noChildrenProp: a variadic child cannot be a function
    children: (item: Kept, index: number) =>
      typeof item === 'string'
        ? node(
            Box,
            { key: String(index), minHeight: 1, width: item.length + 1 },
            node(Text, null, item),
          )
        : node(Opening, { key: String(index), panel: item }),
  });
}

/**
 * Some already-rendered lines, one to a row, with nothing added to any of them.
 *
 * `accented` is the CHROME switch and it is false for everything that says something about
 * the record. What it is true for is the two things that say nothing about it: the mark — the
 * name drawn, which carries no fact — and the title, which says what the product and the
 * session are. ⚠️ IT WAS TRUE FOR THE MARK ALONE, and the border and the title on it were
 * painted where they were drawn; with the border gone the title is a row like any other, so
 * the switch is what carries the accent onto it. There is no third, and that is checked rather
 * than intended (`tests/the-panel.test.ts`).
 *
 * No width is set, unlike the rows above: inside the panel each group is as wide as its widest
 * child and the library measures a line the way a terminal does, so a painted line takes the
 * room it takes on a screen rather than the room its bytes take. That the two measurements
 * agree with the one the FORM was chosen by is the panel's whole geometry, and it is asserted
 * (`tests/the-panel.test.ts`).
 */
function rows(lines: readonly string[], accented = false): ReactNode[] {
  return lines.map((line, index) =>
    node(
      Box,
      { key: String(index), minHeight: 1 },
      node(Text, accented ? { color: ACCENT } : null, line),
    ),
  );
}

/**
 * THE PANEL: the name drawn, and what the session is — in whichever of the two arrangements
 * the terminal has room for.
 *
 * A terminal too narrow for either gets no panel at all and the same lines at the left
 * edge, which is decided before this component is reached (`panel.ts`, `session.ts`) —
 * so there is no third branch here, and the narrow case is not a drawing but the absence
 * of one.
 *
 * ⚠️ THERE WAS A BOX AROUND IT, drawn corner to corner, with the title laid on its top edge
 * in three pieces — a stub of border, the title with a space on each side, and the rest
 * running to the corner. All of it is gone: the reference this panel was measured against
 * writes its name, its build and its context as text beside its logo and draws no frame, and
 * the frame was the one thing on this surface a component painted for a reason that was not
 * the record's. What the box cost is measured rather than remembered — two rows of edge, four
 * columns of border and gap, and the arrangement that had to be chosen around them — and what
 * replaces it costs the drawing of the name and nothing more.
 *
 * ⚠️ AND WITH IT WENT THE WIDTH. The box took the terminal's, so this component was handed one;
 * nothing here is drawn to an edge now, so every row is as wide as what is on it and the panel
 * has no width to be told (`panel.ts`, {@link Panel}).
 */
function Opening({ panel }: { readonly panel: Panel }): ReactNode {
  return node(
    Box,
    { flexDirection: panel.form === 'columns' ? 'row' : 'column' },
    ...(panel.form === 'columns' ? sideBySide(panel) : oneOverTheOther(panel)),
  );
}

/**
 * The mark, and beside it what the session is — with the text in the middle of the height the
 * mark gave the row.
 *
 * THE TEXT COLUMN IS AS TALL AS THE ROW, by construction rather than by a number: a column of
 * a row takes the row's height, and the row is as tall as its tallest child, which is the
 * drawing. So {@link IN_THE_MIDDLE} has a height to be in the middle of, and nothing here
 * counts a row.
 *
 * THE GAP IS ON THE MARK'S SIDE OF IT, which is one place rather than two: it used to be a
 * padding on each of them with a rule in between, and there is nothing in between.
 */
function sideBySide(panel: Panel): ReactNode[] {
  return [
    node(
      Box,
      { key: 'mark', flexDirection: 'column', paddingRight: BETWEEN_COLUMNS },
      ...rows(panel.mark, true),
    ),
    node(
      Box,
      { key: 'beside', flexDirection: 'column', justifyContent: IN_THE_MIDDLE },
      ...whatItSays(panel),
    ),
  ];
}

/**
 * The same groups, one under the other, for a terminal too narrow to put the text beside the
 * mark.
 *
 * THE MARK IS FIRST, and it is the same reading order the other form has across the screen
 * rather than a second one: the drawing, then what the session is. ⚠️ THE TITLE USED TO BE
 * FIRST here, because the frame drew it above everything.
 */
function oneOverTheOther(panel: Panel): ReactNode[] {
  return [group('mark', panel.mark, true), ...whatItSays(panel)];
}

/**
 * WHAT THE SESSION IS, WHERE IT IS STANDING, AND WHAT THE RECORD IS — the three groups that
 * go beside the mark, in that order, in both arrangements.
 *
 * ⚠️ THE FIRST OF THEM WAS ON THE BOX'S TOP BORDER and the second was under the mark. Moving
 * them here is the whole of what the frame's departure bought: the drawing is nine rows and
 * the text is five, so text BESIDE the mark costs the page the mark alone, and text under it
 * cost the page both.
 *
 * THE TITLE IS PAINTED AND THE OTHER TWO ARE NOT, which is the same switch the mark is drawn
 * with and the same reason: it says what the session is rather than anything about the record.
 * It is the accent's second and last place, exactly as it was when the border carried it.
 */
function whatItSays(panel: Panel): ReactNode[] {
  return [group('title', [panel.title], true), group('standing', panel.standing), theRecord(panel)];
}

/**
 * Some already-rendered lines as one group of rows, under a key of its own.
 *
 * ONE BOX PER GROUP rather than rows poured into one parent, and the reason is the library's:
 * a row is identified inside its parent by its POSITION, so two groups sharing a parent would
 * each have a first row claiming the same place.
 */
function group(key: string, lines: readonly string[], accented = false): ReactNode {
  return node(Box, { key, flexDirection: 'column' }, ...rows(lines, accented));
}

/**
 * WHAT THE RECORD IS: the one section of the panel, and everything it says that is not the
 * name, the build or the place.
 *
 * A BLANK ROW OVER IT, IN BOTH ARRANGEMENTS. ⚠️ IT WAS THE STACKED FORM'S ALONE, on a premise
 * this delivery falsified: *beside the mark there is nothing above it and its top row lines up
 * with the top of the drawing*. That was true while the column held the record and nothing
 * else. What the session is and where it is standing are above it in both forms now, so a
 * section that started on the next row would read as part of the group before it either way —
 * and the argument the two forms differed by is the same argument that now applies to both.
 *
 * ⚠️ IT USED TO BE TWO SECTIONS WITH A RULE BETWEEN THEM, and this was `sections`. The
 * second section said what to type; it went because the row under the prompt says it too,
 * in the place that does not scroll away (`session.ts`, `tips`). The rule went WITH it —
 * with one section there is nothing left to divide — and the function is renamed rather
 * than emptied, so a case that was using the rule as a means went red instead of quietly
 * measuring nothing.
 *
 * ⚠️ AND THE RULE'S OWN DOC WAS A FALSE PREMISE, which is why it is written down here
 * rather than deleted with it. It said: *"IT IS AS WIDE AS THE SECTIONS ARE, and by
 * construction rather than by a number: with nothing inside it, it takes the width its
 * siblings gave the column."* That was true while the box hugged its content, so the column
 * was as wide as what was in it and the two were the same number. The box was drawn corner
 * to corner once the page began following the terminal, so the column was STRETCHED and the
 * rule went on measuring its siblings: a run of 45 columns inside a column of 61, measured
 * on a real terminal 120 wide. What it divided and what it looked like it divided had come
 * apart, and no arithmetic anywhere knew — the rule cost no columns, so nothing counted it.
 * There is no box to stretch a column now, which is why this is the last delivery that could
 * have said it.
 */
function theRecord(panel: Panel): ReactNode {
  return node(
    Box,
    { key: 'record', flexDirection: 'column', marginTop: BETWEEN_SECTIONS },
    ...rows(panel.record),
  );
}

/**
 * WHAT IS LEFT OF THE PAGE, DRAWN: that many rows with nothing on them, between the flow and
 * the input area.
 *
 * ROWS AND NOT LINES, which is what keeps this file from composing one — a box with a minimum
 * height is a row of the page with nothing put on it, exactly like the row over the palette.
 * And ONE box rather than one per row: what it is is a single stretch of nothing, and a stretch
 * of nothing has a height and no parts.
 *
 * ⛔ IT IS PART OF WHAT IS REDRAWN, and that is the whole mechanism rather than an
 * implementation detail. The area changes height while a session runs — a list of words opens
 * twenty rows tall and shuts on the next keystroke — and this is what it takes those rows OUT
 * of: the two change by the same amount on the same frame, so the region's total height does
 * not move, the terminal never scrolls for it, and what the page opened with stays on the
 * screen. Rows kept in the flow instead could only ever be appended, which is why the box used
 * to leave for good on the first list a caller opened (`page.ts`).
 *
 * NONE AT ALL IS NO BOX, and not a box of no rows: a page whose flow already fills the screen
 * is the case this surface had before there was a leftover, and it draws what it drew then.
 *
 * HOW MANY IS NOT A FUNCTION OF WHAT THE SESSION SAID but of what is still on the screen, and the
 * difference is a page that scrolled: what went off the top is in the caller's scrollback, and the
 * frame after it has to be placed against what SURVIVED (`console.ts`, `flowOnScreen`). Nothing of
 * that is decided here — the number arrives.
 *
 * ⚠️ AND IT SAID *a list too long for the room a page has to spare still costs the flow its top
 * rows*, which was true and is the residual this frontier then closed. The list was budgeted
 * against the SCREEN, so on a page with little to spare it took the difference off the top —
 * measured, at a hundred by thirty and at eighty by twenty-four, as the drawing of the name going
 * on the first keystroke. It is budgeted against this leftover now (`area.ts`,
 * `AreaRequest.flow`), so a list that does not fit shows fewer words and says how many rather than
 * spending the page.
 */
function theLeftover(many: number): ReactNode {
  return many > 0 ? node(Box, { key: 'leftover', minHeight: many }) : null;
}

/**
 * THE INPUT AREA: the row being typed, between two rules, with the badge over it and the
 * hint under it.
 *
 * IT USED TO BE THREE ROWS IN ONE ORDER — the row being typed, then the words a Tab could
 * not choose between, then the tips — and the doc here said the order was "how far each
 * one is from the keystroke". WHAT FALSIFIED IT IS THE REFERENCE, measured rather than
 * remembered: the input of the console this was drawn from is not a box, it is two runs of
 * the terminal's full width with the row between them, and the badge is one row above the
 * upper one, at the far end of it. Both rules are drawn corner to corner, which is why
 * nothing here says how wide anything is.
 *
 * THE WORDS A TAB OFFERED MOVED ABOVE THE RULES, and that is the one part of the old order
 * that changed on purpose rather than by measurement: they answer the key that was just
 * pressed, and what answers a keystroke belongs over the input rather than under it. That
 * is also where the list of commands went, exactly as this paragraph said it would: the
 * PALETTE is those rows, opened by a slash as well as by a Tab, and two things that answer
 * the same key may not appear on opposite sides of the row it was typed on.
 *
 * WHICH ROWS THERE ARE IS NOT DECIDED HERE. A terminal without the height for all of them
 * gets fewer, tallest arrangement first, and a terminal too narrow for the hint or the
 * badge to be ONE row gets neither — both are `area.ts`, which is the same split the panel
 * already has between how much fits and what is drawn. A row with nothing in it is still
 * left out rather than left blank, which is the half of the old shape that survived whole.
 *
 * THE RULES ARE DRAWN AND NOT WRITTEN: a box with nothing in it and one edge switched on, so
 * the run of glyphs is the library's. A string of dashes typed here would be text a component
 * put on the page. They are CHROME and they take the one accent this file spends. ⚠️ THIS SAID
 * *exactly as the one inside the panel is* and *like the frame they are the siblings of*, and
 * the panel has neither: the frame went, and these two are the only edges left on the surface.
 */
function Present({
  present,
  palette,
  area,
  tips,
  badge,
}: {
  readonly present: string;
  readonly palette: readonly string[];
  readonly area: Area;
  readonly tips: string;
  readonly badge: string;
}): ReactNode {
  const ruled = area.form !== 'bare';
  return node(
    Box,
    { flexDirection: 'column' },
    palette.length > 0
      ? node(Box, { flexDirection: 'column' }, breathing(), ...dimmed(palette))
      : null,
    area.form === 'full'
      ? node(Box, { justifyContent: AT_THE_FAR_END }, node(Text, null, badge))
      : null,
    ruled ? rule() : null,
    node(Text, null, present),
    ruled ? rule() : null,
    area.hint ? node(Text, null, tips) : null,
  );
}

/**
 * The palette's rows, one to a row, dimmed.
 *
 * THE ONE PLACE THIS FILE DECIDES A WEIGHT, and it is the same decision it has made since
 * a Tab first offered two words: what a caller could type next is the console's own
 * affordance rather than a line of the record, so it reads as one. It is not a hue and it
 * is not a severity — nothing about the record is being ruled on — and it is not a second
 * accent, because dimming is the absence of colour rather than a colour.
 *
 * Nothing is added to a row and nothing is taken off one: they arrive composed, padded and
 * cut (`palette.ts`), and all this does is put each on a row of its own.
 */
function dimmed(rows: readonly string[]): ReactNode[] {
  return rows.map((row, index) => node(Text, { key: String(index), dimColor: true }, row));
}

/**
 * THE BLANK ROW OVER THE PALETTE: a box with nothing in it, one row tall.
 *
 * A ROW AND NOT A LINE, which is what keeps this file from composing one. There is no string
 * here, empty or otherwise — a box with a minimum height is a row of the page with nothing
 * put on it, exactly like the row a landed empty line gets above.
 *
 * WHY IT IS HERE AT ALL is the palette reading as part of what is above it rather than as an
 * answer to the key just pressed. The row is COUNTED where the region's height is worked out
 * (`area.ts`, `ABOVE_THE_PALETTE`), because a row this file drew and that file did not count
 * is a region one row taller than the boundary the library redraws in part below.
 */
function breathing(): ReactNode {
  return node(Box, { key: 'breathing', minHeight: 1 });
}

/**
 * One rule across the whole terminal: a box with nothing in it and its top edge on.
 *
 * AS WIDE AS THE TERMINAL BY CONSTRUCTION, and that is the whole reason it is drawn this
 * way. With nothing inside it, the box takes the width its parent gives it, and its parent
 * is the column the library laid out at the width of the device — so the run follows a
 * caller who resizes their window without anything here being told a number. A run
 * composed from a width would be this file doing arithmetic about a terminal, and the one
 * measurement of a terminal on this surface is asked in one place (`console.ts`).
 */
function rule(): ReactNode {
  return node(Box, {
    borderStyle: BORDER,
    borderColor: ACCENT,
    borderBottom: false,
    borderLeft: false,
    borderRight: false,
  });
}
