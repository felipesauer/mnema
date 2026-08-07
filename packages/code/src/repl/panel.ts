/**
 * HOW MUCH OF THE OPENING PANEL FITS — the arithmetic, and nothing about what it says.
 *
 * The console opens with a box: a title on its top border, the name drawn on the left
 * with the project under it, and on the right what the record is and what to type. That
 * is a drawing with a WIDTH, and a terminal narrower than it would fold the box into
 * nonsense — a border wrapped mid-row is worse than no border at all. So there are three
 * forms, the widest one that fits is the one drawn, and this file is the measurement.
 *
 * HOW WIDE THE BOX IS DRAWN AND WHICH DRAWING FITS ARE TWO QUESTIONS, and only the second
 * one is here. The box is drawn at the width of the TERMINAL — corner to corner, the way
 * the reference does it (measured: its corner lands on column 120 of 120) — and what this
 * file answers is which of the three arrangements the CONTENT has room for. The box used
 * to be as wide as what was inside it, which left a frame ending in the middle of the
 * screen and a ragged right edge under it; the arithmetic that chose the form did not
 * change when that did, because it never was about how much of the screen to take.
 *
 * THE THRESHOLD IS THE CONTENT'S OWN WIDTH, never a number somebody chose. It is the
 * rule the banner already works by (`presentation/banner.ts`): a form gives way when it
 * stops fitting, so the day a project's path gets longer or a verdict is reworded, the
 * panel degrades at the width that actually stopped working rather than at a constant
 * that drifted away from it. A number here would be a second opinion about how wide the
 * drawing is, and the drawing is the one that is right.
 *
 * IT MEASURES THE LINE AND DRAWS THE RENDERED ONE, and that is deliberate: a painted line
 * is longer in bytes and exactly as wide on a screen, so measuring the bytes would make
 * the panel degrade for having colour switched on. How wide a line is is asked of
 * `presentation/` (`widthOf`) rather than worked out here — nothing outside the wiring may
 * name a renderer, and a module that counted a line's characters its own way would be a
 * second opinion about how a line is punctuated.
 *
 * NOTHING HERE COMPOSES A LINE. What it receives is already lines — the same primitives
 * every other reading of this product is made of — and what it hands back is those lines
 * as bytes, grouped. The composing is the session's (`session.ts`), the placing is the
 * layout's (`region.ts`), and this is only the question of how much room there is.
 */

import type { Line } from '../presentation/line.js';
import { widthOf } from '../presentation/plain.js';
import type { Render } from '../presentation/render.js';

/**
 * The three forms, widest first — the same shape of choice the banner makes.
 *
 *   - `columns` — the box, with the mark and where the session is standing on the left,
 *     a rule, and the record and the hints on the right. What the reference showed.
 *   - `stacked` — the box, one column: the same groups, one under the other. What a
 *     terminal too narrow for two columns can still hold.
 *   - `bare` — no box. The same lines, in the same order, at the left edge, which is
 *     what this session printed before there was a panel at all.
 */
export type PanelForm = 'columns' | 'stacked' | 'bare';

/** What the panel is made of, as lines, before anything decides how much fits. */
export interface PanelRequest {
  /** How wide the terminal is, asked of the DEVICE by whoever opens the session. */
  readonly columns: number;
  /** How a line becomes bytes, resolved once for the whole session. */
  readonly render: Render;
  /** What the box is called, on its top border. */
  readonly title: Line;
  /** The name, drawn. */
  readonly mark: readonly Line[];
  /** Where the session is standing. Empty when it knows neither fact. */
  readonly standing: readonly Line[];
  /** What the record is: a heading, then one line per tree. Empty outside a project. */
  readonly record: readonly Line[];
  /** What to type: a heading, then the affordance that names the rest. */
  readonly hints: readonly Line[];
}

/** The panel as the layout receives it: bytes, grouped, and the form they go in. */
export interface Panel {
  /** Which drawing this terminal has room for. */
  readonly form: PanelForm;
  /**
   * How wide the terminal is, and therefore how wide the box is DRAWN.
   *
   * It used to be how wide the drawing came out, which is a different number and was
   * the one the form was chosen by. The field was not redefined, it was replaced: a name
   * that keeps its spelling and changes its meaning leaves whoever read it as a means
   * looking at something else, and the case that used the old one is red and named
   * rather than quietly wrong.
   */
  readonly columns: number;
  /** The title, on the border in a boxed form and on a line of its own in `bare`. */
  readonly title: string;
  /** The mark. The one group the layout paints, because it is chrome. */
  readonly mark: readonly string[];
  /** Where the session is standing, under the mark. */
  readonly standing: readonly string[];
  /** The record's section: its heading and its lines. */
  readonly record: readonly string[];
  /** The hints section: its heading and its lines. */
  readonly hints: readonly string[];
}

/**
 * How much a box costs around what is in it, in columns. Each is a fact about the
 * drawing in `region.ts`, and they are HERE because the choice of form and the drawing
 * have to agree about the geometry — two copies of these numbers is two panels, one of
 * which fits.
 */
/** The border, one column on each side. */
const BORDER = 2;
/** The gap between the border and what is inside it, both sides. */
const INSIDE = 2;
/** The gap after the left column, before the rule. */
const BETWEEN = 2;
/** The rule between the two columns. */
const DIVIDER = 1;
/** The gap after the rule, before the right column. */
const BESIDE = 2;
/**
 * What the title costs beyond its own width: the stub of border before it, a space on
 * each side of it, and the corner after it.
 */
const AROUND_TITLE = 5;

/**
 * WHAT THE PAGE OPENS WITH on a terminal of a given width: the box, or the absence of one
 * and the same lines instead.
 *
 * The two halves travel together because they are one answer to one question, and the
 * answer changes with the width: a terminal too narrow for a box gets none and gets
 * {@link panelLines} landed like any other line, so a width that crosses that threshold
 * moves the drawing from one half of this value to the other. Whoever asked for it at one
 * width and asked again at another has to be handed both, or the second answer would be a
 * box the console still had to work out where to put.
 *
 * `lines` is not only the panel's. It is everything the page opens with — the session adds
 * the sentence that says what it refuses — which is why this file composes none of it and
 * only says what the shape is.
 */
export interface Opening {
  /** The box, or none when the terminal is too narrow for one. */
  readonly panel: Panel | undefined;
  /** What is landed as the page opens, already bytes, in reading order. */
  readonly lines: readonly string[];
}

/**
 * Every line of the panel, in reading order — what a terminal with no room for a box
 * gets.
 *
 * The `bare` form is not a third drawing: it is the SAME lines, landed the way every
 * other line of this session lands, which is what the console printed before there was a
 * panel at all. So the order lives here, once, and the two boxed forms are the only place
 * anything is arranged.
 */
export function panelLines(panel: Panel): readonly string[] {
  return [panel.title, ...panel.mark, ...panel.standing, ...panel.record, ...panel.hints];
}

/** How wide the widest of some lines is, and zero when there are none. */
function widest(lines: readonly Line[]): number {
  return lines.reduce((most, line) => Math.max(most, widthOf(line)), 0);
}

/**
 * The panel for a terminal `columns` wide: the widest form that fits, and its lines as
 * bytes.
 *
 * `columns` is asked of the DEVICE by whoever opens the session and handed in, for the
 * reason the banner gives: nothing that composes a line may look at a terminal, and this
 * does not compose one.
 *
 * THIS USED TO SAY IT WAS ANSWERED ONCE, when the session opened, and that "a panel that
 * redrew itself narrower on a resize would be rewriting what the caller can scroll back
 * to". What falsified it is the box taking the width of the TERMINAL: while the drawing
 * was as wide as its own content, a terminal that shrank to eighty columns still had room
 * for it, and not redrawing cost nothing. Corner to corner, a session opened at a hundred
 * and twenty columns and shrunk to seventy is eight rows the terminal folds in half —
 * not-redrawing became the broken drawing. So the answer is asked again whenever the width
 * changes, and what the old sentence was protecting is protected by something else: the
 * page is carried into the scrollback before the new one is drawn, so nothing the caller
 * could scroll back to is rewritten, and this function is CALLED again rather than being a
 * value somebody mutated. It is still pure, it still reads nothing, and the record behind
 * `record` is still the one the session paid for when it opened
 * (`tests/the-page-follows-the-terminal.test.ts`, and the read counter in
 * `tests/the-name-and-the-hints.test.ts`).
 */
export function panelFor(request: PanelRequest): Panel {
  const { columns, render, title, mark, standing, record, hints } = request;
  const left = Math.max(widest(mark), widest(standing));
  const right = Math.max(widest(record), widest(hints));
  // The top border carries the title, so a box narrower than the title is a box whose
  // own name does not fit on it — which is a width the content alone cannot see.
  const titled = widthOf(title) + AROUND_TITLE;
  const sideBySide = Math.max(BORDER + INSIDE + left + BETWEEN + DIVIDER + BESIDE + right, titled);
  const oneOverTheOther = Math.max(BORDER + INSIDE + Math.max(left, right), titled);
  const form: PanelForm =
    sideBySide <= columns ? 'columns' : oneOverTheOther <= columns ? 'stacked' : 'bare';
  return {
    form,
    columns,
    title: render(title),
    mark: mark.map(render),
    standing: standing.map(render),
    record: record.map(render),
    hints: hints.map(render),
  };
}
