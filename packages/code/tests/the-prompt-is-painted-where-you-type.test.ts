/**
 * THE PROMPT IS PAINTED WHERE YOU TYPE — the same `mnema>` under the caller's fingers as in
 * the transcript above them.
 *
 * IT CAME OUT OF THE BYTES. A caller asked for colour on `mnema> verb` and got half of it:
 * the ECHO the roll keeps came out `\e[35mmnema> \e[39m\e[1mstatus\e[22m` and the row being
 * TYPED came out `mnema> ` with no byte of colour in it. The half that was missing is the one
 * that is under their eyes while they write.
 *
 * WHAT MADE THAT LOOK NECESSARY was a premise written into two docs in as many words — *the
 * caret is an offset in COLUMNS into that row, so escapes a terminal does not print would be
 * arithmetic the console has to do*. It was false of the console's own arithmetic: the column
 * is counted over the prompt and over what was typed (`src/repl/console.ts`, `Shown.column`),
 * which are the values it was handed, and never over the row it composes. So the escapes were
 * never in the sum.
 *
 * WHAT IS REALLY AT RISK IS THE FOLD, and it is what these cases are built around. The row
 * being typed is the one line of this page nobody folds — the TERMINAL breaks it, at the
 * margin — so a renderer that folded it would put a break and a hanging indent inside the row
 * the caret is a column into. It is rendered for no width at all (`src/repl/console.ts`,
 * `renderTyped`), and the two cases long enough to wrap are the proof: same column, same row,
 * at two widths.
 *
 * EVERY NUMBER BELOW WAS MEASURED BEFORE THE CHANGE AND IS ASSERTED AFTER IT. The eight cases
 * of {@link WHERE_THE_FINGERS_ARE} are a baseline taken on this branch with the row still
 * plain, so a case going red is this delivery having moved the caret rather than a number
 * somebody chose.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { echoLine } from '../src/presentation/echo.js';
import { renderPlain } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import {
  anotherFrameSince,
  arrivedUnpainted,
  inPty as drive,
  type Fixture,
  leavesTheSession,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';
import { screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guard that reads the surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/**
 * What a caller types in front of, with the space it ends in — the product's own string
 * (`src/repl/session.ts`, `PROMPT`), which is what a line of this page is composed out of.
 *
 * It is spelled here rather than exported because what these cases are about is the BYTES a
 * caller sees, and a constant imported from the module under test would make the assertion
 * agree with the product by construction. The trimmed form is what a page carries, since the
 * layout writes the row and the padding after it.
 */
const PROMPT = 'mnema> ';
/** The prompt as a page shows it: what a row of the screen holds, with the space trimmed. */
const ON_THE_PAGE = PROMPT.trimEnd();

/**
 * HOW MUCH OF A TYPED ROW A STEP WAITS FOR: forty characters, which is short enough to be one
 * run on the wire at every width these cases use.
 *
 * The two longest rows are broken by the LAYOUT at the margin, so the whole of what was typed is
 * never one run for those two — and a step that waited for it would wait for ever.
 */
const A_RUN_THAT_FITS = 40;

/** One arrow to the left, which moves the caret into the middle of what was typed. */
const LEFT = `${ESC}[D`;

/** What the caller sends to have their row echoed onto the roll. */
const SENDS_THE_LINE = '\r';

/**
 * Ctrl-C, which abandons the row being typed — spelled as an escape rather than typed.
 *
 * IT IS WHAT LETS THE SESSION LEAVE. The key that ends the input only ends it on a row with
 * nothing on it; on a row with something on it the same key deletes forward, which is what
 * every line editor does (`src/repl/editing.ts`). So a case that types a word has to give the
 * row back before it can ask the session to close, and one that does not hangs on the way out
 * — which is how the first draft of this file spent thirty seconds a case.
 */
const CLEARS_THE_LINE = '\u0003';

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` at the shell, in this process, with the output thrown away. */
async function shell(...argv: string[]): Promise<void> {
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(argv, io);
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-typed-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  await shell('init');
  await shell('task', 'the task the input is typed over');

  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

const fixture = (): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
  readonly environment?: NodeJS.ProcessEnv;
}): Promise<Ran> {
  const { environment: env, ...rest } = options;
  return drive(env === undefined ? fixture() : { ...fixture(), environment: env }, rest);
}

// ---------------------------------------------------------------------------
// The accent, read off the wire
// ---------------------------------------------------------------------------

/**
 * WHAT WRAPS THE PROMPT ON THE WIRE, wherever it appears: the escapes immediately before the
 * word and the escapes immediately after the space it ends in.
 *
 * It is read off the STREAM rather than off a screen, and that is the whole question here: a
 * terminal consumes the escapes and shows glyphs, so a page can only say the row is there. What
 * says the row is PAINTED is the bytes that reached the terminal.
 */
function paintAroundThePrompt(bytes: string): readonly string[] {
  // WHAT OPENS THE PROMPT AND WHAT CLOSES IT, and the closer is ONE sequence rather than every
  // sequence that follows: the part after the prompt opens with a weight of its own, so the run
  // of escapes on that side belongs half to the prompt and half to the words. Taking all of them
  // would make the answer depend on what the caller happened to have typed.
  const onePaint = `${ESC}\\[[0-9;]*m`;
  const pattern = new RegExp(`((?:${onePaint})*)${PROMPT}(${onePaint})?`, 'g');
  const found: string[] = [];
  for (const hit of bytes.matchAll(pattern)) found.push(`${hit[1] ?? ''}|${hit[2] ?? ''}`);
  return found;
}

describe('the prompt under the caller’s fingers carries the accent the transcript carries', () => {
  it('paints the row being typed, in the very escapes the echo of it is painted in', async () => {
    // THE TWO PLACES THE SAME STRING APPEARS, on one real terminal: the row being TYPED,
    // before anything has been sent, and the ECHO of it on the roll after it has. They are
    // compared with EACH OTHER rather than against escapes typed here — a case that spelled
    // the accent out would go green on a product that had two of them, as long as the one it
    // spelled was on the page.
    const columns = 100;
    const rows = THE_FLOOR.rows;
    const typed = 'status';
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opensAConsole(ON_THE_PAGE),
        { types: typed, until: arrivedUnpainted(`${PROMPT}${typed}`), what: 'typed a word' },
        {
          types: SENDS_THE_LINE,
          until: arrivedUnpainted(`${PROMPT}${typed}`),
          what: 'sent the line',
        },
        leavesTheSession,
      ],
    });

    // BEFORE THE LINE IS SENT THERE IS NO ECHO AT ALL, which is what makes this slice
    // unambiguously the input area: the roll holds the opening and nothing the caller wrote.
    const beingTyped = ran.bytes.slice(0, ran.at[1] as number);
    const inTheInput = new Set(paintAroundThePrompt(beingTyped));
    expect(inTheInput.size, `the input area spells the prompt ${inTheInput.size} ways`).toBe(1);
    const underTheFingers = [...inTheInput][0] as string;

    // AND IT IS NOT NOTHING, which is the half that keeps the comparison below from passing
    // over two plain rows. The escapes are read off the product rather than typed
    // (`src/presentation/styled.ts` decides what a `prompt` part opens with).
    const painted = renderStyled(echoLine(PROMPT, ''));
    const accent = painted.slice(0, painted.indexOf(ON_THE_PAGE));
    expect(accent, 'the accent is not an escape at all').toContain(ESC);
    expect(underTheFingers, 'the row being typed reached the terminal unpainted').toContain(accent);

    // AND THE ECHO SAYS THE SAME THING. What arrived since the line was sent holds the echo on
    // the roll — and the input row, now empty — so what is compared is the SET of spellings the
    // whole session used, which is one.
    const sinceTheLineWasSent = ran.bytes.slice(ran.at[1] as number, ran.at[2] as number);
    const onTheRoll = new Set(paintAroundThePrompt(sinceTheLineWasSent));
    expect([...onTheRoll], 'the echo and the row being typed are painted differently').toEqual([
      underTheFingers,
    ]);

    // AND BOTH ROWS ARE ON THE PAGE, which is what says the comparison was between two things
    // rather than one thing twice: the words are above the row they were typed on.
    const screen = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    const rowsWithThePrompt = screen.rows
      .map((row, at) => (row.includes(ON_THE_PAGE) ? at : -1))
      .filter((at) => at >= 0);
    expect(rowsWithThePrompt.length, 'the echo did not land above the input').toBe(2);
    const [echoed, input] = rowsWithThePrompt as [number, number];
    expect((screen.rows[echoed] as string).includes(typed), screen.text).toBe(true);
    expect((screen.rows[input] as string).trimEnd(), screen.text).toBe(ON_THE_PAGE);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The caret lands where the fingers are
// ---------------------------------------------------------------------------

/** What the pty is driven to, and what the screen has to answer with. */
interface WhereTheCaretGoes {
  /** What the case is called, in the report and in the run. */
  readonly name: string;
  /** What is typed on the row. */
  readonly text: string;
  /** What is pressed after it — arrows, which move the caret without changing the row. */
  readonly after: readonly string[];
  /** How wide the terminal is. */
  readonly columns: number;
  /**
   * WHICH COLUMN THE CARET IS IN, measured on this branch before the row was painted.
   *
   * A function of the width rather than a number, because the two cases that FOLD are pinned to
   * the last column of whatever screen they are on — the terminal put the caret there, not this
   * product's arithmetic.
   */
  readonly column: (columns: number) => number;
  /** How many rows under the one the prompt is on. Measured, like the column. */
  readonly row: number;
  /**
   * WHETHER THE COLUMN IS THE ONE THE FINGERS ASK FOR — the characters to the left of the caret,
   * counted.
   *
   * False for the two rows the TERMINAL folded, where the column the fingers ask for is off the
   * screen altogether.
   */
  readonly theFingersColumn: boolean;
  /**
   * WHETHER THE CARET IS ON THE ROW THE PROMPT IS ON, which is where a row that fits puts it.
   *
   * False for the two folded rows, which are two rows of the screen — and false after an arrow,
   * which is a divergence this delivery neither causes nor closes (see the header of
   * {@link WHERE_THE_FINGERS_ARE}).
   */
  readonly theFingersRow: boolean;
}

/**
 * THE CASES, AND EVERY NUMBER IN THEM WAS MEASURED BEFORE THE ROW WAS PAINTED.
 *
 * TWO OF THEM ARE THE ONES THIS DELIVERY EXISTS NOT TO BREAK. A row long enough to wrap is
 * folded by the TERMINAL, and where it breaks is a function of what the terminal counts — so a
 * renderer that folded the row, or a column counted over the painted string, moves those two and
 * nothing else on this list.
 *
 * AND TWO OF THEM CARRY A DIVERGENCE THAT WAS ALREADY THERE, pinned at the number it has rather
 * than at the number it should have. Both are declared rather than closed: either one is a
 * decision about the caret's arithmetic, and a case asserting the answer nobody chose would be
 * red about a decision that was never taken.
 *
 *   - `cafe` WITH A COMBINING ACUTE is five code points and four columns, and the column is
 *     counted in code points (`src/repl/console.ts`) — so on a terminal the caret sits one column
 *     right of the accent. The instrument counts the same way the product does, so this case PINS
 *     the number and does not rule on the divergence.
 *   - AN ARROW MOVES THE CARET UP A ROW. A key that changes nothing but where the caret is
 *     produces a frame identical to the one already on the screen, and the caret ends up one row
 *     higher for each such key: measured at −1 for one arrow and −3 for three. It is the same
 *     before and after this delivery, byte for byte.
 */
const WHERE_THE_FINGERS_ARE: readonly WhereTheCaretGoes[] = [
  {
    name: 'nothing typed',
    text: '',
    after: [],
    columns: 100,
    column: () => 7,
    row: 0,
    theFingersColumn: true,
    theFingersRow: true,
  },
  {
    name: 'one word',
    text: 'status',
    after: [],
    columns: 100,
    column: () => 13,
    row: 0,
    theFingersColumn: true,
    theFingersRow: true,
  },
  {
    name: 'the caret one step back',
    text: 'status',
    after: [LEFT],
    columns: 100,
    column: () => 12,
    row: -1,
    theFingersColumn: true,
    theFingersRow: false,
  },
  {
    name: 'the caret in the middle of the word',
    text: 'status',
    after: [LEFT, LEFT, LEFT],
    columns: 100,
    column: () => 10,
    row: -3,
    theFingersColumn: true,
    theFingersRow: false,
  },
  {
    name: 'a character outside the basic plane',
    text: 'a\u{1d11e}b',
    after: [],
    columns: 100,
    column: () => 10,
    row: 0,
    theFingersColumn: true,
    theFingersRow: true,
  },
  {
    name: 'an accent, precomposed',
    text: 'café',
    after: [],
    columns: 100,
    column: () => 11,
    row: 0,
    theFingersColumn: true,
    theFingersRow: true,
  },
  {
    name: 'an accent, decomposed',
    text: 'café',
    after: [],
    columns: 100,
    column: () => 12,
    row: 0,
    theFingersColumn: true,
    theFingersRow: true,
  },
  {
    name: 'a row too long for the screen',
    text: 'x'.repeat(120),
    after: [],
    columns: 100,
    column: (columns) => columns - 1,
    row: 1,
    theFingersColumn: false,
    theFingersRow: false,
  },
  {
    name: 'a row too long for a wider screen',
    text: 'y'.repeat(140),
    after: [],
    columns: 120,
    column: (columns) => columns - 1,
    row: 1,
    theFingersColumn: false,
    theFingersRow: false,
  },
];

/** Where the fingers are, in characters: the prompt and what is left of the caret. */
function theFingersAt(one: WhereTheCaretGoes): number {
  return [...`${PROMPT}${one.text}`].length - one.after.length;
}

describe('the caret lands where the caller’s fingers are', () => {
  for (const one of WHERE_THE_FINGERS_ARE) {
    it(`${one.name}, at ${one.columns} columns`, async () => {
      const rows = THE_FLOOR.rows;
      const steps: Step[] = [opensAConsole(ON_THE_PAGE)];
      if (one.text.length > 0) {
        // WHAT THIS STEP PUT ON THE PAGE, with the paint taken out and cut short of the margin:
        // a predicate over the whole stream is answered by the frame that arrived BEFORE the key
        // (`support/pty.ts`), and the two longest rows are broken by the layout at the width, so
        // the whole of what was typed is not one run on the wire.
        steps.push({
          types: one.text,
          until: arrivedUnpainted(`${PROMPT}${one.text.slice(0, A_RUN_THAT_FITS)}`),
          what: 'typed',
        });
      }
      for (const key of one.after) {
        // AN ARROW REWRITES NO ROW, so what says the step happened is the frame it caused
        // (`support/pty.ts`, {@link anotherFrameSince}).
        steps.push({ types: key, until: anotherFrameSince(ON_THE_PAGE), what: 'moved the caret' });
      }
      // THE FRAME THE LAST KEY CAUSED is the one that is read; the row is then given back, so
      // that the key which ends the input arrives on a row with nothing on it
      // ({@link CLEARS_THE_LINE}).
      const measured = steps.length - 1;
      steps.push({
        types: CLEARS_THE_LINE,
        until: anotherFrameSince(ON_THE_PAGE),
        what: 'gave the row back',
      });
      steps.push(leavesTheSession);
      const ran = await inPty({ columns: one.columns, rows, steps });

      const screen = screenOf(ran.bytes.slice(0, ran.at[measured] as number), one.columns, rows);
      const promptRow = screen.rows.map((row) => row.includes(ON_THE_PAGE)).lastIndexOf(true);
      expect(promptRow, `no row of the page is being typed on:\n${screen.text}`).toBeGreaterThan(0);
      expect(screen.cursor.row - promptRow, `the caret is on the wrong row:\n${screen.text}`).toBe(
        one.row,
      );
      expect(screen.cursor.column, `the caret is in the wrong column:\n${screen.text}`).toBe(
        one.column(one.columns),
      );

      // AND WHETHER THAT IS WHERE THE FINGERS ARE IS ASSERTED RATHER THAN ASSUMED, in both
      // measurements: a case that only pinned the numbers would go green on a console that had
      // stopped putting the caret where the caller is writing, as long as it did so consistently.
      expect(
        screen.cursor.column === theFingersAt(one),
        `${one.name}: the column disagrees with what the case declares`,
      ).toBe(one.theFingersColumn);
      expect(
        screen.cursor.row === promptRow,
        `${one.name}: the row disagrees with what the case declares`,
      ).toBe(one.theFingersRow);
    }, 240_000);
  }
});

// ---------------------------------------------------------------------------
// NO_COLOR
// ---------------------------------------------------------------------------

describe('a caller who asked for no colour gets the row they always got', () => {
  it('writes the prompt and the words, byte for byte, with no escape between them', async () => {
    // THE BYTES, ON A REAL SESSION WITH THE VARIABLE SET. What is asserted is a RUN on the
    // wire: the prompt followed immediately by what was typed, which is exactly what the
    // console wrote before this delivery and what a recorded transcript would hold.
    const columns = 100;
    const rows = THE_FLOOR.rows;
    const typed = 'status';
    const ran = await inPty({
      columns,
      rows,
      environment: { ...environment, NO_COLOR: '1' },
      steps: [
        opensAConsole(ON_THE_PAGE),
        { types: typed, until: arrivedUnpainted(`${PROMPT}${typed}`), what: 'typed a word' },
        {
          types: CLEARS_THE_LINE,
          until: anotherFrameSince(ON_THE_PAGE),
          what: 'gave the row back',
        },
        leavesTheSession,
      ],
    });
    const beingTyped = ran.bytes.slice(0, ran.at[1] as number);
    expect(beingTyped, 'the row being typed is not one run of bytes').toContain(
      `${PROMPT}${typed}`,
    );

    // AND NOTHING PAINTED SURVIVES ANYWHERE IN THE SESSION, which is the standing rule this row
    // joined rather than an exception to it. The accent is read off the product.
    const painted = renderStyled(echoLine(PROMPT, ''));
    const accent = painted.slice(0, painted.indexOf(ON_THE_PAGE));
    expect(ran.bytes.includes(accent), 'the accent survived NO_COLOR').toBe(false);

    // AND THE RULE ITSELF SAYS SO, over the values a row being typed can hold: the plain
    // rendering of the line the input area is composed of IS the prompt followed by what was
    // typed. The two parts take no separator (`src/presentation/plain.ts`, `PRECEDED_BY`) and
    // the prompt carries its own trailing space, so there is no byte here to lose.
    for (const value of ['', 'status', '   ', 'a paste\nwith a break in it', typed]) {
      expect(renderPlain(echoLine(PROMPT, value))).toBe(`${PROMPT}${value}`);
    }
  }, 240_000);
});

// ---------------------------------------------------------------------------
// A1: the sites, found by the discriminant
// ---------------------------------------------------------------------------

/** Every module of this surface that ships, with its comments and strings blanked. */
function sources(): readonly { readonly where: string; readonly code: string }[] {
  return sourceFiles(SRC).map((file) => ({
    where: file.slice(SRC.length + 1),
    code: codeOnly(readFileSync(file, 'utf-8')),
  }));
}

describe('A1: everything that puts the row being typed together, and everything that counts a column over it', () => {
  it('composes the row in one shape and counts the column in one place', () => {
    // THE DISCRIMINANT FOR THE COMPOSITION is the function that makes the line, never a list of
    // files: anything that puts a prompt in front of what was typed asks for one of these.
    const composing = sources().filter((file) => /echoLine\(/.test(file.code));
    expect(composing.map((file) => file.where).sort()).toEqual([
      'presentation/echo.ts',
      'repl/console.ts',
    ]);
    // AND THE CONSOLE ASKS FOR IT TWICE, WHICH IS THE TWO ROWS: the echo that lands on the roll
    // when a line leaves the input, and the row the caller is still writing. A third would be a
    // third place that decides what a prompt and a line look like together.
    const console_ = (
      composing.find((file) => file.where === 'repl/console.ts') as { code: string }
    ).code;
    expect((console_.match(/echoLine\(/g) ?? []).length, 'a third row is composed').toBe(2);

    // AND NOTHING ANYWHERE CONCATENATES THE TWO. This is the site the delivery removed, and it
    // is looked for over the whole surface rather than in the file it was in.
    const concatenating = sources().filter((file) => /\bprompt\s*\+|\+\s*prompt\b/.test(file.code));
    expect(
      concatenating.map((file) => file.where),
      'a prompt is glued to a line somewhere',
    ).toEqual([]);

    // THE DISCRIMINANT FOR THE ARITHMETIC is anything that takes the LENGTH of a prompt: that is
    // what a caret's column is made of, and it is what a second opinion about the row would have
    // to compute. One site, and it is the one that counts the values rather than the row.
    const counting = sources().filter((file) => /\bprompt\b[^\n]*\.length/.test(file.code));
    expect(counting.map((file) => file.where)).toEqual(['repl/console.ts']);
    const sums = console_.match(/\bprompt\b[^\n]*\.length[^\n]*/g) ?? [];
    expect(sums.length, 'the column is worked out in more than one place').toBe(1);
    // AND IT IS COUNTED OVER THE VALUES AND NOT OVER THE ROW, which is the property that lets
    // the row be painted: `present` is the composed string, and a column that summed it would
    // count escapes as columns.
    expect(sums[0] as string, 'the caret is counted over the composed row').not.toContain(
      'present',
    );
  });
});
