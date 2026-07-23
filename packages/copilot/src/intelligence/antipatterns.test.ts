import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthDecision,
  birthSkill,
  birthTask,
  deprecateSkill,
  makeBench,
  moveTask,
  supersedeDecision,
} from '../../tests/support/chain.js';
import { antipatterns } from './antipatterns.js';

/** Drives a task through DONE→reopen→IN_PROGRESS a given number of times. */
function reopenTimes(bench: Bench, id: string, times: number): void {
  birthTask(bench, id, id);
  moveTask(bench, id, 'DRAFT', 'READY', 'submit');
  moveTask(bench, id, 'READY', 'IN_PROGRESS', 'start');
  for (let i = 0; i < times; i++) {
    moveTask(bench, id, 'IN_PROGRESS', 'DONE', 'complete', { note: 'done' });
    moveTask(bench, id, 'DONE', 'IN_PROGRESS', 'reopen', { reason: 'again' });
  }
}

describe('antipatterns — recurring shapes with their evidence', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('counts reopens per task and carries the reopen events as evidence', () => {
    bench = makeBench();
    reopenTimes(bench, 'task-3x', 3);
    const { reopenedTasks } = antipatterns(bench.events());
    expect(reopenedTasks).toHaveLength(1);
    const finding = reopenedTasks[0];
    expect(finding?.entityId).toBe('task-3x');
    expect(finding?.count).toBe(3);
    // The evidence is exactly the three reopen events, all for this task.
    expect(finding?.evidence).toHaveLength(3);
    expect(
      finding?.evidence.every(
        (e) =>
          e.kind === 'task.transitioned' &&
          e.payload.action === 'reopen' &&
          e.subject === 'task-3x',
      ),
    ).toBe(true);
  });

  it('omits a task that never reopened', () => {
    bench = makeBench();
    birthTask(bench, 'clean', 'never reopened');
    moveTask(bench, 'clean', 'DRAFT', 'READY', 'submit');
    expect(antipatterns(bench.events()).reopenedTasks).toEqual([]);
  });

  it('ranks reopened tasks by count then id, deterministically', () => {
    bench = makeBench();
    reopenTimes(bench, 'task-a', 1);
    reopenTimes(bench, 'task-b', 3);
    reopenTimes(bench, 'task-c', 3);
    const ids = antipatterns(bench.events()).reopenedTasks.map((f) => [f.entityId, f.count]);
    // b and c both reopened 3× → by-count desc, then id asc (b before c); a last.
    expect(ids).toEqual([
      ['task-b', 3],
      ['task-c', 3],
      ['task-a', 1],
    ]);
  });

  it('surfaces skill candidates as the reopened-more-than-once subset', () => {
    bench = makeBench();
    reopenTimes(bench, 'once', 1);
    reopenTimes(bench, 'twice', 2);
    const { skillCandidates } = antipatterns(bench.events());
    expect(skillCandidates.map((f) => f.entityId)).toEqual(['twice']);
    // It POINTS at the candidate — it never creates a skill (no write here).
    expect(skillCandidates[0]?.count).toBe(2);
  });

  it('detects a superseded decision with its supersede event', () => {
    bench = makeBench();
    birthDecision(bench, 'dec-old', 'old', 'ACCEPTED');
    birthDecision(bench, 'dec-new', 'new', 'ACCEPTED');
    supersedeDecision(bench, 'dec-old', 'dec-new');
    const { supersededDecisions } = antipatterns(bench.events());
    expect(supersededDecisions).toHaveLength(1);
    expect(supersededDecisions[0]?.entityId).toBe('dec-old');
    expect(supersededDecisions[0]?.count).toBe(1);
    expect(supersededDecisions[0]?.evidence[0]?.kind).toBe('decision.transitioned');
  });

  it('detects a deprecated skill with its deprecate event', () => {
    bench = makeBench();
    birthSkill(bench, 'skill-1', 'a pattern', 'ADOPTED');
    deprecateSkill(bench, 'skill-1');
    const { deprecatedSkills } = antipatterns(bench.events());
    expect(deprecatedSkills.map((f) => f.entityId)).toEqual(['skill-1']);
    expect(deprecatedSkills[0]?.evidence[0]?.kind).toBe('skill.transitioned');
  });

  it('emits no verdict — the shape is count + evidence only, never a grade', () => {
    // The line the layer holds: it POINTS, it does not JUDGE. The finding shape
    // has exactly three fields (entityId, count, evidence) — no "severity",
    // "problem", "bad", "excessive". This pins that no valued field slips in.
    bench = makeBench();
    reopenTimes(bench, 'task-x', 2);
    const finding = antipatterns(bench.events()).reopenedTasks[0];
    expect(finding && Object.keys(finding).sort()).toEqual(['count', 'entityId', 'evidence']);
  });

  it('is all-empty for a stream with no such shapes', () => {
    bench = makeBench();
    birthTask(bench, 't', 'plain');
    expect(antipatterns(bench.events())).toEqual({
      reopenedTasks: [],
      supersededDecisions: [],
      deprecatedSkills: [],
      skillCandidates: [],
    });
  });
});
