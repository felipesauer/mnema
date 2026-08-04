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
import { antipatterns, antipatternsByProject } from './antipatterns.js';

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
    birthDecision(bench, 'dec-old', 'old', 'accepted');
    birthDecision(bench, 'dec-new', 'new', 'accepted');
    supersedeDecision(bench, 'dec-old', 'dec-new');
    const { supersededDecisions } = antipatterns(bench.events());
    expect(supersededDecisions).toHaveLength(1);
    expect(supersededDecisions[0]?.entityId).toBe('dec-old');
    expect(supersededDecisions[0]?.count).toBe(1);
    expect(supersededDecisions[0]?.evidence[0]?.kind).toBe('decision.transitioned');
  });

  it('detects a deprecated skill with its deprecate event', () => {
    bench = makeBench();
    birthSkill(bench, 'skill-1', 'a pattern', 'adopted');
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

describe('antipatterns — one record at a time, never added together', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('keeps each record’s shapes under its own project, and lists a quiet one empty', () => {
    // Everything this read returns is a count with its evidence, so merging would answer
    // "how much churn is in this workspace" under the name of "how much is in this
    // record". The skill candidates are the sharpest case: a pattern is distilled by
    // whoever is doing the work that kept reopening.
    bench = makeBench();
    reopenTimes(bench, 'task-here', 2);
    const churn = bench.events();

    const shapes = antipatternsByProject([
      { project: '/w/alpha', events: churn },
      { project: '/w/beta', events: [] },
      { events: [] },
    ]);

    expect(shapes.byProject.map((entry) => entry.project)).toEqual([
      '/w/alpha',
      '/w/beta',
      undefined,
    ]);
    const here = shapes.byProject[0];
    expect(here?.reopenedTasks.map((f) => f.count)).toEqual([2]);
    expect(here?.skillCandidates.map((f) => f.entityId)).toEqual(['task-here']);
    // A record with nothing recurring is HERE with four empty lists — absent, it would
    // be indistinguishable from a record the read never opened.
    expect(shapes.byProject[1]?.reopenedTasks).toEqual([]);
    expect(shapes.byProject[1]?.skillCandidates).toEqual([]);
    // And no merged set of shapes beside the entries.
    expect('reopenedTasks' in shapes).toBe(false);
  });

  it('counts each record on its own — the same churn twice is two entries, not one sum', () => {
    bench = makeBench();
    reopenTimes(bench, 'task-shared', 2);
    const churn = bench.events();

    const shapes = antipatternsByProject([
      { project: '/w/alpha', events: churn },
      { project: '/w/beta', events: churn },
    ]);

    // Two entries of 2, never one of 4 — the arithmetic each project's own session saw.
    expect(shapes.byProject.map((entry) => entry.reopenedTasks[0]?.count)).toEqual([2, 2]);
  });

  it('reads an empty workspace without complaint', () => {
    expect(antipatternsByProject([])).toEqual({ byProject: [] });
  });
});
