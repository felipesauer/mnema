import type {
  AuditHeadSignatureRepository,
  HeadSignature,
} from '../storage/sqlite/repositories/audit-head-signature-repository.js';
import type { MachineKeyService } from './machine-key.js';

/** The checkpoint cadence: sign after `events` new events OR `seconds`. */
export interface CheckpointInterval {
  readonly events: number;
  readonly seconds: number;
}

/**
 * Signs the audit chain head with the per-machine Ed25519 key at a
 * checkpoint interval (ADR-37 layer 2), OFF the per-event hot path. The
 * writer calls {@link maybeSign} after a chain advance; a signature is
 * produced only when the interval has elapsed — by event count OR by
 * wall-clock — since the last recorded checkpoint. Between checkpoints the
 * call is a cheap read-and-compare with no signing.
 *
 * Kept separate from the writer so the "how often" policy and the crypto
 * live in one testable place, and so the writer stays free of the machine
 * key + signature repository.
 */
export class HeadCheckpointService {
  constructor(
    private readonly signatures: AuditHeadSignatureRepository,
    private readonly machineKey: MachineKeyService,
    private readonly actor: string,
    private readonly interval: CheckpointInterval,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Signs `headHash` and records the checkpoint when the interval has
   * elapsed since the last signature; otherwise does nothing. Idempotent
   * across a no-op call (a checkpoint with no new events never re-signs the
   * same head).
   *
   * @param headHash - The current `chain_head_hash` (hex)
   * @param eventCount - `event_count` from the audit-state mirror
   * @returns The signature just written, or `null` when no checkpoint fired
   */
  maybeSign(headHash: string, eventCount: number): HeadSignature | null {
    if (!this.shouldSign(eventCount)) return null;

    const { fingerprint } = this.machineKey.getOrCreate();
    const signature = this.machineKey.sign(Buffer.from(headHash, 'hex')).toString('base64');
    const record: HeadSignature = {
      coveredHeadHash: headHash,
      eventCountAt: eventCount,
      signerActor: this.actor,
      signerFingerprint: fingerprint,
      signature,
      signedAt: this.now().toISOString(),
    };
    this.signatures.upsert(record);
    return record;
  }

  /**
   * True when a checkpoint is due: no signature yet, OR enough new events
   * OR enough elapsed time since the last one. A checkpoint with no new
   * events past the last signed head is never due (avoids re-signing the
   * same head).
   */
  private shouldSign(eventCount: number): boolean {
    const last = this.signatures.read();
    // First checkpoint: sign once the very first interval's worth of events
    // has accrued (not on event #1), so the cold path is spared early.
    if (last === null) return eventCount >= this.interval.events;
    if (eventCount <= last.eventCountAt) return false;
    if (eventCount - last.eventCountAt >= this.interval.events) return true;
    const elapsedMs = this.now().getTime() - new Date(last.signedAt).getTime();
    return elapsedMs >= this.interval.seconds * 1000;
  }
}
