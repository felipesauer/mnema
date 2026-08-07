/**
 * THE INPUT ROW, KEY BY KEY — the whole language of what a caller is typing, with no
 * device anywhere near it.
 *
 * The console is the one part of this surface that cannot be read to know whether it is
 * right: what a keystroke does is only visible as a redraw. So the answer is a VALUE, and
 * these are the cases over it — the caret that walked past an end, the history browsed
 * and then typed into, the completion that had nothing to add, the paste that arrived as
 * one chunk with a chord inside it.
 *
 * THE TOKENIZER IS HERE FOR A MEASURED REASON. A chunk holding `Ctrl-C` followed by two
 * commands was measured arriving as ONE string in a pty, and the reducer that treated it
 * as one key dropped all three: the control byte made the whole run unprintable, the row
 * was never cleared, and the Return that followed submitted the line the caller had just
 * abandoned. That is the case at the bottom of this file.
 */

import { describe, expect, it } from 'vitest';
import type { Completer } from './complete.js';
import {
  type Editing,
  type Keystroke,
  keystrokesOf,
  NOTHING_TYPED,
  type Typed,
  typeKey,
} from './editing.js';

/** A key with nothing held down: what typing one character looks like. */
function press(input: string, held: Partial<Keystroke> = {}): Keystroke {
  return {
    input,
    return: false,
    backspace: false,
    delete: false,
    leftArrow: false,
    rightArrow: false,
    upArrow: false,
    downArrow: false,
    tab: false,
    ctrl: false,
    ...held,
  };
}

/**
 * A completer of this file's own: three verbs, and nothing else in the world.
 *
 * Each offer carries what it is, because that is what a completer answers with now — the
 * console draws a column of descriptions beside the words (`palette.ts`). What the Tab
 * DOES with them is untouched, which is what these cases are about.
 */
const OFFERS: Completer = (line) => {
  const word = /\s$/.test(line) ? '' : (line.split(/\s+/).pop() ?? '');
  const words = ['verify', 'version', 'search'];
  return [
    words
      .filter((candidate) => candidate.startsWith(word))
      .map((candidate) => ({ word: candidate, description: `what ${candidate} does` })),
    word,
  ];
};

/** Nothing to offer, ever — for the cases that are not about completion. */
const OFFERS_NOTHING: Completer = (line) => [[], line];

/** Presses every key in turn and answers with what the row became. */
function typing(keys: readonly Keystroke[], complete = OFFERS_NOTHING): Editing {
  let editing = NOTHING_TYPED;
  for (const key of keys) {
    const what = typeKey(editing, key, complete);
    if (what.does !== 'leave') editing = what.editing;
  }
  return editing;
}

/** Types the characters of `text` one at a time. */
function characters(text: string): Keystroke[] {
  return [...text].map((character) => press(character));
}

/** What the last of a sequence of keys did. */
function lastly(keys: readonly Keystroke[], complete = OFFERS_NOTHING): Typed {
  let editing = NOTHING_TYPED;
  let what: Typed = { does: 'edit', editing };
  for (const key of keys) {
    what = typeKey(editing, key, complete);
    if (what.does !== 'leave') editing = what.editing;
  }
  return what;
}

describe('a character goes where the caret is', () => {
  it('types, and the caret follows', () => {
    const row = typing(characters('verify'));
    expect(row.typed).toBe('verify');
    expect(row.at).toBe(6);
  });

  it('inserts in the middle rather than at the end', () => {
    const row = typing([
      ...characters('verfy'),
      press('', { leftArrow: true }),
      press('', { leftArrow: true }),
      press('i'),
    ]);
    expect(row.typed).toBe('verify');
    expect(row.at).toBe(4);
  });

  it('erases before the caret with Backspace and under it with Delete', () => {
    expect(typing([...characters('verify'), press('', { backspace: true })]).typed).toBe('verif');
    const middle = typing([
      ...characters('verify'),
      press('', { leftArrow: true }),
      press('', { delete: true }),
    ]);
    expect(middle.typed).toBe('verif');
  });

  it('refuses a control byte, whichever one it is, rather than putting it on the row', () => {
    // Raw mode hands over control bytes as characters. A row that accepted them would
    // hold bytes that MOVE THE CARET when they are drawn, which is a row nobody can
    // read and a line nobody meant to type.
    const bytes = ['\u001b', '\u0007', '\r', '\u007f'];
    for (const byte of bytes) expect(typing([press(byte)]).typed, byte).toBe('');
    // And it is the code point that decides, not a list: an ordinary character with a
    // high code point is typed like any other.
    expect(typing([press('é')]).typed).toBe('é');
  });

  it('stops the caret at both ends rather than running past them', () => {
    const left = typing([
      press('a'),
      press('', { leftArrow: true }),
      press('', { leftArrow: true }),
    ]);
    expect(left.at).toBe(0);
    const right = typing([press('a'), press('', { rightArrow: true })]);
    expect(right.at).toBe(1);
  });
});

describe('Return hands the line over, and the line is remembered', () => {
  it('submits what was typed and leaves the row empty', () => {
    const what = lastly([...characters('verify'), press('', { return: true })]);
    expect(what).toMatchObject({ does: 'submit', line: 'verify' });
    if (what.does !== 'submit') throw new Error('unreachable');
    expect(what.editing.typed).toBe('');
    expect(what.editing.history).toEqual(['verify']);
  });

  it('remembers neither a blank line nor a repeat of the one before it', () => {
    const twice = typing([
      ...characters('verify'),
      press('', { return: true }),
      ...characters('verify'),
      press('', { return: true }),
      press('', { return: true }),
    ]);
    expect(twice.history).toEqual(['verify']);
  });

  it('walks back through what was typed, and forward to the empty row', () => {
    const remembered = [
      ...characters('verify'),
      press('', { return: true }),
      ...characters('search'),
      press('', { return: true }),
    ];
    expect(typing([...remembered, press('', { upArrow: true })]).typed).toBe('search');
    const twoBack = typing([
      ...remembered,
      press('', { upArrow: true }),
      press('', { upArrow: true }),
    ]);
    expect(twoBack.typed).toBe('verify');
    expect(twoBack.at).toBe(6);
    // Down past the newest one is the empty row and not the newest one again: a caller
    // who pressed Down expects to get back to typing.
    const forward = typing([
      ...remembered,
      press('', { upArrow: true }),
      press('', { downArrow: true }),
    ]);
    expect(forward.typed).toBe('');
  });
});

describe('the chords, and the two that are not about the row', () => {
  it('abandons the line on Ctrl-C, and does not remember it', () => {
    const what = lastly([...characters('a line thought better of'), press('c', { ctrl: true })]);
    expect(what).toMatchObject({ does: 'abandon', line: 'a line thought better of' });
    if (what.does !== 'abandon') throw new Error('unreachable');
    expect(what.editing.typed).toBe('');
    expect(what.editing.history).toEqual([]);
  });

  it('leaves on Ctrl-D only when the row is empty, and deletes forward when it is not', () => {
    expect(lastly([press('d', { ctrl: true })])).toEqual({ does: 'leave' });
    const onALine = lastly([
      ...characters('verify'),
      press('', { leftArrow: true }),
      press('d', { ctrl: true }),
    ]);
    expect(onALine).toMatchObject({ does: 'edit' });
    if (onALine.does !== 'edit') throw new Error('unreachable');
    expect(onALine.editing.typed).toBe('verif');
  });

  it('goes to either end, and clears the whole row', () => {
    expect(typing([...characters('verify'), press('a', { ctrl: true })]).at).toBe(0);
    expect(
      typing([...characters('verify'), press('a', { ctrl: true }), press('e', { ctrl: true })]).at,
    ).toBe(6);
    expect(typing([...characters('verify'), press('u', { ctrl: true })]).typed).toBe('');
  });

  it('does nothing at all with a chord it has no use for', () => {
    // Total: every keystroke reaches an arm, and the arm for a key this session does not
    // answer to is the row unchanged. A session that died of a function key would be a
    // session nobody could trust with a keyboard.
    const row = typing([...characters('verify'), press('z', { ctrl: true })]);
    expect(row.typed).toBe('verify');
  });
});

describe('Tab takes what every candidate agrees on, and never chooses', () => {
  it('completes to the one candidate there is', () => {
    const row = typing([...characters('sea'), press('', { tab: true })], OFFERS);
    expect(row.typed).toBe('search');
    expect(row.offered).toEqual([]);
  });

  it('takes the shared start and carries the rest, rather than picking one', () => {
    const row = typing([...characters('ver'), press('', { tab: true })], OFFERS);
    expect(row.typed).toBe('ver');
    expect(row.offered.map((offer) => offer.word)).toEqual(['verify', 'version']);
    // AND WHAT EACH OF THEM IS, which is the half the console used to throw away.
    expect(row.offered.every((offer) => offer.description.length > 0)).toBe(true);
    const further = typing([...characters('veri'), press('', { tab: true })], OFFERS);
    expect(further.typed).toBe('verify');
  });

  it('completes the word the caret is inside, not the last one on the row', () => {
    const row = typing(
      [
        ...characters('sea x'),
        ...[press('', { leftArrow: true }), press('', { leftArrow: true })],
        press('', { tab: true }),
      ],
      OFFERS,
    );
    expect(row.typed).toBe('search x');
  });

  it('adds nothing when nothing matches, and forgets the offers on the next key', () => {
    const nothing = typing([...characters('zzz'), press('', { tab: true })], OFFERS);
    expect(nothing.typed).toBe('zzz');
    expect(nothing.offered).toEqual([]);
    const then = typing([...characters('ver'), press('', { tab: true }), press('i')], OFFERS);
    expect(then.offered).toEqual([]);
  });
});

describe('a chunk of input is the keystrokes it stands for', () => {
  it('is itself when it is one key, and when it is somebody typing', () => {
    expect(keystrokesOf(press('v'))).toEqual([press('v')]);
    expect(keystrokesOf(press('', { tab: true }))).toEqual([press('', { tab: true })]);
    // A paste with no control byte in it: one insertion, not eight.
    expect(keystrokesOf(press('verify x'))).toHaveLength(1);
  });

  it('splits a paste into its lines, with a Return between them', () => {
    const strokes = keystrokesOf(press('verify\rsearch\r'));
    expect(strokes.map((stroke) => (stroke.return ? '<return>' : stroke.input))).toEqual([
      'verify',
      '<return>',
      'search',
      '<return>',
    ]);
  });

  it('reads a chord inside a chunk as the chord, which is the case that was measured', () => {
    // THE DEFECT, in a value. Ctrl-C followed by a command arrives as one string from a
    // real terminal. Read as one key it is unprintable, so the whole thing is dropped —
    // the row is not cleared and the Return that follows submits the abandoned line.
    const strokes = keystrokesOf(press('\u0003verify\r'));
    expect(strokes[0]).toMatchObject({ input: 'c', ctrl: true });
    expect(strokes[1]).toMatchObject({ input: 'verify' });
    expect(strokes[2]).toMatchObject({ return: true });
    expect(strokes).toHaveLength(3);
  });

  it('reads every control byte as the key the terminal means by it', () => {
    const only = (byte: string): Keystroke => keystrokesOf(press(`${byte}x`))[0] as Keystroke;
    expect(only('\u0004')).toMatchObject({ input: 'd', ctrl: true });
    expect(only('\t')).toMatchObject({ tab: true });
    expect(only('\u007f')).toMatchObject({ backspace: true });
    expect(only('\n')).toMatchObject({ return: true });
    // And a byte nothing answers to presses nothing, rather than being typed.
    expect(only('\u0000')).toEqual(press(''));
  });
});
