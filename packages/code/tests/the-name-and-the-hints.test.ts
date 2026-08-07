/**
 * THE NAME, THE HINTS, AND WHERE THE SESSION IS STANDING — the three things the opening
 * of a console says that are not answers to a typed line.
 *
 * Each of the three is here for a different reason, and the reasons are what the cases
 * are shaped around:
 *
 *   - THE BANNER IS THE ONE PLACE A WIDTH DECIDES WHAT IS PRINTED. Everything else this
 *     surface writes is as wide as it is and lets the terminal fold it, on purpose: a
 *     column pads and never truncates, because a value cut to fit is a value a reader
 *     cannot check. Art is the exception, and an exception is exactly the thing to pin —
 *     so the three forms are asserted one by one, at the widths that choose them, and the
 *     narrowest is asserted to still say the name.
 *   - THE TIPS ARE PINNED BY WHERE THEY LAND, not by what they say. A hint that has
 *     scrolled off the screen is not a hint, and a banner redrawn on every keystroke would
 *     be a session shouting its own name. The two are the same kind of line and the
 *     opposite decision, so the case that separates them counts: the drawing is written
 *     ONCE and the tips are written on every frame.
 *   - THE STATUS IS PINNED BY WHAT IT DOES NOT DO. `verify` over a real record costs about
 *     a tenth of a second, and a status line that asked the record anything would pay it
 *     before the caller could type. That is an ABSENCE, and an absence needs an instrument
 *     rather than an assertion — so the reads are counted, the record's are asserted to be
 *     none, and the counter is proved to have teeth by a read of the record in the same
 *     session moving it.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { bannerFor } from '../src/presentation/banner.js';
import { renderPlain } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { openSession, tips } from '../src/repl/session.js';
import { REPL_VERB } from '../src/wiring/repl.js';
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
  terminal.type('.exit\r');
  await closed;
  return terminal.bytes();
}

/** How many times `what` occurs in `text`. Overlapping is impossible for these. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/** One form as the bytes a plain renderer writes for it. */
const drawn = (columns: number): string[] => bannerFor(columns).map(renderPlain);

// ---------------------------------------------------------------------------
// The name, and how much of it fits
// ---------------------------------------------------------------------------

describe('the name is drawn, and how much of it depends on the terminal', () => {
  it('draws the tall form when it fits, five rows of one glyph', () => {
    const tall = drawn(200);
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

  it('draws the short form when the tall one does not fit', () => {
    const wide = [...(drawn(200)[0] as string)].length;
    expect(drawn(wide)).toEqual(drawn(200));
    // One character narrower than the tall form is where it gives way, and the threshold
    // is therefore the art's OWN width rather than a number somebody chose.
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

  it('says what the caller can do, and says the words a session answers to', () => {
    const said = renderPlain(tips());
    for (const word of ['.help', '.exit', 'Ctrl-D', 'Ctrl-C', 'Tab']) {
      expect(said).toContain(word);
    }
    // And it is an ASIDE rather than a fact: dim when the renderer paints, and the same
    // words either way, which is the promise every line of this surface makes.
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

describe('the status line does not read the record', () => {
  it('opens a session without touching a single tail', async () => {
    // THE ABSENCE, and it is measured rather than asserted. `verify` over a record costs
    // about a tenth of a second; a bar that asked the record anything would pay that on
    // the way in, and a bar that asked it again on a redraw would turn a console into a
    // replay loop.
    const paths = await reading(async () => {
      await openedAt(200);
    });
    expect(ofTheRecord(paths)).toEqual([]);
    // The instrument was pointed at something: opening a console really does read files,
    // and an empty list of reads would satisfy the line above saying nothing at all.
    expect(paths.length).toBeGreaterThan(0);
  }, 120_000);

  it('and the counter would have seen one, which is what makes the absence a fact', async () => {
    // THE TEETH. The same instrument, the same session, one verb typed at its prompt —
    // and that verb reads the record. Without this case the one above passes on a counter
    // watching the wrong door.
    const paths = await reading(async () => {
      await openedAt(200, ['verify']);
    });
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
