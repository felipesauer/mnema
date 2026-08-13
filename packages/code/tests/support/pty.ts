/**
 * A REAL PSEUDO-TERMINAL, DRIVEN — because an interactive surface does not prove itself
 * in process.
 *
 * `support/console.ts` gives a pair of streams a console will treat as a device, and that
 * is the right instrument for the LOOP: what a key does, what lands on the page, whether
 * the terminal was given back. It is the wrong one for a SCREEN. How wide a rule runs, at
 * which height an arrangement gives way, where the caret was left and whether the layout
 * library reached for the sequence this product refuses to write are all questions about
 * a device with a window size and a line discipline, and only a device has one.
 *
 * SO THIS SPAWNS THE BUILT BINARY UNDER `script`, which is the portable way to hand a
 * program a terminal it did not inherit, and it RESIZES that terminal from outside with
 * `stty` — the way a caller drags the corner of a window. What comes back is every byte
 * the device received, and a mark at the end of each step, so a case can replay the bytes
 * up to one moment onto a screen (`support/screen.ts`) and ask what a reader was looking
 * at.
 *
 * IT IS ONE FILE BECAUSE IT IS ONE INSTRUMENT. Two deliveries needed it and the second
 * copied the first, which is how two ideas of "wait until the session settled" come to
 * exist and how one of them quietly stops waiting. Everything about a particular fixture
 * — where the project is, what the binary is called, what environment it runs in —
 * arrives as an argument, so nothing here knows about any one case.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { decodedWhole } from './arriving.js';
import { ENDS_THE_INPUT } from './console.js';

/**
 * Where a runner leaves the DEVICE'S OWN answer about how big it is.
 *
 * A file rather than a line printed into the terminal, and that is the whole reason it is
 * one: what a runner echoes is on the caller's page, and one of the cases driven from here
 * is about exactly what is on the caller's page before a session opens
 * (`tests/a-page-that-opens-clean.test.ts`). An instrument that changed the fixture to
 * measure it would be measuring something else.
 */
const WHAT_THE_DEVICE_SAID = 'size';

/**
 * THE LINES A RUNNER BEGINS WITH: the size the case asked for, and what the device became.
 *
 * THE SIZE WAS ASKED FOR AND NEVER CHECKED, in four separate runners, and a case has no
 * other way of knowing. Everything downstream is arithmetic ABOUT the size — which drawing
 * of the name fits, whether the input area keeps its rules, how many rows the page spends —
 * so a device that is not the size the case asked for makes every one of those numbers
 * wrong, and each of them fails as an off-by-one that mentions no size at all. Two cases of
 * this surface have been red intermittently for three deliveries with exactly that shape.
 *
 * `stty` is asked rather than trusted: the size is set and then READ BACK, out of the same
 * device, by the same program, one line later.
 *
 * AND IT IS RENAMED INTO PLACE RATHER THAN WRITTEN INTO IT, because the first version of
 * this accused a session that was fine. A redirection CREATES the file and fills it after,
 * so a reader waiting for the file to exist reads an EMPTY one — measured in a run of the
 * whole suite, once in ten: *"the terminal the session opened on is undefinedx0"*. A rename
 * within a directory is atomic, so the name appearing at all means the content is there.
 */
export function sizedTo(rows: number, columns: number, here: string): readonly string[] {
  const said = join(here, WHAT_THE_DEVICE_SAID);
  return [
    `stty rows ${rows} cols ${columns}`,
    `stty size > ${said}.part`,
    `mv ${said}.part ${said}`,
  ];
}

/**
 * What `stty size` answers with: the rows and the columns, in that order — and nothing when
 * it is not two numbers.
 *
 * The nothing is the half that matters: a partial read has to be told from an answer, or
 * the instrument accuses a device it never actually asked.
 */
function asSaid(said: string): { readonly rows: number; readonly columns: number } | undefined {
  const [rows, columns] = said.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(rows) || !Number.isInteger(columns)) return undefined;
  return { rows: rows as number, columns: columns as number };
}

/**
 * ACCUSES A DEVICE THAT WAS NOT THE SIZE THE CASE ASKED FOR.
 *
 * It is the half of the seam a screen cannot see. A replay is handed the size the case
 * asked for (`support/screen.ts`), and the page it replays was written by a process that
 * read a size off a device — so the two questions are *did the device become what was
 * asked?* and *was the page drawn at that?*, and they have to be asked separately or a red
 * cannot say which of them went wrong.
 *
 * IT IS THE ONLY WAY THE HEIGHT IS OBSERVABLE AT ALL. A width is on the page, drawn corner
 * to corner; a height is not drawn anywhere, and the only thing that can be asked about it
 * is the device itself.
 */
export async function theDeviceWasTheSizeAskedFor(
  here: string,
  rows: number,
  columns: number,
): Promise<void> {
  // IT IS WAITED FOR RATHER THAN READ, and the wait belongs here rather than at each driver:
  // the runner writes the file before the session starts, so a caller that read it the
  // instant it spawned would be racing the shell — and four drivers racing it four ways is
  // the shape of divergence this whole delivery is about.
  //
  // AND WHAT IS WAITED FOR IS THE ANSWER, NOT THE FILE. Waiting for the name is what made
  // this instrument accuse an innocent session once in ten runs of the suite: the file is
  // there before it has anything in it. It is renamed into place now ({@link sizedTo}) AND
  // the content is what ends the wait — one of those alone is a race that comes back.
  const at = join(here, WHAT_THE_DEVICE_SAID);
  let said: { readonly rows: number; readonly columns: number } | undefined;
  for (let tried = 0; tried < 400 && said === undefined; tried += 1) {
    said = existsSync(at) ? asSaid(readFileSync(at, 'utf-8')) : undefined;
    if (said === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (said === undefined) {
    throw new Error(
      `the runner never said how big its terminal was: it was asked for ${columns}x${rows} and ` +
        `left nothing behind, so the session either never started or never got as far as ` +
        `sizing the device. Nothing read off this run is about a terminal of a known size.`,
    );
  }
  theSizeIsTheOneAskedFor(said, rows, columns, 'the terminal the session opened on');
}

/**
 * Resizes a device the way a caller drags the corner of their window, and READS BACK what
 * it became.
 *
 * The read-back is out of the same device one call later, while the session is certainly
 * still on it — the resize itself would have failed otherwise — so it says what the running
 * process is about to be told, rather than what it was asked to be told.
 *
 * ONE CALL, TWO SIZES — and this is the fact everything a case reads about a resize has to be
 * written against. `stty rows R cols C` sets the height and the width in two separate calls to
 * the device, so a session on the other side of it can be told TWICE, and the size in between
 * is the OLD width at the NEW height. Measured directly, with a program that says every size it
 * is told about, driven exactly as a case drives one:
 *
 *     START 120x40 → 110x30 → **110x64** → 190x64 → 120x40
 *
 * The 110x64 was never asked for by anybody. Whether it is seen at all is a race — the process
 * has to be scheduled between the two calls, which is why what it breaks is red under load and
 * green on a quiet machine — and a page drawn for it is CORRECT, because the terminal really was
 * that shape. A caller dragging the corner of a window produces the same thing.
 *
 * SO THE ORDER IS THE HEIGHT FIRST, AND IT IS CHOSEN. It means the intermediate size is already
 * at the FINAL height, so no frame between the two calls is taller than the screen the session
 * is about to be on — which is what makes *writes no frame taller than the screen it is on*
 * measurable at all (`tests/the-screen-is-ours.test.ts`). Setting the width first would put the
 * old height on the new width and hand that case a forty-row frame to accuse the console with.
 *
 * AND WHAT IT COSTS IS PAID BY THE READER. The intermediate keeps the width it is LEAVING, so
 * the last frame at a width can belong to a size nobody asked for; a case that reads the page at
 * a size searches only as far as the step that asked for it ({@link asFarAs}), and a step that
 * resizes waits for the width it asked for rather than for a frame (`support/screen.ts`,
 * {@link drewAt}).
 */
export function resizedTo(device: string, rows: number, columns: number): void {
  execFileSync('stty', ['-F', device, 'rows', String(rows), 'cols', String(columns)]);
  const said = execFileSync('stty', ['-F', device, 'size'], { encoding: 'utf-8' });
  theSizeIsTheOneAskedFor(
    asSaid(said),
    rows,
    columns,
    `the terminal resized to ${columns}x${rows}`,
  );
}

/** The comparison itself, and the sentence it produces. One reading, two callers. */
function theSizeIsTheOneAskedFor(
  was: { readonly rows: number; readonly columns: number } | undefined,
  rows: number,
  columns: number,
  what: string,
): void {
  if (was === undefined) {
    // NOT AN ACCUSATION. A device that answered with something that is not two numbers was
    // not asked successfully, and saying it is the wrong size would be inventing a reading.
    throw new Error(
      `${what} did not answer with a size at all, so this run is not one where a size is ` +
        `known. Nothing about the product follows from it.`,
    );
  }
  if (was.rows === rows && was.columns === columns) return;
  throw new Error(
    `${what} is ${was.columns}x${was.rows}, and this case asked for ${columns}x${rows}. ` +
      `Everything the session drew was chosen by the size it read off that device, so a page ` +
      `replayed at the size the case asked for is a page measured against a terminal that ` +
      `never existed. The rows and the columns a case then counts are out by whatever the ` +
      `difference re-arranges, and that count is the SYMPTOM rather than the finding.`,
  );
}

/**
 * WHAT THE LAYOUT WRITES WHEN A FRAME IS FINISHED: the end of the synchronized update it
 * wrapped the whole frame in.
 *
 * IT WAS THE CURSOR, SHOWN AGAIN, and a one-row terminal falsified that inside this
 * delivery: measured on a real pty at 100x1 and 60x1, the frame ends `ESC[?25l ESC[?2026l`
 * — the caret is hidden and never shown, because there is nowhere to put it. The end of the
 * synchronized update is written on every path there is, which is what makes it the frame's
 * boundary rather than a symptom of one. Spelled by its code point, like every unusual byte
 * in this repository.
 *
 * EXPORTED BECAUSE A CASE THAT COUNTS WHAT ONE FRAME WROTE HAS TO CUT THE STREAM INTO FRAMES,
 * and where a frame ENDS is this and nothing else. It is the same reading {@link aFrameAfter}
 * makes, handed over rather than spelled a second time: how many rows the library thought it
 * owned is read off the erases the NEXT frame opens with, so a second spelling of the boundary
 * would be a second idea of which bytes belong to which frame
 * (`tests/the-page-follows-the-terminal.test.ts`, `theRegionBefore`).
 */
export const FRAME_IS_DRAWN = '\u001b[?2026l';

/**
 * WHAT THE LAYOUT WRITES WHEN A FRAME BEGINS: the start of the synchronized update it wraps the
 * whole frame in.
 *
 * The sister of {@link FRAME_IS_DRAWN}, and it is exported for the same reason: where a frame
 * BEGINS is not where the chunk before its end begins. Bytes that are nobody's frame land in
 * between — the runner's own echo before the session started, the modes the console asks the
 * terminal for, the transcript on the way out — and a count that started at the previous
 * boundary counts those too.
 */
export const A_FRAME_BEGINS = '\u001b[?2026h';

/**
 * HOW MANY ROWS EACH FRAME OF A STREAM PUTS ON THE PAGE, one number per frame.
 *
 * THE ONE READING OF *how tall is a frame*, and it is one because it is easy to get wrong in a
 * way that accuses the product. Measured wrongly once, inside this delivery: cutting the stream
 * on the frame boundary alone and counting the newlines of each chunk reported a NINE-row frame
 * on an eight-row screen — and the ninth row was `TTY=/dev/pts/0`, the runner's own echo, which
 * is in the first chunk because the first chunk starts at the beginning of the stream and not at
 * the beginning of a frame. A guard that says *the product wrote a frame taller than the screen*
 * when it did not is worse than no guard.
 *
 * SO A FRAME IS FROM ITS OWN BEGINNING TO ITS OWN END ({@link A_FRAME_BEGINS},
 * {@link FRAME_IS_DRAWN}), and a chunk with no beginning in it is not a frame and is not counted.
 *
 * IT IS WHAT SAYS A FRAME NEVER OUTGREW ITS SCREEN, which is the one thing a page made of three
 * regions may not do: a frame one row taller than the terminal scrolls it, and the fixed region
 * at the top goes with the scroll (`tests/the-screen-is-ours.test.ts`).
 */
export function rowsOfTheFrames(bytes: string): readonly number[] {
  const rows: number[] = [];
  for (const chunk of bytes.split(FRAME_IS_DRAWN).slice(0, -1)) {
    const begins = chunk.lastIndexOf(A_FRAME_BEGINS);
    if (begins < 0) continue;
    rows.push(chunk.slice(begins).split('\n').length);
  }
  return rows;
}

/**
 * HOW MANY PAGES A SESSION HAS CARRIED INTO THE SCROLLBACK — the cursor put on the last row of the
 * device BY NUMBER, which is what every row written after it scrolls off the top.
 *
 * ONE READING AND FIVE FILES, and it is here for the reason the header of this file gives: it was
 * written out twice, and this delivery gave three more cases a use for it. Two spellings of *how
 * many pages went up* is how one of them quietly stops counting one of the two things that carry
 * one.
 *
 * THE HEIGHT IS LEFT OPEN because a page is carried at whatever height the device has when it is
 * carried — a page turned after the caller made their window shorter is carried at the NEW height,
 * so a count naming one height reads it as nought.
 *
 * AND THERE ARE TWO THINGS THAT CARRY ONE, which is what this delivery added and what no
 * reading can separate:
 *
 *   - the console TURNS a page, when the drawing this terminal would get is not the one on the
 *     screen (`repl/console.ts`, `followTheTerminal`);
 *   - and the DOOR answers the library, when the library gives up on redrawing part of the screen
 *     and starts the whole page over. What it starts over with carries the erase of the caller's
 *     history inside it, and the answer to that is this product's own way of emptying a page —
 *     which is carrying one into the scrollback (`repl/page.ts`, `theEraseAsAScroll`).
 *
 * They are the same operation, so they are the same bytes; nothing in a stream tells them apart,
 * and that is not a gap but what an honest answer costs. What it buys a case is a reading of the
 * library's own frontier that survives the door: at a fixed height, where no page can be turned, a
 * count above one is the library having given up and the door having answered.
 */
export function carriedPages(bytes: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
  return (bytes.match(/\u001b\[\d+;1H/g) ?? []).length;
}

/**
 * WHETHER A WHOLE FRAME HAS BEEN DRAWN since `prompt` was last written.
 *
 * FIVE FILES WAITED FOR THE PROMPT INSTEAD, and a prompt is written in the MIDDLE of a
 * frame: the rows under it, and the caret's own position, come after. Two of them went red
 * on one delivery for the same reason and neither was about a prompt — the opening grew by
 * a third on a terminal with room for the biggest drawing of the name, so a frame is more
 * writes and there are more places for a read to be cut in half. What was measured: a caret
 * one row below the prompt, and a rule that had not been written yet.
 *
 * IT IS HERE BECAUSE THIS FILE IS THE INSTRUMENT, and the paragraph at the top of it says
 * why in advance: two ideas of "wait until the session settled" is how one of them quietly
 * stops waiting. Two cases drive a pty of their own rather than this one, and they take
 * this function — what a finished frame IS is the rule, and it is written once.
 */
export function aFrameAfter(prompt: string): (bytes: string) => boolean {
  // AND NOTHING AFTER IT. A frame boundary that is not the END of the stream is a frame
  // boundary with another frame already in flight behind it, and a screen replayed from
  // half of one is the defect this exists to stop. Measured: with the boundary alone, the
  // two rules of the input area were on the screen about half the time at a hundred
  // columns — the rows are written after the prompt, in the same frame.
  return (bytes) =>
    bytes.endsWith(FRAME_IS_DRAWN) && bytes.lastIndexOf(prompt) < bytes.lastIndexOf(FRAME_IS_DRAWN);
}

/** The step every session begins with: the console open, and its first frame DRAWN. */
export function opensAConsole(prompt: string): Step {
  return { until: aFrameAfter(prompt), what: 'opened its console' };
}

/**
 * The step every driven session ends with.
 *
 * IT WAITS FOR NOTHING, and that is honest rather than lazy: what it is waiting for is the
 * process to END, which is what the driver waits out after the last step — a predicate over
 * the bytes would be waiting for a frame the session may never draw on its way out.
 */
export const leavesTheSession: Step = { types: ENDS_THE_INPUT, until: () => true, what: 'left' };

/**
 * WHETHER `what` IS IN THE BYTES THAT ARRIVED SINCE THIS STEP BEGAN — rather than anywhere
 * in the stream.
 *
 * FOUR STEPS WAITED FOR SOMETHING THE OPENING ALREADY WRITES, and a predicate over the
 * WHOLE stream is answered by the opening: the panel prints the record's verdict on every
 * page there is, so a step that typed `verify` and waited for *"local integrity verified"*
 * was over before the caller's line had been echoed. Measured: red once in two runs of the
 * suite, green three times out of three on its own, and the case it broke was the one
 * asserting the echo — *"the caller never typed a verb"*, over a screen of blank rows. The
 * fourth waited for a SLASH, which the opening writes three ways over: the project's path,
 * the record's `T1/T2/T4`, and the hint that names that very key.
 *
 * IT IS THE DELIVERY THAT ANCHORED THE PAGE THAT EXPOSED IT, and not what broke it: the blank
 * rows before the opening changed how many bytes arrive before the echo, so a window that had
 * been hiding the flaw stopped hiding it. The predicate was always wrong.
 *
 * THE RULE IS ABOUT THE STEP AND NOT ABOUT THE STRING, which is why it is one function rather
 * than a count written out at each site: *did what I am waiting for arrive because of what
 * this step did?* Waiting for "the second occurrence" answers the same question only as long
 * as somebody keeps the count right, and the right count is different at every site.
 *
 * Pinned on bytes built by hand (`tests/the-opening-fits-the-screen.test.ts`) — a race does
 * not answer a single run.
 */
export function arrivedSince(what: string): (bytes: string, since: number) => boolean {
  return (bytes, since) => bytes.slice(since).includes(what);
}

/**
 * THE SAME QUESTION WITH THE PAINT TAKEN OUT — what a step waits for when what it is waiting
 * for is a line the product COMPOSED.
 *
 * IT IS THE ECHO THAT FORCED IT. What a caller sent is a line with parts now — the prompt in
 * the accent this product is marked by, their own words in a weight of their own
 * (`src/presentation/echo.ts`) — so `mnema> x` is not a run of bytes on the wire any more, and a
 * step waiting for one waits for ever.
 *
 * AND IT IS NOW BOTH ROWS. This said *the row being TYPED is still plain, so a step about the
 * input area goes on asking {@link arrivedSince}; this is for the ones about what LANDED*, and
 * the delivery that painted the prompt where the caller types falsified it: the input row is the
 * same composed line, so a step waiting for `mnema> v` on the wire waits for ever there too. What
 * is left for {@link arrivedSince} is anything that is not a line this product COMPOSED — a
 * keystroke's own glyph, a word inside one part, the prompt on its own.
 *
 * ONLY THE STYLE IS TAKEN OUT, never every escape: what is left is where each glyph goes, which
 * is what makes the answer about the page rather than about the paint.
 */
export function arrivedUnpainted(what: string): (bytes: string, since: number) => boolean {
  return (bytes, since) => bytes.slice(since).replace(PAINT, '').includes(what);
}

/**
 * WHAT A RENDERER PAINTS WITH: every SGR sequence, and nothing else that an escape can be.
 *
 * Built from a code point rather than written with the byte in it, which is what keeps a control
 * character out of a source this repository has to be able to read — and out of the one lint rule
 * that exists to say so.
 */
const PAINT = new RegExp(`${String.fromCodePoint(0x1b)}\\[[0-9;]*m`, 'g');

/**
 * A FRAME THE STEP ITSELF CAUSED, WITH `absent` NOT IN IT — which is how a step waits for
 * something to have GONE.
 *
 * THREE STEPS SPELLED THIS OUT AND ALL THREE WERE TRUE BEFORE ANYTHING HAPPENED. They read
 * `aFrameAfter(prompt)(bytes) && !bytes.slice(since).includes(x)`, and the second half of that is
 * satisfied by an EMPTY slice: at the instant the key is written nothing has arrived, so there is
 * nothing of `x` in it, while the first half is still approving the frame that arrived BEFORE the
 * key. So the step ended before the keystroke had been drawn at all, and the case then read a
 * screen with the thing still on it. Measured in whole-suite runs, under load: *cycle 10: the list
 * was open* at a hundred by thirty, and *the list is still open* on the Escape that shuts it —
 * both green on their own, because on an idle machine the next frame beats the settling wait.
 *
 * SO AN ABSENCE IS WAITED FOR IN TWO PARTS, and the first is a PRESENCE: the row being typed is
 * rewritten by every frame the layout draws, so a frame that arrived since the step began has the
 * prompt in what arrived. Then, and only then, does the absence mean the step is over.
 *
 * It is one function because it is one rule — the same reason {@link arrivedSince} is one — and
 * the three sites that spelled it out are exactly how two ideas of "it has gone" come to exist.
 */
export function aFrameWithout(
  prompt: string,
  absent: string,
): (bytes: string, since: number) => boolean {
  const finished = aFrameAfter(prompt);
  return (bytes, since) => {
    const arrived = bytes.slice(since);
    return finished(bytes) && arrived.includes(prompt) && !arrived.includes(absent);
  };
}

/**
 * A FRAME THE STEP ITSELF CAUSED — the presence half of {@link aFrameWithout}, on its own.
 *
 * IT IS THE SAME RULE AND IT IS WRITTEN ONCE, which is the whole reason it is here: a step that
 * ends on `aFrameAfter` alone is a step that can end on the frame which arrived BEFORE it did
 * anything, and four sites have already been red for exactly that. The row being typed is
 * rewritten by every frame the layout draws, so a frame that arrived since the step began has
 * the prompt in what arrived.
 *
 * IT IS ONLY HONEST FOR A STEP THAT REALLY CHANGES THE FRAME. The layout writes nothing at
 * all for a frame identical to the one on the screen, so a key that moves nothing produces no
 * bytes and this never answers — which is the driver's own wall rather than a failed assertion.
 * Every caller below is a step whose effect on the page is the thing under test.
 */
export function aFrameSince(prompt: string): (bytes: string, since: number) => boolean {
  const finished = aFrameAfter(prompt);
  return (bytes, since) => finished(bytes) && bytes.slice(since).includes(prompt);
}

/**
 * THE SAME RULE FOR A KEY THAT REWRITES NO ROW — a frame the step itself caused, told by the
 * frame rather than by the prompt.
 *
 * THE ARROWS ARE WHY IT EXISTS. A key that moves the caret and changes nothing the frame SAYS
 * is answered by the library with a frame that carries no text at all: measured, one arrow puts
 * forty-five bytes on the wire — a synchronized update holding a relative move and a column —
 * and the prompt is not among them. So {@link aFrameSince} never answers for it, and
 * {@link aFrameAfter} on its own is answered by the frame that arrived BEFORE the key, which is
 * the trap four sites have already been red for.
 *
 * WHAT SAYS THE STEP CAUSED IT is the boundary of a finished frame arriving since the step
 * began, which is the direct form of what the prompt was standing in for: every frame this
 * console draws rewrites the row being typed, so the prompt was a PROXY for *a frame arrived*.
 * It is the same idea and the same settling — {@link aFrameAfter} still says what a finished
 * frame is — so there is no second definition of when the page is settled here.
 */
export function anotherFrameSince(prompt: string): (bytes: string, since: number) => boolean {
  const finished = aFrameAfter(prompt);
  return (bytes, since) => finished(bytes) && bytes.slice(since).includes(FRAME_IS_DRAWN);
}

/** One thing to do in the session, and what says it is done. */
export interface Step {
  /** What the caller types, if anything. */
  readonly types?: string;
  /**
   * WHAT HAPPENS OUTSIDE THE SESSION, before the step is waited out — another process
   * writing to the record while the console is up.
   *
   * It is a step of its own kind rather than a variant of typing, and the difference is
   * the whole point of the cases that use it: a console that refuses every verb which
   * writes cannot be made to produce an occurrence from the keyboard, so the only way to
   * prove it shows one is for somebody ELSE to append.
   */
  readonly does?: () => void | Promise<void>;
  /** The size their window becomes first, if it changes. */
  readonly resize?: { readonly columns: number; readonly rows: number };
  /**
   * What is true of everything received once the step has happened.
   *
   * `since` is how many bytes had arrived when the step BEGAN — before it resized anything,
   * before somebody else appended, and before a key was written. It is what lets a predicate
   * ask about the step's own doing rather than about the whole stream, which is the difference
   * between waiting for an answer and being answered by the opening ({@link arrivedSince}).
   */
  readonly until: (bytes: string, since: number) => boolean;
  /** What the step is, for the message when it never happens. */
  readonly what: string;
}

/**
 * EVERYTHING THE DEVICE HAD RECEIVED BY THE END OF STEP `at` — the stream a case reads when
 * the question is *what did this step leave on the page*.
 *
 * IT IS NOT READING BY INDEX, and the distinction is the whole of why it exists. Reading by
 * index takes the boundary of a step FOR the page, which is what a step does not promise: a
 * resize draws more than one frame and the boundary lands wherever the stream was quiet. This
 * hands the boundary to a locator that still finds the page by a property of the FRAME
 * (`support/screen.ts`, {@link theSettledScreen}), and all it does is leave out what a LATER
 * step caused — which is the only thing a search over the whole stream cannot leave out.
 *
 * WHAT MAKES A LATER STEP'S FRAMES A PROBLEM AT ALL is that a size is set in two calls, so a
 * session passes through a size nobody asked for on the way to the next one, and that size keeps
 * the width it is leaving ({@link resizedTo}). A page located by width alone can therefore be
 * answered by a frame belonging to the step AFTER the one that asked for it.
 */
export function asFarAs(ran: Ran, at: number): string {
  return ran.bytes.slice(0, ran.at[at] as number);
}

/** What a run in a pty produced. */
export interface Ran {
  /** Every byte the device received. */
  readonly bytes: string;
  /** How many bytes had arrived by the end of each step, in order. */
  readonly at: readonly number[];
  /**
   * WHAT THE RUNNER EXITED WITH, and `undefined` when this driver killed it instead.
   *
   * It is the runner's code and therefore the CLI's — `script -e` returns the code of the
   * command it ran — which is what lets a case ask the one thing no byte on the page can
   * answer: whether an invocation reported a failure. The `undefined` is the honest half:
   * every session that is left rather than ended is killed here after its last step, and a
   * number invented for it would be a code nobody produced.
   */
  readonly code: number | undefined;
}

/** Where a session is opened, and what it is opened with. */
export interface Fixture {
  /** The built CLI — the same file the `mnema` bin points at. */
  readonly cli: string;
  /** The verb that opens a session. */
  readonly verb: string;
  /** The project the session is opened inside. */
  readonly project: string;
  /** A directory this run may write its runner script into. */
  readonly scratch: string;
  /** The environment the binary runs in. */
  readonly environment: NodeJS.ProcessEnv;
}

/** Waits until `ready` answers true, or gives up — a poll, never a fixed sleep. */
export async function waitFor(ready: () => boolean, what: string, tries = 1200): Promise<void> {
  for (let tried = 0; tried < tries; tried++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the session never ${what}`);
}

/** How long the stream has to stop growing before it counts as quiet, in milliseconds. */
const QUIET = 40;

/** How many quiet periods to give a stream that keeps arriving before giving up on it. */
const AT_MOST = 200;

/** Waits until the stream has stopped growing for one quiet period. */
async function settles(bytes: () => string): Promise<void> {
  for (let tried = 0; tried < AT_MOST; tried += 1) {
    const was = bytes().length;
    await new Promise((resolve) => setTimeout(resolve, QUIET));
    if (bytes().length === was) return;
  }
}

/**
 * WHERE A STEP ENDS IN THE STREAM: how many bytes had arrived at the instant the step's own
 * question answered YES.
 *
 * IT WAS TWO READINGS OF ONE RULE, and they diverged in silence. The question was asked
 * at one instant — *has the step happened?* — and the length was taken at ANOTHER, after a
 * pause that only watched the stream stop growing. Between the two, the next frame arrives;
 * the pause does not ask the question again, so under load a write that stalls mid-frame for
 * longer than the pause ends the step at a point the question would have REFUSED. Measured:
 * a screen replayed from that point had the input area's two rules missing, red in the whole
 * suite and green on its own — the shape of defect the A3 amarra is about.
 *
 * SO THE ANSWER AND THE LENGTH COME OUT OF THE SAME STRING. The question is asked again once
 * the stream is quiet, and while it says no this goes on waiting; when it says yes, the
 * length taken is the length of the very string it just said yes about, with no `await`
 * between the two — so nothing can arrive in between.
 *
 * A stream that has ENDED is answered wherever it is: the process is gone, there is nothing
 * more coming, and a case reading a dead session's screen has its own assertions to fail.
 */
export async function endOf(
  step: Step,
  bytes: () => string,
  over: () => boolean,
  // HOW MUCH HAD ARRIVED WHEN THE STEP BEGAN, so a predicate can ask about the step's own
  // doing ({@link Step.until}). Defaulted, because a caller with one step and nothing before
  // it is asking about the whole stream and there is nothing to subtract.
  since = 0,
): Promise<number> {
  for (let round = 0; round < AT_MOST; round += 1) {
    await waitFor(() => step.until(bytes(), since) || over(), step.what);
    await settles(bytes);
    const now = bytes();
    if (step.until(now, since) || over()) return now.length;
  }
  throw new Error(`the session never settled anywhere it ${step.what}`);
}

/** Runs the session on a pseudo-terminal of a given size, resizing it between steps. */
export async function inPty(
  fixture: Fixture,
  options: {
    readonly columns: number;
    readonly rows: number;
    readonly steps: readonly Step[];
  },
): Promise<Ran> {
  const here = mkdtempSync(join(fixture.scratch, 'pty-'));
  const runner = join(here, 'run.sh');
  const named = 'TTY=';
  writeFileSync(
    runner,
    [
      `cd ${fixture.project}`,
      ...sizedTo(options.rows, options.columns, here),
      `echo "${named}$(tty)"`,
      `node ${fixture.cli} ${fixture.verb}`,
      '',
    ].join('\n'),
  );

  const arriving = decodedWhole();
  let over = false;
  // WHAT IT EXITED WITH, kept only when the process ended of its own accord: `script -e`
  // answers with the code of the command it ran, and a run this driver killed answers with a
  // signal instead — which is not an exit code and is not reported as one.
  let code: number | undefined;
  const child = spawn('script', ['-qec', `sh ${runner}`, '/dev/null'], {
    cwd: fixture.project,
    env: fixture.environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  arriving.from(child.stdout);
  arriving.from(child.stderr);
  const ended = new Promise<void>((resolve) => {
    child.on('close', (was) => {
      over = true;
      code = was ?? undefined;
      resolve();
    });
  });

  const at: number[] = [];
  try {
    await waitFor(() => arriving.text().includes(named) || over, 'said which terminal it had');
    const device = /TTY=(\S+)/.exec(arriving.text())?.[1];
    expect(device, 'the runner never named the terminal').toBeDefined();
    // BEFORE ANY STEP, because everything after this is read against a size — and a size
    // nobody checked is the premise every count below rests on.
    await theDeviceWasTheSizeAskedFor(here, options.rows, options.columns);
    for (const step of options.steps) {
      // WHERE THE STEP BEGINS, taken before anything it does — the resize, the other process,
      // and the keystroke are all the step's own doing, so a predicate that wants to know what
      // this step produced has to be able to cut in front of all three.
      const since = arriving.text().length;
      if (step.resize !== undefined) {
        resizedTo(device as string, step.resize.rows, step.resize.columns);
      }
      // WHAT SOMEBODY ELSE DOES comes before what the caller types, and before the wait,
      // so a step can be "the record moved" with nothing typed at all.
      if (step.does !== undefined) await step.does();
      if (step.types !== undefined) child.stdin.write(step.types);
      // WHERE THE STEP ENDS is the point its own question approved, and it is asked for as
      // one thing rather than waited for here and measured there ({@link endOf} says what
      // that cost).
      at.push(await endOf(step, arriving.text, () => over, since));
    }
    await Promise.race([
      ended,
      new Promise((_, reject) => setTimeout(() => reject(new Error('never came back')), 30_000)),
    ]);
  } finally {
    child.stdin.end();
    child.kill('SIGKILL');
  }
  return { bytes: arriving.text(), at, code };
}
