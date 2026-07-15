import { describe, expect, it } from 'vitest';

import { computeAdoptionMetrics } from '@/services/metrics/adoption-metrics.js';
import type { FlowMetrics } from '@/services/metrics/flow-metrics-service.js';
import type { CounterEntry } from '@/services/metrics/metrics-counter.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

function ev(at: string, kind: string, data: Record<string, unknown> = {}): AuditEvent {
  return { v: 2, at, kind, actor: 'a', data };
}

const flow = (over: Partial<FlowMetrics['skill_adoption']> = {}): FlowMetrics =>
  ({
    throughput: 0,
    lead_time: { count: 0, avg_hours: null, median_hours: null, max_hours: null },
    cycle_time: { count: 0, avg_hours: null, median_hours: null, max_hours: null },
    reopen: { reopened_tasks: 0, completed_tasks: 0, rate: 0 },
    velocity: [],
    estimate_vs_actual: {
      samples: [],
      hours_per_point: null,
      run_duration_samples: 0,
      lead_time_fallback_samples: 0,
    },
    skill_adoption: { recorded: 0, used: 0, uses_per_run: null, used_vs_recorded: null, ...over },
  }) as FlowMetrics;

const terminal = new Set(['DONE', 'CANCELED']);

describe('computeAdoptionMetrics', () => {
  it('derives time-to-first-done as first task_created → first terminal transition', () => {
    const events = [
      ev('2026-01-01T00:00:00Z', 'task_created', { key: 'T-1' }),
      ev('2026-01-01T10:00:00Z', 'task_transitioned', { key: 'T-1', to: 'IN_PROGRESS' }),
      ev('2026-01-02T00:00:00Z', 'task_transitioned', { key: 'T-1', to: 'DONE' }),
    ];
    const m = computeAdoptionMetrics(events, [], terminal, flow());
    expect(m.timeToFirstDone.firstTaskAt).toBe('2026-01-01T00:00:00Z');
    expect(m.timeToFirstDone.firstDoneAt).toBe('2026-01-02T00:00:00Z');
    expect(m.timeToFirstDone.hours).toBe(24);
  });

  it('reports null hours when no task has completed', () => {
    const m = computeAdoptionMetrics(
      [ev('2026-01-01T00:00:00Z', 'task_created')],
      [],
      terminal,
      flow(),
    );
    expect(m.timeToFirstDone.firstTaskAt).not.toBeNull();
    expect(m.timeToFirstDone.firstDoneAt).toBeNull();
    expect(m.timeToFirstDone.hours).toBeNull();
  });

  it('honors a terminal action when `to` is absent', () => {
    const events = [
      ev('2026-01-01T00:00:00Z', 'task_created'),
      ev('2026-01-01T05:00:00Z', 'task_transitioned', { action: 'approve' }),
    ];
    const m = computeAdoptionMetrics(events, [], terminal, flow());
    expect(m.timeToFirstDone.hours).toBe(5);
  });

  it('keeps firstDoneAt when a terminal event predates the create (clock skew)', () => {
    // A completion recorded before the earliest surviving create: both
    // anchors exist, hours is null (to < from), but the completion is real
    // and must not be reported as "not completed".
    const events = [
      ev('2026-01-02T00:00:00Z', 'task_created', { key: 'T-1' }),
      ev('2026-01-01T00:00:00Z', 'task_transitioned', { key: 'T-1', to: 'DONE' }),
    ];
    const m = computeAdoptionMetrics(events, [], terminal, flow());
    expect(m.timeToFirstDone.firstDoneAt).not.toBeNull();
    expect(m.timeToFirstDone.hours).toBeNull(); // non-positive duration
  });

  it('does NOT count a done/approve action that lands in a non-terminal state', () => {
    // A custom workflow could name a non-terminal transition 'approve';
    // when `to` is present it is the authority, so this is not terminal.
    const events = [
      ev('2026-01-01T00:00:00Z', 'task_created'),
      ev('2026-01-01T05:00:00Z', 'task_transitioned', { to: 'IN_REVIEW', action: 'approve' }),
    ];
    const m = computeAdoptionMetrics(events, [], terminal, flow());
    expect(m.timeToFirstDone.firstDoneAt).toBeNull();
  });

  it('flags activated features by the presence of their audit kind', () => {
    const events = [
      ev('2026-01-01T00:00:00Z', 'epic_created'),
      ev('2026-01-01T00:00:01Z', 'decision_recorded'),
      ev('2026-01-01T00:00:02Z', 'dependency_linked'),
    ];
    const m = computeAdoptionMetrics(events, [], terminal, flow());
    expect(m.featureActivation.epics).toBe(true);
    expect(m.featureActivation.decisions).toBe(true);
    expect(m.featureActivation.dependencies).toBe(true);
    expect(m.featureActivation.sprints).toBe(false);
    expect(m.featureActivation.skills).toBe(false);
    expect(m.featureActivation.activatedCount).toBe(3);
    expect(m.featureActivation.trackedCount).toBe(5);
  });

  it('counts doctor runs from the local counters, not the audit log', () => {
    const counters: CounterEntry[] = [
      { kind: 'doctor_ran', at: '2026-01-01T00:00:00Z' },
      { kind: 'doctor_ran', at: '2026-01-02T00:00:00Z' },
      { kind: 'something_else', at: '2026-01-03T00:00:00Z' },
    ];
    const m = computeAdoptionMetrics([], counters, terminal, flow());
    expect(m.doctorRuns).toBe(2);
  });

  it('passes skill adoption through from flow metrics', () => {
    const m = computeAdoptionMetrics([], [], terminal, flow({ recorded: 5, used: 3 }));
    expect(m.skillAdoption.recorded).toBe(5);
    expect(m.skillAdoption.used).toBe(3);
  });

  it('handles an empty project without throwing', () => {
    const m = computeAdoptionMetrics([], [], terminal, flow());
    expect(m.timeToFirstDone.hours).toBeNull();
    expect(m.featureActivation.activatedCount).toBe(0);
    expect(m.doctorRuns).toBe(0);
  });
});
