import { describe, expect, it } from 'vitest';

import type { Workflow } from '@/domain/state-machine/state-machine.js';
import type { SprintService } from '@/services/backlog/sprint-service.js';
import type { TaskService } from '@/services/backlog/task-service.js';
import type { AuditQuery } from '@/services/integrity/audit-query.js';
import type { SkillQualityService } from '@/services/knowledge/skill-quality-service.js';
import { EvalReportService } from '@/services/metrics/eval-report-service.js';
import { FlowMetricsService } from '@/services/metrics/flow-metrics-service.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

const HOUR = 3_600_000;
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const at = (h: number): string => new Date(BASE + h * HOUR).toISOString();

function runStarted(run: string, h: number): AuditEvent {
  return { v: 2, at: at(h), kind: 'run_started', actor: 'a', run, data: { goal: 'x' } };
}
function runStartedBootstrapped(run: string, h: number): AuditEvent {
  return {
    v: 2,
    at: at(h),
    kind: 'run_started',
    actor: 'a',
    run,
    data: { goal: 'x', bootstrapped: true },
  };
}
function created(id: string, h: number, run: string): AuditEvent {
  return { v: 2, at: at(h), kind: 'task_created', actor: 'a', run, data: { id, state: 'DRAFT' } };
}
function transitioned(
  id: string,
  h: number,
  from: string,
  to: string,
  action: string,
  run: string,
): AuditEvent {
  return {
    v: 2,
    at: at(h),
    kind: 'task_transitioned',
    actor: 'a',
    run,
    data: { id, from, to, action },
  };
}
function skillUsed(slug: string, h: number, run: string): AuditEvent {
  return { v: 2, at: at(h), kind: 'skill_used', actor: 'a', run, data: { slug } };
}

const workflow = {
  initial: 'DRAFT',
  terminal: ['DONE'],
} as unknown as Workflow;

function fakeAudit(events: AuditEvent[]): AuditQuery {
  return {
    run: (filter: { since?: string } = {}) => {
      if (filter.since === undefined) return events;
      const cut = Date.parse(filter.since);
      return events.filter((e) => Date.parse(e.at) >= cut);
    },
  } as unknown as AuditQuery;
}
const noSprints = { list: () => [] } as unknown as SprintService;
const noTasks = { list: () => [] } as unknown as TaskService;

function makeEval(events: AuditEvent[], flaggedCount = 0): EvalReportService {
  const audit = fakeAudit(events);
  const flow = new FlowMetricsService(audit, noTasks, workflow, noSprints, 'TEST');
  const quality = {
    flaggedForReview: () => new Set(Array.from({ length: flaggedCount }, (_, i) => `s${i}`)),
  } as unknown as SkillQualityService;
  return new EvalReportService(audit, flow, quality, workflow);
}

describe('EvalReportService', () => {
  it('partitions runs by the skill-use proxy and diffs reopen rate per cohort', () => {
    // Guided run G: used a skill; its task went to DONE and stayed clean.
    // Unguided run U: no skill; its task went to DONE then reopened.
    const events: AuditEvent[] = [
      // guided
      runStarted('G', 0),
      skillUsed('deploy', 0.1, 'G'),
      created('T1', 0.2, 'G'),
      transitioned('T1', 1, 'DRAFT', 'IN_PROGRESS', 'start', 'G'),
      transitioned('T1', 2, 'IN_PROGRESS', 'DONE', 'complete', 'G'),
      // unguided
      runStarted('U', 3),
      created('T2', 3.2, 'U'),
      transitioned('T2', 4, 'DRAFT', 'IN_PROGRESS', 'start', 'U'),
      transitioned('T2', 5, 'IN_PROGRESS', 'DONE', 'complete', 'U'),
      transitioned('T2', 6, 'DONE', 'IN_PROGRESS', 'reopen', 'U'),
    ];
    const report = makeEval(events, 2).compute();

    // One run in each cohort.
    expect(report.guided.runs).toBe(1);
    expect(report.unguided.runs).toBe(1);

    // Guided task stayed clean; unguided task reopened.
    expect(report.guided.metrics.reopen.completed_tasks).toBe(1);
    expect(report.guided.metrics.reopen.rate).toBe(0);
    expect(report.unguided.metrics.reopen.completed_tasks).toBe(1);
    expect(report.unguided.metrics.reopen.rate).toBe(1);

    // Quality signal passes through.
    expect(report.skills_flagged_for_review).toBe(2);

    // The honesty surface is always present.
    expect(report.proxy).toContain('skill_used');
    expect(report.caveat).toContain('CORRELATIONAL');
  });

  it('counts a bootstrap-only run (no skill_used) as guided under the default proxy', () => {
    // The core MNEMA-263 case: a solo run that bootstrapped but used no
    // recorded skill. Its run_started carries data.bootstrapped, so the
    // default `either` proxy puts it in the guided cohort.
    const events: AuditEvent[] = [
      runStartedBootstrapped('G', 0),
      created('T1', 0.2, 'G'),
      transitioned('T1', 1, 'DRAFT', 'IN_PROGRESS', 'start', 'G'),
      transitioned('T1', 2, 'IN_PROGRESS', 'DONE', 'complete', 'G'),
      runStarted('U', 3),
      created('T2', 3.2, 'U'),
      transitioned('T2', 4, 'DRAFT', 'IN_PROGRESS', 'start', 'U'),
      transitioned('T2', 5, 'IN_PROGRESS', 'DONE', 'complete', 'U'),
    ];
    const report = makeEval(events).compute(); // default proxy = either
    expect(report.guided.runs).toBe(1);
    expect(report.unguided.runs).toBe(1);
    expect(report.guided.metrics.reopen.completed_tasks).toBe(1);
  });

  it('proxy=skill_used ignores a bootstrap flag; proxy=bootstrap counts it', () => {
    const events: AuditEvent[] = [
      runStartedBootstrapped('G', 0),
      created('T1', 0.2, 'G'),
      transitioned('T1', 1, 'DRAFT', 'IN_PROGRESS', 'start', 'G'),
      transitioned('T1', 2, 'IN_PROGRESS', 'DONE', 'complete', 'G'),
    ];
    // skill_used proxy: no skill event → the run is NOT guided, and the proxy
    // text describes skill use as the signal (the run_started flag is ignored).
    const skillOnly = makeEval(events).compute({ proxy: 'skill_used' });
    expect(skillOnly.guided.runs).toBe(0);
    expect(skillOnly.unguided.runs).toBe(1);
    expect(skillOnly.proxy).toContain('used a recorded skill');
    expect(skillOnly.proxy).not.toContain('was opened after');

    // bootstrap proxy: the flag alone makes it guided; the text names it.
    const bootOnly = makeEval(events).compute({ proxy: 'bootstrap' });
    expect(bootOnly.guided.runs).toBe(1);
    expect(bootOnly.unguided.runs).toBe(0);
    expect(bootOnly.proxy).toContain('was opened after');
  });

  it('keeps a task that spans cohorts in one cohort (the run that completed it)', () => {
    // The regression: T1 is created + completed in a GUIDED run G, then
    // reopened in a later UNGUIDED run U. Splitting by each event's own run
    // would replay T1's timeline in BOTH cohorts — counting it completed twice
    // and blaming the reopen on the unguided cohort that merely ran the reopen.
    // T1's owner is G (its first terminal transition), so the whole task —
    // reopen included — belongs to the guided cohort only.
    const events: AuditEvent[] = [
      runStarted('G', 0),
      skillUsed('deploy', 0.1, 'G'),
      created('T1', 0.2, 'G'),
      transitioned('T1', 1, 'DRAFT', 'IN_PROGRESS', 'start', 'G'),
      transitioned('T1', 2, 'IN_PROGRESS', 'DONE', 'complete', 'G'),
      // Later, an unguided run reopens the same task.
      runStarted('U', 10),
      transitioned('T1', 11, 'DONE', 'IN_PROGRESS', 'reopen', 'U'),
    ];
    const report = makeEval(events).compute();

    // The reopen run is unguided (it used no skill) so runs split 1/1.
    expect(report.guided.runs).toBe(1);
    expect(report.unguided.runs).toBe(1);

    // T1 is counted exactly once, in the guided cohort, and its reopen is
    // attributed there — NOT double-counted, NOT pinned on the unguided run.
    expect(report.guided.metrics.reopen.completed_tasks).toBe(1);
    expect(report.guided.metrics.reopen.reopened_tasks).toBe(1);
    expect(report.guided.metrics.reopen.rate).toBe(1);
    expect(report.unguided.metrics.reopen.completed_tasks).toBe(0);
    expect(report.unguided.metrics.reopen.reopened_tasks).toBe(0);
    expect(report.unguided.metrics.throughput).toBe(0);
  });

  it('backlog-first: a task created in a planning run belongs to the guided run that completed it', () => {
    // The audited inversion: tasks are created up-front in an unguided
    // planning run P, then EXECUTED in a guided run A. Owning by the creating
    // run routed the completion (and any reopen) to P's unguided cohort —
    // guided showed done=0 even though the guided run did all the work. The
    // owner must be the run of the first terminal transition.
    const events: AuditEvent[] = [
      // Planning run: creates the backlog, uses no skill.
      runStarted('P', 0),
      created('T1', 0.1, 'P'),
      // Guided run A executes T1 to DONE.
      runStarted('A', 5),
      skillUsed('deploy', 5.1, 'A'),
      transitioned('T1', 6, 'DRAFT', 'IN_PROGRESS', 'start', 'A'),
      transitioned('T1', 7, 'IN_PROGRESS', 'DONE', 'complete', 'A'),
      // A later unguided run reopens it — still owned by A (first terminal).
      runStarted('U', 10),
      transitioned('T1', 11, 'DONE', 'IN_PROGRESS', 'reopen', 'U'),
    ];
    const report = makeEval(events).compute();

    expect(report.guided.runs).toBe(1); // A
    expect(report.unguided.runs).toBe(2); // P and U

    // The completion AND the reopen land on the guided cohort that did the
    // work — not on the planning run's cohort.
    expect(report.guided.metrics.reopen.completed_tasks).toBe(1);
    expect(report.guided.metrics.reopen.reopened_tasks).toBe(1);
    expect(report.unguided.metrics.reopen.completed_tasks).toBe(0);
    expect(report.unguided.metrics.reopen.reopened_tasks).toBe(0);
  });

  it('puts a run with no skill_used entirely in the unguided cohort', () => {
    const events: AuditEvent[] = [
      runStarted('U', 0),
      created('T1', 0.2, 'U'),
      transitioned('T1', 1, 'DRAFT', 'IN_PROGRESS', 'start', 'U'),
      transitioned('T1', 2, 'IN_PROGRESS', 'DONE', 'complete', 'U'),
    ];
    const report = makeEval(events).compute();
    expect(report.guided.runs).toBe(0);
    expect(report.unguided.runs).toBe(1);
    expect(report.guided.metrics.reopen.completed_tasks).toBe(0);
    expect(report.unguided.metrics.reopen.completed_tasks).toBe(1);
  });

  it('honours the since window', () => {
    const events: AuditEvent[] = [
      runStarted('OLD', 0),
      skillUsed('deploy', 0.1, 'OLD'),
      created('T1', 0.2, 'OLD'),
      transitioned('T1', 1, 'DRAFT', 'IN_PROGRESS', 'start', 'OLD'),
      transitioned('T1', 2, 'IN_PROGRESS', 'DONE', 'complete', 'OLD'),
      // recent, unguided
      runStarted('NEW', 100),
      created('T2', 100.2, 'NEW'),
      transitioned('T2', 101, 'DRAFT', 'IN_PROGRESS', 'start', 'NEW'),
      transitioned('T2', 102, 'IN_PROGRESS', 'DONE', 'complete', 'NEW'),
    ];
    const report = makeEval(events).compute({ since: at(50) });
    // Only the NEW (unguided) run falls in the window.
    expect(report.guided.runs).toBe(0);
    expect(report.unguided.runs).toBe(1);
  });
});
