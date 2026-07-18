import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The `.gitattributes` block that makes the append-only audit log merge with
 * the `union` driver: parallel branches that both append to the tail keep BOTH
 * sides instead of conflicting. In the common case (one machine, or branches
 * that don't both append) it simply removes conflict noise with no downside.
 *
 * IMPORTANT — union is a merge DRIVER: it runs during a three-way merge (and
 * `git merge --squash`, verified), so it blunts the parallel-append case for
 * local and CLI merges. It is NOT a guarantee against every host's
 * server-side "squash and merge", which may apply the PR as a patch without
 * invoking the driver. So this is defense-in-depth: the authoritative
 * protection against a stale-snapshot merge stranding duplicate/rewound audit
 * state is the sync duplicate-mirror guard and the doctor duplicate/delta
 * checks, not this attribute.
 *
 * @param auditPath - The configured audit dir (e.g. `.mnema/audit`), trailing
 *   slash tolerated
 * @returns The block text (no trailing newline)
 */
export function gitattributesLines(auditPath: string): string {
  const dir = auditPath.replace(/\/$/, '');
  return [
    '# mnema: the audit log is append-only; merge with union so parallel',
    '# branches keep both sides instead of conflicting on the tail. The `**`',
    "# covers each machine's per-machine tail directory (`m-<id>/`).",
    `${dir}/**/*.jsonl merge=union`,
  ].join('\n');
}

/**
 * Ensures the root `.gitattributes` carries the audit-log `merge=union` block,
 * writing the file when absent and appending the block when a file exists
 * without it. Idempotent: the marker line is matched exactly, so a second call
 * is a no-op and the block is never duplicated. Shared by `mnema init` (first
 * scaffold) and `mnema upgrade` (retrofit onto a project initialised by a
 * version that predates the block).
 *
 * @param cwd - Project root holding `.gitattributes`
 * @param auditPath - The configured audit dir
 * @returns `'created'` when the file was written, `'appended'` when the block
 *   was added to an existing file, `'present'` when it was already there
 */
/** The exact `.gitattributes` rule line for an audit path (no comments). */
function unionMarker(auditPath: string): string {
  return `${auditPath.replace(/\/$/, '')}/**/*.jsonl merge=union`;
}

/**
 * True when `content` contains the marker as a WHOLE rule line. A plain
 * substring test would false-positive when the configured audit path is a
 * suffix of a deeper unrelated rule already in the file (e.g. a bare `audit`
 * marker matching an existing `packages/foo/audit/*.jsonl merge=union`), which
 * would skip writing the rule the top-level dir actually needs. Matching the
 * trimmed line exactly avoids that.
 */
function containsMarkerLine(content: string, marker: string): boolean {
  return content.split('\n').some((line) => line.trim() === marker);
}

export function ensureGitattributes(
  cwd: string,
  auditPath: string,
): 'created' | 'appended' | 'present' {
  const file = path.join(cwd, '.gitattributes');
  const marker = unionMarker(auditPath);
  const block = gitattributesLines(auditPath);
  if (!existsSync(file)) {
    writeFileSync(file, `${block}\n`, 'utf-8');
    return 'created';
  }
  if (containsMarkerLine(readFileSync(file, 'utf-8'), marker)) return 'present';
  appendFileSync(file, `\n${block}\n`, 'utf-8');
  return 'appended';
}

/** Whether the root `.gitattributes` already carries the audit `merge=union` rule line. */
export function hasGitattributesUnion(cwd: string, auditPath: string): boolean {
  const file = path.join(cwd, '.gitattributes');
  if (!existsSync(file)) return false;
  return containsMarkerLine(readFileSync(file, 'utf-8'), unionMarker(auditPath));
}
