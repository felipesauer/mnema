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
import { CUT } from '../src/repl/palette.js';
import { CLEAR, PREFIX } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { inPty as drive, type Fixture, opensAConsole, type Ran, type Step } from './support/pty.js';
import { screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

/** One escape byte, written as an escape so no control byte enters this file. */
const ESC = '\u001b';

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
  const id = /\(([0-9a-f-]{36})\)/.exec(said)?.[1];
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
  for (const which of ['one', 'two', 'three', 'four', 'five', 'six']) {
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
  types: `${CLEARS_THE_LINE}${PREFIX}exit\r`,
  what: 'left',
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(`${PREFIX}exit`),
};

/** The read that puts the records on the page, and what says it has answered. */
function searches(): Step {
  return {
    types: `search ${NAMED}\r`,
    until: (bytes) => shown.every((record) => bytes.includes(record.id)),
    what: 'answered with the records',
  };
}

/** How many times `what` occurs in `text`. Overlapping is impossible for these. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/** The bytes that carry a page `rows` tall away — what says a page was really turned. */
const carriesThePage = (rows: number): string => `${ESC}[${rows};1H`;

/**
 * The step that takes what was said off the SCREEN without unsaying it.
 *
 * IT IS THE INSTRUMENT AND IT IS ALSO A CASE. A row of the palette holding an id and the
 * row of `search` it was read off are the same characters in a different spacing, so a
 * scan of the screen cannot tell them apart while both are on it. A clean page leaves
 * exactly one of the two — which is only true because what a session has SAID cannot be
 * unsaid: the page is carried into the caller's scrollback, and the records stay
 * completable. A memory that were cleared with the page would take every case below to
 * zero rows and be seen at once.
 *
 * A page is turned once when the session opens, so the second occurrence is this one.
 */
function clears(rows: number): Step {
  return {
    types: `${CLEAR}\r`,
    until: (bytes) => times(bytes, carriesThePage(rows)) >= 2,
    what: 'started the page over',
  };
}

/** What the row being typed is, on a screen — the last row that carries the prompt. */
function rowBeingTyped(screen: { readonly rows: readonly string[] }): string {
  const typed = screen.rows.filter((row) => row.includes(PROMPT));
  return (typed.at(-1) ?? '').trim();
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

describe('a record on the screen can be typed back, whole', () => {
  it('finishes a prefix into the id, and the read over it answers the record', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = 40;
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
    const completed = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, rows);
    expect(rowBeingTyped(completed), completed.text).toBe(`${PROMPT} show ${chosen.id}`);

    // AND WHAT THE READ SAID ABOUT IT. `show` over the row is the whole point: a
    // completion that produced a value the next line refuses would have moved the dead
    // end rather than closed it.
    const answered = screenOf(ran.bytes.slice(0, ran.at[4] as number), columns, rows);
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
    const rows = 40;
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
        clears(rows),
        {
          types: `show ${shared}${COMPLETES}`,
          until: (bytes) => bytes.lastIndexOf(shown[0]?.title as string) > bytes.lastIndexOf(CLEAR),
          what: 'listed the records it could still be',
        },
        leaves,
      ],
    });

    const screen = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, rows);
    // EVERY ONE OF THEM IS A ROW OF THE PALETTE, under the row being typed — the id, and
    // beside it the rest of the line the record was named on. A list of bare ids that all
    // begin alike would be a list nobody can choose from, which is why the gloss is the
    // rest of the row rather than a decoration.
    const listed = screen.rows.filter((row) => row.trimStart().startsWith('019'));
    expect(listed, screen.text).toHaveLength(shown.length);
    for (const record of shown) {
      const row = listed.find((line) => line.trimStart().startsWith(record.id));
      expect(row, `${record.id} is not listed:\n${screen.text}`).toBeDefined();
      expect(row, record.id).toContain(record.title);
    }
    // AND THE ROW BEING TYPED GREW TO WHAT THEY ALL AGREE ON, which is what a Tab that
    // cannot choose still does: it types the shared prefix and shows the choice.
    expect(rowBeingTyped(screen)).toBe(`${PROMPT} show ${sharedBy(ids)}`);
  }, 240_000);

  it('says how many it had no room for, and the number adds up to all of them', async () => {
    // THE CUT IS THE PALETTE'S OWN and it is measured here rather than assumed: the rows
    // are budgeted against what is left over the row being typed, and whenever it draws a
    // row at all, what it shows plus what it says is left over is everything there was.
    const columns = 100;
    const rows = 8;
    const shared = sharedBy(shown.map((record) => record.id));
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        searches(),
        clears(rows),
        {
          types: `show ${shared}${COMPLETES}`,
          until: (bytes) => bytes.includes(CUT),
          what: 'said it had no room for the rest',
        },
        leaves,
      ],
    });

    const screen = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, rows);
    const listed = screen.rows.filter((row) => row.trimStart().startsWith('019'));
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
    const rows = 40;
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
        clears(rows),
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

    const refused = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, rows);
    expect(rowBeingTyped(refused), refused.text).toBe(`${PROMPT} show ${missing}`);
    // Neither the id nor the title of that record is anywhere on the screen — a menu that
    // had gone and looked would have put one of the two there.
    expect(refused.text).not.toContain(hidden.id);
    expect(refused.text).not.toContain(UNNAMED);
    // ⚠️ AND NOTHING AT ALL WAS LISTED, which is the half the first draft of this case
    // missed. A memory that answered without narrowing to what was typed would leave the
    // row exactly as it is above and open a palette of six records the caller did not ask
    // about — every assertion so far passes on that. The page was cleared, so a row that
    // begins with a record here can only be one the palette drew.
    expect(
      refused.rows.filter((row) => row.trimStart().startsWith('019')),
      `something was offered for a record nobody named:\n${refused.text}`,
    ).toEqual([]);

    const completed = screenOf(ran.bytes.slice(0, ran.at[4] as number), columns, rows);
    expect(rowBeingTyped(completed), completed.text).toBe(`${PROMPT} show ${present.id}`);
  }, 240_000);

  it('and finishes that same record once the session HAS named it', async () => {
    // A1, FROM THE OUTSIDE: everything a reader sees comes through ONE door, and this is
    // the case that would go red if a second one appeared. The record above is refused
    // until a read NAMES it, and the read that names it here is a different verb writing
    // a different shape of line — so a `show` whose output reached the page past the
    // memory would leave this Tab with nothing, exactly as the search-only session had.
    const columns = NOTHING_IS_CUT;
    const rows = 40;
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
        clears(rows),
        {
          types: `show ${missing}${COMPLETES}`,
          until: (bytes) => bytes.lastIndexOf(`show ${hidden.id}`) > bytes.lastIndexOf(CLEAR),
          what: 'finished the record the show had named',
        },
        leaves,
      ],
    });

    const screen = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, rows);
    expect(rowBeingTyped(screen), screen.text).toBe(`${PROMPT} show ${hidden.id}`);
  }, 240_000);

  it('offers no record where a verb goes, however many it has named', async () => {
    const columns = NOTHING_IS_CUT;
    const rows = 40;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        searches(),
        clears(rows),
        {
          // A Tab on an empty row is a caller asking what a LINE can start with, and a
          // line starts with a word this session runs. An id answers to nothing.
          types: COMPLETES,
          until: (bytes) =>
            bytes.lastIndexOf('find what has been recorded') > bytes.lastIndexOf(CLEAR),
          what: 'offered the words a line starts with',
        },
        leaves,
      ],
    });

    const screen = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, rows);
    // The palette is open — the verbs are listed — and no row of it is a record.
    expect(screen.text, screen.text).toContain('search');
    const listed = screen.rows.filter((row) => row.trimStart().startsWith('019'));
    expect(listed, `the top level offered a record:\n${screen.text}`).toEqual([]);
  }, 240_000);
});
