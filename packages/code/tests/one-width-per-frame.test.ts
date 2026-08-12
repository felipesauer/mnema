/**
 * ONE WIDTH PER FRAME — the fold follows the window, like every other number on the page.
 *
 * IT CAME OUT OF A SCREENSHOT AND A SENTENCE: *the lines explaining the verbs are squeezed,
 * they do not fit the console's screen*. What was on it was a session opened in a small window
 * and then maximised: the rules ran corner to corner of the new terminal, the badge sat on its
 * last column, the arrangement had chosen itself against it — and the REPORT was a column of
 * text down the left, folded to the width the process had opened at. Measured on a real
 * pseudo-terminal at 70×24 maximised to 200×50, before this delivery: eleven continuation rows
 * on a page whose every other edge was two hundred wide.
 *
 * THE CAUSE WAS ONE LINE AND IT WAS RIGHT WHERE IT WAS. `wiring/color.ts` resolves the renderer
 * once per invocation, out of the capability the entry reads, and folds to the width the stream
 * reported — which is exactly right for a verb that prints and exits and cannot be right for a
 * SESSION, because a session outlives the window it opened in. So the rule stayed and grew a
 * door that takes a width, and the console — the one thing on this surface that asks the device
 * how wide the page is — answers it for the frame it is drawing.
 *
 * WHAT IS ASSERTED HERE, and each of them is a MEASUREMENT off a screen rather than a picture:
 *
 *   - THE CASE OF THE DEFECT, both ways round. A session opened narrow and maximised prints its
 *     next report across the whole terminal; one opened wide and narrowed folds the next one to
 *     the width it now has, with the product's own hanging indent and not the terminal's
 *     mid-word break.
 *   - ONE WIDTH PER FRAME, as a property over a whole sequence of sizes rather than at the end
 *     of one: the page is found by the width its RULES were drawn at, and what is asked of it is
 *     that the content folded at that same width. Two widths on one frame is the defect, and it
 *     has to be impossible at every size the caller stops at.
 *   - THE RULE ITSELF, at the unit: the colour is one answer per invocation and the width is
 *     not, and the capability behind both is read once.
 *   - AND NOBODY ELSE ASKS A DEVICE HOW WIDE IT IS. Two files do, for two different questions,
 *     and a third would be a third answer on one page.
 *
 * ⛔ WHAT IS NOT ASSERTED, said out loud so a pass is not read as covering it: a line already on
 * the roll is NOT re-folded when the window changes. It was rendered for the terminal it was
 * printed on, and that is a true record of a page that really was that wide — the same posture
 * the screen model takes about a replay (`support/screen.ts`,
 * `theWidthIsTheOneItWasDrawnAt`). Every case below prints AFTER the resize and reads what it
 * printed.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import { fact } from '../src/presentation/detail.js';
import { foldedAt } from '../src/presentation/folded.js';
import type { Line } from '../src/presentation/line.js';
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { openConsole } from '../src/repl/console.js';
import { verbsOffered } from '../src/repl/gate.js';
import { about, whatItRefuses } from '../src/repl/session.js';
import { ABOUT, CLEAR, LEAVE } from '../src/session-words.js';
import { type Capability, rendererAtEachWidth, rendererFor } from '../src/wiring/color.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { fakeTerminal, hooksNothing, until } from './support/console.js';
import {
  aFrameSince,
  arrivedSince,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';
import { drewAt, everyWidthDrawnOn, type Screen, theSettledScreen } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guard that reads this surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the caller types in front of, as the layout writes it. */
const PROMPT = 'mnema>';

/** A row of the word that lists what the session runs — the heading of its second half. */
const AND_IT_REFUSES = 'And it does not write';

/** How tall every window in this file is. The subject is the WIDTH, so nothing else moves. */
const TALL_ENOUGH = 40;

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** A port that throws everything away, for the calls that are made for their return value. */
const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

/** `mnema <argv>` at the shell, in this process, with the output thrown away. */
async function shell(...argv: string[]): Promise<void> {
  await run(argv, quiet);
}

beforeAll(async () => {
  // A6: a sandbox of this run's own. Nothing here writes into the working tree.
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-width-'));
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
  await shell('task', 'the task the window is resized over');

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

// ---------------------------------------------------------------------------
// What the session prints, and what a fold does to it
// ---------------------------------------------------------------------------

/**
 * EVERY LINE THE SESSION PRINTS FOR THE WORD THAT LISTS WHAT IT RUNS — the product's own,
 * composed off the same registration the session composes them off.
 *
 * These are the widest rows this console ever writes and they are the ones the complaint was
 * about, which is why they are the subject. Read rather than retyped: a description edited
 * tomorrow travels into every case below, and a copy would be a fixture asserting what the
 * page said last month (`repl/session.ts`, `about`).
 */
function theWordsItPrints(): readonly Line[] {
  return about(buildProgram(quiet, [], renderPlain).verbs, REPL_VERB);
}

/**
 * THE ONE LINE THE OPENING ITSELF LANDS — the sentence that says what the session refuses.
 *
 * It is a different subject from the words above and it needs its own case: the opening is
 * composed for a SIZE (`repl/session.ts`, the closure the console calls), so it is the half of
 * the page whose renderer could be right for the report and wrong for the header. How many
 * verbs it names comes from the same function the session counts them with, so this is the
 * product's own line and not a copy of it.
 */
function theLineItOpensWith(): Line {
  const built = buildProgram(quiet, [], renderPlain);
  return whatItRefuses(verbsOffered(built.verbs, REPL_VERB).length)[0] as Line;
}

/** The rows the product's own fold breaks a line into at a given width. */
function foldedInto(line: Line, columns: number): readonly string[] {
  return foldedAt(columns, renderPlain)(line).split('\n');
}

/** A screen's rows with their trailing blanks off — what a reader sees on each. */
function rowsOf(screen: Screen): readonly string[] {
  return screen.rows.map((row) => row.replace(/ +$/, ''));
}

/**
 * HOW MANY ROWS OF A PAGE ARE THE TAIL OF A LINE FOLDED AT `columns` — the measurement the
 * complaint was made of.
 *
 * A continuation is not guessed at: it is what this product's own fold produces for a line this
 * product prints, at a width this case names. So *eleven continuations at seventy on a page two
 * hundred wide* is a count of rows that are on the screen and should not be, and the same
 * function answers nought when they are gone.
 */
function continuationsAt(screen: Screen, columns: number): number {
  const tails = new Set(
    theWordsItPrints().flatMap((line) =>
      foldedInto(line, columns)
        .slice(1)
        .map((row) => row.trimEnd()),
    ),
  );
  return rowsOf(screen).filter((row) => row.length > 0 && tails.has(row)).length;
}

/** Where a run of rows appears whole and in order among a page's rows, or −1. */
function whereTheRowsAre(page: readonly string[], rows: readonly string[]): number {
  const wanted = rows.map((row) => row.trimEnd());
  for (let at = 0; at + wanted.length <= page.length; at += 1) {
    if (wanted.every((row, step) => page[at + step] === row)) return at;
  }
  return -1;
}

/** The widest line the session prints — the one a fold has the most to do to. */
function theWidestLine(): Line {
  return [...theWordsItPrints()].sort((one, other) => widthOf(other) - widthOf(one))[0] as Line;
}

// ---------------------------------------------------------------------------
// Driving a real pseudo-terminal
// ---------------------------------------------------------------------------

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
}): Promise<Ran> {
  return drive(fixture(), options);
}

/** The step every session begins with. */
const opens: Step = opensAConsole(PROMPT);

/** The step every session ends with. */
const leaves: Step = {
  types: `${LEAVE}\r`,
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(LEAVE),
  what: 'left',
};

/**
 * THE PAGE STARTED OVER, so that what is read next was printed at the size the window is NOW.
 *
 * ⚠️ IT IS HERE BECAUSE THE SAME WORD TWICE PRODUCES NO FRAME. The layout writes nothing at all
 * for a frame identical to the one on the screen, and a window filled by one copy of this report
 * is filled by the next copy in exactly the same rows — measured: the step that typed the word a
 * second time waited out the whole budget and the session was fine. Starting the page over
 * empties the roll, so the frame that follows cannot be the frame that preceded it, and what is
 * on the page afterwards is only what was printed after the resize.
 */
const startsOver: Step = {
  types: `${CLEAR}\r`,
  until: aFrameSince(PROMPT),
  what: 'started the page over',
};

/** The caller asks what the session runs, and the answer lands whole. */
const asksWhatItRuns: Step = {
  types: `${ABOUT}\r`,
  until: arrivedSince(AND_IT_REFUSES),
  what: 'printed what it runs',
};

/** The window becomes this wide, and the console has DRAWN at it. */
const resizedTo = (columns: number): Step => ({
  resize: { columns, rows: TALL_ENOUGH },
  until: drewAt(columns),
  what: `drew at ${columns} columns`,
});

// ---------------------------------------------------------------------------
// The case of the defect, both ways round
// ---------------------------------------------------------------------------

describe('the fold follows the window the caller is looking at', () => {
  it('prints across the whole terminal after they maximise it', async () => {
    const narrow = 70;
    const wide = 200;
    // A13: the page has already PRINTED and already been resized when it is measured. A page
    // that has just opened is the one instant at which this defect does not exist, which is how
    // it survived twenty deliveries.
    const ran = await inPty({
      columns: narrow,
      rows: TALL_ENOUGH,
      steps: [opens, asksWhatItRuns, resizedTo(wide), startsOver, asksWhatItRuns, leaves],
    });

    // THE BEFORE, on the instrument, at the width the session opened at: the report really is
    // broken into continuations there, so the case below is not satisfied by a report nothing
    // ever folded.
    const opened = theSettledScreen(ran.bytes, narrow, TALL_ENOUGH);
    expect(
      continuationsAt(opened, narrow),
      'nothing folded at the width it opened at',
    ).toBeGreaterThan(0);

    // THE AFTER: not one row of the maximised page is the tail of a line folded at seventy.
    const maximised = theSettledScreen(ran.bytes, wide, TALL_ENOUGH);
    expect(continuationsAt(maximised, narrow), 'the page still folds at the old width').toBe(0);
    // And the report is on it WHOLE — the other half of the same fact, so a page that simply
    // lost the lines would not pass. Every one of them fits two hundred columns.
    const page = rowsOf(maximised);
    for (const line of theWordsItPrints()) {
      expect(page, `not on the page whole: ${renderPlain(line)}`).toContain(renderPlain(line));
    }
    // AND THE CASE HAS SOMETHING TO SAY: at least one of those lines is wider than the terminal
    // the session opened at, so it could not have passed before this delivery.
    expect(widthOf(theWidestLine())).toBeGreaterThan(narrow);
  }, 240_000);

  it('folds to the new width after they narrow it, with its own indent', async () => {
    const wide = 200;
    const narrow = 70;
    const ran = await inPty({
      columns: wide,
      rows: TALL_ENOUGH,
      steps: [opens, asksWhatItRuns, resizedTo(narrow), startsOver, asksWhatItRuns, leaves],
    });

    const narrowed = theSettledScreen(ran.bytes, narrow, TALL_ENOUGH);
    const page = rowsOf(narrowed);
    const widest = theWidestLine();
    // THE PRODUCT'S FOLD AND NOT THE TERMINAL'S, which is the whole of what "folds to the new
    // width" has to mean: the break is between words and the continuation is indented one level
    // under the row that generated it. A line still rendered for two hundred columns reaches the
    // terminal whole and comes back as a row of exactly seventy with the remainder at column
    // zero — no indent, and a word cut in half.
    const broken = foldedInto(widest, narrow);
    expect(broken.length, 'the widest line does not fold at this width').toBeGreaterThan(1);
    expect(
      whereTheRowsAre(page, broken),
      `not folded at ${narrow}: ${broken.join(' / ')}`,
    ).toBeGreaterThanOrEqual(0);
    // And it is not on the page whole, which is what a terminal too narrow for it means.
    expect(page).not.toContain(renderPlain(widest));
  }, 240_000);

  it('folds the line the page OPENS with to the terminal it is drawn on', async () => {
    // ⚠️ THE OPENING IS THE HALF A CASE ABOUT THE REPORT CANNOT SEE, and it went unnoticed once:
    // composing it with a renderer that was not the frame's left every case above green, because
    // what they read is what a VERB printed. The opening's own sentence lands on the roll like
    // any other line and folds like any other line — it is just composed one layer up.
    const wide = 200;
    const narrow = 70;
    const sentence = theLineItOpensWith();
    const broken = foldedInto(sentence, narrow);
    expect(broken.length, 'the opening sentence does not fold at this width').toBeGreaterThan(1);

    const ran = await inPty({
      columns: wide,
      rows: TALL_ENOUGH,
      // AND THE PAGE IS STARTED OVER AFTER THE RESIZE, which is what puts the opening back on the
      // roll at the size the window is NOW: the lines it landed when the session opened were
      // rendered for the terminal it opened on, and those are history rather than a defect.
      //
      // ⚠️ SOMETHING IS PRINTED FIRST, AND IT IS THE STEP RATHER THAN THE SUBJECT. Starting the
      // page over on a page that holds nothing but the opening is a frame identical to the one on
      // the screen, and the library writes nothing at all for one of those — so the step would
      // wait for ever and a mutation would come back as the driver's wall instead of as this
      // case's own accusation. Measured: exactly that, on the mutation that composes the opening
      // with a renderer which is not the frame's.
      steps: [opens, resizedTo(narrow), asksWhatItRuns, startsOver, leaves],
    });

    const page = rowsOf(theSettledScreen(ran.bytes, narrow, TALL_ENOUGH));
    expect(
      whereTheRowsAre(page, broken),
      `the opening is not folded at ${narrow}: ${broken.join(' / ')}`,
    ).toBeGreaterThanOrEqual(0);
    expect(page).not.toContain(renderPlain(sentence));
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The property: no frame holds two widths
// ---------------------------------------------------------------------------

describe('no frame holds two widths, at any size the caller stops at', () => {
  it('agrees with its own rules at every size in a sequence, not only the last', async () => {
    // THREE SIZES, EACH READ WHERE IT SETTLED. The page is found by the width its RULES were
    // drawn at (`support/screen.ts`, `theSettledScreen`), so reading it at that width is already
    // half the question; the other half is that the CONTENT on it folded at the same number.
    // Both halves in one answer, at every size rather than at the end of the sequence.
    // THE THREE ARE CHOSEN SO THE WIDEST ROW FOLDS DIFFERENTLY AT EACH: it breaks in one place
    // at eighty, in another at sixty, and not at all at a hundred and forty. Three sizes that
    // all left it whole would be one assertion asked three times.
    const sizes = [80, 60, 140];
    const ran = await inPty({
      columns: 110,
      rows: TALL_ENOUGH,
      steps: [
        opens,
        asksWhatItRuns,
        ...sizes.flatMap((columns) => [resizedTo(columns), startsOver, asksWhatItRuns]),
        leaves,
      ],
    });

    const widest = theWidestLine();
    // How many rows this case actually REFUSED — a page of widths that never differ is a
    // property satisfied for free, and this is what says it was not.
    let refused = 0;
    for (const columns of sizes) {
      const screen = theSettledScreen(ran.bytes, columns, TALL_ENOUGH);
      const page = rowsOf(screen);
      const at = `${columns} columns`;
      // The rules of the input area really do measure this terminal — said out loud rather than
      // left to the locator, because two halves that came from one reading are one thing
      // asserted twice.
      expect(everyWidthDrawnOn(page), `${at}: nothing on the page was drawn that wide`).toContain(
        columns,
      );
      // And the widest row of the report is folded to exactly that number, whether that means
      // broken in two or left alone.
      const broken = foldedInto(widest, columns);
      expect(
        whereTheRowsAre(page, broken),
        `${at}: the content is not folded at ${columns}`,
      ).toBeGreaterThanOrEqual(0);
      // And no row of it is the tail of the SAME line folded for one of the other sizes.
      const kept = new Set(broken.map((row) => row.trimEnd()));
      for (const other of sizes.filter((size) => size !== columns)) {
        for (const row of foldedInto(widest, other)
          .slice(1)
          .map((tail) => tail.trimEnd())) {
          if (kept.has(row)) continue;
          refused += 1;
          expect(
            page,
            `${at}: a row folded for ${other} is on a page drawn ${columns} wide`,
          ).not.toContain(row);
        }
      }
    }
    expect(refused, 'no size in this sequence folded differently from another').toBeGreaterThan(0);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// One reading of the device, and the frame is built out of it
// ---------------------------------------------------------------------------

describe('the frame is composed for a size the device really answered with', () => {
  it('asks the device ONCE for the size the first frame is built at', async () => {
    // ⚠️ THIS IS THE SITE THE SWEEP FOUND AND NO CASE COVERED. The console's own doc says a frame
    // built out of two readings of a device the caller can resize between them is a frame built
    // out of two different terminals — and the line that seeds the size read it twice
    // (`{ columns: theSize()[0], rows: theSize()[1] }`), which is the one line older than the
    // function that exists to stop it. Nothing was red when it was put back, so it is closed
    // here: the mutation is invisible on any device that answers the same pair twice, and this
    // one does not.
    //
    // THE DEVICE ANSWERS A DIFFERENT PAIR ON THE SECOND ASK, which is a caller resizing between
    // two reads, made deterministic. What the case then asks is what the FIRST frame was composed
    // for — the console hands the size to the opening, so the opening is where it is observable
    // without reaching into the module.
    const answers: readonly (readonly [number, number])[] = [
      [120, 24],
      [80, 50],
    ];
    let asks = 0;
    const terminal = fakeTerminal({ columns: 120, rows: 24 });
    Object.assign(terminal.stdout, {
      getWindowSize: () => {
        const answer = answers[Math.min(asks, answers.length - 1)] as readonly [number, number];
        asks += 1;
        return [answer[0], answer[1]];
      },
    });

    const composed: [number, number][] = [];
    const page = openConsole({
      stdin: terminal.stdin,
      stdout: terminal.stdout,
      prompt: PROMPT,
      renderingAt: () => renderPlain,
      tips: { text: '', width: 0 },
      picking: fact('nothing to pick'),
      badge: { text: '', width: 0 },
      openingFor: (columns, rows) => {
        composed.push([columns, rows]);
        return { panel: undefined, lines: [], rows: 0, above: 0 };
      },
      saw: () => undefined,
      happened: () => [],
      complete: () => [[], ''],
      answer: async () => 'leave',
      leaving: hooksNothing,
    });
    await until(() => composed.length > 0, 'composed an opening');
    terminal.type('x\r');
    await page.closed;

    // ⛔ THE FIRST FRAME IS ONE OF THE TERMINALS THE DEVICE NAMED, whole. With two readings it is
    // the width of the first and the height of the second — a shape no terminal was ever.
    expect(composed[0], 'the first frame is half one terminal and half another').toEqual(
      answers[0],
    );
    // And the device really did change under it, or the case above is satisfied by a stand-in
    // that could not have caught anything.
    expect(asks, 'the device was never asked twice').toBeGreaterThan(1);
    expect(answers[0]).not.toEqual(answers[1]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The rule itself: what moves with the width and what does not
// ---------------------------------------------------------------------------

describe('the colour is one answer per invocation and the width is not', () => {
  /** One escape byte, written as an escape so no control byte enters a source file. */
  const ESC = '\u001b';

  /** What a capability looks like when nothing but the terminal has spoken. */
  const onATerminal = (columns: number): Capability => ({
    when: 'auto',
    env: {},
    isTty: true,
    columns,
  });

  it('answers one width with a fold and another with none, out of one capability', () => {
    const long = theWidestLine();
    const at = rendererAtEachWidth(() => onATerminal(80));
    expect(at(60)(long)).toContain('\n');
    expect(at(400)(long)).not.toContain('\n');
    // And the same width twice is the same renderer, which is what makes it affordable to ask
    // per line rather than per frame.
    expect(at(60)).toBe(at(60));
  });

  it('reads the capability ONCE, however many widths it is asked for', () => {
    // ⛔ THE HALF THAT MAY NOT MOVE. The flag, the two variables and whether the destination is
    // a terminal are this invocation's, and a session whose first answer was painted and whose
    // tenth was not would be one line's worth of doubt about every line in the scrollback.
    const long = theWidestLine();
    let asked = 0;
    const at = rendererAtEachWidth(() => {
      asked += 1;
      return onATerminal(80);
    });
    for (const columns of [40, 80, 120, 40, 200]) at(columns)(long);
    expect(asked).toBe(1);
  });

  it('keeps colour out of it: what paints at one width paints at every width', () => {
    // THE SUBJECT IS A LINE THE PAINTED RENDERER REALLY DOES PAINT, found by comparing the two
    // renderings rather than by picking a row and hoping: most of what this session prints is a
    // `fact`, a fact carries no weight, and a case built on one would have asserted that colour
    // survives a resize over a line that has none.
    const painted = theWordsItPrints().find((line) => renderStyled(line) !== renderPlain(line));
    expect(painted, 'nothing this session prints carries any style at all').toBeDefined();
    const line = painted as Line;
    const quietly = rendererAtEachWidth(() => ({
      when: 'auto',
      env: { NO_COLOR: '1' },
      isTty: true,
      columns: 80,
    }));
    const loudly = rendererAtEachWidth(() => onATerminal(80));
    for (const columns of [0, 40, 200]) {
      expect(quietly(columns)(line), `${columns}`).not.toContain(ESC);
      expect(loudly(columns)(line), `${columns}`).toContain(ESC);
    }
  });

  it('asked for no width at all, answers for the terminal this invocation is on', () => {
    // THE ELO between the two doors: the renderer every verb is handed is this rule asked with
    // nothing, so a verb that prints and exits folds to the width the entry read and nothing
    // else. It is what keeps `chosen-once.test.ts` — the pipe, the file, the CI log and the
    // recorded transcript — saying what it has always said.
    const long = theWidestLine();
    const at = rendererAtEachWidth(() => onATerminal(60));
    expect(at()(long)).toBe(at(60)(long));
    expect(rendererFor(at)(long)).toBe(at(60)(long));
    // And a stream that reported no width is not a width to guess at.
    const blind = rendererAtEachWidth(() => ({ when: 'auto', env: {}, isTty: false, columns: 0 }));
    expect(blind()(long)).toBe(renderPlain(long));
    expect(blind(40)(long)).toBe(renderPlain(long));
  });

  it('paints the same line the same way at both doors', () => {
    // The two renderers are one rule: what the styled one produces for a line that fits is what
    // this produces for it, byte for byte, at a width wide enough to leave it alone.
    const at = rendererAtEachWidth(() => onATerminal(80));
    const fits = theWordsItPrints()[0] as Line;
    expect(at(400)(fits)).toBe(renderStyled(fits));
  });
});

// ---------------------------------------------------------------------------
// And nobody else asks a device how wide it is
// ---------------------------------------------------------------------------

/** What asking a DEVICE how big it is looks like, as opposed to being handed a number. */
const ASKS_A_DEVICE = /stdout\.(columns|rows)|getWindowSize/;

describe('two files ask a device for its size, and a third would be a third answer', () => {
  it('names the entry and the console, and nothing else', () => {
    // ⛔ THE PREMISE THE WHOLE DELIVERY RESTS ON. The entry reads the width because whether a
    // line folds is part of the capability every verb is handed, resolved where the process is;
    // the console reads it because the frame IS the screen and every number on it comes out of
    // one reading. Those are two answers to two questions. A THIRD would be a number nobody
    // reconciled — and the console's own doc has claimed for two deliveries that a third was
    // refused, with nothing anywhere refusing one.
    const asking = sourceFiles(SRC)
      // CODE AND NOT PROSE. Half this surface's files DISCUSS who reads the width, in the very
      // paragraphs that make the rule readable, and a scanner that counted a doc comment would
      // accuse the documentation for existing (`support/reading-source.ts`).
      .filter((file) => ASKS_A_DEVICE.test(codeOnly(readFileSync(file, 'utf-8'))))
      .map((file) => file.slice(SRC.length + 1))
      .sort();
    expect(asking).toEqual(['cli.ts', 'repl/console.ts']);
    // Read, rather than absent: the walk really did reach this surface's files.
    expect(sourceFiles(SRC).length).toBeGreaterThan(50);
  });

  it('would accuse a module that reached for one', () => {
    // The vacuous form: a detector whose terms match nothing any more. Composed against the two
    // lines a careful author would write — the stream's own property, and the call the layout
    // library makes.
    expect(ASKS_A_DEVICE.test(codeOnly('const wide = process.stdout.columns ?? 0;'))).toBe(true);
    expect(ASKS_A_DEVICE.test(codeOnly('const size = stdout.getWindowSize?.();'))).toBe(true);
    // And it is not satisfied by a width that ARRIVED, which is what every other module has.
    expect(ASKS_A_DEVICE.test(codeOnly('const { columns } = request;'))).toBe(false);
  });
});
