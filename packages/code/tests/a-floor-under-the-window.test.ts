/**
 * A FLOOR UNDER THE WINDOW — the shortest terminal this console draws a page on, and what a
 * window under it is shown instead.
 *
 * EVERY LADDER ON THIS SURFACE WAS TOTAL, AND THAT IS THE PREMISE THIS FILE TAKES AWAY. The
 * drawing of the name gave way to a smaller drawing and finally to the name; the arrangement at
 * the top gave way to the same lines on the roll; the input area dropped its badge and then its
 * rules; the list of words showed fewer and said how many it could not. Each of those files says
 * in its own words that its last rung is answered *whatever the size* — and what that produced
 * was not a smaller console, it was a prompt with the product's identity gone from the screen.
 * There is a floor now (`src/repl/floor.ts`): below eighty by twenty-four the console does not
 * lay a page out at all.
 *
 * AND FORCING THE WINDOW IS NOT THE OTHER OPTION. The sequence that asks a terminal to resize
 * its own text area exists, and it is refused on two grounds: it is disableable by whoever built
 * the terminal, whose own security guidance is to refuse to implement it, and the terminal this
 * product is developed on had a denial of service exactly there. The last case in this file scans
 * every source for it and reads the bytes of a real run — the product must not be able to move
 * somebody's window, and that has to be a measurement rather than an intention.
 *
 * WHAT THIS FILE HOLDS is one promise in five parts:
 *
 *   - THE BOUNDARY IS A PAIR OF NUMBERS, and it is SEARCHED FOR rather than written down: the
 *     smallest window that serves is walked to, on both measurements.
 *   - THE SCREEN SAYS BOTH NUMBERS AND NAMES THE AXIS. *Make your window bigger* makes a reader
 *     guess which edge and how far; what the window has, what the console needs, and what falls
 *     short is the same thing every refusal of this product does — say what happened and where.
 *   - IT IS A SCREEN AND NOT AN ERROR. The session stays open, the record gains nothing, the roll
 *     is untouched, and the page comes back BY ITSELF when the window grows. Asserted by crossing
 *     the floor in both directions with a line already said, and finding it still there.
 *   - THE CONSOLE DOES NOT TRY TO DRAW under it, which is stronger than *what it draws is
 *     different*: no opening is composed at all, counted in process.
 *   - AND `NO_COLOR` SILENCES IT, like everything else this product prints.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { fact } from '../src/presentation/detail.js';
import { renderPlain } from '../src/presentation/plain.js';
import { openConsole } from '../src/repl/console.js';
import { THE_FLOOR, theFloorScreenFor, theWindowServes } from '../src/repl/floor.js';
import { ABOUT } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC, fakeTerminal, hooksNothing, until, withoutLayout } from './support/console.js';
import {
  aFrameSince,
  inPty as drive,
  type Fixture,
  FRAME_IS_DRAWN,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';
import { screenOf, theSettledScreen } from './support/screen.js';
import { held } from './support/the-record-held.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** `packages/code/src`, for the guards that read this surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** What the opening always says on a window that serves, and never on one that does not. */
const OPENED = 'a session over this project';

/** The heading that CLOSES what `/help` answers — a line only the ROLL can be carrying. */
const CLOSES_THE_ANSWER = 'And it does not write';

/** The key that leaves, as a terminal sends it. Spelled by its code point, like every other. */
const THE_KEY_THAT_LEAVES = '\u0004';

/** Everything that changes how a glyph looks: colour and weight, and nothing about position. */
const PAINTED = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/**
 * WHAT THE FLOOR SCREEN SAYS AT A SIZE — asked of the module that composes it, never retyped.
 *
 * It is the elo between the arithmetic and the page: every assertion below about what a reader
 * sees is made against these rows, so a delivery that rewords the screen moves the cases with it
 * and one that stops drawing it goes red.
 */
const floorRowsAt = (columns: number, rows: number): readonly string[] =>
  theFloorScreenFor({ columns, rows, render: renderPlain });

/**
 * THE ONE ROW EVERY FLOOR SCREEN CARRIES, whatever the size — the heading, which is the only row
 * at depth nought and therefore the only one whose bytes are contiguous under a renderer that
 * paints (a row indented under it carries its escapes between the indent and the text).
 */
const THE_HEADING = floorRowsAt(THE_FLOOR.columns - 1, THE_FLOOR.rows)[0] as string;

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

beforeAll(async () => {
  // ITS OWN SANDBOX, and nothing of this repository's own record is touched: a case that
  // opened a session where it stands would be measuring a project it is also changing.
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-floor-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(['init'], io);
  await run(['task', 'the task the floor is measured over'], io);

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

/** The fixture every case below drives the built binary over. */
const fixture = (): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

/** Runs `mnema repl` on a pseudo-terminal of a given size. */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
  readonly environment?: NodeJS.ProcessEnv;
}): Promise<Ran> {
  return drive({ ...fixture(), environment: options.environment ?? environment }, options);
}

/**
 * A WHOLE FRAME THIS STEP CAUSED, WITH `what` ON IT.
 *
 * THE USUAL WAIT CANNOT BE USED HERE AND THE REASON IS THE SUBJECT. Every other step of this
 * bench waits for a finished frame carrying the PROMPT, because the row being typed is rewritten
 * by every frame the layout draws — and the floor screen has no row being typed at all. So what a
 * step waits for is the screen's own heading, arriving since the step began, at a frame boundary:
 * the first half keeps it from ending on a frame that was already in flight, and the second keeps
 * it from reading half of one (`support/pty.ts`).
 */
function aFrameSaying(what: string): (bytes: string, since: number) => boolean {
  return (bytes, since) => bytes.endsWith(FRAME_IS_DRAWN) && bytes.slice(since).includes(what);
}

/** The step a session under the floor begins with: the floor screen DRAWN. */
const opensTheFloorScreen: Step = {
  until: aFrameSaying(THE_HEADING),
  what: 'drew the floor screen',
};

/** The step every session on a window that serves begins with. */
const opens: Step = opensAConsole(PROMPT);

/**
 * WHAT IS TYPED ONCE THE WINDOW HAS GROWN BACK — the mark that tells the page after the
 * crossing from the page before it.
 *
 * AND IT IS HERE BECAUSE A MUTATION WENT UNCAUGHT WITHOUT IT. The page after the window grew
 * back was found as *the last frame drawn a hundred columns wide with the answer on it*, and the
 * frames BEFORE the shrink are all of those too — so a console that emptied its roll while the
 * floor screen was up passed the case, on a frame from before the crossing. Nothing else in the
 * run distinguishes the two pages: the caller types nothing and the record does not move, so the
 * console draws the same page it drew before. What this word buys is a property only a frame on
 * the far side of the crossing can have.
 */
const TYPED_AFTER = 'typed-after-the-window-grew-back';

/** The caller asks what the session runs, which is the longest thing it says. */
const asks: Step = { types: `${ABOUT}\r`, until: aFrameSince(PROMPT), what: `asked ${ABOUT}` };

/**
 * The step every session ends with.
 *
 * CTRL-D RATHER THAN THE WORD, for the reason the sibling cases give: the word is ECHOED onto the
 * roll, so the page a case is about would be one line further down than the page the caller saw.
 */
const leaves: Step = { types: THE_KEY_THAT_LEAVES, until: () => true, what: 'left' };

/**
 * The step that leaves a session with something on the row being typed.
 *
 * THE KEY THAT LEAVES IS THE END OF THE INPUT and a row with characters on it is not the end
 * of anything: measured, the session went on running and the driver waited out its whole budget.
 * So the row is abandoned first — which is what the key that clears it does — and the key that
 * leaves then reads as the end it is.
 */
const clearsAndLeaves: Step = {
  types: `\u0003${THE_KEY_THAT_LEAVES}`,
  until: () => true,
  what: 'left with a row still typed',
};

// ---------------------------------------------------------------------------
// The floor is a pair of numbers, and the boundary is searched for
// ---------------------------------------------------------------------------

describe('the floor is eighty by twenty-four, and it is a function of both measurements', () => {
  it('is walked to rather than written down here', () => {
    // THE THRESHOLD, SEARCHED FOR — the same shape every other form on this surface is pinned by.
    // Nothing here knows what the floor is: the walk asks the question at every size and the
    // first size that answers yes IS the boundary.
    let narrowest = 0;
    while (narrowest < 400 && !theWindowServes(narrowest, THE_FLOOR.rows)) narrowest += 1;
    let shortest = 0;
    while (shortest < 400 && !theWindowServes(THE_FLOOR.columns, shortest)) shortest += 1;
    expect(narrowest, 'the narrowest window that serves').toBe(80);
    expect(shortest, 'the shortest window that serves').toBe(24);
    // AND THE PAIR THE MODULE NAMES IS THE PAIR THE WALK FOUND, which is what keeps the constant
    // from drifting away from the rule that reads it.
    expect([narrowest, shortest]).toEqual([THE_FLOOR.columns, THE_FLOOR.rows]);
    // AND IT IS BOTH MEASUREMENTS AND NOT ONE. A window one column narrow fails at any height,
    // and one row short fails at any width — so neither number can stand in for the other, which
    // is the vacuity a floor on the width alone would pass.
    expect(theWindowServes(narrowest - 1, 400), 'one column short, on a tall window').toBe(false);
    expect(theWindowServes(400, shortest - 1), 'one row short, on a wide window').toBe(false);
    expect(theWindowServes(narrowest, shortest), 'exactly the floor').toBe(true);
  });

  it('never takes a window back once it serves, in either direction', () => {
    // THE RULE IS MONOTONE, over a grid rather than at the boundary: a window that serves goes on
    // serving when it is made wider or taller. That is the property the two numbers above are the
    // corner of, and it is what makes *the console comes back by itself* a fact about the rule
    // rather than about one crossing.
    const answered = new Set<boolean>();
    for (let columns = 0; columns <= 200; columns += 1) {
      for (let rows = 0; rows <= 70; rows += 1) {
        const serves = theWindowServes(columns, rows);
        answered.add(serves);
        if (!serves) continue;
        expect(theWindowServes(columns + 1, rows), `${columns + 1}x${rows}`).toBe(true);
        expect(theWindowServes(columns, rows + 1), `${columns}x${rows + 1}`).toBe(true);
      }
    }
    // A DEVICE THAT REPORTED NOTHING IS UNDER THE FLOOR, which is the posture the rest of this
    // surface takes about the same silence: nought is not eighty.
    expect(theWindowServes(0, 0), 'a device that reported no size at all').toBe(false);
    // NOT VACUOUS: the grid really produced both answers, so the walk above is over a rule rather
    // than over one answer repeated fourteen thousand times.
    expect([...answered].sort()).toEqual([false, true]);
  });
});

// ---------------------------------------------------------------------------
// What the screen says
// ---------------------------------------------------------------------------

describe('the floor screen says both numbers and names the axis that falls short', () => {
  it('names the width when the width is what is missing, and the height when it is not', () => {
    const narrow = floorRowsAt(THE_FLOOR.columns - 1, THE_FLOOR.rows).join('\n');
    const short = floorRowsAt(THE_FLOOR.columns, THE_FLOOR.rows - 1).join('\n');
    // BOTH NUMBERS, ON BOTH SCREENS: what this window is, and what the console needs.
    expect(narrow, 'the window it is drawn on is not on it').toContain('79x24');
    expect(narrow, 'what the console needs is not on it').toContain('80x24');
    expect(short, 'the window it is drawn on is not on it').toContain('80x23');
    expect(short, 'what the console needs is not on it').toContain('80x24');
    // AND THE AXIS: one of them, and only the one that is short.
    expect(narrow, 'the axis that falls short is not named').toContain('1 column short');
    expect(narrow, 'it named the axis that is not short').not.toContain('row short');
    expect(short, 'the axis that falls short is not named').toContain('1 row short');
    expect(short, 'it named the axis that is not short').not.toContain('column short');
  });

  it('names both when a window is short both ways, and counts in the number’s own form', () => {
    const corner = floorRowsAt(40, 10).join('\n');
    expect(corner, 'the window it is drawn on is not on it').toContain('40x10');
    expect(corner, 'both axes are not named').toContain('40 columns and 14 rows short');
    // THE PLURAL IS THE NUMBER'S, which is worth one assertion because it is the one thing on
    // this screen a reader would read as a defect in the product.
    expect(floorRowsAt(78, 24).join('\n'), 'two columns short').toContain('2 columns short');
    expect(floorRowsAt(79, 23).join('\n')).toContain('1 column and 1 row short');
  });

  it('says the session is still there, which is what makes it a screen and not an error', () => {
    // THE ROW THIS SCREEN WOULD BE DISHONEST WITHOUT. A reader looking at a page that stopped
    // being the console has no way of knowing whether the session survived, and one who guesses
    // wrong kills it.
    expect(floorRowsAt(40, 10).join('\n')).toContain('still open');
    // AND NOT ONE OF ITS ROWS IS WIDER THAN THE WINDOW IT IS DRAWN ON, which is what keeps the
    // screen that says a window is too small from being folded by the window it is on.
    for (const row of floorRowsAt(THE_FLOOR.columns - 1, THE_FLOOR.rows)) {
      expect([...row].length, row).toBeLessThanOrEqual(THE_FLOOR.columns - 1);
    }
  });
});

// ---------------------------------------------------------------------------
// On a real terminal: under the floor, and at it
// ---------------------------------------------------------------------------

describe('a window under the floor gets the screen, and the window at it gets the console', () => {
  for (const [columns, rows] of [
    [THE_FLOOR.columns - 1, THE_FLOOR.rows],
    [THE_FLOOR.columns, THE_FLOOR.rows - 1],
  ] as const) {
    it(`draws the floor screen at ${columns}x${rows}, with its own axis on it`, async () => {
      const ran = await inPty({ columns, rows, steps: [opensTheFloorScreen, leaves] });
      // THE PAGE, replayed up to the frame the opening step approved — the floor screen is the
      // whole frame, so there is nothing else on it to find it by.
      const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
      expect(screen.alternate, 'the session did not take the screen').toBe(true);
      // EVERY ROW THE MODULE COMPOSED IS ON THE PAGE, which is the elo between the two.
      for (const row of floorRowsAt(columns, rows)) {
        expect(screen.text, `a row of the floor screen is missing: ${row}`).toContain(row.trim());
      }
      // AND THE CONSOLE IS NOT ON IT AT ALL. This is the half that says the console did not
      // DRAW: no row being typed, and nothing the opening says.
      expect(screen.text, 'the console drew a prompt under the floor').not.toContain(PROMPT);
      expect(screen.text, 'the console drew its opening under the floor').not.toContain(OPENED);
    }, 240_000);
  }

  it('draws the console at exactly the floor, which is where the boundary is', async () => {
    const { columns, rows } = THE_FLOOR;
    const ran = await inPty({ columns, rows, steps: [opens, asks, leaves] });
    // FOUND BY THE WIDTH IT WAS DRAWN AT: the two rules the input area sits between run the whole
    // way across, so a run that long IS the console having drawn at this size
    // (`support/screen.ts`).
    const screen = theSettledScreen(ran.bytes, columns, rows, CLOSES_THE_ANSWER);
    expect(screen.text, 'the console did not open at the floor').toContain(OPENED);
    expect(screen.text, 'there is no row being typed at the floor').toContain(PROMPT);
    // AND THE ANSWER THE CALLER ASKED FOR IS ON IT, which is what makes the floor a size the
    // console WORKS at rather than one it merely survives.
    expect(screen.text, 'what the caller asked for is not on the page').toContain(
      CLOSES_THE_ANSWER,
    );
    // AND THE FLOOR SCREEN IS NOWHERE IN THE WHOLE RUN, not merely off this page: one row
    // narrower drew it, and this size may not.
    expect(ran.bytes, 'the floor screen was drawn at the floor').not.toContain(THE_HEADING);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// Crossing it, in both directions
// ---------------------------------------------------------------------------

describe('the floor is crossed in both directions and the session survives it', () => {
  it('shows the screen when the window shrinks and the roll when it grows back', async () => {
    const columns = 100;
    const rows = 30;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        asks,
        {
          resize: { columns: 70, rows: 20 },
          until: aFrameSaying(THE_HEADING),
          what: 'was made too small',
        },
        {
          resize: { columns, rows },
          until: aFrameSince(PROMPT),
          what: 'was made big enough again',
        },
        // AND SOMETHING IS TYPED ON THE PAGE THAT CAME BACK, which is what makes the read below
        // about the far side of the crossing ({@link TYPED_AFTER}).
        {
          types: TYPED_AFTER,
          until: aFrameSaying(TYPED_AFTER),
          what: 'typed on the page that came back',
        },
        clearsAndLeaves,
      ],
    });
    // THE FLOOR SCREEN WAS DRAWN BY THE SHRINK, and it is read out of what arrived while the
    // step was happening rather than off a page replayed at the small size: everything above the
    // shrink was drawn a hundred columns wide, so a replay onto a seventy-column screen would be
    // a page carrying two terminals — which is the one thing the screen model refuses by name.
    const shrank = ran.bytes.slice(ran.at[1] as number, ran.at[2] as number);
    expect(shrank, 'the shrink did not draw the floor screen').toContain(THE_HEADING);
    expect(shrank, 'the floor screen did not say what the window had become').toContain('70x20');
    // AND THE PAGE AFTER IT GREW BACK IS THE CONSOLE, WITH WHAT WAS SAID BEFORE THE SHRINK
    // STILL ON IT. The line is one the ROLL is carrying — the opening says nothing like it — so a
    // console that had started over would be red here, and one that re-read the record could not
    // put it back.
    const back = theSettledScreen(ran.bytes, columns, rows, TYPED_AFTER);
    expect(back.text, 'the roll did not survive the crossing').toContain(CLOSES_THE_ANSWER);
    expect(back.text, 'the console did not come back').toContain(PROMPT);
    expect(back.text, 'the floor screen is still on the page').not.toContain(THE_HEADING);
    // AND THE PAGE IT CAME BACK TO IS THE ONE IT LEFT: the opening is at the top of it again.
    expect(back.text, 'the opening did not come back').toContain(OPENED);
  }, 300_000);

  it('neither dies nor writes: the word that leaves still works, and nothing was added', async () => {
    // THE MEASUREMENT, around the whole crossing. What is counted is the events in every tail of
    // every tree and the key material on the machine (`support/the-record-held.ts`).
    const started = held(sandbox);
    const columns = 100;
    const rows = 30;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          resize: { columns: 60, rows: 12 },
          until: aFrameSaying(THE_HEADING),
          what: 'was made too small',
        },
        {
          resize: { columns, rows },
          until: aFrameSince(PROMPT),
          what: 'was made big enough again',
        },
        // AND THE WORD, TYPED — not the key. What is being asked is whether the session is still
        // ANSWERING after the crossing, and the key that leaves is handled a layer above the
        // gate; the word goes through the whole of it.
        { types: '/exit\r', until: () => true, what: 'was told to leave' },
      ],
    });
    // THE SESSION LEFT BY THE WORD: the echo of it is on the page, and the screen went back.
    expect(ran.bytes, 'the word that leaves was never echoed').toContain('/exit');
    expect(ran.bytes, 'the session never gave the screen back').toContain(`${ESC}[?1049l`);
    // AND THE RECORD GAINED NOTHING, on either half of what *changed the record* means.
    const ended = held(sandbox);
    expect(ended.events, 'the session appended to the record').toBe(started.events);
    expect(ended.keys, 'the session touched the key material').toBe(started.keys);
    // THE TEETH: the same instrument over the same fixture SEES a write, so the two counts above
    // are a fact about the session rather than about a measurement that cannot see one.
    const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    await run(['memory', 'a fact written after the crossing'], io);
    expect(held(sandbox).events, 'the instrument cannot see a write').toBe(started.events + 1);
  }, 300_000);

  it('composes no opening under the floor, and hands the roll back whole', async () => {
    // IN PROCESS, AND DETERMINISTIC — the half a pseudo-terminal cannot answer. *The console does
    // not try to draw* is not *what it drew is different*: nothing is composed at all, and the
    // way to see that is to count the compositions.
    const said = 'a line the session said before the window shrank';
    const composed: [number, number][] = [];
    const terminal = fakeTerminal({ columns: 100, rows: 30 });
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
    page.land(said);
    await until(() => withoutLayout(terminal.bytes()).includes(said), 'landed the line');
    const beforeTheShrink = composed.length;

    terminal.resize(70, 20);
    await until(() => terminal.bytes().includes(THE_HEADING), 'drew the floor screen');
    // NOT ONE COMPOSITION FOR THE WINDOW UNDER THE FLOOR. The opening is the expensive half of
    // a frame — the drawing of the name is chosen by composing every candidate — and a page that
    // is not drawn may not pay for it.
    expect(composed.length, 'an opening was composed under the floor').toBe(beforeTheShrink);
    expect(composed.some(([columns]) => columns === 70)).toBe(false);

    // AND THE ROLL COMES BACK WHOLE, without the line being said again: what is looked at is what
    // was written AFTER the floor screen, so a page still carrying the old bytes cannot answer.
    terminal.resize(100, 30);
    const sinceTheFloor = (): string =>
      terminal.bytes().slice(terminal.bytes().lastIndexOf(THE_HEADING));
    await until(() => withoutLayout(sinceTheFloor()).includes(said), 'drew the roll again');
    terminal.type('x\r');
    await page.closed;
  }, 60_000);
});

// ---------------------------------------------------------------------------
// And it is silenced like everything else
// ---------------------------------------------------------------------------

describe('the floor screen goes through the same renderer as every line of this product', () => {
  it('carries no colour with NO_COLOR set, and carries some without it', async () => {
    const columns = THE_FLOOR.columns - 1;
    const rows = THE_FLOOR.rows;
    const steps = [opensTheFloorScreen, leaves];
    const quiet = await inPty({
      columns,
      rows,
      steps,
      environment: { ...environment, NO_COLOR: '1' },
    });
    const loud = await inPty({ columns, rows, steps });
    // THE SCREEN IS THE SAME SCREEN in both, which is what makes the comparison about colour
    // rather than about what was drawn.
    for (const ran of [quiet, loud]) {
      expect(screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows).text).toContain(
        THE_HEADING,
      );
    }
    // AND WHAT DIFFERS IS THE PAINT. The frame the screen was drawn on carries no sequence that
    // changes how a glyph looks when colour is off — and it carries some when it is on, which is
    // what keeps the absence from being a page that was never painted anyway.
    const paintOn = (ran: Ran): string[] =>
      ran.bytes.slice(0, ran.at[0] as number).match(PAINTED) ?? [];
    expect(paintOn(quiet), 'the floor screen was painted with NO_COLOR set').toEqual([]);
    expect(paintOn(loud).length, 'the floor screen carries no paint at all').toBeGreaterThan(0);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Every site that rules on whether there is room, and the one that asks the floor
// ---------------------------------------------------------------------------

/**
 * WHAT A SITE THAT RULES ON ROOM LOOKS LIKE: a comparison against one of the words this surface
 * uses for the room a page has.
 *
 * THE DISCRIMINANT IS THE COMPARISON AND NOT A LIST OF FILES, which is the whole point: the rule
 * *whether a thing is drawn is decided by measuring it against the window* holds in N places, and
 * a place this scan finds that the enumeration below does not have is the finding.
 */
const RULES_ON_ROOM =
  /(?:<=|>=|<|>)\s*[\w.]*\b(?:columns|rows|within|under|room)\b|\b(?:columns|rows|within|under|room)\b[\w.]*\s*(?:<=|>=|<|>)/;

/** What names the floor, in code — the constant and the question over it. */
const ASKS_THE_FLOOR = /theWindowServes|THE_FLOOR/;

/**
 * WHAT ASKING A TERMINAL TO RESIZE ITSELF LOOKS LIKE, spelled every way this repository spells
 * an escape: the byte itself, the two escaped forms, and the constant the bench writes it with.
 *
 * It is read over the RAW source rather than over the code, because the sequence would be a
 * string literal and a scanner that blanked literals would find nothing. Prose is safe from it:
 * this repository writes the sequence out in words, and words carry no bracket.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
const RESIZES_THE_WINDOW = /(?:\u001b|\\u001b|\\x1b|\\033|\$\{ESC\})\s*\[\s*8\s*;/;

describe('the floor is asked in one place, and every site that rules on room is named', () => {
  it('names the module that answers the floor and the one that asks it, and nothing else', () => {
    // A3: THE FLOOR IS ONE FUNCTION WITH ONE SITE. A second comparison of a size against the
    // floor would be a second floor, and the two would disagree the first time one of them moved.
    const naming = sourceFiles(SRC)
      .filter((file) => ASKS_THE_FLOOR.test(codeOnly(readFileSync(file, 'utf-8'))))
      .map((file) => file.slice(SRC.length + 1))
      .sort();
    expect(naming).toEqual(['repl/console.ts', 'repl/floor.ts']);
    // AND IT IS ASKED ONCE IN THE CONSOLE, counted rather than looked at.
    // THE CALL AND NOT THE NAME: the import is code too, so a count of the spelling would be
    // two and would go on being two however many times the question was asked.
    const asked = codeOnly(readFileSync(join(SRC, 'repl', 'console.ts'), 'utf-8')).match(
      /theWindowServes\(/g,
    );
    expect(asked, 'the console asks the floor more than once').toHaveLength(1);
    // Read, rather than absent: the walk really did reach this surface's files.
    expect(sourceFiles(SRC).length).toBeGreaterThan(50);
  });

  it('A1: enumerates every site that decides whether there is room to draw', () => {
    // THE SITES ARE FOUND BY THE DISCRIMINANT and then named, with what each of them rules on.
    // The list this delivery was handed had five — the floor, the console's last-resort guard,
    // the area, the panel and the drawing of the name — and the scan finds more. The extras are
    // the finding rather than noise: they are written down here so the next delivery inherits
    // them instead of rediscovering them.
    const ruling = sourceFiles(SRC)
      .filter((file) => RULES_ON_ROOM.test(codeOnly(readFileSync(file, 'utf-8'))))
      .map((file) => file.slice(SRC.length + 1))
      .sort();
    expect(ruling).toEqual([
      // the drawing of the name gives way to a smaller one, by width and by what the page needs
      'presentation/banner.ts',
      // where a line too wide is broken, and how many rows it then takes
      'presentation/folded.ts',
      // which arrangement the input area has room for, and whether the badge and the hint are
      // each one row
      'repl/area.ts',
      // the last-resort guard against a CLIPPED arrangement
      'repl/console.ts',
      // the floor itself
      'repl/floor.ts',
      // whether the list of words is drawn at all, and how many rows of it there are
      'repl/palette.ts',
      // which arrangement fits across the window and inside the chrome's share of it
      'repl/panel.ts',
      // whether the frame declares a size at all, and whether there is a caret
      'repl/region.ts',
      // how much of the roll fills the middle region
      'repl/scrolling.ts',
      // AND THE SITE THE HANDED-DOWN LIST DID NOT HAVE, which is the finding this case exists
      // for: the renderer every verb is given decides whether a line FOLDS at all from the width
      // the entry read (`isTty && columns > 0`). It is not on this surface and not in a frame —
      // it is one door up — so a delivery reasoning about *what fits* from the repl alone would
      // have missed the one place that rules on it for every line of the product.
      'wiring/color.ts',
    ]);
  });

  it('emits no sequence that resizes the caller’s window, in any module or any run', async () => {
    // THE DECISION THIS DELIVERY RESTS ON, made checkable. Nothing in this product asks a
    // terminal to change its own size: the sequence is disableable by whoever built the terminal,
    // the field's own guidance is to refuse to implement it, and it carried a denial of service
    // on the terminal this product is developed on.
    const emitting = sourceFiles(SRC)
      .filter((file) => RESIZES_THE_WINDOW.test(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(SRC.length + 1));
    expect(emitting, 'a module asks the terminal to resize itself').toEqual([]);
    // AND NOT IN THE BYTES OF A REAL SESSION EITHER, which is the half a scan cannot answer: a
    // sequence assembled at runtime is in no source and would be on the wire.
    const ran = await inPty({
      columns: THE_FLOOR.columns - 1,
      rows: THE_FLOOR.rows,
      steps: [opensTheFloorScreen, leaves],
    });
    expect(RESIZES_THE_WINDOW.test(ran.bytes), 'a session asked to resize the window').toBe(false);
    // NOT VACUOUS: the detector finds the line an author would write, in the spellings this
    // repository uses for an escape.
    expect(RESIZES_THE_WINDOW.test(`${ESC}[8;24;80t`)).toBe(true);
    expect(RESIZES_THE_WINDOW.test("const RESIZE = '\\u001b[8;24;80t';")).toBe(true);
    // And it is not satisfied by the sequences this product really does write.
    expect(RESIZES_THE_WINDOW.test(`${ESC}[?1049h`)).toBe(false);
    expect(RESIZES_THE_WINDOW.test(`${ESC}[2K`)).toBe(false);
  }, 240_000);
});
