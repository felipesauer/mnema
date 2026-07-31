/**
 * The README usage example, run as a real test so it can never be fiction.
 * If this drifts from the README, fix one or the other — the example must run.
 */
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adoptedSkills, bootstrap, guard } from '../src/index.js';
import {
  type Bench,
  birthSkill,
  birthTask,
  makeBench,
  moveTask,
  startRun,
} from './support/chain.js';

describe('README example', () => {
  it('runs exactly as documented', () => {
    // (Setup: a chain with one open run and one task in progress. In the README
    // this is elided as "given a rebuilt cache over your chain".)
    const bench: Bench = makeBench();
    startRun(bench, 'run-42', { agent: 'claude', who: 'alice', goal: 'ship the parser' });
    const task = birthTask(bench, 'task-7', 'Parse tokens');
    moveTask(bench, task, 'DRAFT', 'READY', 'submit');
    moveTask(bench, task, 'READY', 'IN_PROGRESS', 'start');
    birthSkill(bench, 'skill-3', 'Small PRs', 'adopted');
    const cache = bench.cache();

    try {
      // ---- README example begins ----
      // Where did I leave off, what can I do next, and by what patterns?
      // `asOf` is the clock the ages are measured against; `sessionRuns` are the
      // runs this caller opened itself (none, for a caller that has only read).
      const opening = bootstrap(
        cache,
        { actor: 'alice', asOf: new Date().toISOString(), sessionRuns: [] },
        [cache],
      );
      const lastGoal = opening.resume.lastRun?.goal; // "ship the parser"
      const openFor = opening.resume.lastRun?.ageSeconds; // how long it has been open
      const firstJob = opening.work[0]; // the freshest actionable task
      const moves = firstJob?.actions.map((a) => a.action); // e.g. ["block", ...]
      const patterns = opening.skills.map((s) => s.name); // names only

      // A name that matches the task at hand: ask for the pattern itself.
      const [pattern] = adoptedSkills([cache]); // each carries its `body`

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
      expect(moves).toContain('complete');
      expect(patterns).toEqual(['Small PRs']);
      expect(pattern?.body).toBe('body of Small PRs');
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe('MISSING_PROOF');
    } finally {
      cache.close();
      rmSync(bench.root, { recursive: true, force: true });
    }
  });
});
