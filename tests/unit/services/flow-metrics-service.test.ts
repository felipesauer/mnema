import { describe, expect, it } from 'vitest';

import type { Workflow } from '@/domain/state-machine/state-machine.js';
import type { AuditQuery } from '@/services/audit-query.js';
import { FlowMetricsService } from '@/services/flow-metrics-service.js';
import type { TaskService } from '@/services/task-service.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

const HOUR = 3_600_000;
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const at = (hoursFromBase: number): string => new Date(BASE + hoursFromBase * HOUR).toISOString();

function created(key: string, hours: number): AuditEvent {
  return { v: 2, at: at(hours), kind: 'task_created', actor: 'a', data: { key, state: 'DRAFT' } };
}

function transitioned(
  key: string,
  hours: number,
  from: string,
  to: string,
  action: string,
): AuditEvent {
  return {
    v: 2,
    at: at(hours),
    kind: 'task_transitioned',
    actor: 'a',
    data: { key, from, to, action },
  };
}

/** Minimal default-like workflow: DRAFT initial, DONE/CANCELED terminal. */
const workflow = {
  states: ['DRAFT', 'READY', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED'],
  initial: 'DRAFT',
  terminal: ['DONE', 'CANCELED'],
} as unknown as Workflow;

/** Fake AuditQuery returning a fixed event list (since-filter honoured). */
function fakeAudit(events: AuditEvent[]): AuditQuery {
  return {
    run: (filter: { since?: string } = {}) => {
      if (filter.since === undefined) return events;
      const sinceMs = Date.parse(filter.since);
      return events.filter((e) => Date.parse(e.at) >= sinceMs);
    },
  } as unknown as AuditQuery;
}

/** Fake TaskService exposing only list(), with the given estimates. */
function fakeTasks(estimates: Record<string, number | null>): TaskService {
  return {
    list: () => Object.entries(estimates).map(([key, estimate]) => ({ key, estimate })),
  } as unknown as TaskService;
}

describe('FlowMetricsService', () => {
  it('computes lead time, cycle time, throughput and reopen rate from the log', () => {
    // NOTA-1: created@0, leaves DRAFT@2 (cycle start), DONE@10 → lead 10h, cycle 8h.
    // NOTA-2: created@0, leaves DRAFT@1, DONE@5, reopened@6, DONE again@9
    //         → first terminal at 5h: lead 5h, cycle 4h; reopened=true.
    // NOTA-3: created@0, still IN_PROGRESS (never terminal) → excluded.
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
    const service = new FlowMetricsService(
      fakeAudit(events),
      fakeTasks({ 'NOTA-1': 8, 'NOTA-2': 2, 'NOTA-3': 5 }),
      workflow,
    );

    const m = service.compute();

    expect(m.throughput).toBe(2); // NOTA-1, NOTA-2
    // Lead times: 10h and 5h → median 7.5, max 10.
    expect(m.lead_time.count).toBe(2);
    expect(m.lead_time.median_hours).toBe(7.5);
    expect(m.lead_time.max_hours).toBe(10);
    // Cycle times: 8h (NOTA-1) and 4h (NOTA-2) → median 6.
    expect(m.cycle_time.median_hours).toBe(6);
    // One of two completed tasks was reopened → 0.5.
    expect(m.reopen.completed_tasks).toBe(2);
    expect(m.reopen.reopened_tasks).toBe(1);
    expect(m.reopen.rate).toBe(0.5);
  });

  it('joins estimate with realised lead time for done tasks', () => {
    const events: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 10, 'IN_REVIEW', 'DONE', 'approve'), // lead 10h, est 5 → 2h/pt
      created('NOTA-2', 0),
      transitioned('NOTA-2', 6, 'IN_REVIEW', 'DONE', 'approve'), // lead 6h, est 1 → joins
    ];
    const service = new FlowMetricsService(
      fakeAudit(events),
      // NOTA-2 has estimate 1; NOTA-1 estimate 5. Total 6 pts, 16h → 2.7h/pt.
      fakeTasks({ 'NOTA-1': 5, 'NOTA-2': 1 }),
      workflow,
    );

    const m = service.compute();
    expect(m.estimate_vs_actual.samples).toHaveLength(2);
    expect(m.estimate_vs_actual.hours_per_point).toBeCloseTo(16 / 6, 1);
  });

  it('excludes tasks without a positive estimate from estimate-vs-actual', () => {
    const events: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 4, 'IN_REVIEW', 'DONE', 'approve'),
    ];
    const service = new FlowMetricsService(
      fakeAudit(events),
      fakeTasks({ 'NOTA-1': null }),
      workflow,
    );
    const m = service.compute();
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
    const service = new FlowMetricsService(fakeAudit(events), fakeTasks({}), workflow);
    // Only events at/after hour 50 → just NEW-1's terminal transition.
    const m = service.compute({ since: at(50) });
    // NEW-1 has no created event in-window, so lead time has no sample,
    // but it still counts as throughput (reached terminal in-window).
    expect(m.throughput).toBe(1);
  });

  it('returns empty summaries when the log has no terminal tasks', () => {
    const events: AuditEvent[] = [
      created('NOTA-1', 0),
      transitioned('NOTA-1', 1, 'DRAFT', 'READY', 'submit'),
    ];
    const service = new FlowMetricsService(fakeAudit(events), fakeTasks({ 'NOTA-1': 3 }), workflow);
    const m = service.compute();
    expect(m.throughput).toBe(0);
    expect(m.lead_time.count).toBe(0);
    expect(m.lead_time.median_hours).toBeNull();
    expect(m.reopen.rate).toBe(0);
  });
});
