import type { HeadSignature } from '../sqlite/repositories/audit-head-signature-repository.js';

/**
 * Shared audit types, defined HERE (a leaf in storage/audit/) so both the
 * writer and the hash helper — and the services above — import them DOWNWARD.
 * This clears the last madge type-cycle (audit-writer ↔ audit-hash over the
 * AuditEvent type). Type-only, behaviour-neutral.
 */

/**
 * Append-only event written to the audit log.
 *
 * The shape mirrors the canonical structure documented in DESIGN.md
 * §10.5 and ARCHITECTURE.md §3.4. From schema `v: 2` every event also
 * carries `prev_hash` and `hash`, forming a per-file SHA-256 chain
 * that `mnema doctor` validates to detect tampering.
 */
export interface AuditEvent {
  /** Schema version for the event envelope. */
  readonly v: number;
  /** ISO8601 timestamp of when the event was emitted. */
  readonly at: string;
  /** Event kind, e.g. `"task_transitioned"`. */
  readonly kind: string;
  /** Handle of the human actor responsible. */
  readonly actor: string;
  /** Handle of the agent that performed the work, when applicable. */
  readonly via?: string;
  /** Identifier of the agent run, when applicable. */
  readonly run?: string;
  /** Event-specific payload. */
  readonly data: Readonly<Record<string, unknown>>;
  /**
   * Hash of the previous line in the same file, or `null` for the
   * genesis line. Present on every event from schema `v: 2`.
   */
  readonly prev_hash?: string | null;
  /**
   * SHA-256 of this event with `hash` omitted, computed before the
   * line was appended. Present on every event from schema `v: 2`.
   */
  readonly hash?: string;
}

/**
 * The collaborator roles the audit writer depends on, defined HERE in storage/
 * so the writer imports them DOWNWARD (never up into services/). The concrete
 * services (`HeadCheckpointService`, `AnchorScheduler`) implement these; this
 * inverts the type edges that madge otherwise reports as cycles. Type-only,
 * behaviour-neutral — the writer already only used these two methods.
 */

/** Signs the chain head when a checkpoint is due (ADR-37 layer 2). */
export interface HeadCheckpointer {
  /**
   * Signs `headHash` and records a checkpoint when the interval has elapsed;
   * returns the signature just written, or `null` when no checkpoint fired.
   */
  maybeSign(headHash: string, eventCount: number): HeadSignature | null;
}

/** Receives a freshly-signed head for off-path temporal anchoring (layer 3). */
export interface SignedHeadListener {
  /** Hand a newly-signed head to the anchor scheduler (fire-and-forget). */
  onSignedHead(head: string, eventCount: number): void;
}
