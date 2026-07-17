import semver from 'semver';

import type { SqliteAdapter } from './sqlite-adapter.js';

/**
 * What a step's `run()` returns.
 *
 * - A plain string means the step completed and should be recorded (the string
 *   is the human-readable outcome).
 * - `{ applied: false, message }` means the step ran but could NOT complete its
 *   job (e.g. the audit reconcile refused because the chain is broken). It is
 *   surfaced but NOT recorded, so it stays eligible to be offered again once
 *   the underlying blocker is resolved — matching the pre-registry behavior
 *   where such a step re-appeared on the next `upgrade`.
 */
export type RemediationResult = string | { readonly applied: false; readonly message: string };

/**
 * A one-shot DATA remediation whose expiry is bounded by a project VERSION.
 *
 * These correct state that a specific range of versions produced (a field
 * added late, a marker file introduced late). Once the project has moved past
 * `retiresAfter`, no project this new could ever carry the defect, so the step
 * is safe to skip on a fresh clone even if its row is absent — there is nothing
 * left to fix. `retiresAfter` is REQUIRED here and meaningless anywhere else,
 * which is why only this variant carries it.
 */
export interface VersionJumpRemediation {
  readonly name: string;
  readonly kind: 'version-jump';
  /** Semver at which the step was introduced (documentation/ordering aid). */
  readonly introducedIn: string;
  /**
   * Semver after which the defect can no longer exist. A project whose version
   * is strictly greater is skipped even with no recorded row.
   */
  readonly retiresAfter: string;
  readonly run: () => RemediationResult;
}

/**
 * A one-shot DATA remediation whose need is a CLONE CONDITION, not a version.
 *
 * `.mnema/state/` is git-ignored, so every fresh clone rebuilds an EMPTY
 * database — regardless of how new the project's version is. A step that heals
 * that empty-DB-vs-committed-disk gap (rebuilding rows from committed markdown,
 * reconciling the audit mirror to the committed chain) must therefore run on
 * every clone and can NEVER expire. It is permanent by construction: it carries
 * no `retiresAfter`, and the type forbids one, so the "expires past a window"
 * illegal state cannot even be written down.
 */
export interface CloneConditionRemediation {
  readonly name: string;
  readonly kind: 'clone-condition';
  /** Semver at which the step was introduced (documentation/ordering aid). */
  readonly introducedIn: string;
  /**
   * A clone-condition step is permanent. The field is typed `never` so a call
   * site that tries to set `retiresAfter` on this variant is a compile error —
   * the illegal "clone-condition that expires" is unrepresentable. It is never
   * read at runtime.
   */
  readonly retiresAfter?: never;
  readonly run: () => RemediationResult;
}

/**
 * A remediation step descriptor. The `kind` discriminant gates expiry:
 *
 * - `version-jump` MUST carry a `retiresAfter` and MAY be skipped once the
 *   project version is past it (the defect can no longer exist).
 * - `clone-condition` carries no `retiresAfter` (the type forbids it) and is
 *   never expired — it runs on every fresh clone because the git-ignored
 *   database is rebuilt empty regardless of version.
 */
export type RemediationStep = VersionJumpRemediation | CloneConditionRemediation;

/** The outcome of a single step during a registry run. */
export interface RemediationOutcome {
  readonly name: string;
  /** Present when the step ran; the human-readable string its `run()` produced. */
  readonly message?: string;
  /** True when the step ran AND recorded itself (it completed its job). */
  readonly recorded?: boolean;
  /** Why the step did not run, when it was skipped. */
  readonly skipped?: 'already-applied' | 'expired';
}

/**
 * Runs one-shot DATA remediation steps with a run-once-and-record lifecycle,
 * mirroring {@link MigrationRunner} over `applied_upgrades`.
 *
 * A step whose `name` already has a row is skipped (it has run before and is a
 * verifiable no-op). A `version-jump` step past its `retiresAfter` is skipped
 * even with no row (the defect cannot exist at this version). Everything else
 * runs, and on success records its own row so it becomes a no-op next time.
 */
export class RemediationRunner {
  /**
   * Runs the pending steps in the given order against `adapter`.
   *
   * @param adapter - SQLite adapter (its DB must already carry the
   *   `applied_upgrades` table, baked into the 001 baseline)
   * @param steps - Step descriptors, in the order they should run
   * @param projectVersion - The project's current version, used to decide
   *   whether a `version-jump` step has retired. A `clone-condition` step
   *   never consults it.
   * @returns One outcome per step, in order
   */
  run(
    adapter: SqliteAdapter,
    steps: readonly RemediationStep[],
    projectVersion: string,
  ): readonly RemediationOutcome[] {
    const applied = new Set(this.loadApplied(adapter));
    const outcomes: RemediationOutcome[] = [];

    for (const step of steps) {
      // Already recorded → verifiable no-op, never re-run.
      if (applied.has(step.name)) {
        outcomes.push({ name: step.name, skipped: 'already-applied' });
        continue;
      }

      // Expiry is gated by kind: ONLY a version-jump step can retire. A
      // clone-condition step is permanent — it must run on every fresh clone
      // regardless of version, so it is never tested against a window.
      if (step.kind === 'version-jump' && this.hasRetired(step, projectVersion)) {
        outcomes.push({ name: step.name, skipped: 'expired' });
        continue;
      }

      const result = step.run();
      // A step that ran but could not complete its job (`applied: false`) is
      // surfaced but NOT recorded, so it stays eligible next time — exactly
      // how the pre-registry probe re-offered it while the blocker persisted.
      if (typeof result !== 'string') {
        outcomes.push({ name: step.name, message: result.message, recorded: false });
        continue;
      }
      this.record(adapter, step.name);
      applied.add(step.name);
      outcomes.push({ name: step.name, message: result, recorded: true });
    }

    return outcomes;
  }

  /**
   * True when a `version-jump` step's `retiresAfter` is strictly below the
   * project version — the defect can no longer exist, so the step is skipped
   * even with no recorded row. Uses `semver.coerce` so a prerelease-dressed
   * project version (`0.14.0-alpha.2`) still compares against a plain
   * `retiresAfter` (`0.13.0`).
   */
  private hasRetired(step: VersionJumpRemediation, projectVersion: string): boolean {
    const current = semver.coerce(projectVersion);
    const boundary = semver.coerce(step.retiresAfter);
    if (current === null || boundary === null) return false;
    return semver.gt(current, boundary);
  }

  /**
   * Reads the names recorded in `applied_upgrades`. Returns an empty array
   * when the table does not yet exist (a DB not migrated to 036).
   *
   * @param adapter - SQLite adapter to query
   * @returns Recorded remediation names
   */
  loadApplied(adapter: SqliteAdapter): readonly string[] {
    const database = adapter.getDatabase();
    const exists = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'applied_upgrades'")
      .get();
    if (exists === undefined) return [];

    const rows = database
      .prepare('SELECT script AS name FROM applied_upgrades ORDER BY script')
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  /** Records a step as applied. `INSERT OR IGNORE` keeps a re-run idempotent. */
  private record(adapter: SqliteAdapter, name: string): void {
    adapter
      .getDatabase()
      .prepare('INSERT OR IGNORE INTO applied_upgrades (script) VALUES (?)')
      .run(name);
  }
}
