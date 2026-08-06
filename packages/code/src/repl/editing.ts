/**
 * THE LINE BEING TYPED, AS A VALUE — one total function from a keystroke to the next line.
 *
 * The console reads keys and the console draws; between those two there is a question
 * nobody should have to open a terminal to ask: given what is on the input row and a key
 * that was pressed, what is on it now? That question is answered here, by a pure
 * function over a value, so every answer to it — the caret that walked past the end, the
 * history that was browsed and then typed into, the completion that had nothing to add —
 * is a case with no device in it.
 *
 * IT IS NOT A COMPONENT AND IT NEVER DRAWS. Nothing here writes a byte, and nothing here
 * knows what a row looks like. That is the same division the rest of this surface makes
 * between what a line SAYS and where it lands, held one level lower: the layout library
 * owns the row, this owns what the row is showing.
 *
 * THE KEYS ARE THE ONES A PERSON'S FINGERS ALREADY KNOW, and the ones that are NOT here
 * are as much of the design as the ones that are. There is no word motion, no kill ring,
 * no reverse search: those are the affordances of a shell, and a session that grew them
 * would be growing into the shell it deliberately is not. What is here is the set that
 * makes a mistyped line fixable without retyping it.
 *
 *   - a character, at the caret; Backspace before it and Delete under it
 *   - the arrows, along the line and back through what was typed before
 *   - Tab, which asks the completer and takes what every candidate agrees on
 *   - Ctrl-A and Ctrl-E, the two ends; Ctrl-U, the whole line
 *   - Ctrl-C, which abandons the LINE, and Ctrl-D on an empty line, which leaves
 *
 * THE HISTORY LIVES HERE AND NOWHERE ELSE — in this value, for the length of the
 * process, written to no file. Where a history file would live is a decision about the
 * caller's home that nobody has taken, and this product writes inside its own record and
 * nowhere else.
 */

import type { Completer } from './complete.js';

/** How many lines the session scrolls back through. In memory, and nowhere else. */
const REMEMBERED = 500;

/**
 * A key as this module needs it: the character it produced, and what it was.
 *
 * Declared here rather than taken from the library that reads the keyboard, and that is
 * the boundary rather than fussiness: the reducer below is the whole language of the
 * input row, and it is testable without a terminal exactly because it depends on nothing
 * that needs one.
 */
export interface Keystroke {
  /** What the key produced, if it produced a character. Empty for a bare modifier. */
  readonly input: string;
  readonly return: boolean;
  readonly backspace: boolean;
  readonly delete: boolean;
  readonly leftArrow: boolean;
  readonly rightArrow: boolean;
  readonly upArrow: boolean;
  readonly downArrow: boolean;
  readonly tab: boolean;
  readonly ctrl: boolean;
}

/** What is on the input row, and what the caller typed before it. */
export interface Editing {
  /** The line as it stands. */
  readonly typed: string;
  /** Where the caret is, as an offset into {@link typed}. Never past its end. */
  readonly at: number;
  /** Every line the caller submitted, oldest first. */
  readonly history: readonly string[];
  /**
   * Which remembered line is being shown, or the length of the history when none is.
   *
   * One index rather than a flag and an index, because the two can disagree: a browse
   * that ended by typing would leave a stale position behind, and the next Up would jump
   * to wherever the caller had been rather than to the line before this one.
   */
  readonly browsing: number;
  /** What Tab last offered when it could not decide. Cleared by the next key. */
  readonly candidates: readonly string[];
}

/** No key at all: what a synthesised keystroke is built out of, field by field. */
const NO_KEY: Keystroke = {
  input: '',
  return: false,
  backspace: false,
  delete: false,
  leftArrow: false,
  rightArrow: false,
  upArrow: false,
  downArrow: false,
  tab: false,
  ctrl: false,
};

/** An input row with nothing on it. Where a session starts, and where a line ends. */
export const NOTHING_TYPED: Editing = {
  typed: '',
  at: 0,
  history: [],
  browsing: 0,
  candidates: [],
};

/** What a keystroke did. Closed, and total over what can be pressed. */
export type Typed =
  /** The row changed, or did not. Nothing else happened. */
  | { readonly does: 'edit'; readonly editing: Editing }
  /** The caller pressed Return on something. The line is handed to the session. */
  | { readonly does: 'submit'; readonly line: string; readonly editing: Editing }
  /** Ctrl-C. The line is thrown away, remembered by nobody, and the session goes on. */
  | { readonly does: 'abandon'; readonly line: string; readonly editing: Editing }
  /** Ctrl-D on an empty row: the end of the input, which is the end of the session. */
  | { readonly does: 'leave' };

/**
 * A chunk of input as the keystrokes it stands for — because a PASTE is not a key.
 *
 * A terminal hands over whatever arrived since it was last read, so a caller who pasted
 * three lines delivers all three at once, line breaks and all, as a single chunk. A
 * reducer that treated that as one character would put a control byte on the row and
 * drop three commands; one that ran it as one line would run the first and swallow the
 * rest. So the chunk is split HERE, where it is a value: the text between the breaks is
 * typed, and every break is a Return.
 *
 * Anything that is not plain text is itself: a chord, an arrow, a Tab and a Return
 * already ARE one key, and a chunk with no break in it is the ordinary case of somebody
 * typing.
 */
export function keystrokesOf(stroke: Keystroke): readonly Keystroke[] {
  const named =
    stroke.ctrl ||
    stroke.return ||
    stroke.tab ||
    stroke.backspace ||
    stroke.delete ||
    stroke.leftArrow ||
    stroke.rightArrow ||
    stroke.upArrow ||
    stroke.downArrow;
  if (named || !/[\r\n]/.test(stroke.input)) return [stroke];

  const lines = stroke.input.split(/\r\n|[\r\n]/);
  const strokes: Keystroke[] = [];
  lines.forEach((line, index) => {
    if (line.length > 0) strokes.push({ ...NO_KEY, input: line });
    if (index < lines.length - 1) strokes.push({ ...NO_KEY, return: true });
  });
  return strokes;
}

/**
 * What one keystroke does to the input row.
 *
 * Total: every keystroke reaches exactly one arm, and the arm for a key this session has
 * no use for is the row unchanged. A key that fell through to an exception would be a
 * session that dies of a function key.
 */
export function typeKey(editing: Editing, stroke: Keystroke, complete: Completer): Typed {
  // Asked first, and of the WHOLE keystroke: a control chord carries a character too
  // (Ctrl-D is `d`), so a reducer that looked at `input` before `ctrl` would type the
  // letter and never see the chord.
  if (stroke.ctrl) return chord(editing, stroke.input);

  if (stroke.return) {
    const line = editing.typed;
    return { does: 'submit', line, editing: remembering(editing, line) };
  }
  if (stroke.tab) return { does: 'edit', editing: completing(editing, complete) };
  if (stroke.backspace) return { does: 'edit', editing: erasing(editing, editing.at - 1) };
  if (stroke.delete) return { does: 'edit', editing: erasing(editing, editing.at) };
  if (stroke.leftArrow) return { does: 'edit', editing: caretAt(editing, editing.at - 1) };
  if (stroke.rightArrow) return { does: 'edit', editing: caretAt(editing, editing.at + 1) };
  if (stroke.upArrow) return { does: 'edit', editing: browsing(editing, -1) };
  if (stroke.downArrow) return { does: 'edit', editing: browsing(editing, 1) };
  if (stroke.input.length > 0 && !unprintable(stroke.input)) {
    return { does: 'edit', editing: inserting(editing, stroke.input) };
  }
  return { does: 'edit', editing };
}

/** What a Ctrl chord does. The four this session answers to, and nothing else. */
function chord(editing: Editing, letter: string): Typed {
  switch (letter) {
    case 'c':
      // The LINE, not the session. Abandoned rather than submitted, and deliberately not
      // remembered: a line the caller thought better of is not one they want Up to find.
      return { does: 'abandon', line: editing.typed, editing: cleared(editing) };
    case 'd':
      // The end of the input, and only when there is no input: on a row with something
      // on it the same key deletes forward, which is what every line editor does.
      return editing.typed.length === 0
        ? { does: 'leave' }
        : { does: 'edit', editing: erasing(editing, editing.at) };
    case 'a':
      return { does: 'edit', editing: caretAt(editing, 0) };
    case 'e':
      return { does: 'edit', editing: caretAt(editing, editing.typed.length) };
    case 'u':
      return { does: 'edit', editing: cleared(editing) };
    default:
      return { does: 'edit', editing };
  }
}

/**
 * Whether a character is one a terminal should not put on the row.
 *
 * Raw mode hands over control bytes as characters — an escape, a bell, a carriage
 * return the sequence parser did not claim — and a row that accepted them would hold
 * bytes that move the caret when they are drawn. The test is on the CODE POINT rather
 * than on a list, so a byte nobody thought of is out by construction.
 */
function unprintable(input: string): boolean {
  for (const character of input) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The row with `text` at the caret, and the caret after it. */
function inserting(editing: Editing, text: string): Editing {
  return {
    ...editing,
    typed: editing.typed.slice(0, editing.at) + text + editing.typed.slice(editing.at),
    at: editing.at + text.length,
    candidates: [],
  };
}

/** The row with the character at `index` gone. Out of range is the row unchanged. */
function erasing(editing: Editing, index: number): Editing {
  if (index < 0 || index >= editing.typed.length) return { ...editing, candidates: [] };
  return {
    ...editing,
    typed: editing.typed.slice(0, index) + editing.typed.slice(index + 1),
    at: index,
    candidates: [],
  };
}

/** The caret somewhere between the ends, wherever it was asked to go. */
function caretAt(editing: Editing, index: number): Editing {
  return {
    ...editing,
    at: Math.max(0, Math.min(editing.typed.length, index)),
    candidates: [],
  };
}

/** An empty row, with the history and the position it was browsing left alone. */
function cleared(editing: Editing): Editing {
  return { ...editing, typed: '', at: 0, candidates: [], browsing: editing.history.length };
}

/**
 * The row after a line was submitted: empty, with the line remembered.
 *
 * A blank line is not remembered, and neither is a repeat of the line before it — which
 * is what keeps Up from walking back through five identical reads somebody ran in a row.
 */
function remembering(editing: Editing, line: string): Editing {
  const worth = line.trim().length > 0 && line !== editing.history.at(-1);
  const history = worth ? [...editing.history, line].slice(-REMEMBERED) : editing.history;
  return { ...NOTHING_TYPED, history, browsing: history.length };
}

/**
 * The row after Up or Down: the remembered line at the new position, caret at its end.
 *
 * Walking past the newest one lands on the empty row rather than sticking at the last
 * line, because a caller who pressed Down expects to get back to what they were typing —
 * and this session does not keep a draft, so what they get back is nothing.
 */
function browsing(editing: Editing, step: number): Editing {
  const at = Math.max(0, Math.min(editing.history.length, editing.browsing + step));
  const remembered = editing.history[at] ?? '';
  return { ...editing, typed: remembered, at: remembered.length, browsing: at, candidates: [] };
}

/**
 * The row after Tab: everything the candidates agree on, added at the caret.
 *
 * The completer is asked about the line UP TO THE CARET, so completing in the middle of
 * a line completes the word the caller is inside rather than the last one on the row.
 * What is added is the candidates' common prefix and never a choice between them — a Tab
 * that picked one would be a session typing something the caller did not.
 *
 * When more than one candidate survives, they are carried on the value. Where they are
 * shown is the console's business; that they are shown at all is why a Tab that cannot
 * decide is not a Tab that did nothing.
 */
function completing(editing: Editing, complete: Completer): Editing {
  const [hits, word] = complete(editing.typed.slice(0, editing.at));
  if (hits.length === 0) return { ...editing, candidates: [] };
  const agreed = commonPrefix(hits);
  const candidates = hits.length > 1 ? hits : [];
  if (agreed.length <= word.length) return { ...editing, candidates };
  return { ...inserting(editing, agreed.slice(word.length)), candidates };
}

/** The longest start every one of `words` has. Empty when they agree on nothing. */
function commonPrefix(words: readonly string[]): string {
  const first = words[0] ?? '';
  let length = first.length;
  for (const word of words) {
    let shared = 0;
    while (shared < length && shared < word.length && word[shared] === first[shared]) shared++;
    length = shared;
  }
  return first.slice(0, length);
}
