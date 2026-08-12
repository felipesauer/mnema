/**
 * WHAT IS ON THE SCREEN — a terminal's own answer, worked out from the bytes it received.
 *
 * Everything else this surface is tested by asks what was WRITTEN. That is the right
 * question for a line: a line is bytes, and a golden holds them. It is the wrong question
 * for a PAGE. "The console opens with nothing of the caller's above it" is a statement
 * about the twenty-four rows a person is looking at, and a byte stream cannot answer it —
 * the caller's output is in the stream either way, because it was written before the
 * session started. What tells the two apart is whether it is still in the viewport, and
 * only a screen has one.
 *
 * SO THIS IS A SCREEN, and it is deliberately the smallest one that can answer: a grid,
 * a cursor, and the sequences this product and its layout library actually write —
 * moving, erasing a row, erasing the display, and the newline at the bottom that scrolls.
 *
 * ⚠️ AND A ROW THAT SCROLLED OFF THE TOP USED TO BE GONE FROM IT, written here in those words:
 * *it went into the scrollback, which is not the screen and is not this model's business*. WHAT
 * FALSIFIED IT is a promise that is only ABOUT the scrollback. Where a row went when it left the
 * top is the difference between the two ways to empty a page — a scroll puts it above, an erase
 * destroys it — and a model that discarded it answers the same thing for both, so the case that
 * says *what was on the screen is above* could not be written at all. The rows that leave are
 * KEPT now ({@link Screen.above}), in the order they left; erasing the screen adds none of them,
 * and the sequence that erases the history EMPTIES them, which is the whole of what it does. It
 * is still not the screen: nothing that reads {@link Screen.rows} sees a row of it.
 *
 * IT IS AN INSTRUMENT, AND IT IS PROVED BEFORE IT IS BELIEVED. A model that quietly did
 * nothing would say the page is clean about every page there is, so the case that uses it
 * renders the screen from BEFORE the session opened and finds the caller's output on it
 * (`tests/a-page-that-opens-clean.test.ts`).
 *
 * ⚠️ AND IT USED TO SAY THAT ANYTHING IT DID NOT UNDERSTAND WAS SKIPPED RATHER THAN
 * PRINTED, "which is the safe direction: an unhandled escape becomes nothing on the page
 * instead of becoming text that was never there". That is true of a glyph and it is the
 * OPPOSITE of true for a sequence that moves something. A scroll this model did not
 * perform leaves every row of its answer one out, and what a case then reads is a number
 * that is wrong for a reason nothing on the screen mentions — which is the shape of red
 * that costs a reviewer an afternoon. So skipping is now a NAMED list with a reason each
 * ({@link CHANGES_ONLY_HOW_IT_LOOKS}), and everything outside it is accused
 * (`tests/the-screen-says-what-it-was-drawn-at.test.ts`).
 *
 * ⚠️ AND IT USED TO MODEL ONE SCREEN, which is what the console taking the alternate buffer
 * falsified. A terminal has TWO — the caller's own, with a scrollback under it, and an
 * alternate one that has none and is cleared on the way in — and every promise this delivery
 * makes is about which of the two something landed on. So there are two grids here
 * ({@link Screen.alternate}, {@link Screen.beneath}): a scroll on the caller's own buffer feeds
 * the scrollback and a scroll on the alternate one throws the row away, which is the terminal's
 * own rule and the reason a full-screen program pollutes nothing. A model with one grid would
 * answer *the caller's page is intact* and *the transcript came back* identically whether either
 * was true.
 *
 * ⚠️ AND THE OTHER HALF: A REPLAY IS NOT A TERMINAL, and the size is the seam. This model
 * is handed the size the CASE asked for, and the bytes were written by a process that read
 * the size from a DEVICE. When those two are not the same number, every row under the first
 * thing that folds is off — and the case fails on a count, which says nothing about the
 * disagreement that produced it. The frame the console opens with is drawn corner to corner
 * (`src/repl/panel.ts`), so the width the process read is ON THE PAGE: it is measured here
 * ({@link everyWidthDrawnOn}) and it has to be one of the widths this screen was replayed
 * at, or the replay is accused instead of the product.
 */

import { expect } from 'vitest';
import { FRAME_IS_DRAWN } from './pty.js';

/** One escape byte, written as an escape so no control byte enters a source file. */
const ESC = '\u001b';

/** The sequence that gives the caller's own screen back. See {@link theScreenBeforeLeaving}. */
const GIVES_THE_SCREEN_BACK = `${ESC}[?1049l`;

/** What a row is made of before anything is written on it. */
const BLANK = ' ';

/**
 * WHAT A RULE IS DRAWN OUT OF — the horizontal run, and nothing else.
 *
 * Spelled by code point rather than typed, like every other unusual glyph in this
 * repository: a run is one keystroke away from a hyphen, and a character a reader cannot tell
 * from a neighbouring one is a character an edit destroys without anybody seeing it happen.
 *
 * ⚠️ THERE WERE FOUR MORE, and they were the corners a frame turns at: the panel used to be a
 * BOX, drawn corner to corner, so an edge bounded by two of them was a width and the two halves
 * of a title-cut top edge were neither. The frame is gone from the product
 * (`src/repl/region.ts`), so a corner cannot appear on a page this replays — and a branch that
 * cannot fire is worse than no branch, because the fixture that kept it green was drawing
 * something the product does not produce.
 */
const RUN = '\u2500';

/**
 * EVERY WIDTH THE PAGE WAS DRAWN AT, read off the drawing rather than off a number.
 *
 * A RULE IS THE WITNESS. The two rules the input area sits between run the whole way across the
 * terminal (`src/repl/area.ts`, `src/repl/region.ts`), so the length of one IS the width the
 * process read off its device. Nothing here knows what that number ought to be; it answers what
 * is there.
 *
 * ⚠️ THE FRAME WAS THE WITNESS TOO, and it was the richer half of this measurement: the box was
 * drawn corner to corner, so its bottom edge gave a width whatever the input area did. What is
 * left is one witness rather than two — which is a REDUCTION and is written down as one, because
 * a page with no input area on it can no longer say what it was drawn at.
 *
 * THE ROWS ARE JOINED because a row wider than the screen does not stop at the screen: it
 * carries on at the first column of the next one, which is what a terminal does and what
 * {@link screenOf} models. Joined, a rule is contiguous whether it fitted or not, so the
 * measurement works in BOTH directions — a rule narrower than the replay ends in blanks,
 * and one wider than it ends on the row below.
 *
 * WHAT COUNTS IS A MAXIMAL RUN of {@link RUN}, and its width is its own length. ⚠️ IT USED TO
 * DEPEND ON WHAT BOUNDED IT — corner to corner was the run plus two, one end only was not a width
 * at all — and neither case can occur on a page without a frame.
 */
export function everyWidthDrawnOn(rows: readonly string[]): readonly number[] {
  const page = rows.join('');
  const widths: number[] = [];
  for (let at = 0; at < page.length; ) {
    if (page[at] !== RUN) {
      at += 1;
      continue;
    }
    let end = at;
    while (end < page.length && page[end] === RUN) end += 1;
    widths.push(end - at);
    at = end;
  }
  return widths;
}

/**
 * ⛔ WHAT SAYS A RESIZE HAPPENED: the console DREW at that width, since the step began.
 *
 * ⚠️ THE STEP USED TO WAIT FOR A FRAME, AND A FRAME NAMES NOTHING ABOUT A SIZE. That is the
 * amarra this bench already carries — a step waits for what it CAUSED — applied to the one event
 * it had not been applied to. Under load the frames of the step before can still be arriving, so
 * *a frame arrived since this step began* is answered by somebody else's frame; the step then
 * ends, the next size is set, and the size in between is never drawn at all. Measured on a loaded
 * machine, in the full suite: the locator refused the read with *no frame in this stream was
 * drawn 80 columns wide*, and it was right — the console never drew at eighty, because by the
 * time it ran the terminal was already something else.
 *
 * ⛔ AND THE CONSOLE IS RIGHT TO SKIP IT. The geometry is read at the moment of the drawing, so
 * a size the terminal held for a few milliseconds and left is a size no frame owes anything to —
 * that is what *treat a resize as a signal to render again rather than as a source of truth*
 * buys, and it is what a caller dragging a window edge relies on. What was wrong is a case that
 * asked for the page at a size it never let the console reach.
 *
 * SO THE WAIT IS THE SIZE ITSELF. The two rules the input area sits between run the whole way
 * across the terminal, so a run of them that long IS the console having drawn at that width
 * ({@link everyWidthDrawnOn}) — and a step that waits for it cannot end before the size it asked
 * for is on the page, nor can the next size be set on top of it.
 *
 * ⛔ IT IS ONLY AVAILABLE WHERE THE INPUT AREA HAS RULES, which is every arrangement but the bare
 * one. A window too short for the rules draws none, and a step waiting for one there would wait
 * for ever — so the sizes a case drives with this are sizes with room for them.
 */
export function drewAt(columns: number): (bytes: string, since: number) => boolean {
  return (bytes, since) => everyWidthDrawnOn([bytes.slice(since)]).includes(columns);
}

/**
 * ⛔ THE PAGE AS IT SETTLED AT A GIVEN WIDTH — found by what the frames CONTAIN, never by where
 * they are in the stream.
 *
 * ⚠️ THIS IS THE INSTRUMENT A WHOLE CLASS OF CASES WAS MISSING, and the class is precise: a step
 * WAITS for the frame it caused, and then the case READS by index — `ran.at[3]`. The wait is
 * right; the index is not what the wait guarantees. A resize produces more than one frame, the
 * boundary a step ends on is wherever the stream happened to be quiet, and a machine under load
 * puts that boundary between two frames instead of after both. What the case then replays is the
 * page BEFORE the thing it is about, and the red says *the opening is not on the page* or
 * *nothing on it was drawn 70 columns wide* — a symptom that names neither the index nor the
 * load. Measured on a loaded machine: three cases, three different symptoms, one cause.
 *
 * SO THE FRAME IS FOUND BY ITS WIDTH, which is a property of the frame and not of the clock. The
 * two rules the input area sits between run the whole way across the terminal, so the length of
 * one IS the width the process read off its device ({@link everyWidthDrawnOn}) — and every frame
 * this console writes is a whole page, so every frame carries them. The LAST frame drawn that
 * wide is the page after the size settled, whatever else the stream did around it.
 *
 * ⛔ IT ACCUSES RATHER THAN GUESSING when there is no such frame: a page whose input area has no
 * rules says nothing about a width, and a locator that fell back to the end of the stream would
 * be the index again, wearing a better name.
 */
export function theSettledScreen(
  bytes: string,
  columns: number,
  rows: number,
  // AND, WHERE THE SUBJECT IS NARROWER THAN A SIZE, something the frame has to be SHOWING. The
  // last frame at a width is the page as the session ended at it, which is the right answer for
  // *the page after the resize* and the wrong one for *the page after the resize, with the list
  // still open* — by the time a session leaves, the list is shut. Naming what the frame holds is
  // the same idea one notch finer: still a property of the frame, still nothing about where it is.
  holds?: string,
): Screen {
  const ends = theFrame(
    bytes,
    (frame) =>
      everyWidthDrawnOn([frame]).includes(columns) &&
      (holds === undefined || frame.includes(holds)),
    'last',
  );
  if (ends < 0) {
    throw new Error(
      `no frame in this stream was drawn ${columns} columns wide${holds === undefined ? '' : ` with ${JSON.stringify(holds)} on it`}, so there is no settled page ` +
        `to read at that size. The width is read off the rules the input area sits between, ` +
        `which every frame of this console writes — so either the session never reached that ` +
        `size, or it drew an arrangement with no rules in it. Reading the end of the stream ` +
        `instead would be an index by another name.`,
    );
  }
  return screenOf(bytes.slice(0, ends), columns, rows);
}

/**
 * ⛔ THE PAGE AS SOON AS IT FIRST SHOWED SOMETHING — the other half of the same idea, for the
 * cases whose subject is an effect landing rather than a size settling.
 *
 * THE FIRST FRAME AND NOT THE LAST, and the difference is what each is about: a size is settled
 * by the LAST frame drawn at it, and an effect has landed by the FIRST frame that shows it.
 * Reading the last would answer with the end of the session, which is the index again.
 */
export function theFirstScreenWith(
  bytes: string,
  what: string,
  columns: number,
  rows: number,
): Screen {
  const ends = theFrame(bytes, (frame) => frame.includes(what), 'first');
  if (ends < 0) {
    throw new Error(
      `no frame in this stream ever showed ${JSON.stringify(what)}, so there is no page to read ` +
        `it off. Either the session never drew it, or it is spelled here in a way the page ` +
        `never was — a fold puts a break in the middle of a row, and a row carrying style ` +
        `carries escapes between its characters.`,
    );
  }
  return screenOf(bytes.slice(0, ends), columns, rows);
}

/**
 * WHERE A FRAME ENDS IN THE STREAM, for the first or the last one that answers `is` — and −1
 * when none does.
 *
 * ONE WALKER AND TWO READINGS, which is what keeps *where a frame ends* from being spelled twice:
 * the boundary is the sequence that closes the layout's synchronized update (`support/pty.ts`,
 * `FRAME_IS_DRAWN`), and a second spelling of it is a second idea of which bytes belong to which
 * frame.
 */
function theFrame(bytes: string, is: (frame: string) => boolean, which: 'first' | 'last'): number {
  let at = 0;
  let found = -1;
  for (const frame of bytes.split(FRAME_IS_DRAWN)) {
    at += frame.length + FRAME_IS_DRAWN.length;
    if (!is(frame)) continue;
    if (which === 'first') return at;
    found = at;
  }
  return found;
}

/**
 * ⛔ THE PAGE AS SOON AS THE PAGE ITSELF ANSWERS `is` — the locator for the cases whose subject
 * cannot be told from the bytes of one frame.
 *
 * ⚠️ IT IS THE THIRD ANSWER TO ONE QUESTION AND IT EXISTS BECAUSE THE SECOND WAS AMBIGUOUS.
 * {@link theFirstScreenWith} finds the first frame whose BYTES hold something, which is enough
 * while that something can be in one place — and the row a caller is typing is not such a place.
 * What the session SAID is on the roll, so `mnema> show <id>` is on the page twice over once the
 * caller has run that line: once as the echo the roll kept, and once on the row being typed. A
 * marker cannot tell them apart; the PAGE can, because on the page one of them is the last row
 * carrying the prompt and the other is not. Measured: the case that completes a record the
 * session had already shown went red with the drawing of the name as its message, because the
 * frame it was handed was the one where the echo first appeared.
 *
 * SO THE PREDICATE IS OVER THE SCREEN, which means replaying one for every frame until it holds.
 * That is the expensive locator of the three and it is the one to reach for last: a stream is
 * tens of kilobytes and a session is tens of frames, so it costs a replay per frame and nothing
 * that matters — but a case that can be answered by the bytes of a frame should be.
 */
export function theFirstScreenWhere(
  bytes: string,
  columns: number,
  rows: number,
  is: (screen: Screen) => boolean,
): Screen {
  let at = 0;
  for (const chunk of bytes.split(FRAME_IS_DRAWN).slice(0, -1)) {
    at += chunk.length + FRAME_IS_DRAWN.length;
    const screen = screenOf(bytes.slice(0, at), columns, rows);
    if (is(screen)) return screen;
  }
  throw new Error(
    `no frame in this stream ever drew a page the case would accept. Every frame was replayed ` +
      `and the question was asked of each — so either the session never reached that page, or ` +
      `what the question asks for is not what a page of this console can be.`,
  );
}

/**
 * ⛔ THE PAGE AS THE SESSION LEFT IT — everything up to the sequence that gives the caller's
 * screen back.
 *
 * THE THIRD LOCATOR, and it is here for the pages the other two cannot name. A page whose input
 * area has no rules says nothing about a width ({@link theSettledScreen} refuses it, rightly),
 * and a page whose subject is *the shape of the frame* has no text to be found by
 * ({@link theFirstScreenWith}). What every session has is an END, and it is written in the bytes
 * rather than counted: the alternate screen is given back exactly once.
 */
export function theScreenBeforeLeaving(bytes: string, columns: number, rows: number): Screen {
  const back = bytes.lastIndexOf(GIVES_THE_SCREEN_BACK);
  if (back < 0) {
    throw new Error(
      `this session never gave the screen back, so there is no page it left. Either it is still ` +
        `running, or it died where nothing of ours runs — and a replay of the whole stream would ` +
        `be a page nobody ever saw.`,
    );
  }
  return screenOf(bytes.slice(0, back), columns, rows);
}

/**
 * ACCUSES A SCREEN REPLAYED AT A WIDTH NOTHING ON IT WAS DRAWN AT.
 *
 * ONE WITNESS IS ENOUGH, and that is deliberate rather than lax. A page can honestly hold
 * two widths at once: a session opened at a hundred and twenty columns and narrowed to
 * seventy leaves the old drawing above, folded, and those rows are a true record of a
 * terminal that really was that wide (`tests/the-input-has-its-own-place.test.ts` says so
 * where it reads the rules by position rather than by counting them). What may not happen
 * is NOTHING on the page having been drawn at the width it is being read at — that is a
 * replay and a process that never agreed about the device, and every row under the first
 * fold is out by the difference.
 *
 * A page with no frame on it is not accused and cannot be: a screen the box has scrolled
 * off says nothing about a width, and an instrument that guessed would be inventing one.
 */
function theWidthIsTheOneItWasDrawnAt(rows: readonly string[], columns: number): void {
  const drawn = everyWidthDrawnOn(rows);
  if (drawn.length === 0 || drawn.includes(columns)) return;
  const measured = [...new Set(drawn)].sort((one, other) => one - other).join(', ');
  throw new Error(
    `this screen was replayed ${columns} columns wide and nothing on it was drawn that wide: ` +
      `the frame's own edges measure ${measured}. The box and the rules are drawn corner to ` +
      `corner, so the width of an edge IS the width the process read off its device. Whether ` +
      `that device was the size the case asked for is answered where the session is driven — ` +
      `\`support/pty.ts\` accuses it there — so if nothing was said there, the console drew at ` +
      `a width the terminal never reported; and if this screen is simply being read at a size ` +
      `the run was never driven at, the case is asking the wrong question. Either way an ` +
      `assertion about a row further down is out by whatever the difference folds, and that ` +
      `off-by-one is the SYMPTOM rather than the finding.`,
  );
}

/**
 * THE SEQUENCES THIS MODEL DELIBERATELY DOES NOTHING ABOUT, and the reason it is safe to do
 * nothing about them.
 *
 *   - `m` — SGR, which is colour and weight. It changes how a glyph LOOKS and never where
 *     one goes, and this model answers what is on the page rather than what colour it is.
 *
 * A private sequence (`ESC[?…`) never reaches this: it is a mode being switched, and a mode
 * changes nothing on the page either.
 *
 * MEASURED RATHER THAN GUESSED AT: a session that opens at a hundred by thirty, lists the
 * words a slash offers and leaves writes eight distinct finals — `H`, `h`, `l`, `m`, `A`,
 * `B`, `G` and `K` — and every one but `m` is acted on below. So this list is one letter
 * long because there is one letter to put in it, not because the rest were never looked for.
 */
const CHANGES_ONLY_HOW_IT_LOOKS = 'm';

/**
 * WHAT A DECODER LEAVES BEHIND when it is handed half a character: the replacement, U+FFFD.
 *
 * Spelled by code point, like every other unusual glyph here — and it is the one glyph in
 * this file that nothing ever draws on purpose.
 */
const HALF_A_CHARACTER = '\ufffd';

/**
 * ACCUSES A STREAM THAT WAS DECODED IN PIECES.
 *
 * ⚠️ THIS IS THE DEFECT THE WHOLE DELIVERY WENT LOOKING FOR, and it is the instrument's own.
 * A pty is read in chunks and five places accumulated them one decode per chunk. The glyph a rule is made of is THREE bytes, so a chunk boundary that
 * lands inside one destroys it and leaves TWO replacements where there was one character.
 * The row is then one column WIDER than the terminal, the terminal folds it, and the page
 * has a row nobody drew.
 *
 * MEASURED, on a run caught by dumping the screen of the failing case: a rule 100 columns
 * wide came back 101 characters long, `a run with two replacements in the middle of it`, and the extra column wrapped
 * onto the row below as a single `─`. That one row is every symptom this family has:
 * `expected 22 to be 21` for the caret, `expected 25 to be 24` for what the page spends, and
 * a row above the prompt that is not a rule.
 *
 * IT IS FIXED IN ONE PLACE (`support/arriving.ts`, a collector whose decoder keeps its state
 * across chunks), AND THIS STAYS. It is not redundant now that the defect is gone: it is the
 * thing that says out loud the day a sixth reader turns bytes into text on its own, instead
 * of leaving a reader with a number that is one out for no visible reason.
 */
function theStreamWasDecodedWhole(bytes: string, columns: number): void {
  const at = bytes.indexOf(HALF_A_CHARACTER);
  if (at < 0) return;
  const around = bytes.slice(Math.max(0, at - 20), at + 20);
  throw new Error(
    `this screen was replayed from a stream with a REPLACEMENT CHARACTER in it, which is ` +
      `what a decoder leaves when it is handed half a character: ${JSON.stringify(around)}. ` +
      `The bytes of a pseudo-terminal arrive in chunks and are decoded one chunk at a time, ` +
      `so a boundary inside a multi-byte glyph destroys it — and the glyph a rule is drawn ` +
      `out of is three bytes long. What that costs is a row ONE COLUMN wider than the ` +
      `${columns} it was drawn for, which the terminal folds, which puts a row on the page ` +
      `that nobody drew. Every off-by-one a case is about to report is that row. The product ` +
      `wrote the right bytes; the stream they were read out of is what is wrong.`,
  );
}

/** A screen, as a reader would see it. */
export interface Screen {
  /** Every row of the buffer that is SHOWING, top first, each exactly as wide as the terminal. */
  readonly rows: readonly string[];
  /** The same rows with their trailing blanks off, joined — what a reader reads. */
  readonly text: string;
  /**
   * WHETHER THE ALTERNATE SCREEN IS SHOWING — which is whether {@link rows} is the session's
   * page or the caller's own.
   *
   * It is the first thing every case about this console asks, because it is the difference
   * between the two models: a page drawn on the caller's buffer is a page that scrolls their
   * history, and a page drawn on the alternate one cannot touch it at all.
   */
  readonly alternate: boolean;
  /**
   * THE CALLER'S OWN BUFFER, whichever one is showing — trailing blanks off and joined.
   *
   * ⛔ IT IS THE ONE PLACE THE TRANSCRIPT CAN BE READ, and reading it anywhere else would be
   * reading it off a screen that is about to be thrown away. While the session is up this is
   * whatever the caller had before it opened, untouched; after the session has given the screen
   * back, it is that plus everything the session said (`src/repl/scrolling.ts`).
   */
  readonly beneath: string;
  /**
   * WHAT IS ABOVE THE SCREEN: every row that left the top, in the order it left — the caller's
   * scrollback, which is the thing this product's whole page design is about.
   *
   * IT IS ONLY EVER FED BY A SCROLL, and that is the fact it exists to make observable. A
   * terminal puts a row into the scrollback when it is pushed off the top and at no other time
   * ({@link down}), so a page emptied by erasing adds nothing to this and a page emptied by
   * scrolling adds all of it — which is the difference between destroying what a caller was
   * reading and moving it one scroll away (`src/repl/page.ts`).
   *
   * AND THE SEQUENCE THAT ERASES THE HISTORY EMPTIES IT, because that is literally what it does.
   * Modelling it as nothing would leave a case unable to tell *we scrolled* from *we erased and
   * nobody noticed*.
   */
  readonly above: readonly string[];
  /** {@link above}, trailing blanks off and joined — what a reader finds by scrolling up. */
  readonly aboveText: string;
  /**
   * WHERE THE CARET IS LEFT, in rows from the top of the screen and columns from its
   * left edge.
   *
   * It is on the model because it is the only way to ask a question this surface now
   * makes: the row being typed stopped being the first of the redrawn ones, so "the caret
   * is where the caller is typing" is an offset the product works out (`repl/area.ts`) and
   * the layout is told. Nothing but a screen can say where it ended up — the bytes say
   * `up three rows`, and how many rows there were is exactly what is under test.
   */
  readonly cursor: { readonly row: number; readonly column: number };
}

// ---------------------------------------------------------------------------
// WHERE THE PAGE BEGINS AND WHERE IT ENDS — the four questions a placement is asked
// ---------------------------------------------------------------------------

/**
 * THE FIRST ROW OF THE SCREEN WITH ANYTHING ON IT — where the page begins.
 *
 * ⚠️ IT WAS THE INSTRUMENT THE ANCHORING WAS READ WITH, and it stopped being one: while the
 * rows with nothing on them went OVER the opening, how far down the page began WAS the
 * placement, and the case that proved a page was anchored asserted this was not zero. The rows
 * go under the flow now, so the box is on the first row at every size and this answers zero on
 * an anchored page and on an unanchored one alike. What replaced it is {@link theGapOn}, which
 * measures the same leftover where the leftover now is.
 *
 * It is still asked, for the half it can still answer: whether the top of the page is on the
 * screen at all, and whether what is on the first row is the box's own top edge rather than the
 * middle of a drawing whose top went into the scrollback.
 */
export function firstDrawnRow(screen: Screen): number {
  return screen.rows.map((row) => row.trim().length > 0).indexOf(true);
}

/** The last row of the screen with anything on it — the last row of the input area. */
export function lastDrawnRow(screen: Screen): number {
  return screen.rows.map((row) => row.trim().length > 0).lastIndexOf(true);
}

/** The row the caller is typing on, which is the one the input area is arranged around. */
export function promptRow(screen: Screen, prompt: string): number {
  return screen.rows.map((row) => row.includes(prompt)).lastIndexOf(true);
}

/**
 * ACCUSES A SCREEN WHOSE FRAME DOES NOT FILL IT — the input area's last row is not the last
 * row of the terminal.
 *
 * ⚠️ IT WAS `endsAtTheFoot` AND IT ALLOWED EXACTLY ONE ROW UNDER THE AREA, and it is renamed
 * because the number it asserts INVERTED. That row was the layout library's: it writes a
 * newline after the last row of every frame, and the area's arithmetic kept a row back so the
 * region stayed shorter than the viewport and was redrawn in PART. On a screen the console owns
 * there is no boundary to stay under and the frame IS the viewport, so a frame that stopped one
 * row short would be a row of the terminal nobody drew. Renamed rather than re-numbered because
 * every case that used the old reading as a MEANS has to be looked at rather than quietly
 * agreeing with a new constant.
 *
 * The message names both numbers, because a red here is a page a row out and the count alone
 * says nothing about which way.
 *
 * ONE INSTRUMENT AND SEVERAL FILES, which is why it is here rather than beside the cases about
 * the foot: two spellings of "at the foot" is the shape this bench pays for.
 */
export function fillsTheScreen(screen: Screen, rows: number, what: string): void {
  const last = lastDrawnRow(screen);
  expect(rows - 1 - last, `${what}: the input is ${rows - 1 - last} rows off the foot`).toBe(0);
}

/**
 * THE GAP: how many rows with nothing on them sit immediately above the input area.
 *
 * IT IS WHAT THE PLACEMENT IS, read off a screen. The page is the flow, then as many rows with
 * nothing on them as it takes for the area to end on the last row the layout leaves
 * (`src/repl/page.ts`, `theGap`) — so the leftover is a RUN of empty rows, and its length is the
 * number the product answered with. A page that was not placed at all has a run of nothing.
 *
 * IT IS FOUND BY WALKING UP FROM THE ROW BEING TYPED, past everything that is drawn, to the
 * first thing that is not: the rows of the area above the input, and then the run.
 *
 * ⚠️ THE WALK USED TO HAVE A THIRD LEG, and it was *whatever of the flow has been said since the
 * page was placed — because what the session says lands UNDER the leftover, so the run does not
 * have to touch the area to be the one*. That was true while the rows were lines of the flow:
 * they were appended when the page was placed, so a line said afterwards landed below them. The
 * leftover is part of the region the layout redraws now (`src/repl/page.ts`), so it is always the
 * last thing above the area and a line the session says lands ABOVE it — measured, in the case
 * that lands one and finds the run one row SHORTER rather than one row higher
 * (`tests/the-gap-goes-under-the-box.test.ts`). The walk is unchanged and the leg is simply never
 * taken: what it stepped over cannot be there.
 *
 * ⚠️ IT IS NOT THE PLACEMENT WITH A LIST OPEN, and the reason is the area's rather than this
 * instrument's: the palette has a row with nothing on it OVER it, which belongs to the region
 * the layout redraws (`src/repl/area.ts`, `ABOVE_THE_PALETTE`) — so the walk stops there and
 * answers about the list instead. Every caller that measures a placement measures it with the
 * list shut.
 */
export function theGapOn(screen: Screen, prompt: string): number {
  const drawn = screen.rows.map((row) => row.trim().length > 0);
  let at = promptRow(screen, prompt);
  while (at > 0 && drawn[at] === true) at -= 1;
  let gap = 0;
  while (at >= 0 && drawn[at] === false) {
    gap += 1;
    at -= 1;
  }
  return gap;
}

/**
 * WHERE A LINE IS AGAINST THE EMPTINESS — the one reading of *has the page PLACED this line?*
 *
 * THE TWO PLACES THE SAME TEXT CAN BE, and telling them apart is the whole of it. What the
 * caller is typing is drawn in the region the layout redraws, at the FOOT of the page; a line
 * the page has landed is the last row of the FLOW, above the emptiness (`src/repl/page.ts`). So
 * the text of a row being typed and the text of the same row once it has landed are the same
 * bytes in two different places, and *the line is on the screen* does not say which.
 *
 * ⚠️ AND A STEP THAT WAITED FOR THE TEXT WAS WAITING FOR THE WRONG ONE OF THEM. Abandoning a row
 * redraws the frame FIRST and lands the line on the turn after it, so a step that ended on the
 * frame it caused ended before the page had placed anything — and the case then read a screen
 * with the line still in the input area, which is a red that says *36 is not less than 10* and
 * mentions nothing about a race. Measured: red in about half of the whole-suite runs under load,
 * green eighteen times out of eighteen on its own. It is the amarra this bench already carries —
 * a step waits for what it CAUSED — and the cause here is the landing rather than the frame.
 *
 * SO THE STEP AND THE ASSERTION ASK THIS ONE FUNCTION. Two readings of *where the line is* is how
 * a step comes to approve the very screen the assertion refuses, which is exactly what happened
 * (`tests/the-gap-goes-under-the-box.test.ts`, *lands what the session says INTO the emptiness*).
 */
export interface TheLineAndTheEmptiness {
  /** The first row the line is on, and −1 when it is nowhere on the screen. */
  readonly landedOn: number;
  /** The first row of the screen with nothing on it. */
  readonly emptyFrom: number;
  /**
   * WHETHER THE PAGE HAS PLACED IT: the line is on the screen, and it is ABOVE the emptiness.
   *
   * A line in the input area is below it, at the foot; a line the flow has taken is above it, at
   * the end of the page. There is no third place for it to be.
   */
  readonly placed: boolean;
}

/** {@link TheLineAndTheEmptiness}, read off one screen. */
export function theLineAndTheEmptiness(screen: Screen, line: string): TheLineAndTheEmptiness {
  const landedOn = screen.rows.findIndex((row) => row.includes(line));
  const emptyFrom = screen.rows.findIndex((row) => row.trim().length === 0);
  return { landedOn, emptyFrom, placed: landedOn >= 0 && landedOn < emptyFrom };
}

/** One buffer of a terminal: its cells, and where the cursor is on it. */
interface Buffer {
  cells: string[][];
  row: number;
  column: number;
}

/**
 * A TERMINAL'S TWO BUFFERS, and which of them is showing.
 *
 * THE SCROLLBACK BELONGS TO ONE OF THEM. A row pushed off the top of the caller's own buffer
 * goes into their history; a row pushed off the top of the alternate one is gone, because the
 * alternate buffer has no history and that is the whole reason a full-screen program uses it.
 * Modelling one list for both would answer the same thing for a page that destroyed the
 * caller's history and a page that never touched it.
 */
interface Grid {
  /** The caller's own buffer — the one a shell writes on. */
  readonly primary: Buffer;
  /** The alternate one, which is cleared on the way in and thrown away on the way out. */
  readonly alternate: Buffer;
  /** Whether the alternate buffer is the one showing. */
  showing: boolean;
  /**
   * Every row that has been pushed off the top OF THE PRIMARY BUFFER, oldest first.
   * See {@link Screen.above}.
   */
  readonly carried: string[];
  /** Where the cursor was saved when the alternate screen was entered. */
  saved: { readonly row: number; readonly column: number } | undefined;
}

/** The buffer that is showing — what every sequence below acts on. */
function onScreen(grid: Grid): Buffer {
  return grid.showing ? grid.alternate : grid.primary;
}

/**
 * THE PRIVATE MODES THIS MODEL DELIBERATELY DOES NOTHING ABOUT, and the reason it is safe to
 * do nothing about each.
 *
 * ⚠️ EVERY PRIVATE SEQUENCE USED TO BE SKIPPED, on the grounds that *a mode changes nothing on
 * the page*. That was true of the modes the console wrote then and it is false of the one it
 * writes now: `?1049` SWITCHES THE BUFFER, which is the largest thing anything can do to a
 * page. A model that shrugged at it would replay the session's whole page onto the caller's own
 * buffer and answer *the caller's history is gone* about a session that never touched it.
 *
 * So the skipping is a NAMED list, exactly like the one for the sequences that only change how
 * a glyph looks, and everything outside it is accused:
 *
 *   - `25` — the caret, shown or hidden. It is not a cell.
 *   - `2026` — synchronized output, which asks the terminal to hold the last painted state
 *     while a frame arrives. It changes WHEN a page is shown and never what is on it.
 *   - `1000`, `1006` — mouse reporting and its encoding, which are about what the terminal
 *     SENDS and not about what it draws (`src/repl/pointing.ts`).
 *   - `1004`, `2004`, `1049`-adjacent detection queries and the like are NOT here: nothing on
 *     this surface writes them, and a model that pre-approved them would be approving bytes it
 *     has never seen.
 */
const MODES_THAT_DRAW_NOTHING = new Set([25, 1000, 1006, 2026]);

/**
 * ⛔ THE MODE THAT SWITCHES THE BUFFER — save the cursor, go to the alternate screen and clear
 * it; and on the way back, restore the caller's buffer and the cursor with it.
 *
 * It is the one private mode this model ACTS on, because it is the one that moves a page.
 */
const THE_ALTERNATE_SCREEN = 1049;

/** A buffer with nothing on it, `columns` by `rows`. */
function blankBuffer(columns: number, rows: number): Buffer {
  return {
    cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => BLANK)),
    row: 0,
    column: 0,
  };
}

/** Replays `bytes` onto a screen `columns` by `rows`, and answers with what is on it. */
export function screenOf(bytes: string, columns: number, rows: number): Screen {
  // BEFORE ANYTHING IS REPLAYED, because a stream that lost a character is a stream whose
  // every row after it is out — there is nothing to be learnt from the page it produces.
  theStreamWasDecodedWhole(bytes, columns);
  const grid: Grid = {
    primary: blankBuffer(columns, rows),
    alternate: blankBuffer(columns, rows),
    showing: false,
    carried: [],
    saved: undefined,
  };
  for (let at = 0; at < bytes.length; at++) {
    const byte = bytes[at] as string;
    if (byte === ESC) {
      at = sequence(bytes, at, grid, columns, rows);
      continue;
    }
    printable(byte, grid, columns, rows);
  }
  const showing = onScreen(grid);
  const lines = showing.cells.map((cells) => cells.join(''));
  const readable = (list: readonly string[]): string =>
    list.map((line) => line.replace(/ +$/, '')).join('\n');
  // THE ONE PLACE THE SIZE IS CHECKED, and it is here rather than at the three dozen call
  // sites for the reason the A3 amarra is about: a rule read in two places is a rule that
  // comes apart, and a case added tomorrow would be a site that forgot. Everything that
  // reads a screen of this surface reads it from here.
  theWidthIsTheOneItWasDrawnAt(lines, columns);
  return {
    rows: lines,
    text: readable(lines),
    alternate: grid.showing,
    beneath: readable(grid.primary.cells.map((cells) => cells.join(''))),
    above: grid.carried,
    aboveText: readable(grid.carried),
    cursor: { row: showing.row, column: showing.column },
  };
}

/** Puts one ordinary byte on the buffer that is showing. */
function printable(byte: string, grid: Grid, columns: number, rows: number): void {
  const buffer = onScreen(grid);
  if (byte === '\n') {
    // The output side of a terminal turns a newline into a new row at column one, which
    // is what `onlcr` does and what every pty this is read from has on.
    buffer.column = 0;
    down(grid, rows);
    return;
  }
  if (byte === '\r') {
    buffer.column = 0;
    return;
  }
  // Every other control byte is skipped rather than drawn: a tab, a bell or a backspace
  // that became a character would be text on the page that nobody wrote.
  if (byte < ' ') return;
  if (buffer.column >= columns) {
    buffer.column = 0;
    down(grid, rows);
  }
  (buffer.cells[buffer.row] as string[])[buffer.column] = byte;
  buffer.column += 1;
}

/**
 * One row further down, scrolling the whole page when there is no further down.
 *
 * ⛔ AND WHERE THE ROW THAT LEAVES GOES IS THE WHOLE POINT OF THERE BEING TWO BUFFERS. Off the
 * top of the caller's own it goes into their scrollback, which is the one thing that ever feeds
 * it ({@link Screen.above}); off the top of the alternate one it is DISCARDED, because the
 * alternate buffer has no history — which is exactly why a program that takes it pollutes
 * nothing, and exactly what a case proving that has to be able to see.
 */
function down(grid: Grid, rows: number): void {
  const buffer = onScreen(grid);
  if (buffer.row + 1 < rows) {
    buffer.row += 1;
    return;
  }
  const left = buffer.cells.shift() as string[];
  if (!grid.showing) grid.carried.push(left.join(''));
  buffer.cells.push(Array.from({ length: left.length }, () => BLANK));
}

/**
 * Acts on the escape sequence starting at `at`, and answers with the index of its last
 * byte.
 *
 * Only the CSI family is understood, which is the only family this product's layout writes.
 *
 * ⚠️ ANYTHING ELSE USED TO BE STEPPED OVER, and the header of this file says what falsified
 * that: a sequence outside CSI is not a sequence that does nothing. `ESC M` scrolls the page
 * backwards, `ESC 7` and `ESC 8` put the cursor somewhere and fetch it back, and `ESC ]`
 * opens a string that runs until its own terminator — stepped over one byte at a time, the
 * TITLE inside it is printed onto the page as text nobody wrote. So it is accused, which is
 * the only answer that cannot be wrong: this model does not have to grow a case for a
 * sequence the product does not write, it has to stop pretending it read one.
 */
function sequence(bytes: string, at: number, grid: Grid, columns: number, rows: number): number {
  if (bytes[at + 1] !== '[') {
    // A lone escape at the very end of the bytes is a slice taken mid-sequence and not a
    // sequence: there is nothing after it to have been misread.
    if (at + 1 >= bytes.length) return bytes.length;
    throw new Error(
      `this screen was replayed from bytes holding an escape outside the CSI family — ` +
        `ESC ${JSON.stringify(bytes.slice(at + 1, at + 8))} — which this model does not ` +
        `understand and therefore did not perform. What is above is a page the terminal ` +
        `never showed, so anything read off it is about the model rather than the product.`,
    );
  }
  let end = at + 2;
  while (end < bytes.length && /[0-9;?]/.test(bytes[end] as string)) end += 1;
  const final = bytes[end];
  if (final === undefined) return bytes.length;
  const body = bytes.slice(at + 2, end);
  if (body.startsWith('?')) {
    privateMode(body.slice(1), final, grid, columns, rows);
    return end;
  }
  const numbers = body.split(';').map((part) => (part === '' ? undefined : Number(part)));
  const first = numbers[0] ?? 1;
  const buffer = onScreen(grid);
  switch (final) {
    case 'A':
      buffer.row = Math.max(0, buffer.row - first);
      break;
    case 'B':
      buffer.row = Math.min(rows - 1, buffer.row + first);
      break;
    case 'C':
      buffer.column = Math.min(columns - 1, buffer.column + first);
      break;
    case 'D':
      buffer.column = Math.max(0, buffer.column - first);
      break;
    case 'G':
      buffer.column = Math.min(columns - 1, Math.max(0, first - 1));
      break;
    case 'H':
    case 'f':
      buffer.row = Math.min(rows - 1, Math.max(0, first - 1));
      buffer.column = Math.min(columns - 1, Math.max(0, (numbers[1] ?? 1) - 1));
      break;
    case 'J':
      eraseDisplay(numbers[0] ?? 0, grid, columns, rows);
      break;
    case 'K':
      eraseRow(numbers[0] ?? 0, grid, columns);
      break;
    default:
      // NOT A DEFAULT THAT DOES NOTHING. Every final above moves something or erases
      // something, and so do the ones that are not here — `S` and `T` scroll, `L` and `M`
      // open and close rows, `r` sets the region a scroll happens in. A model that shrugged
      // at them would answer with a page that is right everywhere except by a row, which is
      // the one kind of wrong nothing on the screen shows.
      if (!CHANGES_ONLY_HOW_IT_LOOKS.includes(final)) {
        throw new Error(
          `this screen was replayed from bytes holding ESC[${body}${final}, which this model ` +
            `does not act on. It is not one of the sequences that only change how a glyph ` +
            `LOOKS (${CHANGES_ONLY_HOW_IT_LOOKS}), so the page above is one the terminal ` +
            `never showed and anything read off it is about the model rather than the ` +
            `product. Give it a case here, or say here why it moves nothing.`,
        );
      }
      break;
  }
  return end;
}

/**
 * A PRIVATE MODE SWITCHED ON OR OFF — the buffer swap acted on, the named ones ignored, and
 * anything else ACCUSED.
 *
 * The accusation is the half that matters. A mode this model has never seen might move a page,
 * and a model that shrugged would answer with a screen the terminal never showed — so an
 * unknown one is a red that says which mode and why, rather than a count somewhere further
 * down that is quietly one out.
 */
function privateMode(body: string, final: string, grid: Grid, columns: number, rows: number): void {
  for (const part of body.split(';')) {
    const mode = Number(part);
    if (MODES_THAT_DRAW_NOTHING.has(mode)) continue;
    if (mode === THE_ALTERNATE_SCREEN) {
      theAlternateScreen(final === 'h', grid, columns, rows);
      continue;
    }
    throw new Error(
      `this screen was replayed from bytes holding ESC[?${part}${final}, which is a private ` +
        `mode this model neither acts on nor has a reason to ignore. A mode can move a whole ` +
        `page — the buffer swap is one — so the page above may be one the terminal never ` +
        `showed. Give it a case here, or name it in MODES_THAT_DRAW_NOTHING with the reason ` +
        `it draws nothing.`,
    );
  }
}

/**
 * ⛔ INTO THE ALTERNATE SCREEN AND BACK OUT — what `?1049` means, in the words of the
 * specification: *save the cursor, then switch to the alternate screen buffer, CLEARING IT
 * FIRST*; and on the way out, switch back and restore the cursor.
 *
 * BOTH HALVES ARE LOAD-BEARING FOR THIS SURFACE. Clearing on the way in is why the session's
 * page opens on nothing of the caller's without erasing anything; leaving the caller's buffer
 * untouched is why what they had is still there when the session goes. A model that switched
 * without clearing would show a page with the caller's output under it and a case would call
 * that a defect of the product.
 */
function theAlternateScreen(entering: boolean, grid: Grid, columns: number, rows: number): void {
  if (entering) {
    if (grid.showing) return;
    const from = grid.primary;
    grid.saved = { row: from.row, column: from.column };
    grid.alternate.cells = blankBuffer(columns, rows).cells;
    grid.alternate.row = 0;
    grid.alternate.column = 0;
    grid.showing = true;
    return;
  }
  if (!grid.showing) return;
  grid.showing = false;
  if (grid.saved !== undefined) {
    grid.primary.row = grid.saved.row;
    grid.primary.column = grid.saved.column;
  }
}

/** Erases part of the page: from the cursor down, up to it, or all of it. */
function eraseDisplay(how: number, grid: Grid, columns: number, rows: number): void {
  // ⛔ 3 IS THE HISTORY ABOVE THE SCREEN, and it EMPTIES it — the caller's own, from WHICHEVER
  // buffer is showing. ⚠️ It used to be modelled as nothing at all, on the grounds that the
  // scrollback is not the screen. It is the one thing this whole surface promises about, and a
  // model that shrugged at this would answer *the caller's history is intact* for the very
  // bytes that destroy it. It is not the alternate buffer's history either: that buffer has
  // none, so what an erase issued from inside it reaches is the primary's
  // (`src/repl/erasing.ts`).
  if (how === 3) {
    grid.carried.length = 0;
    return;
  }
  const buffer = onScreen(grid);
  const blank = (row: number): void => {
    buffer.cells[row] = Array.from({ length: columns }, () => BLANK);
  };
  if (how === 2) {
    for (let row = 0; row < rows; row++) blank(row);
    return;
  }
  if (how === 1) {
    for (let row = 0; row < buffer.row; row++) blank(row);
    eraseRow(1, grid, columns);
    return;
  }
  for (let row = buffer.row + 1; row < rows; row++) blank(row);
  eraseRow(0, grid, columns);
}

/** Erases part of the row the cursor is on: to its end, to its start, or all of it. */
function eraseRow(how: number, grid: Grid, columns: number): void {
  const buffer = onScreen(grid);
  const cells = buffer.cells[buffer.row] as string[];
  const from = how === 0 ? buffer.column : 0;
  const to = how === 1 ? buffer.column + 1 : columns;
  for (let column = from; column < to; column++) cells[column] = BLANK;
}
