/**
 * WHAT ONE KEY DOES TO A QUESTION OF `mnema init`, pressed one at a time on the reducers with no terminal in
 * them (`init/keys.ts`).
 *
 * THE KEYS ARE BUILT WHOLE, every field of a keystroke present, so a reducer that read a field the case did not
 * set would be asked, not assumed (nothing type-checks the fields a test leaves out, and a key built of some of
 * them would let an arm go unasserted while every assertion stayed green).
 *
 * WHAT IS HELD:
 *   - THE ARROWS MOVE THE PICK AND THE ENDS HOLD: one step per key, up and left the same, down and right the
 *     same, and no wrap past either end.
 *   - SPACE TOGGLES THE ROW THE PICK IS ON, AND NOTHING ELSE; `a` TOGGLES EVERY ROW (all on becomes all off,
 *     anything less becomes all on); ENTER ANSWERS WITH THE MARKS THAT ARE ON.
 *   - THE THREE WAYS OUT ARE ONE ANSWER: Esc, Ctrl-C and Ctrl-D leave, the control chord asked of the whole
 *     keystroke, so a Ctrl-D is not read as somebody typing `d`; and any other chord does nothing.
 *   - A KEY THAT MEANS NOTHING HERE DOES NOTHING: a letter, a function key, a Tab.
 */

import { describe, expect, it } from 'vitest';
import { isALeave, type Marked, onTheHosts, onTheOptions } from '../src/init/keys.js';
import type { Keystroke } from '../src/repl/editing.js';

/** One keystroke, whole: every field the product reads, off unless the case turns it on. */
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
    pageUp: false,
    pageDown: false,
    home: false,
    end: false,
    escape: false,
    ctrl: false,
    ...held,
  };
}

const ENTER = press('\r', { return: true });
const ESCAPE = press('\u001b', { escape: true });
const CTRL_C = press('c', { ctrl: true });
const CTRL_D = press('d', { ctrl: true });
const UP = press('\u001b[A', { upArrow: true });
const DOWN = press('\u001b[B', { downArrow: true });
const LEFT = press('\u001b[D', { leftArrow: true });
const RIGHT = press('\u001b[C', { rightArrow: true });
const SPACE = press(' ');

/** Rows as the list of words walks them: a word each. */
const ROWS = ['one', 'two', 'three'].map((word) => ({ word, description: '' }));

const opening = (marks: readonly string[] = [], picked = 'one'): Marked => ({
  marks: new Set(marks),
  picked,
});

/** The state a key left the question in, or the reason it is not one. */
function stayed(step: ReturnType<typeof onTheHosts>): Marked {
  if (step.kind !== 'stay') throw new Error(`the key ended the question (${step.kind})`);
  return step.state;
}

describe('the multiselect', () => {
  it('moves the pick one row a key, and holds at both ends', () => {
    expect(stayed(onTheHosts(ROWS, opening(), DOWN)).picked).toBe('two');
    expect(stayed(onTheHosts(ROWS, opening([], 'two'), DOWN)).picked).toBe('three');
    expect(stayed(onTheHosts(ROWS, opening([], 'three'), DOWN)).picked).toBe('three');
    expect(stayed(onTheHosts(ROWS, opening([], 'two'), UP)).picked).toBe('one');
    expect(stayed(onTheHosts(ROWS, opening(), UP)).picked).toBe('one');
    expect(stayed(onTheHosts(ROWS, opening([], 'two'), RIGHT)).picked).toBe('three');
    expect(stayed(onTheHosts(ROWS, opening([], 'two'), LEFT)).picked).toBe('one');
  });

  it('toggles the row the pick is on on Space, and no other', () => {
    const on = stayed(onTheHosts(ROWS, opening(['two'], 'one'), SPACE));
    expect([...on.marks].sort()).toEqual(['one', 'two']);
    const off = stayed(onTheHosts(ROWS, opening(['one', 'two'], 'one'), SPACE));
    expect([...off.marks]).toEqual(['two']);
    expect(off.picked).toBe('one');
  });

  it('toggles every row on `a`: all on becomes none, and anything less becomes all', () => {
    expect([
      ...stayed(onTheHosts(ROWS, opening(['one', 'two', 'three']), press('a'))).marks,
    ]).toEqual([]);
    expect([...stayed(onTheHosts(ROWS, opening(['one']), press('a'))).marks].sort()).toEqual([
      'one',
      'three',
      'two',
    ]);
    expect([...stayed(onTheHosts(ROWS, opening(), press('a'))).marks].sort()).toEqual([
      'one',
      'three',
      'two',
    ]);
  });

  it('answers on Enter with the marks that are on, and the state is not changed', () => {
    const step = onTheHosts(ROWS, opening(['two']), ENTER);
    expect(step.kind).toBe('done');
    if (step.kind === 'done') expect([...step.answer]).toEqual(['two']);
  });

  it('leaves on Esc, Ctrl-C and Ctrl-D, and does nothing on another chord or a key it does not know', () => {
    for (const leaving of [ESCAPE, CTRL_C, CTRL_D]) {
      expect(onTheHosts(ROWS, opening(), leaving).kind).toBe('left');
    }
    const other = press('x', { ctrl: true });
    expect(onTheHosts(ROWS, opening(['one']), other)).toEqual({
      kind: 'stay',
      state: opening(['one']),
    });
    for (const nothing of [
      press('x'),
      press('\t', { tab: true }),
      press('', { pageDown: true }),
      press(' a'),
    ]) {
      expect(stayed(onTheHosts(ROWS, opening(['one']), nothing))).toEqual(opening(['one']));
    }
  });
});

describe('a question with one answer among a few', () => {
  it('moves and holds with the arrows of both directions, and answers with the word picked on Enter', () => {
    expect(onTheOptions(ROWS, 'one', RIGHT)).toEqual({ kind: 'stay', state: 'two' });
    expect(onTheOptions(ROWS, 'two', DOWN)).toEqual({ kind: 'stay', state: 'three' });
    expect(onTheOptions(ROWS, 'three', DOWN)).toEqual({ kind: 'stay', state: 'three' });
    expect(onTheOptions(ROWS, 'one', LEFT)).toEqual({ kind: 'stay', state: 'one' });
    expect(onTheOptions(ROWS, 'two', ENTER)).toEqual({ kind: 'done', answer: 'two' });
  });

  it('leaves the three ways out, and does nothing on a key it does not know or a chord that is not one', () => {
    for (const leaving of [ESCAPE, CTRL_C, CTRL_D]) {
      expect(onTheOptions(ROWS, 'one', leaving).kind).toBe('left');
    }
    expect(onTheOptions(ROWS, 'two', press('y'))).toEqual({ kind: 'stay', state: 'two' });
    expect(onTheOptions(ROWS, 'two', press('x', { ctrl: true }))).toEqual({
      kind: 'stay',
      state: 'two',
    });
  });
});

describe('the ways out', () => {
  it('are asked of the whole keystroke: a Ctrl-D is not somebody typing `d`, and a bare `c` is not Ctrl-C', () => {
    expect(isALeave(CTRL_D)).toBe(true);
    expect(isALeave(CTRL_C)).toBe(true);
    expect(isALeave(ESCAPE)).toBe(true);
    expect(isALeave(press('d'))).toBe(false);
    expect(isALeave(press('c'))).toBe(false);
    expect(isALeave(press('x', { ctrl: true }))).toBe(false);
  });
});
