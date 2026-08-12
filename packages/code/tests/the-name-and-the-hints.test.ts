/**
 * THE NAME, THE HINTS, AND WHERE THE SESSION IS STANDING — the three things the opening
 * of a console says that are not answers to a typed line.
 *
 * Each of the three is here for a different reason, and the reasons are what the cases
 * are shaped around:
 *
 *   - THE BANNER IS THE ONE PLACE A WIDTH DECIDES WHAT IS PRINTED. Everything else this
 *     surface writes is as wide as it is and is FOLDED to the screen rather than cut: a
 *     column pads and never truncates, because a value cut to fit is a value a reader
 *     cannot check. ⚠️ This used to say the TERMINAL folded it, on purpose, and
 *     `presentation/folded.ts` falsified the second half of that: the product folds, and
 *     what is on purpose is that it never CUTS. The first half of the sentence is what
 *     this file pins, and it did not move — a width still decides what is printed in
 *     exactly one place, and everywhere else it decides only where a line breaks.
 *     Art is the exception, and an exception is exactly the thing to pin —
 *     so the three forms are asserted one by one, at the widths that choose them, and the
 *     narrowest is asserted to still say the name.
 *   - THE TIPS ARE PINNED BY WHERE THEY LAND, not by what they say. A hint that has
 *     scrolled off the screen is not a hint, and a banner redrawn on every keystroke would
 *     be a session shouting its own name. The two are the same kind of line and the
 *     opposite decision, so the case that separates them counts: the drawing is written
 *     ONCE and the tips are written on every frame.
 *   - THE STATUS IS PINNED BY WHAT IT DOES NOT DO. `verify` over a real record costs about
 *     a tenth of a second, and anything that asked the record on every redraw would pay it
 *     on every keystroke. That is an ABSENCE, and an absence needs an instrument rather
 *     than an assertion — so the reads are counted, and the counter is proved to have teeth
 *     by a read of the record in the same window moving it.
 *
 * THE INSTRUMENT NOW TELLS THE OPENING FROM A FRAME, and that is a change of shape rather
 * than a loosening. It used to say the session opened WITHOUT TOUCHING A SINGLE TAIL, and
 * what falsified it is the opening panel: a console for auditing a record now says, before
 * the caller types anything, whether that record is intact, which costs one `verify` and is
 * a decision taken with the number in hand (`repl/session.ts`, `theRecord`). So the
 * absence was split in two, and the half with teeth is untouched:
 *
 *   - THE OPENING may read the record, and reads it EXACTLY ONCE — asserted against what
 *     one `runVerify` reads over the same project, path for path, so a second call or a
 *     read per tree is a different list.
 *   - A FRAME may not read it at all. The watch is switched on AFTER the session is open,
 *     so what it sees is only what typing causes, and typing a verb in the same window is
 *     what proves it would have seen one.
 *
 * ⚠️ AND THE INSTRUMENT NOW TELLS A READ FROM A QUESTION, which is a sharpening rather than
 * a loosening, and it is what following the record required. A session ASKS, ten times a
 * second, whether the chain has grown — one `readdir` per tail and one `stat` on that
 * tail's last segment, and nothing opened (`chain/freshness.ts`). Counting that as a read
 * would have made "a frame reads nothing" false about a console that opens no file at all,
 * and the two are different questions of the filesystem: a LISTING says how far a chain
 * reaches, and only a READ can say what is in it. So the doors are split — `readFileSync`
 * and `openSync` are reads, `readdirSync` is a listing — and the promise with teeth is
 * asserted over the reads:
 *
 *   - THE PROBE opens nothing, however long a session watches, and the listings GROW with
 *     the time it watched, which is what says the probe was running at all.
 *   - THE OPENING pays one verify's worth of reads, PLUS one line per tail: the follower
 *     resumes from where each tail stands, off the end of the file, so it knows what is
 *     already there and what is new (`repl/following.ts`).
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runVerify } from '../src/commands/verify.js';
import { bannerFor } from '../src/presentation/banner.js';
import { renderPlain } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { openSession, tips } from '../src/repl/session.js';
import { CLEAR, LEAVE, PREFIX, SESSION_WORDS } from '../src/session-words.js';
import { here } from '../src/wiring/context.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { DEFAULT_REQUIREMENT } from '../src/wiring/verify.js';
import { ESC, fakeTerminal, hooksNothing, until } from './support/console.js';

/** `packages/code/src`, for the guards that read the surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The glyph the tall form is drawn with, named the way the module names it.
 *
 * Spelled as an escape, like every other unusual byte in this repository's sources: a
 * character a reader cannot tell from another one is a character an edit destroys without
 * anybody seeing it happen.
 */
const INK = '\u2588';

/** Faint: what the renderer writes for the role an aside takes. */
const DIM = `${ESC}[2m`;

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';

/** What the caller types in front of — the one thing on every page, at every width. */
const PROMPT = 'mnema>';

/**
 * Ctrl-C, which abandons the row being typed.
 *
 * Spelled as an escape, like every other unusual byte in this repository's sources: a
 * control character typed into a source file is invisible in review and survives an edit
 * made around it.
 */
const CLEARS_THE_LINE = '\u0003';

/** Tab, likewise — the key that finishes a word, and here a record. */
const COMPLETES = '\u0009';

/**
 * An id, as one appears on a page: five groups of hex, found in the bytes.
 *
 * THE INSTRUMENT IS THIS FILE'S OWN, deliberately. The product has a recognizer of its
 * own and the session fills its memory with it; a case that borrowed that to find the id
 * it then expects the session to have found would agree with it by construction.
 */
const ID_ON_THE_PAGE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// ---------------------------------------------------------------------------
// The instrument: every path this process reads, while it is switched on
// ---------------------------------------------------------------------------

/**
 * WHAT THIS PROCESS ASKED OF THE FILESYSTEM: which door, and what path.
 *
 * The door is half the fact and it used to be thrown away. A chain is REACHED through
 * three calls — a whole file at once, a directory's names, and an `open` for the backward
 * walk that resumes a tail (which then reads by descriptor, so the path is only ever seen
 * here) — but they do not answer the same question. Two of them open a file and can say
 * what is IN the record; the third can only say how far it reaches, which is what a
 * freshness probe asks and all it is allowed to know.
 */
type Door = 'read' | 'list';
interface Touched {
  readonly door: Door;
  readonly path: string;
}

/**
 * Everything touched while the watch is on.
 *
 * An ESM namespace cannot be spied on, so the module is WRAPPED — every other export is
 * the real one, and each of the three doors below passes straight through to it.
 */
const watched = vi.hoisted(() => ({ touched: [] as { door: string; path: string }[], on: false }));

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  const through =
    (real: unknown, door: string) =>
    (...args: unknown[]): unknown => {
      if (watched.on && typeof args[0] === 'string') watched.touched.push({ door, path: args[0] });
      return (real as (...rest: unknown[]) => unknown)(...args);
    };
  return {
    ...actual,
    readFileSync: through(actual.readFileSync, 'read') as typeof actual.readFileSync,
    readdirSync: through(actual.readdirSync, 'list') as typeof actual.readdirSync,
    openSync: through(actual.openSync, 'read') as typeof actual.openSync,
  };
});

/** Watches what `work` touches, and answers with it. */
async function reading(work: () => Promise<void>): Promise<Touched[]> {
  watched.touched = [];
  watched.on = true;
  try {
    await work();
  } finally {
    watched.on = false;
  }
  return [...watched.touched] as Touched[];
}

/**
 * Which of those are THE RECORD.
 *
 * A tail is where every event of a chain lives — the segments, the checkpoints and the
 * proof of the tail's own ownership are all under it — and nothing can be projected,
 * counted or verified without reading one. So this is not a sample of the record: it is
 * the only door to it. Key material sits beside it under `keys/`, and the status line is
 * allowed to read that, which is why the predicate names the tail and not the tree.
 */
const RECORD = `${sep}tails${sep}`;

/** Every path of the record that was OPENED — what it took to know what is in it. */
const ofTheRecord = (touched: readonly Touched[]): string[] =>
  touched.filter((one) => one.door === 'read' && one.path.includes(RECORD)).map((one) => one.path);

/**
 * WHAT SAYS WHICH IDENTITY THIS INSTALLATION SPEAKS AS — the anchor a tree recorded for a
 * key of this machine.
 *
 * It is not the record and the predicate above deliberately does not cover it: it sits
 * beside a tail under `keys/`, and the status line is allowed to read it, which is the
 * whole reason {@link RECORD} names the tail rather than the tree. It is counted on its
 * own because the value read out of it is now read TWICE — the panel is drawn with it,
 * and a verb that requires the asker's identity is given it (`repl/asking.ts`) — and
 * "twice read, once resolved" is exactly the kind of promise that decays into a small
 * file opened on every line.
 */
const IDENTITY = /\.anchor$/;

/** Every anchor this process OPENED — what it took to know who this installation is. */
const ofTheIdentity = (touched: readonly Touched[]): string[] =>
  touched.filter((one) => one.door === 'read' && IDENTITY.test(one.path)).map((one) => one.path);

/**
 * Every path of the record that was merely LISTED — the probe's whole question.
 *
 * It is counted rather than banned, and the difference is the design: a listing cannot say
 * what an event is, so a session that only ever lists has read nothing. What it CAN say is
 * that the probe ran, which is what keeps the absence above from being an absence of
 * anything happening.
 */
const listedInTheRecord = (touched: readonly Touched[]): string[] =>
  touched.filter((one) => one.door === 'list' && one.path.includes(RECORD)).map((one) => one.path);

/** Which tail a path of the record belongs to. */
function tailOf(path: string): string {
  const at = path.indexOf(RECORD) + RECORD.length;
  return path.slice(0, at) + (path.slice(at).split(sep)[0] ?? '');
}

/**
 * What is in `these` and not in `those` — as a MULTISET, so a path read twice by one and
 * once by the other counts once here.
 */
function beyond(these: readonly string[], those: readonly string[]): string[] {
  const left = [...those];
  const extra: string[] = [];
  for (const path of these) {
    const at = left.indexOf(path);
    if (at === -1) extra.push(path);
    else left.splice(at, 1);
  }
  return extra;
}

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` at the shell, in this process, with the output thrown away. */
async function shell(...argv: string[]): Promise<void> {
  await run(argv, { out: () => undefined, err: () => undefined, fail: () => undefined });
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-banner-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  await shell('init');
  await shell('task', 'the task the console is opened over');
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * What a console drew, opened on a terminal `columns` wide and left at the end.
 *
 * `watching` is how long it SITS there before leaving, in milliseconds, and it is the one
 * argument that is about time rather than about what a caller did: a session that follows
 * the record asks it a question on a clock, so how many questions a run pays for is a
 * function of how long it stayed open and of nothing else.
 */
async function openedAt(
  columns: number,
  typed: readonly string[] = [],
  watching = 0,
): Promise<string> {
  const terminal = fakeTerminal({ columns });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    renderingAt: () => renderPlain,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  // ⚠️ IT WAITED FOR THE TITLE, and a terminal too narrow for an arrangement never draws one:
  // the opening's LINES are on the roll, and the middle region shows its tail, so on a narrow
  // screen the title is one scroll up rather than on the page (`repl/panel.ts`, `Opening.above`).
  // The prompt is on every page there is.
  await until(() => terminal.bytes().includes(PROMPT), 'opened');
  for (const line of typed) {
    // ⚠️ THE LINE AND THE RETURN ARE TWO WRITES, and that is forced by what the layout does with
    // a frame it has already drawn: it writes NOTHING for one that is identical, and a word that
    // clears the page leaves exactly the page that was on it before the word was typed. So a
    // whole line submitted in one write produces no bytes at all, and a wait for growth waits
    // for ever. Typing changes the row being typed; the Return changes it back.
    let grown = terminal.bytes().length;
    terminal.type(line);
    await until(() => terminal.bytes().length > grown, `typed ${line}`);
    grown = terminal.bytes().length;
    terminal.type('\r');
    await until(() => terminal.bytes().length > grown, `answered ${line}`);
    // The turn is serialized, so the next line waits for this one — and the wait is on
    // the page having stopped growing rather than on a fixed pause.
    let settled = terminal.bytes().length;
    for (let still = 0; still < 8; still++) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (terminal.bytes().length === settled) break;
      settled = terminal.bytes().length;
      still = 0;
    }
  }
  if (watching > 0) await new Promise((resolve) => setTimeout(resolve, watching));
  terminal.type(`${LEAVE}\r`);
  await closed;
  return terminal.bytes();
}

/**
 * How tall a console this file opens is, and the bytes that carry ITS page away.
 *
 * The second is what says a page was really turned (`repl/page.ts` writes it, and nothing
 * else does), and waiting for it is what makes the helper below honest. ⚠️ Its first
 * draft waited for the stream to GROW, which it does the instant a terminal changes size
 * — the layout library redraws the row being typed on its own — and then went on to the
 * next width before this product had done anything at all. Every resize in that case was
 * a resize nothing happened for, and the case built on it could not go red.
 */
const TALL = 40;
const _CARRIES_THE_PAGE = `${ESC}[${TALL};1H`;

/**
 * What a console drew, opened at `columns` and then resized to each of `widths` in turn.
 *
 * The page follows the terminal's WIDTH, so each of these is a recomposition of the
 * opening and a page turned — which is exactly the thing that must not cost a read. Each
 * width is waited out until the page has really been turned for it.
 *
 * ⚠️ EACH WIDTH HAS TO CHANGE THE DRAWING, and that is what the frame's departure made a
 * requirement. Any two widths used to differ, because the box was drawn corner to corner; nothing
 * is drawn to an edge now, so a width that moves no glyph turns no page (`repl/panel.ts`,
 * `sameOpening`) and a step waiting for one waits forever — measured, at a hundred and sixty.
 */
async function resizedThrough(columns: number, widths: readonly number[]): Promise<string> {
  const terminal = fakeTerminal({ columns, rows: TALL });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    renderingAt: () => renderPlain,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes(OPENED), 'opened');
  for (const width of widths) {
    // ⚠️ IT WAITED FOR A PAGE TO BE TURNED, and there are no pages to turn. A width that
    // changed the arrangement used to carry a screen of the caller's into their scrollback and
    // write the opening over it; the opening is a REGION now, composed for the size the device
    // has at the moment of the drawing (`repl/console.ts`, `theOpening`), so what a resize
    // causes is a frame like any other. So the wait is on the stream having answered at all.
    const grown = terminal.bytes().length;
    terminal.resize(width);
    await until(() => terminal.bytes().length > grown, `drew again at ${width}`);
  }
  terminal.type(`${LEAVE}\r`);
  await closed;
  return terminal.bytes();
}

/**
 * What a console read while the caller TYPED — with the opening already paid for.
 *
 * The watch is switched on only once the session is open, which is the whole point of the
 * helper: the panel's one read happens before a byte is drawn, so everything counted here
 * is caused by a keystroke. `answered` is what the page has to say before the counting
 * stops, so a case that types a verb waits for the verb rather than for a clock.
 */
async function readingWhileTyping(typed: string, answered?: string): Promise<Touched[]> {
  const terminal = fakeTerminal({ columns: 200 });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    renderingAt: () => renderPlain,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes(OPENED), 'opened');
  let grown = terminal.bytes().length;
  watched.touched = [];
  watched.on = true;
  // THE LINE AND THE RETURN ARE TWO WRITES, for the reason {@link openedAt} gives: the layout
  // writes nothing at all for a frame identical to the one on the screen.
  const withoutReturn = typed.replace(/\r$/, '');
  terminal.type(withoutReturn);
  await until(() => terminal.bytes().length > grown, 'took what was typed');
  if (typed !== withoutReturn) {
    grown = terminal.bytes().length;
    terminal.type('\r');
    await until(() => terminal.bytes().length > grown, 'redrew');
  }
  if (answered !== undefined) {
    await until(() => terminal.bytes().includes(answered), `answered with ${answered}`);
  }
  // The page has stopped growing, so the reads counted are all of them rather than the
  // ones that happened to be quick.
  let settled = terminal.bytes().length;
  for (let still = 0; still < 8; still++) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (terminal.bytes().length === settled) break;
    settled = terminal.bytes().length;
    still = 0;
  }
  watched.on = false;
  const paths = [...watched.touched] as Touched[];
  // Whatever was typed is abandoned before the word that leaves is: half a verb still on
  // the row would swallow it, and the session would never come back.
  terminal.type(CLEARS_THE_LINE);
  terminal.type(`${LEAVE}\r`);
  await closed;
  return paths;
}

/**
 * What a console read while the caller COMPLETED a record — with a read already answered.
 *
 * A Tab over an id is the one offer on this surface whose candidates are not in a
 * declaration, so it is the one that could have gone looking. It cannot: what it offers is
 * what the session has already SHOWN, and this is where that stops being a sentence. The
 * search is run and waited out BEFORE the watch is switched on, so what is counted is the
 * Tabs and nothing else — and the completion is waited for, so a run that pressed Tab
 * against an empty memory is not what came back with no reads.
 *
 * It drives a terminal of its own rather than taking {@link readingWhileTyping}'s, because
 * the two halves have to be separated in TIME: everything before the watch is on is the
 * read's, everything after it is the keystroke's.
 */
async function readingWhileCompleting(tabs: number): Promise<{
  paths: Touched[];
  row: string;
}> {
  const terminal = fakeTerminal({ columns: 200 });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    renderingAt: () => renderPlain,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes(OPENED), 'opened');
  // THE READ, PAID FOR OUTSIDE THE WINDOW. `search` reads the record — that is what makes
  // an id appear on the page at all — and the counting starts after it has answered.
  terminal.type('search\r');
  await until(() => ID_ON_THE_PAGE.test(terminal.bytes()), 'answered with a record');
  const found = ID_ON_THE_PAGE.exec(terminal.bytes())?.[0] as string;
  const prefix = found.slice(0, 13);

  watched.touched = [];
  watched.on = true;
  for (let pressed = 0; pressed < tabs; pressed += 1) {
    terminal.type(`show ${prefix}`);
    terminal.type(COMPLETES);
    await until(() => terminal.bytes().includes(`show ${prefix}`), 'took the prefix');
    terminal.type(CLEARS_THE_LINE);
  }
  // Nothing is asked of a clock: the page has stopped growing, so what was counted is
  // everything the keystrokes caused.
  let settled = terminal.bytes().length;
  for (let still = 0; still < 8; still++) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (terminal.bytes().length === settled) break;
    settled = terminal.bytes().length;
    still = 0;
  }
  watched.on = false;
  const paths = [...watched.touched] as Touched[];
  const row = terminal.bytes();
  terminal.type(CLEARS_THE_LINE);
  terminal.type(`${LEAVE}\r`);
  await closed;
  return { paths, row };
}

describe('a Tab over a record reads nothing, however many times it is pressed', () => {
  it('reads exactly what no Tab reads, and really did finish one', async () => {
    // THE HALF WITH TEETH, asked of the one offer that is not in a declaration. What a Tab
    // completes here is an id, and the only other way to know one is to open the record —
    // so this is where "it never reads" would break if it were going to.
    const none = await readingWhileCompleting(0);
    const many = await readingWhileCompleting(4);
    expect(ofTheRecord(many.paths)).toEqual(ofTheRecord(none.paths));
    expect(ofTheRecord(many.paths)).toEqual([]);
    // NOT VACUOUS: the Tabs really finished an id, so the absence is about a completion
    // that happened rather than about a session that ignored four keystrokes.
    const whole = ID_ON_THE_PAGE.exec(many.row)?.[0] as string;
    expect(whole, 'nothing on the page was a record').toBeDefined();
    expect(many.row, 'no Tab ever finished an id').toContain(`show ${whole}`);
    // And the instrument was watching something: the run that pressed no Tab still typed.
    expect(none.row.length).toBeGreaterThan(0);
  }, 180_000);
});

/** How many times `what` occurs in `text`. Overlapping is impossible for these. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/**
 * A PAGE THAT COSTS NOTHING, so nothing but the width can decide which form is drawn.
 *
 * ⚠️ THIS USED TO BE THE HEIGHT ALONE. The banner gave way when the DRAWING was taller than
 * the terminal, so holding the height at {@link TALL} was enough to keep it out of the way.
 * It gives way when the PAGE stops fitting now (`presentation/banner.ts`), and what a page
 * costs is answered by whoever composes one — so the way to hold the other axis still is to
 * answer that a page costs no rows at all, which no console does and every case here needs.
 */
const COSTS_NOTHING = (): number => 0;

/**
 * One form as the bytes a plain renderer writes for it, on a terminal with the HEIGHT for
 * any of them.
 *
 * The banner gives way on either measurement (`presentation/banner.ts`), so a case about
 * the WIDTH has to hold the other one still — a height that chose a form would make every
 * width below answer the same thing. {@link TALL} is the height every console in this file
 * is opened at, and the first case asserts the tall form really is what comes back at it,
 * which is what keeps this from being a height that decides.
 */
const drawn = (columns: number): string[] =>
  bannerFor({ columns, rows: TALL, needs: COSTS_NOTHING }).map(renderPlain);

// ---------------------------------------------------------------------------
// The name, and how much of it fits
// ---------------------------------------------------------------------------

/**
 * How wide a drawing is: its widest row.
 *
 * ⚠️ THE FIRST ROW USED TO STAND IN FOR THIS, and it was true of every form there was: the
 * five-row one is a rectangle, so its first row is as wide as the drawing. The biggest one is
 * not — its widest rows are in the middle — so a case that measured the first would give way
 * one column early and call it the art's own width. It has been true of two different biggest
 * drawings now, the second by a wider margin than the first: forty-four columns on its first
 * row against fifty on its widest.
 */
const widthOf = (form: readonly string[]): number =>
  Math.max(...form.map((row) => [...row].length));

describe('the name is drawn, and how much of it depends on the terminal', () => {
  it('draws the five-row form on a terminal too narrow for the biggest one', () => {
    // ⚠️ THIS CASE SAID *draws the tall form when it fits* AND ASKED A WIDE TERMINAL. What
    // falsified it is a fourth drawing: the widest form is not the five-row block any more, so
    // that block is what a terminal one column too narrow for the biggest one gets, and asking
    // two hundred columns for it would be asking for something else entirely. Which drawing is
    // the biggest has changed twice since — from the isometric one to a drawing of blocks — and
    // nothing here moved, because the width it asks for is the biggest form's OWN. What the
    // case is for is unchanged and is the half no other case holds: the mask really became a
    // drawing of one glyph.
    const tall = drawn(widthOf(drawn(200)) - 1);
    expect(tall).toHaveLength(5);
    // Every row is the same width, made of the ink and spaces and nothing else — the
    // property a mask translated into a glyph either has or has quietly lost.
    expect(new Set(tall.map((row) => [...row].length)).size).toBe(1);
    for (const row of tall) expect(new Set([...row])).toEqual(new Set([INK, ' ']));
    // And it really is a drawing rather than a rectangle: a run of five inked columns is
    // the top of an E, and a row of the same width has gaps in it.
    expect(tall.join('\n')).toContain(INK.repeat(5));
    expect(tall.some((row) => row.includes(`${INK} ${INK}`))).toBe(true);
  });

  it('draws the short form when the five-row one does not fit', () => {
    const tall = drawn(widthOf(drawn(200)) - 1);
    const wide = widthOf(tall);
    expect(drawn(wide)).toEqual(tall);
    // One character narrower than the five-row form is where it gives way, and the
    // threshold is therefore the art's OWN width rather than a number somebody chose.
    const short = drawn(wide - 1);
    expect(short).toEqual(['M N E M A']);
    expect(short).toEqual(drawn(9));
  });

  it('still says the name in a terminal too narrow for anything', () => {
    // The floor, and the one thing that may not be dropped. Every width below the short
    // form gets it, including widths no terminal has.
    for (const columns of [8, 5, 1, 0]) expect(drawn(columns)).toEqual(['mnema']);
    // Said as the promise rather than as the value: whatever the narrowest form is, it
    // names the product.
    expect(drawn(0).join('')).toContain('mnema');
  });

  it('never pads a row at its end, in any form', () => {
    // The layout trims the end of every row it writes, so a form padded on the right
    // would arrive somewhere narrower than this module thinks it is — and the choice
    // between forms is made on that width.
    for (const columns of [200, 29, 20, 9, 4]) {
      for (const row of drawn(columns)) expect(row).toBe(row.replace(/[ \t]+$/, ''));
    }
  });
});

describe('the width the banner is chosen at is the terminal’s own', () => {
  it('draws the tall form on a wide terminal and the letterspaced one on a narrow one', async () => {
    // THE ELO. The forms above are a function of a number; this is the number coming off
    // the device the session was handed, which is the half a pure case cannot see.
    const wide = await openedAt(200);
    expect(wide).toContain(drawn(200)[0] as string);
    const narrow = await openedAt(20);
    expect(narrow).toContain('M N E M A');
    expect(narrow).not.toContain(INK);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// One is kept and one is redrawn, and that is the whole difference
// ---------------------------------------------------------------------------

describe('the drawing stays in the scrollback and the tips stay on the screen', () => {
  it('⚠️ writes the banner on EVERY frame, exactly as it writes the tips', async () => {
    // ⚠️ THIS CASE SAID *writes the banner ONCE and the tips on every frame*, and the whole of
    // this delivery is the inversion of it. The banner was landed like a line, into a region the
    // layout wrote once and never took back, and the tips were redrawn — so *once* against *many*
    // was the discriminant between what is kept and what is redrawn. Both are REGIONS now: the
    // banner is the fixed top of the screen and the tips are the last row of the fixed bottom,
    // and every frame draws all three regions. What that buys is the thing the old shape could
    // not have — the banner is on the screen after ten thousand lines, because it is drawn there
    // rather than left there.
    const page = await openedAt(200, ['verify', 'skills']);
    // It really was a session that did some work, or the counts below are about nothing.
    expect(page).toContain('local integrity verified');
    // ONE NUMBER AGAINST THE OTHER, still — and now they are the SAME number, which is the
    // claim: the drawing of the name is redrawn as often as the row that says what to type.
    const tipped = times(page, renderPlain(tips()));
    expect(tipped, 'the tips were not redrawn').toBeGreaterThan(1);
    for (const row of drawn(200)) expect(times(page, row), row).toBe(tipped);
  }, 120_000);

  it('says what the caller can do, in the weight this surface means by secondary', () => {
    // IT USED TO ASSERT EVERY WORD THE SESSION ANSWERS TO and every keystroke besides —
    // the three words, Ctrl-D, Ctrl-C and Tab, all on one row. WHAT FALSIFIED IT is the
    // width: five clauses came to about a hundred and ten characters, and the terminal
    // folded them into two rows below ninety-seven columns, so the row that exists to be
    // GLANCED at was the tallest thing in the region. The hint says three things now, and
    // what a hint may say is asked where the measurement is
    // (`tests/the-input-has-its-own-place.test.ts`: it fits eighty columns, it has at most
    // three clauses, and every word it quotes is one the session answers to).
    //
    // WHAT SURVIVED WHOLE is the half this case was really holding, and it is about the
    // WEIGHT rather than the words: the row is an aside, so it is dim because the RENDERER
    // made it dim and not because a component decided anything, and stripping the escapes
    // gives back exactly the plain line.
    const said = renderPlain(tips());
    expect(said.length).toBeGreaterThan(0);
    // ⚠️ THIS USED TO SAY IT NAMED A WORD THE SESSION ANSWERS TO, and the hint stopped
    // naming any of them. What falsified it is the palette: the slash opens the list those
    // words are IN, so a hint that pointed at the list and then quoted an item out of it
    // would be spending a clause on what the clause beside it already hands over. The
    // property the line was holding survives whole — the row is an AFFORDANCE rather than a
    // sentence about nothing — and what carries it is the key rather than the word.
    expect(said.includes(PREFIX)).toBe(true);
    // THE ELO, so the affordance is one that answers: every word the session has begins
    // with that key, and there is at least one.
    expect(SESSION_WORDS.length).toBeGreaterThan(0);
    for (const word of SESSION_WORDS) expect(word.startsWith(PREFIX), word).toBe(true);
    expect(renderStyled(tips())).toContain(DIM);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
    expect(renderStyled(tips()).replace(/\u001b\[[0-9;]*m/g, '')).toBe(said);
  });
});

// ---------------------------------------------------------------------------
// Where the session is standing
// ---------------------------------------------------------------------------

describe('the opening says where the session is', () => {
  it('names the project’s directory and the identity, on one line', async () => {
    const page = await openedAt(200);
    expect(page).toContain(project);
    // The identity is the SHORT form, and short here means a PREFIX — which is the whole
    // of what makes it honest: whoever holds the value can see this at the front of it.
    // The whole one is read off the disk by this case, from the file the writer records
    // it in, so the two cannot drift into two ideas of what the identity is.
    const whole = recordedAnchor();
    const short = /mnid:[0-9a-f]+/.exec(page.slice(page.indexOf(project)))?.[0];
    expect(short, 'no identity on the page').toBeDefined();
    expect(whole.startsWith(short as string)).toBe(true);
    expect((short as string).length).toBeLessThan(whole.length);
  }, 120_000);

  it('still says what it refuses, which is the sentence that may not go', async () => {
    // The default-deny sentence is what explains, to somebody who has just opened a
    // prompt, why half of what they know how to type is about to be refused. The banner
    // went in above it and the affordances went out below it; this is the line in between
    // that both of those had to leave alone.
    const page = await openedAt(200);
    expect(page).toContain('verbs that read the record, and refuses the ones that write');
  }, 120_000);
});

/** The anchor this installation recorded for this project, read straight off the disk. */
function recordedAnchor(): string {
  const keys = join(project, '.mnema', 'keys');
  const file = readdirSync(keys).find((name) => name.endsWith('.anchor'));
  expect(file, 'nothing recorded an anchor in this project').toBeDefined();
  return readFileSync(join(keys, file as string), 'utf-8').trim();
}

// ---------------------------------------------------------------------------
// And it does not read the record to say it
// ---------------------------------------------------------------------------

describe('the opening reads the record once, and a redraw never reads it', () => {
  it('reads one verify’s worth, plus the one line per tail a follower resumes from', async () => {
    // THE EXCEPTION, MEASURED. The panel says what the record is, so the opening pays a
    // `verify` — once. What that costs is not asserted here as a duration, which would be
    // a number about this machine; it is asserted as the READS, against the only thing
    // that can say what one verify's worth of them is: one verify.
    //
    // ⚠️ AND IT USED TO BE THE WHOLE OF WHAT THE OPENING PAID. A session follows the record
    // now, and to tell what happens NEXT from what was already there it takes the seq each
    // tail ENDS at — one entry, off the end of the tail, whatever the history weighs
    // (`repl/following.ts`). So the exception has a second half and it has a NUMBER: one
    // line per tail, and the line is one the verify opened too.
    const opening = await reading(async () => {
      await openedAt(200);
    });
    const alone = await reading(async () => {
      runVerify({ ...here(), requirement: DEFAULT_REQUIREMENT, global: false });
    });
    expect(ofTheRecord(alone).length).toBeGreaterThan(0);
    const extra = beyond(ofTheRecord(opening), ofTheRecord(alone));
    // ONE PER TAIL, and how many tails there are is read off what the verify itself
    // touched rather than written down here.
    const tails = new Set(ofTheRecord(alone).map(tailOf));
    expect(extra).toHaveLength(tails.size);
    for (const path of extra) {
      // And each one is a file the verify opened as well: the follower resumes from a
      // segment of the record, not from something beside it.
      expect(ofTheRecord(alone), path).toContain(path);
    }
    // Nothing the verify read went unread by the opening, either — the exception is what
    // the opening pays ON TOP, never something it skipped.
    expect(beyond(ofTheRecord(alone), ofTheRecord(opening))).toEqual([]);
    // The instrument was pointed at something wider than the record, too: opening a
    // console reads files that are not tails, and a watch that saw nothing at all would
    // satisfy the comparison above by accident.
    expect(opening.length).toBeGreaterThan(ofTheRecord(opening).length);
  }, 120_000);

  it('asks whether the record moved, however long it watches, and opens nothing to ask', async () => {
    // THE PROBE, AND THE HALF THIS DELIVERY ADDED. A session follows the record on a clock,
    // so the question is asked ten times a second for as long as a caller leaves the
    // console open. What it may never do is READ to answer it: the question is whether the
    // chain grew, and that is a `readdir` per tail and a `stat`, with nothing opened.
    const briefly = await reading(async () => {
      await openedAt(200);
    });
    const watching = await reading(async () => {
      await openedAt(200, [], 1_500);
    });
    // N QUESTIONS READ EXACTLY WHAT ZERO QUESTIONS READ, which is the whole promise.
    expect(ofTheRecord(watching)).toEqual(ofTheRecord(briefly));
    // NOT VACUOUS: the probe really was running, and it ran MORE in the longer window —
    // without this the case passes on a console that never asked anything at all.
    expect(listedInTheRecord(briefly).length).toBeGreaterThan(0);
    expect(listedInTheRecord(watching).length).toBeGreaterThan(listedInTheRecord(briefly).length);
  }, 180_000);

  it('touches no tail while the caller types, which is the half that may not move', async () => {
    // THE ABSENCE, and it is the promise the bar was built on: a hint under the prompt is
    // redrawn on every keystroke, and a redraw that asked the record anything would turn a
    // console into a replay loop. The watch is switched on with the session already open,
    // so what it sees is what TYPING caused and nothing the opening paid for.
    expect(ofTheRecord(await readingWhileTyping('sear'))).toEqual([]);
  }, 120_000);

  it('reads nothing at all when the caller asks for a clean page, however many times', async () => {
    // THE DECISION, MEASURED. A clean page is the page the session opened with, and the
    // panel on it was paid for with the one read this surface declares. Asking for it
    // again could have been a second `verify` — and worse than costing one, it could have
    // made the panel say something different halfway through a session. So the opening is
    // a VALUE the console keeps, and this is what says so: three clean pages read exactly
    // what no clean page reads.
    const thrice = await reading(async () => {
      await openedAt(200, [CLEAR, CLEAR, CLEAR]);
    });
    const once = await reading(async () => {
      await openedAt(200);
    });
    expect(ofTheRecord(once).length, 'the opening read nothing at all').toBeGreaterThan(0);
    expect(ofTheRecord(thrice)).toEqual(ofTheRecord(once));
    // And nothing at all while the page is being cleared, on the watch that only sees
    // what typing caused.
    expect(ofTheRecord(await readingWhileTyping(`${CLEAR}\r`))).toEqual([]);
  }, 180_000);

  it('reads nothing at all when the caller resizes the terminal, however many times', async () => {
    // THE SAME DECISION, ASKED OF THE OTHER CALLER. The page follows the terminal's width
    // now: a caller who narrows their window past the threshold gets the page again, with the
    // arrangement recomposed for it. Recomposing is not RE-READING — the lines already exist, and what the width
    // decides is which drawing there is room for and how much of the name is drawn. A
    // redraw that asked `verify` again could make the panel say something different
    // halfway through a session, which is the same hazard a clean page was measured
    // against. So: three width changes read exactly what no width change reads.
    let drew = '';
    const thrice = await reading(async () => {
      // THREE WIDTHS THAT EACH CROSS A THRESHOLD: down to where the text has no room beside the
      // mark, back up to where it has, and down to where there is no arrangement at all.
      drew = await resizedThrough(200, [90, 200, 20]);
    });
    const once = await reading(async () => {
      await openedAt(200);
    });
    expect(ofTheRecord(once).length, 'the opening read nothing at all').toBeGreaterThan(0);
    expect(ofTheRecord(thrice)).toEqual(ofTheRecord(once));
    // THE INSTRUMENT FIRST, and it is here because it was WRONG once: without it the case passes
    // on a console that never got round to redrawing anything, which is what it did.
    //
    // ⚠️ IT COUNTED PAGES CARRIED INTO THE SCROLLBACK, and nothing is carried anywhere: a width
    // that changes the arrangement is a frame drawn at the new size (`repl/console.ts`). So the
    // evidence moved INTO the helper, where it is a wait that throws by name: it does not return
    // until the console has answered every one of the widths with bytes
    // ({@link resizedThrough}, *drew again at 90*). What is left to assert here is that the
    // session really drew the widest arrangement at all, so the reads counted are a session's
    // and not a stillbirth's.
    expect(drew, 'the wide drawing never reached the page').toContain(drawn(200)[0] as string);
  }, 180_000);

  it('and the counter would have seen one, which is what makes the absence a fact', async () => {
    // THE TEETH, in the same window as the case above: one verb typed at the prompt, and
    // that verb reads the record. Without this case the absence passes on a counter that
    // was switched off, watching the wrong door, or looking after the fact.
    const paths = await readingWhileTyping('verify\r', 'local integrity verified');
    expect(ofTheRecord(paths).length).toBeGreaterThan(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// And it knows who it is without asking twice
// ---------------------------------------------------------------------------

describe('the session resolves who it is when it opens, and never again', () => {
  it('reads the anchor to open, and none while the caller runs a verb that needs one', async () => {
    // THE COST OF THE ANSWER IS PAID ONCE. What the panel names is also what a verb
    // requiring the asker's identity is handed (`repl/asking.ts`), and the only reason
    // that is affordable is that it is a VALUE the session already has. Resolved per
    // line, it would be a small file opened on every read the caller runs — cheap enough
    // to go unnoticed and a second answer to "who is this machine" either way.
    const opening = await reading(async () => {
      await openedAt(200);
    });
    // NOT VACUOUS: the door really is one this instrument can see, and the opening really
    // goes through it. Without this the absence below is an absence of an instrument.
    expect(ofTheIdentity(opening).length, 'the opening read no identity at all').toBeGreaterThan(0);
    // AND NOTHING WHILE TYPING, in the window that only sees what a keystroke caused —
    // asked of the verb that requires the identity, so the line that is filled in is the
    // line being counted.
    const typing = await readingWhileTyping('status\r', 'where things stand');
    expect(ofTheIdentity(typing)).toEqual([]);
    // The verb really ran, and it really read: without this the emptiness above could be
    // a session that answered nothing at all.
    expect(ofTheRecord(typing).length).toBeGreaterThan(0);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// The art is composed where lines are composed, and nowhere else
// ---------------------------------------------------------------------------

describe('the drawing is a constant of the composer, and the layout only places it', () => {
  it('holds the glyph in one module, and in no module of the session', () => {
    // The limit the whole decision to take a layout library rests on is that no component
    // composes a line (`tests/the-console-on-ink.test.ts`). Art assembled inside one would
    // be the first exception to it, and it would be an exception the scan there cannot
    // see: a drawing is not a sentence, so it carries no space, no template and no
    // addition. This is the half that names the glyph.
    const inSource = (dir: string, file: string): string =>
      readFileSync(join(SRC, dir, file), 'utf-8');
    const modules = (dir: string): string[] =>
      readdirSync(join(SRC, dir)).filter(
        (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
      );
    for (const file of modules('repl')) {
      expect(inSource('repl', file), file).not.toContain(INK);
      expect(inSource('repl', file), file).not.toContain('2588');
    }
    // Not vacuous, in both halves: the session's modules are read, and the glyph really
    // is somewhere — in the one module whose whole subject it is.
    expect(modules('repl').length).toBeGreaterThan(4);
    expect(modules('repl')).toContain('region.ts');
    expect(inSource('presentation', 'banner.ts')).toContain('2588');
  });
});
