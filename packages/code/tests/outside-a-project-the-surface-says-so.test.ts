/**
 * A COMMAND TYPED WHERE THERE IS NO PROJECT SAYS SO, IN ONE SENTENCE — and the ones that
 * answer anyway are named, with the reason each of them can.
 *
 * `wiring/report.ts` states this as a rule: "one wording, because a person who ran the
 * wrong command in the wrong directory reads this line and nothing else", with three
 * verbs overriding the way BACK because a machine recovering an identity is not a machine
 * founding a project. Nothing checked THE RULE. What that cost was measured: of the
 * thirty-eight places on this surface that report a refusal, four had never been reached
 * by any test — `accountability`, `antipatterns`, `timeline` and `witness` — and for three
 * of them the reason is one reason, not three: their ONLY refusal is this one.
 *
 * WHAT WAS ALREADY RUN OUTSIDE A PROJECT, because the sentence above once said nothing
 * was, and that was false. NINE paths were: the golden of the reads opens with a section
 * headed `### outside a project` and pins `search`, `exposure`, `brief`, `usage` and
 * `verify` there with their text and their exit code (`src/cli.reads.golden.txt`);
 * `the-floor-is-the-declaration.test.ts` runs `verify` outside one in a REAL process and
 * pins the exit status; and four more cases each drive one path — `resume`, `guard submit`
 * and `key restore` (`cli-e2e.test.ts`), `brief` again, and `status`
 * (`where-things-stand.test.ts`). None of them is redundant with this file and none makes
 * it redundant: the golden pins the whole wording, the floor pins a process's status, the
 * four pin one path each — and what none of them asks is whether the rule holds over the
 * paths nobody thought to name, which is where all four unreached refusals were.
 *
 * SO THE GUARD IS THE RULE, not four cases. Every path the program routes is invoked in a
 * directory that is not a project, and each one lands in exactly one of four boxes:
 *
 *   1. IT SAYS THERE IS NO PROJECT — the sentence, read off `NO_PROJECT` rather than
 *      retyped, and a non-zero exit. This is where most of the surface goes.
 *   2. IT NAMES ITS OWN WAY BACK — the same opening sentence, continued by the verb.
 *      Declared per verb, because the continuation is the whole point of the override.
 *   3. IT ANSWERS ANYWAY, and the reason is in the table: a read whose subject is the
 *      global tree is answering a legitimate question about whatever record there is, and
 *      `init` is the verb whose whole job is that there is not one yet.
 *   4. IT REFUSES SOMETHING ELSE FIRST — the parser, a missing session, or its own no.
 *      TWO OF THESE ARE A FINDING, recorded rather than repaired here: `show` and `skill
 *      export` answer "No record … here" for an id in a directory that holds no record at
 *      all, which tells a person in the wrong folder that their record is missing.
 *      Changing what a verb says is not this slice's to change.
 *
 * All four boxes are reconciled against the walk in both directions, so a path that
 * changes box has to be moved by hand and a path that disappears cannot leave an excuse
 * behind.
 *
 * AND THE FOURTH OF THE FOUR UNREACHED REFUSALS IS HERE TOO, with an answer that is not
 * the reads'. `witness` refuses NO_TAIL, never "no project", so nothing about a missing
 * project would ever have reached it: what it needed was a record with nothing in it —
 * which is what a directory nobody founded is. It is the one path exercised here and
 * nowhere else, because over a record holding a tail it would go out to a calendar, and
 * over one holding none it returns at its first line with no socket opened.
 *
 * WHAT IT DOES NOT COVER. The two paths that serve a connection instead of returning
 * (`support/the-line-a-path-takes.ts` names them and why), and the WORDING beyond its
 * first sentence for box 1 — the second half is `mnema init`, and that is the golden's.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { NO_PROJECT } from '../src/wiring/report.js';
import { RUN_ENV } from '../src/wiring/run-pin.js';
import {
  lineFor,
  NOTHING_FOUNDED,
  pathsNamedInTables,
  SERVES_A_CONNECTION,
  SERVES_OR_REACHES_OUT,
  theSurface,
} from './support/the-line-a-path-takes.js';
import { held } from './support/the-record-held.js';

/**
 * The opening every "there is no project here" shares, taken from the wording itself.
 *
 * Split off the constant rather than typed again: the three verbs that override the way
 * back keep this half, and a test that retyped it would be a second copy of the very
 * sentence this file exists to say there is only one of.
 */
const THERE_IS_NO_PROJECT = `${NO_PROJECT.split('. ')[0]}.`;

/**
 * The verbs that keep the sentence and change the way back — with the way back.
 *
 * A machine recovering an identity is not a machine founding a project, so `mnema init`
 * would be the wrong instruction and these three say their own. The continuation is
 * asserted, because a verb that lost its override would otherwise fall into box 1 and
 * pass.
 */
const NAMES_ITS_OWN_WAY_BACK: Readonly<Record<string, string>> = {
  'key restore': 'Run `mnema key restore` inside the project to recover.',
  'key enroll': 'Run `mnema key enroll` inside the project to record it.',
  'key revoke': 'Run `mnema key revoke` inside the project to record it.',
};

/** A path that answers where there is no project, and what makes that the right answer. */
const ANSWERS_ANYWAY: Readonly<Record<string, string>> = {
  init: 'it is the verb whose subject is that there is no project here yet',
  search: 'it searches whatever trees are visible, and the global one is a record',
  skills: 'the patterns it lists are read from every visible tree, global included',
  switch: 'where a channel stands is a question about the trees there are, not about a project',
  'tail list': 'the tails it lists are the ones held here, in whichever trees exist',
  'key request': 'a request to be enrolled is composed from this machine’s key, not from a project',
  completion: 'the script it writes is generated from the declarations, and no record is consulted',
  witness: 'it reports on the tails it can see, and says so when there are none',
  'witness upgrade': 'the same: with no tail waiting on an attestation there is nothing to refuse',
};

/**
 * THE SENTENCE THE TWO WITNESS ROWS OF BOX 3 ANSWER WITH, whole — and a finding inside it.
 *
 * `witness` and `witness upgrade` are the two rows above whose reason is that they report
 * on the tails they can see and say so when there are none. This is what saying so IS, and
 * until it was read here nothing read it: the wording is written THREE times in `src` —
 * `presentation/tails.ts`, `presentation/witness.ts` and `wiring/witness.ts` — and only the
 * first of the three had ever been asserted (`the-verb-says-which-tails.test.ts`, over
 * `mnema tail list`). The other two are the two paths below, one each.
 *
 * THE TREE LIST IS EMPTY, and that is recorded rather than repaired. Outside a project the
 * only tree that resolves is this machine's global one, which every witness path leaves out
 * unless asked, so the sentence names nothing and reads `looked in .` — a list with no
 * items and a full stop. Asking is not available on the acts either: `--global` is declared
 * on the group AND on each act, and `mnema witness upgrade --global` binds it to the GROUP,
 * whose value no act reads. That is commander's documented arithmetic — a parent stops
 * consuming its own options at a subcommand only under `enablePositionalOptions()`, which
 * this program does not set — so the flag on `stamp` and on `upgrade` feeds nothing. What a
 * verb prints, and which command a flag binds to, are not a coverage slice's to change.
 */
const NO_TAIL_HOLDS_EVENTS = 'No tail holds events in any tree here — looked in .';

/** Which path is the one reader of which copy of that sentence. */
const SAYS_NO_TAIL_HOLDS_EVENTS: Readonly<Record<string, string>> = {
  witness: 'src/presentation/witness.ts',
  'witness upgrade': 'src/wiring/witness.ts',
};

/**
 * WHAT THE FOURTH OF THE FOUR UNREACHED REFUSALS SAYS, whole.
 *
 * `wiring/witness.ts` reports its act's refusal two lines above the sentence in
 * {@link SAYS_NO_TAIL_HOLDS_EVENTS}, and it was reached by the same walk and read by
 * nothing for the same reason: a box that reconciles NAMES can say a path refused
 * something else first without ever reading what it said. `witness stamp` is the only
 * path that reaches it, and this is the only place on the surface it can be exercised at
 * all — over a record holding a tail it would go out to a calendar.
 */
const NO_TAIL_TO_WITNESS =
  'Refused (NO_TAIL): there is no tail here to witness — nothing has been recorded in these trees';

/**
 * A path whose own refusal arrives before the project is ever missed — with what it says.
 *
 * THE FIRST FOUR ARE STRUCTURE and the last two are a FINDING. `run`, `key` and `tail`
 * are groups whose bare form routes nothing, so the parser answers before any action
 * runs, and `run end` with neither an id nor a variable has no session to be missing a
 * project for. `show` and `skill export` reach their adapter and refuse the ID: in a directory
 * with no record at all, a person is told the record they named does not exist rather
 * than that they are in the wrong place. It is recorded here rather than repaired,
 * because what a verb SAYS is not a coverage slice's to change.
 */
const REFUSES_SOMETHING_ELSE_FIRST: Readonly<Record<string, string>> = {
  run: 'a group whose bare form routes nothing: the parser answers with usage',
  key: 'a group whose bare form routes nothing: the parser answers with usage',
  tail: 'a group whose bare form routes nothing: the parser answers with usage',
  'run end': 'with no id and no MNEMA_RUN there is no session named, which it says first',
  show: 'FINDING: it answers "No record <id> here" where there is no record at all',
  'skill export': 'FINDING: it answers "No skill <id> here" where there is no record at all',
  'witness stamp':
    'with no tail anywhere it refuses NO_TAIL at its first line, before a fetch is composed',
};

/** What one invocation did, in the terms the four boxes are decided by. */
interface Answered {
  readonly path: string;
  readonly failed: boolean;
  readonly said: string;
}

/** What a declaration table tolerates, and what it does not — checked both ways. */
function reconcile(
  found: readonly string[],
  declarations: Readonly<Record<string, string>>,
): { unexpected: string[]; stale: string[] } {
  const names = Object.keys(declarations);
  return {
    unexpected: found.filter((name) => !names.includes(name)).sort(),
    stale: names.filter((name) => !found.includes(name)).sort(),
  };
}

describe('outside a project the surface says so', () => {
  it('says it in one sentence, and every path that does not is named with its reason', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'mnema-unfounded-'));
    const restore = { cwd: process.cwd(), home: process.env.HOME, xdg: process.env.XDG_DATA_HOME };
    const answered: Answered[] = [];
    try {
      delete process.env[RUN_ENV];
      for (const routed of theSurface()) {
        if (SERVES_A_CONNECTION[routed.path] !== undefined) continue;
        // A machine and a directory of its own per line: the one verb here that founds a
        // project must not leave the next line inside one.
        const at = join(sandbox, routed.path.replace(/ /g, '-'));
        mkdirSync(join(at, 'where'), { recursive: true });
        process.env.HOME = join(at, 'home');
        process.env.XDG_DATA_HOME = join(at, 'data');
        process.chdir(join(at, 'where'));

        const out: string[] = [];
        const err: string[] = [];
        let failed = false;
        const io: CliIo = {
          out: (line) => out.push(line),
          err: (line) => err.push(line),
          fail: () => {
            failed = true;
          },
        };
        await run(lineFor(routed, NOTHING_FOUNDED), io);
        answered.push({ path: routed.path, failed, said: [...err, ...out].join('\n') });
      }
    } finally {
      process.chdir(restore.cwd);
      process.env.HOME = restore.home;
      process.env.XDG_DATA_HOME = restore.xdg;
      rmSync(sandbox, { recursive: true, force: true });
    }

    // BOX 1 AND BOX 2 TOGETHER: everything that missed the project said so, in the one
    // sentence, and failed while saying it.
    const missedTheProject = answered.filter((one) => one.said.includes(THERE_IS_NO_PROJECT));
    expect(missedTheProject.filter((one) => !one.failed).map((one) => one.path)).toEqual([]);
    // The three uncovered reads this file was written for are in it, by name — a rename
    // that quietly dropped one of them from the walk would not be caught by a count.
    for (const read of ['accountability', 'antipatterns', 'timeline']) {
      expect(missedTheProject.map((one) => one.path)).toContain(read);
    }

    // BOX 2: the override is the CONTINUATION, and each is asserted, so a verb that lost
    // its own way back does not simply fall into box 1 and pass.
    for (const [path, wayBack] of Object.entries(NAMES_ITS_OWN_WAY_BACK)) {
      const one = answered.find((row) => row.path === path);
      expect(one?.said, `${path} said: ${one?.said}`).toContain(
        `${THERE_IS_NO_PROJECT} ${wayBack}`,
      );
      expect(one?.said).not.toContain(NO_PROJECT);
    }

    // BOX 3 AND BOX 4, both directions: a path that starts answering has to be declared,
    // and a declaration for a path that stopped answering is stale.
    const answeredAnyway = answered.filter((one) => !one.failed).map((one) => one.path);
    expect(reconcile(answeredAnyway, ANSWERS_ANYWAY)).toEqual({ unexpected: [], stale: [] });

    // AND TWO OF BOX 3 SAY THEIR LINE, whole — the half a reconciliation of names cannot
    // see. Each of the two is the only reader of one of the three copies of that wording in
    // `src`, so a copy that drifted, or one that stopped being printed at all, is red here
    // and named. Both are in box 3 by declaration, checked so that a path which started
    // FAILING could not slip out of this assertion by leaving the box.
    for (const [path, copy] of Object.entries(SAYS_NO_TAIL_HOLDS_EVENTS)) {
      expect(Object.keys(ANSWERS_ANYWAY), `${path} left box 3`).toContain(path);
      const one = answered.find((row) => row.path === path);
      expect(one?.said, `${path} (${copy}) said: ${one?.said}`).toBe(NO_TAIL_HOLDS_EVENTS);
    }

    // AND SO DOES THE ONE ROW OF BOX 4 whose refusal is its own rather than the parser's.
    // The other six there are answered by commander or by an id, and their wording belongs
    // to the files that own those; this one is the act's, and reading its name alone left
    // the line nobody's.
    const stamped = answered.find((row) => row.path === 'witness stamp');
    expect(Object.keys(REFUSES_SOMETHING_ELSE_FIRST)).toContain('witness stamp');
    expect(stamped?.said, `witness stamp said: ${stamped?.said}`).toBe(NO_TAIL_TO_WITNESS);
    const refusedOtherwise = answered
      .filter((one) => one.failed && !one.said.includes(THERE_IS_NO_PROJECT))
      .map((one) => one.path);
    expect(reconcile(refusedOtherwise, REFUSES_SOMETHING_ELSE_FIRST)).toEqual({
      unexpected: [],
      stale: [],
    });

    // The four boxes are the whole surface, and box 1 holds most of it — a walk that
    // stopped finding paths would leave every reconciliation above passing over nothing.
    expect(answered.length).toBe(theSurface().length - Object.keys(SERVES_A_CONNECTION).length);
    expect(missedTheProject.length + answeredAnyway.length + refusedOtherwise.length).toBe(
      answered.length,
    );
    expect(missedTheProject.length).toBeGreaterThan(answered.length / 2);
  }, 120_000);

  it('every table here names a path the surface really routes', () => {
    const surface = theSurface().map((one) => one.path);
    const named = [
      ...Object.keys(NAMES_ITS_OWN_WAY_BACK),
      ...Object.keys(ANSWERS_ANYWAY),
      ...Object.keys(REFUSES_SOMETHING_ELSE_FIRST),
      ...Object.keys(SAYS_NO_TAIL_HOLDS_EVENTS),
      ...pathsNamedInTables(),
    ];
    expect(named.filter((path) => !surface.includes(path))).toEqual([]);
  });

  it('reconcile tells the four cases apart — on rows of its own', () => {
    // The mechanism's non-vacuity: with the surface honest the case above only ever says
    // "nothing unexpected, nothing stale", which exercises neither direction.
    expect(reconcile(['a'], { a: 'the reason' })).toEqual({ unexpected: [], stale: [] });
    expect(reconcile(['a', 'b'], { a: 'the reason' })).toEqual({ unexpected: ['b'], stale: [] });
    expect(reconcile([], { a: 'the reason' })).toEqual({ unexpected: [], stale: ['a'] });
    expect(reconcile([], {})).toEqual({ unexpected: [], stale: [] });
    // And the sentence the boxes are decided by is the constant's own first half, not a
    // copy: a reworded refusal moves this with it.
    expect(NO_PROJECT.startsWith(THERE_IS_NO_PROJECT)).toBe(true);
    expect(THERE_IS_NO_PROJECT.length).toBeLessThan(NO_PROJECT.length);
  });

  it('writes nothing while asking the whole surface what it says', async () => {
    // The one thing a walk of every verb could get wrong in a way nothing else notices:
    // `init` is in it, and so is every write. Each line runs where nothing has been
    // founded, so the only thing that may appear is what `init` founds in its OWN
    // directory — measured, rather than assumed, over the sandbox as a whole.
    const sandbox = mkdtempSync(join(tmpdir(), 'mnema-untouched-'));
    const restore = { cwd: process.cwd(), home: process.env.HOME, xdg: process.env.XDG_DATA_HOME };
    try {
      delete process.env[RUN_ENV];
      const elsewhere = join(sandbox, 'a-project');
      mkdirSync(elsewhere, { recursive: true });
      process.env.HOME = join(sandbox, 'home');
      process.env.XDG_DATA_HOME = join(sandbox, 'data');
      process.chdir(elsewhere);
      await run(['init'], { out: () => undefined, err: () => undefined, fail: () => undefined });
      const founded = held(sandbox);
      expect(founded.events).toBeGreaterThan(0);

      // Now every path, from a directory beside it that is not a project.
      const outside = join(sandbox, 'not-a-project');
      mkdirSync(outside, { recursive: true });
      process.chdir(outside);
      for (const routed of theSurface()) {
        // `witness stamp` is left out HERE and only here: the case above exercises it on a
        // machine of its own, where nothing has ever been recorded and it returns before
        // composing a fetch. This one runs beside a project that was just founded, and a
        // guard may not depend on the tail router's scope rule to keep it off the network.
        if (SERVES_OR_REACHES_OUT[routed.path] !== undefined) continue;
        if (routed.path === 'init') continue; // it would found one here, which is its job
        await run(lineFor(routed, NOTHING_FOUNDED), {
          out: () => undefined,
          err: () => undefined,
          fail: () => undefined,
        });
      }
      const after = held(sandbox);
      expect(after.events).toBe(founded.events);
      expect(after.keys).toBe(founded.keys);
    } finally {
      process.chdir(restore.cwd);
      process.env.HOME = restore.home;
      process.env.XDG_DATA_HOME = restore.xdg;
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 120_000);
});
