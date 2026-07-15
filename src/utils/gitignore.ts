import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The `.gitignore` block Mnema writes. Only the **state** directory and the
 * personal `config.local.json` override are ignored — the state dir holds the
 * SQLite cache, the sync buffer and attachment blobs, all derived and
 * rebuildable from the markdown via `mnema sync`; `config.local.json` is a
 * per-user override that must not reach the team's repo. Everything else under
 * `.mnema/` (the backlog / roadmap / sprint / memory / skill markdown and the
 * `audit/` log) is the version-controlled record of the work and is meant to
 * be committed. The comment lines double as the in-repo documentation of that
 * split. Shared by `mnema init` (first scaffold) and `mnema upgrade` (retrofit
 * onto a project initialised by a version that predates the current block).
 *
 * @param statePath - The configured state dir (e.g. `.mnema/state`)
 * @param auditPath - The configured audit dir (e.g. `.mnema/audit`)
 * @returns The block text (no trailing newline)
 */
export function gitignoreBlock(statePath: string, auditPath: string): string {
  const entry = `${statePath.replace(/\/$/, '')}/`;
  return [
    '# mnema: ignore only the local cache (SQLite db, sync buffer,',
    '# attachments) and the personal config.local.json override. The',
    '# backlog/roadmap/sprint/memory/skill markdown and the audit log',
    '# under .mnema/ are the source of truth — commit them. The cache is',
    '# rebuildable from that markdown via `mnema sync`.',
    entry,
    '.mnema/config.local.json',
    // The audit dir is committed, but the cross-process write lock in it
    // is transient local state — never version it.
    `${auditPath.replace(/\/$/, '')}/.audit.lock*`,
  ].join('\n');
}

/**
 * Returns true when `gitignoreBody` already contains a line that ignores an
 * ancestor of `entry`. Intentionally simple: walks up the path one segment at
 * a time and looks for a literal match — good enough for the defaults Mnema
 * writes; users with custom negation rules edit the file themselves.
 */
function covers(gitignoreBody: string, entry: string): boolean {
  const segments = entry
    .replace(/\/$/, '')
    .split('/')
    .filter((s) => s.length > 0);
  for (let i = 1; i < segments.length; i += 1) {
    const ancestor = `${segments.slice(0, i).join('/')}/`;
    if (gitignoreBody.includes(ancestor)) return true;
  }
  return false;
}

/** The `.audit.lock*` marker line the current block adds (a later-vintage line). */
function auditLockMarker(auditPath: string): string {
  return `${auditPath.replace(/\/$/, '')}/.audit.lock*`;
}

/**
 * Ensures the root `.gitignore` carries Mnema's managed block, writing the
 * file when absent and appending the block when a file exists without it.
 * Idempotent for the state entry (the historical marker), AND it retrofits the
 * later `.audit.lock*` line onto an older two-line block that predates it — so
 * an early-vintage adopter's `.gitignore` converges on the current template
 * without duplicating the whole block.
 *
 * @param cwd - Project root holding `.gitignore`
 * @param statePath - The configured state dir
 * @param auditPath - The configured audit dir
 * @returns `'created'` (file written), `'appended'` (managed block added),
 *   `'retrofitted'` (older block gained the missing `.audit.lock*` line), or
 *   `'present'` (already current)
 */
export function ensureGitignore(
  cwd: string,
  statePath: string,
  auditPath: string,
): 'created' | 'appended' | 'retrofitted' | 'present' {
  const file = path.join(cwd, '.gitignore');
  const entry = `${statePath.replace(/\/$/, '')}/`;
  const lockMarker = auditLockMarker(auditPath);
  const block = gitignoreBlock(statePath, auditPath);

  if (!existsSync(file)) {
    writeFileSync(file, `${block}\n`, 'utf-8');
    return 'created';
  }

  const current = readFileSync(file, 'utf-8');
  const hasStateEntry = current.includes(entry) || covers(current, entry);
  const hasLockMarker = current.split('\n').some((line) => line.trim() === lockMarker);

  if (hasStateEntry && hasLockMarker) return 'present';

  // The state dir is already ignored (older vintage) but the transient
  // audit-lock line is missing → add just that line, not the whole block,
  // to avoid a duplicate state entry.
  if (hasStateEntry && !hasLockMarker) {
    appendFileSync(
      file,
      `\n# mnema: the audit dir is committed, but its transient write lock is not.\n${lockMarker}\n`,
      'utf-8',
    );
    return 'retrofitted';
  }

  // No managed block at all → append the full block.
  appendFileSync(file, `\n${block}\n`, 'utf-8');
  return 'appended';
}

/**
 * True when `relPath` (a repo-relative, forward-slash path) is one the managed
 * block intends to ignore: it lives under the state dir, is the personal
 * `config.local.json` override, or is a transient `.audit.lock*` file under the
 * audit dir. Pure and self-contained — it does NOT read the `.gitignore` on
 * disk; it answers "would the *current template* ignore this?" so `mnema
 * doctor` can flag a file a repo committed before the rule existed (untracking
 * rewrites history, so reconciling the rules never does it — the fix stays an
 * explicit user action).
 *
 * Intentionally simple, matching {@link covers}: whole-line for the literal
 * override, prefix for the state dir, and prefix + `.audit.lock` basename for
 * the lock marker. Not a full gitignore engine.
 *
 * @param relPath - Repo-relative path, forward slashes (as `git ls-files` emits)
 * @param statePath - The configured state dir (e.g. `.mnema/state`)
 * @param auditPath - The configured audit dir (e.g. `.mnema/audit`)
 */
export function managedBlockIgnores(
  relPath: string,
  statePath: string,
  auditPath: string,
): boolean {
  const p = relPath.replace(/^\.\//, '');
  const stateDir = `${statePath.replace(/\/$/, '')}/`;
  if (p === '.mnema/config.local.json') return true;
  if (p.startsWith(stateDir)) return true;
  // `.audit.lock*` is a glob: match the lock file and any suffixed variant
  // (e.g. `.audit.lock.pid`) directly under the audit dir.
  const auditDir = `${auditPath.replace(/\/$/, '')}/`;
  if (p.startsWith(auditDir) && p.slice(auditDir.length).startsWith('.audit.lock')) return true;
  return false;
}

/**
 * True when the root `.gitignore` is already on the current managed template:
 * it ignores the state dir AND carries the `.audit.lock*` line. False when the
 * file is missing, has no managed block, or is an older block missing the lock
 * line (i.e. a retrofit is due).
 */
export function hasCurrentGitignore(cwd: string, statePath: string, auditPath: string): boolean {
  const file = path.join(cwd, '.gitignore');
  if (!existsSync(file)) return false;
  const current = readFileSync(file, 'utf-8');
  const entry = `${statePath.replace(/\/$/, '')}/`;
  const hasStateEntry = current.includes(entry) || covers(current, entry);
  const hasLockMarker = current
    .split('\n')
    .some((line) => line.trim() === auditLockMarker(auditPath));
  return hasStateEntry && hasLockMarker;
}
