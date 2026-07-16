import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';

/**
 * The directory (under the backlog) where archived terminal-task mirrors are
 * moved. Dot-prefixed at the backlog level, mirroring the `.quarantine`
 * convention: every backlog scanner (sync rebuild, orphan prune, quarantine
 * sweep, drift checks) is non-recursive AND skips `.`-prefixed directories, so
 * a mirror moved here is invisible to them and stays put across `mnema sync`
 * and `mnema doctor --prune-orphans`. State is preserved as a subfolder
 * (`.archive/DONE/`, `.archive/CANCELED/`).
 */
export const ARCHIVE_DIRNAME = '.archive';

/** One terminal-task mirror the archive would move (or moved). */
export interface ArchivedMirror {
  readonly key: string;
  /** The terminal state whose folder the mirror was in (also the archive subfolder). */
  readonly state: string;
  /** Absolute path the mirror was moved from (`backlog/<STATE>/<KEY>.md`). */
  readonly fromPath: string;
  /** Absolute path the mirror was moved to (`backlog/.archive/<STATE>/<KEY>.md`, `.N` on collision). */
  readonly toPath: string;
}

/** Structured result shared by both CLI surfaces so they report identically. */
export interface ArchiveResult {
  readonly archived: readonly ArchivedMirror[];
  readonly movedCount: number;
  /** True when nothing was moved — the plan was only computed. */
  readonly dryRun: boolean;
}

/** Options for {@link ArchiveService.archiveTerminalMirrors}. */
export interface ArchiveOptions {
  /** Terminal tasks whose `updated_at` is older than this many months are archived. */
  readonly months: number;
  /** When true (the default), computes the plan without moving any file. */
  readonly dryRun?: boolean;
  /**
   * Clock used to derive the cutoff. Injected so the age boundary is testable;
   * production callers omit it and get `new Date()`. Never resolved inline via
   * `Date.now()` — that would be untestable.
   */
  readonly now?: Date;
}

/**
 * Filesystem layout the archive service needs — the project root and the
 * (project-relative) backlog directory, matching {@link SyncService}'s paths.
 */
export interface ArchivePaths {
  readonly projectRoot: string;
  readonly backlogDir: string;
}

/**
 * Moves the markdown mirrors of old terminal (DONE/CANCELED) tasks out of the
 * active state folders and into `backlog/.archive/<STATE>/`.
 *
 * DONE and CANCELED are live states with live SQLite rows, so their mirrors are
 * never deleted (deletion is gated on the row being gone) and a committed
 * backlog accrues every finished task forever. This is the opt-in, dry-run-by-
 * default step that relocates the stale ones. It NEVER deletes and NEVER
 * touches the SQLite row — the row is the source of truth, and the dot-prefixed
 * archive folder keeps the moved file inert to every other backlog scanner, so
 * a later `sync`/rebuild neither resurrects the mirror in its state folder nor
 * removes the archived copy.
 */
export class ArchiveService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly paths: ArchivePaths,
  ) {}

  /**
   * Selects terminal tasks whose close time is older than the cutoff
   * (`now` minus `months`) and moves each one's mirror from
   * `backlog/<STATE>/<KEY>.md` to `backlog/.archive/<STATE>/<KEY>.md`.
   *
   * The age signal is `closed_at` (stamped when the task entered its terminal
   * state), falling back to `updated_at` for tasks closed before it was
   * recorded — so re-editing a long-closed task no longer resets its clock. A
   * move uses `renameSync` (like the quarantine sweep); on a name collision in
   * the archive the destination gets a `.N` suffix before `.md`. Both source
   * and destination are asserted to stay within the backlog root, so a hostile
   * state string cannot steer a move outside it. A mirror whose file is already
   * absent is skipped (the row is authoritative; a missing file is not an error
   * here).
   *
   * @param options - Cutoff in months, dry-run flag, and injectable clock
   * @returns The plan (dry run) or the moves performed, in the shared shape
   */
  archiveTerminalMirrors(options: ArchiveOptions): ArchiveResult {
    const dryRun = options.dryRun ?? true;
    const now = options.now ?? new Date();
    const cutoff = subtractMonths(now, options.months).toISOString();

    const backlogRoot = path.resolve(this.paths.projectRoot, this.paths.backlogDir);
    const archived: ArchivedMirror[] = [];

    for (const task of this.taskRepository.findTerminalUpdatedBefore(cutoff)) {
      const fromPath = this.pathForStateMirror(backlogRoot, task.state, task.key);
      // The row is the source of truth; a missing mirror is nothing to move.
      if (!existsSync(fromPath)) continue;

      const destDir = path.resolve(backlogRoot, ARCHIVE_DIRNAME, task.state);
      // Defence in depth: a crafted state (`../../etc`) must not let a move
      // escape the backlog root, on either the source or the destination side.
      if (!isWithin(backlogRoot, fromPath) || !isWithin(backlogRoot, destDir)) {
        throw new Error(
          `refusing to archive task ${task.key}: state '${task.state}' escapes the backlog directory`,
        );
      }

      const toPath = this.resolveDestination(destDir, task.key, dryRun);
      if (!dryRun) {
        mkdirSync(destDir, { recursive: true });
        renameSync(fromPath, toPath);
      }
      archived.push({ key: task.key, state: task.state, fromPath, toPath });
    }

    return { archived, movedCount: dryRun ? 0 : archived.length, dryRun };
  }

  /** Absolute `backlog/<STATE>/<KEY>.md`. */
  private pathForStateMirror(backlogRoot: string, state: string, key: string): string {
    return path.resolve(backlogRoot, state, `${key}.md`);
  }

  /**
   * The archive destination for a key, disambiguated on collision the same way
   * the quarantine sweep does: `<KEY>.md`, then `<KEY>.1.md`, `<KEY>.2.md`, …
   * In a dry run the filesystem is not probed for existing `.N` names — the
   * reported path is the first candidate, since nothing is actually written.
   */
  private resolveDestination(destDir: string, key: string, dryRun: boolean): string {
    const base = path.join(destDir, `${key}.md`);
    if (dryRun) return base;
    let dest = base;
    let n = 1;
    while (existsSync(dest)) {
      dest = path.join(destDir, `${key}.${n}.md`);
      n += 1;
    }
    return dest;
  }
}

/**
 * `now` shifted back by `months` calendar months. Uses `setMonth`, so it
 * follows JS date arithmetic (a day-of-month that does not exist in the target
 * month rolls forward, e.g. Mar 31 − 1 month → Mar 3); this is a coarse
 * retention boundary, not an exact-day cutoff, so that rollover is acceptable
 * and consistent.
 *
 * @param now - Reference instant
 * @param months - Whole months to subtract
 */
function subtractMonths(now: Date, months: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

/**
 * True when `target` is `root` itself or lives strictly inside it, after
 * resolving both. Keeps the archive move contained to the backlog directory
 * even when a task's state is hostile (`../../…`). Mirrors the guard
 * {@link SyncService} uses on task-mirror writes.
 *
 * @param root - The containing directory (already absolute)
 * @param target - The candidate path (already absolute)
 */
function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
