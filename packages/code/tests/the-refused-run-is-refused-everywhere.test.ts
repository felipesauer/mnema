/**
 * A RUN THE RECORD CANNOT VOUCH FOR STOPS EVERY WRITE THAT WOULD HAVE STAMPED IT — at
 * every command that stamps one, and not only at the one that happened to have a test.
 *
 * `MNEMA_RUN` enters from OUTSIDE the process, so it is the one piece of a write's
 * envelope the surface cannot take on faith, and it is proven once, at the transport
 * (`wiring/run-pin.ts`). The resolver reports the refusal itself and answers with
 * `PIN_REFUSED`; from there the verb "only has to fail". That sentence is written at
 * FOURTEEN sites in nine files, and it was asserted at ONE — `memory`, through the three
 * `cli-e2e` cases that drive an invented, a closed and a foreign session. The other
 * thirteen were the same four lines copied, with nothing anywhere observing that they
 * ran.
 *
 * THE GUARD HAS TWO HALVES AND ONLY ONE OF THEM WAS EVER PROTECTED, which is what this
 * file is really about. It was measured on the trunk, by writing the mutation and asking
 * the compiler:
 *
 *   - "IT DOES NOT WRITE" IS ALREADY TOTAL, and the compiler is what makes it so.
 *     Deleting the whole guard from `handoff.ts` does not typecheck: the resolver answers
 *     `string | undefined | typeof PIN_REFUSED`, the spread `...(run !== undefined ? {
 *     run } : {})` then carries `string | symbol`, and the adapter's input takes
 *     `run?: string` — TS2379, at the call, in `src`. A fifteenth site written the naive
 *     way cannot be committed. That is the totality-in-the-type this bench prefers, and
 *     it needs no test.
 *   - "IT FAILS" IS PROTECTED BY NOTHING. Deleting only the `io.fail()` and keeping the
 *     `return` typechecks CLEAN. The write is still refused, and the shell is told the
 *     command SUCCEEDED — a script that stops on a non-zero exit walks straight past a
 *     write that never happened. Thirteen of the fourteen sites had nothing that would
 *     have noticed.
 *
 * So the property below is the second half, applied to whatever the program routes today.
 *
 * WHERE THE LIST COMES FROM. Not from a grep and not from a list in this file: the
 * command paths are WALKED off the program the entry builds — the same one the binary
 * parses with — and each one's command line is SYNTHESISED from its own declaration
 * (`support/the-line-a-path-takes.ts`, where the argument for that is written out). A
 * subcommand added tomorrow is therefore exercised without an edit here, and the set of
 * paths that ask for a run is MEASURED rather than declared.
 *
 * HOW A PATH IS FOUND TO ASK, and why it is this code and not the obvious one. With no
 * project to prove the value against, the resolver refuses with `UNPROVEN_RUN` — a code
 * produced at exactly one place in the workspace, the resolver itself. The obvious
 * discriminant, `UNKNOWN_RUN`, has an IMPOSTOR: `mnema run end` reads `MNEMA_RUN` on its
 * own account and its adapter refuses an unknown id under the very same code, so a scan
 * for it would have classified a verb that stamps nothing as a site of this rule. The
 * instrument was chosen after being caught accusing.
 *
 * WHAT IS ASSERTED, in two passes, because one instrument cannot carry both halves:
 *
 *   1. TOTAL, OVER EVERY PATH THE PROGRAM ROUTES. Each is invoked outside a project with
 *      a pinned run, and every path that asked has to have failed and printed nothing on
 *      the stream a report goes to. Nothing is written there by anybody, so this pass
 *      says nothing about the record — it is the exit code and the silence.
 *   2. THE PAIR, OVER EVERY PATH FOUND TO ASK. In a project of its own, the same line is
 *      run twice: once with a session the record has no record of, where it must fail,
 *      append NOTHING and leave the key material it found alone, and once with no session
 *      open, where it must SUCCEED and append to the chain. The second half is what keeps
 *      the first from being vacuous — "it wrote nothing" means something only where the
 *      same line, in the same project, wrote something.
 *
 * WHAT IT DOES NOT COVER, so a pass is not read as more than it is. Three paths are not
 * exercised — `mcp` serves a connection for its lifetime and would never return, `repl`
 * refuses without a terminal at both ends, and `witness stamp` would reach a calendar
 * over the network — and this file says nothing about them either way. None of the three
 * stamps a run today; if one came to, the compiler fact above is still what stops it from
 * writing, and this guard is what would not notice a missing `io.fail()`.
 *
 * AND THREE MORE ARE NOT REACHED, which is a different thing from not being exercised.
 * `mnema run`, `mnema key` and `mnema tail` declare subcommands and no act of their own,
 * so the parser answers the bare form with usage and no code of this surface runs. A line
 * like that comes back looking exactly like a verb that does not stamp a run, so the three
 * are MEASURED and named rather than left to be counted as answers — the pin is that there
 * are no others, because a fourth would be a synthesised line the declaration could not
 * answer for.
 *
 * WHAT IS NOT GUARDED AT ALL, and it is the order. The set of paths that ask is total only
 * while `pinnedRun()` is reached before any refusal that depends on there being a project.
 * Two shapes on this surface already return earlier than it does — `parseScope(...) ===
 * INVALID` in `wiring/task.ts` and in `wiring/decision.ts` — and both are reachable only
 * with a value no synthesised line passes, so the derivation is total today. A verb that
 * checked the project first and forgot its `io.fail()` would be classified here as a path
 * that never asked, and nothing would say so.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_DIR } from '@mnema/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { renderPlain } from '../src/presentation/plain.js';
import { PIN_REFUSED, pinnedRunResolver, RUN_ENV } from '../src/wiring/run-pin.js';
import { mergeAForeignTail } from './support/a-tail-from-another-machine.js';
import {
  type Fixture,
  lineFor,
  NOTHING_FOUNDED,
  pathsNamedInTables,
  QUIET,
  type Routed,
  routes,
  SERVES_OR_REACHES_OUT,
  theSurface,
} from './support/the-line-a-path-takes.js';
import { held } from './support/the-record-held.js';

// ---------------------------------------------------------------------------
// Running one line
// ---------------------------------------------------------------------------

/** What one invocation did: what it printed, on which stream, and how it exited. */
interface Outcome {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** A port that keeps the two streams apart — which stream a line went to is the point. */
function capture(): { io: CliIo; outcome: () => Outcome } {
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
    outcome: () => ({ out, err, failed }),
  };
}

/** Runs `mnema <argv>` through the entry the binary uses. */
async function mnema(argv: readonly string[]): Promise<Outcome> {
  const port = capture();
  await run(argv, port.io);
  return port.outcome();
}

/**
 * The refusal only the pin resolver writes, as a caller would read it on the stream.
 *
 * The code is the whole discriminant: `UNPROVEN_RUN` is produced at one place in the
 * workspace. See this file's opening for why the neighbouring code could not be used.
 */
const THE_PIN_REFUSED = 'Refused (UNPROVEN_RUN)';

/** The refusal the same resolver writes INSIDE a project, for a session it cannot find. */
const NO_SUCH_SESSION = 'Refused (UNKNOWN_RUN)';

/** A well-formed id no record holds — the pin a stale shell carries. */
const A_RUN_NOBODY_OPENED = '00000000-0000-7000-8000-000000000000';

/** What the surface puts on the stream when the PARSER, not a verb, answered. */
const THE_PARSER_ANSWERED = 'Usage: mnema';

// ---------------------------------------------------------------------------
// What is accused
// ---------------------------------------------------------------------------

/** One path, exercised with a pinned run that cannot be proven. */
interface Refused {
  readonly path: string;
  /** Whether the pin resolver spoke — which is what says this path asks for a run. */
  readonly asked: boolean;
  /** Whether the invocation recorded a non-zero exit. */
  readonly failed: boolean;
  /** What went to the stream a report goes to. */
  readonly printed: readonly string[];
  /**
   * Whether the PARSER answered instead of the path — the one way `asked: false` lies.
   *
   * A synthesised line the declaration could not answer for is refused before any action
   * of this surface runs, and it would then be counted as a path that does not stamp a
   * run, silently. It is measured off the usage line, which is the one thing only a parser
   * refusal puts on the stream: `wiring/misuse.ts` gives every command of the program one
   * voice for a misuse, and the second line of every one of those is the `usage()` the help
   * prints. A verb's own refusal never carries it.
   */
  readonly parserAnswered: boolean;
}

/**
 * Every path that asked for a run and then did not behave as a refusal — BY NAME.
 *
 * Named rather than counted, because the whole point of walking the surface is that the
 * red says WHICH site broke. A path that never asked is not judged here: it has no run to
 * be refused, and judging it would make this accuse the whole surface for one verb's sake.
 */
function accused(refused: readonly Refused[]): string[] {
  const complaints: string[] = [];
  for (const one of refused) {
    if (!one.asked) continue;
    if (!one.failed) complaints.push(`${one.path}: exited zero after the run was refused`);
    if (one.printed.length > 0) {
      complaints.push(`${one.path}: printed a report after the run was refused`);
    }
  }
  return complaints.sort();
}

// ---------------------------------------------------------------------------
// The sandbox
// ---------------------------------------------------------------------------

let sandbox: string;
const before = { cwd: process.cwd(), home: process.env.HOME, xdg: process.env.XDG_DATA_HOME };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-pinned-'));
});

afterEach(() => {
  process.chdir(before.cwd);
  process.env.HOME = before.home;
  process.env.XDG_DATA_HOME = before.xdg;
  delete process.env[RUN_ENV];
  rmSync(sandbox, { recursive: true, force: true });
});

/** Every value the synthesised lines need, invented by nothing — the product minted each. */
async function fixture(name: string): Promise<Fixture> {
  const project = join(sandbox, name, 'project');
  mkdirSync(project, { recursive: true });
  // A machine of its own as well as a project of its own, so no path inherits what the
  // one before it founded.
  process.env.HOME = join(sandbox, name, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, name, 'data');
  delete process.env[RUN_ENV];
  process.chdir(project);

  const founded = await mnema(['init']);
  const identity = founded.out.find((line) => line.trim().startsWith('identity:'));
  if (identity === undefined) throw new Error(`fixture: init printed no identity: ${founded.out}`);
  const idOf = async (argv: readonly string[]): Promise<string> => {
    const made = await mnema(argv);
    const found = made.out.join('\n').match(/\(([0-9a-f-]{36})\)/);
    if (found?.[1] === undefined) {
      throw new Error(
        `fixture: \`${argv.join(' ')}\` printed no id: ${[...made.out, ...made.err]}`,
      );
    }
    return found[1];
  };

  // One decision file, in the shape the importer takes: a level-1 title and a named
  // section. It lives INSIDE the project because a proposal records where it was read
  // from, and that provenance has to be citable by every clone.
  const decisionFiles = join(project, 'adr');
  mkdirSync(decisionFiles, { recursive: true });
  writeFileSync(
    join(decisionFiles, '0001-the-record-governs.md'),
    '# The record governs\n\n## Context\n\nIt was already written down.\n',
    'utf8',
  );

  return {
    anchor: identity.trim().slice('identity:'.length).trim(),
    task: await idOf(['task', 'the task the lines name']),
    decision: await idOf(['decision', 'a decision to move', 'because it was decided']),
    successor: await idOf(['decision', 'the decision that replaces it', 'because it is later']),
    skill: await idOf(['skill', 'a pattern to move', '--body', 'the pattern itself']),
    foreignTail: mergeAForeignTail(
      join(project, PROJECT_DIR),
      join(sandbox, name, 'other-machine'),
    ),
    decisionFiles,
  };
}

// ---------------------------------------------------------------------------
// The measurement both passes read
// ---------------------------------------------------------------------------

/**
 * Every path the surface routes, exercised with a run nothing can prove — in a sandbox of
 * this function's own, made and removed here.
 *
 * It is measured ONCE and read by two cases: the second would otherwise found a project
 * for every path on the surface to discover the fifteen that need one.
 */
let measurement: Promise<Refused[]> | undefined;

async function everyPathUnderARefusedRun(): Promise<Refused[]> {
  measurement ??= (async () => {
    const own = mkdtempSync(join(tmpdir(), 'mnema-unfounded-'));
    const restore = { cwd: process.cwd(), home: process.env.HOME, xdg: process.env.XDG_DATA_HOME };
    try {
      process.env.HOME = join(own, 'home');
      process.env.XDG_DATA_HOME = join(own, 'data');
      process.env[RUN_ENV] = A_RUN_NOBODY_OPENED;
      const measured: Refused[] = [];
      for (const routed of theSurface()) {
        if (SERVES_OR_REACHES_OUT[routed.path] !== undefined) continue;
        // A directory of its own per line, so the one verb that would found a project
        // cannot change what the next line sees.
        const where = join(own, 'at', routed.path.replace(/ /g, '-'));
        mkdirSync(where, { recursive: true });
        process.chdir(where);
        const outcome = await mnema(lineFor(routed, NOTHING_FOUNDED));
        measured.push({
          path: routed.path,
          asked: outcome.err.join('\n').includes(THE_PIN_REFUSED),
          failed: outcome.failed,
          printed: outcome.out,
          parserAnswered: outcome.err.join('\n').includes(THE_PARSER_ANSWERED),
        });
      }
      return measured;
    } finally {
      process.chdir(restore.cwd);
      process.env.HOME = restore.home;
      process.env.XDG_DATA_HOME = restore.xdg;
      delete process.env[RUN_ENV];
      rmSync(own, { recursive: true, force: true });
    }
  })();
  return measurement;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('the refused run is refused everywhere', () => {
  it('walks the entry’s program, and every table that names a path names a real one', () => {
    const surface = theSurface().map((one) => one.path);
    // The walk found the three shapes this file reasons about: a top-level verb, a group
    // that is itself an act, and a subcommand two words deep.
    expect(surface).toContain('memory');
    expect(surface).toContain('task');
    expect(surface).toContain('decision supersede');
    expect(new Set(surface).size).toBe(surface.length);

    // And no table of the synthesiser may name a path the surface does not route: an
    // entry left behind by a rename would otherwise sit there excusing nothing, forever.
    expect(pathsNamedInTables().filter((path) => !surface.includes(path))).toEqual([]);
  });

  it('every path that asks for a run fails when the run cannot be proven, and prints nothing', async () => {
    const measured = await everyPathUnderARefusedRun();

    // THE RULE. Every path that asked was told no, and said so with its exit code and by
    // reporting nothing — the half the compiler does not hold.
    expect(accused(measured)).toEqual([]);

    // The derivation itself, both ways: this is the list the rule was applied to, and a
    // path that starts stamping a run has to arrive in it before anything can be said to
    // have checked it. FIFTEEN paths from FOURTEEN written sites — `switch off` and
    // `switch on` are one site, declared once by a function that hangs both.
    const asks = measured.filter((one) => one.asked).map((one) => one.path);
    expect([...asks].sort()).toEqual([
      'decision',
      'decision import',
      'decision move',
      'decision supersede',
      'handoff',
      'link',
      'memory',
      'observe',
      'skill',
      'skill move',
      'switch off',
      'switch on',
      'tail prune',
      'task',
      'task move',
    ]);
    // The count is the walk's, and it says only that: every path the walk found was
    // exercised except the ones declared unexercisable. It is not the claim underneath —
    // "every path was REACHED" — because the two sides of it are the same arithmetic: the
    // loop pushes a row per routed path unconditionally, so a line that never arrived
    // anywhere is a row like any other.
    expect(measured.length).toBe(theSurface().length - Object.keys(SERVES_OR_REACHES_OUT).length);

    // SO THE CLAIM IS MEASURED SEPARATELY, and it does not hold for three: a line that
    // stopped at the parser was counted as a path that does not ask, silently, and here
    // are the ones it happened to. All three are groups whose bare form routes nothing —
    // they declare subcommands and no act of their own, so the parser answers with usage
    // and no code of this surface runs. They have no run to be refused and nothing here is
    // said about them; what this pins is that there are no OTHERS. A fourth arriving is a
    // synthesised line the declaration could not answer for, which would have been read as
    // a verb that does not stamp a run.
    expect(
      measured
        .filter((one) => one.parserAnswered)
        .map((one) => one.path)
        .sort(),
    ).toEqual(['key', 'run', 'tail']);
    // And the two facts are exclusive, which is what makes the first list readable: a path
    // the parser answered for cannot also have been heard by the pin resolver.
    expect(measured.filter((one) => one.parserAnswered && one.asked)).toEqual([]);
  }, 120_000);

  it('the same line writes with no session open, and writes NOTHING with one that cannot be proven', async () => {
    // The pair. "It wrote nothing" is worth reading only beside a run of the same line,
    // in the same project, that wrote something — so each path found to ask is exercised
    // twice, and the writing half is asserted to have reached the chain.
    const asks = (await everyPathUnderARefusedRun()).filter((one) => one.asked);
    const complaints: string[] = [];
    const bothHalvesSeen: string[] = [];

    for (const one of asks) {
      const routed = theSurface().find((r) => r.path === one.path) as Routed;
      const project = await fixture(one.path.replace(/ /g, '-'));
      const line = lineFor(routed, project);

      // REFUSED FIRST, so what it did is measured over a record no earlier half of this
      // pair has touched — and so a write that leaked here cannot be excused as residue.
      process.env[RUN_ENV] = A_RUN_NOBODY_OPENED;
      const beforeRefusal = held(sandbox);
      const refused = await mnema(line);
      const afterRefusal = held(sandbox);
      const appendedWhileRefused = afterRefusal.events - beforeRefusal.events;
      if (!refused.err.join('\n').includes(NO_SUCH_SESSION)) {
        complaints.push(`${one.path}: the resolver did not refuse a session inside a project`);
      }
      if (!refused.failed) complaints.push(`${one.path}: exited zero with the run refused`);
      if (refused.out.length > 0) complaints.push(`${one.path}: reported with the run refused`);
      if (appendedWhileRefused !== 0) {
        complaints.push(`${one.path}: appended ${appendedWhileRefused} with the run refused`);
      }
      // BOTH HALVES OF WHAT THE RECORD HOLDS, because the reading has two and its own doc
      // says why: a key minted, adopted or installed by something that claimed to read is a
      // change to the record even though no event was appended. Reading the event count
      // alone would let a refused run that touched key material and appended nothing read
      // as clean.
      if (afterRefusal.keys !== beforeRefusal.keys) {
        complaints.push(`${one.path}: key material changed with the run refused`);
      }

      // AND THE SAME LINE, UNPINNED, in the same project: it has to go through and reach
      // the chain, or the paragraph above measured a line that could not write anyway.
      delete process.env[RUN_ENV];
      const beforeWrite = held(sandbox);
      const allowed = await mnema(line);
      const appended = held(sandbox).events - beforeWrite.events;
      if (allowed.failed) {
        complaints.push(`${one.path}: refused unpinned — ${allowed.err.join(' / ')}`);
      }
      if (appended <= 0) complaints.push(`${one.path}: appended nothing unpinned`);
      // WHAT WAS MEASURED, not that the loop ran: a path is recorded here only where the
      // refused half appended nothing and the unpinned half appended something. Pushing
      // unconditionally would make the count below the loop counting its own iterations.
      if (appendedWhileRefused === 0 && appended > 0) bothHalvesSeen.push(one.path);
    }

    expect(complaints).toEqual([]);
    // The pair covered the whole derived set, so no site's "wrote nothing" rests on a line
    // that could not have written anything in the first place.
    expect([...bothHalvesSeen].sort()).toEqual([...asks].map((one) => one.path).sort());
    expect(bothHalvesSeen.length).toBe(15);
  }, 300_000);

  it('accuses a path that asks and forgets to fail — on a program of its own', async () => {
    // THE MECHANISM'S NON-VACUITY, and it is the shape the trunk cannot show: with the
    // surface honest, the two cases above only ever say "nothing is accused". So a program
    // is built here with two commands of its own — one that guards the write and FORGETS
    // the exit code, which is exactly the mutation the compiler lets through, and one that
    // does both — and the same walk, the same synthesis and the same accusation run over
    // it.
    process.env.HOME = join(sandbox, 'home');
    process.env.XDG_DATA_HOME = join(sandbox, 'data');
    process.env[RUN_ENV] = A_RUN_NOBODY_OPENED;
    process.chdir(sandbox);

    /**
     * A program with the two halves of the guard taken apart.
     *
     * Built per invocation rather than once, because the resolver is memoised per command:
     * one program parsing both lines would report to the first and answer the second in
     * silence, and the second would look like a path that never asked.
     */
    const aProgramOfItsOwn = (io: CliIo): Command => {
      const pinnedRun = pinnedRunResolver({ io, render: renderPlain });
      const program = new Command();
      program
        .command('forgot-to-fail')
        .argument('<content>', 'what it would have recorded')
        .action(() => {
          // The write IS refused — that half is the type's — and the shell is told the
          // command succeeded.
          if (pinnedRun() === PIN_REFUSED) return;
          io.out('recorded');
        });
      program
        .command('says-no-properly')
        .argument('<content>', 'what it would have recorded')
        .action(() => {
          if (pinnedRun() === PIN_REFUSED) {
            io.fail();
            return;
          }
          io.out('recorded');
        });
      return program;
    };

    // The same walk and the same synthesis the surface got — the planted commands are
    // DISCOVERED, not listed.
    const planted = routes(aProgramOfItsOwn(QUIET));
    expect(planted.map((one) => one.path)).toEqual(['forgot-to-fail', 'says-no-properly']);

    const measured: Refused[] = [];
    for (const routed of planted) {
      const line = lineFor(routed, NOTHING_FOUNDED);
      const port = capture();
      await aProgramOfItsOwn(port.io).parseAsync(line, { from: 'user' });
      const outcome = port.outcome();
      measured.push({
        path: routed.path,
        asked: outcome.err.join('\n').includes(THE_PIN_REFUSED),
        failed: outcome.failed,
        printed: outcome.out,
        parserAnswered: outcome.err.join('\n').includes(THE_PARSER_ANSWERED),
      });
    }

    // Both were found to ask — so the derivation sees a command nothing told it about —
    // and exactly one of them is accused, by name.
    expect(measured.map((one) => one.asked)).toEqual([true, true]);
    expect(accused(measured)).toEqual(['forgot-to-fail: exited zero after the run was refused']);

    // The accusation's other two edges, on rows of its own: a path that never asked is not
    // judged, and one that reported after being refused is.
    expect(
      accused([{ path: 'never-asks', asked: false, failed: false, printed: ['a report'] }]),
    ).toEqual([]);
    expect(
      accused([{ path: 'talks-anyway', asked: true, failed: true, printed: ['a report'] }]),
    ).toEqual(['talks-anyway: printed a report after the run was refused']);
  }, 60_000);
});
