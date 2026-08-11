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
import { badgeLine, openSession, theSessionsOwnWords, tips } from '../src/repl/session.js';
import { ABOUT, LEAVE, PREFIX, SESSION_WORDS } from '../src/session-words.js';
import { here } from '../src/wiring/context.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { DEFAULT_REQUIREMENT, levelSeverity, VERIFY_VERB } from '../src/wiring/verify.js';
import { ESC, fakeTerminal, hooksNothing, until, withoutLayout } from './support/console.js';
import { inPty as drive, type Fixture, opensAConsole, type Ran, type Step } from './support/pty.js';
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

/**
 * A request with everything to show, so a case only says what it is changing.
 *
 * THE TWO WIDTHS ARE THE PRODUCT'S OWN, measured off the rows this surface really
 * composes rather than written down here: the area rules on whether each of them is ONE
 * row of the terminal, so a number invented for a fixture would be ruling on a badge
 * nobody draws. The window is wide enough for both, which is what leaves height the only
 * thing these cases vary.
 */
const showingEverything = {
  columns: 200,
  badge: widthOf(badgeLine('fully-signed')),
  hint: widthOf(tips()),
  palette: 0,
  // A PAGE WITH NOTHING ON IT, which is what leaves the HEIGHT the only thing these cases
  // vary — and it is also where every number below comes from: the list of words is budgeted
  // against what the page has left over (`repl/area.ts`, `AreaRequest.flow`), so a request
  // with a flow in it would be asking about a shorter page rather than about a shorter
  // terminal. The cases about the flow are `the-list-is-a-window.test.ts`.
  flow: 0,
};

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
      const form = areaFor({ ...showingEverything, badge: 0, rows }).form;
      expect(form, `${rows}`).not.toBe('full');
    }
    expect(areaFor({ ...showingEverything, badge: 0, rows: 40 }).form).toBe('ruled');
    // Not vacuous: the same heights DO give the full form when there is a badge.
    expect(areaFor({ ...showingEverything, rows: 6 }).form).toBe('full');
  });

  it('counts the rows the palette wants and the blank one over them', () => {
    // The words a caller could type next are rows like any other. A form chosen as though
    // they were not there would be arithmetic about a region that is not the one on the
    // screen, which is the exact shape of instrument this bench has been wrong with.
    //
    // ⚠️ AND THERE IS ONE MORE ROW THAN THERE ARE WORDS, which is what this delivery added:
    // the list stands off what is under it by a blank row, so an OPEN palette costs its rows
    // plus one. It is the same rule as everything else here — a row the layout draws is a row
    // this arithmetic counts — and the shape of defect it prevents is the caret one row away
    // from the line it is meant to be on.
    const tall = { ...showingEverything, rows: 6 };
    expect(areaFor(tall).form).toBe('full');
    expect(areaFor({ ...tall, palette: 1 }).form).toBe('bare');
    // And they are counted rather than merely changing the answer: the same form is one
    // taller per row of palette, and one taller again for the blank row over the list.
    const wide = { ...showingEverything, rows: 40 };
    expect(areaFor({ ...wide, palette: 1 }).height - areaFor(wide).height).toBe(2);
    expect(areaFor({ ...wide, palette: 7 }).height - areaFor(wide).height).toBe(8);
    // THE BLANK ROW IS SPENT ONCE AND ONLY WHEN THERE IS A LIST: seven rows of words cost six
    // more than one row of words, not seven, and a palette that is SHUT costs nothing at all.
    expect(areaFor({ ...wide, palette: 7 }).height - areaFor({ ...wide, palette: 1 }).height).toBe(
      6,
    );
    expect(areaFor({ ...wide, palette: 0 }).height).toBe(areaFor(wide).height);
  });

  it('says how many rows sit above the row being typed, and it is one per row drawn', () => {
    // WHAT THE CARET IS PUT AT. The differences between the forms are what says so: the
    // badge and one rule for the full form, one rule for the ruled one, nothing for the
    // bare one — and the palette's rows are above the typed one in all three.
    const rows = 40;
    const full = areaFor({ ...showingEverything, rows });
    const ruled = areaFor({ ...showingEverything, badge: 0, rows });
    const bare = areaFor({ ...showingEverything, rows: 1 });
    expect(bare.above).toBe(0);
    expect(ruled.above - bare.above).toBe(1);
    expect(full.above - ruled.above).toBe(1);
    // ⚠️ ONE ROW OF PALETTE PUTS TWO ROWS OVER THE PROMPT, and that is what this delivery
    // changed: the list stands off what is under it by a blank row, and the caret has to be
    // told about a row that is drawn whether or not anything is written on it.
    // ⚠️ AND THE THIRD REQUEST USED TO BE A SHORT TERMINAL, which stopped being able to
    // answer the question: with the blank row counted, one row of palette on a terminal of
    // four or six rows changes the FORM as well — the trade the area makes when it cannot hold
    // both (`a-palette-for-the-words.test.ts`) — and a difference measured across two forms is
    // the rule it gave up plus the rows it gained. The three here are three ARRANGEMENTS at a
    // height that holds all of them, which is what isolates the palette's own rows.
    for (const request of [
      { ...showingEverything, rows },
      { ...showingEverything, badge: 0, rows },
      { ...showingEverything, hint: 0, rows },
    ]) {
      const offered = areaFor({ ...request, palette: 1 });
      expect(offered.above - areaFor(request).above, `${request.rows}`).toBe(2);
    }
    // And the row of a palette there is no room for is not above anything, because it is
    // not drawn: the budget is what keeps the caret and the drawing agreeing about the
    // shape (`a-palette-for-the-words.test.ts` measures where the room runs out).
    expect(areaFor({ ...showingEverything, rows: 1, palette: 1 }).above).toBe(bare.above);
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

  it('quotes only what the session answers to, which is its words and the key that lists them', () => {
    // ⚠️ THIS CASE USED TO BE `names no word the session does not answer to`, AND IT USED
    // TO BAN THE PREFIX. The rule it held was right and it was about a PROMISE: a row under
    // the prompt is the most believed sentence on the surface, so a hint naming an
    // affordance that does not answer would be the console lying to the one reader who
    // cannot check. What falsified the ban is the palette — a slash on an empty row now
    // opens the list of the session's own words — so the case is renamed and inverted
    // rather than edited, because a case that keeps its name while its subject flips
    // leaves every device built on it asserting the new behaviour by accident.
    const said = renderPlain(tips());
    const quoted = (said.match(/`[^`]+`/g) ?? []).map((word) => word.slice(1, -1));
    expect(quoted.length, 'the hint quotes nothing at all').toBeGreaterThan(0);
    for (const word of quoted) expect([...SESSION_WORDS, PREFIX]).toContain(word);
    // And the prefix really is one of them: the promise is made rather than merely allowed.
    expect(quoted, 'the hint no longer names the key that lists the words').toContain(PREFIX);
  });

  it('does not name the word it moved into the list, because the list is where it is', () => {
    // WHAT MAKES THREE ENOUGH, AND WHAT CHANGED. Three clauses went over two deliveries —
    // the word that clears the page, the key that clears the line, and now the word that
    // lists the verbs — and every one of them is one keystroke away behind the clause that
    // stayed. ⚠️ IT USED TO ASSERT THE OPPOSITE: that the hint still named `/help`. What
    // falsified it is that the slash lists `/help` itself, so naming both would be the hint
    // spending a clause on what the clause beside it opens.
    expect(renderPlain(tips())).not.toContain(ABOUT);
    // THE ELO, so the absence above is a move and not a loss: the word really is in the
    // vocabulary the prefix opens, with something to say about it.
    const words = theSessionsOwnWords();
    const listed = words.find((entry) => entry.word === ABOUT);
    expect(listed, `${ABOUT} is not in what the prefix lists`).toBeDefined();
    expect((listed as { description: string }).description.length).toBeGreaterThan(3);
    for (const entry of words) expect(entry.word.startsWith(PREFIX), entry.word).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A real pty: the rules, the badge and the caret on a screen
// ---------------------------------------------------------------------------

/** The fixture every case below drives the built binary over. */
const fixture = (): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

/** Runs `mnema repl` on a pseudo-terminal of a given size, resizing it between steps. */
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
    // ON THE ROW, AND AT THE END OF WHAT WAS TYPED.
    //
    // ⚠️ THIS WAS A RANGE, and the doc here said why: "the library applies a cursor position
    // on the frame AFTER the one that moved it, so the column trails the last keystroke by
    // one character… it is the library's, it is older than this area". The measurement was
    // right and the attribution was wrong. It was OURS: the position was handed over in a
    // passive effect, which runs after the frame it belongs to has been written, so every
    // frame carried the position of the one before it. Handed over while the frame is being
    // composed (`repl/region.ts`), the caret is where the caller's next character goes —
    // and the range becomes an exact column, which is what the opening frame needed too
    // (`tests/the-opening-fits-the-screen.test.ts`).
    expect(screen.cursor.column).toBe([...`${PROMPT} ${typed}`].length);
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
 * THE HEIGHT THE LIBRARY GIVES UP AT, MEASURED AGAIN ON EVERY DELIVERY THAT TOUCHES THE
 * REGION — and it turned out to be a function of ONE thing.
 *
 * ⚠️ IT USED TO SAY TWO ROWS AT SIXTY COLUMNS, pinned in both directions, and it was right
 * when it was written. The WIDTH rule (`repl/area.ts`) is what moved it, and the whole
 * story is the hint's own width: a hint the terminal would FOLD is not drawn, so a window
 * that loses the hint has a one-row region and the library never reaches the boundary
 * there, while a window that keeps it has a two-row region and reaches it at one row.
 *
 * MEASURED THREE TIMES ACROSS THIS FRONT, at sixty columns, with the hint at three
 * lengths: at seventy columns it folded in two and the boundary was TWO rows; at
 * seventy-four it was dropped and the boundary was reached at NO height at all; at
 * fifty-three it is one row again and the boundary is ONE. So the number at sixty columns
 * went 2, then none, then 1 — better than where the front found it, at every width.
 *
 * The boundary is pinned three ways below: at a width that keeps the hint, at one that
 * loses it, and — the sharp one — at the hint's own width and one column under it.
 */
const TOO_SHORT_TO_REDRAW_IN_PART = 1;

/** A window with room for the hint on one row — which is what makes the region two. */
const WIDE_ENOUGH_FOR_THE_HINT = 100;

/**
 * And one without, where the hint is not drawn and the region is one row.
 *
 * Forty, and the number is stated rather than derived from the hint: a width computed as
 * "one less than the hint" would make the assertion that the hint is wider than it true by
 * construction. The sharp case below is the one that derives, and it derives the INPUT.
 */
const TOO_NARROW_FOR_THE_HINT = 40;

/** The width the two deliveries before this one recorded the boundary at. */
const WHERE_IT_WAS_RECORDED = 60;

/** A height with no room for a rule, and enough for the row being typed and its hint. */
const SHORT_ENOUGH_FOR_THE_BARE_FORM = 4;

describe('a terminal without the height gets less area, down to the bare prompt', () => {
  it('draws the rules and the badge when there is room, and neither when there is not', async () => {
    // A CASE PER FORM, on a screen. One width throughout, so the only thing that differs
    // between the runs is the height — and it is a width that has room for the HINT,
    // because the hint is a row of the arrangement and a window that drops it is a window
    // measuring a different ladder. ⚠️ It used to be sixty columns, which stopped being
    // such a width when the area learned to leave out a row the terminal would fold.
    const columns = WIDE_ENOUGH_FOR_THE_HINT;
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

  it('⚠️ and the height the library erases the caller’s history at is one row', async () => {
    // A MEASUREMENT AND A BOUNDARY, and it is the LIBRARY'S rather than this product's.
    // Below a certain height it stops redrawing part of the page and redraws all of it,
    // with a sequence that carries the one erase this product refuses to write. Pinned in
    // both directions, so the boundary cannot move in silence — which is what caught it
    // moving when the width rule landed (see {@link TOO_SHORT_TO_REDRAW_IN_PART}).
    const short = await inPty({
      columns: WIDE_ENOUGH_FOR_THE_HINT,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [opens, leaves],
    });
    expect(short.bytes, 'the library no longer erases the history that low').toContain(
      ERASES_THE_HISTORY,
    );
    const taller = await inPty({
      columns: WIDE_ENOUGH_FOR_THE_HINT,
      rows: TOO_SHORT_TO_REDRAW_IN_PART + 1,
      steps: [opens, leaves],
    });
    expect(taller.bytes, 'the boundary did not move with the area').not.toContain(
      ERASES_THE_HISTORY,
    );
    // Both sessions really opened, so the difference above is the height and nothing else.
    for (const ran of [short, taller]) expect(ran.bytes).toContain(PROMPT);
  }, 240_000);

  it('⚠️ and a window too narrow for the hint does not reach it at any height', async () => {
    // The hint is not drawn below its own width, so the bare form is ONE row there and the
    // region is never as tall as the viewport.
    const shortest = await inPty({
      columns: TOO_NARROW_FOR_THE_HINT,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [opens, leaves],
    });
    expect(shortest.bytes, 'the boundary is still reached without the hint').not.toContain(
      ERASES_THE_HISTORY,
    );
    // Not vacuous: the session really opened on that terminal, and the hint really is too
    // wide for it — so the absence above is the hint's missing row and not a dead probe.
    expect(shortest.bytes).toContain(PROMPT);
    expect(widthOf(tips())).toBeGreaterThan(TOO_NARROW_FOR_THE_HINT);
  }, 240_000);

  it('⚠️ and the boundary moves with the HINT, to the column', async () => {
    // THE SHARP FORM, AND THE ONE THAT SAYS WHY THE NUMBER KEEPS MOVING. Everything above
    // states the boundary at a width somebody chose; this states what the boundary is a
    // FUNCTION of. The width is derived from the hint — which is deriving the INPUT, not
    // the answer: what is asserted is what a real pty did at two adjacent columns.
    const wide = widthOf(tips());
    const keepsIt = await inPty({
      columns: wide,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [opens, leaves],
    });
    const losesIt = await inPty({
      columns: wide - 1,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [opens, leaves],
    });
    expect(keepsIt.bytes, `${wide} columns: the hint's row stopped counting`).toContain(
      ERASES_THE_HISTORY,
    );
    expect(losesIt.bytes, `${wide - 1} columns: a hint that would fold was drawn`).not.toContain(
      ERASES_THE_HISTORY,
    );

    // AND AT THE WIDTH THE FRONT KEEPS ITS RECORD AT, so the number is comparable with the
    // two deliveries before this one: it was TWO rows there when the hint folded in two, it
    // was reached at NO height when the hint was too wide to draw, and it is ONE now.
    const recorded = await inPty({
      columns: WHERE_IT_WAS_RECORDED,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [opens, leaves],
    });
    const oneTaller = await inPty({
      columns: WHERE_IT_WAS_RECORDED,
      rows: TOO_SHORT_TO_REDRAW_IN_PART + 1,
      steps: [opens, leaves],
    });
    expect(recorded.bytes, `${WHERE_IT_WAS_RECORDED} columns, one row`).toContain(
      ERASES_THE_HISTORY,
    );
    expect(oneTaller.bytes, `${WHERE_IT_WAS_RECORDED} columns, two rows`).not.toContain(
      ERASES_THE_HISTORY,
    );
    // Every one of them really opened, so each answer above is about a height and a width
    // rather than about a session that died.
    for (const ran of [keepsIt, losesIt, recorded, oneTaller]) expect(ran.bytes).toContain(PROMPT);
    // And the width that keeps it really is narrower than the one the case above uses, so
    // the two are measuring different points rather than the same one twice.
    expect(wide).toBeLessThan(WIDE_ENOUGH_FOR_THE_HINT);
  }, 300_000);
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
