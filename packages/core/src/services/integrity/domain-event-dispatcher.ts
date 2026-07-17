import { spawnSync } from 'node:child_process';

import type { Config, HookCommand } from '../../config/config-schema.js';
import { DomainEvent } from '../../domain/enums/domain-event.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';
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
 *
 * Takes an explicit argv (`command` + `args`) and is spawned WITHOUT a
 * shell, so shell metacharacters in a hook definition are passed as
 * literal argv data and never interpreted.
 */
export type HookRunner = (
  command: string,
  args: readonly string[],
  stdin: string,
) => { status: number | null; signal: string | null; error?: Error };

const defaultRunner: HookRunner = (command, args, stdin) => {
  // No `shell` option: argv is passed straight to the OS, so `$(…)`, `|`,
  // `;` and friends are inert bytes, not commands. This is the primary
  // control against hook-string injection.
  const result = spawnSync(command, [...args], {
    input: stdin,
    timeout: HOOK_TIMEOUT_MS,
    encoding: 'utf-8',
  });
  return { status: result.status, signal: result.signal, error: result.error };
};

/**
 * Decides whether a hook block is allowed to execute. Returns `true` for
 * a trusted block (user-global origin, or a project block whose contents
 * a human has approved) and `false` for an un-approved project block,
 * which is then skipped-and-audited rather than run. Injected so the
 * container can wire the real trust check and tests can force either
 * answer. Defaults to "trusted" so the no-container unit path stays simple
 * — the container always supplies the real predicate in production.
 */
export type HookTrust = () => boolean;

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
    case 'sprint_canceled':
      return [DomainEvent.SprintCanceled];
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

  /**
   * @param trusted - Predicate gating execution. When it returns `false`
   *   (an un-approved project hooks block) every hook is skipped and
   *   audited as `hook_ran` with `outcome: 'skipped'` — the firing is
   *   still recorded, but nothing runs. Defaults to always-trusted for
   *   the bare unit path; the container injects the real check.
   */
  constructor(
    private readonly hooks: Config['hooks'],
    terminalStates: readonly string[],
    private readonly audit: AuditSink,
    private readonly run: HookRunner = defaultRunner,
    private readonly trusted: HookTrust = () => true,
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
    if (domainEvents.length === 0) return;
    // Evaluate trust once per dispatch: the whole hooks block shares one
    // gate, so an audit event that resolves to several domain events (a
    // terminal transition is both TaskTransitioned and TaskDone) checks
    // trust a single time. An un-approved block never runs, but each of
    // its hooks is still audited as skipped so the attempt is on the trail.
    let allowed: boolean | null = null;
    const payload = JSON.stringify(event);
    for (const domainEvent of domainEvents) {
      const hooks = this.hooks[domainEvent];
      if (hooks.length === 0) continue;
      if (allowed === null) allowed = this.trusted();
      for (const hook of hooks) {
        this.fire(domainEvent, hook, payload, event.actor, allowed);
      }
    }
  }

  /** Runs one hook, swallowing every failure into an audit event. */
  private fire(
    domainEvent: DomainEvent,
    hook: HookCommand,
    payload: string,
    actor: string,
    allowed: boolean,
  ): void {
    const command = renderHookCommand(hook);

    // Untrusted (un-approved project) hooks are recorded but never run —
    // this is the control that neuters an agent-written config.
    if (!allowed) {
      this.writeHookRan(domainEvent, command, actor, 'skipped', 'hooks block not approved');
      return;
    }

    let status: number | null = null;
    let outcome: 'completed' | 'failed' = 'completed';
    let detail: string | undefined;

    try {
      const result = this.run(hook.command, hook.args, payload);
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

    this.writeHookRan(domainEvent, command, actor, outcome, detail, status);
  }

  /**
   * Records a single hook firing on the audit trail. Never throws into the
   * caller: a hook is a side effect, so an unwritable log is surfaced by
   * doctor, not by breaking the command that triggered the hook.
   */
  private writeHookRan(
    domainEvent: DomainEvent,
    command: string,
    actor: string,
    outcome: 'completed' | 'failed' | 'skipped',
    detail?: string,
    exitCode: number | null = null,
  ): void {
    try {
      this.audit({
        kind: 'hook_ran',
        actor,
        data: {
          event: domainEvent,
          command,
          outcome,
          exit_code: exitCode,
          ...(detail !== undefined ? { detail } : {}),
        },
      });
    } catch {
      // See method doc: auditing the hook must never throw into the caller.
    }
  }
}

/**
 * Renders a hook's argv into a single human-readable string for display
 * (the audit trail and `mnema hooks show`, e.g. `notify.sh --to done`).
 * Display-only — execution always uses the structured argv, never this
 * string.
 */
export function renderHookCommand(hook: HookCommand): string {
  return hook.args.length === 0 ? hook.command : `${hook.command} ${hook.args.join(' ')}`;
}
