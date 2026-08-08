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
 * Every path read while the watch is on.
 *
 * An ESM namespace cannot be spied on, so the module is WRAPPED — every other export is
 * the real one, and each of the three doors below passes straight through to it. The three
 * are the doors a chain is read through: a whole file at once, a directory's names, and an
 * `open` for the backward walk that resumes a tail (which then reads by descriptor, so the
 * path is only ever seen here).
 */
const watched = vi.hoisted(() => ({ paths: [] as string[], on: false }));

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  const note = (path: unknown): void => {
    if (watched.on && typeof path === 'string') watched.paths.push(path);
  };
  const through =
    (real: unknown) =>
    (...args: unknown[]): unknown => {
      note(args[0]);
      return (real as (...rest: unknown[]) => unknown)(...args);
    };
  return {
    ...actual,
    readFileSync: through(actual.readFileSync) as typeof actual.readFileSync,
    readdirSync: through(actual.readdirSync) as typeof actual.readdirSync,
    openSync: through(actual.openSync) as typeof actual.openSync,
  };
});

/** Watches what `work` reads, and answers with the paths it touched. */
async function reading(work: () => Promise<void>): Promise<string[]> {
  watched.paths = [];
  watched.on = true;
  try {
    await work();
  } finally {
    watched.on = false;
  }
  return [...watched.paths];
}

/**
 * Which of those paths are THE RECORD.
 *
 * A tail is where every event of a chain lives — the segments, the checkpoints and the
 * proof of the tail's own ownership are all under it — and nothing can be projected,
 * counted or verified without reading one. So this is not a sample of the record: it is
 * the only door to it. Key material sits beside it under `keys/`, and the status line is
 * allowed to read that, which is why the predicate names the tail and not the tree.
 */
const RECORD = `${sep}tails${sep}`;
const ofTheRecord = (paths: readonly string[]): string[] =>
  paths.filter((path) => path.includes(RECORD));

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

/** What a console drew, opened on a terminal `columns` wide and left at the end. */
async function openedAt(columns: number, typed: readonly string[] = []): Promise<string> {
  const terminal = fakeTerminal({ columns });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    render: renderPlain,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes(OPENED), 'opened');
  for (const line of typed) {
    const grown = terminal.bytes().length;
    terminal.type(`${line}\r`);
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
const CARRIES_THE_PAGE = `${ESC}[${TALL};1H`;

/**
 * What a console drew, opened at `columns` and then resized to each of `widths` in turn.
 *
 * The page follows the terminal's WIDTH, so each of these is a recomposition of the
 * opening and a page turned — which is exactly the thing that must not cost a read. Each
 * width is waited out until the page has really been turned for it.
 */
async function resizedThrough(columns: number, widths: readonly number[]): Promise<string> {
  const terminal = fakeTerminal({ columns, rows: TALL });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    render: renderPlain,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes(OPENED), 'opened');
  for (const width of widths) {
    const turned = times(terminal.bytes(), CARRIES_THE_PAGE);
    terminal.resize(width);
    await until(
      () => times(terminal.bytes(), CARRIES_THE_PAGE) > turned,
      `turned the page at ${width}`,
    );
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
async function readingWhileTyping(typed: string, answered?: string): Promise<string[]> {
  const terminal = fakeTerminal({ columns: 200 });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    render: renderPlain,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes(OPENED), 'opened');
  const grown = terminal.bytes().length;
  watched.paths = [];
  watched.on = true;
  terminal.type(typed);
  await until(() => terminal.bytes().length > grown, 'redrew');
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
  const paths = [...watched.paths];
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
  paths: string[];
  row: string;
}> {
  const terminal = fakeTerminal({ columns: 200 });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    render: renderPlain,
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

  watched.paths = [];
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
  const paths = [...watched.paths];
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
 * five-row one is a rectangle, so its first row is as wide as the drawing. The isometric one
 * is not — its widest rows are in the middle — so a case that measured the first would give
 * way one column early and call it the art's own width.
 */
const widthOf = (form: readonly string[]): number =>
  Math.max(...form.map((row) => [...row].length));

describe('the name is drawn, and how much of it depends on the terminal', () => {
  it('draws the five-row form on a terminal too narrow for the biggest one', () => {
    // ⚠️ THIS CASE SAID *draws the tall form when it fits* AND ASKED A WIDE TERMINAL. What
    // falsified it is a fourth drawing: the widest form is the isometric one now, so the
    // five-row block is what a terminal one column too narrow for THAT gets, and asking two
    // hundred columns for it would be asking for something else entirely. What the case is
    // for is unchanged and is the half no other case holds — the mask really became a
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
  it('writes the banner once and the tips on every frame', async () => {
    const page = await openedAt(200, ['verify', 'skills']);
    // It really was a session that did some work, or the counts below are about nothing.
    expect(page).toContain('local integrity verified');
    // THE DISCRIMINANT, and it is one number against the other: both are lines the
    // session composed, and the only difference between them is where they land.
    for (const row of drawn(200)) expect(times(page, row), row).toBe(1);
    expect(times(page, renderPlain(tips()))).toBeGreaterThan(1);
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
  it('reads the record exactly as much as one verify does, and no more', async () => {
    // THE EXCEPTION, MEASURED. The panel says what the record is, so the opening pays a
    // `verify` — once. What that costs is not asserted here as a duration, which would be
    // a number about this machine; it is asserted as the READS, against the only thing
    // that can say what one verify's worth of them is: one verify.
    const opening = await reading(async () => {
      await openedAt(200);
    });
    const alone = await reading(async () => {
      runVerify({ ...here(), requirement: DEFAULT_REQUIREMENT, global: false });
    });
    expect(ofTheRecord(alone).length).toBeGreaterThan(0);
    expect(ofTheRecord(opening)).toEqual(ofTheRecord(alone));
    // The instrument was pointed at something wider than the record, too: opening a
    // console reads files that are not tails, and a watch that saw nothing at all would
    // satisfy the comparison above by accident.
    expect(opening.length).toBeGreaterThan(ofTheRecord(opening).length);
  }, 120_000);

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
    // now: a caller who narrows their window gets the page again, with the box recomposed
    // for it. Recomposing is not RE-READING — the lines already exist, and what the width
    // decides is which drawing there is room for and how much of the name is drawn. A
    // redraw that asked `verify` again could make the panel say something different
    // halfway through a session, which is the same hazard a clean page was measured
    // against. So: three width changes read exactly what no width change reads.
    let drew = '';
    const thrice = await reading(async () => {
      drew = await resizedThrough(200, [160, 120, 90]);
    });
    const once = await reading(async () => {
      await openedAt(200);
    });
    expect(ofTheRecord(once).length, 'the opening read nothing at all').toBeGreaterThan(0);
    expect(ofTheRecord(thrice)).toEqual(ofTheRecord(once));
    // THE INSTRUMENT FIRST, and it is here because it was WRONG once: three pages really
    // were turned, on top of the one the session opened with. Without this the case passes
    // on a console that never got round to redrawing anything, which is what it did.
    expect(times(drew, CARRIES_THE_PAGE), 'the page was never turned').toBe(1 + 3);
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
