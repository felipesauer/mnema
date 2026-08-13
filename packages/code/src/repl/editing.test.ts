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
import { PREFIX, WHAT_EACH_WORD_DOES } from '../session-words.js';
import type { Completer } from './complete.js';
import {
  type Editing,
  type Keystroke,
  keystrokesOf,
  NOTHING_TYPED,
  type Typed,
  typeKey,
} from './editing.js';
import { NOBODY } from './palette.js';

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
    // THE FOUR KEYS THAT MOVE THE WINDOW rather than the row. They are spelled here because
    // this stand-in is the WHOLE keystroke — a value built out of some of the fields would let
    // a reducer arm that reads one of them go unasserted (`src/repl/editing.ts`).
    pageUp: false,
    pageDown: false,
    home: false,
    end: false,
    escape: false,
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
function typing(
  keys: readonly Keystroke[],
  complete = OFFERS_NOTHING,
  from: Editing = NOTHING_TYPED,
): Editing {
  let editing = from;
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

// ---------------------------------------------------------------------------
// The list of words is something you choose FROM
// ---------------------------------------------------------------------------

/**
 * A completer shaped like the session's own: the words a slash lists, and one verb.
 *
 * THE WORDS ARE THE PRODUCT'S rather than three strings invented here, because the cases below
 * are about a list a slash really opens — a fixture with words the completer could not produce
 * would make every answer here about a console that cannot exist. The verb is what makes the
 * list more than one vocabulary, which is the shape the palette really has (`palette.ts`).
 *
 * It sorts by the word and narrows by prefix, which is what the real one does (`complete.ts`,
 * `matching`).
 */
const THE_SESSIONS_WORDS: Completer = (line) => {
  const word = /\s$/.test(line) ? '' : (line.split(/\s+/).pop() ?? '');
  const words = [
    ...Object.entries(WHAT_EACH_WORD_DOES).map(([spelling, description]) => ({
      word: spelling,
      description,
    })),
    { word: 'search', description: 'find what has been recorded' },
    { word: 'show', description: 'print one record' },
    { word: 'skills', description: 'list the patterns' },
  ].sort((one, other) => (one.word < other.word ? -1 : 1));
  return [words.filter((candidate) => stemOf(candidate.word).startsWith(stemOf(word))), word];
};

/**
 * A WORD WITHOUT THE PREFIX, read on BOTH sides of the comparison above — which is what makes
 * the slash a key rather than a letter, exactly as the real completer does it (`complete.ts`,
 * `theStem`). A fixture that compared the raw spellings would answer `/s` with nothing, and
 * every case below would be about a console this product cannot produce.
 */
function stemOf(spelling: string): string {
  return spelling.startsWith(PREFIX) ? spelling.slice(PREFIX.length) : spelling;
}

/**
 * THE ROW A LIST IS OPEN ON: the prefix and one letter.
 *
 * IT USED TO BE THE BARE PREFIX, and that is the shape this delivery took away — a slash alone
 * is *what exists* and opens nothing, a slash with a letter is a word being written and the
 * list under it is what it could still become (`palette.ts`, `offeredBy`). The letter is one
 * three of the fixture's words share, so what these cases are about is a list of several rows
 * with a middle one picked.
 */
const A_LETTER = 's';
const OPEN_ROW = `${PREFIX}${A_LETTER}`;

/** Every word that list shows, in the order it shows them. */
const OPENED_BY_THE_SLASH = THE_SESSIONS_WORDS(OPEN_ROW)[0].map((offer) => offer.word);

/**
 * The same list, and it is the one every case below moves through.
 *
 * IT USED TO BE THE WORDS THAT BEGIN WITH A SLASH inside a longer list, because the row was a
 * bare prefix and the list under it held both vocabularies. The row is a word being written
 * now, so what is offered is what that word can still become — one list, and there is nothing
 * to filter out of it.
 */
const LISTED = OPENED_BY_THE_SLASH;

/** A letter that narrows the list and KEEPS the second word, which is the one picked below. */
const NARROWS_TO_THE_PICK = 'h';

/** The row a caller has opened the list on, with one of its words picked. */
const PICKED_ONE: Editing = {
  ...NOTHING_TYPED,
  typed: OPEN_ROW,
  at: OPEN_ROW.length,
  picked: LISTED[1] as string,
};

/** What one key does to that row: the row it leaves, and what is picked on it. */
function after(stroke: Keystroke, from: Editing = PICKED_ONE): Editing {
  const what = typeKey(from, stroke, THE_SESSIONS_WORDS);
  if (what.does === 'leave') throw new Error('the session left');
  return what.editing;
}

describe('the arrows move through the list, and Return takes what they landed on', () => {
  it('has a list to be about, with more than one word in it', () => {
    // THE INSTRUMENT FIRST. Every case below is about a list of at least three words with a
    // middle one picked, and a fixture that had narrowed to one would make "the ends hold" and
    // "it moves" the same answer.
    expect(LISTED.length).toBeGreaterThan(2);
    expect(PICKED_ONE.picked).toBe(LISTED[1]);
  });

  it('picks nothing until an arrow says so, and Return still hands the row over', () => {
    // THE HALF THAT KEEPS EVERY OTHER KEY WORKING. The list is open the moment a letter
    // follows the slash, so a palette that picked its first row on opening would make Return
    // fill the row instead of submitting — and a word typed in full would stop being runnable.
    const opened = typing([press(PREFIX), press(A_LETTER)], THE_SESSIONS_WORDS);
    expect(opened.typed).toBe(OPEN_ROW);
    expect(opened.picked).toBe(NOBODY);
    const whole = typeKey(
      { ...NOTHING_TYPED, typed: LISTED[1] as string, at: (LISTED[1] as string).length },
      press('', { return: true }),
      THE_SESSIONS_WORDS,
    );
    expect(whole).toMatchObject({ does: 'submit', line: LISTED[1] });
  });

  it('moves in both directions, and the ends hold rather than wrapping', () => {
    expect(after(press('', { downArrow: true })).picked).toBe(LISTED[2]);
    expect(after(press('', { upArrow: true })).picked).toBe(LISTED[0]);
    // THE ENDS. Up from the first row stays on it, and Down from the last stays there. THE
    // REASON WAS *the list is CUT to the room a terminal has, so a wrap would jump to a row
    // nobody can see*, and the window falsified it: what is drawn follows the pick now
    // (`palette.ts`, `theWindow`), so a wrapped pick would be drawn like any other. What is left
    // is about the list — the ends of it are where the vocabulary ends.
    const first = { ...PICKED_ONE, picked: LISTED[0] as string };
    expect(after(press('', { upArrow: true }), first).picked).toBe(LISTED[0]);
    const last = { ...PICKED_ONE, picked: LISTED.at(-1) as string };
    expect(after(press('', { downArrow: true }), last).picked).toBe(LISTED.at(-1));
  });

  it('takes the first with Down and the last with Up when nothing is picked yet', () => {
    // The two ends, which is what leaves neither arrow dead on a list nobody has moved through.
    const nothing = { ...PICKED_ONE, picked: NOBODY };
    expect(after(press('', { downArrow: true }), nothing).picked).toBe(LISTED[0]);
    expect(after(press('', { upArrow: true }), nothing).picked).toBe(LISTED.at(-1));
  });

  it('opens the whole vocabulary on a bare slash, and the arrows move through THAT', () => {
    // IT SAID *opens nothing on a bare slash, so the arrows are the history\u2019s there*, on the
    // premise that a slash alone is not a question — so the row was a character like any other
    // and the arrows went on browsing what had been typed before. A caller reading the page
    // falsified it: a bar with a slash in it and nothing under it is somebody asking what
    // there IS. The list is open the moment the slash is typed, so the arrows belong to it.
    const remembered = [...characters('verify'), press('', { return: true })];
    const everything = THE_SESSIONS_WORDS(PREFIX)[0].map((offer) => offer.word);
    const bare = typing(
      [...remembered, press(PREFIX), press('', { upArrow: true })],
      THE_SESSIONS_WORDS,
    );
    expect(bare.typed).toBe(PREFIX);
    expect(bare.picked).toBe(everything.at(-1));
    // AND IT IS THE WHOLE VOCABULARY rather than one of the two the list holds, which is what
    // keeps this ONE list: the row a letter opens is a NARROWING of this one, never a second.
    expect(everything.length).toBeGreaterThan(LISTED.length);
    expect(LISTED.every((word) => everything.includes(word))).toBe(true);
    // AND THE LETTER NARROWS IT: the same row with one more character has fewer words under
    // it, and the same arrow moves through those.
    const narrowed = typing(
      [...remembered, press(PREFIX), press(A_LETTER), press('', { upArrow: true })],
      THE_SESSIONS_WORDS,
    );
    expect(narrowed.typed).toBe(OPEN_ROW);
    expect(narrowed.picked).toBe(LISTED.at(-1));
  });

  it('browses what was typed before when there is no list open', () => {
    // THE OTHER MEANING OF THE SAME KEY, and it is the one that was there first. A row with no
    // list on it is the ordinary case, and the arrows have to go on doing what they did.
    const remembered = [...characters('verify'), press('', { return: true })];
    const back = typing([...remembered, press('', { upArrow: true })], THE_SESSIONS_WORDS);
    expect(back.typed).toBe('verify');
    expect(back.picked).toBe(NOBODY);
  });

  it('fills the row with the picked word, and does NOT run it', () => {
    // T-d, AND IT IS THE ONE DECISION OF THIS DELIVERY A CALLER WOULD FEEL. Half the verbs take
    // arguments, and the Return that submits is the same key: a pick that ran the word would
    // take the line away before the caller could finish it.
    const what = typeKey(PICKED_ONE, press('', { return: true }), THE_SESSIONS_WORDS);
    expect(what.does, 'Return ran the picked word instead of typing it').toBe('edit');
    if (what.does !== 'edit') throw new Error('unreachable');
    expect(what.editing.typed).toBe(LISTED[1]);
    expect(what.editing.at).toBe((LISTED[1] as string).length);
    // AND THE PICK IS SPENT: the word is still offered — it is the row now — so a pick left
    // standing would make the next Return fill the row with what is already on it, and the
    // caller could never submit a word they had picked.
    expect(what.editing.picked).toBe(NOBODY);
    const again = typeKey(what.editing, press('', { return: true }), THE_SESSIONS_WORDS);
    expect(again, 'a picked word could never be submitted').toMatchObject({
      does: 'submit',
      line: LISTED[1],
    });
  });

  it('leaves no slash behind when what was picked off one is a verb', () => {
    // THE SLASH IS A KEY AND NOT A LETTER OF THE WORD, so the list under it holds the verbs
    // too — and a verb taken from it has to land as a line that can run. What is replaced is
    // the word the completer was answering about, which on that row is the slash AND the
    // letter behind it.
    const verb = { ...PICKED_ONE, picked: 'search' };
    expect(after(press('', { return: true }), verb).typed).toBe('search');
  });

  it('shuts the list on Escape, and the row goes back to what it was', () => {
    const shut = after(press('', { escape: true }));
    expect(shut.typed).toBe('');
    expect(shut.picked).toBe(NOBODY);
    expect(shut.offered).toEqual([]);
  });

  it('keeps a pick a filter still shows, and drops one it excludes', () => {
    // THE CASE THE WHOLE SHAPE OF THIS WAS CHOSEN FOR. What is picked is a WORD, so narrowing
    // the list cannot move the mark to a neighbour: the pick survives exactly while the list
    // still holds it.
    const narrowed = (letter: string): Editing => after(press(letter));
    const keeps = (LISTED[1] as string).slice(A_LETTER.length, A_LETTER.length + 1);
    const excludes = (LISTED.at(-1) as string).slice(A_LETTER.length, A_LETTER.length + 1);
    expect(keeps, 'the two letters do not tell the words apart').not.toBe(excludes);
    expect(narrowed(keeps).picked).toBe(LISTED[1]);
    expect(narrowed(excludes).picked).toBe(NOBODY);
    // NOT VACUOUS: the excluding letter really does leave a list, with the OTHER word in it — so
    // the pick was dropped by the filter rather than by there being nothing to show.
    expect(THE_SESSIONS_WORDS(`${OPEN_ROW}${excludes}`)[0].map((offer) => offer.word)).toContain(
      LISTED.at(-1),
    );
  });

  it('does not bring a pick back to life the next time the list is opened', () => {
    // THE GHOST, and it is what the pick being SETTLED after every key prevents. Kept on the
    // value instead, a word picked before the row was cleared would be marked again the moment
    // the same list reopened — and Return would fill the row with a choice the caller had not
    // made in the list they are looking at.
    const cleared = after(press('u', { ctrl: true }));
    expect(cleared.picked).toBe(NOBODY);
    const again = typing([press(PREFIX), press(A_LETTER)], THE_SESSIONS_WORDS, cleared);
    expect(again.typed).toBe(OPEN_ROW);
    expect(again.picked, 'a pick came back from a list that had been shut').toBe(NOBODY);
  });
});

/**
 * WHAT EVERY KEY OF THIS LANGUAGE LEAVES BEHIND on a row with a list open and a word picked —
 * one entry per FIELD of a keystroke, and the fields are read off a keystroke rather than listed.
 *
 * IT IS THE TOTALITY, AND IT IS WHY IT IS A TABLE. The pick is settled after every key
 * ({@link typeKey}), so every key has an answer to *what is picked now* whether anybody thought
 * about it or not: three of them mean something of their own (the two arrows move, Return takes),
 * two shut the list, and the rest leave the pick to the list the new row produces. A key added to
 * the language has to say which it is, or the case below fails on the count.
 *
 * The row is a bare slash with the SECOND word picked, so a move is visible in both directions
 * and neither end is being tested by accident.
 */
const WHAT_EACH_KEY_LEAVES: {
  readonly [K in keyof Keystroke]: { readonly typed: string; readonly picked: string };
} = {
  // A character narrows the list, and the word picked is still in it.
  input: { typed: `${OPEN_ROW}${NARROWS_TO_THE_PICK}`, picked: LISTED[1] as string },
  // The pick is taken: the row becomes the word, and nothing is picked any more.
  return: { typed: LISTED[1] as string, picked: NOBODY },
  // Backspace takes the letter back, which leaves a bare slash — and a bare slash opens the
  // WHOLE vocabulary, so the list widens rather than shutting. IT SAID *the list is shut and
  // the pick goes with it*, which was true while the bare slash opened nothing; what did not
  // change is the rule the pick lives by, and this is the case that shows it from the other
  // side. A pick is a WORD and it is real exactly while its word is still offered
  // (`palette.ts`, `thePicked`), so a keystroke that makes the list BIGGER cannot lose it.
  backspace: { typed: PREFIX, picked: LISTED[1] as string },
  // Delete has nothing under the caret at the end of the row.
  delete: { typed: OPEN_ROW, picked: LISTED[1] as string },
  // The caret moves and the list does not, so what is picked does not either.
  leftArrow: { typed: OPEN_ROW, picked: LISTED[1] as string },
  rightArrow: { typed: OPEN_ROW, picked: LISTED[1] as string },
  // The two that move: one word back, and one word on.
  upArrow: { typed: OPEN_ROW, picked: LISTED[0] as string },
  downArrow: { typed: OPEN_ROW, picked: LISTED[2] as string },
  // A Tab on this row has nothing to add — what the words agree on is already typed — so it
  // leaves the row and the pick where they were.
  tab: { typed: OPEN_ROW, picked: LISTED[1] as string },
  // The two that shut it: Escape, and the chord that clears the row.
  escape: { typed: '', picked: NOBODY },
  ctrl: { typed: '', picked: NOBODY },
  // THE FOUR THAT MOVE THE WINDOW AND NOT THE ROW, and this is exactly the answer the count
  // above exists to force somebody to write down. What they move is which part of the roll a
  // reader is looking at, which is not a question about the line being typed at all — so the row
  // is what it was and the pick is what the list under it still holds (`repl/console.ts`,
  // `repl/scrolling.ts`). They reach no arm of the reducer, and this table is where that is
  // ASSERTED rather than assumed.
  pageUp: { typed: OPEN_ROW, picked: LISTED[1] as string },
  pageDown: { typed: OPEN_ROW, picked: LISTED[1] as string },
  home: { typed: OPEN_ROW, picked: LISTED[1] as string },
  end: { typed: OPEN_ROW, picked: LISTED[1] as string },
};

describe('every key of this language says what it leaves picked', () => {
  it('answers for all of them, and for no key that does not exist', () => {
    // THE COUNT IS THE GUARD. A key added to {@link Keystroke} is a key with an answer to
    // *what is picked now* whether or not anybody wrote one down, and a table read against the
    // keystroke's own fields is what turns that into a red case instead of a silent behaviour.
    expect(Object.keys(WHAT_EACH_KEY_LEAVES).sort()).toEqual(Object.keys(press('')).sort());
  });

  for (const [key, left] of Object.entries(WHAT_EACH_KEY_LEAVES)) {
    it(`${key}: leaves “${left.typed}” with “${left.picked}” picked`, () => {
      // The chord is pressed with the letter that clears the row, which is the one a chord can
      // do to a list; a chord this session has no use for changes nothing at all and is asserted
      // above with the rest of them.
      const stroke =
        key === 'input'
          ? press(NARROWS_TO_THE_PICK)
          : press(key === 'ctrl' ? 'u' : '', { [key]: true });
      const row = after(stroke);
      expect({ typed: row.typed, picked: row.picked }).toEqual(left);
    });
  }
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
