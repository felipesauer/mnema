import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Lists the audit JSONL files in chain order: the archived monthly
 * segments (`YYYY-MM.jsonl`) oldest-first, then the active
 * `current.jsonl` last. Rotation only ever renames `current.jsonl` to a
 * past month, so the running chain is exactly
 * `[oldest month … newest month, current]`.
 *
 * This is the single source of truth for audit-file ordering, shared by
 * the integrity walk and the query reader. A plain lexicographic sort
 * happens to work only because `current` sorts after digits; forcing
 * `current` last makes the order correct and robust to any future
 * segment naming (e.g. a segment that would sort *after* `current`).
 *
 * @param auditDir - Directory holding the audit log files
 * @returns Absolute paths in chain order (empty if the dir is absent)
 */
export function orderedAuditFiles(auditDir: string): string[] {
  if (!existsSync(auditDir)) return [];
  const names = readdirSync(auditDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
    .map((d) => d.name);
  const current = names.filter((n) => n === 'current.jsonl');
  const archived = names.filter((n) => n !== 'current.jsonl').sort();
  return [...archived, ...current].map((n) => path.join(auditDir, n));
}

/**
 * The chain TAILS under a project audit dir. Each machine appends only
 * to its own `m-<12 hex>/` sub-directory (the per-machine chain that
 * makes the git union-merge interleaving impossible by construction).
 * A directory whose top level itself holds `.jsonl` files is treated as
 * one degenerate tail — the single-machine shape every existing fixture
 * (and a freshly-migrated project) naturally has.
 *
 * @param auditDir - Directory holding the audit tails
 * @returns Absolute tail-directory paths, root tail first, then `m-*`
 *   tails sorted by name (deterministic aggregation order)
 */
export function auditTailDirs(auditDir: string): string[] {
  if (!existsSync(auditDir)) return [];
  const entries = readdirSync(auditDir, { withFileTypes: true });
  const tails: string[] = [];
  if (entries.some((d) => d.isFile() && d.name.endsWith('.jsonl'))) {
    tails.push(auditDir);
  }
  const machineTails = entries
    .filter((d) => d.isDirectory() && /^m-[0-9a-f]{12}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  tails.push(...machineTails.map((n) => path.join(auditDir, n)));
  return tails;
}

/**
 * A cheap content-change signature for the audit files: each file's
 * `name:mtimeMs:size`, joined. Any mutation — an append, a rotation, or
 * an in-place edit of a past line — changes an mtime (and usually the
 * size), so the signature changes. This lets a caller cache an expensive
 * derivation (e.g. the full hash-chain verification) and recompute only
 * when the log actually changed, WITHOUT re-reading the file contents.
 *
 * Crucially it flips on an in-place edit that keeps the size identical
 * (the tampering shape): mtime still advances. `stat` only — no read.
 *
 * @param auditDir - Directory holding the audit log files
 * @returns A signature string (`""` when the dir is absent/empty)
 */
export function auditFilesSignature(auditDir: string): string {
  if (!existsSync(auditDir)) return '';
  // Cover EVERY machine tail: the JSONL lives under `m-<id>/`, so a signature
  // that only listed the root dir would never flip when an event is appended
  // to a tail — a cache keyed on it would serve a stale verdict. Qualify each
  // entry with its tail so two tails cannot alias to the same key.
  return auditTailDirs(auditDir)
    .flatMap((tail) =>
      orderedAuditFiles(tail).map((file) => {
        const label = `${path.basename(tail)}/${path.basename(file)}`;
        try {
          const s = statSync(file);
          return `${label}:${s.mtimeMs}:${s.size}`;
        } catch {
          // Raced away between listing and stat — treat as a change.
          return `${label}:gone`;
        }
      }),
    )
    .join('|');
}

/**
 * A `stat`-based change signature for the committed attestations under
 * `<auditDir>/attest/*.att`. The counterpart to {@link auditFilesSignature},
 * which covers only `*.jsonl` and so never flips when an `.att` is
 * added/edited/removed. A cache keyed on the integrity verdict must fold this
 * in, or it would serve a stale content-attestation verdict after a `reattest`
 * (or a tamper of an `.att`) that left the JSONL untouched.
 *
 * Same residual as {@link auditFilesSignature}: an in-place edit that keeps
 * the size AND resets the mtime (`touch -m`) would not flip the key, so a
 * cache could serve a pre-tamper verdict. This is an accepted property of a
 * stat-based signature (a content hash would close it); the authoritative,
 * non-cached path (`audit verify`, `doctor`) always recomputes and catches it.
 *
 * @param auditDir - Directory holding the audit log files
 * @returns A signature string (`""` when the attest dir is absent/empty)
 */
export function attestFilesSignature(auditDir: string): string {
  const dir = path.join(auditDir, 'attest');
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((name) => name.endsWith('.att'))
    .sort()
    .map((name) => {
      try {
        const s = statSync(path.join(dir, name));
        return `${name}:${s.mtimeMs}:${s.size}`;
      } catch {
        return `${name}:gone`;
      }
    })
    .join('|');
}
