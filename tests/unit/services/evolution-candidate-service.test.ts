import { describe, expect, it } from 'vitest';

import { EvolutionCandidateService } from '@/services/evolution-candidate-service.js';
import type { ObservationService } from '@/services/observation-service.js';
import type { SkillQualityService, SkillReviewProposal } from '@/services/skill-quality-service.js';
import type { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';

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
    expect(report.caveat).toContain('NOT A VERDICT');
  });
});
