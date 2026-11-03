/**
 * WHAT ONE KEY DOES TO A QUESTION OF `mnema init`: the reducers, with no terminal in them.
 *
 * Three questions are put to a person (which hosts, who may accept, whether to go ahead), and every
 * one of them is the same small machine: a pick that moves, a mark that toggles where the question
 * is a multiselect, a key that answers and three that leave. Each is a function from a state and a
 * key to what happens next, which is what lets a case press every key of every question without a
 * device (`the-init-takes-every-key.test.ts`).
 *
 * THE ARROWS ARE THE LIST OF WORDS' ARROWS (`theNextPicked`, `repl/palette.ts`, the function the bare
 * name's menu moves its mark with), so the ends HOLD and there is one answer in this product to
 * *where does an arrow leave the pick*. A KEY THAT MEANS NOTHING HERE DOES NOTHING: a function key
 * must not be able to kill a question, and a chunk that is several keys at once is read as the keys it
 * is (`keystrokesOf`, in the loop that calls these).
 *
 * THE THREE WAYS OUT ARE ONE ANSWER, as they are in the menu of the bare name: Esc, Ctrl-C and Ctrl-D
 * are one intention (this is not what I wanted). The control chord is asked of the WHOLE keystroke
 * first, because a chord carries a character too (Ctrl-D is `d`), and a reducer that looked at the letter
 * before the chord would read a way out as somebody typing.
 */

import type { CompletionWord } from '../completion/tree.js';
import type { Keystroke } from '../repl/editing.js';
import { theNextPicked } from '../repl/palette.js';

/** What a key did to a question. */
export type Step<State, Answer> =
  /** The question goes on, with this state. */
  | { readonly kind: 'stay'; readonly state: State }
  /** The question is answered. */
  | { readonly kind: 'done'; readonly answer: Answer }
  /** The person left. */
  | { readonly kind: 'left' };

/** Which way an arrow moves the pick: one back, or one on. */
const BACK = -1;
const ON = 1;

/** Whether a key is one of the three ways out. The chord is asked first, of the whole keystroke. */
export function isALeave(stroke: Keystroke): boolean {
  if (stroke.ctrl) return stroke.input === 'c' || stroke.input === 'd';
  return stroke.escape;
}

/** Which way a key moves the pick, in a list drawn down (up and down) or along (left and right). */
function movement(stroke: Keystroke): -1 | 1 | undefined {
  if (stroke.upArrow || stroke.leftArrow) return BACK;
  if (stroke.downArrow || stroke.rightArrow) return ON;
  return undefined;
}

/** The state of the multiselect: which marks are on, and which row the pick is on. */
export interface Marked {
  readonly marks: ReadonlySet<string>;
  readonly picked: string;
}

/**
 * One key on the multiselect: arrows move, space toggles the row the pick is on, `a` toggles every row
 * (every row is on unless they all are), Enter answers with the marks that are on.
 */
export function onTheHosts(
  rows: readonly CompletionWord[],
  state: Marked,
  stroke: Keystroke,
): Step<Marked, ReadonlySet<string>> {
  if (isALeave(stroke)) return { kind: 'left' };
  if (stroke.ctrl) return { kind: 'stay', state };
  if (stroke.return) return { kind: 'done', answer: state.marks };
  const moved = movement(stroke);
  if (moved !== undefined) {
    return { kind: 'stay', state: { ...state, picked: theNextPicked(rows, state.picked, moved) } };
  }
  if (stroke.input === ' ') {
    const marks = new Set(state.marks);
    if (marks.has(state.picked)) marks.delete(state.picked);
    else marks.add(state.picked);
    return { kind: 'stay', state: { ...state, marks } };
  }
  if (stroke.input === 'a') {
    const every = rows.every((row) => state.marks.has(row.word));
    return {
      kind: 'stay',
      state: { ...state, marks: every ? new Set() : new Set(rows.map((row) => row.word)) },
    };
  }
  return { kind: 'stay', state };
}

/** One key on a question with one answer among a few: arrows move, Enter answers with the word picked. */
export function onTheOptions(
  options: readonly CompletionWord[],
  picked: string,
  stroke: Keystroke,
): Step<string, string> {
  if (isALeave(stroke)) return { kind: 'left' };
  if (stroke.ctrl) return { kind: 'stay', state: picked };
  if (stroke.return) return { kind: 'done', answer: picked };
  const moved = movement(stroke);
  if (moved !== undefined) {
    return { kind: 'stay', state: theNextPicked(options, picked, moved) };
  }
  return { kind: 'stay', state: picked };
}
