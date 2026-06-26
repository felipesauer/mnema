import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import { ConfigLoader } from '../../config/config-loader.js';
import {
  formatWorkflowIssues,
  WorkflowInvalidError,
  WorkflowLoader,
} from '../../domain/state-machine/workflow-loader.js';
import { ErrorCode, ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
import { migrationDirs } from '../../utils/asset-paths.js';
import { pc } from '../../utils/colors.js';
import { checkVersion } from '../../utils/version-check.js';
import { resolveProjectRoot } from '../project-root.js';

/**
 * One row in the doctor checklist, also returned by exported helpers
 * such as {@link inspectMigrationDrift} so tests can assert on the
 * structured form without rendering it.
 */
/**
 * Severity bucket for a check. `error` fails the doctor exit code;
 * `warning` keeps exit 0 but renders a yellow `⚠` so the line stands
 * out in the checklist. Defaults to `error` when omitted.
 */
export type DoctorSeverity = 'error' | 'warning';

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly severity?: DoctorSeverity;
}

/**
 * Registers `mnema doctor`, a read-only health check.
 *
 * Verifies:
 * - `mnema.config.json` exists and parses
 * - the running Mnema version satisfies `mnema_version`
 * - the active workflow JSON loads cleanly
 * - configured paths exist on disk
 * - the SQLite database opens
 */
export class DoctorCommand {
  /**
   * Attaches the `doctor` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('doctor')
      .description(
        'Run a read-only diagnostic check on the current project. ' +
          '`--rebuild-mirrors` is a recovery operation that runs *instead of* ' +
          'the regular checks (run plain `mnema doctor` first to see drift, then ' +
          '`--rebuild-mirrors` to act on it).',
      )
      .option(
        '--rebuild-mirrors',
        'Recovery: recreate missing `.md` files under paths.skills and paths.memory from the SQLite rows. Skips the regular doctor checks.',
      )
      .option(
        '--prune-orphans',
        'When combined with --rebuild-mirrors, also delete `.md` files whose slug has no matching SQLite row',
      )
      .action(
        async (options: { readonly rebuildMirrors?: boolean; readonly pruneOrphans?: boolean }) => {
          if (options.rebuildMirrors === true) {
            const exit = await this.rebuildMirrors(options.pruneOrphans === true);
            process.exit(exit);
          }
          const exit = this.run();
          process.exit(exit);
        },
      );
  }

  /**
   * Rebuilds skill/memory `.md` mirror files for every SQLite row that
   * has no matching file on disk. Existing files are left alone — this
   * is a one-way "heal drift" operation, not a reformat. When
   * `pruneOrphans` is true, also deletes mirrors whose slug has no
   * matching SQLite row (FS→DB drift).
   *
   * @param pruneOrphans - Whether to delete orphan `.md` files
   * @returns Exit code (`0` on success, `3` if the context could not be
   *   opened)
   */
  private async rebuildMirrors(pruneOrphans: boolean): Promise<number> {
    const { withCliContext } = await import('../cli-context.js');
    const fsMod = await import('node:fs');
    const pathMod = await import('node:path');
    let exit = ExitCode.Success;
    await withCliContext(({ container, config, projectRoot }) => {
      // Make sure the human-curated supplement directories exist
      // before the SQLite-backed mirror rebuild runs. `mnema memory
      // consolidate` later walks `decisions/` and `notes/` and
      // reports "not initialised" when they are missing.
      const memoryRoot = pathMod.join(projectRoot, config.paths.memory);
      fsMod.mkdirSync(pathMod.join(memoryRoot, 'decisions'), { recursive: true });
      fsMod.mkdirSync(pathMod.join(memoryRoot, 'notes'), { recursive: true });
      fsMod.mkdirSync(pathMod.join(projectRoot, config.paths.skills), { recursive: true });

      const skills = container.skill.rebuildMirrors();
      const memories = container.memory.rebuildMirrors();
      let prunedSkills: string[] = [];
      let prunedMemories: string[] = [];

      if (pruneOrphans) {
        const adapter = container.adapter;
        const skillSlugs = new Set(
          (
            adapter
              .getDatabase()
              .prepare(
                `SELECT s.slug FROM skills s INNER JOIN (
                   SELECT slug, MAX(version) AS max_version FROM skills GROUP BY slug
                 ) latest ON s.slug = latest.slug AND s.version = latest.max_version`,
              )
              .all() as Array<{ slug: string }>
          ).map((r) => r.slug),
        );
        const memorySlugs = new Set(
          (
            adapter.getDatabase().prepare('SELECT slug FROM memories').all() as Array<{
              slug: string;
            }>
          ).map((r) => r.slug),
        );
        prunedSkills = pruneOrphanMirrors(
          pathMod.join(projectRoot, config.paths.skills),
          skillSlugs,
          fsMod,
        );
        prunedMemories = pruneOrphanMirrors(
          pathMod.join(projectRoot, config.paths.memory),
          memorySlugs,
          fsMod,
        );
      }

      if (
        skills.length === 0 &&
        memories.length === 0 &&
        prunedSkills.length === 0 &&
        prunedMemories.length === 0
      ) {
        process.stdout.write('✓ nothing to rebuild — every row already has a mirror\n');
        return;
      }
      if (skills.length > 0) {
        process.stdout.write(`↻ skills mirrored: ${skills.length} — ${skills.join(', ')}\n`);
      }
      if (memories.length > 0) {
        process.stdout.write(`↻ memories mirrored: ${memories.length} — ${memories.join(', ')}\n`);
      }
      if (prunedSkills.length > 0) {
        process.stdout.write(
          `✗ skills pruned: ${prunedSkills.length} — ${prunedSkills.join(', ')}\n`,
        );
      }
      if (prunedMemories.length > 0) {
        process.stdout.write(
          `✗ memories pruned: ${prunedMemories.length} — ${prunedMemories.join(', ')}\n`,
        );
      }
      exit = ExitCode.Success;
    });
    return exit;
  }

  /**
   * Executes every check and prints a checklist to stdout.
   *
   * @returns Exit code (`0` when every check passes, otherwise `3`)
   */
  run(): number {
    const checks: DoctorCheck[] = [];
    const loader = new ConfigLoader();
    const configFile = loader.findConfigFile();
    if (configFile === null) {
      process.exit(printError({ kind: ErrorCode.ConfigNotFound, currentDir: process.cwd() }));
    }

    let config: ReturnType<ConfigLoader['load']>;
    try {
      config = loader.load();
      checks.push({ name: 'config.json valid', ok: true, detail: configFile });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      checks.push({ name: 'config.json valid', ok: false, detail: message });
      printChecks(checks);
      return ExitCode.State;
    }

    const versionCheck = checkVersion(config.mnema_version);
    checks.push({
      name: 'version satisfies project',
      ok: versionCheck.ok,
      detail: versionCheck.message ?? `required: ${config.mnema_version}`,
    });

    const projectRoot = resolveProjectRoot(configFile);
    const workflowPath = path.join(projectRoot, config.paths.workflows, `${config.workflow}.json`);
    let loadedWorkflow: ReturnType<WorkflowLoader['load']> | null = null;
    try {
      loadedWorkflow = new WorkflowLoader().load(workflowPath);
      checks.push({ name: 'workflow loads', ok: true, detail: workflowPath });
    } catch (error) {
      if (error instanceof WorkflowInvalidError) {
        // Surface each schema/parse issue on its own indented line so
        // the user can find the offending field without re-running the
        // tool with a different command.
        const detail = formatWorkflowIssues(error.path, error.issues);
        checks.push({ name: 'workflow loads', ok: false, detail });
      } else {
        const message = error instanceof Error ? error.message : 'unknown';
        checks.push({ name: 'workflow loads', ok: false, detail: message });
      }
    }

    const requiredDirs = [
      ['state', config.paths.state],
      ['audit', config.paths.audit],
      ['backlog', config.paths.backlog],
      ['workflows', config.paths.workflows],
    ] as const;
    for (const [name, dir] of requiredDirs) {
      const fullPath = path.join(projectRoot, dir);
      checks.push({
        name: `paths.${name} exists`,
        ok: existsSync(fullPath),
        detail: fullPath,
      });
    }

    const dbPath = path.join(projectRoot, config.paths.state, 'state.db');
    if (existsSync(dbPath)) {
      try {
        const adapter = new SqliteAdapter(dbPath);
        try {
          checks.push({ name: 'database opens', ok: true, detail: dbPath });
          checks.push(...inspectMigrationDrift(adapter, migrationDirs(projectRoot)));
          checks.push(
            ...inspectMirrorDrift(adapter, {
              skillsDir: path.join(projectRoot, config.paths.skills),
              memoryDir: path.join(projectRoot, config.paths.memory),
              roadmapDir: path.join(projectRoot, config.paths.roadmap),
              sprintsDir: path.join(projectRoot, config.paths.sprints),
            }),
          );
          checks.push(
            ...inspectAuditIntegrity(adapter, path.join(projectRoot, config.paths.audit)),
          );
          if (loadedWorkflow !== null) {
            checks.push(...inspectWorkflowShape(loadedWorkflow));
            checks.push(...inspectTaskStateDrift(adapter, loadedWorkflow));
          }
        } finally {
          adapter.close();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        checks.push({ name: 'database opens', ok: false, detail: message });
      }
    } else {
      checks.push({ name: 'database opens', ok: false, detail: `${dbPath} missing` });
    }

    printChecks(checks);
    // Warnings keep exit 0; only errors fail the check.
    const hasError = checks.some((c) => !c.ok && (c.severity ?? 'error') === 'error');
    return hasError ? ExitCode.State : ExitCode.Success;
  }
}

/**
 * Compares migration files on disk to versions recorded in
 * `schema_migrations`, surfacing two distinct drift modes:
 *
 * - **Pending**: a file exists that the database has not applied —
 *   typically because the user upgraded the CLI without restarting
 *   the MCP server / re-running anything that re-opens the DB. Fails
 *   the check.
 * - **Orphan**: a version recorded in the DB has no matching file —
 *   would happen if someone deleted a migration from the source tree
 *   after it was applied. Fails the check; downgrade is not safe.
 *
 * Exported for tests; the doctor flow calls it with the bundled
 * `migrationsDir()`.
 *
 * @param adapter - SQLite adapter for the project database
 * @param dir - Migrations directory to compare against
 * @returns Drift checks in the order doctor renders them
 */
export function inspectMigrationDrift(
  adapter: SqliteAdapter,
  dir: string | readonly string[],
): DoctorCheck[] {
  const runner = new MigrationRunner();
  const onDisk = runner.listAvailable(dir);
  const applied = new Set(runner.loadApplied(adapter));
  const onDiskVersions = new Set(onDisk.map((m) => m.version));

  const pending = onDisk.filter((m) => !applied.has(m.version));
  const orphan = [...applied].filter((v) => !onDiskVersions.has(v));

  const checks: DoctorCheck[] = [];
  checks.push({
    name: 'migrations applied',
    ok: pending.length === 0,
    detail:
      pending.length === 0
        ? `${applied.size} applied, ${onDisk.length} on disk`
        : `pending: ${pending.map((m) => m.file).join(', ')}`,
  });
  if (orphan.length > 0) {
    checks.push({
      name: 'migrations consistent',
      ok: false,
      detail: `db has versions with no matching file: ${orphan.join(', ')}`,
    });
  }
  return checks;
}

/**
 * Reports whether each skill/memory row in SQLite has a matching `.md`
 * mirror on disk. Failures are warnings, not errors — the database is
 * the source of truth, the filesystem mirror is for human visibility.
 *
 * @param adapter - SQLite adapter for the project database
 * @param dirs - Mirror directories (`paths.skills` and `paths.memory`)
 * @returns Two checks, one per kind
 */
export function inspectMirrorDrift(
  adapter: SqliteAdapter,
  dirs: {
    readonly skillsDir: string;
    readonly memoryDir: string;
    readonly roadmapDir: string;
    readonly sprintsDir: string;
  },
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const skillRows = adapter
    .getDatabase()
    .prepare(
      `SELECT s.slug FROM skills s
       INNER JOIN (
         SELECT slug, MAX(version) AS max_version
         FROM skills GROUP BY slug
       ) latest ON s.slug = latest.slug AND s.version = latest.max_version`,
    )
    .all() as Array<{ slug: string }>;
  const skillSlugs = new Set(skillRows.map((r) => r.slug));
  const skillMissing = skillRows.filter(
    (r) => !existsSync(path.join(dirs.skillsDir, `${r.slug}.md`)),
  );
  const skillOrphans = listMirrorOrphans(dirs.skillsDir, skillSlugs);
  checks.push({
    name: 'skills mirrored',
    ok: skillMissing.length === 0 && skillOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(
      skillRows.length,
      skillMissing.map((r) => r.slug),
      skillOrphans,
    ),
  });

  const memoryRows = adapter.getDatabase().prepare('SELECT slug FROM memories').all() as Array<{
    slug: string;
  }>;
  const memorySlugs = new Set(memoryRows.map((r) => r.slug));
  const memoryMissing = memoryRows.filter(
    (r) => !existsSync(path.join(dirs.memoryDir, `${r.slug}.md`)),
  );
  const memoryOrphans = listMirrorOrphans(dirs.memoryDir, memorySlugs);
  checks.push({
    name: 'memories mirrored',
    ok: memoryMissing.length === 0 && memoryOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(
      memoryRows.length,
      memoryMissing.map((r) => r.slug),
      memoryOrphans,
    ),
  });

  // Roadmap mirrors are keyed by their human key, not a slug. Epics and
  // decisions share `roadmap/`, so the orphan check for that directory
  // uses the union of both key sets — otherwise each kind would flag the
  // other's files as orphans.
  const epicKeys = (
    adapter.getDatabase().prepare('SELECT key FROM epics WHERE deleted_at IS NULL').all() as Array<{
      key: string;
    }>
  ).map((r) => r.key);
  const decisionKeys = (
    adapter
      .getDatabase()
      .prepare('SELECT key FROM decisions WHERE deleted_at IS NULL')
      .all() as Array<{ key: string }>
  ).map((r) => r.key);
  const sprintKeys = (
    adapter
      .getDatabase()
      .prepare('SELECT key FROM sprints WHERE deleted_at IS NULL')
      .all() as Array<{ key: string }>
  ).map((r) => r.key);

  const roadmapKnown = new Set([...epicKeys, ...decisionKeys]);
  const roadmapOrphans = listMirrorOrphans(dirs.roadmapDir, roadmapKnown);

  const epicMissing = epicKeys.filter((k) => !existsSync(path.join(dirs.roadmapDir, `${k}.md`)));
  checks.push({
    name: 'epics mirrored',
    // Orphans live in roadmap/ shared with decisions — only fail on
    // genuine orphans (keys in neither set), reported once below.
    ok: epicMissing.length === 0,
    severity: 'warning',
    detail: mirrorDetail(epicKeys.length, epicMissing, []),
  });

  const decisionMissing = decisionKeys.filter(
    (k) => !existsSync(path.join(dirs.roadmapDir, `${k}.md`)),
  );
  checks.push({
    name: 'decisions mirrored',
    ok: decisionMissing.length === 0 && roadmapOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(decisionKeys.length, decisionMissing, roadmapOrphans),
  });

  const sprintMissing = sprintKeys.filter(
    (k) => !existsSync(path.join(dirs.sprintsDir, `${k}.md`)),
  );
  const sprintOrphans = listMirrorOrphans(dirs.sprintsDir, new Set(sprintKeys));
  checks.push({
    name: 'sprints mirrored',
    ok: sprintMissing.length === 0 && sprintOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(sprintKeys.length, sprintMissing, sprintOrphans),
  });

  return checks;
}

/**
 * Lists `.md` files in `dir` whose stem is NOT one of the known slugs
 * — these are orphans: the SQLite row was deleted or renamed but the
 * mirror file lingers. Returns the slugs (filename minus `.md`).
 *
 * Files starting with `.` (like `.gitkeep`) and the catalogue
 * `INDEX.md` are excluded so they do not show up as orphans.
 *
 * @param dir - Directory to scan (returns empty if it does not exist)
 * @param knownSlugs - Authoritative set of slugs from SQLite
 * @returns Orphan slug list, alphabetical
 */
function listMirrorOrphans(dir: string, knownSlugs: ReadonlySet<string>): string[] {
  if (!existsSync(dir)) return [];
  const orphans: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'INDEX.md') continue;
    if (!entry.name.endsWith('.md')) continue;
    const slug = entry.name.slice(0, -3);
    if (!knownSlugs.has(slug)) orphans.push(slug);
  }
  return orphans.sort();
}

function mirrorDetail(
  rowCount: number,
  missing: readonly string[],
  orphans: readonly string[],
): string {
  if (missing.length === 0 && orphans.length === 0) {
    return `${rowCount} mirrored`;
  }
  const parts: string[] = [`${rowCount} rows`];
  if (missing.length > 0) parts.push(`missing files: ${missing.join(', ')}`);
  if (orphans.length > 0) parts.push(`orphan files: ${orphans.join(', ')}`);
  return parts.join(', ');
}

/**
 * Deletes `.md` files in `dir` whose slug has no matching SQLite row.
 * Returns the list of slugs whose mirror was just removed.
 *
 * @param dir - Mirror directory to scan
 * @param knownSlugs - Authoritative slug set from SQLite
 * @param fs - `node:fs` namespace (injected for testability + lazy load)
 * @returns Slug list (alphabetical) of the files that were deleted
 */
function pruneOrphanMirrors(
  dir: string,
  knownSlugs: ReadonlySet<string>,
  fs: typeof import('node:fs'),
): string[] {
  if (!fs.existsSync(dir)) return [];
  const removed: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'INDEX.md') continue;
    if (!entry.name.endsWith('.md')) continue;
    const slug = entry.name.slice(0, -3);
    if (!knownSlugs.has(slug)) {
      fs.rmSync(path.join(dir, entry.name));
      removed.push(slug);
    }
  }
  return removed.sort();
}

/**
 * Walks every JSONL file under `auditDir`, parses each line, and
 * verifies the per-file SHA-256 chain against the head hash stored
 * in SQLite. Returns one or more {@link DoctorCheck} rows.
 *
 * The check covers four invariants:
 * - **count**: parseable lines on disk match `audit_state.event_count`.
 * - **chain head**: hash of the last line equals `chain_head_hash`.
 * - **chain continuity**: each line's `prev_hash` matches the previous
 *   line's `hash` (per-file).
 * - **strict parsing**: any line that failed `JSON.parse` is surfaced
 *   as a warning (a smokescreen for forged lines), not silently dropped.
 *
 * Projects whose audit log predates the integrity feature
 * (`chain_head_hash IS NULL` and `event_count = 0`) are reported as
 * `legacy` and skipped — the integrity check activates on the first
 * write through the new writer.
 *
 * @param adapter - Open SQLite adapter
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns Audit-integrity checks
 */
export function inspectAuditIntegrity(adapter: SqliteAdapter, auditDir: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
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

  const files = readdirSync(auditDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
    .map((d) => path.join(auditDir, d.name))
    .sort();

  // Events that belong to the hash chain (v >= 2). `audit_state.event_count`
  // tracks exactly these, so the count check compares against this — not
  // the total line count, which also includes pre-chain legacy lines (v1)
  // written before the integrity feature that never entered the counter.
  // Counting all lines reports a false mismatch on any project with
  // legacy history. Legacy lines are tallied separately for the report.
  let chainedLines = 0;
  let legacyLines = 0;
  let malformedLines = 0;
  let chainBroken = false;
  let chainBreakDetail = '';
  let lastHash: string | null = null;
  let chainEverStarted = false;

  for (const file of files) {
    let prevHashInFile: string | null = null;
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

      const v = typeof event.v === 'number' ? event.v : 1;
      if (v >= 2) {
        chainEverStarted = true;
        chainedLines += 1;
        const hash = typeof event.hash === 'string' ? event.hash : null;
        const prev = (event.prev_hash ?? null) as string | null;
        const { hash: _h, ...rest } = event;
        const recomputed = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
        if (hash !== recomputed) {
          chainBroken = true;
          chainBreakDetail = `hash mismatch on a line in ${path.basename(file)}`;
        }
        if (prev !== prevHashInFile) {
          chainBroken = true;
          chainBreakDetail = `prev_hash break on a line in ${path.basename(file)}`;
        }
        prevHashInFile = hash;
        lastHash = hash;
      } else {
        // Legacy line: no per-line chain; counted separately so it does
        // not inflate the chain-count comparison below.
        legacyLines += 1;
        prevHashInFile = null;
      }
    }
  }

  // No new-format lines anywhere: the project predates the integrity
  // feature. Report as warning so the user knows the check is dormant.
  if (!chainEverStarted && stateRow.chain_head_hash === null) {
    checks.push({
      name: 'audit integrity',
      ok: true,
      detail: 'legacy audit log (no hash chain yet — activates on next event)',
      severity: 'warning',
    });
    return checks;
  }

  // Surface legacy lines so a human can still reconcile the disk total
  // (chained + legacy = lines on disk).
  const legacyNote = legacyLines > 0 ? ` (+${legacyLines} legacy pre-chain)` : '';
  if (chainedLines !== stateRow.event_count) {
    checks.push({
      name: 'audit event count',
      ok: false,
      detail: `disk has ${chainedLines} chained events${legacyNote}, audit_state has ${stateRow.event_count}`,
      severity: 'error',
    });
  } else {
    checks.push({
      name: 'audit event count',
      ok: true,
      detail: `${chainedLines} chained events match audit_state.event_count${legacyNote}`,
    });
  }

  if (chainBroken) {
    checks.push({
      name: 'audit hash chain',
      ok: false,
      detail: chainBreakDetail,
      severity: 'error',
    });
  } else if (lastHash !== stateRow.chain_head_hash) {
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

/**
 * Reports static workflow-shape issues that are well-formed against
 * the schema but likely authoring mistakes:
 * - non-terminal states with no outbound transitions (tasks land
 *   there and get stuck without recovery)
 * - non-initial states with no inbound transitions (unreachable
 *   from any path)
 *
 * Both surface as warnings, not errors, so they don't break workflows
 * that intentionally use those shapes (e.g. a state populated only by
 * external tooling). The doctor's exit code stays clean.
 */
export function inspectWorkflowShape(
  workflow: import('../../domain/state-machine/state-machine.js').Workflow,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const deadEnds: string[] = [];
  for (const state of workflow.states) {
    if (workflow.terminal.includes(state)) continue;
    const exits = workflow.transitions[state];
    if (exits === undefined || Object.keys(exits).length === 0) {
      deadEnds.push(state);
    }
  }
  if (deadEnds.length > 0) {
    checks.push({
      name: 'workflow dead-end states',
      ok: false,
      severity: 'warning',
      detail: `non-terminal states without outbound transitions: ${deadEnds.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'workflow dead-end states',
      ok: true,
      detail: 'every non-terminal state has at least one outbound transition',
    });
  }

  const inbound = new Set<string>();
  for (const actions of Object.values(workflow.transitions)) {
    for (const transition of Object.values(actions)) {
      inbound.add(transition.to);
    }
  }
  const unreachable: string[] = [];
  for (const state of workflow.states) {
    if (state === workflow.initial) continue;
    if (!inbound.has(state)) unreachable.push(state);
  }
  if (unreachable.length > 0) {
    checks.push({
      name: 'workflow unreachable states',
      ok: false,
      severity: 'warning',
      detail: `non-initial states with no inbound transitions: ${unreachable.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'workflow unreachable states',
      ok: true,
      detail: 'every non-initial state has at least one inbound transition',
    });
  }

  return checks;
}

/**
 * Compares the distinct `state` values stored on active tasks against
 * the workflow's declared states. A non-empty diff means a workflow
 * edit dropped a state that still has live tasks — those tasks are
 * stranded (no transition exists out of an unknown state). Reported
 * as an error since it's data corruption from the workflow's
 * perspective.
 */
export function inspectTaskStateDrift(
  adapter: SqliteAdapter,
  workflow: import('../../domain/state-machine/state-machine.js').Workflow,
): DoctorCheck[] {
  const rows = adapter
    .getDatabase()
    .prepare('SELECT DISTINCT state FROM tasks WHERE deleted_at IS NULL ORDER BY state')
    .all() as Array<{ state: string }>;
  const known = new Set(workflow.states);
  const orphan = rows.map((r) => r.state).filter((s) => !known.has(s));

  if (orphan.length === 0) {
    return [
      {
        name: 'tasks states match workflow',
        ok: true,
        detail: `${rows.length} distinct state(s) on active tasks, all declared`,
      },
    ];
  }
  return [
    {
      name: 'tasks states match workflow',
      ok: false,
      severity: 'error',
      detail: `tasks in states not declared by the workflow: ${orphan.join(', ')}`,
    },
  ];
}

function printChecks(checks: readonly DoctorCheck[]): void {
  for (const check of checks) {
    const mark = check.ok
      ? pc.green('✓')
      : (check.severity ?? 'error') === 'warning'
        ? pc.yellow('⚠')
        : pc.red('✗');
    process.stdout.write(`${mark} ${check.name}  ${pc.dim(check.detail)}\n`);
  }
}
