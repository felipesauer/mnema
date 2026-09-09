/**
 * ONE KEY, AND WHAT IT DECIDES — the bare name's reducer, asked in this process.
 *
 * The question is driven end to end at a real pseudo-terminal
 * (`tests/the-bare-name-asks.test.ts`): doors offered, Enter opening one, arrows walking and
 * holding, leaving without choosing. That file proves the SURFACE answers, and it proves it
 * over the built binary — a child process, which instruments no line of this source and
 * observes no value this module produced. Both halves are real and neither is this one.
 *
 * WHAT IS ASKED HERE IS THE REDUCER, and the seam it is asked through is the one the module
 * already has: the screen arrives by dynamic import ({@link theChoice}, `./screen.js`), so
 * standing in for it hands this file the very `pressed` the product installed. Keys go in
 * through that callback and what comes out is the answer the promise settles with and the
 * pages the screen was told to draw — which is why every case below reads a value the
 * PRODUCT produced rather than one it built and asserted back.
 *
 * IT IS ITS OWN FILE BECAUSE `vi.mock` IS FILE-GLOBAL, the same reason
 * `tests/mcp-flag-reaches-the-server.test.ts` is one: the screen is stood in for here, and
 * the real one is drawn — with ink, in this process — in
 * `tests/the-screen-a-choice-is-drawn-on.test.ts`. Between the two, and the pty file above
 * them, the reducer, the adapter and the surface are each held by something that can see it.
 *
 * WHAT IT IS NOT: nothing here draws. The screen is a stand-in, so no assertion below says
 * what a terminal shows — it says what rows the product handed a screen, and what line it
 * answered with.
 */

import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../cli.js';
import { type Keystroke, keystrokesOf } from '../repl/editing.js';
import type { Leaving } from '../repl/leaving.js';
import { PICK } from '../repl/palette.js';
import { standing } from '../repl/standing.js';
import type { CliIo } from '../wiring/io.js';
import { theChoice } from './asked.js';
import { type Door, theDoors } from './doors.js';
import type { Screen, ScreenRequest } from './screen.js';

// ---------------------------------------------------------------------------
// The screen, stood in for
// ---------------------------------------------------------------------------

/** Everything the product did to the screen it opened, and the callback it installed on it. */
const drawn = vi.hoisted(() => ({
  /** Every request `openScreen` was called with, in call order. */
  opened: [] as unknown[],
  /** Every page the product asked for: the one it opened with, then every `show`. */
  pages: [] as string[][],
  /** How many times the product closed it. */
  closes: 0,
}));

vi.mock('./screen.js', () => ({
  openScreen: (request: ScreenRequest): Screen => {
    drawn.opened.push(request);
    drawn.pages.push([...request.rows]);
    return {
      show: (rows: readonly string[]) => {
        drawn.pages.push([...rows]);
      },
      close: () => {
        drawn.closes += 1;
      },
    };
  },
}));

// ---------------------------------------------------------------------------
// A keystroke, whole
// ---------------------------------------------------------------------------

/**
 * One keystroke, as the layout library delivers it: what the key produced, and which named
 * key it was.
 *
 * IT IS SPELLED WHOLE and a case below proves it is, because nothing type-checks a test in
 * this repository — `packages/code/tsconfig.json` excludes the test files under `src`, and
 * vitest strips types without checking them. A value built out of SOME of the fields would
 * let an arm of the reducer that reads one of the others go unasserted while every
 * assertion here stayed green, so the totality is asked of the product at run time
 * ({@link keystrokesOf}, which builds its answers out of the module's own blank key).
 */
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

/** One escape byte, written as an escape so no control byte enters this file. */
const ESC = '\u001b';

/** The keys a caller answers this question with, as a keyboard names them. */
const CTRL_C = press('c', { ctrl: true });
const CTRL_D = press('d', { ctrl: true });
const ESCAPE = press(ESC, { escape: true });
const RETURN = press('\r', { return: true });
const UP = press(`${ESC}[A`, { upArrow: true });
const DOWN = press(`${ESC}[B`, { downArrow: true });

// ---------------------------------------------------------------------------
// The doors this question is asked with
// ---------------------------------------------------------------------------

/** A port nothing here writes to: the program is built for its declarations alone. */
const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

/**
 * THE DOORS THIS PROCESS WILL BE OFFERED — the same two readings the product makes, made
 * here so a case can name the line it expects back.
 *
 * WHAT each door IS, and that the pair depends on the directory, is `doors.test.ts`; what
 * is asked here is which of them a KEY lands on. The derivation cannot drift in silence:
 * every case below also reads the page the product handed the screen, and a disagreement
 * between this list and that page reddens on the mark.
 */
const doors = theDoors(buildProgram(quiet).verbs, standing().project !== undefined);

/** A process that hooks nothing: this file drives the reducer, not the process. */
const hooksNothing: Leaving = {
  on: () => undefined,
  off: () => undefined,
  raise: () => undefined,
};

// ---------------------------------------------------------------------------
// Asking, and answering
// ---------------------------------------------------------------------------

/** What a question that is still on the screen answers with — a value no door can be. */
const STILL_ASKING = Symbol('the question is still on the screen');

/** One question, open: the keys go in here and the answer comes out. */
interface Asking {
  /** Press a key, exactly as the screen would have delivered it. */
  readonly press: (stroke: Keystroke) => void;
  /** Every page the product has asked for so far, the opening one first. */
  readonly pages: () => readonly (readonly string[])[];
  /** How many times it closed the screen. */
  readonly closes: () => number;
  /** What it answered, or {@link STILL_ASKING} if it has not. */
  readonly answered: () => Promise<readonly string[] | undefined | symbol>;
  /** Every line that reached the port, and every byte that reached the page. */
  readonly wrote: () => string;
}

/** Waits for something to become true, and says what it was waiting for when it does not. */
async function until(is: () => boolean, what: string, within = 5_000): Promise<void> {
  const by = Date.now() + within;
  while (!is()) {
    if (Date.now() > by) throw new Error(`never ${what}`);
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }
}

/** Asks, and answers once the product has opened its screen. */
async function asking(): Promise<Asking> {
  drawn.opened.length = 0;
  drawn.pages.length = 0;
  drawn.closes = 0;

  const said: string[] = [];
  const io: CliIo = {
    out: (line) => said.push(line),
    err: (line) => said.push(line),
    fail: (line) => said.push(line),
  };
  const page = new PassThrough();
  page.on('data', (chunk: Buffer) => said.push(String(chunk)));

  const answer = theChoice({
    io,
    input: new PassThrough() as unknown as NodeJS.ReadStream,
    output: page as unknown as NodeJS.WriteStream,
    leaving: hooksNothing,
  });
  // The screen arrives by dynamic import, so it is open a turn of the loop later at the
  // earliest. Waited for rather than assumed: a case that pressed a key into an undefined
  // callback would die of a TypeError and say nothing about the reducer.
  await until(() => drawn.opened.length === 1, 'opened a screen');

  const opened = drawn.opened[0] as ScreenRequest;
  return {
    press: (stroke) => {
      opened.pressed(stroke);
    },
    pages: () => drawn.pages,
    closes: () => drawn.closes,
    answered: async () =>
      await Promise.race([
        answer,
        new Promise<symbol>((resolve) => {
          setTimeout(() => resolve(STILL_ASKING), 0);
        }),
      ]),
    wrote: () => said.join(''),
  };
}

/** Which door the mark is on, read off a page the PRODUCT composed. */
function markedOn(page: readonly string[]): Door | undefined {
  const marked = page.find((row) => row.includes(PICK));
  return doors.find((door) => marked?.includes(door.word) === true);
}

/** The page the product asked for last. */
const lastPage = (asked: Asking): readonly string[] =>
  asked.pages()[asked.pages().length - 1] ?? [];

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

describe('the keystroke the product installed is the one this file presses', () => {
  it('opens with the first door marked, on a page the product composed', async () => {
    const asked = await asking();
    // THE NON-VACUITY OF EVERY CASE BELOW, in both directions: the list this file derives
    // and the page the product drew agree about which door is which, and there really is a
    // mark on the opening page rather than a question with nothing under the cursor.
    expect(asked.pages()).toHaveLength(1);
    expect(markedOn(lastPage(asked))).toEqual(doors[0]);
    expect(doors.length).toBeGreaterThan(1);
    asked.press(ESCAPE);
    await asked.answered();
  });

  it('spells a whole keystroke, asked of the module that builds them', async () => {
    // NOTHING TYPE-CHECKS A TEST HERE, so the totality of `press` is a run-time question.
    // `keystrokesOf` answers it: every stroke it returns is built out of the module's own
    // blank key, so a field added to a keystroke appears there and not in the literal above.
    const [fromTheProduct] = keystrokesOf(press(`${ESC}x`));
    expect(fromTheProduct).toBeDefined();
    expect(Object.keys(press('x')).sort()).toEqual(Object.keys(fromTheProduct ?? {}).sort());
  });
});

describe('the three ways of saying this is not what I wanted', () => {
  for (const [named, key] of [
    ['Ctrl-C', CTRL_C],
    ['Ctrl-D', CTRL_D],
    ['Escape', ESCAPE],
  ] as const) {
    it(`answers ${named} with nothing, and gives the screen back`, async () => {
      const asked = await asking();
      asked.press(key);
      // NOTHING IS NOT AN ERROR AND IT IS NOT A DOOR. The three are one answer because they
      // are one intention, and the value that says so is `undefined` rather than a line.
      expect(await asked.answered()).toBeUndefined();
      expect(asked.closes(), `${named} left the screen open`).toBe(1);
      // AND NOT A BYTE WAS WRITTEN BY ASKING — the promise the module's own comment makes.
      expect(asked.wrote()).toBe('');
    });
  }

  it('takes the chord before the character it carries — Ctrl-D leaves, `d` does not', async () => {
    // THE ORDER OF THE GUARDS, which the module says is the mechanism rather than tidiness:
    // a control chord carries a character too. `d` is a key this question has no use for.
    const asked = await asking();
    asked.press(press('d'));
    expect(await asked.answered(), '`d` was read as the way out').toBe(STILL_ASKING);
    asked.press(CTRL_D);
    expect(await asked.answered()).toBeUndefined();
  });

  it('answers no other chord at all, and does not read it as the key it carries', async () => {
    // CTRL-UP IS NOT UP. The chord is asked FIRST and of the WHOLE keystroke, so a chord
    // this question has no use for stops there — it neither leaves nor moves the mark.
    const asked = await asking();
    asked.press(press('x', { ctrl: true }));
    asked.press(press(`${ESC}[A`, { upArrow: true, ctrl: true }));
    asked.press(press(`${ESC}[B`, { downArrow: true, ctrl: true }));
    expect(await asked.answered(), 'a chord answered the question').toBe(STILL_ASKING);
    expect(asked.pages(), 'a chord moved the mark').toHaveLength(1);
    expect(asked.closes()).toBe(0);
    asked.press(ESCAPE);
    await asked.answered();
  });
});

describe('Enter answers with the line the marked door runs', () => {
  it('hands back the argv of the door the mark is on, and nothing else', async () => {
    const asked = await asking();
    asked.press(RETURN);
    expect(await asked.answered()).toEqual(doors[0]?.argv);
    expect(asked.closes()).toBe(1);
    expect(asked.wrote(), 'answering ran the line here').toBe('');
  });

  it('follows the mark rather than the list — Enter after an arrow is the second door', async () => {
    // WHAT RETURN TAKES AND WHAT THE ROW SHOWS ARE ONE READING, which is what the module
    // asks `theDoorPicked` for rather than comparing inline. Both halves are read here: the
    // mark on the page the product last drew, and the line it answered with.
    const asked = await asking();
    asked.press(DOWN);
    expect(markedOn(lastPage(asked))).toEqual(doors[1]);
    asked.press(RETURN);
    expect(await asked.answered()).toEqual(doors[1]?.argv);
  });
});

describe('the arrows walk this list, and the ends hold', () => {
  it('draws a new page with the mark one door on', async () => {
    const asked = await asking();
    asked.press(DOWN);
    // A STEP IS A PAGE. The reducer redraws where the mark moved, so what a caller sees is
    // the answer Return is about to give — a move that changed the pick and not the page
    // would be a question whose cursor lies.
    expect(asked.pages()).toHaveLength(2);
    expect(markedOn(lastPage(asked))).toEqual(doors[1]);
    asked.press(ESCAPE);
    await asked.answered();
  });

  it('holds at the last door rather than wrapping to the first', async () => {
    const asked = await asking();
    for (let step = 0; step < doors.length + 2; step += 1) asked.press(DOWN);
    expect(markedOn(lastPage(asked))).toEqual(doors[doors.length - 1]);
    asked.press(RETURN);
    expect(await asked.answered()).toEqual(doors[doors.length - 1]?.argv);
  });

  it('holds at the first door rather than wrapping to the last', async () => {
    const asked = await asking();
    asked.press(DOWN);
    asked.press(UP);
    asked.press(UP);
    expect(markedOn(lastPage(asked))).toEqual(doors[0]);
    asked.press(RETURN);
    expect(await asked.answered()).toEqual(doors[0]?.argv);
  });

  it('walks up and down by ONE door, in the direction the key names', async () => {
    // THE TWO ARMS ARE NOT ONE. A reducer that read both arrows as the same step would pass
    // every case above — the ends hold, so a walk that went the wrong way from the first
    // door would sit still and look like holding.
    const asked = await asking();
    asked.press(DOWN);
    expect(markedOn(lastPage(asked))).toEqual(doors[1]);
    asked.press(UP);
    expect(markedOn(lastPage(asked))).toEqual(doors[0]);
    asked.press(ESCAPE);
    await asked.answered();
  });
});

describe('every other key does nothing, which is the arm that has to exist', () => {
  it('answers a letter, a tab and every key it has no use for with the page it drew', async () => {
    // THE ARM THE MODULE SAYS HAS TO EXIST: a page that threw on a function key would be a
    // question that dies of one. What is asserted is all three halves of doing nothing —
    // no answer, no new page, and no screen given back.
    const asked = await asking();
    for (const stroke of [
      press('x'),
      press('', { delete: true }),
      press('', { leftArrow: true }),
      press('', { tab: true }),
      press('', { pageDown: true }),
      press('', { home: true }),
      press('', { backspace: true }),
      press(`${ESC}[C`, { rightArrow: true }),
    ]) {
      asked.press(stroke);
    }
    expect(await asked.answered(), 'a key with no meaning answered the question').toBe(
      STILL_ASKING,
    );
    expect(asked.pages(), 'a key with no meaning redrew the page').toHaveLength(1);
    expect(asked.closes(), 'a key with no meaning closed the screen').toBe(0);
    expect(asked.wrote()).toBe('');
    asked.press(ESCAPE);
    await asked.answered();
  });

  it('reads a chunk as the keys it holds, and stops answering after the first way out', async () => {
    // A CHUNK IS NOT A KEY. A fast keyboard or a paste is several keystrokes in one string,
    // and this one carries the way out FOLLOWED by more: the escape answers, and what came
    // after it must not touch a page that is already gone.
    const asked = await asking();
    asked.press(press(`${ESC}xy`));
    expect(await asked.answered()).toBeUndefined();
    expect(asked.pages(), 'a key after the answer redrew the page').toHaveLength(1);
    // AND IT CLOSED ONCE. The screen is given back exactly once however many keys the chunk
    // that ended the question held.
    expect(asked.closes()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The two branches that are left, and why no case above reaches them
// ---------------------------------------------------------------------------

/** This module's own source, for the two questions no keystroke can answer. */
const SOURCE = readFileSync(new URL('./asked.ts', import.meta.url), 'utf-8');

describe('what is left uncovered here is unreachable, and says so', () => {
  it('never opens with no door, so the pick can never fall back to nothing', () => {
    // `doors[0]?.word ?? ''` — the empty string is a branch nothing can take, because the
    // list is a pair in both states of the directory and neither arm of `theDoors` can
    // build a shorter one. It is asserted of the VALUE rather than argued about, and in
    // both states, because a reader of the coverage report is owed the reason a line is
    // amber. `doors.test.ts` is what says WHICH two.
    const verbs = buildProgram(quiet).verbs;
    for (const inProject of [true, false]) {
      expect(theDoors(verbs, inProject).length, `no doors when inProject=${inProject}`).toBe(2);
      expect(theDoors(verbs, inProject)[0]?.word.length).toBeGreaterThan(0);
    }
  });

  it('answers from one place, so the second guard on leaving cannot fire', () => {
    // `leave` opens with `if (left) return`, and no case above reaches it — because every
    // call to it is inside the key reducer, which ALREADY returned on that same flag one
    // line earlier. The inner guard is a second reading of one fact, and it is unreachable
    // today rather than wrong: `leave` is also what a caller would reach for from a hook,
    // and the day something outside the reducer calls it this case goes red and the branch
    // becomes a case instead of a paragraph.
    const reducer = SOURCE.slice(
      SOURCE.indexOf('const key = ('),
      SOURCE.indexOf('screen = openScreen('),
    );
    // NON-VACUITY FIRST, both halves: the cut is a real slice of this module, and the calls
    // really are in it. A scanner that cut nothing would prove nothing about where they are.
    expect(reducer.length).toBeGreaterThan(200);
    expect(reducer).toContain('if (left) return;');
    const calls = (text: string): number => text.split(/\bleave\(/).length - 1;
    expect(calls(reducer), 'the reducer stopped being where leaving is decided').toBe(3);
    expect(calls(SOURCE) - calls(reducer), 'something outside the reducer leaves').toBe(0);
  });
});
