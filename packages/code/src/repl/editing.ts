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
 *   - the arrows, along the line, through the list of words, and back through what was
 *     typed before
 *   - Tab, which asks the completer and takes what every candidate agrees on
 *   - Return, which hands the line over — or takes the word the caller picked
 *   - Escape, which shuts the list of words
 *   - Ctrl-A and Ctrl-E, the two ends; Ctrl-U, the whole line
 *   - Ctrl-C, which abandons the LINE, and Ctrl-D on an empty line, which leaves
 *
 * THREE KEYS MEAN TWO THINGS EACH, AND WHICH ONE IS DECIDED BY ONE QUESTION: is the list of
 * words open? The vertical arrows move through the list when it is and browse the history
 * when it is not; Return takes the picked word when there is one and hands the line over when
 * there is not. That question has exactly ONE reading here ({@link theOffers}), asked of the
 * same function the console asks before it draws (`palette.ts`, `offeredBy`) — two readings
 * would be a console whose list and whose keys disagreed about whether there was a list.
 *
 * WHAT THE ARROWS DO IS NOT AMBIGUOUS TO A READER, which is what makes the double meaning
 * affordable: the list is on the screen or it is not, and the keys that move it are written
 * under it while it is (`session.ts`, `pickingTips`).
 *
 * AND RETURN NEVER RUNS WHAT THE ARROWS LANDED ON. A pick puts the word on the row and
 * stops there, because half the verbs of this product take arguments and the Return that
 * submits is the same key: a pick that ran the word would take away the caller's chance to
 * finish the line. It is also why nothing is picked until an arrow says so — on a palette
 * that has just opened, Return still hands the row over.
 *
 * THE HISTORY LIVES HERE AND NOWHERE ELSE — in this value, for the length of the
 * process, written to no file. Where a history file would live is a decision about the
 * caller's home that nobody has taken, and this product writes inside its own record and
 * nowhere else.
 */

import type { CompletionWord } from '../completion/tree.js';
import type { Completer } from './complete.js';
import { NOBODY, offeredBy, theNextPicked, thePicked } from './palette.js';

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
  /**
   * THE FOUR KEYS THAT MOVE THE WINDOW rather than the row — a page back, a page forward, the
   * oldest line the console still holds, and the tail.
   *
   * THEY ARE DECLARED HERE AND ANSWERED NOWHERE IN THIS FILE, and that is the shape rather than
   * an omission. This value is the whole language of a keystroke on this surface, so a key the
   * console acts on has to be IN it or the console would be reading a chunk a second time; what
   * each of them does is about which part of the roll a reader is looking at, which is not a
   * question about the line being typed (`console.ts`, `scrolling.ts`). Every arm of the reducer
   * below leaves the row exactly as it found it for all four, which is what the console relies
   * on when it answers them and then does nothing else.
   *
   * THE CARET'S OWN ENDS ARE Ctrl-A AND Ctrl-E and they always were, so nothing was taken
   * from the row to give these two their meaning: a console that lives on one screen has a
   * second axis a console that scrolled the caller's terminal did not, and Home and End are what
   * a hand already reaches for on it.
   */
  readonly pageUp: boolean;
  readonly pageDown: boolean;
  readonly home: boolean;
  readonly end: boolean;
  /**
   * Escape, which is the key that shuts the list of words.
   *
   * It is DECLARED rather than read off the byte, like every other named key here: the
   * library that reads the keyboard tells an Escape from the start of an arrow's own sequence
   * (an arrow arrives as an escape and two more bytes), and that is exactly the distinction a
   * reducer must not be left to make from a chunk.
   */
  readonly escape: boolean;
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
  /**
   * What Tab last offered when it could not decide, each with what it is. Cleared by the
   * next key.
   *
   * IT USED TO BE `candidates`, AND A LIST OF BARE WORDS. It is renamed rather than
   * widened in place, because the console draws it now as a list of two columns rather
   * than as a row of tokens (`palette.ts`) — and a field that keeps its spelling while
   * what it holds changes leaves everything that read it asserting the new shape by
   * accident. What a Tab DOES is untouched: the same candidates, the same order, the same
   * common prefix typed for the caller.
   */
  readonly offered: readonly CompletionWord[];
  /**
   * WHICH WORD OF THE LIST THE CALLER PICKED with the arrows, and {@link NOBODY} when they
   * have picked none.
   *
   * A WORD RATHER THAN A ROW NUMBER, and the reason is the filter: the list narrows as the
   * caller types, so a position kept from one keystroke to the next names a different offer
   * afterwards — which is the defect this shape is famous for, and it is absent by
   * construction here rather than repaired by clamping. Whether the word is still offered is
   * one question with one answer (`palette.ts`, `thePicked`), asked wherever it matters.
   *
   * IT IS NOT A SECOND FLAG BESIDE {@link offered}, and that is why the list being OPEN is not
   * recorded at all: what is open is a function of the row and of what a Tab left
   * (`palette.ts`, `offeredBy`), so a field saying so could disagree with the list on the
   * screen. This says what was picked out of whatever is open, and means nothing when nothing
   * is.
   */
  readonly picked: string;
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
  pageUp: false,
  pageDown: false,
  home: false,
  end: false,
  escape: false,
  ctrl: false,
};

/** An input row with nothing on it. Where a session starts, and where a line ends. */
export const NOTHING_TYPED: Editing = {
  typed: '',
  at: 0,
  history: [],
  browsing: 0,
  offered: [],
  picked: NOBODY,
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
 * A chunk of input as the keystrokes it stands for — because a CHUNK is not a key.
 *
 * A terminal hands over whatever arrived since it was last read. Somebody typing gives
 * one character at a time; somebody PASTING gives three lines at once, breaks and all;
 * and somebody who pressed Ctrl-C a moment before the paste gives all of it in one
 * string. Measured, in a pty, on the case that is easiest to get wrong: a chunk holding
 * a chord followed by two commands. A reducer handed that whole thing sees a control
 * byte, refuses to put it on the row, and drops the two commands with it — and the row
 * it did not clear is then submitted by the Return that follows.
 *
 * So a chunk is TOKENIZED here, where it is a value: runs of ordinary characters are
 * typed, and every control byte becomes the key it stands for. The mapping is the
 * terminal's own and not a table of special cases — a byte between one and twenty-six is
 * the corresponding letter with Ctrl held down, which is how Ctrl-C arrives as three and
 * Ctrl-D as four.
 *
 * Anything the keyboard already NAMED is itself: an arrow, a Tab, a Return and a chord
 * arrive decided, and a chunk of plain text with no control byte in it is the ordinary
 * case of somebody typing.
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
    stroke.downArrow ||
    // AND THE FOUR THAT MOVE THE WINDOW, which the keyboard already named: a chunk carrying one
    // of them is one key and not text to be broken up, exactly like an arrow.
    stroke.pageUp ||
    stroke.pageDown ||
    stroke.home ||
    stroke.end ||
    stroke.escape;
  if (named || !unprintable(stroke.input)) return [stroke];

  const strokes: Keystroke[] = [];
  let text = '';
  const typed = (): void => {
    if (text.length > 0) strokes.push({ ...NO_KEY, input: text });
    text = '';
  };
  for (const character of stroke.input) {
    if (!unprintable(character)) {
      text += character;
      continue;
    }
    typed();
    strokes.push(controlKey(character));
  }
  typed();
  return strokes;
}

/** The key one control byte stands for. A byte nothing answers to presses nothing. */
function controlKey(character: string): Keystroke {
  const code = character.codePointAt(0) ?? 0;
  if (character === '\r' || character === '\n') return { ...NO_KEY, return: true };
  if (character === '\t') return { ...NO_KEY, tab: true };
  if (code === 0x08 || code === 0x7f) return { ...NO_KEY, backspace: true };
  if (code >= 0x01 && code <= 0x1a) {
    return { ...NO_KEY, input: String.fromCharCode(code + 0x60), ctrl: true };
  }
  // AN ESCAPE INSIDE A CHUNK IS THE KEY, and it is here for the same reason every other byte
  // above is: a paste, or a fast keyboard, hands over several keys at once. What it may NOT be
  // asked to decide is whether the bytes after it make an arrow — that is the keyboard
  // library's, which has already decided by the time a named key arrives ({@link Keystroke}).
  if (code === 0x1b) return { ...NO_KEY, escape: true };
  return { ...NO_KEY };
}

/**
 * What one keystroke does to the input row — and then, always, WHAT IS STILL PICKED.
 *
 * Total: every keystroke reaches exactly one arm of {@link pressing}, and the arm for a key this
 * session has no use for is the row unchanged. A key that fell through to an exception would be a
 * session that dies of a function key.
 *
 * THE PICK IS SETTLED HERE AND IN NO ARM, and that is the difference between one rule and
 * eleven agreements. Every key can change which words the list is showing — a character narrows
 * it, a Backspace widens it, a chord empties the row and shuts it — so after every key the
 * question is the same: is the word the caller picked still one of the offers? Asked once, of
 * the one function that answers it (`palette.ts`, {@link thePicked}), against the list the NEW
 * row produces.
 *
 * WHAT THAT BUYS IS THE THREE ANSWERS NOBODY THEN HAS TO REMEMBER TO WRITE. A filter that
 * narrows to a list the pick is still in KEEPS it, so a caller who picks a word and then types
 * to narrow can still take it with Return. A filter that excludes it DROPS it, so no mark can
 * survive on a row that is no longer shown. And a key that shuts the list drops it too, which is
 * what stops a pick made a minute ago from coming back to life the next time the same list is
 * opened — measured as the defect it would be: with the pick merely kept on the value, `/` then
 * Down then Ctrl-U then `/` again showed a mark the caller had not put there, and Return would
 * have filled the row with it.
 *
 * SO EVERY VALUE THIS HANDS BACK IS SETTLED, which is what lets the arms read `picked` straight
 * off the value they were given rather than reconciling it again.
 */
export function typeKey(editing: Editing, stroke: Keystroke, complete: Completer): Typed {
  const what = pressing(editing, stroke, complete);
  if (what.does === 'leave') return what;
  const settled = settling(what.editing, complete);
  switch (what.does) {
    case 'edit':
      return { does: 'edit', editing: settled };
    case 'submit':
      return { does: 'submit', line: what.line, editing: settled };
    case 'abandon':
      return { does: 'abandon', line: what.line, editing: settled };
  }
}

/**
 * The row with nothing picked that is not still offered.
 *
 * ONE FUNCTION, ONE CALLER, and it is here rather than inlined so that what it does has a name a
 * doc can point at: the pick is a WORD, and a word is picked exactly while the list holds it.
 */
function settling(editing: Editing, complete: Completer): Editing {
  const picked = thePicked(theOffers(editing, complete), editing.picked);
  return picked === editing.picked ? editing : { ...editing, picked };
}

/** What one keystroke does to the row, before the pick is settled over it. */
function pressing(editing: Editing, stroke: Keystroke, complete: Completer): Typed {
  // Asked first, and of the WHOLE keystroke: a control chord carries a character too
  // (Ctrl-D is `d`), so a reducer that looked at `input` before `ctrl` would type the
  // letter and never see the chord.
  if (stroke.ctrl) return chord(editing, stroke.input);

  if (stroke.return) {
    // THE PICK COMES FIRST, AND IT FILLS RATHER THAN RUNS. A caller who moved the arrows chose
    // a word and not a line; putting it on the row and stopping is what leaves them the
    // arguments half the verbs of this product take. With nothing picked — which is every
    // palette nobody has moved through — this is the Return it always was.
    //
    // AND THE PICK IS SPENT BY BEING TAKEN, which is the one thing {@link settling} cannot say:
    // the word is still offered afterwards — it is on the row now, so the list has narrowed to
    // it — and a pick left standing would make the NEXT Return fill the row with what is already
    // on it instead of running it. So a caller could never submit a word they had picked, which
    // is measured rather than reasoned: with this line absent, `/` Down Return Return leaves the
    // row at `/clear` twice over and the session never sees the line.
    const picked = thePicked(theOffers(editing, complete), editing.picked);
    if (picked !== NOBODY) {
      return { does: 'edit', editing: { ...taking(editing, complete, picked), picked: NOBODY } };
    }
    const line = editing.typed;
    return { does: 'submit', line, editing: remembering(editing, line) };
  }
  if (stroke.tab) return { does: 'edit', editing: completing(editing, complete) };
  // ESCAPE SHUTS THE LIST, and the row is what it was before the list was asked for. There is
  // no third state to put the list in: whether it is open is a function of the row and of what
  // a Tab left (`palette.ts`, `offeredBy`), so shutting one opened by a slash means taking the
  // row back — and a row that begins with a slash holds nothing BUT a word of the session being
  // typed, so what is taken back is that word and never a line the caller had assembled.
  if (stroke.escape) return { does: 'edit', editing: cleared(editing) };
  if (stroke.backspace) return { does: 'edit', editing: erasing(editing, editing.at - 1) };
  if (stroke.delete) return { does: 'edit', editing: erasing(editing, editing.at) };
  if (stroke.leftArrow) return { does: 'edit', editing: caretAt(editing, editing.at - 1) };
  if (stroke.rightArrow) return { does: 'edit', editing: caretAt(editing, editing.at + 1) };
  if (stroke.upArrow) return { does: 'edit', editing: moving(editing, complete, -1) };
  if (stroke.downArrow) return { does: 'edit', editing: moving(editing, complete, 1) };
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

/**
 * WHAT THE LIST IS SHOWING RIGHT NOW — the one reading of it in this file.
 *
 * It is the same function the console asks before it draws (`palette.ts`, `offeredBy`), over the
 * same two things: the row, and what a Tab left behind. So "is the list open" cannot be answered
 * one way by the keys and another by the drawing, and there is nothing kept here to go stale.
 *
 * Asked only by the keys that mean two things — the two vertical arrows and Return — which is
 * why it costs nothing on an ordinary keystroke.
 */
function theOffers(editing: Editing, complete: Completer): readonly CompletionWord[] {
  return offeredBy(editing.typed, editing.offered, complete);
}

/**
 * The row after an arrow: one step through the list of words when there is one, and one step
 * back through what was typed before when there is not.
 *
 * ONE ARM FOR BOTH MEANINGS, because it is one question: the list is open or it is not. Written
 * this way rather than as two arms in {@link typeKey} so that neither meaning can acquire a
 * condition the other does not have.
 */
function moving(editing: Editing, complete: Completer, step: number): Editing {
  const offers = theOffers(editing, complete);
  if (offers.length === 0) return browsing(editing, step);
  return { ...editing, picked: theNextPicked(offers, editing.picked, step) };
}

/**
 * THE ROW WITH ONE WHOLE WORD ON IT: the word the completer was answering about, replaced.
 *
 * ONE FUNCTION, TWO KEYS, and they hand it two different strings — a Tab hands it everything the
 * candidates agree on, and Return hands it the word the arrows landed on. The rule they share is
 * the one that is easy to get subtly wrong: what is replaced is the word THE COMPLETER SAYS it
 * is answering about, which is the last word of the row up to the caret. That is what makes a
 * pick land correctly in the three shapes this surface has — `/` alone replaced by a whole
 * session word, `/cl` grown into one, and `task mo` with only its last word touched — without a
 * branch anywhere for the slash.
 *
 * AND IT IS WHY PICKING A VERB OFF A BARE SLASH LEAVES NO SLASH BEHIND. The bare prefix asks
 * what an empty line asks (`palette.ts`), so the list under it holds the verbs as well as the
 * session's own words; the word being replaced there is the slash itself, so a picked verb lands
 * on a row of its own rather than behind a prefix that would make it unrunnable.
 */
function taking(editing: Editing, complete: Completer, whole: string): Editing {
  const [, word] = complete(editing.typed.slice(0, editing.at));
  const from = editing.at - word.length;
  const without: Editing = {
    ...editing,
    typed: editing.typed.slice(0, from) + editing.typed.slice(editing.at),
    at: from,
  };
  return inserting(without, whole);
}

/** The row with `text` at the caret, and the caret after it. */
function inserting(editing: Editing, text: string): Editing {
  return {
    ...editing,
    typed: editing.typed.slice(0, editing.at) + text + editing.typed.slice(editing.at),
    at: editing.at + text.length,
    offered: [],
  };
}

/** The row with the character at `index` gone. Out of range is the row unchanged. */
function erasing(editing: Editing, index: number): Editing {
  if (index < 0 || index >= editing.typed.length) return { ...editing, offered: [] };
  return {
    ...editing,
    typed: editing.typed.slice(0, index) + editing.typed.slice(index + 1),
    at: index,
    offered: [],
  };
}

/** The caret somewhere between the ends, wherever it was asked to go. */
function caretAt(editing: Editing, index: number): Editing {
  return {
    ...editing,
    at: Math.max(0, Math.min(editing.typed.length, index)),
    offered: [],
  };
}

/** An empty row, with the history and the position it was browsing left alone. */
function cleared(editing: Editing): Editing {
  return {
    ...editing,
    typed: '',
    at: 0,
    browsing: editing.history.length,
    offered: [],
  };
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
  return {
    ...editing,
    typed: remembered,
    at: remembered.length,
    browsing: at,
    offered: [],
  };
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
 *
 * NOTHING HERE SAYS ANYTHING ABOUT WHAT IS PICKED, and that is deliberate rather than an
 * omission: a Tab that leaves a list is a row like any other, and whether the word the caller
 * had picked is still in that list is settled where every key's is ({@link typeKey}).
 *
 * IT INSERTED THE AGREED SUFFIX AND IT REPLACES THE WHOLE WORD NOW ({@link taking}), which is
 * the same bytes by construction — everything the candidates agree on begins with what was
 * typed — and one function instead of two: a Tab and a pick put a word on the row in exactly the
 * same way, and the way is the part that is easy to get subtly wrong.
 */
function completing(editing: Editing, complete: Completer): Editing {
  const [hits, word] = complete(editing.typed.slice(0, editing.at));
  if (hits.length === 0) return { ...editing, offered: [] };
  const offered = hits.length > 1 ? hits : [];
  const agreed = commonPrefix(hits.map((hit) => hit.word));
  if (agreed.length <= word.length) return { ...editing, offered };
  return { ...taking(editing, complete, agreed), offered };
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
