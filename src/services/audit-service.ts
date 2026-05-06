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

  constructor(
    private readonly writer: AuditWriter,
    now: () => Date = () => new Date(),
  ) {
    this.now = now;
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
  }
}
