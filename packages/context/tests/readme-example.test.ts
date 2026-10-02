/**
 * The README's usage example, RUN — and run as the very bytes the page publishes.
 *
 * THIS FILE USED TO PROMISE SOMETHING IT DID NOT DO. It said: *"If this drifts from the
 * README, fix one or the other — the example must run."* That is an intention, not a
 * guard, and the file was a parallel TRANSLATION of the page rather than a reading of it.
 * What falsified it, measured on 11/09/2026 against `a41a9ea8`: renaming `bootstrap` to
 * `bootstrapZZZ` inside the README's own ```ts block — an edit that makes the published
 * example impossible to run — left this case green. The two copies had also already aged
 * four lines apart, in ways nobody introduced on purpose: three comment rewraps, and two
 * places where the page said more than the code that ran.
 *
 * WHAT MAKES THE SENTENCE TRUE NOW. The region between the two markers below is compared,
 * line for line, against the page's block by
 * `packages/code/tests/the-example-is-read-from-the-page.test.ts`. A name changed on the
 * page and left alone here turns the suite red, and so does the reverse; the same
 * rename now reddens two cases.
 *
 * NOTHING BELOW IS ELIDED. The state this example reads over is elided by the PAGE, in
 * the prose above its block ("given a rebuilt cache over your chain"), and the setup
 * above the first marker is that prose made real.
 *
 * WHICH MAKES THIS THE ONE PAGE WHOSE BLOCK DOES NOT COMPILE ALONE: it names `cache` and
 * `chainRoot` and declares neither. `code/tests/the-example-is-type-checked.test.ts`
 * supplies them with the two types this setup really produces — `bench.cache()` and
 * `bench.root` — and holds that supply to exactly the names the page needs, so a
 * declaration cannot quietly grow into one the page never asked for.
 */
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  adoptedSkills,
  bootstrap,
  brief,
  guard,
  nextActionsForTask,
  readRecord,
} from '../src/index.js';
import {
  type Bench,
  birthDecision,
  birthSkill,
  birthTask,
  consultSkill,
  makeBench,
  moveDecision,
  moveTask,
  startRun,
} from './support/chain.js';

describe('README example', () => {
  it('runs exactly as documented', () => {
    // (Setup: a chain with one open run, one task in progress, one adopted pattern
    // and one accepted decision. In the README this is elided as "given a rebuilt
    // cache over your chain".)
    const bench: Bench = makeBench();
    startRun(bench, 'run-42', { agent: 'claude', who: 'alice', goal: 'ship the parser' });
    const task = birthTask(bench, 'task-7', 'Parse tokens');
    moveTask(bench, task, 'DRAFT', 'READY', 'submit');
    moveTask(bench, task, 'READY', 'IN_PROGRESS', 'start');
    birthSkill(bench, 'skill-3', 'Small PRs', 'adopted');
    // Two facts PINNED to the run, so `wrote` below is a tally and not an empty
    // array: an example whose every field is the empty case documents nothing.
    consultSkill(bench, 'skill-3', { run: 'run-42' });
    consultSkill(bench, 'skill-3', { run: 'run-42' });
    birthDecision(bench, 'dec-5', 'Hand-rolled arithmetic');
    moveDecision(bench, 'dec-5', 'proposed', 'accepted', 'accept');
    const cache = bench.cache();
    // The chain root the cache was opened on — the README's `chainRoot`.
    const chainRoot = bench.root;

    try {
      // ---- README example begins ----
      // Where did I leave off, what can I do next, by what patterns, and what is settled?
      // `asOf` is the clock the ages are measured against; `sessionRuns` are the runs
      // this caller opened itself (none, for a caller that has only read).
      const opening = bootstrap([cache], {
        actor: 'alice',
        asOf: new Date().toISOString(),
        sessionRuns: [],
      });
      const lastGoal = opening.resume.lastRun?.goal; // "ship the parser"
      const openFor = opening.resume.lastRun?.ageSeconds; // how long it has been open
      const didWrite = opening.resume.lastRun?.wrote; // WHAT went in: [{ kind, count }, …]
      const firstJob = opening.work[0]; // the freshest live task — a NAME
      const more = opening.workTotal > opening.work.length; // was the list cut?
      const patterns = opening.skills.map((s) => s.name); // names only — one line each
      const governing = opening.decisions.map((d) => `${d.adr} ${d.title}`); // names only

      // A name that turned out to matter: ask what that ONE task allows.
      const moves = firstJob && nextActionsForTask(cache, firstJob.id)?.map((a) => a.action);

      // A name that matches the task at hand: ask for the pattern itself.
      const [pattern] = adoptedSkills([cache]); // each carries its `body`

      // A decision that bears on the task at hand: ask for the argument behind it.
      // `readRecord` spans trees, so it takes each cache paired with the tree it stands
      // for — `chainRoot` is that tree's chain directory (see `@mnema/core`).
      const settled = opening.decisions[0];
      const sources = [{ scope: 'public' as const, chainRoot, cache }];
      const argued = settled && readRecord(sources, settled.id); // { kind: 'decision', record: … }

      // Everything that governs, whole — for a file an agent host reads on its own.
      // Same two derivations as `bootstrap`, with no cut: every rule or none. It takes the
      // scoped sources and keeps the PUBLIC ones, because the file it feeds is committed:
      // a rule in the private or the global tree governs your work and does not travel.
      // The channel names are the CALLER's: this package reports where each of the two
      // unasked channels stands and cannot invent one.
      const governs = brief(sources, {
        editPush: 'edit-rules-push',
        asksAPerson: 'edit-asks-a-person',
      });
      const rules = governs.decisions.length + governs.skills.length; // 2, and nothing was cut

      // Before asking to move a task, is the move even allowed?
      const verdict = guard({
        from: 'IN_PROGRESS',
        action: 'complete',
        who: 'alice',
        which: 'claude',
      });
      // verdict.ok === false, verdict.code === "MISSING_PROOF" (complete needs a note)
      // ---- README example ends ----

      expect(lastGoal).toBe('ship the parser');
      expect(openFor).toBeTypeOf('number');
      expect(didWrite).toEqual([{ kind: 'skill.consulted', count: 2 }]);
      expect(firstJob?.id).toBe('task-7');
      // One task in the record, so nothing was cut — the example's own claim.
      expect(more).toBe(false);
      expect(moves).toContain('complete');
      expect(patterns).toEqual(['Small PRs']);
      expect(pattern?.body).toBe('body of Small PRs');
      // The decision arrives as a name; the argument comes through the second read.
      expect(governing).toEqual(['ADR-dec-5 Hand-rolled arithmetic']);
      expect(argued).toMatchObject({
        kind: 'decision',
        record: { rationale: 'why Hand-rolled arithmetic' },
      });
      // The whole of what governs, and it is the same governance the opening read
      // served — one accepted decision and one adopted pattern, neither cut.
      expect(rules).toBe(2);
      expect(governs.decisions).toEqual(opening.decisions);
      expect(governs.skills).toEqual(opening.skills);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe('MISSING_PROOF');
    } finally {
      cache.close();
      rmSync(bench.root, { recursive: true, force: true });
    }
  });
});
