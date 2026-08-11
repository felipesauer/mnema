/**
 * WHAT THE AGENT JUST DID — the record moving under an open session, and the caller
 * seeing it.
 *
 * The console runs no verb that writes, by default-deny over each verb's own declaration
 * (`repl/gate.ts`). So nothing a caller types can move the record, and every occurrence
 * this surface shows is somebody ELSE's append — which is what makes the case shape
 * itself: the writing is done by ANOTHER PROCESS, on a real pseudo-terminal, while the
 * session is up. A case that appended in-process would be proving a callback, not the
 * feature.
 *
 * FOUR PROMISES ARE PINNED HERE, and each one is a decision that could have gone the
 * other way:
 *
 *   - THE OCCURRENCE LANDS IN THE SCROLLBACK, like every line the session says. Never in
 *     the region the layout redraws: that region has a budget, and a list growing inside
 *     it walks the console into the height at which the library stops redrawing PART of
 *     the screen and starts redrawing all of it — the whole page rewritten over the
 *     caller's, with the erase this product refuses inside the sequence it does it with
 *     (`a-page-that-opens-clean.test.ts` measures that boundary in both directions). It is
 *     asserted twice, and only the second one has teeth: the arrangement from the badge
 *     down is compared before and after, which a region that grew UPWARDS would survive
 *     (measured — a mutation that put the occurrences in the palette left that case green);
 *     and the session is then run ON the boundary, where one more row of region IS that
 *     path, with the height bracketed rather than assumed. ⚠️ THE BOUNDARY USED TO BE
 *     BRACKETED BY THE ERASE ITSELF, and the erase never reaches a terminal now — it is
 *     translated on the way out (`src/repl/page.ts`, `theEraseAsAScroll`) — so what brackets
 *     it is the library's own replay of what it keeps.
 *   - WHAT WAS ALREADY SAID IS NOT UNSAID. An occurrence about a record named ABOVE on the
 *     page lands UNDER it, because a surface whose whole argument is that the scrollback
 *     is the feature may not rewrite it.
 *   - THE LINE COMES FROM `presentation/`, so an occurrence reads exactly like the same
 *     event read back by `timeline` — asserted against the composer rather than against a
 *     retyped string.
 *   - AND THE CADENCE IS THE ONE THAT ALREADY EXISTED. A settled resize and a question to
 *     the record wait the same tenth of a second, out of one constant, because they are
 *     the same question about how long a caller waits for the console to catch up with
 *     something that changed outside it.
 *
 * WHAT IS NOT HERE IS THE COUNT OF THE READS, and it is not here on purpose: the counter
 * for this surface lives in `the-name-and-the-hints.test.ts`, and the promise that the
 * question costs no read is asserted there, in the file that owns the instrument. A second
 * counter would be a second idea of what reading the record means.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogEvent } from '@mnema/chain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runVerify } from '../src/commands/verify.js';
import { occurrenceLine } from '../src/presentation/occurrence.js';
import { renderPlain } from '../src/presentation/plain.js';
import { followingTheRecord } from '../src/repl/following.js';
import { PREFIX } from '../src/session-words.js';
import { here } from '../src/wiring/context.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { DEFAULT_REQUIREMENT } from '../src/wiring/verify.js';
import { type Fixture, inPty, opensAConsole, type Ran, type Step } from './support/pty.js';
import { screenOf } from './support/screen.js';

/** `packages/code/src`, for the guards that read this surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The built CLI — the same file the `mnema` bin points at, and what the other process runs. */
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** Ctrl-C, which abandons the row being typed. Spelled as an escape, never typed. */
const CLEARS_THE_LINE = '\u0003';

/** The agent the other process writes as — the name that has to reach the page. */
const THE_AGENT = 'the-agent-that-wrote-it';

/**
 * WHAT THE VERDICT OF A GOOD TREE SAYS — one spelling, read by the step that waits for the
 * verb's answer and by the case that counts what was said.
 *
 * ⚠️ THE TWO USED TO SPELL IT DIFFERENTLY, and that is what made this run flaky: the step
 * waited for `integrity`, and the OPENING PANEL already says it. So the step could end on the
 * opening frame — before the verb had answered — and the case under it then read one occurrence
 * where the finished page has two. It went red once in a full-suite run and passed on its own
 * twice, which is the signature of a wait satisfied by the frame before the one it means.
 * The condition is the SECOND occurrence now: the panel says the sentence once, so the verb
 * having answered is the sentence being on the page again.
 */
const THE_VERDICT = 'local integrity verified';

/** How wide and how tall the terminal every case here drives is. */
const COLUMNS = 140;
const ROWS = 40;

/** What the layout library writes when it takes the caller's history with the page. */
const _ERASES_THE_HISTORY = '\u001b[3J';

/**
 * WHAT THE OPENING ALWAYS SAYS, whatever the terminal is like — and therefore how many times the
 * library has written the page again out of everything it keeps.
 *
 * It is the signature of the path on which the library gives up on redrawing PART of the screen:
 * that path replays what it holds, and nothing else on any path does.
 */
const _THE_OPENING = 'a session over this project';

/**
 * THE SHORTEST TERMINAL ON WHICH THE LAYOUT STILL REDRAWS PART OF THE PAGE, in rows.
 *
 * Measured rather than chosen, and BRACKETED by the case that uses it: at this height the
 * library redraws the rows it owns, and one row below it gives up and redraws the whole page.
 * It is where the region a session redraws — the row being typed and the hint under it —
 * stops fitting under the viewport. `a-page-that-opens-clean.test.ts` is where the boundary
 * itself is pinned, in both directions and at several widths.
 *
 * ⚠️ IT WAS BRACKETED BY THE ERASE — *at this height the erase never appears, and one row below it
 * does* — and the erase no longer appears at either. What the library asks for is translated on the
 * way out (`src/repl/page.ts`, `theEraseAsAScroll`), so the bracket is read off the library's own
 * REPLAY of what it keeps instead, which is the other thing it does on that path.
 */
const _SHORTEST_THAT_REDRAWS_IN_PART = 2;

/** The width the boundary is measured at: one with room for the hint on a single row. */
const _WIDE_ENOUGH_FOR_THE_HINT = 100;

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` in THIS process, for the fixture and the unit cases. */
async function shell(...argv: string[]): Promise<string> {
  const said: string[] = [];
  const io: CliIo = { out: (line) => said.push(line), err: () => undefined, fail: () => undefined };
  await run(argv, io);
  return said.join('\n');
}

/** The id in what a write printed — the handle the record was minted under. */
function mintedIn(said: string): string {
  const id = /\(([0-9a-f-]{36})\)/.exec(said)?.[1];
  if (id === undefined) throw new Error(`fixture: nothing printed an id: ${said}`);
  return id;
}

/** `mnema <argv>` as ANOTHER PROCESS, in the project, and what it printed. */
function elsewhere(...argv: string[]): string {
  return execFileSync('node', [CLI, ...argv], {
    cwd: project,
    env: environment,
    encoding: 'utf-8',
  });
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-occurrence-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  await shell('init');
  await shell('task', 'the task the session opened over');

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
// The whole delivery, in one run on a real terminal
// ---------------------------------------------------------------------------

/** The fixture the pty case drives the built binary over. */
const fixture = (): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

/** How many times `what` occurs in `text`. Overlapping is impossible for these. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/**
 * EVERYTHING THE SESSION SAID, ONCE EACH AND IN ORDER — the bytes written after the console
 * gave the caller's screen back.
 *
 * ⚠️ THE STREAM STOPPED BEING A PAGE, which is what every count in this file had to move for.
 * While the console lived in the caller's own buffer a line was written once and never taken
 * back, so *how many times is this in the bytes* and *how many times did the session say it*
 * were the same question. Every frame is the whole screen now, so a line is in the bytes once
 * per keystroke. What the session SAID is on the caller's buffer, written once each, after the
 * sequence that leaves the alternate screen (`repl/scrolling.ts`, `repl/console.ts`).
 */
const transcript = (bytes: string): string => bytes.slice(bytes.lastIndexOf('\u001b[?1049l'));

/** What one occurrence of a task's creation says, as this product composes it. */
const created = (id: string, at: string): string =>
  renderPlain(
    occurrenceLine({
      kind: 'task.created',
      v: 1,
      at,
      who: 'mnid:whoever',
      signerFp: 'fp',
      which: THE_AGENT,
      subject: id,
      payload: { title: 'anything' },
    } as CatalogEvent),
  );

describe('a session shows what another process wrote while it was open', () => {
  /** Everything one run produced, so the cases below read one session rather than four. */
  let ran: Ran;
  let first: string;
  let second: string;

  beforeAll(async () => {
    // The session says something of its own BEFORE anything else writes: without a line
    // already in the scrollback there is nothing for an occurrence to be measured against,
    // and the case about not rewriting what was said would be about an empty page.
    const answers: Step = {
      types: 'verify\r',
      // THE SECOND OCCURRENCE, for the reason {@link THE_VERDICT} gives: the panel says the
      // sentence when the session opens, so the first one is not an answer to anything.
      until: (bytes) => times(bytes, THE_VERDICT) > 1,
      what: 'answered the verb it was asked',
    };
    // HOW MANY OCCURRENCES ARE ON THE PAGE is what says the step happened, and the count
    // is the step's own rather than read off a variable the step also sets: a wait whose
    // condition moves with what it is waiting for is a wait that can be satisfied by the
    // step before it.
    const writes = (title: string, sofar: number, keep: (id: string) => void): Step => ({
      does: () => {
        keep(mintedIn(elsewhere('task', title, '--which', THE_AGENT)));
      },
      until: (bytes) => times(bytes, 'task.created') >= sofar,
      what: `showed what another process wrote (${title})`,
    });
    first = '';
    second = '';
    ran = await inPty(fixture(), {
      columns: COLUMNS,
      rows: ROWS,
      steps: [
        opensAConsole(PROMPT),
        answers,
        writes('what the agent just did', 1, (id) => {
          first = id;
        }),
        writes('and then did again', 2, (id) => {
          second = id;
        }),
        {
          types: `${CLEARS_THE_LINE}${PREFIX}exit\r`,
          what: 'left',
          until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(`${PREFIX}exit`),
        },
      ],
    });
  }, 240_000);

  it('lands the occurrence, with the record it moved and the agent that moved it', () => {
    // THE WHOLE FEATURE IN ONE ASSERTION: a session that typed nothing but a read has two
    // lines on it that no keystroke could have produced.
    expect(ran.bytes).toContain(first);
    expect(ran.bytes).toContain(second);
    expect(ran.bytes).toContain(THE_AGENT);
    // ⚠️ COUNTED ON THE TRANSCRIPT AND NOT IN THE STREAM, and the difference is the model: every
    // frame redraws the whole screen, so a line the session said once is in the bytes once per
    // keystroke. What the session SAID, once each and in order, is what it writes onto the
    // caller's own buffer on the way out ({@link transcript}).
    expect(times(transcript(ran.bytes), 'task.created')).toBe(2);
    // AND THE LINE IS THE COMPOSER'S, not this file's: the parts, in the order and the
    // spacing `presentation/` puts them in, found on the page the terminal received. The
    // instant comes off the record rather than out of a clock here, so what is compared is
    // the line this product would compose for the event it really appended.
    for (const id of [first, second]) {
      const line = created(id, instantOf(id));
      expect(withoutStyle(ran.bytes), line).toContain(line.trim());
    }
  });

  it('does not rewrite what the session had already said', () => {
    // THE PROMISE THIS SURFACE IS BUILT ON. The verdict the session printed before the
    // record moved is above the occurrences on the page; anything that redrew the
    // scrollback to make room for them would put it in the stream a second time.
    //
    // ⚠️ IT COUNTED THE OCCURRENCES OF THE SENTENCE AND EXPECTED ONE, and that was wrong
    // about the page rather than about the product: the opening panel states the same
    // verdict, so the session says it twice before anything moves. What the case is really
    // about is the DIFFERENCE — as many times after the occurrences as before them.
    // ⚠️ AND IT IS READ OFF THE TRANSCRIPT, which is where "said once" is a question with an
    // answer. In the stream every line is redrawn on every frame; on the caller's own buffer
    // each one appears exactly as often as the session said it ({@link transcript}).
    const said = THE_VERDICT;
    // ONCE — the verb's answer. ⚠️ IT WAS TWICE, the panel's and the verb's, because the panel
    // was landed like a line; the arrangement is a REGION now and never goes on the roll
    // (`repl/panel.ts`, `Opening.above`), so the transcript holds only what was said.
    expect(times(transcript(ran.bytes), said), said).toBe(1);
    // And the one sentence the opening does land, which is written once for a session and is
    // the discriminant this suite already uses for "nothing was said twice".
    expect(times(transcript(ran.bytes), 'It runs the')).toBe(1);
    // ⛔ NOR THE ERASE. The one sequence this product refuses to write is the one that takes
    // the caller's own history with it, in any buffer — and a region that grew past the
    // viewport is how it would arrive without anybody asking for it.
    expect(ran.bytes).not.toContain('\u001b[3J');
  });

  it('leaves the badge, the rules and the hint exactly where they were', () => {
    // ONE READING OF THE REGION, taken from the SCREEN rather than from the stream: what
    // the input area costs is rows on a terminal, and only a screen has any. What it covers
    // is the arrangement from the badge DOWN — the two rules, the row being typed, the hint
    // — which is what would move if an occurrence had landed among them.
    //
    // ⚠️ IT DOES NOT COVER A ROW ADDED ABOVE THE BADGE, and that is written here rather
    // than left implied: the palette opens there, so a region that grew UPWARDS would leave
    // this reading identical. Measured — a mutation that put the occurrences in the palette
    // left this case green. The half with teeth is the boundary case below.
    const before = shapeOfTheInput(ran.bytes.slice(0, ran.at[1]));
    const after = shapeOfTheInput(ran.bytes.slice(0, ran.at[3]));
    expect(after).toEqual(before);
    // NOT VACUOUS: the second reading really is of a page that has the occurrences on it.
    expect(ran.bytes.slice(0, ran.at[3])).toContain(first);
    expect(ran.bytes.slice(0, ran.at[1])).not.toContain(first);
  });

  it('goes on answering the caller afterwards', () => {
    // The session left by the word that leaves, which is only reachable if the prompt was
    // still taking keystrokes after everything above.
    expect(ran.bytes.lastIndexOf(PROMPT)).toBeGreaterThan(ran.bytes.indexOf(`${PREFIX}exit`));
  });

  // ⚠️ A CASE STOOD HERE AND IT DIED WITH THE BOUNDARY IT BRACKETED. It ran the session at the
  // shortest height where the layout still redrew PART of the page and one row below it, to prove
  // an occurrence landing could not push the region over the height at which the library redraws
  // the WHOLE screen — the path whose sequence carries the erase of the caller's history.
  //
  // NOTHING GROWS WITH WHAT A SESSION SAYS ANY MORE. An occurrence goes on the roll, and the
  // middle region is a WINDOW onto it whose height is what the two fixed regions leave
  // (`repl/scrolling.ts`, `repl/region.ts`) — so the region is the same height after ten thousand
  // occurrences as after none, and there is no boundary for one to walk the page over. The frame
  // is fullscreen at every height by construction, which means the library's own path is reached
  // on every session there is; that it costs the caller's history nothing is asserted where it is
  // now true (`tests/the-screen-is-ours.test.ts`).

  /** The instant the record carries for `id`, read off the record rather than guessed. */
  function instantOf(id: string): string {
    const found = /"at":"([^"]+)"/.exec(
      entriesOfTheRecord().find((line) => line.includes(`"subject":"${id}"`)) ?? '',
    )?.[1];
    if (found === undefined) throw new Error(`no event of the record names ${id}`);
    return found;
  }
});

/** Every stored line of every tail of the project's committed tree. */
function entriesOfTheRecord(): string[] {
  const tails = join(theTrees()[0] as string, 'tails');
  const lines: string[] = [];
  for (const tail of readdirSync(tails)) {
    const dir = join(tails, tail);
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl'))) {
      lines.push(...readFileSync(join(dir, file), 'utf-8').split('\n'));
    }
  }
  return lines;
}

/**
 * THE TREES A SESSION OPENED HERE WOULD FOLLOW, out of the same call the opening pays for
 * — the committed one first, then this machine's private one.
 *
 * Asked of `runVerify` rather than joined out of path fragments, because that is where a
 * session takes them from: a case that spelled the directories would be asserting against
 * its own idea of where a tree lives, and would go on passing the day one moved.
 */
function theTrees(): readonly string[] {
  const verdict = runVerify({ ...here(), requirement: DEFAULT_REQUIREMENT, global: false });
  if (!verdict.ok) throw new Error('the fixture has no project to follow');
  return verdict.trees.map((tree) => tree.root);
}

/** The bytes with every style sequence off, so a composed line can be found in them. */
function withoutStyle(bytes: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS what is removed.
  return bytes.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');
}

/**
 * The mark the badge opens with, spelled by its code point like every unusual glyph in
 * this repository — and the top of the region the layout redraws.
 */
const LEVEL_MARK = '◉';

/**
 * THE SHAPE OF THE REGION THAT IS REDRAWN: every row of it, top to bottom.
 *
 * It is read off a replayed screen because the question is about rows a reader sees. The
 * region runs from the BADGE — the corner row, and the top of the tallest arrangement — to
 * the last row anything is written on, which is the hint. An occurrence landing inside it
 * would put a row between those two that the reading before it does not have.
 *
 * ⚠️ IT WAS "EVERY ROW FROM THE PROMPT DOWN", and that measured the wrong thing twice: the
 * ECHO of a submitted line carries the prompt too and sits in the scrollback, and the blank
 * rows under the frame are as many as the page has not filled yet — so the reading moved
 * with how much the session had said rather than with the shape of the region.
 */
function shapeOfTheInput(bytes: string): readonly string[] {
  const rows = screenOf(bytes, COLUMNS, ROWS).rows.map((row) => row.trimEnd());
  const badge = rows.findLastIndex((row) => row.includes(LEVEL_MARK));
  const last = rows.findLastIndex((row) => row.length > 0);
  expect(badge, 'no row of the screen was the badge').toBeGreaterThanOrEqual(0);
  // The row being typed is inside what is measured, or the measurement is of some other
  // part of the page.
  const shape = rows.slice(badge, last + 1);
  expect(shape.some((row) => row.startsWith(PROMPT))).toBe(true);
  return shape;
}

// ---------------------------------------------------------------------------
// The follower itself: what it answers, and what it costs to answer nothing
// ---------------------------------------------------------------------------

describe('following the record answers with what grew, and only once', () => {
  /** The committed tree of this project — the one every write of these cases lands in. */
  const roots = (): readonly string[] => [theTrees()[0] as string];

  it('answers with nothing at all while nothing moves', async () => {
    const following = followingTheRecord(roots());
    expect(following.whatHappened()).toEqual([]);
    expect(following.whatHappened()).toEqual([]);
  });

  it('answers with what was appended, and does not answer with it twice', async () => {
    const following = followingTheRecord(roots());
    const id = mintedIn(await shell('task', 'appended while somebody was following'));
    const happened = following.whatHappened();
    expect(happened.map((event) => event.kind)).toContain('task.created');
    expect(happened.some((event) => event.subject === id)).toBe(true);
    // ASKED AGAIN WITH NOTHING NEW: the mark has not moved, so there is nothing to say —
    // and an occurrence a caller has already read may not arrive a second time.
    expect(following.whatHappened()).toEqual([]);
    // And a follower built AFTER the append starts from there: what was already written is
    // the record the session opened over, not an occurrence.
    expect(followingTheRecord(roots()).whatHappened()).toEqual([]);
  });

  it('answers with every event of a burst, in the order the tail proves', async () => {
    const following = followingTheRecord(roots());
    const many = 40;
    for (let each = 0; each < many; each += 1) await shell('task', `one of a burst ${each}`);
    const happened = following.whatHappened();
    // Every task is a creation and the transition that puts it in its first state, so the
    // count is read off the kinds rather than typed twice.
    expect(happened.filter((event) => event.kind === 'task.created')).toHaveLength(many);
    expect(happened.length).toBeGreaterThan(many);
    // The order is the tail's own, which is the order the instants read in.
    const instants = happened.map((event) => event.at);
    expect([...instants].sort()).toEqual(instants);
    expect(following.whatHappened()).toEqual([]);
  });

  it('follows a tree that has no record yet, and says so when one appears', async () => {
    // The private tree of a fresh project has nothing on disk at all — no tails, no
    // directory — and a follower over it is a follower over an empty extent. The first
    // thing written there is an occurrence, not a baseline.
    const following = followingTheRecord([theTrees()[1] as string]);
    expect(following.whatHappened()).toEqual([]);
    // Written with the tree named, because the team's default scope is the committed one:
    // a memory with nothing said about where it goes lands in the tree that travels.
    await shell('memory', 'the first thing this machine kept to itself', '--scope', 'private');
    const happened = following.whatHappened();
    expect(happened.map((event) => event.kind)).toContain('memory.captured');
    expect(following.whatHappened()).toEqual([]);
  });

  it('costs nothing and says nothing with no project to follow', () => {
    const following = followingTheRecord([]);
    expect(following.whatHappened()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// One line per occurrence
// ---------------------------------------------------------------------------

describe('an occurrence is one line, whatever the record holds', () => {
  /** Every whitespace form that opens a line, and the forgery each one could carry. */
  const BREAKERS = ['\n', '\r', '\r\n', ' ', ' '];

  /** One event, with whatever a case puts in it. */
  const event = (over: Partial<CatalogEvent>): CatalogEvent =>
    ({
      kind: 'task.created',
      v: 1,
      at: '2026-08-09T10:00:00.000Z',
      who: 'mnid:whoever',
      signerFp: 'fp',
      subject: 'the-id',
      payload: { title: 'a task' },
      ...over,
    }) as CatalogEvent;

  it('keeps a forged agent, id, instant and kind inside the line they were written in', () => {
    // THE SHARPEST FORM OF THE RULE. Elsewhere a broken field forges a row in a list under
    // a header that counts them; here there is no list — the second half would be an
    // occurrence that never happened, arriving in the caller's scrollback while they watch
    // and reading exactly like one that did.
    for (const breaker of BREAKERS) {
      for (const forged of [
        event({ which: `an-agent${breaker}  a forged occurrence` }),
        event({ subject: `the-id${breaker}  another forged one` }),
        event({ at: `2026-08-09T10:00:00.000Z${breaker}  and another` }),
        event({ kind: `task.created${breaker}  and one more` } as Partial<CatalogEvent>),
      ]) {
        const printed = renderPlain(occurrenceLine(forged)).split('\n');
        expect(printed, JSON.stringify(breaker)).toHaveLength(1);
      }
    }
  });

  it('says a person when no agent did it, rather than leaving a gap', () => {
    // An absent `which` is a FACT — somebody acted directly — and the word is the one the
    // rest of the product uses for the same absence.
    expect(renderPlain(occurrenceLine(event({})))).toContain('a person');
    expect(renderPlain(occurrenceLine(event({ which: 'an-agent' })))).toContain('an-agent');
  });
});

// ---------------------------------------------------------------------------
// The structural half: one cadence, and one door onto the record
// ---------------------------------------------------------------------------

/** One module of this surface, as its source. */
const sourceOf = (dir: string, file: string): string => readFileSync(join(SRC, dir, file), 'utf-8');

/** Every module of a directory that is not a test. */
const modulesIn = (dir: string): string[] =>
  readdirSync(join(SRC, dir)).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));

describe('the cadence is the one that already existed', () => {
  it('⚠️ waits for the record on the one cadence the console has left', () => {
    const source = sourceOf('repl', 'console.ts');
    // EVERY TIMER OF THIS FILE, found by what a timer IS rather than by a list: the delay
    // each one is given has to be the constant, so a second number cannot be introduced
    // beside it without this going red.
    //
    // ⚠️ IT WAS TWO READERS OF ONE CONSTANT AND IT IS ONE, which is the count going DOWN and is
    // as much what this case is for. The same number was how long the terminal's size had to
    // stop changing before the page was drawn again — a drag delivered a size every two or three
    // milliseconds and each of them TURNED A PAGE, so the wait existed to coalesce them. Nothing
    // is turned now: a resize is a frame drawn at the size the device has when it is drawn
    // (`repl/console.ts`, `resized`), so there is nothing for a wait to coalesce and the damper
    // is off the geometry entirely. What is left is the question this case was always about.
    const delays = [...source.matchAll(/set(?:Timeout|Interval)\([\s\S]*?,\s*([^,)]+)\)/g)].map(
      (found) => (found[1] as string).trim(),
    );
    expect(delays.length, 'no timer at all in the console').toBe(1);
    for (const delay of delays) expect(delay).toBe('HOW_OFTEN_THE_RECORD_IS_ASKED');
    // And the constant is declared once, with a number, in the file that owns the streams.
    expect(times(source, 'const HOW_OFTEN_THE_RECORD_IS_ASKED =')).toBe(1);
    // NOT VACUOUS: the follower has no number of its own to wait on, so the cadence cannot
    // have been quietly moved there.
    expect(sourceOf('repl', 'following.ts')).not.toContain('setInterval');
    expect(sourceOf('repl', 'following.ts')).not.toContain('setTimeout');
  });
});

describe('what asks the disk about the record, on this surface', () => {
  /**
   * THE DOORS. Every way this product reaches a chain on disk: the replay, the verifier,
   * the projections, the tails themselves — and the PROBE, which is not a read and is
   * named here so it can be held to one module rather than left out of the question.
   */
  const DOORS = [
    'runVerify',
    'verifyChain',
    'ProjectionCache',
    'withScopedCaches',
    'orderedEvents',
    'readTail',
    'listTails',
    'orderedSegments',
    'chainExtent',
  ];

  it('is the opening and the probe, and nothing else redraws through either', () => {
    // THE SITES ARE FOUND BY THE DISCRIMINANT rather than by a list: every module of the
    // session, asked which doors it names. Two of them may — the one that pays for the
    // opening, and the one that asks whether anything moved — and a third would be a
    // console that reads the record without being asked to.
    const opened: Record<string, string[]> = {};
    for (const file of modulesIn('repl')) {
      const found = DOORS.filter((door) => sourceOf('repl', file).includes(door));
      if (found.length > 0) opened[file] = found;
    }
    expect(Object.keys(opened).sort()).toEqual(['following.ts', 'session.ts']);
    // The opening pays a verify and asks nothing else; the probe asks the extent and reads
    // the tail it names — which is what makes each of them the ONE place its rule lives.
    expect(opened['session.ts']).toEqual(['runVerify']);
    expect([...(opened['following.ts'] ?? [])].sort()).toEqual([
      'chainExtent',
      'listTails',
      'readTail',
    ]);
    // NOT VACUOUS: the scan really read the surface, and the surface really has modules
    // that name none of the doors.
    expect(modulesIn('repl').length).toBeGreaterThan(Object.keys(opened).length);
  });
});
