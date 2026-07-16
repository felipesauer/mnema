import { existsSync, readFileSync } from 'node:fs';

import type { HeadCheckpointer } from '../../storage/audit/audit-types.js';
import type {
  AuditHeadSignatureRepository,
  HeadSignature,
} from '../../storage/sqlite/repositories/audit-head-signature-repository.js';
import type { AttestationSource } from './audit-integrity.js';
import { MachineKeyService } from './machine-key.js';

/** The checkpoint cadence: sign after `events` new events OR `seconds`. */
export interface CheckpointInterval {
  readonly events: number;
  readonly seconds: number;
}

/** A resolved signer: the machine key plus the actor handle it belongs to. */
export interface CheckpointSigner {
  readonly machineKey: MachineKeyService;
  readonly actor: string;
}

/**
 * Signs the audit chain head with the per-machine Ed25519 key at a
 * checkpoint interval (ADR-37 layer 2), OFF the per-event hot path. The
 * writer calls {@link maybeSign} after a chain advance; a signature is
 * produced only when the interval has elapsed — by event count OR by
 * wall-clock — since the last recorded checkpoint. Between checkpoints the
 * call is a cheap read-and-compare with no signing.
 *
 * The signer is resolved LAZILY, per checkpoint, via `resolveSigner` — so a
 * long-lived process (e.g. an MCP server) that boots before an identity is
 * configured starts attesting as soon as the identity appears, instead of
 * being frozen key-less for the whole session. `resolveSigner` returns
 * `null` while no identity is configured; the checkpoint is simply skipped
 * and retried on the next write.
 *
 * Kept separate from the writer so the "how often" policy and the crypto
 * live in one testable place, and so the writer stays free of the machine
 * key + signature repository.
 */
export class HeadCheckpointService implements HeadCheckpointer {
  constructor(
    private readonly signatures: AuditHeadSignatureRepository,
    private readonly resolveSigner: () => CheckpointSigner | null,
    private readonly interval: CheckpointInterval,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Signs `headHash` and records the checkpoint when the interval has
   * elapsed since the last signature; otherwise does nothing. Idempotent
   * across a no-op call (a checkpoint with no new events never re-signs the
   * same head). Resolves the signer lazily; when no identity is configured
   * yet it skips signing (and retries next write).
   *
   * @param headHash - The current `chain_head_hash` (hex)
   * @param eventCount - `event_count` from the audit-state mirror
   * @returns The signature just written, or `null` when no checkpoint fired
   */
  maybeSign(headHash: string, eventCount: number): HeadSignature | null {
    if (!this.shouldSign(eventCount)) return null;
    const signer = this.resolveSigner();
    if (signer === null) return null; // no identity yet — retry next write

    const { fingerprint } = signer.machineKey.getOrCreate();
    const signature = signer.machineKey.sign(Buffer.from(headHash, 'hex')).toString('base64');
    const record: HeadSignature = {
      coveredHeadHash: headHash,
      eventCountAt: eventCount,
      signerActor: signer.actor,
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

/**
 * Builds an {@link AttestationSource} for `inspectAuditIntegrity`: reads the
 * latest recorded head signature and verifies it against the committed
 * public key of ITS signer, resolved by (actor, fingerprint) at
 * `.mnema/keys/<actor>.<fp12>.pub`. Verification returns `null` when that
 * public key is absent (a signer whose `.pub` was never committed / is
 * missing on this checkout), and `'fingerprint_mismatch'` when a file IS
 * there but carries a different full fingerprint — both mean "cannot
 * attest" rather than a false tamper, but the caller words them apart.
 * Kept here so the machine-key path resolution lives
 * next to the signer, and reused by the verify tool, doctor and dashboard.
 *
 * @param projectRoot - Absolute project root (holds `.mnema/keys/`)
 * @param signatures - The head-signature repository
 * @returns An attestation source, or `null` when no signature is recorded
 */
export function createAttestationSource(
  projectRoot: string,
  signatures: AuditHeadSignatureRepository,
): AttestationSource {
  return {
    readHeadSignature: () => signatures.read(),
    verifyHeadSignature: (sig) => {
      // Everything here runs on attacker-influenceable data from the
      // (untracked) SQLite signature row and the committed `.pub`: the actor
      // handle (a bad one makes the MachineKeyService constructor throw), and
      // the `.pub` contents (a corrupt/truncated record makes parsePublicKey
      // throw). Neither is a tamper verdict — treat any such failure as
      // "cannot attest" (null), never a crash and never a false `broken`.
      try {
        const keyService = new MachineKeyService(projectRoot, sig.signerActor);
        const pubPath = keyService.publicKeyPathFor(sig.signerFingerprint);
        if (!existsSync(pubPath)) return null;
        const record = MachineKeyService.parsePublicKey(readFileSync(pubPath, 'utf-8'));
        // Bind the FULL fingerprint. The `.pub` is resolved by a short prefix
        // (`<fp12>` names the file), so the resolved record could carry a key
        // whose full fingerprint diverges from the one the signature row
        // declared. Verifying against it would attest a signer the row never
        // named. Require the recorded and declared fingerprints to match on
        // all 256 bits before trusting the key. Still "cannot attest", not a
        // tamper verdict — but distinct from the plain-null missing-file case,
        // because "no key committed" and "a key IS here but it is not the
        // recorded signer's" call for very different operator responses.
        if (record.fingerprint !== sig.signerFingerprint) return 'fingerprint_mismatch';
        return MachineKeyService.verify(
          Buffer.from(sig.coveredHeadHash, 'hex'),
          Buffer.from(sig.signature, 'base64'),
          record.publicKey,
        );
      } catch {
        return null;
      }
    },
  };
}
