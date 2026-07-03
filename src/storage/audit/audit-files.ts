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
  return orderedAuditFiles(auditDir)
    .map((file) => {
      try {
        const s = statSync(file);
        return `${path.basename(file)}:${s.mtimeMs}:${s.size}`;
      } catch {
        // Raced away between listing and stat — treat as a change.
        return `${path.basename(file)}:gone`;
      }
    })
    .join('|');
}
