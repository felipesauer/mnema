/**
 * THE CORNER OF THE CONSOLE, WHEN THE RECORD MOVES UNDER THE SESSION — on a real
 * pseudo-terminal, with a real break, planted by another process while the page is up.
 *
 * ## What it was
 *
 * The console rules on the record ONCE, when it opens, and the badge in the corner states
 * the level it got back for the whole session. `repl/session.ts` said that row was *"the
 * PERSISTENT ASSERTION of the proven level"* and closed the argument with *"a corner that
 * stays quiet while the record is broken is the one failure this surface may not have"*.
 *
 * Measured, and it is why this file exists: with a duplicate of the tail's last entry
 * appended DURING the session — the same seq, the same prev, which is what two writers
 * appending at once used to leave — the body of the page printed `seq gap: expected 8,
 * found 7` and the corner, IN THE SAME FRAME, said `fully-signed`. The surface disagreed
 * with itself on one screen. The sentence was true about the opening and false about every
 * instant after it.
 *
 * ## Why it is asked here and not in process
 *
 * The badge used to be a PROP of the frame, composed once and handed to the layout, and
 * the question this file asks is whether a row that is fixed for the session can stop
 * being fixed without anything else on the page moving. Both halves of that — the row
 * changing, and nothing else changing with it — are about frames a device received. A case
 * that called the composer would prove the words and say nothing about whether they ever
 * reach a screen.
 *
 * ## What it does NOT claim, and the claim is narrower than the defect
 *
 * The corner does not detect a break. What it asks is the cheap question the follower
 * beside it already pays for — whether the chain MOVED — so a sound append degrades it
 * exactly as a planted duplicate does, and the second run below asserts precisely that
 * rather than leaving it to be discovered. Ruling again is `verify`, which the row names
 * and which costs 54 ms over a small record and 1.7 s over a nine-megabyte one (measured
 * while the verifier still walked the tail once per checkpoint; `repl/proving.ts` has what
 * it costs since); a console that re-ruled on a clock would be a replay loop. What the
 * corner stops doing is asserting a level about a record it has not read.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { renderPlain } from '../src/presentation/plain.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { watchingTheProof } from '../src/repl/proving.js';
import { badgeLine } from '../src/repl/session.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ENDS_THE_INPUT } from './support/console.js';
import {
  arrivedSince,
  type Fixture,
  inPty,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { theSettledScreen } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at, and what the other process runs. */
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

/** What the caller types in front of, as the layout writes it. */
const PROMPT = 'mnema>';

/**
 * Ctrl-C, which abandons the row being typed.
 *
 * Built from its CODE POINT rather than typed, like every unusual byte in this
 * repository: a control character in a source file is a byte nobody can see, and the
 * guard that says so is `the-prose-carries-its-own-emphasis.test.ts` — which is what
 * caught this line.
 */
const CLEARS_THE_LINE = String.fromCodePoint(0x03);

const COLUMNS = 140;
const ROWS = THE_FLOOR.rows;

/**
 * WHAT A SOUND TREE'S VERDICT SAYS, and what a broken one's says — the two the body of the
 * page prints, read off the product rather than retyped.
 *
 * They are what the CORNER is compared against: the whole subject of this file is the two
 * halves of one screen agreeing, so both halves have to be named.
 */
const VERIFIED = 'local integrity verified';
const FAILED = 'local integrity FAILED';

/**
 * THE CLAUSE THE CORNER ADDS once its level has stopped covering the record, as the module
 * that composes it composes it — never retyped.
 *
 * It is taken as the DIFFERENCE between the two rows rather than written out, so a case
 * here cannot come to expect a wording the product does not use: whatever
 * `badgeLine(level, 'the-record-as-it-opened')` adds to `badgeLine(level,
 * 'the-whole-record')` is what a reader will see.
 */
function theClause(): string {
  const covered = renderPlain(badgeLine('fully-signed', 'the-whole-record'));
  const opened = renderPlain(badgeLine('fully-signed', 'the-record-as-it-opened'));
  expect(opened, 'the two forms of the badge are the same row').not.toBe(covered);
  return opened
    .replace(covered.split('fully-signed')[0] as string, '')
    .replace(/^fully-signed/, '')
    .split(' · ')[0] as string;
}

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` in THIS process, for the fixture. */
async function shell(...argv: string[]): Promise<string> {
  const said: string[] = [];
  const io: CliIo = { out: (line) => said.push(line), err: () => undefined, fail: () => undefined };
  await run(argv, io);
  return said.join('\n');
}

/**
 * A PROJECT OF ITS OWN PER RUN, and the reason is the first run's subject.
 *
 * One of the two sessions below BREAKS its record and leaves it broken — that is what it
 * is for — and the other one's whole assertion is that a sound record leaves the corner
 * where it was. Sharing a tree between them would make the second case read a record the
 * first one broke, which is a fixture proving nothing about the product (measured: it
 * waited for a verdict the tree could no longer give and timed out).
 */
async function aProject(named: string): Promise<string> {
  const at = join(sandbox, named);
  mkdirSync(at, { recursive: true });
  process.chdir(at);
  await shell('init');
  await shell('decision', 'the decision the session opened over', 'because');
  return at;
}

/** `mnema <argv>` as ANOTHER PROCESS, in a project. */
function elsewhere(at: string, ...argv: string[]): string {
  return execFileSync('node', [CLI, ...argv], { cwd: at, env: environment, encoding: 'utf-8' });
}

/**
 * The committed tail's one segment file — the bytes a plant is made in.
 *
 * The tail is read off the DIRECTORY rather than named here: which tail this machine
 * writes is a function of its key, so a name written down would be a fixture about
 * somebody else's record.
 */
function segment(at: string): string {
  const tails = join(at, '.mnema', 'tails');
  const tail = readdirSync(tails)[0] as string;
  return join(tails, tail, '000001.jsonl');
}

/**
 * THE PLANT: the tail's last entry, appended again — same seq, same prev.
 *
 * Every byte of it is a byte this product wrote. A fixture that hand-wrote an entry would
 * be a case about a record no writer can produce.
 */
function plantTheBreak(at: string): void {
  const file = segment(at);
  const held = readFileSync(file, 'utf-8');
  const lines = held.trimEnd().split('\n');
  writeFileSync(file, `${held}${lines[lines.length - 1] as string}\n`);
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-corner-'));
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;

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

const fixture = (project: string): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/** The row of a screen the corner is on — the one holding the badge's mark. */
function theCornerOf(rows: readonly string[]): string {
  const found = rows.filter((row) => row.includes('◉'));
  expect(found.length, `rows with the badge mark:\n${rows.join('\n')}`).toBe(1);
  return (found[0] as string).trim();
}

/**
 * The step that leaves: Ctrl-C to abandon whatever is on the row, then Ctrl-D.
 *
 * It is spelled here rather than imported because the two keys together are what a caller
 * does, and a step that sent only the second would be ending a session with a half-typed
 * row in it.
 */
const leaves: Step = {
  types: `${CLEARS_THE_LINE}${ENDS_THE_INPUT}`,
  until: () => true,
  what: 'left',
};

describe('the corner stops claiming a level about a record it has not read', () => {
  let ran: Ran;

  beforeAll(async () => {
    const project = await aProject('broken-under-it');
    ran = await inPty(fixture(project), {
      columns: COLUMNS,
      rows: ROWS,
      steps: [
        opensAConsole(PROMPT),
        {
          // THE BODY SAYS THE RECORD IS SOUND, BEFORE ANYTHING MOVES — so the corner
          // agreeing with it is a fact about this run rather than about a fixture.
          types: 'verify\r',
          // THE SECOND OCCURRENCE: the opening panel already states the verdict once, so
          // the first is not an answer to anything.
          until: (bytes) => times(bytes, VERIFIED) > 1,
          what: 'answered the verb it was asked',
        },
        {
          does: () => {
            plantTheBreak(project);
          },
          until: arrivedSince(theClause()),
          what: 'said in the corner that its level is about the record as it opened',
        },
        {
          // AND THE BODY IS ASKED AGAIN, so the two halves of one screen can be compared.
          // This is the frame the old surface contradicted itself on.
          types: 'verify\r',
          until: arrivedSince(FAILED),
          what: 'answered the verb over the broken record',
        },
        leaves,
      ],
    });
  }, 240_000);

  it('degrades the corner, in a frame the caller never asked for', () => {
    // THE WHOLE DEFECT IN ONE ASSERTION: nothing was typed between the record breaking and
    // the corner changing. The step that moved the record typed no key at all.
    const screen = theSettledScreen(ran.bytes, COLUMNS, ROWS, FAILED);
    expect(screen.alternate).toBe(true);
    const corner = theCornerOf(screen.rows);
    expect(corner).toContain(theClause());
    // AND IT IS THE PRODUCT'S OWN ROW, not a string this file expects: the whole badge, as
    // the module that composes it composes it for the level the opening proved.
    expect(corner).toBe(renderPlain(badgeLine('fully-signed', 'the-record-as-it-opened')));
  });

  it('and the two halves of the screen agree', () => {
    // THE FAILURE THE DOCTRINE NAMED. On the old surface this exact frame carried `seq gap`
    // in the body and `fully-signed` in the corner. Both are read off ONE screen, which is
    // the only way the disagreement is a fact rather than two facts.
    const screen = theSettledScreen(ran.bytes, COLUMNS, ROWS, FAILED);
    expect(screen.text).toContain(FAILED);
    // The issue itself, and it is matched on the OPENING of the sentence alone: a verdict
    // is folded to the page it lands on, so the numbers after the colon are on the next row
    // at this width. What is being asked is whether the break is on the screen, not how the
    // fold broke it.
    expect(screen.text).toContain('seq gap:');
    expect(theCornerOf(screen.rows)).not.toBe(
      renderPlain(badgeLine('fully-signed', 'the-whole-record')),
    );
  });

  it('and it said the level in full before the record moved', () => {
    // THE OTHER END OF THE SAME RUN, and what makes the case above about the break rather
    // than about a corner that always reads that way. The frame the verb's first answer
    // settled on is before the plant, and the corner on it is the row as it always was.
    const opening = theSettledScreen(ran.bytes.slice(0, ran.at[1] as number), COLUMNS, ROWS);
    expect(opening.text).toContain(VERIFIED);
    expect(theCornerOf(opening.rows)).toBe(
      renderPlain(badgeLine('fully-signed', 'the-whole-record')),
    );
  });
});

describe('a record nothing moves leaves the corner exactly where it was', () => {
  let ran: Ran;

  let project: string;

  beforeAll(async () => {
    project = await aProject('nothing-moves-it');
    ran = await inPty(fixture(project), {
      columns: COLUMNS,
      rows: ROWS,
      steps: [
        opensAConsole(PROMPT),
        {
          types: 'verify\r',
          until: (bytes) => times(bytes, VERIFIED) > 1,
          what: 'answered the verb it was asked',
        },
        {
          // THE SESSION IS LEFT WATCHING. The record is asked ten times a second, so this
          // is many rounds of the question over a record nobody is writing. A corner that
          // degraded on its own would do it here.
          types: 'skills\r',
          until: arrivedSince('No patterns'),
          what: 'answered a second verb, some ticks later',
        },
        {
          // AND THEN A SOUND APPEND, which is the limit stated as a case rather than left
          // to be found: what the corner keys on is the record MOVING, not the record
          // breaking. Another process recording a task degrades it exactly as a planted
          // duplicate does — and that is the honest reading of what the cheap question can
          // answer (`repl/proving.ts`).
          does: () => {
            elsewhere(project, 'task', 'a sound append by somebody else');
          },
          until: arrivedSince(theClause()),
          what: 'degraded the corner over a sound append too',
        },
        leaves,
      ],
    });
  }, 240_000);

  it('says the level in full for as long as nothing moves', () => {
    // THE NON-VACUITY HALF, and it is read at the END of the watching rather than at the
    // start: the corner is asked on a clock, so a case that read the opening frame would be
    // green on a surface that degraded one tick later.
    const watched = theSettledScreen(ran.bytes.slice(0, ran.at[2] as number), COLUMNS, ROWS);
    expect(watched.text).toContain(VERIFIED);
    expect(theCornerOf(watched.rows)).toBe(
      renderPlain(badgeLine('fully-signed', 'the-whole-record')),
    );
    // And the clause never reached the device at all while nothing was moving — which the
    // row above cannot say, because it reads one frame.
    expect(ran.bytes.slice(0, ran.at[2] as number)).not.toContain(theClause());
  });

  it('and degrades on a SOUND append, which is what it really asks', () => {
    // THE LIMIT, ASSERTED. A reader who took the clause for "the record broke" would be
    // wrong, and the case that says so is here rather than in a comment.
    const after = theSettledScreen(ran.bytes, COLUMNS, ROWS, theClause());
    expect(theCornerOf(after.rows)).toBe(
      renderPlain(badgeLine('fully-signed', 'the-record-as-it-opened')),
    );
    // And the record really is still sound — the verdict the session printed is the only
    // one anything ruled, and nothing here broke a tail.
    expect(elsewhere(project, 'verify')).toContain(VERIFIED);
  });
});

describe('the watch on the proof, asked directly', () => {
  /**
   * WHERE A TREE'S CHAIN IS — the directory the extent is read out of.
   *
   * It is the same one the plant is made in, one level up: a layout's root holds `tails/`,
   * and that is what the sweep of segments is relative to.
   */
  const chainRoot = (at: string): string => join(at, '.mnema');

  it('covers the whole record while nothing moves, however often it is asked', async () => {
    // THE NON-VACUITY HALF, ASKED WHERE IT IS CHEAP. The page cases above can only afford a
    // handful of ticks; this is the same question a hundred times over a tree nobody is
    // writing, which is what would catch an answer that decayed on its own.
    const project = await aProject('asked-directly-and-still');
    const proof = watchingTheProof([chainRoot(project)]);
    for (let asked = 0; asked < 100; asked += 1) {
      expect(proof.coversTheWholeRecord(), `ask ${asked}`).toBe(true);
    }
  });

  it('stops covering it the moment a byte lands, and never covers it again', async () => {
    const project = await aProject('asked-directly-and-moved');
    const proof = watchingTheProof([chainRoot(project)]);
    expect(proof.coversTheWholeRecord()).toBe(true);
    elsewhere(project, 'task', 'somebody else appended');
    expect(proof.coversTheWholeRecord()).toBe(false);
    // AND IT LATCHES. A verdict is formed at an INSTANT, so a later instant whose extent
    // happens to match is not that instant — and the latch is also what bounds the cost,
    // because nothing is asked of the disk after this.
    expect(proof.coversTheWholeRecord()).toBe(false);
    expect(proof.coversTheWholeRecord()).toBe(false);
  });

  it('and with no record to rule on, it covers everything there is', async () => {
    // A session opened outside any project holds no verdict, so there is no level for a
    // corner to degrade — and a watch that answered `false` there would make the corner
    // name a level nobody stated.
    const proof = watchingTheProof([]);
    expect(proof.coversTheWholeRecord()).toBe(true);
  });
});
