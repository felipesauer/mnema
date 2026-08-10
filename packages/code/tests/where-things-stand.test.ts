/**
 * WHERE THINGS STAND — the opening read, and the proof that there is only one of it.
 *
 * The derivation was never in question: `@mnema/copilot`'s `bootstrap` closes the table
 * of what a record can be waiting on (`ARCHITECTURE.md` §1.3), and it is proved against
 * the transition tables in its own package. What this file is about is the DOOR. Until
 * `mnema status` existed, that derivation had one caller — the MCP server — so an agent
 * could ask where things stood and the person whose record it is could not.
 *
 * A second door is exactly the shape that becomes a second ANSWER, so the cases here are
 * shaped around what stops it:
 *
 *   - THE TWO SURFACES SAY THE SAME THING, compared as the bytes each one serves. The
 *     CLI's `--json` and the payload of the MCP's `bootstrap` tool are parsed and
 *     compared field for field over ONE record, with the clock-derived halves dropped
 *     BY NAME and the drop proved not to have emptied the comparison.
 *   - NOBODY ELSE DERIVES IT. Two guards, because there are two ways to grow a third
 *     answer: calling the derivation from a door nobody declared, and composing the
 *     halves by hand instead of calling it. Both are read off the source, and the
 *     mechanism is exercised on input of its own so a pass is never "the scan found
 *     nothing".
 *   - THE ANSWER REACHES EVERY CELL. Five of the six cells of §1.3 are served, and a
 *     record that cannot PRODUCE one of them makes a measurement of its absence
 *     meaningless — so the fixture rules on some things and deliberately leaves others
 *     waiting, and each cell is asserted present before anything is asserted about how
 *     it reads. The task machine's waiting side is TWO of those things now: a task
 *     waiting on a move is the work list and a task waiting on a verdict is the other
 *     one, so the fixture produces both and each is followed to the line it prints.
 *   - AND THE TWO HONEST EMPTIES. Outside a project there is nothing to read and it
 *     refuses; inside an empty one every half says it is empty, in words, rather than
 *     printing a heading with nothing under it.
 *
 * WHAT THIS FILE DOES NOT DO is assert the derivation. Which decision governs, what
 * counts as awaiting a judgement, how the lists are ordered and where they are cut are
 * `copilot`'s (`bootstrap.test.ts`), and a copy of those assertions here would be a
 * second reading of the same rule — the thing the guards below exist to prevent.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import { runBootstrap } from '../src/mcp/tools.js';
import { verbsOffered } from '../src/repl/gate.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** Captures the CLI's output and whether it signalled failure. */
function capture(): { io: CliIo; out: string[]; err: string[]; failed: () => boolean } {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  return {
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    },
    out,
    err,
    failed: () => failed,
  };
}

/** Runs `mnema <argv>` through the real entry and answers with what stdout received. */
async function mnema(...argv: string[]): Promise<string[]> {
  const c = capture();
  await run(argv, c.io);
  if (c.failed()) throw new Error(`fixture: \`${argv.join(' ')}\` refused: ${c.err.join(' / ')}`);
  return c.out;
}

/** The id inside the parentheses of a birth's headline — `Created task t-1a2b (<id>)`. */
function bornId(lines: readonly string[], head: string): string {
  const line = lines.find((one) => one.startsWith(head));
  const id = line?.match(/\(([0-9a-f-]{36})\)/)?.[1];
  if (id === undefined) throw new Error(`fixture: no id after "${head}" in ${lines.join(' / ')}`);
  return id;
}

/**
 * A record that can PRODUCE every cell the opening read serves — which is the condition
 * for measuring any of them.
 *
 * The five cells are live work, a decision in force, an adopted pattern, a decision
 * awaiting a ruling and a pattern awaiting one; the sixth (a task that already holds) is
 * deliberately unserved, because such a task is terminal and there is nothing to do
 * about it. A fixture that ruled on everything it proposed would leave the waiting side
 * empty, and a case over it would be asserting that the read says nothing — which is
 * true of the FIXTURE and says nothing about the read.
 *
 * Every value here is written THROUGH the product: the anchor is the one `init` derived,
 * the ids are the ones the births printed, and every state is reached by a move the gate
 * allowed. Nothing is typed in.
 */
async function aRecordThatReachesEveryCell(): Promise<{
  anchor: string;
  liveTask: string;
  waitingTask: string;
  overTask: string;
  inForce: string;
  adopted: string;
  waitingDecision: string;
  waitingSkill: string;
  run: string;
}> {
  const initiated = await mnema('init');
  const identity = initiated.find((line) => line.trim().startsWith('identity:'));
  if (identity === undefined) throw new Error('fixture: init printed no identity');
  const anchor = identity.trim().slice('identity:'.length).trim();

  const started = await mnema('run', 'start', '--which', 'agent-alpha', '--goal', 'set it up');
  const opened = started.find((line) => line.startsWith('Started run '));
  if (opened === undefined) throw new Error('fixture: run start printed no run');
  const runId = opened.slice('Started run '.length).trim();
  process.env.MNEMA_RUN = runId;

  const liveTask = bornId(await mnema('task', 'Write the deploy runbook'), 'Created task ');
  const waitingTask = bornId(await mnema('task', 'Rewrite the rollback step'), 'Created task ');
  const overTask = bornId(await mnema('task', 'Rename the staging bucket'), 'Created task ');
  const inForce = bornId(
    await mnema('decision', 'Keep the runbook in the record', 'a wiki page goes stale'),
    'Recorded decision ',
  );
  const waitingDecision = bornId(
    await mnema('decision', 'Move the console into a pane', 'the terminal is the product'),
    'Recorded decision ',
  );
  const adopted = bornId(
    await mnema('skill', 'One slice per PR', '--body', 'One reviewable change with its tests.'),
    'Proposed skill ',
  );
  const waitingSkill = bornId(
    await mnema('skill', 'Measure before you copy', '--body', 'Take the reference number first.'),
    'Proposed skill ',
  );

  // The rulings, and the ones deliberately NOT made: `waitingDecision` stays `proposed`
  // and `waitingSkill` stops at `reviewed`, which is the second of the two states a
  // pattern can wait in.
  await mnema('task', 'move', 'submit', liveTask);
  // The task machine's two sides, through the gate: one waiting on a verdict, and one
  // that ARRIVED — which the opening read serves on neither list, and which is here so
  // that absence is measured over a record that can produce it.
  for (const id of [waitingTask, overTask]) {
    await mnema('task', 'move', 'submit', id);
    await mnema('task', 'move', 'start', id);
  }
  await mnema('task', 'move', 'submit_review', waitingTask);
  await mnema('task', 'move', 'complete', overTask, '--note', 'the bucket is renamed');
  await mnema('decision', 'move', 'accept', inForce, '--note', 'we agreed in review');
  await mnema('skill', 'move', 'review', adopted, '--note', 'it reads well');
  await mnema('skill', 'move', 'adopt', adopted, '--note', 'we work this way already');
  await mnema('skill', 'move', 'review', waitingSkill, '--note', 'worth a look');

  return {
    anchor,
    liveTask,
    waitingTask,
    overTask,
    inForce,
    adopted,
    waitingDecision,
    waitingSkill,
    run: runId,
  };
}

/** What `mnema status --actor <anchor> --json` served, parsed. */
async function statusJson(anchor: string): Promise<Record<string, unknown>> {
  const out = await mnema('status', '--actor', anchor, '--json');
  return JSON.parse(out.join('\n')) as Record<string, unknown>;
}

/**
 * The answer with everything a CLOCK decided taken out, by name.
 *
 * Three fields are derived from the instant the question was asked (`ageSeconds`,
 * `idleSeconds`) or from which party asked it (`thisSession`), so two doors answering
 * the same record milliseconds apart differ in them legitimately. Dropping them by NAME
 * rather than by a loose comparison is what keeps the rest exact — and the case that
 * uses this asserts what SURVIVES, so a drop that emptied the comparison is caught
 * rather than passed.
 */
function withoutTheClock(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTheClock);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !['ageSeconds', 'idleSeconds', 'thisSession'].includes(key))
      .map(([key, inner]) => [key, withoutTheClock(inner)]),
  );
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-where-things-stand-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'data') };
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = env.xdgDataHome as string;
  process.env.HOME = env.home;
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema status — the opening read, over a record that reaches every cell', () => {
  it('names the live work, what governs, what is adopted and what awaits a ruling', async () => {
    const fixture = await aRecordThatReachesEveryCell();
    const served = await statusJson(fixture.anchor);

    // THE FIXTURE REACHES THE CELL, asserted before anything is said about the answer.
    // A record that cannot produce a waiting decision makes "the waiting list is right"
    // a claim about an empty list, and the case would pass with the whole half deleted.
    expect((served.work as { id: string }[]).map((one) => one.id)).toContain(fixture.liveTask);
    // And the two the work list must NOT hold: one waiting on a verdict (it is on the
    // other list, below) and one that arrived (it is on neither).
    expect((served.work as { id: string }[]).map((one) => one.id)).not.toContain(
      fixture.waitingTask,
    );
    expect((served.work as { id: string }[]).map((one) => one.id)).not.toContain(fixture.overTask);
    expect((served.decisions as { id: string }[]).map((one) => one.id)).toEqual([fixture.inForce]);
    expect((served.skills as { id: string }[]).map((one) => one.id)).toEqual([fixture.adopted]);
    expect(
      (served.awaitingJudgement as { id: string; kind: string; state: string }[])
        .map((one) => `${one.kind} ${one.state} ${one.id}`)
        .sort(),
    ).toEqual(
      [
        `task IN_REVIEW ${fixture.waitingTask}`,
        `decision proposed ${fixture.waitingDecision}`,
        `skill reviewed ${fixture.waitingSkill}`,
      ].sort(),
    );
    // The session half, which is the fifth: the run the fixture opened is the one it
    // reports having left off in.
    expect((served.resume as { lastRun: { id: string } }).lastRun.id).toBe(fixture.run);

    // And the human form says all of it, each item on ONE line under a header that says
    // how many there are. The ids are what a reader copies into the next command, so
    // they are what the lines are found by.
    const printed = await mnema('status', '--actor', fixture.anchor);
    expect(printed[0]).toMatch(/ — where things stand\.$/);
    const text = printed.join('\n');
    expect(text).toContain('1 decision(s) in force:');
    expect(text).toContain('1 adopted pattern(s):');
    expect(text).toContain('3 awaiting a judgement:');
    for (const id of [
      fixture.liveTask,
      fixture.waitingTask,
      fixture.inForce,
      fixture.adopted,
      fixture.waitingDecision,
      fixture.waitingSkill,
    ]) {
      const lines = printed.filter((line) => line.includes(id));
      expect(lines, `one line for ${id}`).toHaveLength(1);
    }
    // The task that arrived is on NO line of this read — the sixth cell, deliberately
    // empty, asserted over a record that holds one.
    expect(printed.filter((line) => line.includes(fixture.overTask))).toEqual([]);
    // The waiting list says which machine each item is and which ruling is missing —
    // without those two words the line names a record and no action.
    expect(text).toMatch(new RegExp(`${fixture.waitingTask}\\s+task\\s+.*\\(IN_REVIEW\\)`));
    expect(text).toMatch(new RegExp(`${fixture.waitingDecision}\\s+decision\\s+.*\\(proposed\\)`));
    expect(text).toMatch(new RegExp(`${fixture.waitingSkill}\\s+skill\\s+.*\\(reviewed\\)`));
    // NAMES, NEVER BODIES — the derivation's rule, kept by the surface that prints it.
    expect(text).not.toContain('One reviewable change with its tests.');
    expect(text).not.toContain('a wiki page goes stale');
  }, 60_000);

  it('says every half is empty, in words, over a project that holds nothing', async () => {
    const initiated = await mnema('init');
    const identity = initiated.find((line) => line.trim().startsWith('identity:')) as string;
    const anchor = identity.trim().slice('identity:'.length).trim();

    const printed = await mnema('status', '--actor', anchor);
    // Each half states its own emptiness. A heading with nothing under it is the shape
    // the derivation's own doc calls the worst an opening read can have: an empty answer
    // that reads like an answer. Compared on the words rather than on the depth — the
    // session's half is a FACT under the heading and the four lists are headings of
    // their own, which is a difference the golden pins and this case is not about.
    const said = printed.map((line) => line.trim());
    expect(said).toContain('No runs.');
    expect(said).toContain('No live tasks.');
    expect(said).toContain('No decisions in force.');
    expect(said).toContain('No adopted patterns.');
    expect(said).toContain('Nothing awaiting a judgement.');
    // And nothing is invented: no count, no header, no item.
    expect(printed.join('\n')).not.toMatch(/\d+ (of \d+ )?(live|decision|adopted|awaiting)/);
  }, 30_000);

  it('refuses outside a project rather than answering about nothing', async () => {
    const initiated = await mnema('init');
    const identity = initiated.find((line) => line.trim().startsWith('identity:')) as string;
    const anchor = identity.trim().slice('identity:'.length).trim();

    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    process.chdir(elsewhere);
    const c = capture();
    await run(['status', '--actor', anchor], c.io);
    expect(c.failed()).toBe(true);
    expect(c.out).toEqual([]);
    expect(c.err.join('\n')).toContain('No mnema project here.');
  }, 30_000);
});

describe('the two surfaces answer with one derivation', () => {
  it('serves the same object through the CLI’s --json and the MCP’s payload', async () => {
    const fixture = await aRecordThatReachesEveryCell();

    const fromCli = await statusJson(fixture.anchor);
    const session: Session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(repo).href],
      env,
    });
    try {
      // The same serialization the tool's payload block carries, so what is compared is
      // what each door hands over rather than two objects that happen to be alike.
      const fromMcp = JSON.parse(JSON.stringify(runBootstrap(session), null, 2)) as unknown;

      // The session's actor IS the machine's anchor — the same identity the CLI was
      // handed — so the two are answering the same question and not two.
      expect(session.who).toBe(fixture.anchor);

      const cli = withoutTheClock(fromCli) as Record<string, unknown>;
      const mcp = withoutTheClock(fromMcp) as Record<string, unknown>;
      expect(cli).toEqual(mcp);

      // WHAT SURVIVED THE DROP, so the equality above is never "two empty objects are
      // equal". Every list is non-empty here, and the fields the clock decided are the
      // only ones gone.
      expect((cli.work as unknown[]).length).toBeGreaterThan(0);
      expect((cli.decisions as unknown[]).length).toBeGreaterThan(0);
      expect((cli.skills as unknown[]).length).toBeGreaterThan(0);
      expect((cli.awaitingJudgement as unknown[]).length).toBeGreaterThan(0);
      expect((cli.resume as { lastRun: { id: string } }).lastRun.id).toBe(fixture.run);
      expect(JSON.stringify(cli)).not.toContain('ageSeconds');
      // And the raw answers really DID hold the fields that were dropped, or the drop
      // was over nothing and would keep passing after the clock stopped being reported.
      expect(JSON.stringify(fromCli)).toContain('ageSeconds');
      expect(JSON.stringify(fromMcp)).toContain('ageSeconds');
    } finally {
      closeSession(session);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Who serves the opening read, and who composes it
// ---------------------------------------------------------------------------

/** Every production file of the workspace, keyed by its path from `packages/`. */
function production(): { path: string; code: string }[] {
  const found: { path: string; code: string }[] = [];
  for (const directory of ['chain', 'core', 'copilot', 'code']) {
    const src = join(PACKAGES, directory, 'src');
    for (const path of sourceFiles(src)) {
      found.push({
        path: path
          .slice(PACKAGES.length + 1)
          .split(sep)
          .join('/'),
        code: codeOnly(readFileSync(path, 'utf-8')),
      });
    }
  }
  return found;
}

/**
 * The halves the opening context is composed OF, named as the derivation names them.
 *
 * A door that calls `bootstrap` reaches none of these directly; a door that decided to
 * assemble the answer for itself reaches most of them. That is the discriminant, and it
 * is not "imports from copilot" — `brief` legitimately reaches two of them, because a
 * governance document is the decisions in force and the adopted patterns and nothing
 * else.
 */
const HALVES = [
  'resume',
  'liveWork',
  'adoptedSkills',
  'decisionsInForce',
  'tasksAwaitingJudgement',
  'decisionsAwaitingJudgement',
  'skillsAwaitingJudgement',
] as const;

/** How many of the halves a file's code mentions. */
function halvesReached(code: string): number {
  return HALVES.filter((half) => new RegExp(`\\b${half}\\b`).test(code)).length;
}

/** Every production file that CALLS the copilot's `bootstrap`, by path. */
function callsBootstrap(files: readonly { path: string; code: string }[]): string[] {
  return files
    .filter((file) => /\bbootstrap\s*\(/.test(file.code))
    .map((file) => file.path)
    .sort();
}

/** Every production file that composes three or more of the halves, by path. */
function composesTheOpening(files: readonly { path: string; code: string }[]): string[] {
  return files
    .filter((file) => halvesReached(file.code) >= 3)
    .map((file) => file.path)
    .sort();
}

describe('one derivation, and the doors that serve it', () => {
  const FILES = production();

  it('reads the whole of production, so the two sweeps below are not empty', () => {
    // The enumeration's own non-vacuity: a directory that stopped resolving would empty
    // both nets and pass in silence.
    expect(FILES.length).toBeGreaterThan(150);
    expect(FILES.map((file) => file.path)).toContain('copilot/src/context/bootstrap.ts');
    expect(FILES.map((file) => file.path)).toContain('code/src/commands/status.ts');
  });

  it('serves the opening read from exactly two doors, and the derivation itself', () => {
    // THE RULE. `bootstrap` is called by the two adapters that serve it — one per
    // surface — and by the module that defines it. A third door added tomorrow arrives
    // here as a failure rather than as a second answer nobody compared.
    expect(callsBootstrap(FILES)).toEqual([
      'code/src/commands/status.ts',
      'code/src/mcp/tools.ts',
      'copilot/src/context/bootstrap.ts',
    ]);
  });

  it('lets nobody but the derivation compose the halves', () => {
    // The other way a second answer grows: not by calling the derivation from somewhere
    // new, but by assembling it. `brief` reaches TWO halves on purpose and is left
    // alone; three is the line, and only the derivation crosses it.
    expect(composesTheOpening(FILES)).toEqual(['copilot/src/context/bootstrap.ts']);
    expect(
      halvesReached(FILES.find((file) => file.path === 'copilot/src/context/brief.ts')?.code ?? ''),
    ).toBe(2);
  });

  it('accuses a third door and a hand-composed answer — on input of its own', () => {
    // The mechanism's teeth. With the tree honest the two cases above say only "nothing
    // is accused", so neither has ever shown these nets can go red.
    const thirdDoor = [{ path: 'code/src/wiring/later.ts', code: 'return bootstrap(caches, s);' }];
    expect(callsBootstrap(thirdDoor)).toEqual(['code/src/wiring/later.ts']);
    const handComposed = [
      {
        path: 'code/src/commands/later.ts',
        code: 'resume(c, s); adoptedSkills(c); decisionsInForce(c);',
      },
    ];
    expect(composesTheOpening(handComposed)).toEqual(['code/src/commands/later.ts']);
    // And neither net is a constant: a file that does neither comes through clean, and
    // the PROSE that names the derivation is not a call — which is the whole reason the
    // scan runs over code with the comments blanked.
    const innocent = [
      {
        path: 'code/src/commands/other.ts',
        code: codeOnly('/** calls bootstrap( ) */ const a=1;'),
      },
      { path: 'copilot/src/context/brief.ts', code: 'adoptedSkills(c); decisionsInForce(c);' },
    ];
    expect(callsBootstrap(innocent)).toEqual([]);
    expect(composesTheOpening(innocent)).toEqual([]);
  });
});

describe('the console offers it, and does not run it on opening', () => {
  it('is one of the reads a read-only session dispatches', async () => {
    // The elo with the console is the gate's, not a list: `status` declared itself a
    // read, so the session offers it by construction. Asserted against the REGISTERED
    // program, which is what the session decides from.
    const c = capture();
    const { verbs, program } = buildProgram(c.io);
    expect(verbsOffered(verbs, 'repl')).toContain('status');
    expect(program.commands.map((command) => command.name())).toContain('status');
  });

  it('is a verb and not part of the opening — nothing in the console reaches it', () => {
    // The console draws its opening without asking the record what there is to do, and
    // it must stay that way: what the opening costs is measured in
    // `the-name-and-the-hints.test.ts` and this read is not in that budget. So no file
    // of the console names this verb's adapter or its printer.
    const console = production().filter((file) => file.path.startsWith('code/src/repl/'));
    expect(console.length).toBeGreaterThan(5);
    for (const file of console) {
      expect(file.code, file.path).not.toMatch(/\brunStatus\b|\bstatusReport\b/);
    }
  });
});
