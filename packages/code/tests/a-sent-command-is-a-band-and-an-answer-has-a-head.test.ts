/**
 * A SENT COMMAND IS A BAND AND AN ANSWER HAS A HEAD — what the roll of the console looks like once a
 * caller has asked something, and what it never carries.
 *
 * IT REPLACES A GUIDE. Down the margin of every row of the roll there was a purple line, one column
 * wide, and a caller who looked at a screenshot of it asked for the style of the console they
 * already read in: the command they typed on a line of its own with a quiet background, the answer
 * opened by a neutral dot with its other rows two columns in, and under it a faint line saying how
 * long it took. The purple is for the places that say *this is mnema* — the top, the rules, the row
 * being typed — and nothing else.
 *
 * WHAT IS ASSERTED, each a measurement off the bytes or the page rather than a picture:
 *
 *   - THE COMMAND IS A BAND across the whole of the page inside its margin, in greys, in none of
 *     the accent, and the band is laid under every row of a command long enough to fold.
 *   - THE BAND IS READABLE ON A DARK THEME AND ON A LIGHT ONE, which is a property of the pair and
 *     not of the theme: the band and the two foregrounds drawn over it are fixed colours, so their
 *     contrast is a number, and so is how far the band stands from a page of either lightness.
 *   - IT GOES WITH THE COLOUR AND LEAVES THE MARK. `--color never`, `NO_COLOR` and a stream that
 *     takes no colour draw the glyph and the words and nothing behind them, byte for byte what
 *     the plain renderer says of the same line.
 *   - THE ANSWER OPENS WITH A DOT that nothing paints, and every row after it recedes by two columns.
 *   - THE LINE UNDER IT SAYS ONLY WHAT WAS MEASURED, on the clock the session was handed: the verb,
 *     how long, the hour — and there is none under a command that answered with nothing.
 *   - THE THREE GLYPHS ARE ONE COLUMN EACH, by the authority over columns, and no page is broken by
 *     them at any width from eighty to two hundred.
 *
 * AND THE READER OF A GOLDEN OR A RECORDING IS TOLD WHICH PART IS A CLOCK'S: the time and the hour
 * are read the way an id is (`support/a-page-held-to-a-run.ts`).
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { doneLine, sentLine } from '../src/presentation/echo.js';
import { renderPlain } from '../src/presentation/plain.js';
import { widthOfText } from '../src/presentation/width.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { insideAnAnswer, insideTheMargin, THE_INSET } from '../src/repl/inset.js';
import { openSession } from '../src/repl/session.js';
import { firstWordOf, hourWords, tookWords, withoutTheDoneLines } from '../src/repl/turn.js';
import { type Capability, chooseRenderer, rendererAtEachWidth } from '../src/wiring/color.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { asMinted } from './support/a-page-held-to-a-run.js';
import {
  ENDS_THE_INPUT,
  ESC,
  fakeTerminal,
  hooksNothing,
  until,
  withoutLayout,
} from './support/console.js';
import { aFrameSince, inPty, leavesTheSession, opensAConsole, type Step } from './support/pty.js';
import { screenOf, theSettledScreen } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of. */
const PROMPT = 'mnema>';

/** The three glyphs of the style, by code point like every unusual byte in this repository. */
const SENT = '❯';
const ANSWERED = '●';
const DONE = '✻';

/** The accent this product is marked by, as the renderer writes it. */
const ACCENT = `${ESC}[35m`;

/** The band, the mark's grey and the words' grey, as the renderer writes them. */
const BAND = `${ESC}[48;5;238m`;
const BAND_OFF = `${ESC}[49m`;
const THE_MARK = `${ESC}[38;5;246m`;
const THE_WORDS = `${ESC}[38;5;253m`;

/** Every style sequence out of some bytes. */
function plainOf(text: string): string {
  return text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

/** What a terminal that paints, and one that cannot, are asked for. */
const painting = (columns: number): Capability => ({
  when: 'always',
  env: {},
  isTty: true,
  columns,
});

// ---------------------------------------------------------------------------
// The band, as a renderer draws it
// ---------------------------------------------------------------------------

describe('a sent command is a band across the page, in greys and none of the accent', () => {
  it('lays the band from the first column to the last, under mark and words', () => {
    const inside = insideTheMargin(100);
    const row = chooseRenderer(painting(inside))(sentLine('search money'));
    expect(row.startsWith(BAND), 'the row does not begin on the band').toBe(true);
    expect(row.endsWith(BAND_OFF), 'the band is not closed').toBe(true);
    expect(row).toContain(`${THE_MARK}${SENT} `);
    expect(row).toContain(`${THE_WORDS}search money`);
    // THE WHOLE WIDTH INSIDE THE MARGIN, which is what makes it a band rather than a highlight.
    expect(widthOfText(plainOf(row)), 'the band does not run to the margin').toBe(inside);
    // AND THE ACCENT IS NOT ON IT: the purple is the places that say *this is mnema*.
    expect(row, 'the sent command carries the accent').not.toContain(ACCENT);
  });

  it('lays it under every row of a command long enough to fold', () => {
    const inside = insideTheMargin(80);
    const long = `search ${'money '.repeat(30)}`.trim();
    const rows = chooseRenderer(painting(inside))(sentLine(long)).split('\n');
    expect(rows.length, 'the command did not fold').toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.startsWith(BAND) && row.endsWith(BAND_OFF), `a row is off the band: ${row}`).toBe(
        true,
      );
      expect(widthOfText(plainOf(row)), 'a row of the band is not the page wide').toBe(inside);
    }
  });

  it('goes with the colour and leaves the mark: the plain line, byte for byte', () => {
    const inside = insideTheMargin(100);
    const quiet: readonly Capability[] = [
      { when: 'never', env: {}, isTty: true, columns: inside },
      { when: 'auto', env: { NO_COLOR: '1' }, isTty: true, columns: inside },
      { when: 'auto', env: {}, isTty: false, columns: inside },
      { when: 'auto', env: { TERM: 'dumb' }, isTty: true, columns: inside },
    ];
    for (const how of quiet) {
      const row = chooseRenderer(how)(sentLine('search money'));
      expect(row, JSON.stringify(how)).toBe(`${SENT} search money`);
      expect(row, JSON.stringify(how)).toBe(renderPlain(sentLine('search money')));
    }
  });

  it('keeps the same words with and without the paint', () => {
    const inside = insideTheMargin(100);
    const painted = chooseRenderer(painting(inside))(sentLine('verify'));
    expect(plainOf(painted).trimEnd()).toBe(`${SENT} verify`);
  });
});

// ---------------------------------------------------------------------------
// Both themes
// ---------------------------------------------------------------------------

/** The grey a 256-colour index from the grey ramp (232 to 255) is: eight plus ten a step. */
function greyOf(index: number): number {
  return 8 + 10 * (index - 232);
}

/** WCAG relative luminance of a grey, 0 to 255. */
function luminanceOf(grey: number): number {
  const channel = grey / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG contrast of two greys. */
function contrastOf(one: number, other: number): number {
  const [light, dark] = [luminanceOf(one), luminanceOf(other)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

describe('the band reads on a dark theme and on a light one', () => {
  // THE PAIR IS FIXED AT BOTH ENDS, so what a theme decides is only the page around it. These are the
  // greys the renderer writes, read back off its own bytes rather than retyped.
  const row = chooseRenderer(painting(insideTheMargin(100)))(sentLine('verify'));
  const index = (sequence: string): number => Number(/;5;(\d+)m/.exec(sequence)?.[1] ?? Number.NaN);
  const band = greyOf(index(BAND));
  const mark = greyOf(index(THE_MARK));
  const words = greyOf(index(THE_WORDS));

  it('is drawn in the colours the renderer writes', () => {
    expect(row).toContain(BAND);
    expect([band, mark, words]).toEqual([68, 148, 218]);
  });

  it('keeps the words legible against the band, and the mark visible', () => {
    // 4.5 is the floor for text (WCAG AA) and 3 for a glyph that is not the words.
    expect(
      contrastOf(words, band),
      'the words are hard to read on the band',
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrastOf(mark, band), 'the mark is hard to see on the band').toBeGreaterThanOrEqual(3);
  });

  it('stands out from a dark page and from a light one', () => {
    // A page of the darkest and of the lightest a theme draws: pure black and pure white bound
    // every theme between them, and the band must show against both.
    expect(contrastOf(band, 0), 'the band is lost on a dark page').toBeGreaterThanOrEqual(1.5);
    expect(contrastOf(band, 255), 'the band is lost on a light page').toBeGreaterThanOrEqual(1.5);
  });
});

// ---------------------------------------------------------------------------
// The turn, driven in this process on a clock it was handed
// ---------------------------------------------------------------------------

/** A moment, built from local parts so the hour a case expects is spelled and never computed. */
const AT = (hour: number, minute: number, second = 0): number =>
  new Date(2026, 9, 7, hour, minute, second).getTime();

/** What the case types, the clock it hands over, and how the session paints. */
interface Drive {
  readonly typed: readonly string[];
  readonly instants: readonly number[];
  readonly columns?: number;
  readonly capability?: Pick<Capability, 'when' | 'env'>;
}

/**
 * A session driven in THIS process over a pair of streams, and what it said: every byte, and the
 * transcript it hands the caller's own buffer once it has left — the roll, whole, one row to a line.
 *
 * IT IS THE INSTRUMENT FOR THE PAINT AND THE CLOCK, where the pseudo-terminal below is the one for
 * the GEOMETRY: what a case about a hue needs is the escapes around a row, and what a case about a
 * clock needs is a clock it can hand over, which a binary on a device cannot be given.
 */
async function driven(how: Drive): Promise<{ bytes: string; said: readonly string[] }> {
  const columns = how.columns ?? 100;
  const rows = THE_FLOOR.rows;
  const terminal = fakeTerminal({ columns, rows });
  const ticks = [...how.instants];
  const closed = openSession({
    io: { out: () => undefined, err: () => undefined, fail: () => undefined },
    renderingAt: rendererAtEachWidth(() => ({
      when: how.capability?.when ?? 'always',
      env: how.capability?.env ?? {},
      isTty: true,
      columns,
    })),
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
    now: () => ticks.shift() ?? Number.NaN,
  });
  await until(() => terminal.bytes().includes('a session over this project'), 'opened');
  for (const [at, line] of how.typed.entries()) {
    terminal.type(`${line}\r`);
    // THE END OF THIS ANSWER, which is the line under it: asked of the page replayed, because the
    // window is drawn again on every frame and an earlier answer's line is in the bytes many times.
    await until(
      () => screenOf(terminal.bytes(), columns, rows).text.split(DONE).length - 1 > at,
      `answered ${line}`,
    );
  }
  terminal.type(ENDS_THE_INPUT);
  await closed;
  const back = terminal.bytes().lastIndexOf(`${ESC}[?1049l`);
  const said = withoutLayout(terminal.bytes().slice(back)).split('\n');
  return { bytes: terminal.bytes(), said };
}

describe('the line under an answer says what was measured, on the clock the session was handed', () => {
  it('says the verb, how long and the hour', async () => {
    const { said } = await driven({
      typed: ['verify', 'verify', 'verify'],
      // Two seconds and a half; forty-two milliseconds; a minute and a second, across midnight.
      instants: [
        AT(16, 32, 0),
        AT(16, 32, 0) + 2500,
        AT(16, 32, 5),
        AT(16, 32, 5) + 42,
        AT(23, 59, 0),
        AT(23, 59, 0) + 61_000,
      ],
    });
    const under = said.map((row) => plainOf(row).trim()).filter((row) => row.startsWith(DONE));
    expect(under).toEqual([
      `${DONE} verify · 2.5s · done 16:32`,
      `${DONE} verify · 42ms · done 16:32`,
      `${DONE} verify · 1m 01s · done 00:00`,
    ]);
  }, 180_000);

  it('puts no line under a command that answered with nothing', async () => {
    const terminal = fakeTerminal({ columns: 100, rows: THE_FLOOR.rows });
    const closed = openSession({
      io: { out: () => undefined, err: () => undefined, fail: () => undefined },
      renderingAt: () => renderPlain,
      self: REPL_VERB,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: true,
      leaving: hooksNothing,
      now: () => AT(9, 0),
    });
    await until(() => terminal.bytes().includes('a session over this project'), 'opened');
    // AN EMPTY LINE IS SENT AND ANSWERED BY NOTHING: the page shows what was sent, and nothing under.
    terminal.type('\r');
    await until(() => terminal.bytes().includes(SENT), 'sent the empty line');
    await new Promise((resolve) => setTimeout(resolve, 150));
    terminal.type(ENDS_THE_INPUT);
    await closed;
    const bytes = terminal.bytes();
    expect(bytes, 'the empty line was not sent').toContain(SENT);
    expect(bytes, 'an empty line was given a line under it').not.toContain(DONE);
  }, 120_000);

  it('keeps the dot, the indent and the line when there is no colour, and leaves every paint behind', async () => {
    const { said } = await driven({
      typed: ['verify'],
      instants: [AT(10, 0), AT(10, 0) + 5],
      capability: { when: 'auto', env: { NO_COLOR: '1' } },
    });
    // THE LINES THIS PRODUCT COMPOSES go through the rule that answers the variable: the roll the
    // caller keeps has not one style sequence in it, and the sent line is the mark and the words.
    const painted = said.filter((row) => row.includes(`${ESC}[`));
    expect(painted, `NO_COLOR left paint on the roll:\n${painted.join('\n')}`).toEqual([]);
    expect(said).toContain(`${SENT} verify`);
    expect(said.some((row) => row.startsWith(`${ANSWERED} `))).toBe(true);
    expect(said).toContain(`${DONE} verify · 5ms · done 10:00`);
  }, 120_000);

  it('paints the sent line as a band and the answer under a neutral dot when colour is on', async () => {
    const { said } = await driven({
      typed: ['verify'],
      instants: [AT(10, 0), AT(10, 0) + 5],
    });
    const sent = said.find((row) => plainOf(row).includes(`${SENT} verify`)) as string;
    expect(sent, 'the sent line is not on the roll').toBeDefined();
    expect(
      sent.startsWith(BAND) && sent.endsWith(BAND_OFF),
      'the sent line is not on the band',
    ).toBe(true);
    expect(sent, 'the sent line carries the accent').not.toContain(ACCENT);
    const answered = said.find((row) => row.startsWith(`${ANSWERED} `)) as string;
    expect(answered, 'the answer has no unpainted dot').toBeDefined();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The geometry, on a device
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-sent-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  environment = {
    PATH: process.env.PATH ?? '',
    HOME: join(sandbox, 'home'),
    TERM: 'xterm-256color',
  };
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The console, opened on a device of a given size, asked `verify`, and left. */
async function onADevice(columns: number): Promise<string> {
  const rows = THE_FLOOR.rows;
  const asks: Step = {
    types: 'verify\r',
    until: aFrameSince(PROMPT),
    what: 'asked verify',
  };
  const ran = await inPty(
    { cli: CLI, verb: REPL_VERB, project, scratch: sandbox, environment },
    { columns, rows, steps: [opensAConsole(PROMPT), asks, leavesTheSession] },
  );
  return theSettledScreen(ran.bytes, columns, rows, DONE).text;
}

describe('an answer opens with a dot and recedes by two columns, on the page', () => {
  it('sits the sent line at the margin, the dot on the first row and every other row two in', async () => {
    const page = (await onADevice(100)).split('\n').map((row) => row.trimEnd());
    const sent = page.findIndex((row) => row.includes(`${SENT} verify`));
    expect(sent, `the sent line is not on the page:\n${page.join('\n')}`).toBeGreaterThanOrEqual(0);
    const margin = ' '.repeat(THE_INSET);
    expect(page[sent], 'the sent line does not sit at the margin').toBe(`${margin}${SENT} verify`);
    const under = page.slice(sent + 1).findIndex((row) => row.includes(DONE));
    const answer = page.slice(sent + 1, sent + 1 + under);
    expect(answer.length, 'the answer is empty').toBeGreaterThan(0);
    expect(answer[0], 'the answer does not open with the dot').toMatch(
      new RegExp(`^${margin}${ANSWERED} \\S`),
    );
    for (const row of answer.slice(1).filter((one) => one !== '')) {
      expect(row.startsWith(`${margin}  `), `a row of the answer does not recede: ${row}`).toBe(
        true,
      );
    }
    // AND THE LINE UNDER IT IS AT THE MARGIN, under the dot, with the clock read as a clock's.
    expect(asMinted(page[sent + 1 + under] as string)).toBe(
      `${margin}${DONE} verify · <took> · done <hour>`,
    );
  }, 120_000);
});

// ---------------------------------------------------------------------------
// What the line is made of, and what compares without it
// ---------------------------------------------------------------------------

describe('the words of a turn', () => {
  it('words a span at the unit that reads best', () => {
    expect(tookWords(0)).toBe('0ms');
    expect(tookWords(999)).toBe('999ms');
    expect(tookWords(1000)).toBe('1.0s');
    expect(tookWords(2500)).toBe('2.5s');
    expect(tookWords(59_949)).toBe('59.9s');
    expect(tookWords(61_000)).toBe('1m 01s');
    expect(tookWords(3_600_000 + 5000)).toBe('60m 05s');
    // A clock that went backwards is no span at all.
    expect(tookWords(-40)).toBe('0ms');
  });

  it('words the hour on the machine’s own clock, two digits each', () => {
    expect(hourWords(AT(0, 5))).toBe('00:05');
    expect(hourWords(AT(16, 32))).toBe('16:32');
    expect(hourWords(AT(23, 59))).toBe('23:59');
  });

  it('names the verb as the first word of what was typed', () => {
    expect(firstWordOf('  search   money ')).toBe('search');
    expect(firstWordOf('verify')).toBe('verify');
    expect(firstWordOf('')).toBe('');
  });

  it('builds the line out of exactly what it was handed', () => {
    expect(renderPlain(doneLine('search', '22ms', '20:28'))).toBe(
      `${DONE} search · 22ms · done 20:28`,
    );
  });

  it('leaves out of a window the lines under answers, and only those', () => {
    const window = [
      'one',
      `${ESC}[2m${DONE} verify · 1ms · done 10:00${ESC}[22m`,
      'two',
      `${DONE} x`,
    ];
    expect(withoutTheDoneLines(window)).toEqual(['one', 'two']);
    expect(withoutTheDoneLines(['a ✻ b', 'x'])).toEqual(['a ✻ b', 'x']);
  });

  it('is read by a guard of a page or a recording as a clock’s, and only in its own shape', () => {
    expect(asMinted(`${DONE} status · 56ms · done 20:28`)).toBe(
      `${DONE} status · <took> · done <hour>`,
    );
    expect(asMinted(`${DONE} verify · 2.5s · done 04:05`)).toBe(
      `${DONE} verify · <took> · done <hour>`,
    );
    expect(asMinted(`${DONE} verify · 3m 07s · done 13:00`)).toBe(
      `${DONE} verify · <took> · done <hour>`,
    );
    // A span or an hour in the words of a record is the record's.
    expect(asMinted('waited 30s until 12:00')).toBe('waited 30s until 12:00');
  });
});

// ---------------------------------------------------------------------------
// The glyphs, at every width the console draws at
// ---------------------------------------------------------------------------

describe('the three glyphs are one column each and break no page', () => {
  it('measures each of them as one column, by the authority over columns', () => {
    for (const glyph of [SENT, ANSWERED, DONE]) {
      expect(widthOfText(glyph), `U+${glyph.codePointAt(0)?.toString(16)}`).toBe(1);
      expect(widthOfText(`${glyph} `)).toBe(2);
    }
  });

  it('draws the band exactly as wide as the page inside its margin, at every width from 80 to 200', () => {
    for (let columns = 80; columns <= 200; columns++) {
      const inside = insideTheMargin(columns);
      const sent = chooseRenderer(painting(inside))(sentLine('search money'));
      expect(widthOfText(plainOf(sent)), `${columns} columns`).toBe(inside);
      // AND AN ANSWER IS FOLDED TO WHAT THE DOT AND THE INDENT LEAVE, so its widest row — the dot
      // and a space in front of it — is never wider than the page inside the margin.
      const answer = chooseRenderer({ ...painting(insideAnAnswer(columns)), when: 'never' })({
        indent: 0,
        parts: [{ role: 'field', text: 'word '.repeat(60).trim() }],
      });
      for (const row of answer.split('\n')) {
        expect(widthOfText(`${ANSWERED} ${row}`), `${columns} columns`).toBeLessThanOrEqual(inside);
      }
    }
  });

  it('draws a whole page without one row wider than the window, at the narrow end and the wide', async () => {
    for (const columns of [80, 99, 100, 121, 160, 200]) {
      const page = (await onADevice(columns)).split('\n');
      for (const row of page) {
        expect(widthOfText(row.trimEnd()), `${columns} columns: ${row}`).toBeLessThanOrEqual(
          columns,
        );
      }
      expect(
        page.some((row) => row.includes(`${SENT} verify`)),
        `${columns} columns`,
      ).toBe(true);
    }
  }, 300_000);
});
