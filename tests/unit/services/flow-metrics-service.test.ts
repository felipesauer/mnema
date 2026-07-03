import { describe, expect, it } from 'vitest';

import type { Workflow } from '@/domain/state-machine/state-machine.js';
import type { AuditQuery } from '@/services/audit-query.js';
import { FlowMetricsService } from '@/services/flow-metrics-service.js';
import type { SprintService } from '@/services/sprint-service.js';
import type { TaskService } from '@/services/task-service.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

const HOUR = 3_600_000;
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const at = (hoursFromBase: number): string => new Date(BASE + hoursFromBase * HOUR).toISOString();

function created(key: string, hours: number, run?: string): AuditEvent {
  return {
    v: 2,
    at: at(hours),
    kind: 'task_created',
    actor: 'a',
    ...(run !== undefined ? { run } : {}),
    data: { key, state: 'DRAFT' },
  };
}

function transitioned(
  key: string,
  hours: number,
  from: string,
  to: string,
  action: string,
  run?: string,
): AuditEvent {
  return {
    v: 2,
    at: at(hours),
    kind: 'task_transitioned',
    actor: 'a',
    ...(run !== undefined ? { run } : {}),
    data: { key, from, to, action },
  };
}

function runStarted(run: string, hours: number): AuditEvent {
  return { v: 2, at: at(hours), kind: 'run_started', actor: 'a', run, data: { goal: 'x' } };
}
function runEnded(run: string, hours: number): AuditEvent {
  return { v: 2, at: at(hours), kind: 'run_ended', actor: 'a', run, data: { status: 'completed' } };
}
function skillRecorded(slug: string, hours: number): AuditEvent {
  return { v: 2, at: at(hours), kind: 'skill_recorded', actor: 'a', data: { slug } };
}
function skillUsed(slug: string, hours: number): AuditEvent {
  return { v: 2, at: at(hours), kind: 'skill_used', actor: 'a', data: { slug } };
}

/** Minimal default-like workflow: DRAFT initial, DONE/CANCELED terminal. */
const workflow = {
  states: ['DRAFT', 'READY', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED'],
  initial: 'DRAFT',
  terminal: ['DONE', 'CANCELED'],
} as unknown as Workflow;

function fakeAudit(events: AuditEvent[]): AuditQuery {
  return {
    run: (filter: { since?: string } = {}) => {
      if (filter.since === undefined) return events;
      const sinceMs = Date.parse(filter.since);
      return events.filter((e) => Date.parse(e.at) >= sinceMs);
    },
  } as unknown as AuditQuery;
}

interface TaskRow {
  key: string;
  estimate: number | null;
  sprintId: string | null;
}

/** Fake TaskService.list() with estimates and optional sprint membership. */
function fakeTasks(rows: Record<string, number | null> | TaskRow[]): TaskService {
  const list: TaskRow[] = Array.isArray(rows)
    ? rows
    : Object.entries(rows).map(([key, estimate]) => ({ key, estimate, sprintId: null }));
  return { list: () => list } as unknown as TaskService;
}

/** Fake SprintService.list() returning sprints in creation order. */
function fakeSprints(sprints: { id: string; key: string; name: string }[] = []): SprintService {
  return { list: () => sprints } as unknown as SprintService;
}

function makeService(
  events: AuditEvent[],
  tasks: TaskService,
  sprints: SprintService = fakeSprints(),
): FlowMetricsService {
  return new FlowMetricsService(fakeAudit(events), tasks, workflow, sprints, 'TEST');
}

describe('FlowMetricsService', () => {
  it('computes lead time, cycle time, throughput and reopen rate from the log', () => {
    const events: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 2, 'DRAFT', 'READY', 'submit'),
      transitioned('NOTA-1', 10, 'IN_REVIEW', 'DONE', 'approve'),
      created('NOTA-2', 0),
      transitioned('NOTA-2', 1, 'DRAFT', 'READY', 'submit'),
      transitioned('NOTA-2', 5, 'IN_REVIEW', 'DONE', 'approve'),
      transitioned('NOTA-2', 6, 'DONE', 'IN_PROGRESS', 'reopen'),
      transitioned('NOTA-2', 9, 'IN_REVIEW', 'DONE', 'approve'),
      created('NOTA-3', 0),
      transitioned('NOTA-3', 1, 'DRAFT', 'READY', 'submit'),
    ];
    const m = makeService(events, fakeTasks({ 'NOTA-1': 8, 'NOTA-2': 2, 'NOTA-3': 5 })).compute();

    expect(m.throughput).toBe(2);
    expect(m.lead_time.count).toBe(2);
    expect(m.lead_time.median_hours).toBe(7.5);
    expect(m.lead_time.max_hours).toBe(10);
    expect(m.cycle_time.median_hours).toBe(6);
    expect(m.reopen.completed_tasks).toBe(2);
    expect(m.reopen.reopened_tasks).toBe(1);
    expect(m.reopen.rate).toBe(0.5);
  });

  it('joins estimate with summed RUN DURATION when run data exists', () => {
    // NOTA-1 touched by run R1 (start@1, end@4 → 3h) and R2 (start@5, end@6 → 1h) = 4h actual.
    const events: AuditEvent[] = [
      runStarted('R1', 1),
      created('NOTA-1', 0, 'R1'),
      transitioned('NOTA-1', 2, 'DRAFT', 'READY', 'submit', 'R1'),
      runEnded('R1', 4),
      runStarted('R2', 5),
      transitioned('NOTA-1', 6, 'IN_REVIEW', 'DONE', 'approve', 'R2'),
      runEnded('R2', 6),
    ];
    const m = makeService(events, fakeTasks({ 'NOTA-1': 2 })).compute();

    expect(m.estimate_vs_actual.samples).toHaveLength(1);
    const s = m.estimate_vs_actual.samples[0];
    expect(s?.actual_source).toBe('run_duration');
    expect(s?.actual_hours).toBe(4); // 3h + 1h
    expect(m.estimate_vs_actual.run_duration_samples).toBe(1);
    expect(m.estimate_vs_actual.lead_time_fallback_samples).toBe(0);
    expect(m.estimate_vs_actual.hours_per_point).toBe(2); // 4h / 2 pts
  });

  it('falls back to lead time (flagged) when a done task has no run data', () => {
    const events: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 10, 'IN_REVIEW', 'DONE', 'approve'),
    ];
    const m = makeService(events, fakeTasks({ 'NOTA-1': 5 })).compute();
    const s = m.estimate_vs_actual.samples[0];
    expect(s?.actual_source).toBe('lead_time');
    expect(s?.actual_hours).toBe(10);
    expect(m.estimate_vs_actual.lead_time_fallback_samples).toBe(1);
    expect(m.estimate_vs_actual.run_duration_samples).toBe(0);
  });

  it('reports velocity (completed points) per sprint, newest first', () => {
    const events: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 5, 'IN_REVIEW', 'DONE', 'approve'),
      created('NOTA-2', 0),
      transitioned('NOTA-2', 6, 'IN_REVIEW', 'DONE', 'approve'),
      created('NOTA-3', 0), // in sprint S1 but NOT done → excluded from velocity
    ];
    const tasks = fakeTasks([
      { key: 'NOTA-1', estimate: 3, sprintId: 'S1' },
      { key: 'NOTA-2', estimate: 5, sprintId: 'S2' },
      { key: 'NOTA-3', estimate: 8, sprintId: 'S1' },
    ]);
    const sprints = fakeSprints([
      { id: 'S1', key: 'TEST-SPRINT-1', name: 'Sprint One' },
      { id: 'S2', key: 'TEST-SPRINT-2', name: 'Sprint Two' },
    ]);
    const m = makeService(events, tasks, sprints).compute();

    // Newest first → S2 then S1. NOTA-3 (not done) excluded from S1's points.
    expect(m.velocity).toEqual([
      {
        sprint_key: 'TEST-SPRINT-2',
        sprint_name: 'Sprint Two',
        completed_points: 5,
        completed_tasks: 1,
      },
      {
        sprint_key: 'TEST-SPRINT-1',
        sprint_name: 'Sprint One',
        completed_points: 3,
        completed_tasks: 1,
      },
    ]);
  });

  it('returns empty velocity when no sprint has completed tasks', () => {
    const events: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 5, 'IN_REVIEW', 'DONE', 'approve'),
    ];
    // Task has no sprint; one sprint exists but owns no completed task.
    const m = makeService(
      events,
      fakeTasks([{ key: 'NOTA-1', estimate: 3, sprintId: null }]),
      fakeSprints([{ id: 'S1', key: 'TEST-SPRINT-1', name: 'Empty' }]),
    ).compute();
    expect(m.velocity).toEqual([]);
  });

  it('excludes tasks without a positive estimate from estimate-vs-actual', () => {
    const events: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 4, 'IN_REVIEW', 'DONE', 'approve'),
    ];
    const m = makeService(events, fakeTasks({ 'NOTA-1': null })).compute();
    expect(m.throughput).toBe(1);
    expect(m.estimate_vs_actual.samples).toHaveLength(0);
    expect(m.estimate_vs_actual.hours_per_point).toBeNull();
  });

  it('honours the since filter', () => {
    const events: AuditEvent[] = [
      created('OLD-1', 0),
      transitioned('OLD-1', 1, 'IN_REVIEW', 'DONE', 'approve'),
      created('NEW-1', 100),
      transitioned('NEW-1', 101, 'IN_REVIEW', 'DONE', 'approve'),
    ];
    const m = makeService(events, fakeTasks({})).compute({ since: at(50) });
    expect(m.throughput).toBe(1);
  });

  it('returns empty summaries when the log has no terminal tasks', () => {
    const events: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 1, 'DRAFT', 'READY', 'submit'),
    ];
    const m = makeService(events, fakeTasks({ 'NOTA-1': 3 })).compute();
    expect(m.throughput).toBe(0);
    expect(m.lead_time.count).toBe(0);
    expect(m.lead_time.median_hours).toBeNull();
    expect(m.reopen.rate).toBe(0);
    expect(m.velocity).toEqual([]);
  });

  it('reports skill adoption (uses per run and used-vs-recorded ratio)', () => {
    // 2 runs; 4 skills recorded, 1 used — the "captured but not reused" shape.
    const events: AuditEvent[] = [
      runStarted('r1', 0),
      skillRecorded('add-tool', 1),
      skillRecorded('add-migration', 2),
      runEnded('r1', 3),
      runStarted('r2', 4),
      skillRecorded('plan-sprint', 5),
      skillRecorded('review-flow', 6),
      skillUsed('add-tool', 7),
      runEnded('r2', 8),
    ];
    const m = makeService(events, fakeTasks({})).compute();
    expect(m.skill_adoption.recorded).toBe(4);
    expect(m.skill_adoption.used).toBe(1);
    expect(m.skill_adoption.uses_per_run).toBe(0.5); // 1 use / 2 runs
    expect(m.skill_adoption.used_vs_recorded).toBe(0.25); // 1 / 4
  });

  it('skill adoption is null-safe when there is no activity', () => {
    const m = makeService([], fakeTasks({})).compute();
    expect(m.skill_adoption.recorded).toBe(0);
    expect(m.skill_adoption.used).toBe(0);
    expect(m.skill_adoption.uses_per_run).toBeNull(); // no runs
    expect(m.skill_adoption.used_vs_recorded).toBeNull(); // nothing recorded
  });

  describe('compute({ events }) reuses a pre-read log (single-read on the metrics path)', () => {
    // A counting AuditQuery so we can assert how many times the log is read.
    function countingAudit(events: AuditEvent[]): { audit: AuditQuery; reads: () => number } {
      let reads = 0;
      const audit = {
        run: () => {
          reads += 1;
          return events;
        },
      } as unknown as AuditQuery;
      return { audit, reads: () => reads };
    }

    const sampleEvents: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 2, 'DRAFT', 'READY', 'submit'),
      transitioned('NOTA-1', 5, 'READY', 'DONE', 'approve'),
    ];

    it('does not read the audit log when events are supplied', () => {
      const { audit, reads } = countingAudit(sampleEvents);
      const svc = new FlowMetricsService(
        audit,
        fakeTasks({ 'NOTA-1': 3 }),
        workflow,
        fakeSprints(),
        'TEST',
      );
      svc.compute({ events: sampleEvents });
      expect(reads()).toBe(0); // the caller's read is reused; no second read
    });

    it('reads once when events are omitted (standalone still works)', () => {
      const { audit, reads } = countingAudit(sampleEvents);
      const svc = new FlowMetricsService(
        audit,
        fakeTasks({ 'NOTA-1': 3 }),
        workflow,
        fakeSprints(),
        'TEST',
      );
      svc.compute();
      expect(reads()).toBe(1);
    });

    it('produces identical metrics whether events are passed or read', () => {
      const passed = makeService(sampleEvents, fakeTasks({ 'NOTA-1': 3 })).compute({
        events: sampleEvents,
      });
      const read = makeService(sampleEvents, fakeTasks({ 'NOTA-1': 3 })).compute();
      expect(passed).toEqual(read);
    });
  });
});
