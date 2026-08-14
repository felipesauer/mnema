/**
 * NAMING A RECORD THAT IS ON THE SCREEN — the dead end, closed on a real terminal.
 *
 * IT CAME OUT OF USE, AND IT WAS MEASURED AT THE PROMPT. `search` prints
 * `019fdf20-c630-7fa1-b418-5a0750d396e0`; `show 019fdf20-c630` answers *No record here*,
 * and so does the alias `show` itself prints. Only the whole thirty-six characters
 * resolve. At a shell that is survivable, because what is on the screen is there to be
 * selected and pasted; in a console you TYPE, and an identifier a reader can read and
 * cannot use is an identifier the surface shows for nothing.
 *
 * THE FLOW IS THE CASE, and it is one run rather than four assertions about pieces:
 * `search`, a prefix of an id that came back, Tab, and then `show` over what the row
 * became. Anything less proves the parts and not the affordance — the completer answering
 * correctly to a memory a console never filled would pass every unit case in this delivery
 * and leave the dead end exactly where it was.
 *
 * AND WHAT IT MAY NOT BECOME is asserted in the same file, because that is the objection
 * the completer wrote against itself before this existed: a menu of the RECORD, which goes
 * stale between keystrokes. What is offered is what THIS SESSION HAS SHOWN, so a record
 * that exists and has not been named on the page is one the Tab cannot reach — asserted
 * against a record in the same project, with a search that deliberately does not name it.
 * The other half of that promise — that none of this reads anything — is a COUNT, and it
 * is in the file that owns the counter (`the-name-and-the-hints.test.ts`).
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { renderPlain } from '../src/presentation/plain.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { CUT } from '../src/repl/palette.js';
import { pickingTips } from '../src/repl/session.js';
import { CLEAR } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ENDS_THE_INPUT } from './support/console.js';
import {
  aFrameSince,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { theFirstScreenWhere, theFirstScreenWith } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

/** One escape byte, written as an escape so no control byte enters this file. */
const _ESC = '\u001b';

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';
/** Ctrl-C, which abandons the row being typed. Spelled as an escape, never typed. */
const CLEARS_THE_LINE = '\u0003';
/** Tab, likewise. */
const COMPLETES = '\u0009';

/** How wide a terminal has to be for a row of this list to be shown whole. */
const NOTHING_IS_CUT = 160;

/** What every record the session is asked about has in its title. */
const NAMED = 'names';

/**
 * THE RECORDS THE FIXTURE HOLDS — enough of them that a window at the floor cannot show them all.
 *
 * The names are ordinals and nothing depends on them; what the number has to be is larger than
 * the rows a list gets on the shortest window a console is drawn on, which is what puts the CUT
 * inside reach of a size a caller really has ({@link THE_RECORDS} is read, never counted twice).
 */
const THE_RECORDS: readonly string[] = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
];

/** And what the one it is NOT asked about has instead. */
const UNNAMED = 'a record nobody asks about';

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
/** The records a `search` of this fixture answers with, newest first. */
let shown: readonly Record[] = [];
/** The record that same search does not answer with. */
let hidden: Record;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** One record of the fixture: what it is called, and the id this product minted for it. */
interface Record {
  readonly title: string;
  readonly id: string;
}

/**
 * WHAT AN ID OF THIS PRODUCT LOOKS LIKE — the SHAPE of one, and nothing about the digits it
 * begins with.
 *
 * IT WAS THE THREE CHARACTERS `019`, AT FOUR SITES, AND THE CLOCK RETIRED THEM. A row of the
 * list was told from every other row by `row.trimStart().startsWith('019')`, and those three
 * characters are the top of the MILLISECOND an id begins with: they are true only while the clock
 * is inside `0x019000000000 … 0x019fffffffffff`, which it left on 2026-08-14 at 11:19:55 UTC. An
 * hour after that this file had two red cases and two VACUOUS ones — the two that count the rows
 * of the list found none, and the two that assert no row is a record passed without looking at
 * anything at all. Nothing in the commit had moved.
 *
 * SO THE RULE IS THE OTHER SIDE OF THE ONE THAT SAYS A FIXTURE MAY ONLY WRITE A VALUE THE PRODUCT
 * CAN PRODUCE: a fixture may not DEPEND on a value the product produces BY ACCIDENT. Deriving an
 * input from an id in hand is the right instrument and this file is built out of it
 * ({@link tellsApart}, {@link sharedBy}); writing a CHARACTER of one down is a case with an expiry
 * date nobody put in a calendar. `01a` would have bought 795 days and cost the same afternoon on
 * 2028-10-17. It holds for every case that derives an input from a generated id.
 *
 * The shape is all that is written down, it is written once for the two readings that need it
 * ({@link THE_ID_PRINTED}, {@link BEGINS_WITH_A_RECORD}), and no part of it moves with a clock.
 * That the ids this product mints really have it is proved where they are minted
 * (`core/src/identity/id.test.ts`); what is asserted here is where one goes.
 */
const AN_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The id the surface prints for a record it has just made: in parentheses, after the name. */
const THE_ID_PRINTED = new RegExp(`\\((${AN_ID})\\)`);

/** A row of a list whose first column is a record — the id, and the row it was named on. */
const BEGINS_WITH_A_RECORD = new RegExp(`^${AN_ID}`);

/** `mnema <argv>` at the shell, in this process, with what it printed. */
async function shell(...argv: string[]): Promise<string> {
  const said: string[] = [];
  const io: CliIo = { out: (line) => said.push(line), err: () => undefined, fail: () => undefined };
  await run(argv, io);
  return said.join('\n');
}

/** One task, created at the shell, with the id the surface printed for it. */
async function task(title: string): Promise<Record> {
  const said = await shell('task', title);
  const id = THE_ID_PRINTED.exec(said)?.[1];
  if (id === undefined) throw new Error(`fixture: task printed no id: ${said}`);
  return { title, id };
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-naming-'));
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
  const made: Record[] = [];
  // THERE WERE SIX OF THEM AND THERE ARE SIXTEEN, and the floor under the window is what
  // decided the number. The case that measures the list saying how many it had NO ROOM for used
  // to reach that regime by driving a short terminal — a hundred columns by eight — and no
  // console is drawn there any more (`src/repl/floor.ts`). Above the floor the shortest window is
  // twenty-four rows, which leaves the list about fifteen: with six records nothing can ever be
  // cut, so the regime is reached by having MORE RECORDS THAN A WINDOW HAS ROWS instead of by a
  // window nobody can open. Everything else here is a count off this list rather than a number,
  // so the sixteen travel into every case unedited.
  for (const which of THE_RECORDS) {
    made.push(await task(`the console ${NAMED} this one ${which}`));
  }
  // The list a search answers with is newest first, and the cases read it in that order.
  shown = [...made].reverse();
  hidden = await task(UNNAMED);

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

// ---------------------------------------------------------------------------
// The prefixes, worked out from the ids rather than written down
// ---------------------------------------------------------------------------

/**
 * The shortest prefix of `id` that no other id in `others` begins with.
 *
 * WORKED OUT AND NOT CHOSEN, because an id begins with the millisecond it was minted and
 * every record of one fixture is minted in the same second: how many characters it takes
 * to tell two of them apart is a property of the run, not a number to write down. A
 * literal here would be a case that stops discriminating on a faster machine.
 */
function tellsApart(id: string, others: readonly string[]): string {
  for (let taken = 1; taken <= id.length; taken += 1) {
    const prefix = id.slice(0, taken);
    if (!others.some((other) => other !== id && other.startsWith(prefix))) return prefix;
  }
  throw new Error(`no prefix tells ${id} apart`);
}

/** The longest start every one of `ids` has — the prefix that names all of them at once. */
function sharedBy(ids: readonly string[]): string {
  const first = ids[0] ?? '';
  let length = first.length;
  for (const id of ids) {
    let same = 0;
    while (same < length && id[same] === first[same]) same += 1;
    length = same;
  }
  return first.slice(0, length);
}

// ---------------------------------------------------------------------------
// The pty
// ---------------------------------------------------------------------------

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
const leaves: Step = {
  // THE ROW IS ABANDONED FIRST, then the key that ends the input: the way out is a keystroke
  // and a row with characters on it is not the end of anything.
  types: `${CLEARS_THE_LINE}${ENDS_THE_INPUT}`,
  what: 'left',
  until: () => true,
};

/**
 * The read that puts the records on the page, and what says it has answered.
 *
 * IT WAITED FOR EVERY ID TO BE IN THE BYTES, and a window is what falsified that. What the
 * session says goes on a roll and the middle region shows the TAIL of it (`repl/scrolling.ts`),
 * so on a terminal with a few rows to spare the ids at the top of the answer are on the roll and
 * never on the screen — and a step waiting for all of them waits for ever. It waits for the
 * frame it caused and for the answer to have STARTED arriving instead; whether every record was
 * shown is then the assertion's question rather than the step's, and a record that never landed
 * fails the count it is asserted by rather than hanging the driver.
 */
function searches(): Step {
  return {
    types: `search ${NAMED}\r`,
    until: (bytes, since) =>
      aFrameSince(PROMPT)(bytes, since) && shown.some((record) => bytes.includes(record.id)),
    what: 'answered with the records',
  };
}

/** How many times `what` occurs in `text`. Overlapping is impossible for these. */
const _times = (text: string, what: string): number => text.split(what).length - 1;

/**
 * The step that takes what was said off the SCREEN without unsaying it.
 *
 * IT IS THE INSTRUMENT AND IT IS ALSO A CASE. A row of the palette holding an id and the
 * row of `search` it was read off are the same characters in a different spacing, so a
 * scan of the screen cannot tell them apart while both are on it. A clean page leaves
 * exactly one of the two — which is only true because what a session has SAID cannot be
 * unsaid by the completer: the roll is emptied and the records stay completable. A memory
 * that were cleared with the page would take every case below to zero rows and be seen at
 * once.
 *
 * IT WAITED FOR A PAGE TO BE CARRIED INTO THE SCROLLBACK, and there are no pages to carry.
 * A clean page used to mean a screen of the caller's own scrolled away and the opening written
 * over it, so the bytes that did it were what said the word had been answered; the console
 * draws on a screen of its own now and clearing is the ROLL being emptied
 * (`repl/scrolling.ts`), which is a frame like any other. So the step waits for the frame it
 * caused, which is the rule every other step of this bench already waits by.
 */
function clears(): Step {
  return { types: `${CLEAR}\r`, until: aFrameSince(PROMPT), what: 'started the page over' };
}

/** What the row being typed is, on a screen — the last row that carries the prompt. */
function rowBeingTyped(screen: { readonly rows: readonly string[] }): string {
  const typed = screen.rows.filter((row) => row.includes(PROMPT));
  return (typed.at(-1) ?? '').trim();
}

/**
 * WHICH ROWS OF A PAGE ARE ROWS OF A RECORD — the rows of the list whose first column is an id.
 *
 * ONE READING AND FOUR SITES, and it is one because the four are the same question asked in two
 * directions: two cases count the rows the list drew, and two assert there are none of them. Two
 * spellings of *this row is a record* is how one of them comes to answer about something else, and
 * this file has already paid for it once ({@link AN_ID}).
 *
 * IT IS THE SHAPE AND NOT THE RECORD, which is what keeps the cases that count non-vacuous: a row
 * matched against the ids the fixture holds would make *every row of the list is one of the
 * records* a question that answers itself. So the rows are found by what a record LOOKS like, and
 * which record each one is stays the assertion's own to make.
 *
 * A ROW THAT BEGINS WITH A RECORD IS ONE THE PALETTE DREW, on the pages these cases read, and the
 * clearing is what buys it: the rows a `search` wrote begin with an id too, and they are on the
 * roll rather than on the screen once the page has been started over ({@link clears}).
 */
function theRecordsListedOn(screen: { readonly rows: readonly string[] }): readonly string[] {
  return screen.rows.filter((row) => BEGINS_WITH_A_RECORD.test(row.trimStart()));
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

describe('a record on the screen can be typed back, whole', () => {
  it('finishes a prefix into the id, and the read over it answers the record', async () => {
    const columns = NOTHING_IS_CUT;
    // A WINDOW ABOVE THE FLOOR, READ OFF THE FLOOR rather than written down. The height here was
    // never the subject — it was *a window with room* — and what *with room* means moved when the
    // shortest window this console draws a page on became the height the name is drawn whole at
    // (`src/repl/floor.ts`).
    const rows = THE_FLOOR.rows;
    const chosen = shown[0] as Record;
    const prefix = tellsApart(
      chosen.id,
      shown.map((record) => record.id),
    );
    // THE PREFIX IS REALLY A PREFIX AND REALLY NOT THE VALUE: what the caller types is a
    // fraction of what has to end up on the row.
    expect(chosen.id.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(chosen.id.length);

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        searches(),
        {
          types: `show ${prefix}`,
          until: (bytes) => bytes.includes(`show ${prefix}`),
          what: 'typed a prefix of one of them',
        },
        {
          types: COMPLETES,
          until: (bytes) => bytes.includes(`show ${chosen.id}`),
          what: 'finished the id',
        },
        {
          types: '\r',
          until: (bytes) => bytes.includes(chosen.title),
          what: 'answered the record',
        },
        leaves,
      ],
    });

    // WHAT THE ROW BECAME: the whole id, typed for the caller, and not a character of it
    // short. This is the assertion the defect was measured against.
    // FOUND BY WHAT THE FRAME SHOWS rather than by where the step ended. The wait above is
    // right and the index after it is not what the wait guarantees: a step ends wherever the
    // stream happened to be quiet, so on a loaded machine this read lands on the page from
    // BEFORE the key took effect — and the red is then *expected 'mnema>' to be 'mnema> show …'*,
    // which accuses the completer for something the instrument did
    // (`support/screen.ts`, {@link theFirstScreenWith}).
    const completed = theFirstScreenWith(ran.bytes, `show ${chosen.id}`, columns, rows);
    expect(rowBeingTyped(completed), completed.text).toBe(`${PROMPT} show ${chosen.id}`);

    // AND WHAT THE READ SAID ABOUT IT. `show` over the row is the whole point: a
    // completion that produced a value the next line refuses would have moved the dead
    // end rather than closed it.
    const answered = theFirstScreenWith(ran.bytes, chosen.title, columns, rows);
    expect(answered.text).toContain(chosen.title);
    expect(answered.text).not.toContain('No record');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// Many, and the palette that lists them
// ---------------------------------------------------------------------------

describe('a prefix that names several lists them, each beside the line it came from', () => {
  it('shows every one of them with what the read said about it', async () => {
    const columns = NOTHING_IS_CUT;
    // A WINDOW ABOVE THE FLOOR, READ OFF THE FLOOR rather than written down. The height here was
    // never the subject — it was *a window with room* — and what *with room* means moved when the
    // shortest window this console draws a page on became the height the name is drawn whole at
    // (`src/repl/floor.ts`).
    const rows = THE_FLOOR.rows;
    const ids = shown.map((record) => record.id);
    const shared = sharedBy(ids);
    // The instrument first: the prefix really is ambiguous, over more than two.
    expect(ids.filter((id) => id.startsWith(shared))).toHaveLength(ids.length);
    expect(ids.length).toBeGreaterThan(2);

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        searches(),
        clears(),
        {
          types: `show ${shared}${COMPLETES}`,
          until: (bytes) => bytes.lastIndexOf(shown[0]?.title as string) > bytes.lastIndexOf(CLEAR),
          what: 'listed the records it could still be',
        },
        leaves,
      ],
    });

    // FOUND BY WHAT THE FRAME SHOWS rather than by where the step ended: the subject is the
    // page WITH THE LIST OF RECORDS ON IT, so the frame to read is the first one that has the
    // typed prefix on the row — which is the frame the completion produced. A step ends wherever
    // the stream happened to be quiet, and on a loaded machine that is before the list arrived;
    // the red was then an empty list, which accuses the completer for something the instrument
    // did (`support/screen.ts`, {@link theFirstScreenWith}).
    const screen = theFirstScreenWith(ran.bytes, `${PROMPT} show ${shared}`, columns, rows);
    // EVERY ROW OF THE PALETTE IS ONE OF THEM, under the row being typed — the id, and
    // beside it the rest of the line the record was named on. A list of bare ids that all
    // begin alike would be a list nobody can choose from, which is why the gloss is the
    // rest of the row rather than a decoration.
    //
    // IT SAID *EVERY ONE OF THEM* AND ASSERTED THE COUNT, which is what the ceiling took: the
    // list draws four and says how many it left out (`src/repl/palette.ts`, `AT_MOST`), so
    // sixteen records are four rows and a number. What the case is about is untouched — a row
    // is an id AND what it was named on — and it is now asked of every row there is, with the
    // count of the rest asserted against the total below.
    const listed = theRecordsListedOn(screen);
    expect(listed.length, screen.text).toBeGreaterThan(0);
    for (const row of listed) {
      const record = shown.find((named) => row.trimStart().startsWith(named.id));
      expect(record, `a row of the list is not one of the records:\n${row}`).toBeDefined();
      expect(row, (record as Record).id).toContain((record as Record).title);
    }
    // AND WHAT IS NOT DRAWN IS COUNTED, so the four rows are not four records quietly standing
    // in for sixteen.
    const said = screen.rows.find((row) => row.trimStart().startsWith(CUT));
    const missing = Number(/(\d+)/.exec(said as string)?.[1]);
    expect(listed.length + missing, `${listed.length} shown, ${missing} named`).toBe(shown.length);
    // AND THE ROW BEING TYPED GREW TO WHAT THEY ALL AGREE ON, which is what a Tab that
    // cannot choose still does: it types the shared prefix and shows the choice.
    expect(rowBeingTyped(screen)).toBe(`${PROMPT} show ${sharedBy(ids)}`);
  }, 240_000);

  it('says how many it had no room for, and the number adds up to all of them', async () => {
    // THE CUT IS THE PALETTE'S OWN and it is measured here rather than assumed: the rows are
    // what is left of the screen under the fixed region at the top (`repl/area.ts`,
    // `AreaRequest.header`), and whenever it draws a row at all, what it shows plus what it says
    // is left over is everything there was.
    //
    // THE HEIGHT HAS MOVED FOUR TIMES AND ONLY THE LAST ONE WAS NOT ABOUT THE ROOM. It was
    // eight rows while the list was budgeted against what the page had left over; sixteen once the
    // list was cut to the leftover under the flow; fourteen once the leftover was measured under
    // the fixed region at the top; eight again once that region was held to a third of the screen.
    // What moved it this time is the FLOOR under the window (`src/repl/floor.ts`): eight rows is
    // not a console at all any more. So the regime is reached from the other side — the shortest
    // window there is, with more records in the fixture than the list has rows on it
    // ({@link THE_RECORDS}) — and what it measures is unchanged. Measured on a real terminal
    // rather than derived: at the floor the list shows some of them and names the rest.
    const columns = 80;
    // A WINDOW ABOVE THE FLOOR, READ OFF THE FLOOR rather than written down. The height here was
    // never the subject — it was *a window with room* — and what *with room* means moved when the
    // shortest window this console draws a page on became the height the name is drawn whole at
    // (`src/repl/floor.ts`).
    const rows = THE_FLOOR.rows;
    const shared = sharedBy(shown.map((record) => record.id));
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        searches(),
        clears(),
        {
          types: `show ${shared}${COMPLETES}`,
          until: (bytes) => bytes.includes(CUT),
          what: 'said it had no room for the rest',
        },
        leaves,
      ],
    });

    // FOUND BY WHAT THE FRAME SHOWS rather than by where the step ended — the rule this file
    // now holds throughout (`support/screen.ts`, {@link theFirstScreenWith}).
    const screen = theFirstScreenWith(ran.bytes, CUT, columns, rows);
    const listed = theRecordsListedOn(screen);
    const said = screen.rows.find((row) => row.trimStart().startsWith(CUT));
    expect(said, `no row said how many had no room:\n${screen.text}`).toBeDefined();
    const missing = Number(/(\d+)/.exec(said as string)?.[1]);
    expect(listed.length + missing, `${listed.length} shown, ${missing} named`).toBe(shown.length);
    // Not vacuous: it really did leave some out, and it really did show some.
    expect(missing).toBeGreaterThan(0);
    expect(listed.length).toBeGreaterThan(0);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// And what it is not: a menu of the record
// ---------------------------------------------------------------------------

describe('what it offers is what the session showed, and never the record', () => {
  it('will not finish a record this session has not named', async () => {
    const columns = NOTHING_IS_CUT;
    // A WINDOW ABOVE THE FLOOR, READ OFF THE FLOOR rather than written down. The height here was
    // never the subject — it was *a window with room* — and what *with room* means moved when the
    // shortest window this console draws a page on became the height the name is drawn whole at
    // (`src/repl/floor.ts`).
    const rows = THE_FLOOR.rows;
    // A PREFIX THAT NAMES ONE RECORD IN THE PROJECT AND NONE ON THE PAGE. The search
    // above answers with six of the seven, so this one exists, is readable, and was not
    // said — which is exactly the case that separates "what the session showed" from "a
    // menu of the record".
    const missing = tellsApart(hidden.id, [...shown.map((record) => record.id), hidden.id]);
    const present = shown[0] as Record;
    const found = tellsApart(
      present.id,
      shown.map((record) => record.id),
    );

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        searches(),
        clears(),
        {
          types: `show ${missing}${COMPLETES}`,
          until: (bytes) => bytes.lastIndexOf(`show ${missing}`) > bytes.lastIndexOf(CLEAR),
          what: 'was asked for a record it had not named',
        },
        {
          // THE TEETH, in the same session and on the next keystroke: the same gesture
          // over a record that WAS named finishes. Without it, a Tab that never completes
          // anything at all passes the case above.
          types: `${CLEARS_THE_LINE}show ${found}${COMPLETES}`,
          until: (bytes) => bytes.includes(`show ${present.id}`),
          what: 'finished one it had named',
        },
        leaves,
      ],
    });

    // FOUND BY WHAT THE FRAME SHOWS rather than by where the step ended — the rule this file
    // now holds throughout (`support/screen.ts`, {@link theFirstScreenWith}).
    const refused = theFirstScreenWith(ran.bytes, `${PROMPT} show ${missing}`, columns, rows);
    expect(rowBeingTyped(refused), refused.text).toBe(`${PROMPT} show ${missing}`);
    // Neither the id nor the title of that record is anywhere on the screen — a menu that
    // had gone and looked would have put one of the two there.
    expect(refused.text).not.toContain(hidden.id);
    expect(refused.text).not.toContain(UNNAMED);
    // AND NOTHING AT ALL WAS LISTED, which is the half the first draft of this case
    // missed. A memory that answered without narrowing to what was typed would leave the
    // row exactly as it is above and open a palette of six records the caller did not ask
    // about — every assertion so far passes on that. The page was cleared, so a row that
    // begins with a record here can only be one the palette drew.
    expect(
      theRecordsListedOn(refused),
      `something was offered for a record nobody named:\n${refused.text}`,
    ).toEqual([]);

    // FOUND BY WHAT THE FRAME SHOWS rather than by where the step ended. The wait above is
    // right and the index after it is not what the wait guarantees: a step ends wherever the
    // stream happened to be quiet, so on a loaded machine this read lands on the page from
    // BEFORE the key took effect — and the red is then *expected 'mnema>' to be 'mnema> show …'*,
    // which accuses the completer for something the instrument did
    // (`support/screen.ts`, {@link theFirstScreenWith}).
    const completed = theFirstScreenWith(ran.bytes, `show ${present.id}`, columns, rows);
    expect(rowBeingTyped(completed), completed.text).toBe(`${PROMPT} show ${present.id}`);
  }, 240_000);

  it('and finishes that same record once the session HAS named it', async () => {
    // A1, FROM THE OUTSIDE: everything a reader sees comes through ONE door, and this is
    // the case that would go red if a second one appeared. The record above is refused
    // until a read NAMES it, and the read that names it here is a different verb writing
    // a different shape of line — so a `show` whose output reached the page past the
    // memory would leave this Tab with nothing, exactly as the search-only session had.
    const columns = NOTHING_IS_CUT;
    // A WINDOW ABOVE THE FLOOR, READ OFF THE FLOOR rather than written down. The height here was
    // never the subject — it was *a window with room* — and what *with room* means moved when the
    // shortest window this console draws a page on became the height the name is drawn whole at
    // (`src/repl/floor.ts`).
    const rows = THE_FLOOR.rows;
    const missing = tellsApart(hidden.id, [...shown.map((record) => record.id), hidden.id]);

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: `show ${hidden.id}\r`,
          until: (bytes) => bytes.includes(UNNAMED),
          what: 'named the record it had not seen',
        },
        clears(),
        {
          types: `show ${missing}${COMPLETES}`,
          until: (bytes) => bytes.lastIndexOf(`show ${hidden.id}`) > bytes.lastIndexOf(CLEAR),
          what: 'finished the record the show had named',
        },
        leaves,
      ],
    });

    // FOUND BY THE PAGE'S OWN PROPERTY, and this case is why that locator exists. It was the
    // last index left in the file and it went red twice in three loaded runs; the obvious repair
    // — the first frame whose bytes hold `mnema> show <id>` — is AMBIGUOUS here, because the
    // session ran that very line earlier and the roll kept its echo. The two are the same
    // characters in two places, and only a PAGE can say which is the row being typed
    // (`support/screen.ts`, {@link theFirstScreenWhere}).
    const typed = `${PROMPT} show ${hidden.id}`;
    const screen = theFirstScreenWhere(
      ran.bytes,
      columns,
      rows,
      (page) => rowBeingTyped(page) === typed,
    );
    expect(rowBeingTyped(screen), screen.text).toBe(typed);
  }, 240_000);

  it('offers no record where a verb goes, however many it has named', async () => {
    const columns = NOTHING_IS_CUT;
    // A WINDOW ABOVE THE FLOOR, READ OFF THE FLOOR rather than written down. The height here was
    // never the subject — it was *a window with room* — and what *with room* means moved when the
    // shortest window this console draws a page on became the height the name is drawn whole at
    // (`src/repl/floor.ts`).
    const rows = THE_FLOOR.rows;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        searches(),
        clears(),
        {
          // A Tab on an empty row is a caller asking what a LINE can start with, and a
          // line starts with a word this session runs. An id answers to nothing.
          types: COMPLETES,
          // WHAT IT WAITS FOR IS A ROW THE LIST REALLY DRAWS. It used to be the description
          // of `search`, and the ceiling put that verb off the page: four offers are drawn
          // now and the rest are counted (`src/repl/palette.ts`, `AT_MOST`). The row that is
          // always there is the account of the rest, whichever four words are above it.
          until: (bytes, since) => bytes.slice(since).includes(CUT),
          what: 'offered the words a line starts with',
        },
        leaves,
      ],
    });

    // FOUND BY WHAT THE FRAME SHOWS rather than by where the step ended — the rule this file
    // now holds throughout (`support/screen.ts`, {@link theFirstScreenWith}).
    const screen = theFirstScreenWith(ran.bytes, CUT, columns, rows);
    // The palette is open — the words a line can start with are listed — and no row of it is
    // a record.
    //
    // WHICH FOUR WORDS ARE DRAWN IS NOT THIS CASE'S BUSINESS, and it used to be: the witness
    // was the word the session answers to itself, on the argument that it *sorts first*, and
    // the order stopped putting it there (`src/repl/complete.ts`, `theOrder` — the verbs go
    // ahead of it, so a list of the whole vocabulary draws four verbs and counts the rest).
    // What says the palette is open at every order is the palette's OWN row: the keys that
    // move it, which nothing else on this page draws.
    expect(screen.text, screen.text).toContain(renderPlain(pickingTips()).trim());
    const listed = theRecordsListedOn(screen);
    expect(listed, `the top level offered a record:\n${screen.text}`).toEqual([]);
  }, 240_000);
});
