/**
 * THE INPUT HAS ITS OWN PLACE — two rules across the terminal, a badge in the corner, and
 * a hint short enough to read.
 *
 * IT CAME OUT OF THREE MARKS ON ONE SCREENSHOT: the input should look like the console it
 * was drawn from, there should be something about mnema in the right-hand corner, and the
 * hint should be short. The geometry was MEASURED off that console rather than guessed —
 * runs of the box-drawing rune of 3, 93, 63, 118, 120 and 120 on a screen 120 wide, the
 * last two being the input, which is therefore not a box but two rules with no sides; and
 * a mark on column 102 with the value beside it and the verb after a middle dot. So every
 * case here asserts against a MEASUREMENT rather than against a picture:
 *
 *   - THE RULES MEASURE THE TERMINAL. Three widths and a resize, on a real
 *     pseudo-terminal, on the SCREEN — a run that stopped short is the ragged edge the
 *     panel had before it was drawn corner to corner.
 *   - THE BADGE ENDS ON THE LAST COLUMN. Right-aligned rather than at a column somebody
 *     chose, which is asked by watching where it starts move when the width does.
 *   - THE CARET IS ON THE ROW BEING TYPED. It used to be the first row of the redrawn
 *     region and there was nothing above it; there are up to three rows above it now, and
 *     how many is arithmetic (`repl/area.ts`). Nothing but a screen can say where the
 *     caret ended up, which is why the model grew a cursor for this delivery.
 *   - THE AREA DEGRADES BY HEIGHT, and that is what keeps this delivery from opening a
 *     hole. The region went from three rows to five, and the height at which the layout
 *     library gives up on redrawing PART of the screen — and writes, inside what it does
 *     instead, the one erase this product refuses to write — moves with it. Measured
 *     again, in both directions, and the number went DOWN.
 *   - THE BADGE DOES NOT LIE. The worst level when the trees disagree, by the function
 *     that already folds them; nothing at all when there is no record to fold.
 *   - THE HINT FITS. Asserted against the width of a terminal rather than against a
 *     number written here, and against the words the session actually answers to.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProvenLevel } from '@mnema/chain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runVerify } from '../src/commands/verify.js';
import { SEVERITIES, type Severity } from '../src/presentation/line.js';
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { statement } from '../src/presentation/verdict.js';
import { areaFor } from '../src/repl/area.js';
import { badgeLine, openSession, tips } from '../src/repl/session.js';
import { ABOUT, LEAVE, PREFIX, SESSION_WORDS } from '../src/session-words.js';
import { here } from '../src/wiring/context.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { DEFAULT_REQUIREMENT, levelSeverity, VERIFY_VERB } from '../src/wiring/verify.js';
import { ESC, fakeTerminal, hooksNothing, until, withoutLayout } from './support/console.js';
import { screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guards that read the surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The glyphs the drawing is made of, named by their code points rather than typed.
 *
 * A rule is one keystroke away from a pipe and a run from a hyphen, and a mark nobody can
 * tell from a neighbouring one is a mark an edit destroys without anybody seeing it. Three
 * raw control bytes got into the first draft of this very file, which is the twenty-third
 * time on this bench.
 */
const RUN = '─';
const MARK = '◉';
const MIDDLE_DOT = '·';

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';
/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** Ctrl-C, which abandons the row being typed. Spelled as an escape, for the same reason. */
const CLEARS_THE_LINE = '\u0003';

/** The sequence that erases the caller's history. It is not this product's to write. */
const ERASES_THE_HISTORY = `${ESC}[3J`;

/**
 * The widest a hint may be and still be one row.
 *
 * Eighty columns, because that is the width every terminal has had since before any of
 * them were on a screen, and the one a reader can be assumed to have. It is the WIDTH the
 * hint is measured against — nothing here counts characters and compares the count to a
 * number somebody wrote down about the sentence.
 */
const AN_ORDINARY_TERMINAL = 80;

/** How many clauses a hint may have. Three, which is what the reference says in about fifty. */
const AT_MOST = 3;

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
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-input-'));
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

// ---------------------------------------------------------------------------
// The arithmetic: which arrangement a height has room for
// ---------------------------------------------------------------------------

/** A request with everything to show, so a case only says what it is changing. */
const showingEverything = { badge: true, candidates: false, hint: true };

describe('the area has forms, and the tallest one that fits is the one drawn', () => {
  it('gives up the badge first, then the rules, and never the row being typed', () => {
    // THE LADDER, at the heights that choose each rung. What is asserted is WHERE each
    // form gives way — one row below its own threshold — rather than how tall it is.
    const at = (rows: number) => areaFor({ ...showingEverything, rows }).form;
    expect(at(40)).toBe('full');
    expect(at(6)).toBe('full');
    expect(at(5)).toBe('ruled');
    expect(at(4)).toBe('bare');
    // And the floor is the floor: it is answered at heights no terminal has.
    for (const rows of [3, 2, 1, 0]) expect(at(rows), `${rows}`).toBe('bare');
  });

  it('never draws the badge when there is none, at any height there is', () => {
    // NO PROJECT, NO BADGE, and it is the FORM that does not exist rather than a row drawn
    // empty — so a session outside a project gets the ruled arrangement at every height
    // the full one would have fitted.
    for (const rows of [200, 40, 6, 5]) {
      const form = areaFor({ ...showingEverything, badge: false, rows }).form;
      expect(form, `${rows}`).not.toBe('full');
    }
    expect(areaFor({ ...showingEverything, badge: false, rows: 40 }).form).toBe('ruled');
    // Not vacuous: the same heights DO give the full form when there is a badge.
    expect(areaFor({ ...showingEverything, rows: 6 }).form).toBe('full');
  });

  it('counts the row a Tab offers, because it is a row the region redraws', () => {
    // The words a Tab could not choose between are a row like any other. A form chosen as
    // though they were not there would be arithmetic about a region that is not the one on
    // the screen, which is the exact shape of instrument this bench has been wrong with.
    const tall = { ...showingEverything, rows: 6 };
    expect(areaFor(tall).form).toBe('full');
    expect(areaFor({ ...tall, candidates: true }).form).toBe('ruled');
    // And the row is counted rather than merely changing the answer: the same form is one
    // taller with it than without it.
    const wide = { ...showingEverything, rows: 40 };
    expect(areaFor({ ...wide, candidates: true }).height - areaFor(wide).height).toBe(1);
  });

  it('says how many rows sit above the row being typed, and it is one per row drawn', () => {
    // WHAT THE CARET IS PUT AT. The differences between the forms are what says so: the
    // badge and one rule for the full form, one rule for the ruled one, nothing for the
    // bare one — and a Tab's row is above the typed one in all three.
    const rows = 40;
    const full = areaFor({ ...showingEverything, rows });
    const ruled = areaFor({ ...showingEverything, badge: false, rows });
    const bare = areaFor({ ...showingEverything, rows: 1 });
    expect(bare.above).toBe(0);
    expect(ruled.above - bare.above).toBe(1);
    expect(full.above - ruled.above).toBe(1);
    for (const request of [
      { ...showingEverything, rows },
      { ...showingEverything, badge: false, rows },
      { ...showingEverything, rows: 1 },
    ]) {
      const offered = areaFor({ ...request, candidates: true });
      expect(offered.above - areaFor(request).above, `${request.rows}`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// What the badge says
// ---------------------------------------------------------------------------

/** What a console drew, opened on a terminal of a given size and left again. */
async function openedAt(columns: number, rows = 40): Promise<string> {
  const terminal = fakeTerminal({ columns, rows });
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
  await until(() => terminal.bytes().includes(PROMPT), 'opened');
  terminal.type(CLEARS_THE_LINE);
  terminal.type(`${LEAVE}\r`);
  await closed;
  return terminal.bytes();
}

/** The one verdict over every tree, asked of the function the whole surface asks. */
function foldedLevel(): ProvenLevel {
  const verdict = runVerify({ ...here(), requirement: DEFAULT_REQUIREMENT, global: false });
  if (!verdict.ok) throw new Error('the fixture has no project');
  return verdict.record.level;
}

/** Every level the trees of this project are at, one per tree that has one. */
function levelsPerTree(): string[] {
  const verdict = runVerify({ ...here(), requirement: DEFAULT_REQUIREMENT, global: false });
  if (!verdict.ok) throw new Error('the fixture has no project');
  return verdict.trees.flatMap((tree) => (tree.kind === 'verdict' ? [tree.result.level] : []));
}

/** The row of a page holding `what`, escapes and all. */
function rowHolding(page: string, what: string): string {
  const row = page.split('\n').find((line) => line.includes(what));
  expect(row, `nothing on the page said ${JSON.stringify(what)}`).toBeDefined();
  return row as string;
}

/** Every SGR sequence on a line — what a renderer added to it. */
function sgrIn(text: string): string[] {
  return text.match(new RegExp(`${ESC}\\[[0-9;]*m`, 'g')) ?? [];
}

/** The same line with every style sequence off — what a pipe would have received. */
function withoutSgr(text: string): string {
  return text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

/**
 * WHAT A SEVERITY PAINTS AND NO OTHER ONE DOES, asked of the RENDERER rather than written
 * down.
 *
 * Two subtractions, and the second one is what the first draft got wrong. A severity adds
 * to a line that carries none, so the first subtraction is the bare line's own escapes —
 * that is the only way to name a hue without naming a colour, and it survives a renderer
 * that changes which red it writes (the shape `tests/the-panel.test.ts` uses to keep the
 * chrome's accent apart from the three). But what it adds is an opener AND A CLOSER, and
 * the closer is the SAME for all three: `39` gives the terminal's own foreground back
 * whichever hue was opened. Left in, "this badge carries no other outcome's hue" was false
 * of every badge there is. So the second subtraction is whatever the other severities also
 * add, and what is left is the code that IDENTIFIES this outcome.
 *
 * A severity that came to share its whole hue with another comes out EMPTY here, which is
 * why the case below asserts each of them is not — that is the non-vacuity, rather than a
 * count of distinct sets, which after this subtraction is true by construction.
 */
function hueOf(severity: Severity): string[] {
  const bare = new Set(sgrIn(renderStyled(statement('LABEL'))));
  const added = (which: Severity): string[] =>
    sgrIn(renderStyled(statement('LABEL', undefined, which))).filter((code) => !bare.has(code));
  const shared = new Set(SEVERITIES.filter((other) => other !== severity).flatMap(added));
  return added(severity).filter((code) => !shared.has(code));
}

/**
 * One level per outcome the surface distinguishes — and the case that uses them asserts
 * the set is COMPLETE against {@link SEVERITIES} rather than trusting this list.
 *
 * They are values the product produces: `fully-signed` is what a healthy record answers,
 * `hash-chain-only` is a tree between its first event and its first checkpoint, and
 * `broken` is what a truncated tail answers. Typed, so a renamed rung does not build.
 */
const OUTCOMES: readonly ProvenLevel[] = ['fully-signed', 'hash-chain-only', 'broken'];

/** The private tree's checkpoints file for a project, or nothing when it has no tree. */
function privateCheckpoints(root: string): string | undefined {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'checkpoints.jsonl') found.push(path);
    }
  };
  try {
    walk(join(root, '.mnema', 'private'));
  } catch {
    return undefined;
  }
  return found[0];
}

describe('the badge says what the record proved, and the verb that says the rest', () => {
  it('names the level the record is at and the verb that prints the verdict', async () => {
    const page = await openedAt(120);
    expect(page, 'no badge on the page').toContain(MARK);
    const badge = rowHolding(page, MARK);
    // The three parts, and not one of them is a word this case chose: the level comes from
    // the fold every reading of this surface reads, and the verb from the constant
    // commander is registered with.
    expect(badge).toContain(foldedLevel());
    expect(badge).toContain(VERIFY_VERB);
    expect(badge).toContain(MIDDLE_DOT);
    // Not vacuous: the level really is a word rather than an empty string.
    expect(foldedLevel().length).toBeGreaterThan(3);
  }, 120_000);

  it('says the WORST of the trees when they disagree, by the fold that already exists', async () => {
    // THE CASE THIS ROW COULD LIE IN. A record is more than one tree, and a corner that
    // showed the first of them would call a project fine while `mnema verify` calls it
    // otherwise. The trees are made to disagree the way the verdict's own cases make one
    // disagree — the checkpoints of ONE tree emptied, which is a tree between its first
    // event and its first checkpoint and is a legitimate state. Nothing is WRITTEN into
    // the record here; a file the product wrote is emptied.
    const second = join(sandbox, 'disagreeing');
    mkdirSync(second, { recursive: true });
    const was = process.cwd();
    process.chdir(second);
    try {
      await shell('init');
      await shell('task', 'a task in the committed tree');
      // The one verb that writes the OTHER tree. A memory lands in the committed one — a
      // record travels by its KIND (`the-record-travels.test.ts`), and only an explicit
      // scope puts a task in the private tree.
      await shell('task', 'a task that stays on this machine', '--scope', 'private');
      const emptied = privateCheckpoints(second);
      expect(emptied, 'the fixture never wrote a private tree').toBeDefined();
      writeFileSync(emptied as string, '', 'utf-8');

      const levels = levelsPerTree();
      // THE INSTRUMENT FIRST: the trees really do disagree, or the assertion below holds
      // over a record where every answer is the same answer.
      expect(new Set(levels).size, `the trees agree: ${levels.join()}`).toBeGreaterThan(1);

      const worst = foldedLevel();
      const badge = rowHolding(await openedAt(120), MARK);
      expect(badge).toContain(worst);
      // And it is the worst rather than any of them: the level of the intact tree is on
      // the page — the panel says one line per tree — and it is NOT the one in the corner.
      const other = levels.find((level) => level !== worst) as string;
      expect(other, 'both trees are at the same level after all').toBeDefined();
      expect(badge, `the corner named the other tree: ${badge}`).not.toContain(other);
    } finally {
      process.chdir(was);
    }
  }, 240_000);

  it('says nothing at all where there is no record to name a level of', async () => {
    // The same posture the line that says where the session is standing takes about a fact
    // it does not have, and the same one the panel's record section takes.
    const nowhere = mkdtempSync(join(sandbox, 'outside-'));
    const was = process.cwd();
    process.chdir(nowhere);
    try {
      const page = await openedAt(120);
      expect(page, 'the session never opened').toContain(PROMPT);
      expect(page, 'a badge over no record').not.toContain(MARK);
    } finally {
      process.chdir(was);
    }
  }, 120_000);

  it('carries the hue its level reads as, in each of the three outcomes', () => {
    // ⚠️ THIS CASE USED TO ASSERT THE OPPOSITE — that the badge carries no style at all —
    // and it is renamed rather than edited, because a conserto that inverts an observable
    // leaves every device built on the old name asserting the new behaviour by accident.
    // What fell is in `repl/session.ts`, `badgeLine`: an unpainted corner is quiet while
    // the record is broken, and this is a tool for making tampering evident.
    //
    // ASSERTED AGAINST THE FUNCTION AND NEVER AGAINST A COLOUR. The hue of a severity is
    // taken from the RENDERER — what a severity adds to a line that carries none — so no
    // escape and no colour word is written down here, and the case survives a renderer
    // that changes which red it writes.
    //
    // THE CHOICE OF LEVELS IS COMPLETE rather than a sample: the three named below are
    // asserted to produce every outcome the surface HAS, against the closed tuple of them.
    // A fourth severity, or a level moving between two of them, makes that line red.
    expect(new Set(OUTCOMES.map(levelSeverity))).toEqual(new Set(SEVERITIES));
    // And each outcome really has a hue of its OWN, or the loop below discriminates
    // nothing: an outcome painted like another one comes out of {@link hueOf} empty.
    for (const level of OUTCOMES) {
      expect(
        hueOf(levelSeverity(level)).length,
        `${level} is painted like another`,
      ).toBeGreaterThan(0);
    }

    for (const level of OUTCOMES) {
      const painted = renderStyled(badgeLine(level));
      // THE PROMISE: the badge is wrapped in the hue its own level reads as.
      for (const hue of hueOf(levelSeverity(level))) expect(painted, level).toContain(hue);
      // And in no other outcome's, so a badge that painted everything red would be red.
      for (const other of OUTCOMES) {
        if (levelSeverity(other) === levelSeverity(level)) continue;
        for (const hue of hueOf(levelSeverity(other))) expect(painted, level).not.toContain(hue);
      }
      // AND THE WORDS ARE UNTOUCHED, which is the half of the old premise that survived as
      // a fact: strip the escapes and it is the plain badge, byte for byte. The hue never
      // carries anything the words do not already say.
      expect(withoutSgr(painted), level).toBe(renderPlain(badgeLine(level)));
    }
  });

  it('carries it on the page too, at the level this record is at', async () => {
    // THE ELO. The case above is about a line; this is about the row a caller looks at,
    // painted by the renderer a terminal gets, over the level THIS record folded to.
    const terminal = fakeTerminal({ columns: 120, rows: 40 });
    const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    const closed = openSession({
      io,
      render: renderStyled,
      self: REPL_VERB,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: true,
      leaving: hooksNothing,
    });
    await until(() => terminal.bytes().includes(PROMPT), 'opened');
    terminal.type(CLEARS_THE_LINE);
    terminal.type(`${LEAVE}\r`);
    await closed;
    // Read off the page with everything a LAYOUT writes taken out, and only that: the
    // sequence that hides the caret opens the frame the badge is redrawn in, and it is not
    // style. What is left on the row is what a renderer put there.
    const row = rowHolding(withoutLayout(terminal.bytes()), MARK);
    for (const hue of hueOf(levelSeverity(foldedLevel()))) expect(row).toContain(hue);
    // Not vacuous: the level this fixture is at really has a hue to carry, and the row
    // still says the same words a pipe would have received.
    expect(hueOf(levelSeverity(foldedLevel())).length).toBeGreaterThan(0);
    expect(withoutSgr(row).trim()).toBe(renderPlain(badgeLine(foldedLevel())));
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The hint
// ---------------------------------------------------------------------------

describe('the hint is short enough to be one row, and promises nothing that is not there', () => {
  it('fits an ordinary terminal without folding', () => {
    // ASSERTED AGAINST THE WIDTH and not against a number about the sentence. The hint used
    // to be five clauses and about a hundred and ten characters, which the terminal folded
    // into two rows below ninety-seven columns — the row that exists to be glanced at was
    // the tallest thing in the region.
    expect(widthOf(tips())).toBeLessThanOrEqual(AN_ORDINARY_TERMINAL);
    // Not vacuous: it says something, and the measurement is of a real sentence.
    expect(widthOf(tips())).toBeGreaterThan(20);
  });

  it('says three things at most, which is what a person reads without stopping', () => {
    const clauses = renderPlain(tips()).split(MIDDLE_DOT);
    expect(clauses.length).toBeLessThanOrEqual(AT_MOST);
    expect(clauses.length).toBeGreaterThan(1);
  });

  it('names no word the session does not answer to', () => {
    // A row under the prompt is the most believed sentence on the surface. A hint naming an
    // affordance that does not answer yet would be the console lying to the one reader who
    // cannot check — which is what a hint promising a list of commands would be, before
    // there is one.
    const said = renderPlain(tips());
    const quoted = said.match(/`[^`]+`/g) ?? [];
    expect(quoted.length, 'the hint quotes nothing at all').toBeGreaterThan(0);
    for (const word of quoted) expect(SESSION_WORDS).toContain(word.slice(1, -1));
    // And no bare prefix, which is the shape a promise of the list would take.
    expect(said.includes(`${PREFIX} `), `the hint promises ${PREFIX}`).toBe(false);
  });

  it('still names the word that lists everything it dropped', () => {
    // WHAT MAKES THREE ENOUGH. Two clauses went — the word that clears the page and the key
    // that clears the line — and both are in what the remaining word answers, so nothing
    // was lost, it was moved one keystroke away.
    expect(renderPlain(tips())).toContain(ABOUT);
  });
});

// ---------------------------------------------------------------------------
// A real pty: the rules, the badge and the caret on a screen
// ---------------------------------------------------------------------------

/** One thing to do in the session, and what says it is done. */
interface Step {
  readonly types?: string;
  readonly resize?: { readonly columns: number; readonly rows: number };
  readonly until: (bytes: string) => boolean;
  readonly what: string;
}

/** What a run in a pty produced. */
interface Ran {
  readonly bytes: string;
  readonly at: readonly number[];
}

/** Waits until `ready` answers true, or gives up — a poll, never a fixed sleep. */
async function waitFor(ready: () => boolean, what: string, tries = 1200): Promise<void> {
  for (let tried = 0; tried < tries; tried++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the session never ${what}`);
}

/** Runs `mnema repl` on a pseudo-terminal of a given size, resizing it between steps. */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
}): Promise<Ran> {
  const here = mkdtempSync(join(sandbox, 'pty-'));
  const runner = join(here, 'run.sh');
  const named = 'TTY=';
  writeFileSync(
    runner,
    [
      `cd ${project}`,
      `stty rows ${options.rows} cols ${options.columns}`,
      `echo "${named}$(tty)"`,
      `node ${CLI} ${REPL_VERB}`,
      '',
    ].join('\n'),
  );

  let bytes = '';
  let over = false;
  const child = spawn('script', ['-qec', `sh ${runner}`, '/dev/null'], {
    cwd: project,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer): void => {
    bytes += chunk.toString('utf-8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const ended = new Promise<void>((resolve) => {
    child.on('close', () => {
      over = true;
      resolve();
    });
  });

  const at: number[] = [];
  try {
    await waitFor(() => bytes.includes(named) || over, 'said which terminal it had');
    const device = /TTY=(\S+)/.exec(bytes)?.[1];
    expect(device, 'the runner never named the terminal').toBeDefined();
    for (const step of options.steps) {
      if (step.resize !== undefined) {
        execFileSync('stty', [
          '-F',
          device as string,
          'rows',
          String(step.resize.rows),
          'cols',
          String(step.resize.columns),
        ]);
      }
      if (step.types !== undefined) child.stdin.write(step.types);
      await waitFor(() => step.until(bytes) || over, step.what);
      for (let still = 0, was = -1; still < 8; still++) {
        if (bytes.length === was) break;
        was = bytes.length;
        await new Promise((resolve) => setTimeout(resolve, 40));
        still = 0;
        if (bytes.length === was) break;
      }
      at.push(bytes.length);
    }
    await Promise.race([
      ended,
      new Promise((_, reject) => setTimeout(() => reject(new Error('never came back')), 30_000)),
    ]);
  } finally {
    child.stdin.end();
    child.kill('SIGKILL');
  }
  return { bytes, at };
}

/** The step every session begins with. */
const opens: Step = { until: (bytes) => bytes.includes(PROMPT), what: 'opened its console' };

/** The step every session ends with. */
const leaves: Step = {
  types: `${LEAVE}\r`,
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(LEAVE),
  what: 'left',
};

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/**
 * Whether a row of a screen is a rule and NOTHING else.
 *
 * That is the discriminant between the input's rules and the panel's: the box has its
 * frame at both ends of every row of it, so a row made of nothing but the run belongs to
 * the area.
 */
function isRule(row: string): boolean {
  const drawn = row.replace(/ +$/, '');
  return drawn.length > 0 && [...drawn].every((glyph) => glyph === RUN);
}

/** The rows of a screen that are a rule and nothing else. */
function rulesOn(screen: { readonly rows: readonly string[] }): string[] {
  return screen.rows.filter(isRule);
}

/**
 * THE TWO RULES OF THE INPUT: the row above the one being typed, and the row below it.
 *
 * Found by their POSITION rather than by counting every run on the screen, and the reason
 * is a page that was drawn twice: a session opened at a hundred and twenty columns and
 * narrowed to seventy leaves the OLD page above, where the terminal folds each of its
 * rules into a full row of seventy and a remainder. Those are rules of a page nobody is
 * typing on. The area's own are the two the prompt sits between.
 */
function rulesAroundTheInput(screen: { readonly rows: readonly string[] }): string[] {
  const typed = screen.rows.map((row) => row.includes(PROMPT)).lastIndexOf(true);
  expect(typed, 'nothing on the screen is being typed on').toBeGreaterThan(0);
  return [screen.rows[typed - 1] as string, screen.rows[typed + 1] as string];
}

describe('the two rules are as wide as the terminal, and follow it when it changes', () => {
  for (const columns of [60, 100, 140]) {
    it(`runs from the first column to column ${columns} of ${columns}`, async () => {
      const rows = 40;
      const ran = await inPty({ columns, rows, steps: [opens, leaves] });
      const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
      expect(screen.text, `${columns}: the session never opened`).toContain(OPENED);
      // The row being typed sits BETWEEN them, which is what makes them the input's, and
      // each of them ends on the last column of the terminal.
      for (const rule of rulesAroundTheInput(screen)) {
        expect(isRule(rule), `${columns}: the input is not between two rules`).toBe(true);
        expect([...rule.replace(/ +$/, '')].length, `${columns}: a rule stops short`).toBe(columns);
      }
      // And there are two of them on the page and no more, on a page drawn once.
      expect(rulesOn(screen), `${columns}: not two rules`).toHaveLength(2);
    }, 120_000);
  }

  it('measures the new width after the caller resizes their window', async () => {
    const rows = 40;
    const ran = await inPty({
      columns: 120,
      rows,
      steps: [
        opens,
        {
          resize: { columns: 70, rows },
          until: (bytes) => times(bytes, RUN.repeat(70)) > 0,
          what: 'drew the rules again after shrinking',
        },
        leaves,
      ],
    });
    const screen = screenOf(ran.bytes.slice(0, ran.at[1] as number), 70, rows);
    for (const rule of rulesAroundTheInput(screen)) {
      expect(isRule(rule), 'the input is not between two rules after the resize').toBe(true);
      expect([...rule.replace(/ +$/, '')].length, 'a rule kept the old width').toBe(70);
    }
  }, 180_000);
});

describe('the badge ends on the last column, at whatever width the terminal is', () => {
  it('is aligned to the right rather than put at a column somebody chose', async () => {
    const rows = 40;
    const widths = [80, 140];
    const starts: number[] = [];
    for (const columns of widths) {
      const ran = await inPty({ columns, rows, steps: [opens, leaves] });
      const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
      const badge = screen.rows.find((row) => row.includes(MARK));
      expect(badge, `${columns}: no badge on the screen`).toBeDefined();
      const drawn = (badge as string).replace(/ +$/, '');
      // THE PROMISE: what is on the row ends on the last column of the terminal.
      expect([...drawn].length, `${columns}: the badge stops short: ${drawn}`).toBe(columns);
      starts.push((badge as string).indexOf(MARK));
    }
    // AND IT IS RIGHT-ALIGNED rather than at a fixed offset: the row starts sixty columns
    // further along on a terminal sixty columns wider. Without this the case above would
    // pass on a badge padded out to a constant that happened to match.
    expect((starts[1] as number) - (starts[0] as number)).toBe(
      (widths[1] as number) - (widths[0] as number),
    );
  }, 180_000);
});

describe('the caret is left on the row being typed, under everything drawn over it', () => {
  it('lands on the prompt rather than on the first row of the region', async () => {
    // THE ARITHMETIC, ASKED OF A SCREEN. The caret used to be put at the top of the redrawn
    // region because the row being typed WAS the top of it. There are two rows over it now
    // in the full form, and how many is answered before the layout is reached — so an
    // off-by-one there leaves a caller's caret on a rule.
    const columns = 100;
    const rows = 40;
    const typed = 'ver';
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: typed,
          until: (bytes) => bytes.includes(`${PROMPT} ${typed}`),
          what: 'echoed what was typed',
        },
        { types: CLEARS_THE_LINE, until: (bytes) => bytes.length > 0, what: 'abandoned the row' },
        leaves,
      ],
    });
    const screen = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const row = screen.rows.findIndex((line) => line.includes(`${PROMPT} ${typed}`));
    expect(row, 'the caller’s row is not on the screen').toBeGreaterThanOrEqual(0);
    expect(screen.cursor.row, 'the caret is not on the row being typed').toBe(row);
    // ON THE ROW, AND INSIDE WHAT WAS TYPED — and the second half is a RANGE rather than an
    // offset on purpose. The library applies a cursor position on the frame AFTER the one
    // that moved it, so the column trails the last keystroke by one character. Measured on
    // this delivery and on the one before it, three characters typed one at a time, and
    // both answered with the same column — so it is the library's, it is older than this
    // area, and it is not what this case is about.
    expect(screen.cursor.column).toBeGreaterThanOrEqual([...`${PROMPT} `].length);
    expect(screen.cursor.column).toBeLessThanOrEqual([...`${PROMPT} ${typed}`].length);
    // Not vacuous: there really is something drawn above that row inside the region, so a
    // caret put at the top of it would have landed somewhere else.
    expect(rulesOn(screen)).toHaveLength(2);
    expect(screen.rows.some((line) => line.includes(MARK))).toBe(true);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// The height at which the area degrades, and the one the library gives up at
// ---------------------------------------------------------------------------

/**
 * THE HEIGHTS, MEASURED ON THIS DELIVERY AND NOT CARRIED OVER.
 *
 * The region went from three rows to five, so the height at which the layout library stops
 * redrawing PART of the screen had to be measured again — it is the whole reason the area
 * has forms at all. It went DOWN rather than up, at both widths probed: at a hundred
 * columns it was two rows and is now one, and at sixty — where the hint folds in two — it
 * was three and is now two.
 *
 * Sixty columns is the width these cases use because it is the width the boundary was
 * recorded at before (`a-page-that-opens-clean.test.ts`), so the two numbers are
 * comparable.
 */
const TOO_SHORT_TO_REDRAW_IN_PART = 2;

/** A height with no room for a rule, and enough for the row being typed and its hint. */
const SHORT_ENOUGH_FOR_THE_BARE_FORM = 4;

describe('a terminal without the height gets less area, down to the bare prompt', () => {
  it('draws the rules and the badge when there is room, and neither when there is not', async () => {
    // A CASE PER FORM, on a screen. Sixty columns throughout, so the only thing that
    // differs between the runs is the height.
    const columns = 60;
    const drawn = async (rows: number) => {
      const ran = await inPty({ columns, rows, steps: [opens, leaves] });
      return screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    };
    const full = await drawn(40);
    expect(rulesOn(full), 'the full form has no rules').toHaveLength(2);
    expect(
      full.rows.some((row) => row.includes(MARK)),
      'the full form has no badge',
    ).toBe(true);

    const bare = await drawn(SHORT_ENOUGH_FOR_THE_BARE_FORM);
    expect(bare.text, 'the short terminal never opened a prompt').toContain(PROMPT);
    expect(rulesOn(bare), 'a rule survived into the bare form').toHaveLength(0);
    expect(
      bare.rows.some((row) => row.includes(MARK)),
      'a badge survived it',
    ).toBe(false);
  }, 240_000);

  it('⚠️ and the height the library erases the caller’s history at moved DOWN', async () => {
    // A MEASUREMENT AND A BOUNDARY, and it is the LIBRARY'S rather than this product's.
    // Below a certain height it stops redrawing part of the page and redraws all of it,
    // with a sequence that carries the one erase this product refuses to write. The
    // delivery that gave the input an area made the region taller, which would have raised
    // this boundary; the forms are what stopped it, and the number came out BETTER than it
    // was — sixty columns and three rows used to reach it and no longer does. Pinned in
    // both directions, so the boundary cannot move again in silence.
    const short = await inPty({
      columns: 60,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [opens, leaves],
    });
    expect(short.bytes, 'the library no longer erases the history that low').toContain(
      ERASES_THE_HISTORY,
    );
    const taller = await inPty({
      columns: 60,
      rows: TOO_SHORT_TO_REDRAW_IN_PART + 1,
      steps: [opens, leaves],
    });
    expect(taller.bytes, 'the boundary did not move with the area').not.toContain(
      ERASES_THE_HISTORY,
    );
    // Both sessions really opened, so the difference above is the height and nothing else.
    for (const ran of [short, taller]) expect(ran.bytes).toContain(PROMPT);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// A1: the verb the badge names, spelled once
// ---------------------------------------------------------------------------

/** Every `.ts` source of the product, recursively, tests excluded. */
function sourcesOf(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesOf(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

/** A source with its comments taken out, so prose cannot be read as code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Every string a source writes, quotes included. */
function literalsOf(code: string): string[] {
  return code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
}

describe('the verb the badge tells a caller to run is spelled in one module', () => {
  it('is named once in the product, and it is where it is registered', () => {
    // A1, BY THE DISCRIMINANT: a literal that IS the verb's name. The badge sends a caller
    // to a verb, so the word it prints has to be the word commander routes — typed twice,
    // the day this verb is renamed is the day the corner of the console starts naming
    // something that does not exist.
    const naming = sourcesOf(SRC).filter((file) =>
      literalsOf(withoutComments(readFileSync(file, 'utf-8'))).some(
        (literal) => literal.slice(1, -1) === VERIFY_VERB,
      ),
    );
    expect(naming.map((file) => file.slice(SRC.length + 1))).toEqual([join('wiring', 'verify.ts')]);
    // The scan read something, and it would accuse a second module.
    expect(sourcesOf(SRC).length).toBeGreaterThan(50);
    expect(literalsOf(`program.command('${VERIFY_VERB}')`)).toHaveLength(1);
  });

  it('reaches the row a caller reads, which is the other half of the elo', async () => {
    // THE ELO, asked of the bytes rather than of the module that holds the constant: the
    // word on the badge is the one the registration was made with.
    expect(rowHolding(await openedAt(120), MARK)).toContain(VERIFY_VERB);
  }, 120_000);
});
