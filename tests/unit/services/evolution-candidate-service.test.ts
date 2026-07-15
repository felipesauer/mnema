import { describe, expect, it } from 'vitest';

import type { Workflow } from '@/domain/state-machine/state-machine.js';
import { EvolutionCandidateService } from '@/services/evolution-candidate-service.js';
import type { ObservationService } from '@/services/knowledge/observation-service.js';
import type {
  SkillQualityService,
  SkillReviewProposal,
} from '@/services/knowledge/skill-quality-service.js';
import type { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import type { TransitionRepository } from '@/storage/sqlite/repositories/transition-repository.js';

function proposal(over: Partial<SkillReviewProposal>): SkillReviewProposal {
  return {
    slug: 'deploy',
    taskKey: 'TEST-1',
    runId: 'run-1',
    reopenCount: 1,
    reopenReason: null,
    ...over,
  };
}

function fakeSkillQuality(proposals: SkillReviewProposal[]): SkillQualityService {
  return { reviewProposals: () => proposals } as unknown as SkillQualityService;
}

interface FakeObs {
  relatedTaskId: string | null;
  topics: string[];
}
function fakeObservations(rows: FakeObs[]): ObservationService {
  return { list: () => rows } as unknown as ObservationService;
}

/** Task rows keyed by id; each carries a key and reopenCount. */
function fakeTasks(byId: Record<string, { key: string; reopenCount: number }>): TaskRepository {
  return {
    findById: (id: string) => (byId[id] ? { ...byId[id], id } : null),
  } as unknown as TaskRepository;
}

const noObs = fakeObservations([]);
const noTasks = fakeTasks({});

interface FakeTransition {
  taskKey: string;
  payload: Record<string, unknown>;
}
/** A transition repo whose findByAction returns a fixed list per action. */
function fakeTransitions(byAction: Record<string, FakeTransition[]>): TransitionRepository {
  return {
    findByAction: (action: string) => (byAction[action] ?? []).map((t) => ({ ...t, action })),
  } as unknown as TransitionRepository;
}
/** A workflow that declares the given actions (from a single state). */
function fakeWorkflow(actions: string[]): Workflow {
  const byAction: Record<string, unknown> = {};
  for (const a of actions) byAction[a] = { to: 'X' };
  return { transitions: { ANY: byAction } } as unknown as Workflow;
}

describe('EvolutionCandidateService', () => {
  it('ranks skills by the count of distinct reopened tasks their runs touched', () => {
    const svc = new EvolutionCandidateService(
      fakeSkillQuality([
        proposal({ slug: 'risky', taskKey: 'TEST-1' }),
        proposal({ slug: 'risky', taskKey: 'TEST-2' }),
        proposal({ slug: 'risky', taskKey: 'TEST-1' }), // dup pair → not double-counted
        proposal({ slug: 'safe', taskKey: 'TEST-3' }),
      ]),
      noObs,
      noTasks,
    );
    const report = svc.compute();

    expect(report.skills).toHaveLength(2);
    const risky = report.skills[0];
    expect(risky?.slug).toBe('risky'); // 2 distinct tasks → ranked first
    expect(risky?.reworkCount).toBe(2);
    expect(risky?.tasks).toEqual(['TEST-1', 'TEST-2']);
    expect(report.skills[1]?.slug).toBe('safe');
    expect(report.skills[1]?.reworkCount).toBe(1);
  });

  it('aggregates recurring reopen reasons, skipping proposals with no reason', () => {
    const svc = new EvolutionCandidateService(
      fakeSkillQuality([
        proposal({ taskKey: 'TEST-1', reopenReason: 'auth regression' }),
        proposal({ taskKey: 'TEST-2', reopenReason: 'auth regression' }),
        proposal({ taskKey: 'TEST-3', reopenReason: 'flaky test' }),
        proposal({ taskKey: 'TEST-4', reopenReason: null }), // no reason → skipped
        proposal({ taskKey: 'TEST-5', reopenReason: '   ' }), // blank → skipped
      ]),
      noObs,
      noTasks,
    );
    const report = svc.compute();

    expect(report.reopen_reasons).toHaveLength(2);
    expect(report.reopen_reasons[0]).toEqual({
      reason: 'auth regression',
      count: 2,
      tasks: ['TEST-1', 'TEST-2'],
    });
    expect(report.reopen_reasons[1]?.reason).toBe('flaky test');
    expect(report.reopen_reasons[1]?.count).toBe(1);
  });

  it('aggregates observation topics only for tasks that have since been reopened', () => {
    const svc = new EvolutionCandidateService(
      fakeSkillQuality([]),
      fakeObservations([
        { relatedTaskId: 'id-1', topics: ['auth', 'perf'] },
        { relatedTaskId: 'id-2', topics: ['auth'] },
        { relatedTaskId: 'id-3', topics: ['auth'] }, // task not reopened → excluded
        { relatedTaskId: null, topics: ['auth'] }, // no task → excluded
      ]),
      fakeTasks({
        'id-1': { key: 'TEST-1', reopenCount: 1 },
        'id-2': { key: 'TEST-2', reopenCount: 2 },
        'id-3': { key: 'TEST-3', reopenCount: 0 }, // clean
      }),
    );
    const report = svc.compute();

    // 'auth' recurs on the two reopened tasks; 'perf' on one.
    expect(report.observation_topics[0]).toEqual({
      topic: 'auth',
      count: 2,
      tasks: ['TEST-1', 'TEST-2'],
    });
    expect(report.observation_topics.find((t) => t.topic === 'perf')).toEqual({
      topic: 'perf',
      count: 1,
      tasks: ['TEST-1'],
    });
  });

  it('is empty and caveated when nothing correlates', () => {
    const svc = new EvolutionCandidateService(fakeSkillQuality([]), noObs, noTasks);
    const report = svc.compute();
    expect(report.skills).toEqual([]);
    expect(report.reopen_reasons).toEqual([]);
    expect(report.observation_topics).toEqual([]);
    expect(report.request_changes_reasons).toEqual([]);
    expect(report.canceled_reasons).toEqual([]);
    expect(report.recurring_topics).toEqual([]);
    expect(report.caveat).toContain('NOT A VERDICT');
  });

  it('the reopen-independent sections are empty without a transition repo / workflow (back-compat)', () => {
    // Existing 3-arg construction: the reopen-gated rankings work, the new
    // sections are absent (empty), so old callers see no behaviour change.
    const svc = new EvolutionCandidateService(fakeSkillQuality([]), noObs, noTasks);
    const report = svc.compute();
    expect(report.request_changes_reasons).toEqual([]);
    expect(report.canceled_reasons).toEqual([]);
  });

  it('ACCEPTANCE: a zero-reopen project still yields signal from request_changes, cancels and recurring topics', () => {
    // No proposals (no reopens at all) — the reopen-gated rankings are empty.
    const obs = fakeObservations([
      { relatedTaskId: 't1', topics: ['auth'] },
      { relatedTaskId: 't2', topics: ['auth'] },
      { relatedTaskId: 't3', topics: ['auth', 'perf'] }, // auth on 3 tasks → meets the min
      { relatedTaskId: 't4', topics: ['perf'] }, // perf on 2 tasks → below the min-3
    ]);
    const tasks = fakeTasks({
      t1: { key: 'TEST-1', reopenCount: 0 },
      t2: { key: 'TEST-2', reopenCount: 0 },
      t3: { key: 'TEST-3', reopenCount: 0 },
      t4: { key: 'TEST-4', reopenCount: 0 },
    });
    const transitions = fakeTransitions({
      request_changes: [
        { taskKey: 'TEST-1', payload: { feedback: 'missing tests' } },
        { taskKey: 'TEST-2', payload: { feedback: 'missing tests' } },
        { taskKey: 'TEST-3', payload: { feedback: 'naming' } },
        { taskKey: 'TEST-9', payload: {} }, // no feedback → skipped
      ],
      cancel: [
        { taskKey: 'TEST-5', payload: { reason: 'duplicate' } },
        { taskKey: 'TEST-6', payload: { reason: 'duplicate' } },
      ],
    });
    const svc = new EvolutionCandidateService(
      fakeSkillQuality([]),
      obs,
      tasks,
      transitions,
      fakeWorkflow(['request_changes', 'cancel']),
    );
    const report = svc.compute();

    // Reopen-gated rankings are empty (zero reopens)…
    expect(report.skills).toEqual([]);
    expect(report.reopen_reasons).toEqual([]);
    expect(report.observation_topics).toEqual([]);

    // …but the reopen-independent signals carry the report.
    expect(report.request_changes_reasons[0]).toEqual({
      reason: 'missing tests',
      count: 2,
      tasks: ['TEST-1', 'TEST-2'],
    });
    expect(report.canceled_reasons[0]).toEqual({
      reason: 'duplicate',
      count: 2,
      tasks: ['TEST-5', 'TEST-6'],
    });
    // Recurring topics across ALL tasks, min 3 distinct tasks: auth qualifies (3), perf does not (2).
    expect(report.recurring_topics).toHaveLength(1);
    expect(report.recurring_topics[0]).toMatchObject({ topic: 'auth', count: 3 });
    expect(report.caveat).toContain('WEAKER');
  });

  it('request_changes is workflow-gated: no such action → that section stays empty', () => {
    const transitions = fakeTransitions({
      request_changes: [{ taskKey: 'TEST-1', payload: { feedback: 'x' } }],
    });
    const svc = new EvolutionCandidateService(
      fakeSkillQuality([]),
      noObs,
      noTasks,
      transitions,
      fakeWorkflow(['cancel']), // request_changes NOT declared
    );
    expect(svc.compute().request_changes_reasons).toEqual([]);
  });
});
