/**
 * WHERE THE CHOICE IS DRAWN, drawn — the ink adapter, at streams that are not a terminal.
 *
 * `choice/screen.ts` is the smallest thing this product asks a layout library for: it draws
 * rows and it reads keys, it decides nothing, and it gives the terminal back on every way
 * this process can stop. Until now nothing in this repository observed a value it produced.
 * What named it read its SOURCE — `one-authority-over-colour.test.ts` proves ink is loaded
 * dynamically by parsing the import declarations — and what exercised it was a pseudo-
 * terminal running the built binary, which instruments no line of it.
 *
 * A PREMISE THIS SLICE OPENED UNDER WAS FALSE, and saying which is the point of writing it
 * down. The premise was that no test here renders ink in process, so a case like this one
 * would be the first and would be risking a worker that hangs on a mount nobody unmounted.
 * Measured, it is the third: `openConsole` — the same library, a bigger page — is rendered
 * in process over {@link fakeTerminal} by `a-floor-under-the-window.test.ts` and
 * `one-width-per-frame.test.ts`, and `the-bare-name-asks.test.ts` already drives the whole
 * question, this adapter included, through `start()` at a pair of fake streams. What the
 * premise got right is that a mount that outlives its case is worse than a case that is
 * missing, so THAT is asserted here rather than assumed: every case below closes, and one of
 * them proves closing is what stops the keys arriving.
 *
 * WHAT IS ASKED HERE, and it is only what this file can see: the two things a caller can do
 * to a drawn choice ({@link Screen}), the state machine `close` is — idempotent, and
 * synchronous, because an `exit` listener is the last code that runs — and that closing
 * unhooks the listeners it armed. WHAT IT IS NOT: whether the terminal came back. Nothing
 * here has a line discipline or a cursor, so raw mode and the caret are asked of a real
 * device, where they always were (`the-console-on-ink.test.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { openScreen, type Screen } from '../src/choice/screen.js';
import type { Keystroke } from '../src/repl/editing.js';
import { EXIT_SIGNALS, type Leaving } from '../src/repl/leaving.js';
import { fakeTerminal, until } from './support/console.js';
import { screenOf } from './support/screen.js';

/** The rows a case opens with, and the ones it redraws with. Two pages, told apart by a word. */
const OPENING = ['what would you like to do here?', '', 'the first door', 'the second door'];
/** Ctrl-C as a terminal sends it, spelled by its code point like every control byte here. */
const CTRL_C = '\u0003';

const AFTER = ['what would you like to do here?', '', 'the first door', 'a third door'];

/**
 * A process whose hooks are counted — the port `armLeaving` is handed, with a memory.
 *
 * It is not {@link hooksNothing}: what is asked below is that closing UNHOOKS, and a port
 * that forgets what it was told cannot answer it. Every listener is kept in the order it
 * arrived, and taking one off removes THAT listener, exactly as the real process does — a
 * stand-in that emptied the list on any `off` would call a screen that unhooked one of five
 * fully unhooked.
 */
function countingLeaving(): Leaving & { hooked: () => readonly string[]; raised: () => number } {
  const hooked: { event: string; listener: () => void }[] = [];
  let raised = 0;
  return {
    on: (event, listener) => {
      hooked.push({ event, listener });
    },
    off: (event, listener) => {
      const at = hooked.findIndex((one) => one.event === event && one.listener === listener);
      if (at >= 0) hooked.splice(at, 1);
    },
    raise: () => {
      raised += 1;
    },
    hooked: () => hooked.map((one) => one.event),
    raised: () => raised,
  };
}

/**
 * HOW BIG THE PAGE THIS FILE DRAWS ON IS.
 *
 * A PAIR OF PIPES IS NOT A SCREEN, which is what the first reading of this file got wrong:
 * every byte the library writes stays in the stream, so the page BEFORE a redraw and the page
 * after it are both in it and a reader of the bytes finds both. What is on the page is a
 * question only a screen has an answer to, so the redraw below is read off the model this
 * surface already keeps for it (`support/screen.ts`), replayed at the size the streams
 * reported — a replay at any other number is a page whose rows are off by whatever folded.
 */
const WIDE = 100;
const TALL = 40;

/** One drawn choice, and everything a case needs to read off it. */
interface Drawn {
  readonly screen: Screen;
  readonly terminal: ReturnType<typeof fakeTerminal>;
  readonly leaving: ReturnType<typeof countingLeaving>;
  /** Every keystroke the library handed back, in arrival order. */
  readonly pressed: () => readonly Keystroke[];
  /** What a terminal this size would be SHOWING, worked out from the bytes it received. */
  readonly showing: () => string;
  /** Whether the alternate screen is up — whether this question took the caller's page. */
  readonly tookTheScreen: () => boolean;
}

/** Every screen a case in this file opened, so none of them outlives it. */
const opened: Screen[] = [];

afterEach(() => {
  // A MOUNT THAT OUTLIVES ITS CASE IS THE ONE FAILURE THIS FILE COULD CAUSE ELSEWHERE, and
  // it would not look like a red case — it would look like a worker that never finishes.
  // `close` is idempotent, which is what lets this run after a case that already closed.
  for (const screen of opened.splice(0)) screen.close();
});

/** Draws the opening page at a pair of streams that answer everything the library asks. */
async function drawn(rows: readonly string[] = OPENING): Promise<Drawn> {
  const terminal = fakeTerminal({ columns: WIDE, rows: TALL });
  const leaving = countingLeaving();
  const keys: Keystroke[] = [];
  const screen = openScreen({
    stdin: terminal.stdin,
    stdout: terminal.stdout,
    rows,
    pressed: (stroke) => {
      keys.push(stroke);
    },
    leaving,
  });
  opened.push(screen);
  const showing = (): string => screenOf(terminal.bytes(), WIDE, TALL).text;
  await until(() => showing().includes(rows[rows.length - 1] ?? ''), 'drew the opening page');
  return {
    screen,
    terminal,
    leaving,
    pressed: () => keys,
    showing,
    tookTheScreen: () => screenOf(terminal.bytes(), WIDE, TALL).alternate,
  };
}

describe('the choice is drawn where the cursor already was', () => {
  it('puts every row on the page, and the blank one among them', async () => {
    const { showing, tookTheScreen } = await drawn();
    for (const row of OPENING) {
      expect(showing(), `\`${row}\` is not on the page`).toContain(row);
    }
    // AND THE SCREEN WAS NOT TAKEN. A question that cleared the caller's terminal to ask
    // itself would take away the very thing they were looking at when they typed the name.
    // It is asked of the screen rather than of the bytes: what a sequence DID is the model's
    // answer, and a case reading for the sequence would be asserting about a spelling.
    expect(tookTheScreen(), 'the question took the screen').toBe(false);
  });

  it('hands every keystroke back and decides nothing about it', async () => {
    const { terminal, pressed } = await drawn();
    terminal.type('q');
    await until(() => pressed().length > 0, 'handed a keystroke back');
    // WHAT ARRIVED FROM THE KEYBOARD, HANDED STRAIGHT ON: what a key MEANS is decided where
    // the pick is (`choice/asked.ts`), and this adapter has no opinion about it.
    expect(pressed()[0]?.input).toBe('q');
    expect(pressed()[0]?.ctrl).toBe(false);
  });

  it('does not answer Ctrl-C itself — it hands it on like any other key', async () => {
    // THE LIBRARY WOULD HAVE EXITED THE PROCESS. Leaving is this product's decision, taken
    // where the pick is, so the chord has to arrive as a keystroke rather than as an exit.
    const { terminal, pressed } = await drawn();
    terminal.type(CTRL_C);
    await until(() => pressed().length > 0, 'handed the chord back');
    expect(pressed()[0]?.ctrl).toBe(true);
    expect(pressed()[0]?.input).toBe('c');
  });
});

describe('showing draws the rows it was given instead of the ones on the page', () => {
  it('replaces the page, so what is on it is the new rows', async () => {
    const { screen, showing } = await drawn();
    screen.show(AFTER);
    await until(() => showing().includes('a third door'), 'drew the page it was shown');
    // THE OLD ROW IS OFF THE PAGE. The library takes its own rows back when it redraws, so
    // a `show` that appended rather than replaced would leave both doors on the screen at
    // once — which is a question with three doors and two of them stale.
    expect(showing(), 'the row it replaced is still on the page').not.toContain('the second door');
    // AND THE ROWS IT DID NOT CHANGE ARE STILL THERE: a redraw is a page, not a diff.
    expect(showing()).toContain('the first door');
  });

  it('draws nothing at all once the screen has been given back', async () => {
    // THIS CASE WAS WRITTEN UNDER A PREMISE ITS OWN MUTATION FALSIFIED, and the premise was
    // that the library REFUSES a rerender after an unmount, so `show`'s `if (closed) return`
    // is what stands between a caller and a throw out of a menu that is already gone. Taking
    // that guard away reddens NOTHING — measured, on ink 7.1.1: a rerender after an unmount
    // neither throws nor writes a byte. The guard is the third statement of an invariant two
    // collaborators already keep, which is a note for whoever next reads `screen.ts` and not
    // a reason to stop asserting the property: what is pinned here is that a closed screen
    // draws nothing, whoever delivers it. It is not vacuous either — taking the guard away
    // AND leaving the page mounted reddens this case and only this case.
    const { screen, terminal, showing } = await drawn();
    screen.close();
    await until(() => true, 'closed');
    const before = terminal.bytes();
    screen.show(AFTER);
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    expect(terminal.bytes(), 'a closed screen drew something').toBe(before);
    expect(showing(), 'a closed screen drew the rows it was shown').not.toContain('a third door');
  });
});

describe('closing takes the page down, once, and gives every hook back', () => {
  it('arms one listener for `exit` and one for each signal that ends this program', async () => {
    const { leaving } = await drawn();
    // THE SET IS THE POINT. It is not "give the terminal back when the question ends", it is
    // "give it back on EVERY way this process ends" — so the hooks are counted against the
    // product's own enumeration rather than against a list retyped here.
    expect(leaving.hooked()).toEqual(['exit', ...EXIT_SIGNALS]);
  });

  it('unhooks every one of them when the page comes down', async () => {
    const { screen, leaving } = await drawn();
    expect(leaving.hooked().length).toBeGreaterThan(0);
    screen.close();
    // A QUESTION THAT LEFT ITS HOOKS ON would give a terminal back that the next thing in
    // this process had already taken, which is the defect `armLeaving` returns a disarm for.
    expect(leaving.hooked()).toEqual([]);
    expect(leaving.raised(), 'closing raised a signal at this process').toBe(0);
  });

  it('is idempotent, and the second close is not a second teardown', async () => {
    const { screen, leaving } = await drawn();
    screen.close();
    const afterTheFirst = leaving.hooked();
    // TWO OF THESE CAN FIRE ON ONE DEATH — a signal arriving while the normal path unwinds —
    // so closing twice has to be closing once, and `armLeaving` requires it in writing.
    // AND THE GUARD IS NOT WHAT DELIVERS IT TODAY, which was this case's first premise and
    // is measured false: taking `restore`'s `if (closed) return` away reddens nothing,
    // because a second unmount does not throw and a disarm over an emptied list is a loop
    // with no turns. What is asserted is therefore the CONTRACT `Screen.close` states —
    // idempotent — rather than the line that happens to state it a third time.
    expect(() => {
      screen.close();
      screen.close();
    }).not.toThrow();
    expect(leaving.hooked()).toEqual(afterTheFirst);
  });

  it('THE TEETH: closing is what stops the keys, so the page really came down', async () => {
    // WITHOUT THIS the cases above are about a bookkeeping flag. A screen that unhooked its
    // listeners and left the component mounted would satisfy every one of them, and would be
    // a menu still reading the caller's keyboard after the question was answered.
    const { screen, terminal, pressed } = await drawn();
    terminal.type('a');
    await until(() => pressed().length === 1, 'handed the first key back');
    screen.close();
    terminal.type('b');
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(
      pressed().map((one) => one.input),
      'a closed screen was still reading keys',
    ).toEqual(['a']);
  });
});
