/**
 * THE CONSOLE: the session's own SCREEN, taken from the caller's terminal and given back
 * when they leave.
 *
 * It is the piece that mounts the layout library, and the only one. `gate.ts` decides
 * what a typed line MEANS, `editing.ts` decides what a keystroke does to the row being
 * typed, `scrolling.ts` keeps what the session has said, `region.ts` decides where a line
 * lands — and this drives the four: three regions are drawn on every frame, the top one and
 * the bottom one never move, and the middle is a window onto the roll.
 *
 * ⚠️ THE SCROLLBACK USED TO BE THE FEATURE, and this file said so in those words: *what the
 * session answered stays on the caller's own page after they leave, exactly as it would have
 * if they had typed the verbs at a shell, because the only region redrawn is the input row and
 * everything else was written once and never taken back.* It was true, it was measured, and it
 * cost the caller the one thing they asked for: a header that stays. In that model the opening
 * is CONTENT — it is the first thing written into the region nobody redraws — so it rises off
 * the top of the screen as soon as enough is printed, and no arithmetic anywhere can hold it
 * down. Eight deliveries of this frontier were patches on that, each closing one symptom and
 * uncovering the next.
 *
 * SO THE CONSOLE TAKES THE SCREEN — the alternate screen buffer, which is what every
 * full-screen program takes and what the console this one is measured against takes. It is
 * asked for by the layout library's own option rather than written here: it is one flag on the
 * call that mounts (`alternateScreen`), and the library enters on mount and leaves on unmount.
 * Three things follow from taking it, and all three are decisions rather than consequences:
 *
 *   - THE FRAME IS EXACTLY AS TALL AS THE TERMINAL, every time. That is what makes the top and
 *     the bottom fixed, and it is also what keeps the library from starting the page over: a
 *     frame equal to the viewport is written in place, and only one TALLER than it makes the
 *     library erase and redraw.
 *   - THE ROLL IS OURS. The alternate screen has no scrollback — on purpose, that is what it is
 *     for — so what the session has said lives in this process and the scroll over it is this
 *     console's (`scrolling.ts`, {@link theWheel}).
 *   - THE TRANSCRIPT IS WRITTEN BACK. What the old model got for free is paid for deliberately
 *     on the way out ({@link theTranscriptBack}), because the caller's history ending with what
 *     the session said is the promise the refusal of the alternate screen was protecting.
 *
 * IT COMPOSES NOTHING A READER SEES EXCEPT THE ECHO. Every line that lands here arrives
 * already rendered, out of the same `presentation/` and the same renderer every other
 * invocation of this product uses. This file writes exactly ONE string of its own, and it
 * is INPUT rather than report: the ECHO of what the caller typed — the prompt and their
 * own words, the way a terminal shows what you sent. It is not a fact about the record and
 * it does not go through a renderer, for the same reason the prompt never did.
 *
 * IT USED TO WRITE A SECOND ONE, and that is what the palette took away: the row of words
 * a Tab could not choose between was joined here, out of the tokens and a separator this
 * file owned. It is a list of two columns now, composed and cut where every other line of
 * this product is (`palette.ts`), and all this file does is ask for it at the width and
 * the height of the moment. The TIPS and the BADGE were never composed here either: they
 * arrive as bytes a renderer already produced, exactly like a landed line.
 *
 * ONE LINE AT A TIME, and it is a chain rather than a flag. A caller who pastes three
 * lines has given the terminal all three before the first one has run, and three verbs
 * running at once over one record would answer interleaved. Each submitted line waits
 * for the one before it — and so does its ECHO, which is why the echo lands inside the
 * queued turn rather than when the key was pressed: a prompt printed above the answer to
 * the question before it would read as though the second had been asked first.
 *
 * AND WHAT SOMEBODY ELSE WROTE LANDS THROUGH THE SAME DOOR, on the same queue. This
 * console runs no verb that writes, so a record that moved was moved by another process,
 * and a caller watching one sees it happen. The occurrence is a line like any other: it
 * comes composed from `presentation/`, it goes through {@link OpenConsole.land}, and it goes
 * onto the roll where the session put it.
 *
 * ⚠️ AND WHAT IT MAY NOT BE USED TO BE *A REGION OF ITS OWN — a list that GROWS walks the
 * region into the height at which the library stops redrawing a PART of the screen*. That
 * sentence, and the whole family of arithmetic it belongs to, is gone with the model: no region
 * here grows with what a session has to say, because what a session says is not drawn at all —
 * a WINDOW onto it is, and a window is as tall as what the two fixed regions leave.
 *
 * ⛔ WHAT IT MAY STILL NOT BE is a rewrite of what is above: a fact about a line the caller has
 * already read lands UNDER it, because the one promise of this surface is that what has been
 * said is not unsaid.
 */

import { render } from 'ink';
import { createElement, type ReactElement } from 'react';
import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { areaFor } from './area.js';
import type { Completer } from './complete.js';
import { type Editing, type Keystroke, keystrokesOf, NOTHING_TYPED, typeKey } from './editing.js';
import { withoutTheHistoryErase } from './erasing.js';
import type { AfterLine } from './gate.js';
import { armLeaving, type Leaving } from './leaving.js';
import { offeredBy, paletteFor, paletteRowsFor } from './palette.js';
import type { Opening } from './panel.js';
import { fromTheMouse, THE_WHEEL_BACK, WATCHING_THE_WHEEL } from './pointing.js';
import { Region, type Shown, type Watched } from './region.js';
import {
  landedIn,
  NOTHING_SAID,
  type Scrolling,
  scrolledBy,
  theTranscript,
  theWindowOn,
  toTheTail,
  toTheTop,
} from './scrolling.js';

/**
 * How wide the terminal is taken to be when the device does not say.
 *
 * Zero, so the narrowest form of everything is drawn: a width nobody reported is not a
 * width to guess at, and the form that always fits is the name.
 */
const NO_WIDTH = 0;

/**
 * How tall the terminal is taken to be when the device does not say.
 *
 * Zero, for the reason the width uses: a height nobody reported is not a height to guess
 * at, and what a height chooses here is an arrangement whose shortest form always fits.
 */
const NO_HEIGHT = 0;

/**
 * How often the record is asked whether it moved, in milliseconds.
 *
 * A tenth of a second, which is the threshold below which a person reads a response as
 * immediate — so a caller watching a record another process is writing sees it happen rather
 * than notices it later. What it costs is the cheap half of the question: one `readdir` per
 * tail and one `stat`, measured at 26 µs, so ten a second is 0.026% of a core and an hour of
 * an idle session is 36 000 of them (`following.ts`).
 *
 * ⚠️ IT USED TO BE TWO READERS AND THE SECOND ONE IS GONE. This same number was how long the
 * terminal's size had to stop changing before the page was drawn again: a drag of a window
 * edge delivers a size every two or three milliseconds, and each of them turned a PAGE — a
 * screen of the caller's carried into their scrollback and the opening rewritten over it — so
 * thirty of them inside one drag was the defect the wait existed to prevent. Nothing is turned
 * now and nothing is carried anywhere: a resize is a frame drawn at the new size, which is what
 * every frame is. So the damper is off the geometry entirely, and what it damped is a cost that
 * no longer exists ({@link resized}).
 */
const HOW_OFTEN_THE_RECORD_IS_ASKED = 100;

/**
 * HOW MANY LINES A NOTCH OF THE WHEEL IS WORTH.
 *
 * Three, which is what a terminal's own wheel does and therefore what a hand already expects:
 * one line reads as a wheel that is broken, and a page reads as PgUp on a mouse.
 */
const A_NOTCH = 3;

/**
 * A LINE THAT IS ALREADY BYTES, and how many columns it takes on a screen.
 *
 * The two travel together because the area needs both and only one of them can be worked
 * out here: a rendered line carries escapes a terminal does not print, so counting its
 * bytes would make a hint that fits look too wide the moment colour is switched on. How
 * wide a line is is `presentation/`'s question (`plain.ts`, `widthOf`), asked where the
 * line was composed, and carried here as a number.
 */
export interface Drawn {
  /** The bytes a renderer produced. Empty when there is nothing to draw. */
  readonly text: string;
  /** How many columns it takes on a screen. Zero when there is nothing to draw. */
  readonly width: number;
}

/** Everything opening a console needs. */
export interface ConsoleRequest {
  /** Where the keystrokes come from. */
  readonly stdin: NodeJS.ReadStream;
  /** The screen the console takes, and the stream the transcript goes back on. */
  readonly stdout: NodeJS.WriteStream;
  /** What the caller types in front of. Not a report, and so not rendered. */
  readonly prompt: string;
  /**
   * How a line becomes bytes, resolved once for the whole session.
   *
   * IT IS HERE FOR ONE THING AND THE REASON IS THE KEYSTROKE. Everything else this file
   * receives arrives already rendered, because it is composed once and never changes; the
   * PALETTE cannot be, because which words it shows depends on what has been typed and
   * how wide each row may be depends on the window. So it is composed on the frame that
   * needs it (`palette.ts`) and turned into bytes with this — which is the same thing the
   * opening does one layer up, and is not this file composing anything.
   */
  readonly render: Render;
  /**
   * What the caller can do, already rendered, for the region at the foot.
   *
   * It stays under the row being typed instead of going onto the roll, which is the
   * difference between a tip and a line: one that has scrolled off the screen is not
   * a tip any more. Empty means the console offers none and draws no row for it — and so
   * does a window too narrow for it to be one row, which is the area's call rather than
   * this file's.
   */
  readonly tips: Drawn;
  /**
   * WHICH KEYS MOVE THE LIST OF WORDS, as a line — drawn under the list, and only on the frames
   * there is one.
   *
   * A LINE AND NOT BYTES, unlike the row above, and the difference is which of the two the
   * palette owns: this is one of the palette's ROWS (`palette.ts`), measured and refused by the
   * same rule that measures and refuses a row of the table, so it goes through the palette's own
   * renderer rather than arriving already rendered. It says nothing about the record and nothing
   * about the terminal, so it is composed once when the session opens (`session.ts`,
   * `pickingTips`).
   */
  readonly picking: Line;
  /**
   * WHAT THE RECORD PROVED, as one row for the corner above the input — already rendered,
   * and empty when there is no record to name a level of.
   *
   * A VALUE AND NOT A FUNCTION, unlike the opening beside it, and the difference is what
   * each one depends on: the opening is recomposed for a SIZE, and this says the same
   * words at every size there is. It was paid for with the one read this surface declares
   * (`session.ts`) and it is held here for the length of the session, so the row redrawn
   * on every keystroke costs a string and nothing else.
   *
   * ⛔ IT MAY NOT BE RE-READ EITHER, and for a sharper reason than the panel's: this row is
   * on the screen for the whole session, so a level that changed under the caller halfway
   * through would be the corner of the console disagreeing with the panel at the top of it.
   * Counted with the rest (`tests/the-name-and-the-hints.test.ts`).
   */
  readonly badge: Drawn;
  /**
   * WHAT THE PAGE OPENS WITH, on a terminal of a given SIZE — the arrangement and the lines
   * that go with it, already composed and already measured.
   *
   * A FUNCTION AND NOT A VALUE, and the size is the whole reason: which drawing there is room
   * for and how much of the name is drawn are both answers to the size, and the size changes
   * under a session. Everything else it returns is closed over, composed once, and never asked
   * for again.
   *
   * ⛔ IT MAY NOT READ THE RECORD, and that is the caller's promise rather than a
   * signature this file can enforce. What the panel says about the record was paid for
   * with the one read this surface declares (`session.ts`), and a redraw that asked again
   * could say something different halfway through a session — measured by counting the
   * reads three width changes cause, which is none (`tests/the-name-and-the-hints.test.ts`).
   *
   * ⚠️ IT WAS ASKED ONCE PER SETTLED RESIZE AND IT IS ASKED ON EVERY FRAME, which is the
   * correction the geometry needed and not a change to what it means. A number that says where
   * to draw may not come from a value that has settled: the size a frame is laid out at has to
   * be the size the device has AT THE MOMENT OF THE DRAWING, or a frame composed for the old
   * width is written onto the new screen — which is what made the panel flicker two rows wide
   * of the window while a drag settled. What is damped instead is the WORK: the answer is kept
   * for the size it was asked at, so a keystroke costs a comparison and a resize costs one
   * composition ({@link theOpening}).
   */
  readonly openingFor: (columns: number, rows: number) => Opening;
  /**
   * WHAT A LANDED LINE IS REMEMBERED BY — the records it names, so a Tab can finish one
   * of them (`seen.ts`).
   *
   * It is handed one line at a time rather than reading what this file keeps, because
   * this is the ONE door onto the page: everything a reader ever sees in the middle region
   * comes through {@link land}, including the echo of what they typed. A second place
   * that noticed an id would be a second idea of what the session has shown.
   *
   * ⛔ IT MAY NOT READ THE RECORD, and here that is not a promise but an absence of one:
   * what it is given is bytes that were already on their way to the screen, and there is
   * nothing to read them FROM. Counted with the rest
   * (`tests/the-name-and-the-hints.test.ts`).
   */
  readonly saw: (line: string) => void;
  /**
   * WHAT HAS HAPPENED TO THE RECORD since this was last asked, already rendered — the
   * lines of every append somebody else made while the caller was watching.
   *
   * ASKED ON A CLOCK AND ANSWERED FOR NOTHING, which is what makes it affordable to ask
   * ten times a second: the question is whether anything MOVED, and a record that did not
   * move costs a `readdir` per tail and a `stat` (`following.ts`). Empty is the ordinary
   * answer, and an empty answer lands nothing.
   *
   * ⛔ IT MAY NOT READ THE RECORD TO ANSWER "no", and that is the caller's promise rather
   * than a signature this file can enforce. The counter that holds the other reads of this
   * surface holds this one too — a session that watches for a second and a half asks the
   * question fifteen times and opens nothing (`tests/the-name-and-the-hints.test.ts`).
   */
  readonly happened: () => readonly string[];
  /**
   * WHAT CAN BE TYPED WHERE THE CARET IS, over the command tree the session was built from
   * — the verbs this session runs, the words it answers to itself, and the records it has
   * already named.
   *
   * ⚠️ IT WAS *WHAT TAB OFFERS*, AND THERE WAS A SECOND LIST BESIDE IT: the session's own
   * vocabulary, handed over so that a slash could be answered from it. Two lists is two
   * menus — the slash listed three words and a Tab listed fourteen — so the vocabulary is
   * gone from here and this is what both keys ask (`palette.ts`, `offeredBy`).
   */
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
  const { stdin, stdout, prompt, render: renderLine, tips, badge, picking } = request;
  const { openingFor, saw, happened, complete, answer, leaving } = request;

  /**
   * How wide the page is, asked of the DEVICE — the one place anything on the FRAME does.
   *
   * Everything the layout draws is HANDED it: the panel's arithmetic, the art of the name, the
   * rules the input area sits between. This is the module that owns the streams, so this is
   * where the question is asked, and a second reading feeding any of those would be a
   * second answer on the frame after a resize.
   *
   * ⚠️ IT SAID *THE ONE PLACE ANYTHING DOES*, and the entry falsified it: `cli.ts` reads
   * the width beside the `isTTY` it already read, because whether a line folds is part of
   * the capability every verb is handed and that is resolved once, where the process is
   * (`wiring/color.ts`). Nothing here comes from that reading and nothing there comes from
   * this one, which is why it is two answers to two questions rather than the defect the
   * sentence was written against — and a THIRD is still refused
   * (`tests/the-screen-is-ours.test.ts`).
   */
  const howWide = (): number => stdout.columns ?? NO_WIDTH;

  /**
   * How tall the page is, asked of the DEVICE each time rather than remembered.
   *
   * ⛔ AND IT IS READ AT THE MOMENT OF THE DRAWING, which is the rule the whole geometry of
   * this file now rests on and the one the model before it broke. A frame is laid out against
   * a height, and a height that was true when a resize SETTLED is not the height the frame is
   * about to be written onto — so a size event is a reason to draw again rather than a source
   * of truth to be stored. It is the pattern the field converged on and it is what makes a
   * coalesced or a dropped resize harmless: whatever the events did, the number used is the one
   * the device answers with on the frame that is being built.
   */
  const howTall = (): number => stdout.rows ?? NO_HEIGHT;

  /**
   * ⛔ BOTH MEASUREMENTS OF THE DEVICE, IN ONE READING — how wide and how tall, asked once.
   *
   * ⚠️ THEY WERE TWO QUESTIONS AND A CALLER CAN RESIZE BETWEEN THEM. The two above are separate
   * getters and each of them asks the operating system: a size that changes between the first and
   * the second gives a frame half one terminal and half another. This file's own doc has warned
   * about exactly that shape — *two readings of a device that a caller can resize between them is
   * a frame built out of two different terminals* — and then read the device twice. Measured on a
   * loaded machine, three sizes set back to back: a frame came out **24 rows by 120 columns**,
   * which is the height of the first size and the width of the second, and no terminal was ever
   * that shape. What it costs on a screen is a row too wide, which the terminal folds — and a
   * folded frame is a frame taller than the screen it is on.
   *
   * SO THE DEVICE IS ASKED ONCE, by the one call that answers both. A stream that cannot be asked
   * that way is answered by the two getters, which is what a pair of streams standing in for a
   * terminal is: it has no size to change under the reading (`tests/support/console.ts`).
   */
  const theSize = (): readonly [number, number] => {
    const asked = stdout.getWindowSize?.();
    if (asked === undefined) return [howWide(), howTall()];
    return [asked[0] ?? NO_WIDTH, asked[1] ?? NO_HEIGHT];
  };

  /**
   * ⛔ EVERY BYTE THIS SESSION WRITES, AND THE ONE PLACE THE ERASE IS ANSWERED — the caller's own
   * device, with one door in front of the only method that puts anything on it.
   *
   * IT IS THE LAST POINT IN THE PROCESS, and that is the whole of why it is here rather than in a
   * frame. The library decides to start the page over by comparing the frame it LAST drew against
   * the viewport of the moment, so the decision is taken before anything of this file runs at the
   * new size and no frame this file composes can change it. What IS still ours is the pipe: the
   * bytes it decided on have to leave through a stream, and this file is the one that owns the
   * streams. So the erase of the caller's own history is taken out on the way out
   * (`erasing.ts`, {@link withoutTheHistoryErase}) — in the alternate screen exactly as in the
   * normal one, because that sequence reaches past whichever screen is showing and empties the
   * caller's.
   *
   * ONE DOOR AND TWO WRITERS, which is what makes it a pipe rather than a patch: the layout is
   * handed this instead of the device, and the strings this file writes itself — the modes that
   * turn the wheel on and off, and the transcript on the way out — go through it too. A second
   * writer on the raw stream would be a second mouth with no door on it, which is asserted over
   * this file's own source (`tests/the-screen-is-ours.test.ts`).
   *
   * EVERYTHING BUT THE WRITE IS THE DEVICE'S OWN, and it is delegated rather than listed on
   * purpose. What a layout library asks a terminal is its business and changes with its version —
   * how wide, how tall, whether it is a terminal, whether it is still writable, and the watch on
   * the size — so a stand-in built out of the members one version happens to ask for is a stand-in
   * that breaks on the next. This forwards every question to the real device and answers exactly
   * one of them differently.
   */
  const theWayOut: NodeJS.WriteStream = new Proxy(stdout, {
    get: (device, named) => {
      if (named === 'write') return throughTheDoor;
      const found: unknown = Reflect.get(device, named);
      // BOUND TO THE DEVICE, so that a method the library calls runs on the terminal and not on
      // this. The watch on the size is the one that matters: a listener registered against a
      // stand-in is a listener the device never tells.
      return typeof found === 'function' ? found.bind(device) : found;
    },
  });

  /**
   * ONE WRITE, ANSWERED — the bytes with the erase of the caller's history taken out, handed to
   * the real device.
   *
   * A chunk that is not TEXT goes out exactly as it arrived, and that is a refusal rather than a
   * gap: bytes are where a character can be cut in half, so a door that decoded them in order to
   * search them would be the defect this bench has already paid for once (`support/screen.ts`).
   * Nothing writes one here — the library assembles a frame into a string, and this file writes
   * what one function returned.
   */
  function throughTheDoor(chunk: unknown): boolean {
    // ONE STATEMENT, AND IT IS THE ONLY PLACE IN THIS SURFACE THAT PUTS A BYTE ON THE CALLER'S
    // DEVICE — asserted over this file's own source, so a second one is an accusation rather
    // than a hole (`tests/the-screen-is-ours.test.ts`).
    return stdout.write(
      typeof chunk === 'string' ? withoutTheHistoryErase(chunk) : (chunk as Uint8Array),
    );
  }

  /** The size the opening on the screen was composed for, and the opening itself. */
  let drawnAt = { columns: theSize()[0], rows: theSize()[1] };
  /** How many rows the middle region had on the frame that is on the screen. */
  let theRoom = 0;
  /** The layout, once it is up. See the assignment at the foot of this function. */
  let mounted: ReturnType<typeof render> | undefined;
  let opened: Opening = openingFor(drawnAt.columns, drawnAt.rows);

  /**
   * THE OPENING FOR THE SIZE THE DEVICE HAS RIGHT NOW — composed again only when the size is
   * not the one it was last composed for.
   *
   * IT IS A CACHE AND NOT A DAMPER, and the difference is the whole of what the resize storm
   * taught. A damper delays the ANSWER: the geometry a frame is drawn with lags the window by
   * however long the wait is, so a drag paints the old arrangement onto the new screen. This
   * delays nothing — the size is read at the moment of the drawing and the answer is always for
   * that size — and what it saves is the WORK, which is the part that is actually expensive:
   * composing the drawing of the name and choosing an arrangement for it, on every keystroke,
   * for a size that has not moved.
   *
   * ONE ENTRY, because there is one terminal: a session is drawn at one size at a time, and a
   * caller who drags back and forth pays one composition per size they stop at.
   */
  function theOpening(columns: number, rows: number): Opening {
    if (columns === drawnAt.columns && rows === drawnAt.rows) return opened;
    drawnAt = { columns, rows };
    opened = openingFor(columns, rows);
    return opened;
  }

  /**
   * A ROLL WITH THE OPENING ON IT AND NOTHING ELSE — where a session starts, and what the word
   * that clears gives back.
   *
   * ONE FUNCTION AND TWO CALLERS, which is what makes a cleared page the page that opened rather
   * than a second composition that could come to say something else. Nothing is READ to do it:
   * the lines already exist, composed once when the session opened (`session.ts`).
   */
  function theOpeningOnTheRoll(): Scrolling {
    return opened.lines.reduce(landedIn, NOTHING_SAID);
  }

  /**
   * EVERYTHING THE SESSION HAS SAID, and how far back the reader has walked — beginning with
   * the lines the opening lands.
   *
   * ⛔ THE OPENING'S LINES ARE ON THE ROLL AND NOT IN THE FIXED REGION, which is the boundary
   * `panel.ts` draws between the two halves of an opening: the ARRANGEMENT is chrome and stays
   * at the top, and what the session SAYS goes where everything it says goes. On a terminal too
   * narrow for an arrangement there is nothing in the top region at all, and the whole opening
   * is here — which is what the `bare` form has always claimed to be, and what stops a drawing
   * that does not fit from being CLIPPED down to the rows that matter least.
   */
  let scrolling: Scrolling = theOpeningOnTheRoll();
  let editing: Editing = NOTHING_TYPED;
  let shown: Shown = showing();
  const watchers = new Set<() => void>();

  /**
   * What the layout is looking at, as one value. Rebuilt whenever anything moved.
   *
   * THE THREE REGIONS ARE ONE SUBTRACTION, and it is the whole geometry of this surface: the
   * opening takes what it takes, the input area takes what it takes, and the middle is the
   * rest. Nothing is placed, nothing is anchored, and nothing is remembered from the frame
   * before — which is what a screen this session owns buys, and what nine of the numbers this
   * file used to hold were for.
   */
  function showing(): Shown {
    // THE SIZE IS READ ONCE FOR THE WHOLE FRAME, and in ONE question: a frame built out of two
    // readings of a device the caller can resize between them is a frame built out of two
    // different terminals ({@link theSize}).
    const [columns, rows] = theSize();
    const opening = theOpening(columns, rows);
    // WHAT THE PALETTE WOULD SHOW, before anything says how much of it there is room for.
    // A pure function over the row being typed and what a Tab last offered (`palette.ts`),
    // so nothing is held between frames and nothing goes stale. What a SLASH opens is asked
    // of the completer rather than of a second list kept here, which is what makes the two
    // keys answer with one menu.
    const offers = offeredBy(editing.typed, editing.offered, complete);
    // WHICH ARRANGEMENT THE INPUT AREA IS IN, asked again on every frame rather than
    // held. It is a function of the terminal's SIZE, of how many words the palette has to
    // show, and of how many rows the region above it takes — all three change under a
    // session, so a value kept beside the frame would be right until the first Tab. It reads
    // six numbers and composes nothing (`area.ts`).
    const area = areaFor({
      rows,
      columns,
      badge: badge.width,
      hint: tips.width,
      // HOW MANY ROWS THE LIST WANTS, asked of the module that draws them rather than counted
      // here: it is one per offer AND one for the row that says which keys move it, and a
      // count that left the second out would budget a region one row shorter than the one
      // drawn (`palette.ts`, `paletteRowsFor`).
      palette: paletteRowsFor(offers),
      // AND WHAT THE REGION ABOVE TAKES, which is what the list is cut against: the three
      // regions together are the screen, so a list may grow into the middle and never past it.
      // It is the ARRANGEMENT's rows and not the whole opening's, because the lines an opening
      // lands are on the roll and therefore inside the middle (`panel.ts`, `Opening.above`).
      header: opening.above,
    });
    const under = Math.max(0, rows - area.height);
    // WHETHER THERE IS ROOM FOR THE ARRANGEMENT AT ALL, and the answer is all of it or none of
    // it. Half a drawing is a page saying something about the product that is not true of it; an
    // absence is an absence, and the lines are on the roll either way. It cannot happen on a
    // terminal anybody opens — the drawing is chosen so the whole page fits (`session.ts`).
    const drawn = opening.panel !== undefined && opening.above <= under;
    // HOW MANY ROWS THE MIDDLE REGION HAS, and this one number is an ESTIMATE where every other
    // number on this frame is exact. What the middle really gets is what the other two leave,
    // which the layout works out (`region.ts`); this is the same subtraction done in advance,
    // and the only thing it decides is how many lines of the roll are worth handing over. Being
    // a row out costs a row of nothing at the foot of the window or a row of the window clipped,
    // and never a frame that is not the screen — because the frame's height is declared rather
    // than added up.
    const room = under - (drawn ? opening.above : 0);
    // HOW MANY ROWS THE MIDDLE HAS, kept for the one reader that is not this frame: a page of
    // scrolling is a page of THE MIDDLE, and the key that asks for one is answered after the
    // frame has been built ({@link aPage}). It is the same number the window was cut to, read
    // rather than worked out a second time.
    theRoom = room;
    // WHAT A READER CAN SEE OF THE ROLL, cut to the rows the middle region has and to the width
    // it has them at — one answer, from the module that keeps the roll (`scrolling.ts`).
    const window = theWindowOn(scrolling, room, columns);
    return {
      panel: drawn ? opening.panel : undefined,
      window,
      // BOTH MEASUREMENTS OF THE SCREEN, out of the one reading taken at the top of this frame.
      // The width is here for the same reason the height is: the frame IS the screen, and a
      // frame that declared one of the two left the other to the library's own reading, taken at
      // another instant (`region.ts`, {@link Shown.columns}).
      columns,
      rows,
      present: prompt + editing.typed,
      // COMPOSED WITH THE ROOM THE AREA GAVE IT, and cut to it — by the module that puts
      // the rows together, which is the only place a cut may happen. What it could not fit
      // it says (`palette.ts`).
      //
      // WHAT THE CALLER PICKED TRAVELS WITH THE ROW BEING TYPED, because that is what it is
      // part of: the arrows move it, so it changes on a keystroke exactly as the row does
      // (`editing.ts`). Nothing about it is decided here — this hands over the word and the
      // palette decides whether it is still one of the offers.
      palette: paletteFor({
        offers,
        room: area.palette,
        columns,
        render: renderLine,
        picked: editing.picked,
        picking,
      }),
      // In characters rather than in string offsets: the caret is a column on a screen,
      // and the offset the editor keeps is into a string that can hold more than one
      // code unit per character.
      column: [...prompt].length + [...editing.typed.slice(0, editing.at)].length,
      area,
    };
  }

  /** ANYTHING MOVED: the value the layout reads is built again, and everyone watching is told. */
  function moved(): void {
    shown = showing();
    for (const watcher of watchers) watcher();
  }

  function land(line: string): void {
    // WHAT THE PAGE SAID, NOTICED WHERE IT IS SAID. A record named on this row can be
    // named back by the caller from here on, and this is the row's one door — so a line
    // that reached the screen without passing here would be a record the session showed
    // and cannot complete. Asked BEFORE the frame is rebuilt, so a Tab on the same
    // keystroke sees it.
    saw(line);
    // AND IT GOES ON THE ROLL. Whether a reader SEES it is the roll's own answer: at the tail
    // they do, and part-way up they are left exactly where they were reading (`scrolling.ts`).
    scrolling = landedIn(scrolling, line);
    moved();
  }

  /**
   * THE SCROLL, wherever it came from — a key, or a notch of the wheel.
   *
   * ONE FUNCTION AND FOUR CALLERS, because how far each of them moves is the only thing that
   * differs. A PAGE is the height of the middle region, which is the one number here that has
   * to be read off the frame rather than chosen: a page that scrolled a fixed number of lines
   * would overshoot on a short window and undershoot on a tall one.
   */
  function scrolled(by: number): void {
    scrolling = scrolledBy(scrolling, by);
    moved();
  }

  /**
   * How many lines a page of the middle region is worth, on the frame that is on the screen.
   *
   * ⚠️ IT WAS HOW MANY LINES THE WINDOW WAS SHOWING, and that is not symmetric: the lines above
   * the ones a reader is looking at fold differently, so a window of four lines walked back four
   * and a window of three walked forward three, and PgDn did not come back to where PgUp left.
   * Measured — the case that walks back and forward went red on one line of drift. It is the
   * ROOM in rows instead, which is the same number the frame was laid out by ({@link showing})
   * and therefore the same in both directions, whatever the lines at either end do.
   */
  function aPage(): number {
    return Math.max(1, theRoom);
  }

  /**
   * A NOTCH OF THE WHEEL, or a click this page has no use for.
   *
   * IT IS SWALLOWED EITHER WAY, and that is the half that is easy to miss: turning mouse
   * reporting on means every click arrives as a well-formed control sequence the keyboard
   * library cannot name, which it hands over as ORDINARY TEXT with its escape stripped. A
   * console that did not recognise it would type `[<0;12;7M` onto the row a caller was in the
   * middle of writing (`pointing.ts`).
   */
  function theWheel(which: 'up' | 'down' | 'nothing'): void {
    if (which === 'nothing') return;
    scrolled(which === 'up' ? A_NOTCH : -A_NOTCH);
  }

  /** One submitted line at a time, in the order they were typed. */
  let turn: Promise<void> = Promise.resolve();
  let left = false;
  let restored = false;
  let finish: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });

  /**
   * WHAT SOMEBODY ELSE WROTE, landed — every occurrence since the last time the record was
   * asked, in the order it was appended.
   *
   * NOTHING IS DECIDED HERE AND NOTHING IS COMPOSED: what happened is the session's
   * question to answer (`following.ts`), the lines arrive rendered, and this puts them
   * where every line goes. A record that did not move answers with nothing, which is the
   * ordinary case and the whole reason this can be asked ten times a second.
   *
   * IT GOES ON THE QUEUE, for the reason the echo does. A verb answering at the prompt
   * writes its lines over several ticks, and an occurrence landing between two of them
   * would read as part of the answer to a question nobody asked. So it waits for the turn
   * to drain, exactly as a submitted line waits for the one before it — and a session on
   * its way out lands nothing, because the screen is about to stop being this one's.
   */
  function landWhatHappened(): void {
    const occurrences = happened();
    if (occurrences.length === 0) return;
    turn = turn.then(() => {
      if (left) return;
      for (const line of occurrences) land(line);
    });
  }

  /**
   * ⛔ EVERYTHING THE SESSION SAID, ON THE CALLER'S OWN BUFFER — written after the screen has
   * been given back, and the whole reason taking the screen is not a loss.
   *
   * WHERE IT IS WRITTEN IS THE MECHANISM AND IT IS NOT THE OBVIOUS ONE. The layout library
   * treats everything written while it is tearing down as DISPOSABLE and says so in its own
   * documentation: it does not preserve or replay a teardown-time frame, a hook's write or a
   * `console.*` call once it has restored the primary screen. So the transcript may not be a
   * last frame and may not be a print inside a teardown — it has to be a write of OUR OWN, on
   * the stream, AFTER the library has left the alternate screen. That happens inside
   * `unmount()`, which does the whole of its teardown synchronously and writes the sequence
   * that leaves the alternate screen before it returns — so the line under it is already on the
   * caller's own buffer. Asserted by position rather than by presence: the transcript has to
   * come after those bytes in the stream, or it is on a screen that is about to be thrown away
   * (`tests/the-screen-is-ours.test.ts`).
   *
   * SYNCHRONOUS BECAUSE THE SIGNAL PATH IS, and that is not a convenience either. Restoring
   * runs from an `exit` listener and from four signal handlers, and a promise scheduled there
   * is a promise nobody will await (`leaving.ts`) — so awaiting the library's own exit promise
   * before writing would drop the transcript on every death that is not the polite one.
   *
   * ⛔ WHAT IS NOT COVERED, said out loud so a pass is not read as covering it: `SIGKILL` and
   * an `abort()` end the process without running anything of ours, and the session's text is
   * lost with the alternate screen. THE RECORD IS NOT: it is in `.mnema/`, signed, and every
   * line above can be read back out of it by the verb that produced it.
   */
  function theTranscriptBack(): void {
    const said = theTranscript(scrolling);
    if (said.length === 0) return;
    theWayOut.write(said.join('\n'));
    theWayOut.write('\n');
  }

  /** Everything this session took from the terminal, given back. Idempotent, and sync. */
  function restore(): void {
    if (restored) return;
    restored = true;
    // The watch on the device's size goes first: a redraw landing after the frame came down
    // would be this session writing on a terminal that is somebody else's again.
    stdout.off('resize', resized);
    // And the watch on the RECORD goes with it, for the same reason: an occurrence landing
    // after the frame came down would be a line written onto somebody else's terminal.
    clearInterval(watching);
    disarm();
    // THE WHEEL IS GIVEN BACK BEFORE THE SCREEN IS, and it belongs to the same set as raw mode
    // and the hidden caret: a terminal left reporting the mouse fills the caller's next shell
    // with escapes every time they move the pointer (`pointing.ts`).
    theWayOut.write(THE_WHEEL_BACK);
    app.unmount();
    theTranscriptBack();
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

  /**
   * What arrived from the keyboard — one key, a paste that stands for several, or the mouse.
   *
   * THE MOUSE IS ASKED FIRST AND IT IS ASKED OF THE WHOLE CHUNK, which is where it has to be:
   * a report is one control sequence, the keyboard library hands it over whole, and what is
   * downstream of here tokenizes a chunk into the keys it stands for — so a report that reached
   * that tokenizer would be typed onto the row a character at a time (`pointing.ts`).
   */
  function pressed(chunk: Keystroke): void {
    const mouse = fromTheMouse(chunk.input);
    if (mouse !== undefined) {
      theWheel(mouse);
      return;
    }
    for (const stroke of keystrokesOf(chunk)) key(stroke);
  }

  /** A key, and everything one key can do. */
  function key(stroke: Keystroke): void {
    if (left) return;
    // THE KEYS THAT MOVE THE WINDOW ARE ANSWERED BEFORE THE ROW IS, because they say nothing
    // about the row: what they move is which part of the roll a reader is looking at, and the
    // line being typed is untouched by all four (`scrolling.ts`).
    if (stroke.pageUp) {
      scrolled(aPage());
      return;
    }
    if (stroke.pageDown) {
      scrolled(-aPage());
      return;
    }
    if (stroke.home) {
      scrolling = toTheTop(scrolling);
      moved();
      return;
    }
    if (stroke.end) {
      scrolling = toTheTail(scrolling);
      moved();
      return;
    }
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
              cleared();
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

  /**
   * A clean page: the roll emptied, and the reader back at a tail with nothing before it.
   *
   * ⚠️ IT USED TO BE A PAGE TURNED — a screen of the caller's carried into their scrollback,
   * the opening landed a second time on a new identity, and the layout told to forget what it
   * had written. All of that was machinery for emptying a region the library keeps and never
   * redraws. There is no such region: the middle is a window, and emptying what it looks at is
   * the whole of what a clean page is.
   */
  function cleared(): void {
    scrolling = theOpeningOnTheRoll();
    moved();
  }

  /**
   * The terminal changed size — the frame is drawn again, at whatever size it now is.
   *
   * NOTHING IS DECIDED HERE AND NOTHING IS REMEMBERED. Every number the next frame needs is
   * read off the device while that frame is being built ({@link howTall}), so a resize is a
   * signal to draw again and never a source of truth to store — which is what makes a
   * coalesced event, a dropped one and one that arrived early all the same event.
   *
   * ⚠️ AND IT USED TO WAIT. A drag delivers a size every two or three milliseconds and each of
   * them cost a PAGE — a screen of the caller's carried away and the opening rewritten over it
   * — so the page followed the size the caller stopped at, a tenth of a second later. What that
   * bought was measured and so was what it cost: the frame between the event and the settling
   * was drawn with the OLD width, so the panel came out two rows of a hundred and two columns
   * on a screen of a hundred, which the terminal folded. Nothing is carried anywhere now, so
   * there is nothing for a wait to coalesce, and the flicker it caused is gone with it.
   */
  function resized(): void {
    moved();
    // ⛔ AND THE TREE IS RE-RENDERED HERE, SYNCHRONOUSLY, WHICH IS THE HALF THAT CANNOT BE LEFT
    // TO A SCHEDULER. Telling the watchers is what React answers with an update, and React
    // decides WHEN — at the end of the task, after every listener on this event has run. The
    // library's own listener is one of those, and it is synchronous: it lays the tree out again
    // and writes it, without React having re-rendered anything. So a value rebuilt above and a
    // frame written from the tree below can be two different sizes, and on a frame that declares
    // its own height the difference is a frame TALLER than the screen it is written onto.
    //
    // MEASURED, shrinking 120×40 to 80×24: the resize wrote **40 rows onto a 24-row screen**
    // first — sixteen rows of overflow, which scrolls the page and carries the top region off it
    // — and the correct 24-row frame second. Arming this watch before the library's was not
    // enough on its own, and that is the whole reason this line exists rather than an ordering
    // comment: the ordering decides who runs first, and this decides what the tree HOLDS when
    // they do. Re-rendering is synchronous by the library's own contract in this mode
    // (`updateContainerSync` and a flush), so the frame the library then writes is the frame for
    // the screen that exists.
    mounted?.rerender(theFrame());
  }

  const watched: Watched = {
    now: () => shown,
    watch: (changed) => {
      watchers.add(changed);
      return () => {
        watchers.delete(changed);
      };
    },
    pressed,
  };

  // ⛔ THE FRAME FOLLOWS THE TERMINAL, AND THIS WATCH GOES ON BEFORE THE LAYOUT IS MOUNTED — the
  // order is the whole of it, and it is measured rather than tidy.
  //
  // ⚠️ IT WAS ARMED SECOND, with the reason written out: *the library keeps its own watch on the
  // same event and recalculates the frame it is redrawing, so arming this one second is what puts
  // this frame in front of a library that has already agreed about how wide the screen is.* That
  // was true of a console whose frame was a few rows at the foot of the caller's page. It is
  // FALSE of a frame that declares its own height: the library's watch is SYNCHRONOUS — it lays
  // the tree out again and writes it, without React having re-rendered anything — so a listener
  // armed after it lets the library write the OLD height onto the NEW screen. Measured, shrinking
  // 120×40 to 80×24: the first frame of the resize was **40 rows written onto a 24-row screen**,
  // which overflows by sixteen and scrolls the page; the correct 24-row frame came after it, so
  // the settled page was right and the transient one had carried the top region off the screen.
  // On a quiet machine the second frame lands inside the instrument's own settling window and
  // nothing is seen; under load it is what a reader sees, and what a case reads.
  //
  // Armed first, the value the layout reads is rebuilt before the library asks the tree for a
  // frame, so the frame the library writes is the one for the screen that exists
  // (`tests/the-screen-is-ours.test.ts`, *writes no frame taller than the screen it is on*).
  stdout.on('resize', resized);

  // ⛔ THE WHEEL IS ASKED FOR BEFORE THE LAYOUT IS MOUNTED, and the order is forced rather than
  // tidy. A mode is the TERMINAL's and not a buffer's, so it makes no difference to the device
  // which side of the buffer swap it is asked on; it makes every difference to whoever is reading
  // the stream. The library ends a frame with the sequence that closes its synchronized update,
  // and an instrument waits for that to be the LAST thing that arrived — so two mode switches
  // written after the opening frame leave a session that has drawn its page looking like a session
  // that has not. Measured: the first step of every case in a pseudo-terminal waited out the
  // driver's whole budget (`tests/support/pty.ts`, `aFrameAfter`).
  //
  // It goes through the same door every other byte does, which costs nothing here and is what
  // makes the pipe one pipe: these bytes hold no erase to take out, and a second writer on the raw
  // device would be the hole the door exists to close.
  theWayOut.write(WATCHING_THE_WHEEL);

  /**
   * The whole page as one element — asked for again whenever the tree has to be rebuilt without
   * waiting for a scheduler ({@link resized}).
   *
   * ONE COMPOSITION AND TWO CALLERS, which is what keeps the frame drawn on a resize from being
   * a different frame from the one mounted: the props are the two things resolved once when the
   * session opened, and everything that moves is read through {@link Watched}.
   */
  const theFrame = (): ReactElement =>
    createElement(Region, { watched, tips: tips.text, badge: badge.text });

  const app = render(theFrame(), {
    stdin,
    // THE DOOR AND NOT THE DEVICE: what the library writes when it starts the page over carries
    // the one sequence this product refuses, in the alternate screen exactly as outside it, and
    // it is answered here ({@link theWayOut}).
    stdout: theWayOut,
    // Ctrl-C is this session's, and it abandons the LINE. A library that exited the
    // process on it would make the console worse than the shell prompt it replaces:
    // you would lose the session for mistyping a word.
    exitOnCtrlC: false,
    // The global `console` is left alone. Every line this product prints goes through
    // its own port, so there is nothing to reroute — and patching a global of the
    // caller's process in order to draw a page is a larger thing to borrow than a layout.
    patchConsole: false,
    // WHETHER THERE IS A TERMINAL IS THIS PRODUCT'S ANSWER, not the library's. Left to
    // itself it decides by looking for the marks of a build server, and would draw
    // nothing but a last frame on a machine that has a real terminal and an environment
    // variable saying `CI`. The session refuses without a terminal at both ends before
    // it ever reaches here, so by this line the question has already been asked — and
    // asked of the device rather than of the environment.
    interactive: true,
    // ⛔ THE SCREEN, TAKEN — the whole of this delivery, in one option of somebody else's.
    // The library enters the alternate screen buffer on mount and leaves it on unmount, and
    // writing the sequence here instead would be new code for a flag that exists AND a second
    // teardown beside the one the library already runs. What it does NOT do is give the
    // session's text back to the caller, which is why {@link theTranscriptBack} exists.
    alternateScreen: true,
  });

  // AND THE PAGE FOLLOWS THE RECORD.
  const watching = setInterval(landWhatHappened, HOW_OFTEN_THE_RECORD_IS_ASKED);
  // Watching is no reason for the process to stay up: with everything else that holds it
  // open gone, the session is over and there is nobody left to tell.
  watching.unref();

  const disarm = armLeaving(leaving, restore);

  // WHAT THE RESIZE RE-RENDERS THROUGH, held only once the layout is up: the watch is armed
  // BEFORE the library is mounted, so between those two lines there is an instant with a
  // listener and no tree — and a caller who resized in it would otherwise be answered by a
  // reference that does not exist yet.
  mounted = app;

  return { land, closed };
}
