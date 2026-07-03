import { existsSync, readdirSync } from 'node:fs';
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
