/**
 * WHAT THE BARE NAME OFFERS, with no terminal in the case.
 *
 * The doors and the page they are drawn as are a function of two facts — what the program
 * declared, and whether there is a project here — so everything about WHAT is offered can be
 * asked without a device. What needs one is whether a key moves the mark and whether
 * choosing runs the line, and that is `tests/the-bare-name-asks.test.ts`.
 *
 * THE ELO THIS FILE HOLDS is the one a rename would break in silence: what a door says it
 * does is the VERB'S OWN sentence, read off the declaration commander routes with. A door
 * pointing at a word this program no longer registers comes back with an empty column, which
 * is exactly what nobody would notice on a screen.
 */

import { describe, expect, it } from 'vitest';
import { buildProgram } from '../cli.js';
import { renderPlain } from '../presentation/plain.js';
import { PICK, theNextPicked } from '../repl/palette.js';
import { INIT_VERB } from '../wiring/init.js';
import type { CliIo } from '../wiring/io.js';
import { REPL_VERB } from '../wiring/repl.js';
import { theChoicePage, theDoorRows, theDoors, theKeys } from './doors.js';

/** A port nothing here writes to: the program is built for its declarations alone. */
const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

/** What this program declared, read off a program built the way the entry builds one. */
const verbs = buildProgram(quiet).verbs;

/** The doors in each of the two states a directory can be in. */
const inAProject = theDoors(verbs, true);
const outsideOne = theDoors(verbs, false);

/** What a declaration says a verb does, asked of the program rather than retyped. */
function declares(verb: string): string {
  const found = verbs.find((declared) => declared.act.name() === verb);
  expect(found, `this program no longer declares \`${verb}\``).toBeDefined();
  return found?.act.description() ?? '';
}

describe('the doors are a function of the directory', () => {
  it('offers the console in a project and establishing one outside it', () => {
    expect(inAProject.map((door) => door.argv)).toEqual([[REPL_VERB], ['--help']]);
    expect(outsideOne.map((door) => door.argv)).toEqual([[INIT_VERB], ['--help']]);
    // TWO DOORS IN BOTH STATES, and the SECOND is the same door: the catalogue is the answer
    // this invocation used to give, and it is kept whatever the directory holds.
    expect(inAProject).toHaveLength(2);
    expect(outsideOne).toHaveLength(2);
    expect(inAProject[1]).toEqual(outsideOne[1]);
    // AND THE FIRST IS NOT. A pair of doors that ignored the state of the directory would
    // pass every assertion about a menu and answer the wrong question.
    expect(inAProject[0]).not.toEqual(outsideOne[0]);
  });

  it('says what each door does in the words of the verb that declares it', () => {
    // THE ELO. A verb renamed, or one whose description changed, moves this case — and a
    // door that carried its own copy of the sentence would go on advertising the old one.
    expect(inAProject[0]?.description).toBe(declares(REPL_VERB));
    expect(outsideOne[0]?.description).toBe(declares(INIT_VERB));
    // AND NEITHER IS EMPTY, which is what a door pointing at a word nobody registers would
    // leave behind: a column with nothing in it, on a screen where nothing looks wrong.
    for (const doors of [inAProject, outsideOne]) {
      for (const door of doors) expect(door.description.length, door.word).toBeGreaterThan(0);
    }
  });

  it('offers a line that could have been typed, and nothing else', () => {
    // EVERY DOOR IS AN ARGV THIS CLI ALREADY ANSWERS TO, which is the whole guarantee: what
    // a menu can reach is what a caller could have reached at a shell.
    for (const door of [...inAProject, ...outsideOne]) {
      expect(door.argv.length, door.word).toBe(1);
      const word = door.argv[0] as string;
      const known = word.startsWith('-') || verbs.some((declared) => declared.act.name() === word);
      expect(known, `\`mnema ${word}\` is not a line this program answers to`).toBe(true);
    }
  });
});

describe('the mark is on one row, and the arrows are the list of words’ arrows', () => {
  it('marks the picked door and no other, in a column every row carries', () => {
    const rows = theDoorRows(inAProject, inAProject[1]?.word ?? '').map(renderPlain);
    const marked = rows.filter((row) => row.includes(PICK));
    expect(marked, `exactly one row carries ${PICK}`).toHaveLength(1);
    expect(marked[0], 'the mark is on the wrong row').toContain(inAProject[1]?.word);
    // THE MARK IS A COLUMN AND NOT AN INSERTION, which is what keeps the words under it
    // lined up: every door's name starts at the same offset, marked or not. A glyph added to
    // the picked row alone would push that row three columns right of its neighbour.
    const where = inAProject.map((door, at) => (rows[at] as string).indexOf(door.word));
    expect(new Set(where).size, `the rows do not line up: ${rows.join(' / ')}`).toBe(1);
    expect(where[0], 'the names were not found on the rows at all').toBeGreaterThan(0);
  });

  it('walks with the list of words’ own function, so the ends hold', () => {
    // NOT A SECOND REDUCER. The step, the ends and what a word means are `theNextPicked`'s,
    // asked here with these doors — so a delivery that changed how the palette's arrows move
    // moves these with them.
    const first = inAProject[0]?.word as string;
    const last = inAProject[1]?.word as string;
    expect(theNextPicked(inAProject, first, 1)).toBe(last);
    expect(theNextPicked(inAProject, last, -1)).toBe(first);
    // THE ENDS HOLD RATHER THAN WRAP, which is what a list is and a carousel is not.
    expect(theNextPicked(inAProject, last, 1)).toBe(last);
    expect(theNextPicked(inAProject, first, -1)).toBe(first);
  });

  it('draws no mark at all when nothing is picked', () => {
    // The vacuity guard of the case above: a row that carried the glyph unconditionally
    // would satisfy "exactly one is marked" and mean nothing.
    const rows = theDoorRows(inAProject, 'a word no door has').map(renderPlain);
    expect(rows.filter((row) => row.includes(PICK))).toHaveLength(0);
  });
});

describe('the page is composed whole, and it asks a question', () => {
  it('names the program, asks, lists both doors, and says which keys answer', () => {
    const page = theChoicePage('mnema', outsideOne, outsideOne[0]?.word ?? '', renderPlain);
    const text = page.join('\n');
    expect(page[0], 'the page does not name the program').toContain('mnema');
    expect(page[0], 'the page does not ask anything').toContain('?');
    for (const door of outsideOne) expect(text, door.word).toContain(door.word);
    // THE KEYS ROW IS THE PAGE'S LAST, asked of the function that composes it rather than
    // retyped — a case that spelled the words would go stale the day they change.
    expect(page.at(-1)).toBe(renderPlain(theKeys()));
    // AND IT NAMES ALL THREE KEYS, which is the whole of what a caller can do here.
    expect(page.at(-1)).toContain('Enter');
    expect(page.at(-1)).toContain('Esc');
    // BREATH BETWEEN THE PARTS: the page arrives complete, so nothing that draws it arranges
    // anything. Two blank rows, and they are rows of this page rather than of a layout.
    expect(
      page.filter((row) => row.length === 0),
      `the page: ${JSON.stringify(page)}`,
    ).toHaveLength(2);
  });
});
