import { describe, expect, it } from 'vitest';

import { DomainEvent } from '@/domain/enums/domain-event.js';
import type { AuditEventInput } from '@/services/audit-service.js';
import {
  DomainEventDispatcher,
  type HookRunner,
  resolveDomainEvents,
} from '@/services/domain-event-dispatcher.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

const TERMINAL = ['DONE'] as const;

function makeEvent(kind: string, data: Record<string, unknown>): AuditEvent {
  return { v: 1, at: '2026-06-26T00:00:00.000Z', kind, actor: 'daniel', data };
}

const noHooks = {
  on_task_done: [],
  on_task_transitioned: [],
  on_decision_accepted: [],
  on_sprint_closed: [],
  on_epic_closed: [],
};

describe('resolveDomainEvents', () => {
  it('maps a terminal transition to both transitioned and done', () => {
    const events = resolveDomainEvents(makeEvent('task_transitioned', { to: 'DONE' }), TERMINAL);
    expect(events).toEqual([DomainEvent.TaskTransitioned, DomainEvent.TaskDone]);
  });

  it('maps a non-terminal transition to transitioned only', () => {
    const events = resolveDomainEvents(makeEvent('task_transitioned', { to: 'DOING' }), TERMINAL);
    expect(events).toEqual([DomainEvent.TaskTransitioned]);
  });

  it('maps only accepted decisions', () => {
    expect(
      resolveDomainEvents(makeEvent('decision_status_changed', { to: 'accepted' }), TERMINAL),
    ).toEqual([DomainEvent.DecisionAccepted]);
    expect(
      resolveDomainEvents(makeEvent('decision_status_changed', { to: 'rejected' }), TERMINAL),
    ).toEqual([]);
  });

  it('maps sprint and epic closes', () => {
    expect(resolveDomainEvents(makeEvent('sprint_closed', {}), TERMINAL)).toEqual([
      DomainEvent.SprintClosed,
    ]);
    expect(resolveDomainEvents(makeEvent('epic_closed', {}), TERMINAL)).toEqual([
      DomainEvent.EpicClosed,
    ]);
  });

  it('ignores meta and unknown events (incl. hook_ran — no re-entrancy)', () => {
    expect(resolveDomainEvents(makeEvent('hook_ran', {}), TERMINAL)).toEqual([]);
    expect(resolveDomainEvents(makeEvent('run_resumed', {}), TERMINAL)).toEqual([]);
  });
});

describe('DomainEventDispatcher', () => {
  it('runs the configured command with the event JSON on stdin', () => {
    const seen: { command: string; stdin: string }[] = [];
    const runner: HookRunner = (command, stdin) => {
      seen.push({ command, stdin });
      return { status: 0, signal: null };
    };
    const audits: AuditEventInput[] = [];
    const dispatcher = new DomainEventDispatcher(
      { ...noHooks, on_task_done: ['notify.sh'] },
      TERMINAL,
      (input) => audits.push(input),
      runner,
    );

    const event = makeEvent('task_transitioned', { to: 'DONE', key: 'X-1' });
    dispatcher.dispatch(event);

    expect(seen).toHaveLength(1);
    expect(seen[0].command).toBe('notify.sh');
    expect(JSON.parse(seen[0].stdin)).toMatchObject({ kind: 'task_transitioned' });
  });

  it('writes a hook_ran audit event with the exit code', () => {
    const audits: AuditEventInput[] = [];
    const dispatcher = new DomainEventDispatcher(
      { ...noHooks, on_sprint_closed: ['ok.sh'] },
      TERMINAL,
      (input) => audits.push(input),
      () => ({ status: 0, signal: null }),
    );

    dispatcher.dispatch(makeEvent('sprint_closed', { key: 'S-1' }));

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      kind: 'hook_ran',
      data: {
        event: DomainEvent.SprintClosed,
        command: 'ok.sh',
        outcome: 'completed',
        exit_code: 0,
      },
    });
  });

  it('audits a non-zero exit as failed without throwing', () => {
    const audits: AuditEventInput[] = [];
    const dispatcher = new DomainEventDispatcher(
      { ...noHooks, on_epic_closed: ['boom.sh'] },
      TERMINAL,
      (input) => audits.push(input),
      () => ({ status: 3, signal: null }),
    );

    expect(() => dispatcher.dispatch(makeEvent('epic_closed', {}))).not.toThrow();
    expect(audits[0].data).toMatchObject({ outcome: 'failed', exit_code: 3 });
  });

  it('swallows a runner that throws (spawn could not start)', () => {
    const audits: AuditEventInput[] = [];
    const dispatcher = new DomainEventDispatcher(
      { ...noHooks, on_epic_closed: ['x'] },
      TERMINAL,
      (input) => audits.push(input),
      () => {
        throw new Error('ENOENT');
      },
    );

    expect(() => dispatcher.dispatch(makeEvent('epic_closed', {}))).not.toThrow();
    expect(audits[0].data).toMatchObject({ outcome: 'failed' });
    expect(audits[0].data.detail).toContain('ENOENT');
  });

  it('runs every command for an event, in order', () => {
    const order: string[] = [];
    const dispatcher = new DomainEventDispatcher(
      { ...noHooks, on_task_done: ['a', 'b'] },
      TERMINAL,
      () => {},
      (command) => {
        order.push(command);
        return { status: 0, signal: null };
      },
    );

    dispatcher.dispatch(makeEvent('task_transitioned', { to: 'DONE' }));
    expect(order).toEqual(['a', 'b']);
  });

  it('does nothing when no hook is configured for the event', () => {
    let ran = false;
    const dispatcher = new DomainEventDispatcher(
      noHooks,
      TERMINAL,
      () => {},
      () => {
        ran = true;
        return { status: 0, signal: null };
      },
    );
    dispatcher.dispatch(makeEvent('task_transitioned', { to: 'DONE' }));
    expect(ran).toBe(false);
  });
});
