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

/** A hook argv pair (command + args), the post-ADR-30 shape. */
function hook(command: string, args: string[] = []) {
  return { command, args };
}

const noHooks = {
  on_task_done: [],
  on_task_transitioned: [],
  on_decision_accepted: [],
  on_sprint_closed: [],
  on_epic_closed: [],
};

const okRunner: HookRunner = () => ({ status: 0, signal: null });

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
  it('runs the configured command as argv with the event JSON on stdin', () => {
    const seen: { command: string; args: readonly string[]; stdin: string }[] = [];
    const runner: HookRunner = (command, args, stdin) => {
      seen.push({ command, args, stdin });
      return { status: 0, signal: null };
    };
    const audits: AuditEventInput[] = [];
    const dispatcher = new DomainEventDispatcher(
      { ...noHooks, on_task_done: [hook('notify.sh', ['--to', 'done'])] },
      TERMINAL,
      (input) => audits.push(input),
      runner,
    );

    const event = makeEvent('task_transitioned', { to: 'DONE', key: 'X-1' });
    dispatcher.dispatch(event);

    expect(seen).toHaveLength(1);
    expect(seen[0].command).toBe('notify.sh');
    expect(seen[0].args).toEqual(['--to', 'done']);
    expect(JSON.parse(seen[0].stdin)).toMatchObject({ kind: 'task_transitioned' });
  });

  it('writes a hook_ran audit event with the exit code', () => {
    const audits: AuditEventInput[] = [];
    const dispatcher = new DomainEventDispatcher(
      { ...noHooks, on_sprint_closed: [hook('ok.sh')] },
      TERMINAL,
      (input) => audits.push(input),
      okRunner,
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
      { ...noHooks, on_epic_closed: [hook('boom.sh')] },
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
      { ...noHooks, on_epic_closed: [hook('x')] },
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
      { ...noHooks, on_task_done: [hook('a'), hook('b')] },
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

  // --- Security: MNEMA-ADR-30 / MNEMA-100 regression ---

  it('does NOT execute hooks when the block is untrusted (un-approved)', () => {
    let ran = false;
    const audits: AuditEventInput[] = [];
    const dispatcher = new DomainEventDispatcher(
      { ...noHooks, on_task_done: [hook('touch', ['/tmp/PWNED'])] },
      TERMINAL,
      (input) => audits.push(input),
      () => {
        ran = true;
        return { status: 0, signal: null };
      },
      () => false, // trust predicate: block is not approved
    );

    dispatcher.dispatch(makeEvent('task_transitioned', { to: 'DONE' }));

    // The malicious hook never ran...
    expect(ran).toBe(false);
    // ...but the attempt is still on the audit trail as skipped.
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      kind: 'hook_ran',
      data: {
        event: DomainEvent.TaskDone,
        command: 'touch /tmp/PWNED',
        outcome: 'skipped',
      },
    });
  });

  it('passes shell metacharacters as inert argv, never interpreting them', () => {
    // The MNEMA-100 payload was `touch PWNED_$(id -un)`. With argv exec and
    // no shell, `$(id -un)` is a literal argument, not a subshell.
    const seen: { command: string; args: readonly string[] }[] = [];
    const dispatcher = new DomainEventDispatcher(
      { ...noHooks, on_task_done: [hook('touch', ['PWNED_$(id -un)'])] },
      TERMINAL,
      () => {},
      (command, args) => {
        seen.push({ command, args });
        return { status: 0, signal: null };
      },
      () => true, // approved — but the point is the argv stays literal
    );

    dispatcher.dispatch(makeEvent('task_transitioned', { to: 'DONE' }));

    expect(seen).toHaveLength(1);
    expect(seen[0].command).toBe('touch');
    // The metacharacter payload is delivered verbatim as one argv entry —
    // there is no shell to expand it.
    expect(seen[0].args).toEqual(['PWNED_$(id -un)']);
  });
});
