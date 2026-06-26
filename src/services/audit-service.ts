import type { AuditEvent, AuditWriter } from '../storage/audit/audit-writer.js';

/**
 * Caller-supplied portion of an audit event. The writer fills in
 * `v` and `at` automatically.
 */
export interface AuditEventInput {
  readonly kind: string;
  readonly actor: string;
  readonly via?: string;
  readonly run?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Observer invoked after an event has been durably written. Used to
 * fire domain-event hooks post-commit. Must never throw — the audit
 * write has already succeeded by the time it runs.
 */
export type AuditWriteObserver = (event: AuditEvent) => void;

/**
 * Orchestrates writes to the audit log.
 *
 * Responsibilities:
 * - Stamps events with the current ISO8601 timestamp and protocol
 *   version, so callers can stay focused on payload data.
 * - Triggers monthly rotation through the underlying {@link AuditWriter}.
 *
 * The audit log is append-only; once written, events never change.
 */
export class AuditService {
  private readonly now: () => Date;
  private observer: AuditWriteObserver | null = null;
  /** Guards against an observer's own audit writes re-entering it. */
  private dispatching = false;

  constructor(
    private readonly writer: AuditWriter,
    now: () => Date = () => new Date(),
  ) {
    this.now = now;
  }

  /**
   * Registers a single post-write observer (the domain-event
   * dispatcher). Wired after construction because the dispatcher itself
   * needs an {@link AuditService} to record hook firings, so the two
   * cannot be built in one pass.
   *
   * @param observer - Callback invoked after each durable write
   */
  setWriteObserver(observer: AuditWriteObserver): void {
    this.observer = observer;
  }

  /**
   * Records an event in the audit log with the current timestamp.
   *
   * @param input - Caller-supplied event fields (kind, actor, data, ...)
   */
  write(input: AuditEventInput): void {
    const event: AuditEvent = {
      v: 1,
      at: this.now().toISOString(),
      kind: input.kind,
      actor: input.actor,
      ...(input.via !== undefined ? { via: input.via } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
      data: input.data,
    };
    this.writer.write(event);

    // Fire the observer only after the write succeeded, and never
    // re-enter it for the audit events it produces itself (e.g.
    // `hook_ran`). A throwing observer must not corrupt the caller's
    // already-committed state.
    if (this.observer !== null && !this.dispatching) {
      this.dispatching = true;
      try {
        this.observer(event);
      } catch {
        // A hook dispatcher swallows its own failures; this is a
        // last-resort guard so an unexpected throw can never propagate.
      } finally {
        this.dispatching = false;
      }
    }
  }
}
