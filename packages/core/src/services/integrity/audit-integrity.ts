import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  attestFilesSignature,
  auditFilesSignature,
  auditTailDirs,
  orderedAuditFiles,
} from '../../storage/audit/audit-files.js';
import { EVENT_FORMAT_VERSION, hmacEvent } from '../../storage/audit/audit-hash.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import type { AuditStateRepository } from '../../storage/sqlite/repositories/audit-state-repository.js';
import type { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';

/**
 * Severity bucket for a check. `error` fails the doctor exit code;
 * `warning` keeps exit 0 but renders a yellow `⚠` so the line stands
 * out in the checklist. Defaults to `error` when omitted.
 */
export type IntegrityCheckSeverity = 'error' | 'warning';

/**
 * Minimal structural view of the project-secret service the cache reads,
 * kept local so audit-integrity does not depend on the concrete class.
 */
export interface SecretSource {
  read(): Buffer | null;
  readFingerprint(): string | null;
}

/** The persisted head signature the attestation check verifies. */
export interface HeadSignatureView {
  readonly coveredHeadHash: string;
  readonly signerActor: string;
  readonly signerFingerprint: string;
  readonly signature: string;
  /** `event_count` the signature was made at — the attested high-water mark. */
  readonly eventCountAt: number;
}

/**
 * Minimal structural view of the machine-attestation sources, kept local so
 * audit-integrity does not depend on the repository or key-service classes.
 * `readHeadSignature` returns the latest recorded head signature (or `null`
 * when none). `verifyHeadSignature` verifies it against the committed public
 * key of its signer, resolved by fingerprint — returns `null` when that
 * public key is not present in the repo (a signer whose `.pub` is missing),
 * or `'fingerprint_mismatch'` when a `.pub` file WAS resolved by the 12-char
 * prefix but its full fingerprint differs from the recorded signer's — the
 * two "cannot attest" causes read very differently to an operator (a missing
 * commit vs a possible key substitution), so they are kept distinct.
 */
export interface AttestationSource {
  readHeadSignature(): HeadSignatureView | null;
  verifyHeadSignature(sig: HeadSignatureView): boolean | null | 'fingerprint_mismatch';
}

/**
 * One verdict line produced by an integrity inspection. Shared between
 * `mnema doctor` (which renders it as a checklist row) and the
 * `audit_verify` MCP tool (which returns it as structured JSON).
 */
export interface IntegrityCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly severity?: IntegrityCheckSeverity;
}

/**
 * Result of a single linear walk of every JSONL file under `auditDir`, in
 * chain order. Shared by {@link inspectAuditIntegrity} (which turns it into
 * report lines) and {@link reconcileAuditState} (which uses it to recompute
 * a trustworthy mirror), so the two can never disagree on what is actually
 * on disk.
 */
interface AuditChainWalk {
  readonly chainedLines: number;
  readonly malformedLines: number;
  readonly unverifiable: number;
  readonly chainBroken: boolean;
  readonly chainBreakDetail: string;
  readonly lastHash: string | null;
  readonly lastAt: string | null;
  readonly chainEverStarted: boolean;
  /** Count of content-hash (HMAC) mismatches found across the whole walk. */
  readonly hashMismatchCount: number;
  /**
   * Count of prev_hash continuity breaks (a line whose prev_hash does not
   * match the running head). Tracked apart from {@link hashMismatchCount} so
   * the verdict can tell a WRONG-SECRET chain (every line fails the HMAC but
   * continuity is intact) from an in-place forgery (which breaks continuity
   * or fails only some lines).
   */
  readonly prevHashBreakCount: number;
  /** Lines that were HMAC-verified (secret present). */
  readonly hmacChecked: number;
  /** …of those, how many failed the HMAC recomputation. */
  readonly hmacFailed: number;
  /**
   * Every chained line's own `hash`, in chain order. Each entry is the chain
   * head AS OF that event, so the set doubles as the ancestry oracle for a
   * signed head: a head signature covers a genuine earlier checkpoint iff its
   * `coveredHeadHash` appears here. Collected during the single walk so the
   * attestation check needs no second pass.
   */
  readonly chainedHashes: readonly string[];
}

/**
 * A re-baselined genesis a validated prune waiver authorises. When the very
 * first chained event on disk carries `prev_hash === anchorPrevHash` and its
 * own `hash === genesisHash`, the walk treats the missing prior segment as an
 * ACCEPTED prune rather than a `prev_hash` break — the surviving chain was
 * deliberately re-based by a retention prune.
 *
 * NOTE on `anchorPrevHash`: a prune does NOT rewrite the surviving genesis's
 * `prev_hash` (that would change its hashed bytes — no cascade re-hash). So
 * the genesis on disk still points at the hash of the LAST DROPPED event, and
 * `anchorPrevHash` is exactly that value — the waiver's `prunedHeadHash`, NOT
 * its `anchorDigest`. The `anchorDigest` is the waiver's separate,
 * recomputable-from-content attestation of the deleted prefix; it is verified
 * by the signature in `prune-waiver.ts`, not matched here.
 *
 * This is a PRE-VERIFIED verdict: the caller reads the committed waiver,
 * checks its Ed25519 signature, the project pin, and that the on-disk genesis
 * matches it (all in `prune-waiver.ts`), then hands the walk only the two
 * boundary hashes to match. The walk itself never touches the waiver file or
 * any crypto — same separation the content-attestation check uses, so the walk
 * stays pure and cheap on the hot path.
 */
export interface AcceptedRebaseline {
  /**
   * What the surviving genesis's on-disk `prev_hash` must equal — i.e. the
   * waiver's `prunedHeadHash` (the last dropped event's hash), since the prune
   * does not rewrite the genesis. NOT the anchor digest.
   */
  readonly anchorPrevHash: string;
  /** The waiver's genesis hash — what the first surviving event's `hash` must equal. */
  readonly genesisHash: string;
}

/**
 * Walks ONE machine tail's JSONL files, in chain order, verifying the
 * per-line hash chain end to end (across rotated segments) and tallying the
 * shape of what it finds. Pure and read-only.
 *
 * Each tail is an independent chain — its own genesis (`prev_hash: null`),
 * its own linear `prev_hash` continuity, its own HMAC. So the chain-carrying
 * state here NEVER spans tails; {@link walkAuditChain} runs this per tail and
 * folds the tallies.
 *
 * @param tailDir - Absolute path to one tail (`audit/m-<id>/`, or a degenerate
 *   root tail that directly holds `.jsonl` files)
 * @param secret - Per-project HMAC secret for verifying the sealed lines
 * @param acceptedRebaseline - A pre-verified prune re-baseline to accept at the
 *   genesis instead of flagging the absent prior segment as tamper, or `null`
 *   (the default) to treat any missing prior segment as a break
 * @returns The walk result for this tail
 */
function walkTailChain(
  tailDir: string,
  secret: Buffer | null,
  acceptedRebaseline: AcceptedRebaseline | null = null,
): AuditChainWalk {
  const files = orderedAuditFiles(tailDir);

  // Events that belong to the hash chain. `audit_state.event_count` tracks
  // exactly these, so the count check compares against this, not the raw line
  // count (which also counts malformed lines, tallied separately).
  let chainedLines = 0;
  let malformedLines = 0;
  let unverifiable = 0;
  let chainBroken = false;
  let chainBreakDetail = '';
  let hashMismatchCount = 0;
  let prevHashBreakCount = 0;
  let hmacChecked = 0;
  let hmacFailed = 0;
  let lastHash: string | null = null;
  let lastAt: string | null = null;
  let chainEverStarted = false;
  // Every chained line's own hash, in order — the ancestry oracle a head
  // signature is checked against (its coveredHeadHash must be one of these).
  const chainedHashes: string[] = [];
  // The running chain head, carried ACROSS files. The chain is a single
  // sequence even though rotation splits it into `YYYY-MM.jsonl` segments
  // plus `current.jsonl`, so the first line of one file links to the tail
  // of the previous one. Resetting per file would report a false
  // `prev_hash break` at every rotation boundary. Genesis is `null`.
  let prevHash: string | null = null;

  for (const file of files) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    for (const line of lines) {
      if (line.length === 0) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        malformedLines += 1;
        continue;
      }

      // Events are HMAC-keyed with a version tag. Anything else on disk is not
      // a chained event — a forged line, or garbage — and is counted as
      // malformed, never validated.
      const v = typeof event.v === 'number' ? event.v : 0;
      if (v !== EVENT_FORMAT_VERSION) {
        malformedLines += 1;
        continue;
      }
      // Whether this is the very first chained event on disk — the genesis.
      // Only the genesis may carry an accepted prune re-baseline; an interior
      // break can never be laundered.
      const isGenesis = !chainEverStarted;
      chainEverStarted = true;
      chainedLines += 1;
      const hash = typeof event.hash === 'string' ? event.hash : null;
      const prev = (event.prev_hash ?? null) as string | null;
      // Each line is HMAC-keyed. Without the secret (a clone that has not
      // imported it) the line cannot be hash-verified — flag it unverifiable
      // rather than a false tamper; its prev_hash continuity is still checked
      // below.
      if (secret === null) {
        unverifiable += 1;
      } else {
        hmacChecked += 1;
        const recomputed = hmacEvent(event as unknown as AuditEvent, secret);
        if (hash !== recomputed) {
          chainBroken = true;
          hashMismatchCount += 1;
          hmacFailed += 1;
          chainBreakDetail = `hash mismatch on a line in ${path.basename(file)}`;
        }
      }
      // An accepted prune re-baseline: the genesis event's prev_hash points
      // at the committed anchor digest (not a hash on disk) and its own hash
      // is the one the waiver was signed for. The waiver's signature/project
      // pin/genesis match were verified by the caller — here we only confirm
      // the two boundary hashes line up, so a deleted prefix reads as a
      // deliberate prune, not a break. Restricted to the genesis.
      const rebaselinedGenesis =
        isGenesis &&
        acceptedRebaseline !== null &&
        prev === acceptedRebaseline.anchorPrevHash &&
        hash === acceptedRebaseline.genesisHash;
      if (prev !== prevHash && !rebaselinedGenesis) {
        chainBroken = true;
        prevHashBreakCount += 1;
        // A break on the first line of a rotated segment means the previous
        // segment's tail is missing or altered (e.g. a whole archived month
        // was deleted) — name that explicitly.
        chainBreakDetail =
          prevHash === null
            ? `prev_hash break at the start of ${path.basename(file)} (a prior segment may be missing)`
            : `prev_hash break on a line in ${path.basename(file)}`;
      }
      if (hash !== null) chainedHashes.push(hash);
      prevHash = hash;
      lastHash = hash;
      lastAt = typeof event.at === 'string' ? event.at : lastAt;
    }
  }

  return {
    chainedLines,
    malformedLines,
    unverifiable,
    chainBroken,
    chainBreakDetail,
    lastHash,
    lastAt,
    chainEverStarted,
    hashMismatchCount,
    prevHashBreakCount,
    hmacChecked,
    hmacFailed,
    chainedHashes,
  };
}

/**
 * Walks the project's audit chain by walking every machine tail under
 * `auditDir` independently and folding the results. Each tail is its own
 * chain (its own genesis and linear `prev_hash`), so a break is judged
 * per tail and never across the boundary between two machines' tails — the
 * project is intact only when EVERY tail is. Pure and read-only.
 *
 * Tallies sum across tails; `chainBroken` is the OR (the first tail's detail
 * wins, tail-qualified); `chainedHashes` concatenates (the ancestry oracle a
 * head signature is matched against). `lastAt`/`lastHash` track the most
 * recent event across tails, for display only — the cryptographic truth is
 * per tail.
 *
 * A degenerate single-tail project (JSONL directly under `auditDir`, the shape
 * a freshly-migrated or single-machine project has) folds to exactly one walk,
 * identical to walking `auditDir` flat.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param secret - Per-project HMAC secret for verifying the sealed lines
 * @param acceptedRebaseline - A pre-verified prune re-baseline to accept at a
 *   tail's genesis, or `null` to treat any missing prior segment as a break
 * @returns The folded walk result for the whole project
 */
function walkAuditChain(
  auditDir: string,
  secret: Buffer | null,
  acceptedRebaseline: AcceptedRebaseline | null = null,
): AuditChainWalk {
  let chainedLines = 0;
  let malformedLines = 0;
  let unverifiable = 0;
  let hashMismatchCount = 0;
  let prevHashBreakCount = 0;
  let hmacChecked = 0;
  let hmacFailed = 0;
  let chainEverStarted = false;
  let chainBroken = false;
  let chainBreakDetail = '';
  let lastHash: string | null = null;
  let lastAt: string | null = null;
  const chainedHashes: string[] = [];

  for (const tail of auditTailDirs(auditDir)) {
    const walk = walkTailChain(tail, secret, acceptedRebaseline);
    chainedLines += walk.chainedLines;
    malformedLines += walk.malformedLines;
    unverifiable += walk.unverifiable;
    hashMismatchCount += walk.hashMismatchCount;
    prevHashBreakCount += walk.prevHashBreakCount;
    hmacChecked += walk.hmacChecked;
    hmacFailed += walk.hmacFailed;
    chainEverStarted ||= walk.chainEverStarted;
    if (walk.chainBroken) {
      chainBroken = true;
      if (chainBreakDetail === '') {
        // Qualify with the tail so a multi-machine report names WHICH chain
        // broke; the degenerate root tail is `auditDir` itself, so skip the
        // redundant prefix there.
        chainBreakDetail =
          tail === auditDir
            ? walk.chainBreakDetail
            : `${path.basename(tail)}: ${walk.chainBreakDetail}`;
      }
    }
    chainedHashes.push(...walk.chainedHashes);
    // Most-recent-across-tails wins for display; ISO timestamps sort
    // lexicographically, so a plain string compare is correct.
    if (walk.lastAt !== null && (lastAt === null || walk.lastAt > lastAt)) {
      lastAt = walk.lastAt;
      lastHash = walk.lastHash;
    }
  }

  return {
    chainedLines,
    malformedLines,
    unverifiable,
    chainBroken,
    chainBreakDetail,
    lastHash,
    lastAt,
    chainEverStarted,
    hashMismatchCount,
    prevHashBreakCount,
    hmacChecked,
    hmacFailed,
    chainedHashes,
  };
}

/**
 * Read-only assessment of what the on-disk chain physically holds and whether
 * it carries a real tamper signal, from the SAME {@link walkAuditChain} the
 * reconcile gates use. Exposed so the `accept-truncation` recovery command can
 * apply IDENTICAL malformed-line / broken-chain refusals as `reconcile` (never
 * a re-implementation that could drift from it) before re-baselining, and so it
 * can read the disk tail hash/count and test whether a signed head is still an
 * ancestor of the current chain.
 */
export interface ChainAssessment {
  /** Chained line count on disk. */
  readonly chainedLines: number;
  /** `hash` of the last chained line, or `null` when the chain is empty. */
  readonly lastHash: string | null;
  /** `at` of the last chained line, or `null`. */
  readonly lastAt: string | null;
  /** Unparseable lines encountered (a possible deletion smokescreen). */
  readonly malformedLines: number;
  /**
   * True when the per-line chain is internally inconsistent — a `prev_hash`
   * break or a content-hash mismatch. Any real tamper signal that reconcile
   * refuses lands here.
   */
  readonly chainBroken: boolean;
  /** Human-readable detail of the last break, when `chainBroken`. */
  readonly chainBreakDetail: string;
  /** Whether at least one chained line was found. */
  readonly chainEverStarted: boolean;
  /** Every chained line's own hash, in order — the ancestry oracle. */
  readonly chainedHashes: readonly string[];
}

/**
 * Assesses the on-disk chain for the recovery commands. Pure and read-only —
 * runs the shared {@link walkAuditChain} and projects out the fields the
 * `accept-truncation` command needs.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param secret - Per-project HMAC secret for verifying the sealed lines
 * @returns The assessment
 */
export function assessAuditChain(
  auditDir: string,
  secret: Buffer | null,
  acceptedRebaseline: AcceptedRebaseline | null = null,
): ChainAssessment {
  const walk = walkAuditChain(auditDir, secret, acceptedRebaseline);
  return {
    chainedLines: walk.chainedLines,
    lastHash: walk.lastHash,
    lastAt: walk.lastAt,
    malformedLines: walk.malformedLines,
    chainBroken: walk.chainBroken,
    chainBreakDetail: walk.chainBreakDetail,
    chainEverStarted: walk.chainEverStarted,
    chainedHashes: walk.chainedHashes,
  };
}

export function inspectAuditIntegrity(
  adapter: SqliteAdapter,
  auditDir: string,
  secret: Buffer | null = null,
  attestation: AttestationSource | null = null,
  contentAttestation: IntegrityCheck | null = null,
  acceptedRebaseline: AcceptedRebaseline | null = null,
  localTailDir: string | null = null,
): IntegrityCheck[] {
  const checks: IntegrityCheck[] = [];
  if (!existsSync(auditDir)) {
    checks.push({
      name: 'audit integrity',
      ok: true,
      detail: 'no audit directory',
      severity: 'warning',
    });
    return checks;
  }

  const stateRow = adapter
    .getDatabase()
    .prepare('SELECT event_count, last_event_at, chain_head_hash FROM audit_state WHERE id = 1')
    .get() as
    | { event_count: number; last_event_at: string | null; chain_head_hash: string | null }
    | undefined;

  if (stateRow === undefined) {
    checks.push({
      name: 'audit integrity',
      ok: false,
      detail: 'audit_state row missing — run `mnema migrate`',
      severity: 'error',
    });
    return checks;
  }

  const walk = walkAuditChain(auditDir, secret, acceptedRebaseline);
  const { malformedLines, unverifiable, lastHash, chainEverStarted } = walk;
  const chainBroken = walk.chainBroken;
  const chainBreakDetail = walk.chainBreakDetail;

  // The SQLite mirror tracks only THIS machine's tail (it is a per-machine
  // cache), so the count check compares `audit_state.event_count` against the
  // local tail's chained-line count — never the project-wide total, which a
  // sibling machine's tail (arrived by git merge) would inflate, falsely
  // flagging a drift the local writer never caused. When the caller does not
  // name a local tail (a clone with no tail of its own, or a degenerate
  // single-tail project), the whole walk IS the local count.
  const localWalk =
    localTailDir !== null ? walkTailChain(localTailDir, secret, acceptedRebaseline) : walk;
  const localChainedLines = localWalk.chainedLines;
  const localMalformedLines = localWalk.malformedLines;

  // Wrong-secret HINT (additive, never suppresses the tamper verdict). When
  // EVERY line fails the HMAC while the on-disk chain is otherwise internally
  // consistent (prev_hash continuity intact, and the only hash mismatches are
  // those HMAC failures), the most likely cause is the WRONG project secret —
  // an operator who imported another project's key. BUT this shape is NOT
  // cryptographically distinguishable from a content forgery of every line
  // whose stored hashes were left self-consistent (an attacker without the
  // secret can produce exactly this).
  // So we do NOT clear `chainBroken`: the `audit hash chain` verdict stays a
  // hard error, and we ADD an authenticity line that names the wrong-secret
  // possibility as the likely-but-unproven cause. Relabelling here is
  // additive guidance, never a downgrade of the integrity signal.
  const wrongSecretLikely =
    walk.hmacChecked > 0 &&
    walk.hmacFailed === walk.hmacChecked &&
    walk.hashMismatchCount === walk.hmacFailed &&
    walk.prevHashBreakCount === 0;

  // An empty chain (fresh project, nothing written yet): the integrity
  // check has nothing to verify. Report as a warning so the user knows it
  // is dormant until the first event.
  if (!chainEverStarted && stateRow.chain_head_hash === null) {
    checks.push({
      name: 'audit integrity',
      ok: true,
      detail: 'no audit events yet — the hash chain activates on the first write',
      severity: 'warning',
    });
    return checks;
  }

  // The writer commits the SQLite mirror BEFORE appending the JSONL line, so
  // a crash in that window leaves the mirror EXACTLY one event ahead of disk.
  // That is a recoverable state — BUT it is byte-for-byte indistinguishable
  // from a malicious truncation of the last line (both leave the mirror one
  // ahead with a self-consistent disk tail). So it is neither a clean pass
  // nor a hard tamper error: report it as a WARNING that names both causes,
  // so a crash isn't a screaming false-positive yet a truncation is never
  // silently green. Any other discrepancy (mirror behind disk, or ahead by
  // more than one) is unambiguous tampering/corruption and stays an error.
  // The one-ahead state is benign ONLY when it is a clean crash/truncation
  // shape. If the log ALSO contains a malformed line, the count shortfall is
  // exactly what an attacker uses to launder an interior deletion — a garbage
  // line masks a removed chained line while keeping the count off-by-one.
  // That is not the recoverable crash window; escalate to a hard error.
  const mirrorOneAhead = stateRow.event_count === localChainedLines + 1;
  const oneAheadIsClean = mirrorOneAhead && localMalformedLines === 0;
  if (localChainedLines === stateRow.event_count) {
    checks.push({
      name: 'audit event count',
      ok: true,
      detail: `${localChainedLines} chained events match audit_state.event_count`,
    });
  } else if (oneAheadIsClean) {
    checks.push({
      name: 'audit event count',
      ok: false,
      detail: `audit_state is one event ahead of disk (${stateRow.event_count} vs ${localChainedLines}) — either a crash between the mirror commit and the log append OR a truncation of the last line. A crash is reconciled at the next writer boot (the mirror is rewound to the on-disk tail); if this persists after a restart with no crash, investigate a truncation.`,
      severity: 'warning',
    });
  } else {
    const maskNote = mirrorOneAhead
      ? ' with malformed lines present — a possible masked interior deletion'
      : '';
    checks.push({
      name: 'audit event count',
      ok: false,
      detail: `disk has ${localChainedLines} chained events, audit_state has ${stateRow.event_count}${maskNote}`,
      severity: 'error',
    });
  }

  if (chainBroken) {
    checks.push({
      name: 'audit hash chain',
      ok: false,
      // Name the next step, not just the verdict: the operator seeing this
      // for the first time has no way to know the recovery tooling exists.
      detail: `${chainBreakDetail} — run \`mnema audit diagnose\` to locate the break; if it is mirror drift (not content tampering), \`mnema audit recover\` can heal it`,
      severity: 'error',
    });
  } else if (localWalk.lastHash !== stateRow.chain_head_hash && mirrorOneAhead) {
    // The mirror head points one past the local tail's disk tail — the same
    // ambiguous one-ahead state as the count check: a recoverable crash window
    // OR a last-line truncation. Warning (not a hard error, not a clean pass) —
    // the per-line chain on disk is itself consistent (chainBroken is false).
    checks.push({
      name: 'audit hash chain',
      ok: false,
      detail: `disk tail lags audit_state.chain_head_hash by one event (recoverable crash window, or a truncated last line); on-disk chain is self-consistent up to ${localWalk.lastHash?.slice(0, 12) ?? '(empty)'}…`,
      severity: 'warning',
    });
  } else if (localWalk.lastHash !== stateRow.chain_head_hash) {
    checks.push({
      name: 'audit hash chain',
      ok: false,
      detail: 'tail hash on disk does not match audit_state.chain_head_hash',
      severity: 'error',
    });
  } else {
    checks.push({
      name: 'audit hash chain',
      ok: true,
      detail: `verified up to ${lastHash?.slice(0, 12) ?? '(empty)'}…`,
    });
  }

  // Wrong-secret hint: every line failed the HMAC with intact continuity.
  // The `audit hash chain` verdict above already carries the hard error; this
  // ADDS the most likely explanation (wrong key) with its fix, WITHOUT
  // claiming the chain is clean — because a content forgery of every line
  // is indistinguishable from a key mismatch by these counts. A warning, so
  // it does not double-count as a second blocking error over the same lines
  // (the hash-chain error is the blocking signal). Only meaningful when a
  // secret was actually used (hmacChecked > 0), so it never fires for the
  // no-secret unverifiable case below.
  if (wrongSecretLikely) {
    checks.push({
      name: 'audit authenticity',
      ok: false,
      detail: `all ${walk.hmacChecked} line(s) failed HMAC verification while the chain is otherwise internally consistent — the LIKELY cause is the wrong project secret (e.g. another project's key was imported); verify you imported the correct secret (\`mnema project secret import\`). NOTE: this shape cannot be distinguished from a content forgery of every line, so the hash-chain error above still stands until the correct secret verifies clean.`,
      severity: 'warning',
    });
  }

  // Every line is HMAC-keyed with the project secret. Without the secret
  // (a clone that has not imported it) their authenticity cannot be
  // checked — report it as a warning, never a tamper error: the chain
  // consistency above still holds, only project-authenticity is unproven.
  if (unverifiable > 0) {
    checks.push({
      name: 'audit authenticity',
      ok: false,
      detail: `${unverifiable} line(s) could not be HMAC-verified — project secret not present. Import it with \`mnema project secret import\` to verify authenticity.`,
      severity: 'warning',
    });
  }

  // Machine attestation: the latest recorded head signature, verified
  // against the committed public key of its signer. This is SEPARATE from
  // chain consistency and HMAC authenticity — it attests WHICH machine
  // advanced the head. The head signature and the mirror head/count are BOTH
  // the local tail's, so the ancestry oracle must be the local tail's hashes
  // (`localWalk`), never the project-wide concatenation — a sibling tail's
  // hash must not be able to vouch for THIS tail's signed head. Only
  // meaningful once the chain has started, so it is skipped for an empty log.
  if (attestation !== null) {
    checks.push(
      attestationCheck(
        attestation,
        stateRow.chain_head_hash,
        stateRow.event_count,
        localWalk.chainedHashes,
      ),
    );
  }

  // Content attestation: committed `.att` coverage over the chained
  // events, verifiable by an anonymous clone with NO secret. Computed by the
  // caller (it needs the attestation modules) and passed in ready, so this
  // function gains no new dependency. The caller's builder does its OWN walk,
  // separate from this function's chain walk — a diagnostic/off-path caller
  // pays that second walk; acceptable off the write hot-path (a shared walk is
  // a possible future optimisation). Fail-CLOSED where it counts: a tamper,
  // gap, overlap, or truncation is ok:false/error; a merely-unattested tail or
  // a project that never attested is ok:true/warning (adoption is opt-in, so
  // it must not read as "chain not intact").
  if (contentAttestation !== null) {
    checks.push(contentAttestation);
  }

  if (malformedLines > 0) {
    checks.push({
      name: 'audit lines parse',
      ok: false,
      detail: `${malformedLines} unparseable line(s) — possible smokescreen for tampering`,
      severity: 'warning',
    });
  }

  return checks;
}

/** Outcome of {@link reconcileAuditState}. */
export type ReconcileResult =
  | {
      readonly ok: true;
      readonly beforeEventCount: number;
      readonly afterEventCount: number;
      readonly changed: boolean;
      readonly applied: boolean;
      /**
       * True when the correction dropped `event_count` below a recorded
       * signed checkpoint AND the head signature was re-recorded at the new
       * baseline (via the `reSign` callback). When false after such a drop,
       * no signer was available and attestation must be re-run once one is —
       * the CLI reports this so the operator is not misled into thinking
       * attestation is already green.
       */
      readonly reSigned: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Recomputes what `audit_state` SHOULD hold from a from-scratch walk of the
 * on-disk chain, and — when `apply` is true — writes it via
 * {@link AuditStateRepository.forceReconcile}. With `apply: false` (the
 * default, used for a dry-run preview) it computes the same verdict but
 * never touches the database.
 *
 * This is the recovery path for mirror drift: when two concurrent writers
 * commit the SQLite mirror in one order but append their JSONL lines in the
 * other, the mirror can end up counting more events than ever landed on disk.
 * `AuditStateRepository.reconcileToDisk` only self-heals the narrow one-ahead
 * crash shape; a multi-event drift like that is left for a human to resolve —
 * this is that resolution, made safe by refusing whenever the disk chain shows
 * signs of real tampering rather than mirror drift.
 *
 * Refuses (returns `{ ok: false }`) when:
 * - the chain has no chained lines yet (nothing to reconcile against)
 * - the on-disk chain is not internally consistent (a real `prev_hash`
 *   break or a hash mismatch) — reconciling would paper over genuine
 *   tampering rather than fix a benign mirror/disk split
 * - any line failed to parse — same reasoning as above (a possible
 *   smokescreen for a deleted line)
 * - a signed checkpoint (machine attestation) attests a higher `event_count`
 *   than the walk found AND its covered head is ABSENT from the on-disk chain
 *   — a genuine truncation/fork, which only the explicit `audit
 *   accept-truncation` command may accept, never an automatic reconcile
 *
 * When a signed checkpoint attests a higher count but its covered head is
 * still PRESENT on the disk chain (its `coveredHeadHash` appears in
 * `walk.chainedHashes`), the shortfall is interior drift — lines lost between
 * the signed head and the mirror's high-water mark — NOT a truncation of the
 * signed head. This is exactly what reconcile exists to heal: it falls
 * through and re-baselines, then re-records the head signature at the new
 * (lower) count via `reSign` so the attestation layer's retreat check passes
 * at the new baseline.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param state - The mirror repository to correct
 * @param secret - Per-project HMAC secret for verifying the sealed lines
 * @param signedCheckpoint - The recorded head signature's `eventCountAt` and
 *   `coveredHeadHash`, or `null` when none is recorded. The covered hash is
 *   the ancestry oracle that separates interior drift (heal) from a genuine
 *   truncation of the signed head (refuse).
 * @param apply - When true, persist the correction; when false, only compute
 *   the verdict (dry run)
 * @param reSign - Optional callback invoked AFTER an applied correction that
 *   dropped `event_count` below the recorded `signedCheckpoint.eventCountAt`.
 *   Given the new disk tail hash and count, it re-records the head signature
 *   at that lower baseline and returns true iff it signed (false when no
 *   signer is available). Without it — or when it returns false — audit_state
 *   is still corrected, but the attestation layer stays red until a signer
 *   re-attests. Never called on a dry run.
 * @returns The outcome — on success, the event count before/after, whether a
 *   correction was needed and applied, and whether the head was re-signed
 */
export function reconcileAuditState(
  auditDir: string,
  state: AuditStateRepository,
  secret: Buffer | null,
  signedCheckpoint: { eventCountAt: number; coveredHeadHash: string } | null,
  apply: boolean,
  reSign?: (newHeadHash: string, newEventCount: number) => boolean,
): ReconcileResult {
  const walk = walkAuditChain(auditDir, secret);

  if (walk.malformedLines > 0) {
    return {
      ok: false,
      reason: `${walk.malformedLines} unparseable line(s) on disk — resolve those before reconciling (possible tampering smokescreen)`,
    };
  }
  if (walk.chainBroken) {
    // A broken chain is tampering, not mirror drift — reconciling would hide
    // it. A deliberate re-baseline is the explicit `audit recover` path,
    // never an automatic reconcile.
    return {
      ok: false,
      reason: `on-disk chain is not internally consistent: ${walk.chainBreakDetail} — this is tampering, not mirror drift; reconciling would hide it. Run \`mnema audit diagnose\` for a full report.`,
    };
  }
  if (!walk.chainEverStarted) {
    return { ok: false, reason: 'no chained events on disk yet — nothing to reconcile' };
  }
  if (signedCheckpoint !== null && walk.chainedLines < signedCheckpoint.eventCountAt) {
    // The mirror/attestation high-water mark sits above the on-disk line
    // count. Two very different situations look identical by count alone:
    //   - the signed head is STILL on disk → the lost lines are interior to
    //     the chain (concurrent/git drift between the signed head and the
    //     mirror's count). This is exactly the drift reconcile heals: the
    //     attested head is present, nothing below it vanished.
    //   - the signed head is GONE from disk → the chain was truncated/forked
    //     below an attested head. Reconciling down would launder that, so it
    //     is refused here and left to the explicit `accept-truncation` path.
    // The ancestry oracle is membership in the walk's chained hashes — the
    // same oracle attestationCheck uses to accept an earlier checkpoint.
    const signedHeadOnDisk = walk.chainedHashes.includes(signedCheckpoint.coveredHeadHash);
    if (!signedHeadOnDisk) {
      return {
        ok: false,
        reason: `a signed checkpoint attests event ${signedCheckpoint.eventCountAt}, but the disk chain only holds ${walk.chainedLines} and the signed head is absent from disk — this is a truncation/fork below attested history, not mirror drift. If the history was deliberately rewritten, run \`mnema audit accept-truncation\` to re-baseline; reconcile never accepts a truncation.`,
      };
    }
    // signed head present → interior drift; fall through to reconcile.
  }

  const before = state.read();
  const changed = before.eventCount !== walk.chainedLines || before.chainHeadHash !== walk.lastHash;
  let reSigned = false;
  if (changed && apply) {
    state.forceReconcile(walk.chainedLines, walk.lastHash, walk.lastAt);
    // Re-attest at the new baseline when the correction dropped the count
    // below the recorded signed checkpoint: the durable head signature still
    // covers the old (higher) count, so the attestation layer's retreat check
    // (`currentEventCount < sig.eventCountAt`) would stay red until the head
    // is re-signed over the new tail. Only meaningful with a real tail to sign.
    if (
      reSign !== undefined &&
      signedCheckpoint !== null &&
      walk.chainedLines < signedCheckpoint.eventCountAt &&
      walk.lastHash !== null
    ) {
      reSigned = reSign(walk.lastHash, walk.chainedLines);
    }
  }
  return {
    ok: true,
    beforeEventCount: before.eventCount,
    afterEventCount: walk.chainedLines,
    changed,
    applied: changed && apply,
    reSigned,
  };
}

/**
 * Verdict for the machine-attestation layer. Distinguishes:
 * - no signature yet (warning — a fresh project, or below the first
 *   checkpoint interval);
 * - signer's public key missing from the repo (warning — cannot attest,
 *   not a tamper);
 * - a `.pub` file present under the signer's 12-char prefix but with a
 *   DIFFERENT full fingerprint (warning — cannot attest, and worth naming
 *   apart from a missing file: it may be a key substitution);
 * - signature does not verify (ERROR — the head or the signature was
 *   forged);
 * - verifies and covers the current head (ok);
 * - verifies and covers a genuine earlier checkpoint of the current chain
 *   (ok — the signature is valid for the head it covered; the next
 *   checkpoint will re-attest);
 * - verifies but the signed head is NOT on the current chain (ERROR — a
 *   valid signature over a head that lives nowhere in the on-disk chain,
 *   e.g. a fork/replay of another chain's signed head, or the events under
 *   it were rewritten out from under it while event_count held; distinct
 *   from a bad signature so the operator knows the SIGNATURE is genuine but
 *   points off-chain).
 *
 * @param chainedHashes - Every on-disk chained line's own hash, in order.
 *   The ancestry oracle: a signed head that is not the current head is only
 *   accepted when its `coveredHeadHash` appears here (a real prior checkpoint).
 */
function attestationCheck(
  attestation: AttestationSource,
  currentHead: string | null,
  currentEventCount: number,
  chainedHashes: readonly string[],
): IntegrityCheck {
  const sig = attestation.readHeadSignature();
  if (sig === null) {
    return {
      name: 'audit machine attestation',
      ok: true,
      detail: 'no head signature yet (signs at the next checkpoint interval)',
      severity: 'warning',
    };
  }

  const verified = attestation.verifyHeadSignature(sig);
  // A file WAS found under the signer's 12-char prefix, but its full
  // fingerprint is not the recorded signer's. Saying "not present" here (the
  // old behaviour) would send the operator hunting for a missing commit when
  // the real question is why a DIFFERENT key sits under the signer's name.
  if (verified === 'fingerprint_mismatch') {
    return {
      name: 'audit machine attestation',
      ok: false,
      detail: `signer ${sig.signerActor}'s public key file (…${sig.signerFingerprint.slice(0, 12)}) was found but its full fingerprint does not match the recorded signer — cannot attest (possible key substitution)`,
      severity: 'warning',
    };
  }
  if (verified === null) {
    return {
      name: 'audit machine attestation',
      ok: false,
      detail: `signer ${sig.signerActor}'s public key (…${sig.signerFingerprint.slice(0, 12)}) is not present in .mnema/keys — cannot attest`,
      severity: 'warning',
    };
  }
  if (!verified) {
    return {
      name: 'audit machine attestation',
      ok: false,
      detail: `head signature by ${sig.signerActor} does not verify — the head or the signature was tampered`,
      severity: 'error',
    };
  }

  // Rollback / truncation detection. A valid signature is durable, signed
  // evidence that the chain once reached `eventCountAt`. If the current chain
  // is SHORTER than a signed checkpoint, the count retreated below an attested
  // high-water mark. Whether that is tamper or benign turns on the SAME
  // ancestry oracle used below: is the signed head still on disk?
  //
  // Note on the accepted-truncation path: when an operator explicitly accepts
  // a deliberate truncation, the accept command RE-SIGNS the head at the new
  // (lower) baseline, so `sig.eventCountAt` becomes the new count and this
  // check passes naturally. This retreat check therefore reads NO waiver — the
  // simpler, safer design (a stale waiver can never suppress a fresh retreat
  // here; the truncation waiver is the human-decision audit trail, not the
  // thing that turns this green). A retreat that reaches this branch with no
  // matching re-sign is always a real, unaccepted rollback.
  if (currentEventCount < sig.eventCountAt) {
    // The signed head is still present in the walk. Nothing below the attested
    // head vanished — the count sits above the on-disk line count only because
    // the mirror/signature drifted ahead (interior drift). This is the benign
    // pre-reconcile state, not a rollback; downgrade to a warning that names
    // the heal. (In the reconcile flow the head is re-signed at the new
    // baseline, so a standalone verify BEFORE reconcile is the only place this
    // shows — and it must not read as tamper.)
    if (chainedHashes.includes(sig.coveredHeadHash)) {
      return {
        name: 'audit machine attestation',
        ok: false,
        detail: `signed count (${sig.eventCountAt} by ${sig.signerActor}) sits above the on-disk chain (${currentEventCount}), but the signed head is still present — interior drift, not a rollback; run \`mnema audit reconcile\` to realign and re-attest`,
        severity: 'warning',
      };
    }
    // The signed head is ABSENT from disk: the chain retreated below an
    // attested head that no longer exists — a genuine truncation/rollback the
    // count/hash checks alone cannot tell from a benign crash. The attacker
    // cannot forge or lower the signature without the machine key, so this
    // stays a hard, fail-closed tamper signal.
    return {
      name: 'audit machine attestation',
      ok: false,
      detail: `chain retreated below a signed checkpoint: a valid signature by ${sig.signerActor} covers event ${sig.eventCountAt}, but the chain now holds only ${currentEventCount} and the signed head is absent — the log was truncated/rolled back below attested history`,
      severity: 'error',
    };
  }

  if (sig.coveredHeadHash === currentHead) {
    return {
      name: 'audit machine attestation',
      ok: true,
      detail: `head signed by ${sig.signerActor} (…${sig.signerFingerprint.slice(0, 12)})`,
    };
  }

  // The signature is valid and event_count has not retreated, but it covers a
  // head OTHER than the current one. That is legitimate ONLY when it covers a
  // genuine earlier checkpoint of THIS chain — the head has since advanced and
  // the next checkpoint will re-attest. A verifying signature whose covered
  // head is absent from the on-disk chain is NOT that: the signature is
  // authentic (the machine key made it) but points at a head this chain never
  // held — a fork/replay of another chain's signed head, or the events beneath
  // it rewritten while the count was kept level. Accepting it (the old
  // behaviour) let a signed-but-off-chain head read green. Only a hash present
  // in the walk is a real ancestor, so gate on membership.
  const isEarlierCheckpoint = chainedHashes.includes(sig.coveredHeadHash);
  if (isEarlierCheckpoint) {
    return {
      name: 'audit machine attestation',
      ok: true,
      detail: `head signed by ${sig.signerActor} up to an earlier checkpoint (…${sig.coveredHeadHash.slice(0, 12)}); re-attests next checkpoint`,
    };
  }
  return {
    name: 'audit machine attestation',
    ok: false,
    detail: `a valid signature by ${sig.signerActor} covers head …${sig.coveredHeadHash.slice(0, 12)}, which is not on the current chain — the signature is authentic but its head is absent from the on-disk log (a fork/replay, or the events under it were rewritten)`,
    severity: 'error',
  };
}

/**
 * Caches {@link inspectAuditIntegrity} keyed by a cheap audit-file
 * signature ({@link auditFilesSignature}), recomputing only when the log
 * actually changes. Intended for hot repeated callers — notably the live
 * dashboard, which composes a snapshot per HTTP request and per tab
 * switch and would otherwise re-hash the whole chain every time.
 *
 * The signature is `stat`-based (mtime + size per file), so it flips on an
 * append, a rotation, AND an in-place edit of a past line that keeps the
 * size identical (the tampering shape) — the cache therefore never serves
 * a stale "integrity OK" over a mutated log. Non-dashboard callers
 * (`doctor`, `audit_verify`) keep calling {@link inspectAuditIntegrity}
 * directly and are unaffected.
 */
export class CachedAuditIntegrity {
  private signature: string | null = null;
  private cached: IntegrityCheck[] | null = null;

  /**
   * @param adapter - Open SQLite adapter
   * @param auditDir - Absolute path to `.mnema/audit/`
   * @param secrets - Per-project secret source, resolved at each `get()`
   *   (not construction) so importing the secret during the dashboard's
   *   lifetime takes effect. `null` for a secret-less setup.
   */
  /**
   * @param buildContentAttestation - Recomputes the content-attestation
   *   verdict on a cache miss. Injected as a function (not computed here) so
   *   this module does not import the attestation layer — which imports
   *   `IntegrityCheck` back from here — avoiding an import cycle. `null` omits
   *   the verdict (e.g. a surface that does not show it).
   */
  constructor(
    private readonly adapter: SqliteAdapter,
    private readonly auditDir: string,
    private readonly secrets: SecretSource | null = null,
    private readonly attestation: AttestationSource | null = null,
    private readonly buildContentAttestation: (() => IntegrityCheck) | null = null,
    // This machine's tail, so the count check compares the mirror against the
    // local tail (not the project-wide total). `null` folds to the whole walk.
    private readonly localTailDir: string | null = null,
  ) {}

  /**
   * Returns the integrity checks, recomputing only when the audit files,
   * the secret-presence, OR the recorded head signature changed since the
   * last call. The head signature lives in SQLite (not the audit files), so
   * it must be folded into the cache key explicitly — otherwise the
   * dashboard would serve a stale attestation verdict when a signature is
   * recorded/tampered without an audit-file change.
   *
   * @returns The (possibly cached) integrity checks
   */
  get(): IntegrityCheck[] {
    const secret = this.secrets?.read() ?? null;
    // The attestation verdict depends on the recorded head signature, which
    // is SQLite state outside the audit files — fold its identity (covered
    // head + signer fingerprint) into the key so a signature change (or a
    // direct tamper of the signature row) invalidates the cache.
    const sig = this.attestation?.readHeadSignature() ?? null;
    const sigKey =
      sig === null ? 'none' : `${sig.coveredHeadHash}:${sig.signerFingerprint}:${sig.signature}`;
    // The content-attestation verdict depends on the committed `.att` files,
    // which auditFilesSignature does NOT cover (it filters `.jsonl`). Fold the
    // attest-dir signature in, or a `reattest` (or an `.att` tamper) that left
    // the JSONL untouched would serve a stale verdict.
    const attKey =
      this.buildContentAttestation === null ? 'none' : attestFilesSignature(this.auditDir);
    const signature = `${auditFilesSignature(this.auditDir)}|s=${secret !== null}|a=${sigKey}|c=${attKey}`;
    if (this.cached !== null && signature === this.signature) {
      return this.cached;
    }
    const checks = inspectAuditIntegrity(
      this.adapter,
      this.auditDir,
      secret,
      this.attestation,
      this.buildContentAttestation?.() ?? null,
      null,
      this.localTailDir,
    );
    this.signature = signature;
    this.cached = checks;
    return checks;
  }
}
