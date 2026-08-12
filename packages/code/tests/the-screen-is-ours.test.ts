/**
 * THE SCREEN IS OURS — three regions, a roll of our own, and the caller's terminal handed back
 * with everything the session said written onto it.
 *
 * THIS IS THE FILE FOR THE MODEL RATHER THAN FOR A DEFECT, and the model is one sentence: the
 * console takes the alternate screen buffer, draws a frame exactly as tall as the terminal on
 * every frame, and keeps what the session said on a roll the middle region is a WINDOW onto. The
 * top region and the bottom region are fixed because a frame that is always the height of the
 * screen has nowhere to scroll them to.
 *
 * ⚠️ AND IT REPLACES A MODEL WHOSE PREMISES ARE ALL FALSIFIED AT ONCE, which is why six files of
 * this bench went with it rather than being adjusted. The console used to live in the caller's
 * own buffer and use their scrollback as its roll, so:
 *
 *   - the opening was the first item of a region written once and never redrawn, and it left the
 *     screen for good as soon as enough was printed (`a-page-that-opens-clean.test.ts`);
 *   - the input was put at the foot by ARITHMETIC — as many rows with nothing on them as the
 *     page had to spare (`the-gap-goes-under-the-box.test.ts`,
 *     `the-prompt-sits-at-the-foot.test.ts`);
 *   - a page was TURNED when the drawing a terminal would get was not the one on it, which
 *     carried a screen of the caller's into their scrollback
 *     (`the-page-follows-the-terminal.test.ts`);
 *   - and the list of words was a window onto the room the page had left over
 *     (`the-list-is-a-window.test.ts`).
 *
 * Not one of those questions can be asked of this console. What replaced each of them is asked
 * here, and the one promise that survived the model unchanged is asked here too: ⛔ THE SEQUENCE
 * THAT ERASES THE CALLER'S HISTORY NEVER REACHES THEIR TERMINAL. It survived because taking the
 * screen does NOT make it harmless — the alternate buffer has no scrollback of its own, so an
 * erase issued from inside it reaches the primary's — and because the layout library goes on
 * writing it, in one constant with the screen erase, every time it starts the page over.
 *
 * FIVE THINGS ARE ASKED, and the last four of them of a real pseudo-terminal:
 *
 *   - THE DOOR, THE ROLL AND THE WHEEL as values, with no terminal in them.
 *   - THE THREE REGIONS: the top does not move and the bottom does not move, asserted by the row
 *     each of them is on, before and after printing more than the screen can hold.
 *   - THE SCROLL: the keys and the wheel, up and back, with the fixed regions unmoved — and the
 *     tail followed for a reader who has not walked back and NOT followed for one who has.
 *   - RESIZE in both directions and in sequence, with the regions still where they belong.
 *   - THE WAY OUT: the alternate screen given back, and everything the session said on the
 *     caller's own buffer AFTER the sequence that gives it back.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { erasesTheScreen, withoutTheHistoryErase } from '../src/repl/erasing.js';
import { fromTheMouse, THE_WHEEL_BACK, WATCHING_THE_WHEEL } from '../src/repl/pointing.js';
import {
  backAtMost,
  landedIn,
  NOTHING_SAID,
  rowsForTheLine,
  rowsOfTheWindow,
  type Scrolling,
  scrolledBy,
  THE_CEILING,
  theTranscript,
  theWindowOn,
  toTheTail,
  toTheTop,
} from '../src/repl/scrolling.js';
import { CLEAR, LEAVE } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import {
  aFrameSince,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  rowsOfTheFrames,
  type Step,
} from './support/pty.js';
import {
  drewAt,
  fillsTheScreen,
  firstDrawnRow,
  promptRow,
  type Screen,
  screenOf,
  theFirstScreenWith,
  theScreenBeforeLeaving,
  theSettledScreen,
} from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** What the opening always says, whatever the terminal is like — a row of the TOP region. */
const OPENED = 'a session over this project';

/**
 * THE OLDEST LINE ON THE ROLL — the end of the one sentence the opening LANDS.
 *
 * ⛔ AN OPENING IS TWO HALVES AND THEY GO TO TWO PLACES (`src/repl/panel.ts`, `Opening.above`):
 * the arrangement is chrome and stays in the fixed region at the top, and this is what the
 * session SAYS, so it goes on the roll where everything else it says goes. Which is why walking
 * to the top of the roll ends here rather than on the first thing a caller typed.
 *
 * ⚠️ IT WAS THE FIRST WORDS OF THAT SENTENCE — `It runs the` — AND THEY ARE NOT ONLY ITS. The
 * session refuses a word it does not run with *It runs the reads of the record* (`src/repl/
 * gate.ts`), so every page below that shows a refusal answers *the oldest line is here* whether
 * it is or not — and the case that walks to the top submits three lines the session refuses. The
 * end of the sentence is on the roll and nowhere else.
 */
const OLDEST = 'refuses the ones that write';

/** ⛔ The sequence that erases the caller's history. It is not ours to write, in any buffer. */
const ERASES_THE_HISTORY = `${ESC}[3J`;
/** What the layout writes when it starts the page over. It is let through. */
const REDRAWS_EVERYTHING = `${ESC}[2J`;
/** The two halves of the constant the layout writes them in, in the order it writes them. */
const CLEARS_THE_TERMINAL = `${REDRAWS_EVERYTHING}${ERASES_THE_HISTORY}${ESC}[H`;
/** Into the screen a full-screen program takes, and back out of it. */
const TAKES_THE_SCREEN = `${ESC}[?1049h`;
const GIVES_THE_SCREEN_BACK = `${ESC}[?1049l`;

/** A notch of the wheel, as a terminal reporting the mouse in SGR sends it. */
const wheel = (button: number): string => `${ESC}[<${button};10;5M`;
const WHEEL_UP = wheel(64);
const _WHEEL_DOWN = wheel(65);

/** The four keys that move the window, as a terminal sends them. */
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;
const TO_THE_TOP = `${ESC}[H`;
const TO_THE_TAIL = `${ESC}[F`;

/** How many times `verify` is run to put more on the roll than a screen can hold. */
const ENOUGH_TO_OVERFLOW = 3;

/**
 * HOW MANY LINES ARE SUBMITTED ONTO A WINDOW WITH FAR MORE ROOM THAN THEM — the other fixture,
 * for the end of the roll where there is nothing to scroll to.
 *
 * FOUR RATHER THAN ONE, and the number is the arithmetic of the defect: a notch of the wheel is
 * worth three lines (`src/repl/console.ts`), so a roll of nine lines loses three of them per
 * notch and the count on the page names the loss. One line would be gone in a single notch and
 * the case could not tell *three at a time* from *all of it at once*.
 */
const ENOUGH_TO_FILL = 4;

/**
 * Backspace, as a terminal sends it — what takes a letter back off the row being typed.
 *
 * Spelled by its code point, like every control byte in this repository: a raw one in a
 * source file is a character an edit destroys without anybody seeing it happen.
 */
const ERASE = '\u007f';

/** How many `times` occurs in `text`. */
function times(text: string, what: string): number {
  return text.split(what).length - 1;
}

// ---------------------------------------------------------------------------
// The door: one rule, both directions
// ---------------------------------------------------------------------------

describe('the erase of the caller’s history is taken out and nothing else is', () => {
  it('⛔ takes the history erase out and lets the screen erase through', () => {
    // BOTH DIRECTIONS IN ONE CASE, because the rule is a distinction rather than a refusal: a
    // door that removed both would pass the half that says the history survives and leave the
    // library believing it had cleared a screen it had not.
    expect(withoutTheHistoryErase(CLEARS_THE_TERMINAL)).toBe(`${REDRAWS_EVERYTHING}${ESC}[H`);
    // The history erase alone, wherever it is.
    expect(withoutTheHistoryErase(`a${ERASES_THE_HISTORY}b`)).toBe('ab');
    // The screen erase alone, untouched.
    expect(withoutTheHistoryErase(`a${REDRAWS_EVERYTHING}b`)).toBe(`a${REDRAWS_EVERYTHING}b`);
    // Every one of them, in one write.
    expect(times(withoutTheHistoryErase(CLEARS_THE_TERMINAL.repeat(3)), ERASES_THE_HISTORY)).toBe(
      0,
    );
    expect(times(withoutTheHistoryErase(CLEARS_THE_TERMINAL.repeat(3)), REDRAWS_EVERYTHING)).toBe(
      3,
    );
    // And a frame with neither in it is the same string, which is the case every keystroke is.
    const ordinary = `${ESC}[2K${PROMPT} verify${ESC}[?25h`;
    expect(withoutTheHistoryErase(ordinary)).toBe(ordinary);
  });

  it('says when the library asked, so a guard over the absence cannot go vacuous', () => {
    // ⚠️ THE ABSENCE ON ITS OWN IS SATISFIED BY A SESSION THAT NEVER MADE THE LIBRARY ASK, which
    // is why every case below that counts the history erase also counts this. The two arrive in
    // one constant, so the screen erase is the witness that there was something to remove.
    expect(erasesTheScreen(CLEARS_THE_TERMINAL)).toBe(true);
    expect(erasesTheScreen(`${PROMPT} verify`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The roll: what is kept, what is shown, and what falls off the top
// ---------------------------------------------------------------------------

/**
 * THE REGION EVERY LINE OF A FIXTURE LANDS IN, and it is deliberately arbitrary.
 *
 * How far back a reader may stand is bounded by what the window SHOWS, so landing a line takes
 * the region (`src/repl/scrolling.ts`, {@link landedIn}). Every line the helper below lands,
 * though, lands under a reader AT THE TAIL — and the tail is nought whatever the window holds,
 * so no number here can change what is built. A case about the ceiling names its own region at
 * the point it asks about one.
 */
const ANY_REGION = { room: 10, columns: 80 } as const;

/** How many lines one notch of the wheel is worth (`src/repl/console.ts`, `A_NOTCH`). */
const A_NOTCH = 3;

/** A roll with `many` lines on it, each naming its own number so a window can be identified. */
function said(many: number, wide = 1): Scrolling {
  let roll = NOTHING_SAID;
  for (let at = 0; at < many; at += 1) {
    roll = landedIn(roll, `line-${at}`.padEnd(wide, '.'), ANY_REGION.room, ANY_REGION.columns);
  }
  return roll;
}

describe('the roll the middle region is a window onto', () => {
  it('shows the last lines that fit, and follows the tail as more land', () => {
    const roll = said(10);
    expect(theWindowOn(roll, 3, 80)).toEqual(['line-7', 'line-8', 'line-9']);
    // A LINE THAT LANDS IS SEEN, because the reader is at the tail and the tail is where it went.
    expect(theWindowOn(landedIn(roll, 'line-10', 3, 80), 3, 80)).toEqual([
      'line-8',
      'line-9',
      'line-10',
    ]);
    // A window taller than the roll shows all of it and asks for no more.
    expect(theWindowOn(said(2), 9, 80)).toEqual(['line-0', 'line-1']);
    // And a region with no rows shows nothing rather than one line anyway.
    expect(theWindowOn(roll, 0, 80)).toEqual([]);
  });

  it('⛔ does not move a reader who has walked back, however much lands', () => {
    // THE PROMISE THE CALLER ASKED FOR IN AS MANY WORDS. Content new to a session that is being
    // READ may not pull the page out from under whoever is reading it.
    const walked = scrolledBy(said(10), 4, 3, 80);
    const seen = theWindowOn(walked, 3, 80);
    expect(seen).toEqual(['line-3', 'line-4', 'line-5']);
    // ⚠️ AND THE READER WALKS ONE FURTHER BACK FOR EVERY LINE THAT LANDS, which is what holds
    // the CONTENT still: a distance from the tail is a distance from something that moves.
    expect(landedIn(walked, 'later-0', 3, 80).back).toBe(walked.back + 1);
    let landing = walked;
    for (let at = 0; at < 5; at += 1) landing = landedIn(landing, `later-${at}`, 3, 80);
    expect(theWindowOn(landing, 3, 80), 'new output jumped a reader who had walked back').toEqual(
      seen,
    );
    // AND THE TAIL IS STILL THERE TO GO BACK TO, so the case above is a reader held still rather
    // than a roll that stopped growing.
    expect(theWindowOn(toTheTail(landing), 3, 80)).toEqual(['later-2', 'later-3', 'later-4']);
  });

  it('stops at both ends rather than running off either', () => {
    const roll = said(6);
    // ⚠️ PAST THE OLDEST LINE IS THE OLDEST LINE AT THE TOP OF A FULL WINDOW, and this case used
    // to expect `['line-0']` — the whole of a three-row region spent on one line, with two rows
    // of nothing under it. That expectation was the defect written down: the end of a roll is
    // where the window is FULL, not where the roll runs out ({@link backAtMost}).
    expect(theWindowOn(scrolledBy(roll, 99, 3, 80), 3, 80)).toEqual(['line-0', 'line-1', 'line-2']);
    expect(theWindowOn(toTheTop(roll, 3, 80), 3, 80)).toEqual(
      theWindowOn(scrolledBy(roll, 99, 3, 80), 3, 80),
    );
    // Past the tail is the tail.
    expect(theWindowOn(scrolledBy(scrolledBy(roll, 2, 3, 80), -99, 3, 80), 3, 80)).toEqual(
      theWindowOn(roll, 3, 80),
    );
    // A roll with nothing on it cannot be walked at all.
    expect(scrolledBy(NOTHING_SAID, 5, 3, 80).back).toBe(0);
  });

  it('⛔ 🆕 refuses to walk back at all when the whole roll is already on the page', () => {
    // ⛔ THE DEFECT THIS DELIVERY IS ABOUT, in the smallest form it has. The window is taken from
    // the END backwards, so a `back` the region cannot pay for takes a line off the FOOT of the
    // page and brings nothing down from above — and above a roll that fits entirely there is
    // nothing to bring. What the caller saw was their own output vanishing three lines at a time
    // from a page they had asked to see more of.
    const roll = said(4);
    const room = 9;
    expect(
      theWindowOn(roll, room, 80),
      'the fixture does not fit in the region, so this case is about something else',
    ).toEqual([...roll.said]);
    // THE CEILING IS NOUGHT: there is nowhere to walk back TO.
    expect(backAtMost(roll.said, room, 80)).toBe(0);
    for (const notches of [1, 2, 3]) {
      const walked = scrolledBy(roll, A_NOTCH * notches, room, 80);
      expect(
        walked.back,
        `${notches} notch(es) of the wheel moved a reader who had nowhere to go`,
      ).toBe(0);
      expect(
        theWindowOn(walked, room, 80),
        `${notches} notch(es) of the wheel took ${A_NOTCH * notches} lines off the foot of the page`,
      ).toEqual([...roll.said]);
      // AND THE VALUE ITSELF IS THE SAME ONE, which is what makes the frame identical rather than
      // merely equal: a no-op that rebuilt the state would be a redraw of the page on every notch.
      expect(walked, 'a wheel that moves nothing still produced a new roll').toBe(roll);
    }
    // AND HOME IS THE SAME ANSWER, because it is the same ceiling.
    expect(theWindowOn(toTheTop(roll, room, 80), room, 80)).toEqual([...roll.said]);
  });

  it('🆕 walks back to a window that is FULL at the oldest line, and no further', () => {
    // THE OTHER END, WHICH IS WHAT THE FIX ABOVE COULD HAVE BOUGHT ITSELF WITH: a roll with more
    // on it than the region holds still walks all the way to its first line.
    const roll = said(10);
    const room = 3;
    expect(
      backAtMost(roll.said, room, 80),
      'the ceiling is not the lines the window cannot show',
    ).toBe(7);
    expect(theWindowOn(toTheTop(roll, room, 80), room, 80)).toEqual(['line-0', 'line-1', 'line-2']);
    // AND EVERY LINE OF `back` UNDER THE CEILING TRADES ONE LINE AT THE FOOT FOR ONE AT THE HEAD,
    // which is what scrolling IS — asserted by the window rather than by the number.
    expect(theWindowOn(scrolledBy(roll, 1, room, 80), room, 80)).toEqual([
      'line-6',
      'line-7',
      'line-8',
    ]);
    // A REGION THAT GREW FINDS THE READER LESS FAR BACK THAN IT LEFT THEM, and the window says so
    // rather than the state: the ceiling of the taller window is lower, so the same `back` is
    // clamped where it is READ ({@link theWindowOn}) — which is the resize a reader who walked to
    // the top and then dragged their window taller does.
    const top = toTheTop(roll, room, 80);
    expect(theWindowOn(top, 5, 80), 'a taller window dropped lines off its own foot').toEqual([
      'line-0',
      'line-1',
      'line-2',
      'line-3',
      'line-4',
    ]);
  });

  it('counts a line that FOLDS as the rows it takes, so a window is rows and not lines', () => {
    // ⚠️ A LINE IS NOT A ROW, and a window filled as though it were is a frame taller than the
    // screen — which is the one thing this model may not produce. A line already folded at the
    // width the session opened at becomes two rows the moment the caller narrows their window.
    const long = 'x'.repeat(120);
    expect(rowsForTheLine(long, 80)).toBe(2);
    expect(rowsForTheLine(long, 40)).toBe(3);
    expect(rowsForTheLine('short', 80)).toBe(1);
    // The escapes come off first: a painted line is longer in bytes than it is in columns.
    expect(rowsForTheLine(`${ESC}[1m${'x'.repeat(70)}${ESC}[22m`, 80)).toBe(1);
    // A line the product's own renderer already folded is several rows before any terminal
    // touches it, and each part is asked separately: the whole run measured as one is one number
    // for something the screen draws as three.
    expect(rowsForTheLine(`${long}\n${long}`, 80)).toBe(4);
    expect(rowsForTheLine('one\ntwo', 80)).toBe(2);
    // And a width nobody reported folds nothing but still counts the parts.
    expect(rowsForTheLine(long, 0)).toBe(1);
    expect(rowsForTheLine('one\ntwo', 0)).toBe(2);
    // SO THE WINDOW HOLDS FEWER LINES ON A NARROWER TERMINAL, over the same roll.
    const roll = said(6, 120);
    expect(rowsOfTheWindow(theWindowOn(roll, 4, 200), 200)).toBeLessThanOrEqual(4);
    expect(rowsOfTheWindow(theWindowOn(roll, 4, 60), 60)).toBeLessThanOrEqual(4);
    expect(theWindowOn(roll, 4, 60).length).toBeLessThan(theWindowOn(roll, 4, 200).length);
    // 🆕 AND THE CEILING FALLS IN THE SAME PROPORTION, because it is counted in what a window
    // HOLDS rather than in lines: a four-row region takes four of these lines at two hundred
    // columns and two of them at sixty, so there are two more of them to walk back through.
    expect(backAtMost(roll.said, 4, 200), 'the ceiling counted rows the window cannot hold').toBe(
      2,
    );
    expect(backAtMost(roll.said, 4, 60), 'the fold did not count towards the ceiling').toBe(4);
    // ASSERTED BY WHAT THE TOP OF THE ROLL LOOKS LIKE, which is the reader's own reading of it:
    // the oldest line, and as many after it as the region can pay for at this width.
    expect(theWindowOn(toTheTop(roll, 4, 60), 4, 60)).toEqual(roll.said.slice(0, 2));
    expect(theWindowOn(toTheTop(roll, 4, 200), 4, 200)).toEqual(roll.said.slice(0, 4));
  });

  it('🆕 keeps a reader inside the ceiling when the roll drops its oldest line', () => {
    // ⚠️ THE SITE THE LIST OF SITES DID NOT HAVE. Where a reader may stand is decided in four
    // places and the fourth is the one nobody scrolls with: a line LANDING walks a reader who had
    // walked back one further, so the content under their eyes stands still — and while the roll
    // is growing the ceiling grows with it, so the step is free. At {@link THE_CEILING} the roll
    // cannot grow: the oldest line falls off for every line that lands, so that one step is a
    // step past the end. It costs nothing on a page — the window clamps what it reads — and it
    // leaves the STATE holding a number no gesture can undo but a scroll all the way forward.
    const room = 3;
    const full = said(THE_CEILING);
    const top = toTheTop(full, room, 80);
    expect(top.back).toBe(THE_CEILING - room);
    const landed = landedIn(top, 'newest', room, 80);
    expect(landed.said.length, 'the roll grew past its own ceiling').toBe(THE_CEILING);
    expect(
      landed.back,
      'a line that landed walked a reader further back than the roll still reaches',
    ).toBe(THE_CEILING - room);
    // AND THE PAGE IS THE TOP OF WHAT SURVIVED: the oldest line the ceiling left, window full.
    expect(theWindowOn(landed, room, 80)).toEqual(['line-1', 'line-2', 'line-3']);
  });

  it('🆕 keeps a ceiling, and what falls off the top stops being reachable by scrolling', () => {
    // A ROLL OF OUR OWN IS MEMORY OF OUR OWN, and without a ceiling a session that runs for a day
    // and prints is a leak with a pleasant name. What the ceiling costs is written down where it
    // is chosen (`src/repl/scrolling.ts`): a reader loses a scroll and never a fact, because the
    // record is in `.mnema/` and signed.
    const over = said(THE_CEILING + 25);
    expect(over.said.length, 'the roll grew past its own ceiling').toBe(THE_CEILING);
    // ASSERTED BY WHAT STOPS BEING REACHABLE rather than by the length alone: walking as far back
    // as the roll allows lands on the line the ceiling left, and the ones before it are gone.
    expect(theWindowOn(toTheTop(over, 1, 80), 1, 80)).toEqual(['line-25']);
    expect(over.said.includes('line-24'), 'a line past the ceiling survived').toBe(false);
    // AND THE TAIL IS UNTOUCHED, so the ceiling took from the right end.
    expect(theWindowOn(over, 1, 80)).toEqual([`line-${THE_CEILING + 24}`]);
    // NOT VACUOUS: a roll under the ceiling keeps its oldest line.
    expect(said(THE_CEILING - 1).said.includes('line-0')).toBe(true);
  });

  it('hands the whole roll back as the transcript, and nothing beside it', () => {
    // ONE LIST AND NOT TWO, which is what makes the ceiling honest: a second copy kept for the
    // way out would be a second ceiling, and the one nobody was watching would be the leak.
    expect(theTranscript(said(3))).toEqual(['line-0', 'line-1', 'line-2']);
    expect(theTranscript(NOTHING_SAID)).toEqual([]);
    // A reader part-way up the roll changes what is SHOWN and never what is kept.
    expect(theTranscript(scrolledBy(said(3), 2, 1, 80))).toEqual(theTranscript(said(3)));
  });
});

// ---------------------------------------------------------------------------
// The wheel: the smallest set of modes, and what a report means
// ---------------------------------------------------------------------------

describe('the wheel', () => {
  it('⛔ asks for press-and-release in SGR, and for nothing else', () => {
    // THE COUNT IS THE DECISION. Motion reporting is what a program needs for hover and for
    // dragging, and this page has neither; what it costs is a report per cell the pointer
    // crosses. The console this page was measured from turns them off.
    expect(WATCHING_THE_WHEEL).toBe(`${ESC}[?1000h${ESC}[?1006h`);
    expect(THE_WHEEL_BACK).toBe(`${ESC}[?1006l${ESC}[?1000l`);
    for (const refused of ['?1002', '?1003']) {
      expect(WATCHING_THE_WHEEL, `${refused} was asked for`).not.toContain(refused);
    }
  });

  it('reads the two notches, swallows every other report, and types anything else', () => {
    // WITHOUT ITS ESCAPE, which is the form the keyboard library hands over: a mouse report is a
    // well-formed control sequence whose final byte the library has no name for, so it arrives as
    // ordinary text with the leading escape stripped. The pty cases below are the witness that
    // this really is the form that arrives.
    expect(fromTheMouse('[<64;10;5M')).toBe('up');
    expect(fromTheMouse('[<65;10;5M')).toBe('down');
    // With modifiers held, the wheel is still the wheel.
    expect(fromTheMouse('[<80;10;5M')).toBe('up');
    // A CLICK IS SWALLOWED AND NOT TYPED, which is the half that is easy to miss: it is a report
    // this page has no use for AND it is still a report.
    expect(fromTheMouse('[<0;12;7M')).toBe('nothing');
    expect(fromTheMouse('[<0;12;7m')).toBe('nothing');
    // AND ANYTHING THAT IS NOT A REPORT IS NOT ONE, so a caller who really typed those characters
    // has them typed.
    for (const typed of ['[<64;10;5', 'x', '', '[<a;10;5M', '[<64;10;5M ']) {
      expect(fromTheMouse(typed), JSON.stringify(typed)).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` at the shell, in this process. */
async function shell(...argv: string[]): Promise<void> {
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(argv, io);
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-screen-'));
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
  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 240_000);

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
}): Promise<Ran> {
  return drive(fixture(), options);
}

/** The step every session begins with. */
const opens: Step = opensAConsole(PROMPT);

/** The step every session ends with. */
const leaves: Step = { types: `${LEAVE}\r`, until: () => true, what: 'left' };

/** A step that types something and waits for the frame it caused. */
function presses(what: string, keys: string): Step {
  return { types: keys, until: aFrameSince(PROMPT), what };
}

/**
 * A step that submits a line and waits for the frame its answer produced.
 *
 * ⚠️ EVERY LINE HAS TO BE A DIFFERENT ONE, and that is a property of the model rather than a
 * habit of these cases. The layout writes NOTHING for a frame identical to the one on the
 * screen, and two runs of the same verb produce identical frames once the window has filled:
 * the window shows the last rows of the roll, and the last rows of two identical answers are the
 * same rows. Measured — the second such step waited out the driver's whole budget and reported
 * *the session never ran verify*, which is a defect of the case and not of the console.
 */
function submits(line: string): Step {
  return { types: `${line}\r`, until: aFrameSince(PROMPT), what: `submitted ${line}` };
}

/** A line the session answers with something naming it, so no two frames can be alike. */
function says(which: number): string {
  return `saying-${which}`;
}

/**
 * The screen as it was at the end of step `at`, replayed at the size it was driven at.
 *
 * ⚠️ READING BY POSITION IS ONLY HONEST AFTER A STEP THAT DRAWS EXACTLY ONE FRAME, and that is
 * measured rather than assumed. A step ends where the stream went quiet, so a step that draws
 * TWO frames can leave the boundary between them — and what is replayed is then the page from
 * before the thing the case is about. Measured, per event, at a hundred and twenty by forty:
 *
 *   - a key, an arrow, a notch of the wheel — **one** frame each;
 *   - a whole line submitted — **two** (the echo lands, then the answer);
 *   - a resize — **two**, because the layout library keeps its own watch and it is synchronous.
 *
 * SO THIS IS USED AFTER KEYS AND AFTER THE OPENING, and nowhere else. Every read whose step is a
 * resize or a submitted line finds its page by what the page HOLDS instead
 * (`support/screen.ts`, `theSettledScreen`, `theFirstScreenWith`, `theFirstScreenWhere`).
 */
function screenAt(ran: Ran, at: number, columns: number, rows: number): Screen {
  return screenOf(ran.bytes.slice(0, ran.at[at] as number), columns, rows);
}

/** Which row a piece of text is on, and −1 when it is nowhere. */
function rowOf(screen: Screen, what: string): number {
  return screen.rows.findIndex((row) => row.includes(what));
}

/**
 * HOW MANY ROWS OF THE PAGE HAVE ANYTHING ON THEM — the caller's own reading of the defect below.
 *
 * *The text simply disappears from the middle* is a statement about a COUNT: a page with
 * twenty-three rows of words on it that answers a scroll with twenty is a page that lost three,
 * whatever else moved. It is asked beside the whole-page comparison rather than instead of it,
 * because the count is what names the symptom in the message and the comparison is what proves
 * the page did not move at all.
 */
function rowsWithText(screen: Screen): number {
  return screen.rows.filter((row) => row.trim().length > 0).length;
}

/**
 * ⛔ THE ERASE, ASKED FOR IN BOTH DIRECTIONS OVER ONE RUN.
 *
 * The absence is the promise; the presence of the screen erase is what says the absence is
 * MERITED rather than vacuous. The library writes the two in one constant, and it reaches that
 * path on every session there is — it starts the page over while it is tearing down, because the
 * frame it last drew filled the viewport, which every frame of this console does.
 */
function theHistorySurvived(ran: Ran, what: string): void {
  expect(times(ran.bytes, ERASES_THE_HISTORY), `${what}: the caller's history was erased`).toBe(0);
  expect(
    erasesTheScreen(ran.bytes),
    `${what}: the library never started the page over, so the absence above is vacuous`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------
// The three regions
// ---------------------------------------------------------------------------

describe('the console takes the screen and draws three regions on it', () => {
  it('⛔ takes the alternate screen once, gives it back once, and fills it', async () => {
    const columns = 100;
    const rows = 24;
    const ran = await inPty({ columns, rows, steps: [opens, leaves] });
    expect(times(ran.bytes, TAKES_THE_SCREEN), 'the screen was not taken exactly once').toBe(1);
    expect(times(ran.bytes, GIVES_THE_SCREEN_BACK), 'the screen was not given back once').toBe(1);
    const opened = screenAt(ran, 0, columns, rows);
    // THE SESSION IS ON THE ALTERNATE BUFFER, which is what makes the two fixed regions possible.
    expect(opened.alternate, 'the session drew on the caller’s own buffer').toBe(true);
    // AND NOTHING OF THE CALLER'S WAS TOUCHED TO DO IT: no scroll fed their history, because a
    // scroll on the alternate buffer feeds nothing (`support/screen.ts`).
    expect(opened.above, 'a row of the caller’s went into their scrollback').toEqual([]);
    // THE FRAME IS THE SCREEN. The opening is on the first row, the input area ends on the last,
    // and there is nothing under it.
    expect(rowOf(opened, OPENED), 'the top region is not at the top').toBeGreaterThanOrEqual(0);
    fillsTheScreen(opened, rows, 'the page it opened with');
    theHistorySurvived(ran, 'a session that opened and left');
  }, 240_000);

  it('⛔ leaves the top and the bottom exactly where they were, however much is printed', async () => {
    const columns = 100;
    const rows = 24;
    const steps: Step[] = [opens];
    for (let at = 0; at < ENOUGH_TO_OVERFLOW; at += 1) steps.push(submits(says(at)));
    steps.push(leaves);
    const ran = await inPty({ columns, rows, steps });
    const opened = screenAt(ran, 0, columns, rows);
    // AND THE PRINTED PAGE IS THE ONE THAT SETTLED, found by the width it was drawn at rather
    // than by the boundary of a step that draws two frames ({@link screenAt}).
    const printed = theSettledScreen(ran.bytes, columns, rows);
    // THE ROW EACH REGION IS ON, before and after — which is the whole requirement, in one
    // assertion each. In the model this replaces, the first of these fell off the top of the
    // screen and the second one was held down by arithmetic that had to be corrected four times.
    expect(rowOf(printed, OPENED), 'the top region moved when the session printed').toBe(
      rowOf(opened, OPENED),
    );
    expect(promptRow(printed, PROMPT), 'the bottom region moved when the session printed').toBe(
      promptRow(opened, PROMPT),
    );
    fillsTheScreen(printed, rows, 'a page that has printed');
    // AND THE PRINTING REALLY DID OUTGROW THE MIDDLE, or the two assertions above are about a
    // page nothing happened to: what the first run said is no longer reachable without scrolling.
    expect(
      printed.text.includes(`${PROMPT} ${says(0)}`),
      'nothing was pushed out of the window, so the case proves nothing',
    ).toBe(false);
    // ⛔ AND THE CALLER'S OWN BUFFER IS STILL WHOLE.
    expect(printed.above, 'a row went into the caller’s scrollback').toEqual([]);
    theHistorySurvived(ran, 'a session that printed more than the screen holds');
  }, 240_000);

  it('⛔ gives back the page that opened when the caller asks for a clean one', async () => {
    // ⚠️ THIS PROMISE OUTLIVED THE MODEL AND ALMOST LOST ITS GUARD. *A clean page is the page
    // the session opened with* was asserted where a clean page was MADE — a screen of the
    // caller's carried into their scrollback and the opening written over it
    // (`a-page-that-opens-clean.test.ts`, gone with that machinery). Clearing is the ROLL being
    // emptied now (`src/repl/scrolling.ts`), and a mutation that emptied it to NOTHING instead
    // of back to the opening scored zero reds across the whole bench. This is that zero closed.
    const columns = 100;
    const rows = 24;
    const ran = await inPty({
      columns,
      rows,
      steps: [opens, submits(says(0)), submits(`${CLEAR}`), leaves],
    });
    // BOTH PAGES FOUND BY WHAT THEY HOLD: a submitted line draws two frames, so the boundary of
    // its step is not a page ({@link screenAt}). The page that SAID something is the first one
    // the echo is on; the page after the word that clears is the one the session left, because
    // nothing lands after it.
    const said = theFirstScreenWith(ran.bytes, `${PROMPT} ${says(0)}`, columns, rows);
    const cleared = theScreenBeforeLeaving(ran.bytes, columns, rows);
    // WHAT THE SESSION SAID IS GONE FROM THE PAGE, which is what the word means.
    expect(said.text, 'the session never said anything to clear').toContain(`${PROMPT} ${says(0)}`);
    expect(cleared.text, 'what the session said survived the clean page').not.toContain(
      `${PROMPT} ${says(0)}`,
    );
    // AND THE OPENING IS BACK, both halves of it: the arrangement at the top, which never left,
    // and the line it lands, which is put back on the roll (`src/repl/panel.ts`, `Opening.above`).
    expect(cleared.text, 'the arrangement is not on the clean page').toContain(OPENED);
    expect(cleared.text, 'the opening’s own line is not on the clean page').toContain(OLDEST);
    fillsTheScreen(cleared, rows, 'the clean page');
    theHistorySurvived(ran, 'a session that cleared its page');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The scroll
// ---------------------------------------------------------------------------

describe('the middle region scrolls, and the two fixed regions do not', () => {
  it('walks back with PgUp and the wheel, comes back with PgDn and End', async () => {
    const columns = 100;
    const rows = 24;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        submits(says(0)),
        submits(says(1)),
        presses('walked a page back', PAGE_UP),
        presses('walked a page forward', PAGE_DOWN),
        presses('turned the wheel back', WHEEL_UP.repeat(2)),
        presses('went to the tail', TO_THE_TAIL),
        presses('went to the top', TO_THE_TOP),
        leaves,
      ],
    });
    const at = (step: number): Screen => screenAt(ran, step, columns, rows);
    const printed = at(2);
    const back = at(3);
    const forward = at(4);
    const wheeled = at(5);
    const tail = at(6);
    const top = at(7);
    // WALKING BACK SHOWS SOMETHING THE TAIL DID NOT, which is what a scroll IS.
    expect(back.text, 'PgUp showed the same window as the tail').not.toBe(printed.text);
    // AND IT COMES BACK TO EXACTLY WHAT IT LEFT.
    expect(forward.text, 'PgDn did not come back to the window PgUp left').toBe(printed.text);
    // THE WHEEL IS THE SAME AFFORDANCE BY ANOTHER ROAD — and this is the case that proves the
    // report really arrives in the form the decode expects, because nothing else could scroll it.
    expect(wheeled.text, 'the wheel moved nothing').not.toBe(printed.text);
    expect(tail.text, 'End did not come back to the tail').toBe(printed.text);
    // AND THE TOP IS THE OLDEST LINE THE ROLL STILL HOLDS, which is what Home means. It is
    // asserted by the LINE rather than by being different from a page back: on a short roll one
    // page already reaches the top, and a case that demanded a difference would be demanding a
    // fixture rather than a behaviour.
    expect(top.text, 'Home did not reach the oldest line on the roll').toContain(OLDEST);
    expect(top.text, 'Home showed the same window as the tail').not.toBe(printed.text);
    // ⛔ AND NOT ONE OF THE FIVE MOVED A FIXED REGION.
    for (const [what, screen] of [
      ['a page back', back],
      ['a page forward', forward],
      ['the wheel', wheeled],
      ['the tail', tail],
      ['the top', top],
    ] as const) {
      expect(rowOf(screen, OPENED), `${what} moved the top region`).toBe(rowOf(printed, OPENED));
      expect(promptRow(screen, PROMPT), `${what} moved the bottom region`).toBe(
        promptRow(printed, PROMPT),
      );
      fillsTheScreen(screen, rows, what);
    }
    // ⛔ AND THE ROW BEING TYPED IS UNTOUCHED BY ALL OF THEM, which is the defect a wheel report
    // read as text would produce: `[<64;10;5M` typed onto the line a caller was writing.
    const typed = (screen: Screen): string =>
      (screen.rows[promptRow(screen, PROMPT)] as string).trim();
    for (const [what, screen] of [
      ['the wheel', wheeled],
      ['a page back', back],
    ] as const) {
      expect(typed(screen), `${what} put something on the row being typed`).toBe(PROMPT);
    }
    theHistorySurvived(ran, 'a session that scrolled');
  }, 240_000);

  it('⛔ 🆕 answers the wheel with nothing at all when the whole page already fits', async () => {
    // ⛔ THE CASE THE CALLER FOUND, IN HIS OWN WORDS: *the mouse scroll makes the text simply
    // disappear from the middle*. He had a big window and a session that had printed less than it
    // holds, and every notch of the wheel took three lines off the FOOT of the page — the window
    // is taken from the end backwards, so a `back` the region cannot pay for shortens it from
    // below and brings nothing down from above, because above a roll that fits there is nothing.
    // Measured here before the fix, at 190 by 64: twenty-three rows with text, then twenty, then
    // seventeen — his own output gone from a page he had asked to see more of.
    const columns = 190;
    const rows = 64;
    const steps: Step[] = [opens];
    // ⚠️ MEASURED AFTER PRINTING, because a page that has just opened is the least representative
    // instant there is — and four lines of it, so that a notch worth three lines is a loss the
    // count can name rather than the whole of the roll at once.
    for (let at = 0; at < ENOUGH_TO_FILL; at += 1) steps.push(submits(says(at)));
    // ⚠️ EACH NOTCH IS ITS OWN STEP AND NONE OF THEM WAITS FOR A FRAME. What is under test is a
    // gesture that draws NOTHING: the layout writes nothing for a frame identical to the one on
    // the screen, so a step waiting for one here would wait for ever once the defect is gone
    // (`support/pty.ts`, {@link aFrameSince}). The wait is the stream going quiet, and what makes
    // that honest is the step after them — a key that really does redraw, waited for properly, so
    // every byte the three notches could have written is in front of it.
    for (let at = 0; at < 3; at += 1) {
      steps.push({ types: WHEEL_UP, until: () => true, what: `turned the wheel ${at + 1}` });
    }
    steps.push(presses('typed a letter', 'x'));
    steps.push({ types: `${ERASE}${LEAVE}\r`, until: () => true, what: 'left' });
    const ran = await inPty({ columns, rows, steps });
    const printed = screenAt(ran, ENOUGH_TO_FILL, columns, rows);
    // THE PAGE THIS IS ABOUT IS THE ONE THAT HAD ANSWERED, said out loud rather than assumed: an
    // index is honest here only if the page at it is the printed one ({@link screenAt}).
    expect(printed.text, 'the page read is not the one the last line was answered on').toContain(
      says(ENOUGH_TO_FILL - 1),
    );
    // ⛔ AND THE WHOLE ROLL IS ON IT, which is the premise the case rests on: the oldest line the
    // session said is still on the page, so there is nothing above the window to scroll to.
    expect(
      printed.text,
      'the roll outgrew the window, so this case is about the other end of it',
    ).toContain(OLDEST);
    for (let notch = 1; notch <= 3; notch += 1) {
      const screen = screenAt(ran, ENOUGH_TO_FILL + notch, columns, rows);
      expect(
        rowsWithText(screen),
        `${notch} notch(es) of the wheel: the page went from ${rowsWithText(printed)} rows with text to ${rowsWithText(screen)}`,
      ).toBe(rowsWithText(printed));
      expect(screen.rows, `${notch} notch(es) of the wheel changed the page`).toEqual(printed.rows);
    }
    // ⛔ AND NOT ONE FRAME WAS WRITTEN FOR ANY OF THEM. This is the byte-level half of the same
    // claim and the one a race cannot fake: bytes are ordered, so anything the three notches wrote
    // is inside this slice, which ends on a frame that was waited for. The one frame in it is the
    // letter's own — nought would mean the letter never drew and the measurement is vacuous.
    const gesture = ran.bytes.slice(
      ran.at[ENOUGH_TO_FILL] as number,
      ran.at[ENOUGH_TO_FILL + 4] as number,
    );
    expect(
      rowsOfTheFrames(gesture).length,
      'the wheel redrew a page that had nowhere to scroll',
    ).toBe(1);
    theHistorySurvived(ran, 'a session that turned the wheel on a page that fits');
  }, 240_000);

  it('⛔ 🆕 walks a roll bigger than the window to its first line, with the window full', async () => {
    // ⛔ THE OPPOSITE END, WHICH IS WHAT THE CASE ABOVE COULD HAVE BOUGHT ITSELF WITH. A ceiling
    // that stopped a reader early would answer the complaint and cost the affordance: whoever has
    // more roll than region must still reach the first line of it. And *reach* is the whole of the
    // claim — the oldest line at the top of a FULL window, not alone on a page with room for four,
    // which is what Home did before this and is the same defect wearing a key.
    const columns = 100;
    const rows = 24;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        submits(says(0)),
        submits(says(1)),
        submits(says(2)),
        presses('turned the wheel to the top', WHEEL_UP.repeat(20)),
        presses('went back to the tail', TO_THE_TAIL),
        presses('went to the top', TO_THE_TOP),
        leaves,
      ],
    });
    const printed = screenAt(ran, 3, columns, rows);
    const wheeled = screenAt(ran, 4, columns, rows);
    const tail = screenAt(ran, 5, columns, rows);
    const top = screenAt(ran, 6, columns, rows);
    // THE ROLL REALLY DID OUTGROW THE WINDOW, or every assertion below is about the case above:
    // the oldest line is off the page at the tail.
    expect(
      printed.text,
      'the whole roll still fits, so nothing here is about walking back',
    ).not.toContain(OLDEST);
    // ⛔ THE WHEEL REACHES THE FIRST LINE OF THE ROLL — asserted by the line, not by a count.
    expect(wheeled.text, 'the wheel no longer reaches the oldest line on the roll').toContain(
      OLDEST,
    );
    // ⛔ AND THE WINDOW UNDER IT IS FULL, which is the half a ceiling one line too high would
    // still pass: the lines that FOLLOW the oldest one are on the page with it. Before this, the
    // top of the roll was the oldest line alone with three rows of nothing under it.
    expect(
      wheeled.text,
      'the oldest line is on the page alone: the window did not fill under it',
    ).toContain(`${PROMPT} ${says(0)}`);
    // AND THE TAIL IS STILL THERE TO COME BACK TO, so the walk above is a window that moved
    // rather than a roll that stopped growing.
    expect(tail.rows, 'End did not come back to the page the session had printed').toEqual(
      printed.rows,
    );
    // ⛔ AND HOME IS THE SAME PLACE BY ANOTHER ROAD, which is what one ceiling in one function
    // buys: the key and the wheel cannot acquire different ideas of where the end is.
    expect(top.rows, 'Home and the wheel disagree about where the top of the roll is').toEqual(
      wheeled.rows,
    );
    theHistorySurvived(ran, 'a session that walked a roll bigger than its window');
  }, 240_000);

  it('⛔ does not jump a reader who has walked back when something new lands', async () => {
    const columns = 100;
    const rows = 24;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        submits(says(0)),
        submits(says(1)),
        presses('walked back', PAGE_UP),
        // ⚠️ THE LINE IS TYPED AND SUBMITTED AS TWO STEPS, and that is forced by what the case
        // is about rather than by taste: a line landing under a reader who has walked back
        // changes NOTHING on the screen, so the layout writes nothing and a step waiting for a
        // frame waits for ever. Typing it changes the row being typed and submitting it changes
        // that row back, so each half is a frame — and the frame the second one produces is the
        // one under test.
        presses('typed a line while walked back', says(2)),
        presses('submitted it while walked back', '\r'),
        presses('went back to the tail', TO_THE_TAIL),
        leaves,
      ],
    });
    const walked = screenAt(ran, 3, columns, rows);
    const landed = screenAt(ran, 5, columns, rows);
    const tail = screenAt(ran, 6, columns, rows);
    // THE WINDOW IS WHERE THE READER LEFT IT. What landed went onto the roll, under what they are
    // reading, and the page did not move.
    expect(landed.text, 'new output pulled the page out from under a reader').toBe(walked.text);
    // AND IT REALLY DID LAND, or the assertion above is about a session that answered nothing:
    // going back to the tail shows something the window did not have.
    expect(tail.text, 'nothing landed while the reader was walked back').not.toBe(walked.text);
    theHistorySurvived(ran, 'a session that landed while the reader had walked back');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

describe('a window the caller resizes is a frame drawn at the new size', () => {
  it('keeps the three regions where they belong, narrowing and widening in sequence', async () => {
    const columns = 120;
    const rows = 40;
    const sizes = [
      { columns: 80, rows: 24 },
      { columns: 120, rows: 40 },
      { columns: 90, rows: 30 },
    ] as const;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        // ⚠️ MEASURED AFTER PRINTING, because a page that has just opened is the least
        // representative instant there is: the middle region is empty, so a window that came out
        // the wrong height would look identical to one that came out right.
        submits(says(0)),
        // ⚠️ AND EACH STEP WAITS FOR THE SIZE TO HAVE BEEN DRAWN, not merely for a frame. A
        // frame names nothing about a size, so under load the frames still arriving from the
        // step before end this one — and the next size is then set on top of a size the console
        // never got to draw. Measured in the full suite on a loaded machine: the read was refused
        // with *no frame in this stream was drawn 80 columns wide*, which was true and was the
        // case's own doing (`support/screen.ts`, {@link drewAt}).
        ...sizes.map((size) => ({
          resize: size,
          until: drewAt(size.columns),
          what: `drew at ${size.columns}x${size.rows}`,
        })),
        leaves,
      ],
    });
    sizes.forEach((size) => {
      // ⚠️ FOUND BY THE WIDTH IT WAS DRAWN AT rather than by where the step ended, and this case
      // is the one that taught the lesson. A resize produces more than one frame and a step ends
      // wherever the stream was quiet, so on a loaded machine `ran.at[2 + index]` reads the page
      // from BEFORE the resize — and the red says *the opening is not on the page*, which names
      // neither the index nor the load (`support/screen.ts`, {@link theSettledScreen}).
      const screen = theSettledScreen(ran.bytes, size.columns, size.rows);
      const where = `${size.columns}x${size.rows}`;
      // THE TOP REGION BEGINS ON THE FIRST ROW, which is the claim a resize can falsify — and
      // NOT that a given row of it stays put: which arrangement a width has room for is the
      // panel's own answer, so a narrower window really does put the text under the mark
      // instead of beside it and moves every row of the drawing (`src/repl/panel.ts`).
      expect(firstDrawnRow(screen), `${where}: the top region is not at the top`).toBe(0);
      expect(rowOf(screen, OPENED), `${where}: the opening is not on the page`).toBeGreaterThan(-1);
      fillsTheScreen(screen, size.rows, where);
      expect(screen.alternate, `${where}: the screen stopped being ours`).toBe(true);
      expect(screen.above, `${where}: a resize fed the caller’s scrollback`).toEqual([]);
    });
    theHistorySurvived(ran, 'a session resized three times');
  }, 240_000);

  it('⛔ writes no frame taller than the screen it is on, not even a transient one', async () => {
    // ⛔ THE GUARD THIS DELIVERY DID NOT HAVE, and the defect it was missing is the sharpest one
    // the model can produce. A frame that declares its own height is written onto whatever screen
    // exists WHEN IT IS WRITTEN — and the layout library keeps its own watch on the size, which
    // is SYNCHRONOUS: it lays the tree out again and writes it without React having re-rendered
    // anything. So a shrink used to write the OLD height onto the NEW screen before the corrected
    // frame followed. Measured, 120×40 to 80×24: **40 rows written onto a 24-row screen**, which
    // overflows by sixteen and scrolls the page — the top region off the top, for one frame.
    //
    // NOTHING ON THE SETTLED PAGE SHOWS IT. The corrected frame redraws every row from the top,
    // so a case that reads the page after the size settles is answered *correct* either way; what
    // sees it is a case that reads the FRAMES. That is why this one counts rows in the stream
    // rather than looking at a screen.
    //
    // THE SLICE IS TAKEN BEFORE THE RESIZE, which is the one way an index is honest here: it is
    // the boundary of a step that had already SETTLED, so nothing the resize caused can be in
    // front of it. Everything after it is the resize's own frames and the frames of a session
    // that only ever got shorter — so a boundary that drifts can only add correct frames, never
    // hide a wrong one.
    const ran = await inPty({
      columns: 120,
      rows: 40,
      steps: [
        opens,
        submits(says(0)),
        { resize: { columns: 80, rows: 24 }, until: aFrameSince(PROMPT), what: 'was made shorter' },
        leaves,
      ],
    });
    const after = ran.bytes.slice(ran.at[1] as number);
    // EVERY FRAME, CUT ON THE BOUNDARY THE LIBRARY WRITES, and each one measured in the rows it
    // puts on the page.
    const frames = rowsOfTheFrames(after);
    expect(
      frames.length,
      'the resize drew no frame at all, so nothing was measured',
    ).toBeGreaterThan(0);
    expect(
      Math.max(...frames),
      `a frame of ${Math.max(...frames)} rows was written onto a 24-row screen`,
    ).toBeLessThanOrEqual(24);
    // ⛔ AND THE PAGE IS WHOLE AFTERWARDS, which is what the frames above are for.
    const settled = theSettledScreen(ran.bytes, 80, 24);
    expect(firstDrawnRow(settled), 'the top region left the screen').toBe(0);
    fillsTheScreen(settled, 24, 'the page after a shrink');
    theHistorySurvived(ran, 'a session made shorter');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The way out
// ---------------------------------------------------------------------------

describe('the way out gives the screen back and the transcript with it', () => {
  it('⛔ writes everything the session said onto the caller’s own buffer, after leaving', async () => {
    const columns = 100;
    const rows = 24;
    const ran = await inPty({ columns, rows, steps: [opens, submits('verify'), leaves] });
    // ⛔ AFTER THE SEQUENCE THAT GIVES THE SCREEN BACK, and this is the whole mechanism: the
    // layout library treats everything written while it is tearing down as disposable and says
    // so, so a transcript written as a last frame or as a print inside the teardown would be
    // thrown away with the alternate screen. Asserted by POSITION rather than by presence.
    const gaveItBack = ran.bytes.lastIndexOf(GIVES_THE_SCREEN_BACK);
    expect(gaveItBack, 'the screen was never given back').toBeGreaterThan(0);
    const echo = `${PROMPT} verify`;
    expect(
      ran.bytes.lastIndexOf(echo),
      'the transcript was written before the screen was given back',
    ).toBeGreaterThan(gaveItBack);
    // AND THE MOUSE WAS GIVEN BACK TOO, before the screen: a terminal left reporting the mouse
    // fills the caller's next shell with escapes every time they move the pointer.
    expect(times(ran.bytes, THE_WHEEL_BACK), 'the wheel was not given back exactly once').toBe(1);
    // ON THE CALLER'S OWN BUFFER, read off the screen model rather than off the bytes: after the
    // session the alternate screen is gone and what is left is theirs.
    const left = screenOf(ran.bytes, columns, rows);
    expect(left.alternate, 'the session kept the screen').toBe(false);
    expect(left.beneath, 'the caller’s buffer does not hold what the session said').toContain(echo);
    // IN THE ORDER THE SESSION SAID IT, which is what makes the transcript greppable rather than
    // merely present: the echo of the verb comes before the verdict it produced.
    const verdict = 'local integrity verified';
    expect(left.beneath.indexOf(echo), 'the transcript is out of order').toBeLessThan(
      left.beneath.indexOf(verdict),
    );
    theHistorySurvived(ran, 'a session that left');
  }, 240_000);
});
