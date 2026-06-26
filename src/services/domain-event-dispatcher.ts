import { spawnSync } from 'node:child_process';

import type { Config } from '../config/config-schema.js';
import { DomainEvent } from '../domain/enums/domain-event.js';
import type { AuditEvent } from '../storage/audit/audit-writer.js';
import type { AuditEventInput } from './audit-service.js';

/**
 * Default time a single hook command is allowed to run before it is
 * killed. A hook is a side effect, not part of the critical path —
 * a hung command must never wedge the mnema command that triggered it.
 */
export const HOOK_TIMEOUT_MS = 30_000;

/**
 * Signature of a process runner. Abstracted so tests can inject a fake
 * without spawning real processes. Mirrors the subset of
 * {@link spawnSync}'s result the dispatcher needs.
 */
export type HookRunner = (
  command: string,
  stdin: string,
) => { status: number | null; signal: string | null; error?: Error };

const defaultRunner: HookRunner = (command, stdin) => {
  const result = spawnSync(command, {
    shell: true,
    input: stdin,
    timeout: HOOK_TIMEOUT_MS,
    encoding: 'utf-8',
  });
  return { status: result.status, signal: result.signal, error: result.error };
};

/**
 * Writes an audit event. Injected (rather than the writer) so hook
 * firings ride the same hash chain as every other event.
 */
export type AuditSink = (input: AuditEventInput) => void;

/**
 * Maps a persisted audit event onto the curated {@link DomainEvent}s it
 * represents. Returns an empty array for events nothing subscribes to
 * (including the dispatcher's own `hook_ran`, which is therefore never
 * re-entrant). `terminalStates` lets a task transition decide whether
 * it also counts as "done" without coupling the dispatcher to the whole
 * workflow definition.
 */
export function resolveDomainEvents(
  event: AuditEvent,
  terminalStates: readonly string[],
): DomainEvent[] {
  switch (event.kind) {
    case 'task_transitioned': {
      const events = [DomainEvent.TaskTransitioned];
      const to = event.data.to;
      if (typeof to === 'string' && terminalStates.includes(to)) {
        events.push(DomainEvent.TaskDone);
      }
      return events;
    }
    case 'decision_status_changed':
      return event.data.to === 'accepted' ? [DomainEvent.DecisionAccepted] : [];
    case 'sprint_closed':
      return [DomainEvent.SprintClosed];
    case 'epic_closed':
      return [DomainEvent.EpicClosed];
    default:
      return [];
  }
}

/**
 * Runs user-configured shell commands when a curated domain event
 * fires, and records each firing in the audit log.
 *
 * Design guarantees that satisfy the "a failing hook never corrupts
 * mnema state" contract:
 *
 * - **Post-commit only.** The dispatcher is invoked *after* the
 *   triggering audit event is already durably written, so a hook can
 *   never roll back state it observed.
 * - **Fully isolated.** Every command runs in a try/catch with a hard
 *   timeout; a non-zero exit, a signal kill, or a thrown error is
 *   captured and audited as `hook_ran` with the exit code — it is
 *   never propagated to the caller.
 * - **Auditable.** Each firing writes its own `hook_ran` event, so the
 *   hook is part of the trail rather than a phantom side effect.
 */
export class DomainEventDispatcher {
  private readonly terminalStates: readonly string[];

  constructor(
    private readonly hooks: Config['hooks'],
    terminalStates: readonly string[],
    private readonly audit: AuditSink,
    private readonly run: HookRunner = defaultRunner,
  ) {
    this.terminalStates = terminalStates;
  }

  /**
   * Reacts to a freshly-persisted audit event: resolves the domain
   * events it represents and fires every configured hook for each.
   *
   * @param event - The audit event that was just written
   */
  dispatch(event: AuditEvent): void {
    const domainEvents = resolveDomainEvents(event, this.terminalStates);
    for (const domainEvent of domainEvents) {
      const commands = this.hooks[domainEvent];
      if (commands.length === 0) continue;
      const payload = JSON.stringify(event);
      for (const command of commands) {
        this.fire(domainEvent, command, payload, event.actor);
      }
    }
  }

  /** Runs one command, swallowing every failure into an audit event. */
  private fire(domainEvent: DomainEvent, command: string, payload: string, actor: string): void {
    let status: number | null = null;
    let outcome: 'completed' | 'failed' = 'completed';
    let detail: string | undefined;

    try {
      const result = this.run(command, payload);
      status = result.status;
      if (result.error !== undefined) {
        outcome = 'failed';
        detail = result.error.message;
      } else if (result.signal !== null) {
        outcome = 'failed';
        detail = `killed by signal ${result.signal}`;
      } else if (result.status !== 0) {
        outcome = 'failed';
        detail = `exited with code ${result.status}`;
      }
    } catch (err) {
      // The runner itself threw (e.g. spawn could not even start). The
      // hook is a side effect — never let it escape and corrupt the
      // command that triggered it.
      outcome = 'failed';
      detail = err instanceof Error ? err.message : String(err);
    }

    try {
      this.audit({
        kind: 'hook_ran',
        actor,
        data: {
          event: domainEvent,
          command,
          outcome,
          exit_code: status,
          ...(detail !== undefined ? { detail } : {}),
        },
      });
    } catch {
      // Auditing the hook must also never throw into the caller. If the
      // log is unwritable that is surfaced elsewhere (doctor); here we
      // simply refuse to let a side effect break the triggering command.
    }
  }
}
