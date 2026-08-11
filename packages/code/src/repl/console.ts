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
 * AND IT OPENS WITH THE PANEL AT THE TOP AND THE INPUT AT THE FOOT. The row being typed used to
 * sit wherever the opening happened to end — the middle of the screen on anything tall, with
 * nothing under it — and what fixed it is not a place the input is moved to but rows with
 * nothing on them BETWEEN the flow and the area: the area ends on the last row the layout
 * leaves, so the input is at the foot when the session opens and stays there by construction
 * once the content scrolls. How many rows that is is one subtraction over what the opening and
 * the area already say (`page.ts`).
 *
 * ⚠️ THEY WERE WRITTEN BEFORE THE OPENING, and it was this file that put them there — as bytes,
 * with the page that carried the screen away. The anchoring was right and the DIRECTION was
 * not: measured at a hundred and twenty by forty, the page opened with twenty-one empty rows at
 * the top of the screen and the box shoved down against the input, so the first thing there was
 * to read was the last thing on the page.
 *
 * ⚠️ AND THEN THEY WERE LANDED AS LINES OF THE FLOW, which is the half this delivery undid. It
 * was written here that they went through {@link OpenConsole.land}'s own list *and that nothing
 * about the region redrawn here moved* — true of the rows, and it is what made the anchoring
 * one-way: a line of the flow can only ever be APPENDED, so an input area that GREW scrolled the
 * page and an input area that shrank could be answered with nothing but more empty rows.
 * Measured, at a hundred and twenty by forty: one opening and shutting of the list of words, and
 * the whole box was in the scrollback for good. The rows are part of the frame now
 * ({@link showing}, `region.ts`), so the list takes them and gives them back and the page does
 * not move at all.
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
 * opening, the word that clears, and a caller who changed the size of their window. Which
 * ARRANGEMENT the width has room for is the panel's answer, so a session opened at a hundred
 * and twenty columns and narrowed to seventy has the text beside the mark on a screen with no
 * room for it; the fix is not a special redraw but the page again, at the new size. ⚠️ THE
 * REASON GIVEN USED TO BE THE FRAME — *the box is drawn corner to corner, so a terminal
 * narrowed to seventy is a frame the terminal folds in half* — and the frame is gone. What it
 * cost is a page turned for every width there was; what is left is a page turned when the
 * arrangement or the art really changed (`panel.ts`, `sameOpening`).
 *
 * What differs from a clearing is one thing: everything the session already SAID is landed
 * with it, because a caller who resized a window did not ask to lose what they had read.
 *
 * ⚠️ IT SAID *WIDTH ONLY — height moves no glyph of the drawing*, and it was a width
 * standing in for the thing it could be read off. The name gives way by HEIGHT as well now
 * (`presentation/banner.ts`), so a window made short enough opens with a different mark and
 * a width can no longer answer for the drawing. What answers is the DRAWING: the page is
 * turned when the opening this terminal would get is not the one on the screen
 * (`panel.ts`, `sameOpening`) — so the sentence survives as a consequence rather than as a
 * rule, and a window dragged taller or shorter without changing a glyph still costs
 * nothing. And it is asked after the size has SETTLED, because one drag of a window edge
 * delivers dozens of sizes and a page reemitted on each of them is the defect this would
 * otherwise become.
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
 * comes composed from `presentation/`, it goes through {@link OpenConsole.land}, and it
 * stays in the scrollback where the session put it. What it may NOT be is a region of its
 * own — a list that GROWS WITHOUT BOUND where the input is redrawn walks the region into the
 * height at which the layout library stops redrawing a PART of the screen and starts redrawing
 * all of it, with the erase this product refuses inside the sequence (`area.ts`, and the sequence
 * is answered at the pipe rather than avoided — {@link theWayOut}) — and
 * it may not rewrite what is above it either: a fact about a line the caller has already read
 * lands UNDER it, because the one promise of this surface is that what has been said is not
 * unsaid.
 *
 * ⚠️ THAT SENTENCE SAID *A LIST THAT GROWS*, WITHOUT THE BOUND, and what the redrawn region now
 * holds is exactly such a list: the rows with nothing on them between the flow and the area are
 * part of the frame. What keeps the boundary is that they are what is LEFT OVER — the flow, the
 * area and the one row under it, subtracted from the height — so the region is at most one row
 * short of the screen however short the flow is, at every height (`page.ts`, measured and
 * bracketed). A region that grew with what a session had to SAY has no such bound, which is why
 * an occurrence still lands in the flow.
 *
 * ⛔ AND THE BOUND IS AGAINST THE SCREEN THE FRAME WAS DRAWN ON, which is the half of that
 * sentence a window the caller makes SHORTER falsifies. The library judges the frame it LAST drew
 * against the viewport of the moment, so a region one row short of its own screen is over the
 * boundary as soon as the caller drags the bottom edge up past it — and it is the library's own
 * watch on the device that answers first, before anything here runs at the new size. So the erase
 * this surface refuses is reached without this surface writing it, and no frame this file composes
 * can avoid it.
 *
 * SO IT IS ANSWERED ON THE WAY OUT, WHICH IS THE ONE PLACE LEFT ({@link theWayOut}). The library
 * goes on reaching that path at exactly the windows it always did — the frontier is unchanged and
 * still asserted — and what it writes there is translated into this product's own way of emptying
 * a page: the screen erase becomes a scroll, and the erase of the caller's history becomes nothing
 * (`page.ts`, `theEraseAsAScroll`). What was a declared hole is a property now
 * (`tests/the-page-follows-the-terminal.test.ts`, *a window made SHORTER asks for the erase, and
 * the caller's history survives it*).
 */

import { render } from 'ink';
import { createElement } from 'react';
import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { areaFor, BELOW_THE_VIEWPORT } from './area.js';
import type { Completer } from './complete.js';
import { type Editing, type Keystroke, keystrokesOf, NOTHING_TYPED, typeKey } from './editing.js';
import type { AfterLine } from './gate.js';
import { armLeaving, type Leaving } from './leaving.js';
import { carriedIntoTheScrollback, theEraseAsAScroll, theGap } from './page.js';
import { offeredBy, paletteFor, paletteRowsFor } from './palette.js';
import { type Opening, sameOpening } from './panel.js';
import { Region, type Shown, type Watched } from './region.js';

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
 * How long the size has to stop changing before the page is drawn again, in milliseconds.
 *
 * A window dragged by its corner delivers a size per step and the steps are milliseconds
 * apart: measured on a real pseudo-terminal, a hundred changes forced through as fast as
 * the kernel will take them arrive a median of 2 ms apart and never more than 3 — which is
 * the FLOOR of what a drag looks like, since nothing was moving a mouse. Reemitting the
 * page on each of them would put one drag's worth of pages in the caller's scrollback,
 * which is worse than the folded frame this exists to fix. So the page follows the size the
 * caller STOPPED at.
 *
 * A tenth of a second, and the number is chosen from both ends: it is more than thirty
 * times the gap between two steps of that drag, so a drag coalesces into one page; and it
 * is at the threshold below which a person reads a response as immediate, so a caller who
 * resized once and let go does not watch the panel lag behind their window.
 *
 * WHAT IT BUYS IS THE WHOLE COST, and the cost is per PAGE rather than per event: reemitting
 * one is linear in what the session has said, measured at about 33 ms over 200 lines and
 * about 100 ms over 800. Thirty of those inside one drag is the defect; one is a redraw.
 *
 * IT IS ALSO HOW OFTEN THE RECORD IS ASKED WHETHER IT MOVED, and that is one constant with
 * two readers rather than a second number chosen to look like this one. The two are the same
 * question about the same thing — how long a caller waits before the console catches up with
 * the world outside it — and a tenth of a second is what a person reads as immediate at both
 * ends of it. What it costs on the other reader is the cheaper one: a question is one
 * `readdir` per tail and one `stat`, measured at 26 µs, so ten a second is 0.026% of a core
 * and an hour of an idle session is 36 000 of them (`following.ts`).
 */
const AFTER_THE_LAST_CHANGE = 100;

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
  /** The page the console draws on. */
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
   * What the caller can do, already rendered, for the region that is redrawn.
   *
   * It stays under the row being typed instead of landing in the scrollback, which is
   * the difference between a tip and a line: one that has scrolled off the screen is not
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
   * each one depends on: the opening is recomposed for a WIDTH, and this says the same
   * words at every width there is. It was paid for with the one read this surface declares
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
   * A FUNCTION AND NOT A VALUE, and the size is the whole reason. It arrived as a value
   * while the page was only ever drawn at the size the session opened at; a page that
   * follows the terminal has to be able to ask for the same opening at another size, and
   * the answers that depend on it are which drawing there is room for and how much of the
   * name is drawn. Everything else it returns is closed over, composed once, and never
   * asked for again.
   *
   * ⚠️ IT TOOK THE WIDTH ALONE, and the height joined it: the name gives way by height as
   * well now, because five rows of art on a terminal four rows tall is a drawing whose top
   * is already in the scrollback (`presentation/banner.ts`). Both numbers come from the two
   * questions below and from nowhere else.
   *
   * ⛔ IT MAY NOT READ THE RECORD, and that is the caller's promise rather than a
   * signature this file can enforce. What the panel says about the record was paid for
   * with the one read this surface declares (`session.ts`), and a redraw that asked again
   * could say something different halfway through a session — measured by counting the
   * reads three width changes cause, which is none (`tests/the-name-and-the-hints.test.ts`).
   *
   * The panel goes into what is KEPT rather than into what is redrawn: it is written once
   * per page and a caller scrolls back to the top to find it, which is the same argument
   * the opening lines have always been kept by.
   */
  readonly openingFor: (columns: number, rows: number) => Opening;
  /**
   * WHAT A LANDED LINE IS REMEMBERED BY — the records it names, so a Tab can finish one
   * of them (`seen.ts`).
   *
   * It is handed one line at a time rather than reading what this file keeps, because
   * this is the ONE door onto the page: everything a reader ever sees below the opening
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
   * second answer on the frame after a resize. ⚠️ THE THIRD USED TO BE *the frame drawn corner
   * to corner*, and nothing is drawn to a corner any more.
   *
   * ⚠️ IT SAID *THE ONE PLACE ANYTHING DOES*, and the entry falsified it: `cli.ts` reads
   * the width beside the `isTTY` it already read, because whether a line folds is part of
   * the capability every verb is handed and that is resolved once, where the process is
   * (`wiring/color.ts`). Nothing here comes from that reading and nothing there comes from
   * this one, which is why it is two answers to two questions rather than the defect the
   * sentence was written against — and a THIRD is still refused
   * (`tests/the-page-follows-the-terminal.test.ts`).
   */
  const howWide = (): number => stdout.columns ?? NO_WIDTH;

  /**
   * How tall the page is, asked of the DEVICE each time rather than remembered.
   *
   * A terminal the caller resized is a different page, and three things are functions of
   * how tall it is: the bytes that carry a page into the scrollback, which arrangement the
   * input area has room for, and — since the drawing of the name gives way by height —
   * what the page OPENS with. Asking again costs a property read and is the only way the
   * answer can be right after a resize.
   *
   * It sits beside the other question rather than further down, where it was, because the
   * value the layout reads is built before the first line of this function's body has
   * finished running — and a question asked from inside it cannot be declared after it.
   */
  const howTall = (): number => stdout.rows ?? NO_HEIGHT;

  /**
   * ⛔ EVERY BYTE THIS SESSION WRITES, AND THE ONE PLACE THE ERASE IS ANSWERED — the caller's own
   * device, with one door in front of the only method that puts anything on it.
   *
   * IT IS THE LAST POINT IN THE PROCESS, and that is the whole of why it is here rather than in a
   * frame. The library decides to start the page over by comparing the frame it LAST drew against
   * the viewport of the moment, so the decision is taken before anything of this file runs at the
   * new size and no frame this file composes can change it ({@link followTheTerminal}). What IS
   * still ours is the pipe: the bytes it decided on have to leave through a stream, and this file
   * is the one that owns the streams. So the sequence is translated on the way out
   * (`page.ts`, {@link theEraseAsAScroll}) — the screen erase into the scroll this product empties
   * a page with, the erase of the caller's history into nothing.
   *
   * ONE DOOR AND TWO WRITERS, which is what makes it a pipe rather than a patch: the layout is
   * handed this instead of the device, and the one string this file writes itself goes through it
   * too. A second writer on the raw stream would be a second mouth with no door on it, which is
   * asserted over this file's own source (`tests/the-console-on-ink.test.ts`).
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
   * ONE WRITE, ANSWERED — the bytes with the erase translated, handed to the real device.
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
    // than a hole (`tests/the-console-on-ink.test.ts`). The HEIGHT is asked at the instant of the
    // write, because the page being carried away is the one on the device NOW: the whole reason
    // this write exists is a window whose size just changed, and a height read anywhere earlier
    // is the height it changed FROM.
    return stdout.write(
      typeof chunk === 'string' ? theEraseAsAScroll(chunk, howTall()) : (chunk as Uint8Array),
    );
  }

  /**
   * The arrangement and the lines the page on the screen was drawn with.
   *
   * ⚠️ THERE WAS A NUMBER BESIDE IT — the WIDTH the page was drawn for — and a resize was
   * compared against that, on the premise that nothing but a width could move a glyph of
   * the drawing. The name gives way by height now, so the premise is gone; what replaced it
   * is not a second number but the DRAWING itself ({@link sameOpening}), which is what the
   * width was standing in for all along.
   */
  let opened: Opening = openingFor(howWide(), howTall());
  /** Everything the session has said SINCE the page opened — the opening is not in it. */
  let said: readonly string[] = [];
  let past: readonly string[] = [...opened.lines];
  let page = 0;
  let editing: Editing = NOTHING_TYPED;

  /**
   * HOW MANY ROWS OF THE FLOW ARE ON THE SCREEN — the one number the placement has to remember
   * from one frame to the next, and the difference between the flow the session HAS and the flow
   * a reader can see.
   *
   * SCROLLING IS THE ONE THING THAT CANNOT BE UNDONE, and it is what makes this a number rather
   * than a count. The flow is written once, so a page whose flow and frame together outgrow the
   * screen loses rows off the TOP — and those rows are gone for good, however short the frame
   * becomes afterwards. A leftover worked out from the flow the console HOLDS would then be
   * placing the frame against rows that are in the caller's scrollback: measured, before this
   * was here, at a hundred by thirty and at eighty by twenty-four — a list of words opened and
   * shut left the input FOURTEEN and SEVENTEEN rows above the foot, on the same delivery that
   * put it there.
   *
   * SO WHAT IS ON THE SCREEN IS FOLLOWED RATHER THAN RECOMPUTED. It GROWS by what lands
   * ({@link land}), it is CAPPED by what the frame just drawn left room for ({@link moved}), it
   * LOSES what a window the caller made SHORTER carried off the top ({@link whatTheWindowTook}),
   * and it is reset to the whole flow when the page is turned, because a page that is turned is
   * written again from the top ({@link thePageAgain}).
   *
   * AND IT HAS TWO READERS ON A FRAME, WHICH IS WHY IT IS READ ONCE ({@link showing}). The
   * emptiness under the flow is what is left of the page (`page.ts`), and the LIST of words is
   * cut to that same leftover (`area.ts`) — one subtraction each, over one number. While only
   * the first of them read it, a list of words was budgeted against the whole SCREEN and took
   * the rows the flow was standing on: measured on the binary, at a hundred by thirty and at
   * eighty by twenty-four, one opening of the list carried the drawing of the name into the
   * scrollback for good.
   *
   * ⚠️ AND IT IS NOT THE MECHANISM THAT WAS TAKEN OUT, which asked the same question backwards.
   * That one worked the flow out from where the area HAD been anchored and repaired the
   * difference by landing more empty lines in the flow — so the flow grew by its own leftover,
   * and what the area's growing had already scrolled away never came back. Nothing is repaired
   * here and nothing is landed: this is read on the way out of a frame, and the frame after it
   * has one subtraction to do.
   */
  let flowOnScreen = opened.rows;

  /**
   * HOW TALL THE TERMINAL WAS WHEN IT WAS LAST LOOKED AT — the BEFORE a change of height is
   * measured against, and the second thing this console holds between frames.
   *
   * ⚠️ IT IS NOT THE HEIGHT A PAGE WAS PLACED AT, and the difference is what each one is FOR. That
   * one was remembered in order to decide whether to turn the page, which is why a window dragged
   * by its edge cost a page per step of the drag; this decides nothing about the page and can
   * never turn one. What it answers is a question nothing else here can: how many rows the
   * terminal took away, which is a difference and therefore needs two readings
   * ({@link whatTheWindowTook}).
   */
  let theHeightLastSeen = howTall();

  let shown: Shown = showing();
  // AND THE FIRST FRAME IS READ ON THE WAY OUT LIKE EVERY OTHER ONE. A page whose opening is
  // longer than the screen has ALREADY scrolled by the time the layout has drawn it, so the
  // flow this console holds is longer than the flow a reader can see — and it was corrected on
  // the first keystroke rather than here, which made that keystroke the one frame budgeted
  // against rows in the scrollback. Measured at a hundred by eight, where the opening spends
  // the whole page: the list of words the first key asked for was cut to NOTHING, and the
  // second identical key press drew it (`whatTheFrameLeft`).
  flowOnScreen = whatTheFrameLeft(shown);
  const watchers = new Set<() => void>();

  /**
   * HOW MUCH OF THE FLOW A FRAME LEFT ON THE SCREEN — what is above it, and no more.
   *
   * ONE FUNCTION AND TWO CALLERS, which are the first frame and every frame after it. The
   * frame is drawn at the FOOT, so the flow has the rows above it: a frame that did not fit
   * scrolled the difference away, and a frame with a leftover in it did not move anything at
   * all — the same subtraction the leftover is, read the other way round, which is why it is
   * not a second answer.
   */
  function whatTheFrameLeft(frame: Shown): number {
    return Math.min(
      flowOnScreen,
      Math.max(0, howTall() - BELOW_THE_VIEWPORT - frame.gap - frame.area.height),
    );
  }

  /**
   * WHAT A WINDOW THE CALLER MADE SHORTER TOOK OFF THE TOP OF THE FLOW — one subtraction, and the
   * height kept for the next one.
   *
   * A TERMINAL THAT SHRINKS ANCHORS ITS CONTENT AT THE FOOT, which is the fact the whole of this
   * is: the rows that leave go off the TOP, into the caller's scrollback, and nothing tells the
   * program it happened. So the flow a reader can see is shorter by exactly what the window lost,
   * and a page placed against the flow it HAD is placed that many rows short of the foot — the
   * leftover is `rows − flow − area − 1` (`page.ts`, {@link theGap}), so a flow too big by ten
   * makes a leftover too small by ten and the region is drawn ten rows high.
   *
   * MEASURED, AND THE TWO NUMBERS ARE THE SAME NUMBER: at a hundred columns, forty rows made
   * thirty left the input TEN rows above the foot, thirty-four made thirty FOUR, and thirty made
   * twenty-four SIX — the rows the window lost, in every pair
   * (`tests/the-prompt-sits-at-the-foot.test.ts`).
   *
   * ⚠️ THE CAP DOES NOT CATCH IT, and that is why this is a second subtraction rather than a fix
   * to the first. {@link whatTheFrameLeft} limits the flow by what the FRAME left room for, which
   * is the same page seen from the other side; what the terminal carried off is not a frame that
   * did not fit — the frame fitted, on a screen that then became a different screen.
   *
   * GROWING TAKES NOTHING, and it is measured rather than assumed: a window made taller
   * re-anchors itself, because the terminal adds rows with nothing on them UNDER the frame and the
   * region is at the foot again — swept up five heights, with the leftover growing by exactly what
   * the window did (same file).
   *
   * AND NO PAGE IS TURNED FOR IT. This is arithmetic over a number this console already holds; it
   * writes no byte and carries no screen away, which is what tells it apart from the placement
   * that was taken out ({@link followTheTerminal}).
   *
   * IN FACT IT MAKES THE REDRAW FREE, and that is the sharpest way to say what the defect was.
   * Where the flow outlasts the loss, both `rows` and `flow` fall by the same number, so the
   * leftover comes out EXACTLY as it was and the frame the layout is asked for is the frame already
   * on the screen — which is right, because a terminal that anchored its content at the foot left
   * the region at the foot. The library writes nothing for a frame that did not change, so a
   * shorter window now costs zero bytes where it used to cost 668, 620 and 576 at the three pairs.
   * The old shortfall was not a redraw that failed to happen: it was a WRONG frame written over a
   * right one.
   *
   * ⛔ AND FREE IS WHAT IT COSTS ON THIS SIDE OF A BOUNDARY THAT IS NOT THIS FILE'S. Where the new
   * window is no taller than the region the library last drew, the library does not write nothing:
   * it writes the whole page again, out of everything it was keeping, and the sequence it starts
   * over with carries the erase of the caller's history inside it — measured as the opening
   * replayed up to three times for one drag of the bottom edge. Nothing about this subtraction
   * causes it and nothing about it can avoid it; it is declared where a resize is the subject
   * (`tests/the-page-follows-the-terminal.test.ts`).
   */
  function whatTheWindowTook(): void {
    // THE HEIGHT IS READ ONCE, for the reason the frame reads it once: the two things this does
    // with it are one question about one device, and a caller can resize between two readings.
    const rows = howTall();
    flowOnScreen = Math.max(0, flowOnScreen - Math.max(0, theHeightLastSeen - rows));
    theHeightLastSeen = rows;
  }

  /** What the layout is looking at, as one value. Rebuilt whenever anything moved. */
  function showing(): Shown {
    const columns = howWide();
    // HOW TALL THE TERMINAL IS, read once for the whole frame: the arrangement the area has room
    // for and what is left of the page after it are two answers to the same question, and two
    // readings of a device that a caller can resize between them is a frame built out of two
    // different terminals.
    const rows = howTall();
    // HOW MUCH OF THE FLOW IS ON THE SCREEN, read ONCE for the whole frame — and this is the
    // reading that matters, because two things subtract it: how much room is left over for the
    // list of words (`area.ts`) and how much is left over for the emptiness under the flow
    // (`page.ts`). They are two halves of one page, so two readings of a number that GROWS as
    // lines land would be the area and the gap placing the same frame against two different
    // pages ({@link flowOnScreen}).
    const onScreen = flowOnScreen;
    // WHAT THE PALETTE WOULD SHOW, before anything says how much of it there is room for.
    // A pure function over the row being typed and what a Tab last offered (`palette.ts`),
    // so nothing is held between frames and nothing goes stale. What a SLASH opens is asked
    // of the completer rather than of a second list kept here, which is what makes the two
    // keys answer with one menu.
    const offers = offeredBy(editing.typed, editing.offered, complete);
    // WHICH ARRANGEMENT THE INPUT AREA IS IN, asked again on every frame rather than
    // held. It is a function of the terminal's SIZE and of how many words the palette has
    // to show, and both change under a session — one when a window is dragged, the other
    // on a keystroke — so a value kept beside the page would be right until the first
    // Tab. It reads four numbers and composes nothing (`area.ts`).
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
      // AND WHAT THE PAGE HAS ALREADY SPENT, which is what the list is cut to. A list budgeted
      // against the SCREEN takes rows the flow is standing on, and what it takes goes into the
      // scrollback and does not come back when the list shuts — measured on the binary before
      // this line existed, at a hundred by thirty and at eighty by twenty-four: one opening of
      // the list and the drawing of the name was gone for good.
      flow: onScreen,
    });
    return {
      past,
      page,
      panel: opened.panel,
      area,
      // WHAT IS LEFT OF THE PAGE, asked on the same frame as the area and out of the same
      // height, because it is the rest of that subtraction. It is drawn with the area rather
      // than landed in the flow, which is what lets a list of words take its rows out of the
      // emptiness instead of out of the screen (`page.ts`).
      //
      // THE FLOW IT SUBTRACTS IS THE FLOW ON THE SCREEN and not the flow the session has said:
      // rows the terminal has already scrolled away are in the caller's scrollback, and a
      // leftover that counted them would place the frame that many rows short of the foot
      // ({@link flowOnScreen}). It is the SAME reading the area was budgeted with, and the
      // sameness is the point: what the list takes is what this gives up.
      gap: theGap({ rows, flow: onScreen, area: area.height }),
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
    };
  }

  /**
   * ANYTHING MOVED: the value the layout reads is built again, and everyone watching is told.
   *
   * ⚠️ IT ANCHORED THE FLOW HERE TOO, and that is what this delivery took out. The rows with
   * nothing on them were the flow's, so an area that had GIVEN rows back left a hole under
   * itself and the repair was to land that many more of them — a page missing rows, worked out
   * backwards from where the area had been anchored. What the repair could not do is bring back
   * what the area's GROWING had already scrolled away, so a list of words opened and shut cost
   * the caller the box at the top of their page, permanently, and one keystroke was enough. The
   * leftover is redrawn with the area now ({@link showing}), so it shrinks and grows on its own
   * and there is nothing here to repair.
   */
  function moved(): void {
    shown = showing();
    // AND WHAT THE FRAME LEFT ROOM FOR IS WHAT IS STILL ON THE SCREEN ({@link whatTheFrameLeft}).
    flowOnScreen = whatTheFrameLeft(shown);
    for (const watcher of watchers) watcher();
  }

  function land(line: string): void {
    // WHAT THE PAGE SAID, NOTICED WHERE IT IS SAID. A record named on this row can be
    // named back by the caller from here on, and this is the row's one door — so a line
    // that reached the screen without passing here would be a record the session showed
    // and cannot complete. Asked BEFORE the frame is rebuilt, so a Tab on the same
    // keystroke sees it.
    saw(line);
    said = [...said, line];
    past = [...past, line];
    // AND THE SCREEN HAS ONE MORE ROW OF FLOW ON IT, which is where the leftover gives a row up:
    // a line lands at the END of the flow, above the emptiness, so the page fills downwards into
    // the room it had rather than pushing anything off the top. What it costs when there is no
    // room left is capped in {@link moved}, on the way out of the frame this asks for.
    flowOnScreen += 1;
    moved();
  }

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
   *
   * ⚠️ AND IT USED TO PLACE THE PAGE AS WELL AS TURN IT, with the rows that put the input at the
   * foot landed into the flow it had just rebuilt. There is nothing to place now: the leftover is
   * part of the frame ({@link showing}), so a page turned at any height is drawn with whatever it
   * takes on the very next frame — which is the same frame, because turning one ends in
   * {@link moved}.
   *
   * ⚠️ AND IT USED TO REMEMBER THE HEIGHT IT TURNED AT, in a `placedAt` the guard below compared
   * against. Nothing is remembered here now: what this console holds between frames is the
   * DRAWING and never a measurement of the device ({@link followTheTerminal}).
   */
  function thePageAgain(): void {
    // THE HEIGHT IS ASKED FOR HERE AND NOWHERE ELSE IN THIS TURN, because the bytes that carry
    // the screen away are a page's worth of rows and the page is the one on the device NOW.
    carry(carriedIntoTheScrollback(howTall()));
    past = [...opened.lines, ...said];
    // AND THE WHOLE FLOW IS ON THE SCREEN AGAIN, because a page that is turned is written from
    // the top: what the terminal had scrolled away is being drawn a second time, so what was
    // remembered about it is not this page's ({@link flowOnScreen}).
    flowOnScreen = opened.rows + said.length;
    page += 1;
    moved();
  }

  /**
   * A clean page: the opening, and nothing the session has said.
   *
   * The opening is what this console was handed for the size it is drawn at, so a cleared
   * page is the opened page by construction rather than by a second composition that could
   * come to say something else.
   */
  function cleanPage(): void {
    said = [];
    thePageAgain();
  }

  /**
   * The page at the size the caller's terminal has NOW: the opening recomposed for it, and
   * every line the session already said landed under it.
   *
   * What is not here is as much of the decision as what is. Nothing is re-read — the
   * opening is recomposed out of lines that already exist, and what depends on the size is
   * which drawing there is room for and how much of the name is drawn. And nothing the
   * caller has read is taken from them: the page they had goes UP, into the scrollback,
   * exactly as it does when they ask for a clean one.
   */
  function followTheTerminal(): void {
    // THE ONE GUARD, AND IT IS ONE QUESTION: is the page this terminal would get the one that
    // is on the screen? What answers it is the DRAWING ({@link sameOpening}, a pure function
    // over lines that already exist, which is what makes it askable at all). A drag that
    // wandered away and came back is a caller whose page is already right, and so is a window
    // dragged taller or shorter without moving a glyph.
    //
    // ⚠️ IT ASKED A SECOND HALF — *and the height the page on the screen was placed at* — and
    // this delivery took it out. The premise under it was that a page is a drawing AND a
    // placement: the rows under the flow are how many the height leaves over, so a terminal that
    // changed height had a page whose flow no longer ended where the layout's last row is,
    // measured at a hundred by thirty dragged to forty with the input eleven rows above the
    // foot. WHAT FALSIFIED IT IS THE LEFTOVER MOVING INTO THE FRAME (`page.ts`, {@link theGap}):
    // the rows under the flow are drawn WITH the area now, and {@link resized} rebuilds the
    // frame at once — before this is ever asked — so the input is back at the foot without a
    // page being turned at all. ⚠️ AND THAT WAS TRUE OF A WINDOW THAT GREW AND NOT OF ONE THAT
    // SHRANK, which the delivery that removed the second half asserted as an open hole with its
    // number: rebuilding the frame is not enough when the terminal has taken rows off the TOP of
    // the page, because the flow it is rebuilt against is then too long by exactly what left. What
    // closed it is a subtraction and still not a placement ({@link whatTheWindowTook}) — so the
    // sentence above is whole now, in both directions, and this is the note that says which half of
    // it was standing on its own. What the second half cost is a page per STEP of a drag: a
    // window dragged by its edge delivers a size per step, and only steps closer together than
    // {@link AFTER_THE_LAST_CHANGE} coalesce, which a hand dragging a corner never is. Measured
    // on the binary, twelve steps of two rows from a hundred by twenty-four: TWELVE pages, one
    // per step, against TWO for the same drag along the width — and each page is a screen of
    // the caller's carried away and their opening rewritten over it.
    //
    // ⚠️ AND THREE PARAGRAPHS OF THIS FILE WENT ON SAYING WHAT THE GUARD HAD STOPPED DOING —
    // *a window dragged taller or shorter without changing a glyph still costs nothing*, *what
    // they cost there is a page only when the drawing really changed*, and, beside the opening
    // itself, *what replaced it is not a second number but the DRAWING*. All three were false
    // for as long as the second half was here, and all three are true again; they are left
    // standing rather than rewritten, and this is the note that says they were once out of step.
    // ⚠️ THE COUNT WAS TWO when this was written, and the third was found by the phrase rather
    // than by the symbol: it names no `placedAt` at all, it just promises there is no second
    // number ({@link opened}).
    //
    // WHAT ANSWERS FOR THE REMOVAL is a page that follows the drawing and a page that does not
    // move for a height — asserted as pages carried into the scrollback, over a drag of twelve
    // steps along each edge (`tests/the-page-follows-the-terminal.test.ts`) — and the property
    // that pays for it, which is that the input is at the foot after a height changed and no
    // page was turned, swept up and down (`tests/the-prompt-sits-at-the-foot.test.ts`).
    const now = openingFor(howWide(), howTall());
    if (sameOpening(now, opened)) return;
    opened = now;
    thePageAgain();
  }

  /** The redraw that has been asked for and not yet drawn, if any. */
  let settling: ReturnType<typeof setTimeout> | undefined;

  /**
   * The terminal changed size — the page follows it, once the size has SETTLED.
   *
   * Nothing about the PAGE is decided here. Every change starts the wait over, and what happens at
   * the end of it is {@link followTheTerminal}'s to decide, which is why a drag costs one page at
   * most however many sizes it delivered, and none at all when it moved no glyph.
   *
   * ⚠️ IT SAID *nothing is decided here*, WHICH IS TOO WIDE BY ONE SUBTRACTION. How many rows a
   * terminal that SHRANK carried off the top is a difference between two readings of the device, so
   * it can only be answered while both are known — which is here, and it is the reason this is the
   * one place the height a resize is measured against is written ({@link whatTheWindowTook}). It
   * turns no page and writes no byte, so the sentence is true of everything it was about.
   */
  function resized(): void {
    // WHAT THE TERMINAL CARRIED OFF IS SUBTRACTED FIRST, before anything is drawn against the flow:
    // a window that shrank took rows off the top and the frame this is about to rebuild is placed
    // against what is LEFT ({@link whatTheWindowTook}).
    whatTheWindowTook();
    // THE INPUT AREA IS ANSWERED AT ONCE, and only the page waits. Which arrangement the
    // area is in is decided per frame out of what this rebuilds — nothing is carried into
    // the scrollback and no page is turned for it, so there is nothing for a wait to
    // coalesce. ⚠️ THIS USED TO SAY A HEIGHT COST NOTHING BUT THIS, on the premise that only
    // the width could turn a page. The name gives way by height too now, so both edges of a
    // window reach the page below — and what they cost there is a page only when the
    // drawing really changed.
    moved();
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
   * its way out lands nothing, because the page is about to stop being this one's.
   */
  function landWhatHappened(): void {
    const occurrences = happened();
    if (occurrences.length === 0) return;
    turn = turn.then(() => {
      if (left) return;
      for (const line of occurrences) land(line);
    });
  }

  /** Everything this session took from the terminal, given back. Idempotent, and sync. */
  function restore(): void {
    if (restored) return;
    restored = true;
    // The watch on the device's size goes first, and a page that was about to be drawn is
    // dropped: a redraw landing after the frame came down would be this session writing on
    // a terminal that is somebody else's again.
    stdout.off('resize', resized);
    if (settling !== undefined) clearTimeout(settling);
    // And the watch on the RECORD goes with it, for the same reason: an occurrence landing
    // after the frame came down would be a line written onto somebody else's terminal.
    clearInterval(watching);
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
  //
  // AND IT OPENS PLACED WITHOUT A SECOND LINE HERE, which is what the leftover moving into the
  // frame bought: the value the layout is about to read was built with the room the page has to
  // spare in it ({@link showing}), so the first frame drawn is already anchored.
  //
  // AND IT GOES THROUGH THE DOOR LIKE EVERY OTHER BYTE ({@link theWayOut}), which costs nothing
  // here and is what makes the pipe one pipe: these bytes hold no erase to translate, and a second
  // writer on the raw device would be the hole the door exists to close.
  theWayOut.write(carriedIntoTheScrollback(howTall()));

  const app = render(createElement(Region, { watched, tips: tips.text, badge: badge.text }), {
    stdin,
    // THE DOOR AND NOT THE DEVICE, which is the whole of this delivery: what the library writes
    // when it gives up on redrawing PART of the screen carries the one sequence this product
    // refuses, and it is answered here ({@link theWayOut}).
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
  });

  // THE PAGE FOLLOWS THE TERMINAL, and the watch goes on AFTER the layout is up: the
  // library keeps its own on the same event and recalculates the frame it is redrawing, so
  // arming this one second is what puts the page in front of a library that has already
  // agreed about how wide the screen is.
  stdout.on('resize', resized);

  // AND THE PAGE FOLLOWS THE RECORD, on the cadence a settled resize already waits out —
  // one constant, two readers, because both are the same question about how long a caller
  // waits for the console to catch up with something that changed outside it.
  const watching = setInterval(landWhatHappened, AFTER_THE_LAST_CHANGE);
  // Watching is no reason for the process to stay up: with everything else that holds it
  // open gone, the session is over and there is nobody left to tell.
  watching.unref();

  const disarm = armLeaving(leaving, restore);

  return { land, closed };
}
