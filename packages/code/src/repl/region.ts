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
 * THE STYLE DECISIONS HERE ARE NOT ABOUT A REPORT, and there are two of them. The row of
 * candidates a Tab offers is dimmed, and it is the console's own affordance rather than a
 * line of the record. THE TIPS ARE NOT A SECOND ONE, and the difference is the whole
 * reason they read the same: they are dim because the renderer made them dim
 * (`presentation/detail.ts`, `aside`), so what says "you may skip this" is the same table
 * that says it about an id and an instant, and this file did not decide anything about
 * them at all.
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
 * SO COLOUR ON THIS SURFACE HAS TWO AXES NOW, and they may not meet. DATA is painted by
 * severity and by nothing else, which is `presentation/styled.ts` and unchanged. CHROME
 * is painted by ONE accent, spent here, and the accent is CYAN — chosen by elimination
 * rather than by taste: red, green and yellow are the three severities, and a frame that
 * borrowed one of them would be a box that looked like a verdict. `tests/the-panel.test.ts`
 * holds both halves: exactly one hue in this file, and it is none of the three.
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
import type { Keystroke } from './editing.js';
import type { Panel } from './panel.js';

/**
 * The one hue this layout spends, on the one thing it draws.
 *
 * Cyan by elimination: the three severities have red, green and yellow, so a frame in any
 * of them would read as a verdict about what it frames. There is no second accent, and
 * that is checked rather than intended.
 */
const ACCENT = 'cyan';

/** How the box is drawn. The library's own set of corners. */
const BORDER = 'round';

/** How much of the top border is drawn before the title sits on it. */
const BEFORE_TITLE = 2;

/** The gap after the left column, before the rule between the two. */
const BETWEEN_COLUMNS = 2;

/** The gap after the rule, before the right column. */
const BESIDE_THE_RULE = 2;

/** The gap between the border and what is inside it. */
const INSIDE_THE_BOX = 1;

/** The blank row between one section of the panel and the next. */
const BETWEEN_SECTIONS = 1;

/**
 * How the left column's groups sit inside it: in the MIDDLE of the widest of them.
 *
 * The mark is a drawing and the line under it is a path and an identity, and one of the
 * two is always much the wider. Left-aligned, the narrower one hangs off the left edge of
 * a column whose width the other one decided; centred, the column reads as one block —
 * which is what the reference this panel was drawn from does with the same two things.
 *
 * It is POSITION and nothing else. No line is padded, trimmed or lengthened; where a group
 * starts is exactly the kind of question a layout is allowed to answer.
 */
const IN_THE_MIDDLE = 'center';

/** Everything the console is showing, as one value read at one instant. */
export interface Shown {
  /** Every line the session has already said, oldest first. Never rewritten. */
  readonly past: readonly string[];
  /** The row being typed: the prompt and what is on it, already put together. */
  readonly present: string;
  /** What a Tab could not choose between, already put together. Empty when there is none. */
  readonly candidates: string;
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
   * The box the page opened with, or none when the terminal is too narrow for one.
   *
   * IT USED TO BE A PROP, on the argument that it was resolved once and never moved. What
   * falsified that is the width: the box is drawn corner to corner, so a caller who
   * narrows their window has a frame the terminal folds, and the console answers with the
   * page again — the opening recomposed for the new width, on a new {@link page}. It moves
   * with the page it belongs to, so it belongs where the page is.
   *
   * Nothing about it is READ here, and that has not changed: it arrives composed, out of
   * the read the session paid for when it opened, and this file only says where it goes.
   */
  readonly panel: Panel | undefined;
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
 * The console: the opening panel, everything already said, then the row being typed, then
 * what to do next.
 *
 * THE TIPS ARE A PROP AND THE PANEL IS WATCHED, and that used to be one sentence about
 * both: they were resolved once when the session opened and never moved again, so putting
 * either in the value rebuilt on every keystroke would have said they might. The tips are
 * still that. The panel is not — it is drawn at the width of the TERMINAL, and a caller
 * who resizes theirs gets the page again with the box recomposed for it, which is a move.
 * So it travels with {@link Shown}, beside the page identity it changes with.
 *
 * WHAT THE OLD SENTENCE WAS PROTECTING IS UNTOUCHED, and it is worth saying plainly
 * because it is the expensive half: the panel is the one thing on this surface paid for
 * with a read of the record, and nothing here re-reads it. A recomposition is the console
 * calling a pure function over lines that already exist, once the terminal has stopped
 * changing size; a value the LAYOUT re-read on every frame would still be a replay loop,
 * and this is not one (`tests/the-name-and-the-hints.test.ts` counts the reads).
 */
export function Region({
  watched,
  tips,
}: {
  readonly watched: Watched;
  readonly tips: string;
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

  // The real caret, on the row being typed, at the offset the arrows moved it to. The
  // row is the first of the redrawn ones because everything above it is in the
  // scrollback and out of this frame.
  useEffect(() => {
    setCursorPosition({ x: shown.column, y: 0 });
  }, [shown.column, setCursorPosition]);

  return node(
    Box,
    { flexDirection: 'column' },
    node(Past, { panel: shown.panel, lines: shown.past, page: shown.page }),
    node(Present, { present: shown.present, candidates: shown.candidates, tips }),
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
 *     box is as wide as the terminal and a long line comes out broken across rows with
 *     real newlines in it — which is not what the same verb writes at a shell, where the
 *     line is one line and the TERMINAL is what folds it. One more than the string is
 *     long, so an empty line still has a box to be a row in; and a line carrying style
 *     is measured longer than it looks, which only ever makes the box roomier.
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
 * `accented` is the CHROME switch and it is false for everything that says something
 * about the record. What it is true for is the mark: the name drawn, which carries no
 * fact and is part of the frame the session puts around itself, exactly like the border
 * it sits inside.
 *
 * No width is set, unlike the rows above: inside the panel the box is as wide as its
 * widest child and the library measures a line the way a terminal does, so a painted line
 * takes the room it takes on a screen rather than the room its bytes take. That the two
 * measurements agree with the one the FORM was chosen by is the panel's whole geometry,
 * and it is asserted (`tests/the-panel.test.ts`).
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
 * THE PANEL: the box the session opens with, in whichever of the two boxed forms the
 * terminal has room for.
 *
 * A terminal too narrow for either gets no panel at all and the same lines at the left
 * edge, which is decided before this component is reached (`panel.ts`, `session.ts`) —
 * so there is no third branch here, and the narrow case is not a drawing but the absence
 * of one.
 *
 * The title is a ROW rather than something laid over the border, and that is the whole
 * reason the box's top edge is drawn in three pieces: a stub, the title with a space on
 * each side, and the rest running to the corner. Laid over the border instead, the title
 * would need spaces of its own to push the border characters out from under it — and a
 * space a component adds to a line is a component composing one.
 */
function Opening({ panel }: { readonly panel: Panel }): ReactNode {
  return node(
    Box,
    // CORNER TO CORNER. How much of the screen the frame takes is the terminal's answer
    // and not the content's; which arrangement goes inside it is the content's and was
    // decided before this component was reached (`panel.ts`).
    { flexDirection: 'column', width: panel.columns },
    node(
      Box,
      { flexDirection: 'row' },
      node(Box, {
        borderStyle: BORDER,
        borderColor: ACCENT,
        borderBottom: false,
        borderRight: false,
        width: BEFORE_TITLE,
        height: 1,
      }),
      node(Box, { marginX: 1 }, node(Text, { color: ACCENT }, panel.title)),
      node(Box, {
        borderStyle: BORDER,
        borderColor: ACCENT,
        borderBottom: false,
        borderLeft: false,
        flexGrow: 1,
        height: 1,
      }),
    ),
    node(
      Box,
      {
        borderStyle: BORDER,
        borderColor: ACCENT,
        borderTop: false,
        flexDirection: panel.form === 'columns' ? 'row' : 'column',
        paddingX: INSIDE_THE_BOX,
      },
      ...(panel.form === 'columns' ? sideBySide(panel) : oneOverTheOther(panel)),
    ),
  );
}

/** The mark and where the session is standing, then a rule, then the two sections. */
function sideBySide(panel: Panel): ReactNode[] {
  return [
    node(
      Box,
      {
        key: 'left',
        flexDirection: 'column',
        alignItems: IN_THE_MIDDLE,
        paddingRight: BETWEEN_COLUMNS,
      },
      ...whereItStands(panel),
    ),
    node(
      Box,
      {
        key: 'right',
        flexDirection: 'column',
        borderStyle: BORDER,
        borderColor: ACCENT,
        borderTop: false,
        borderRight: false,
        borderBottom: false,
        paddingLeft: BESIDE_THE_RULE,
      },
      ...sections(panel, 0),
    ),
  ];
}

/** The same groups, one under the other, for a terminal too narrow for two columns. */
function oneOverTheOther(panel: Panel): ReactNode[] {
  return [...whereItStands(panel), ...sections(panel, BETWEEN_SECTIONS)];
}

/**
 * The mark, and under it where the session is standing.
 *
 * Each group is a box of its own rather than rows poured into one, and the reason is the
 * library's: a row is identified inside its parent by its POSITION, so two groups sharing
 * a parent would each have a first row claiming the same place. One box per group is what
 * makes each group's positions its own.
 */
function whereItStands(panel: Panel): ReactNode[] {
  return [
    node(Box, { key: 'mark', flexDirection: 'column' }, ...rows(panel.mark, true)),
    node(Box, { key: 'standing', flexDirection: 'column' }, ...rows(panel.standing)),
  ];
}

/**
 * The two sections, with a rule between them.
 *
 * `above` is what separates the FIRST of them from whatever precedes it, and it differs
 * between the two forms because what precedes it differs: beside the mark there is
 * nothing above the first section and its top row lines up with the top of the drawing,
 * while under the mark there is, and a section that started on the next row would read as
 * part of the group before it.
 *
 * THE RULE IS DRAWN AND NOT WRITTEN, which is the whole of how a layout forbidden to
 * compose a line is allowed to have one: it is a box with nothing in it and one edge
 * switched on, so the run of glyphs is the library's the way the frame around all of this
 * is. A string of dashes typed here would be text a component put on the page.
 *
 * IT IS AS WIDE AS THE SECTIONS ARE, and by construction rather than by a number: with
 * nothing inside it, it takes the width its siblings gave the column. So it measures the
 * column it divides, in either form, and no arithmetic anywhere had to be told about it.
 *
 * It stands where the blank row used to and it is CHROME, painted in the one accent, like
 * the frame it is part of — the reference this panel was drawn from separates the two
 * sections of its right-hand column exactly so (measured: a run of 63 in a terminal of
 * 120).
 */
function sections(panel: Panel, above: number): ReactNode[] {
  return [
    node(Box, { key: 'record', flexDirection: 'column', marginTop: above }, ...rows(panel.record)),
    node(Box, {
      key: 'between',
      borderStyle: BORDER,
      borderColor: ACCENT,
      borderBottom: false,
      borderLeft: false,
      borderRight: false,
      marginTop: BETWEEN_SECTIONS,
    }),
    node(Box, { key: 'hints', flexDirection: 'column' }, ...rows(panel.hints)),
  ];
}

/**
 * The row being typed, and under it the two rows that are about typing.
 *
 * The order is the order of how far each one is from the keystroke: the words a Tab could
 * not choose between answer the key that was just pressed, and the tips answer the whole
 * session. A row with nothing in it is left out rather than left blank — the candidates
 * are there only after an ambiguous Tab, and a session with nothing to suggest should not
 * push the caret up a line for an empty row.
 */
function Present({
  present,
  candidates,
  tips,
}: {
  readonly present: string;
  readonly candidates: string;
  readonly tips: string;
}): ReactNode {
  return node(
    Box,
    { flexDirection: 'column' },
    node(Text, null, present),
    candidates.length > 0 ? node(Text, { dimColor: true }, candidates) : null,
    tips.length > 0 ? node(Text, null, tips) : null,
  );
}
