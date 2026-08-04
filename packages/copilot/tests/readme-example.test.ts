/**
 * The README usage example, run as a real test so it can never be fiction.
 * If this drifts from the README, fix one or the other — the example must run.
 */
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adoptedSkills, bootstrap, guard, nextActionsForTask, readRecord } from '../src/index.js';
import {
  type Bench,
  birthDecision,
  birthSkill,
  birthTask,
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
    birthDecision(bench, 'dec-5', 'Hand-rolled arithmetic');
    moveDecision(bench, 'dec-5', 'proposed', 'accepted', 'accept');
    const cache = bench.cache();
    // The chain root the cache was opened on — the README's `chainRoot`.
    const chainRoot = bench.root;

    try {
      // ---- README example begins ----
      // Where did I leave off, what can I do next, by what patterns, and what is settled?
      // `asOf` is the clock the ages are measured against; `sessionRuns` are the
      // runs this caller opened itself (none, for a caller that has only read).
      const opening = bootstrap([cache], {
        actor: 'alice',
        asOf: new Date().toISOString(),
        sessionRuns: [],
      });
      const lastGoal = opening.resume.lastRun?.goal; // "ship the parser"
      const openFor = opening.resume.lastRun?.ageSeconds; // how long it has been open
      const firstJob = opening.work[0]; // the freshest actionable task — a NAME
      const more = opening.workTotal > opening.work.length; // was the list cut?
      const patterns = opening.skills.map((s) => s.name); // names only
      const governing = opening.decisions.map((d) => `${d.adr} ${d.title}`); // names only

      // A name that turned out to matter: ask what that ONE task allows.
      const moves = firstJob && nextActionsForTask(cache, firstJob.id)?.map((a) => a.action);

      // A name that matches the task at hand: ask for the pattern itself.
      const [pattern] = adoptedSkills([cache]); // each carries its `body`

      // A decision that bears on the task at hand: ask for the argument behind it.
      // `readRecord` spans trees, so it takes each cache paired with the tree it
      // stands for — `chainRoot` is that tree's chain directory (see `@mnema/core`).
      const settled = opening.decisions[0];
      const sources = [{ scope: 'public' as const, chainRoot, cache }];
      const argued = settled && readRecord(sources, settled.id); // { kind: 'decision', … }

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
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe('MISSING_PROOF');
    } finally {
      cache.close();
      rmSync(bench.root, { recursive: true, force: true });
    }
  });
});
