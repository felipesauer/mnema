import type { SqliteAdapter } from '../sqlite-adapter.js';

/**
 * The latest machine-attestation signature over the audit chain head.
 * Persisted by the writer at a checkpoint interval and
 * read back by `inspectAuditIntegrity` to verify which machine advanced
 * the head.
 */
export interface HeadSignature {
  /** The `chain_head_hash` (hex) this signature covers. */
  readonly coveredHeadHash: string;
  /** `event_count` at the moment of signing. */
  readonly eventCountAt: number;
  /** Resolved actor handle that owns the signing key. */
  readonly signerActor: string;
  /** `sha256(SPKI DER)` of the signer's public key. */
  readonly signerFingerprint: string;
  /** Base64 Ed25519 signature over the covered head hash bytes. */
  readonly signature: string;
  /** ISO8601 wall-clock of signing. */
  readonly signedAt: string;
}

interface HeadSignatureRow {
  readonly covered_head_hash: string;
  readonly event_count_at: number;
  readonly signer_actor: string;
  readonly signer_fingerprint: string;
  readonly signature: string;
  readonly signed_at: string;
}

/**
 * Persistence for the single-row {@link HeadSignature}. Mirrors
 * {@link AuditStateRepository}'s single-row (`id = 1`) shape: the row holds
 * the LATEST signed checkpoint, overwritten each checkpoint. Latest-only is
 * sufficient for verification, which checks the most recent signature
 * against the current head.
 */
export class AuditHeadSignatureRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /** Reads the latest head signature, or `null` when none has been recorded. */
  read(): HeadSignature | null {
    const row = this.adapter
      .getDatabase()
      .prepare(
        `SELECT covered_head_hash, event_count_at, signer_actor,
                signer_fingerprint, signature, signed_at
           FROM audit_head_signature WHERE id = 1`,
      )
      .get() as HeadSignatureRow | undefined;
    if (row === undefined) return null;
    return {
      coveredHeadHash: row.covered_head_hash,
      eventCountAt: row.event_count_at,
      signerActor: row.signer_actor,
      signerFingerprint: row.signer_fingerprint,
      signature: row.signature,
      signedAt: row.signed_at,
    };
  }

  /**
   * Upserts the latest head signature (single row, `id = 1`). Overwrites the
   * prior checkpoint — verification only needs the most recent one.
   *
   * @param sig - The signature record to persist
   */
  upsert(sig: HeadSignature): void {
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO audit_head_signature
           (id, covered_head_hash, event_count_at, signer_actor,
            signer_fingerprint, signature, signed_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            covered_head_hash = excluded.covered_head_hash,
            event_count_at = excluded.event_count_at,
            signer_actor = excluded.signer_actor,
            signer_fingerprint = excluded.signer_fingerprint,
            signature = excluded.signature,
            signed_at = excluded.signed_at`,
      )
      .run(
        sig.coveredHeadHash,
        sig.eventCountAt,
        sig.signerActor,
        sig.signerFingerprint,
        sig.signature,
        sig.signedAt,
      );
  }
}
