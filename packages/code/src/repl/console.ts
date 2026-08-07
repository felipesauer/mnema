/**
 * THE CONSOLE: the session's own page inside the caller's terminal.
 *
 * It is the piece that mounts the layout library, and the only one. `gate.ts` decides
 * what a typed line MEANS, `editing.ts` decides what a keystroke does to the row being
 * typed, `region.ts` decides where a line lands — and this drives the three: everything
 * the session has already said stays above, permanently, and one region at the bottom is
 * redrawn as the caller types.
 *
 * THE SCROLLBACK IS THE FEATURE. What the session answered stays on the caller's own
 * page after they leave, exactly as it would have if they had typed the verbs at a
 * shell, because the only region redrawn is the input row and everything else was
 * written once and never taken back. That was measured before it was designed: the first
 * design took the ALTERNATE SCREEN, which is what a full-screen program does, and the
 * alternate screen throws the scrollback away on the way out.
 *
 * IT COMPOSES NOTHING A READER SEES EXCEPT THE ECHO. Every line that lands here arrives
 * already rendered, out of the same `presentation/` and the same renderer every other
 * invocation of this product uses. This file writes exactly two strings of its own, and
 * both are INPUT rather than report: the ECHO of what the caller typed (the prompt and
 * their own words, the way a terminal shows what you sent), and the ROW OF CANDIDATES a
 * Tab could not choose between. Neither is a fact about the record, and neither goes
 * through a renderer — for the same reason the prompt never did. The TIPS are not a
 * third: they arrive as bytes a renderer already produced, exactly like a landed line,
 * and all this file does with them is say where they go.
 *
 * THE PAGE OPENS CLEAN, AND CLEANING IT AGAIN IS THE SAME PAGE. What the caller had on
 * the screen is carried into the scrollback before anything is drawn (`page.ts`), and the
 * word that clears asks for exactly that again: the same bytes, then the opening the
 * session was handed, landed a second time. It is one value and one function, so what a
 * cleared page shows cannot come to differ from what an opened one shows — and the
 * opening is a VALUE for that reason rather than three lines somebody wrote once. In
 * particular the record is not read again: what the panel says was paid for when the
 * session opened, and a clean page that re-read it could say something different halfway
 * through a session.
 *
 * AND THE PAGE FOLLOWS THE TERMINAL, which is the THIRD caller of that same page — the
 * opening, the word that clears, and a caller who changed how wide their window is. The
 * box is drawn corner to corner, so a session opened at a hundred and twenty columns and
 * narrowed to seventy is a frame the terminal folds in half; the fix is not a special
 * redraw but the page again, at the new width. What differs from a clearing is one thing:
 * everything the session already SAID is landed with it, because a caller who resized a
 * window did not ask to lose what they had read. WIDTH ONLY — height moves no glyph of
 * the drawing — and after the size has SETTLED, because one drag of a window corner
 * delivers dozens of sizes and a page reemitted on each of them is the defect this would
 * otherwise become.
 *
 * ONE LINE AT A TIME, and it is a chain rather than a flag. A caller who pastes three
 * lines has given the terminal all three before the first one has run, and three verbs
 * running at once over one record would answer interleaved. Each submitted line waits
 * for the one before it — and so does its ECHO, which is why the echo lands inside the
 * queued turn rather than when the key was pressed: a prompt printed above the answer to
 * the question before it would read as though the second had been asked first.
 */

import { render } from 'ink';
import { createElement } from 'react';
import type { Completer } from './complete.js';
import { type Editing, type Keystroke, keystrokesOf, NOTHING_TYPED, typeKey } from './editing.js';
import type { AfterLine } from './gate.js';
import { armLeaving, type Leaving } from './leaving.js';
import { carriedIntoTheScrollback } from './page.js';
import type { Opening } from './panel.js';
import { Region, type Shown, type Watched } from './region.js';

/** What separates two words a Tab could not choose between. */
const BETWEEN_CANDIDATES = '  ';

/**
 * How wide the terminal is taken to be when the device does not say.
 *
 * Zero, so the narrowest form of everything is drawn: a width nobody reported is not a
 * width to guess at, and the form that always fits is the name.
 */
const NO_WIDTH = 0;

/**
 * How long the size has to stop changing before the page is drawn again, in milliseconds.
 *
 * A window dragged by its corner delivers a size per step and the steps are milliseconds
 * apart (measured: a hundred changes forced through a real pseudo-terminal arrive about
 * three milliseconds apart). Reemitting the page on each of them would put one drag's
 * worth of pages in the caller's scrollback, which is worse than the folded frame this
 * exists to fix. So the page follows the size the caller STOPPED at.
 *
 * A tenth of a second, and the number is chosen from both ends: it is longer than the gap
 * between two steps of a drag by more than an order of magnitude, so a drag coalesces into
 * one page; and it is at the threshold below which a person reads a response as immediate,
 * so a caller who resized once and let go does not watch the box lag behind their window.
 */
const AFTER_THE_LAST_CHANGE = 100;

/** Everything opening a console needs. */
export interface ConsoleRequest {
  /** Where the keystrokes come from. */
  readonly stdin: NodeJS.ReadStream;
  /** The page the console draws on. */
  readonly stdout: NodeJS.WriteStream;
  /** What the caller types in front of. Not a report, and so not rendered. */
  readonly prompt: string;
  /**
   * What the caller can do, already rendered, for the region that is redrawn.
   *
   * It stays under the row being typed instead of landing in the scrollback, which is
   * the difference between a tip and a line: one that has scrolled off the screen is not
   * a tip any more. Empty means the console offers none and draws no row for it.
   */
  readonly tips: string;
  /**
   * WHAT THE PAGE OPENS WITH, on a terminal of a given width — the box and the lines that
   * go with it, already composed and already measured.
   *
   * A FUNCTION AND NOT A VALUE, and the width is the whole reason. It arrived as a value
   * while the page was only ever drawn at the size the session opened at; a page that
   * follows the terminal has to be able to ask for the same opening at another width, and
   * two of the answers depend on it — which drawing there is room for, and how much of the
   * name is drawn. Everything else it returns is closed over, composed once, and never
   * asked for again.
   *
   * ⛔ IT MAY NOT READ THE RECORD, and that is the caller's promise rather than a
   * signature this file can enforce. What the panel says about the record was paid for
   * with the one read this surface declares (`session.ts`), and a redraw that asked again
   * could say something different halfway through a session — measured by counting the
   * reads three width changes cause, which is none (`tests/the-name-and-the-hints.test.ts`).
   *
   * The box goes into what is KEPT rather than into what is redrawn: it is written once
   * per page and a caller scrolls back to the top to find it, which is the same argument
   * the opening lines have always been kept by.
   */
  readonly openingFor: (columns: number) => Opening;
  /** What Tab offers, over the command tree the session was built from. */
  readonly complete: Completer;
  /** What the session does with one submitted line, and whether it goes on. */
  readonly answer: (line: string) => Promise<AfterLine>;
  /** Every way this process can stop, so the terminal is given back in all of them. */
  readonly leaving: Leaving;
}

/** A console that is open. */
export interface OpenConsole {
  /** Land one already-rendered line in what the session has said. */
  readonly land: (line: string) => void;
  /** Resolves once the caller has left and the terminal is theirs again. */
  readonly closed: Promise<void>;
}

/**
 * Opens the console on `stdout` and reads keys from `stdin` until the caller leaves.
 *
 * Answers as soon as the page is up rather than when it comes down, because whoever
 * opens it has something to say before the first key is pressed: the session's opening
 * lines land through {@link OpenConsole.land} like every line after them, so there is
 * one path onto the page and not a special one for the first three rows.
 */
export function openConsole(request: ConsoleRequest): OpenConsole {
  const { stdin, stdout, prompt, tips, openingFor, complete, answer, leaving } = request;

  /**
   * How wide the page is, asked of the DEVICE — the one place anything does.
   *
   * Everything else that needs the width is HANDED it: the panel's arithmetic, the art of
   * the name, the layout that draws the frame corner to corner. This is the module that
   * owns the streams, so this is where the question is asked, and asking it in a second
   * place would be a second answer on the frame after a resize.
   */
  const howWide = (): number => stdout.columns ?? NO_WIDTH;

  /** The width the page on the screen was drawn for. What a resize is compared against. */
  let drawnAt = howWide();
  /** The box and the lines this page opened with, for {@link drawnAt}. */
  let opened: Opening = openingFor(drawnAt);
  /** Everything the session has said SINCE the page opened — the opening is not in it. */
  let said: readonly string[] = [];
  let past: readonly string[] = [...opened.lines];
  let page = 0;
  let editing: Editing = NOTHING_TYPED;
  let shown: Shown = showing();
  const watchers = new Set<() => void>();

  /** What the layout is looking at, as one value. Rebuilt whenever anything moved. */
  function showing(): Shown {
    return {
      past,
      page,
      panel: opened.panel,
      present: prompt + editing.typed,
      candidates: editing.candidates.join(BETWEEN_CANDIDATES),
      // In characters rather than in string offsets: the caret is a column on a screen,
      // and the offset the editor keeps is into a string that can hold more than one
      // code unit per character.
      column: [...prompt].length + [...editing.typed.slice(0, editing.at)].length,
    };
  }

  function moved(): void {
    shown = showing();
    for (const watcher of watchers) watcher();
  }

  function land(line: string): void {
    said = [...said, line];
    past = [...past, line];
    moved();
  }

  /**
   * How tall the page is, asked of the DEVICE each time rather than remembered.
   *
   * A terminal the caller resized is a different page, and the bytes that carry one into
   * the scrollback are a function of how tall it is. Asking again costs a property read
   * and is the only way the answer can be right after a resize.
   */
  const howTall = (): number => stdout.rows ?? 0;

  /**
   * THE PAGE, AGAIN: what was on it goes into the scrollback, and it is drawn from what
   * this console holds — the opening, then whatever the session has said that is still on
   * it.
   *
   * ONE FUNCTION AND THE ONLY PLACE A PAGE IS TURNED. Both callers below differ in exactly
   * one line of their own — one empties what was said, the other recomposes the opening —
   * and neither writes bytes, counts a page or touches the layout. That is deliberate: a
   * second place that carried the screen away and bumped the page would be a second idea
   * of what a page is, and the one thing every case of this surface pins is that a page
   * drawn again is the page that opened.
   *
   * The bytes go through the door the layout handed back rather than to the device, and
   * that is the difference between this and the same call at the top of this function:
   * with a frame on the screen, the library is counting rows it is about to redraw, and a
   * write it did not make leaves that count pointing at the wrong ones.
   *
   * Nothing is READ to do it, in either caller.
   */
  function thePageAgain(): void {
    carry(carriedIntoTheScrollback(howTall()));
    past = [...opened.lines, ...said];
    page += 1;
    moved();
  }

  /**
   * A clean page: the opening, and nothing the session has said.
   *
   * The opening is what this console was handed for the width it is drawn at, so a cleared
   * page is the opened page by construction rather than by a second composition that could
   * come to say something else.
   */
  function cleanPage(): void {
    said = [];
    thePageAgain();
  }

  /**
   * The page at the width the caller's terminal has NOW: the opening recomposed for it,
   * and every line the session already said landed under it.
   *
   * What is not here is as much of the decision as what is. Nothing is re-read — the
   * opening is recomposed out of lines that already exist, and the two things that depend
   * on the width are which drawing there is room for and how much of the name is drawn.
   * And nothing the caller has read is taken from them: the page they had goes UP, into
   * the scrollback, exactly as it does when they ask for a clean one.
   */
  function followTheTerminal(): void {
    const wide = howWide();
    // THE ONE GUARD, and it answers two questions with one comparison: a window made
    // taller or shorter moves no glyph of a drawing whose only measurement is columns, and
    // a drag that wandered away and came back is a caller whose page is already right.
    // Both are the same fact — the width the page on the screen was drawn for is the width
    // the terminal has — and asking it twice would be two ideas of when a page is stale.
    if (wide === drawnAt) return;
    drawnAt = wide;
    opened = openingFor(wide);
    thePageAgain();
  }

  /** The redraw that has been asked for and not yet drawn, if any. */
  let settling: ReturnType<typeof setTimeout> | undefined;

  /**
   * The terminal changed size — the page follows it, once the size has SETTLED.
   *
   * Nothing is decided here. Every change starts the wait over, and what happens at the
   * end of it is {@link followTheTerminal}'s to decide, which is why a drag of a corner
   * costs one page and a drag of the bottom edge costs none.
   */
  function resized(): void {
    if (settling !== undefined) clearTimeout(settling);
    settling = setTimeout(() => {
      settling = undefined;
      followTheTerminal();
    }, AFTER_THE_LAST_CHANGE);
    // A page waiting to be drawn is no reason for the process to stay up: if everything
    // else that holds it open has gone, the session is over and there is nothing to draw.
    settling.unref();
  }

  /** One submitted line at a time, in the order they were typed. */
  let turn: Promise<void> = Promise.resolve();
  let left = false;
  let restored = false;
  let finish: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });

  /** Everything this session took from the terminal, given back. Idempotent, and sync. */
  function restore(): void {
    if (restored) return;
    restored = true;
    // The watch on the device's size goes first, and a page that was about to be drawn is
    // dropped: a redraw landing after the frame came down would be this session writing on
    // a terminal that is somebody else's again.
    stdout.off('resize', resized);
    if (settling !== undefined) clearTimeout(settling);
    disarm();
    app.unmount();
  }

  /**
   * The caller is done: no more keys, the turn drains, the terminal goes back.
   *
   * The drain is what keeps the word that leaves, typed behind a slow read, from cutting its answer
   * off — the word ends the session, not the turn that is already running.
   */
  function leave(): void {
    if (left) return;
    left = true;
    void turn.then(() => {
      restore();
      finish();
    });
  }

  /** What arrived from the keyboard — one key, or a paste that stands for several. */
  function pressed(chunk: Keystroke): void {
    for (const stroke of keystrokesOf(chunk)) key(stroke);
  }

  /** A key, and everything one key can do. */
  function key(stroke: Keystroke): void {
    if (left) return;
    const what = typeKey(editing, stroke, complete);
    switch (what.does) {
      case 'edit':
        editing = what.editing;
        moved();
        return;
      case 'abandon': {
        const abandoned = what.line;
        editing = what.editing;
        moved();
        turn = turn.then(() => {
          if (!left) land(prompt + abandoned);
        });
        return;
      }
      case 'submit': {
        const line = what.line;
        editing = what.editing;
        moved();
        turn = turn.then(async () => {
          if (left) return;
          land(prompt + line);
          switch (await answer(line)) {
            case 'leave':
              leave();
              return;
            case 'clear':
              cleanPage();
              return;
            case 'go on':
              return;
          }
        });
        return;
      }
      case 'leave':
        // The end of the input is the end of the session, and the row it was typed on
        // still belongs on the page: a terminal shows what you sent, whatever it was.
        land(prompt + editing.typed);
        leave();
        return;
    }
  }

  /** The door the layout hands back once it is up. See {@link Watched.opened}. */
  let carry: (bytes: string) => void = () => undefined;

  const watched: Watched = {
    now: () => shown,
    watch: (changed) => {
      watchers.add(changed);
      return () => {
        watchers.delete(changed);
      };
    },
    pressed,
    opened: (write) => {
      carry = write;
    },
  };

  // THE PAGE OPENS CLEAN, and here it is written to the DEVICE: nothing is mounted yet,
  // so there is no frame for these bytes to be out of step with. The same bytes go
  // through the layout's door once there is one ({@link thePageAgain}).
  stdout.write(carriedIntoTheScrollback(howTall()));

  const app = render(createElement(Region, { watched, tips }), {
    stdin,
    stdout,
    // Ctrl-C is this session's, and it abandons the LINE. A library that exited the
    // process on it would make the console worse than the shell prompt it replaces:
    // you would lose the session for mistyping a word.
    exitOnCtrlC: false,
    // The global `console` is left alone. Every line this product prints goes through
    // its own port, so there is nothing to reroute — and patching a global of the
    // caller's process in order to draw a box is a larger thing to borrow than a layout.
    patchConsole: false,
    // WHETHER THERE IS A TERMINAL IS THIS PRODUCT'S ANSWER, not the library's. Left to
    // itself it decides by looking for the marks of a build server, and would draw
    // nothing but a last frame on a machine that has a real terminal and an environment
    // variable saying `CI`. The session refuses without a terminal at both ends before
    // it ever reaches here, so by this line the question has already been asked — and
    // asked of the device rather than of the environment.
    interactive: true,
  });

  // THE PAGE FOLLOWS THE TERMINAL, and the watch goes on AFTER the layout is up: the
  // library keeps its own on the same event and recalculates the frame it is redrawing, so
  // arming this one second is what puts the page in front of a library that has already
  // agreed about how wide the screen is.
  stdout.on('resize', resized);

  const disarm = armLeaving(leaving, restore);

  return { land, closed };
}
