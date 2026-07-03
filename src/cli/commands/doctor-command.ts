import { existsSync, readdirSync } from 'node:fs';
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
// `inspectAuditIntegrity` lives in `services/audit-integrity.ts` so both
// the CLI doctor and the `audit_verify` MCP tool consume one source of
// truth. Imported for the doctor's own use and re-exported below to keep
// existing `doctor-command` importers working.
import { anchorStatusCheck } from '../../services/anchor/anchor-inspect.js';
import { inspectAuditIntegrity } from '../../services/audit-integrity.js';
import { createAttestationSource } from '../../services/head-checkpoint.js';
import { HookTrustService } from '../../services/hook-trust.js';
import { IdentityService } from '../../services/identity-service.js';
import { recordCounter } from '../../services/metrics-counter.js';
import { findOrphanRuns } from '../../services/orphan-run-service.js';
import { ProjectSecretService } from '../../services/project-secret.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { ActorRepository } from '../../storage/sqlite/repositories/actor-repository.js';
import { AgentRunRepository } from '../../storage/sqlite/repositories/agent-run-repository.js';
import { AnchorRepository } from '../../storage/sqlite/repositories/anchor-repository.js';
import { AuditHeadSignatureRepository } from '../../storage/sqlite/repositories/audit-head-signature-repository.js';
import { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
import { migrationDirs } from '../../utils/asset-paths.js';
import { pc } from '../../utils/colors.js';
import { checkVersion } from '../../utils/version-check.js';
import { resolveProjectRoot } from '../project-root.js';

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
        'Recovery: recreate missing `.md` files for tasks, skills, memories, epics, sprints and decisions from the SQLite rows. Skips the regular doctor checks.',
      )
      .option(
        '--prune-orphans',
        'When combined with --rebuild-mirrors, also delete `.md` files (including backlog task mirrors) whose slug/key has no matching SQLite row',
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
   * Rebuilds `.md` mirror files for every SQLite row that has no matching
   * file on disk — tasks, skills, memories, epics, sprints and decisions.
   * Existing files are left alone: this is a one-way "heal drift"
   * operation, not a reformat. When `pruneOrphans` is true, also deletes
   * skill/memory mirrors and backlog task mirrors whose slug/key has no
   * matching SQLite row (FS→DB drift). Pruning is limited to
   * skills/memories/tasks — epics and decisions share `roadmap/`, so an
   * orphan sweep there needs the union of both key sets and is left out of
   * this recovery path.
   *
   * @param pruneOrphans - Whether to delete orphan skill/memory/task `.md` files
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

      const tasks = container.sync.rebuildMirrors();
      const skills = container.skill.rebuildMirrors();
      const memories = container.memory.rebuildMirrors();
      const epics = container.epic.rebuildMirrors(config.project.key);
      const sprints = container.sprint.rebuildMirrors(config.project.key);
      const decisions = container.decision.rebuildMirrors(config.project.key);
      let prunedSkills: string[] = [];
      let prunedMemories: string[] = [];
      let prunedTasks: string[] = [];

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
        const taskKeys = new Set(
          (
            adapter
              .getDatabase()
              .prepare('SELECT key FROM tasks WHERE deleted_at IS NULL')
              .all() as Array<{ key: string }>
          ).map((r) => r.key),
        );
        prunedTasks = pruneNestedOrphanMirrors(
          pathMod.join(projectRoot, config.paths.backlog),
          taskKeys,
          fsMod,
        );
      }

      if (
        tasks.length === 0 &&
        skills.length === 0 &&
        memories.length === 0 &&
        epics.length === 0 &&
        sprints.length === 0 &&
        decisions.length === 0 &&
        prunedTasks.length === 0 &&
        prunedSkills.length === 0 &&
        prunedMemories.length === 0
      ) {
        process.stdout.write('✓ nothing to rebuild — every row already has a mirror\n');
        return;
      }
      if (tasks.length > 0) {
        process.stdout.write(`↻ tasks mirrored: ${tasks.length} — ${tasks.join(', ')}\n`);
      }
      if (skills.length > 0) {
        process.stdout.write(`↻ skills mirrored: ${skills.length} — ${skills.join(', ')}\n`);
      }
      if (memories.length > 0) {
        process.stdout.write(`↻ memories mirrored: ${memories.length} — ${memories.join(', ')}\n`);
      }
      if (epics.length > 0) {
        process.stdout.write(`↻ epics mirrored: ${epics.length} — ${epics.join(', ')}\n`);
      }
      if (sprints.length > 0) {
        process.stdout.write(`↻ sprints mirrored: ${sprints.length} — ${sprints.join(', ')}\n`);
      }
      if (decisions.length > 0) {
        process.stdout.write(
          `↻ decisions mirrored: ${decisions.length} — ${decisions.join(', ')}\n`,
        );
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
      if (prunedTasks.length > 0) {
        process.stdout.write(`✗ tasks pruned: ${prunedTasks.length} — ${prunedTasks.join(', ')}\n`);
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

    // Surface the active gate-enforcement mode; a weakened (advisory) mode
    // is flagged as a warning rather than passing silently.
    checks.push(...inspectEnforcementMode(config.enforcement_mode));

    // Domain-event hooks: surface how many commands are wired, and whether
    // the block is human-approved. An un-approved block is inert (it never
    // executes) — flag it as not-ok so a configured-but-unapproved hook is
    // visible rather than silently ignored.
    const hookEntries = Object.entries(config.hooks).filter(([, commands]) => commands.length > 0);
    const hookCount = hookEntries.reduce((sum, [, commands]) => sum + commands.length, 0);
    if (hookCount === 0) {
      checks.push({ name: 'domain-event hooks', ok: true, detail: 'none configured' });
    } else {
      const approved = new HookTrustService(config.project.key).isTrusted(config.hooks);
      const events = hookEntries.map(([event]) => event).join(', ');
      checks.push({
        name: 'domain-event hooks',
        ok: approved,
        detail: approved
          ? `${hookCount} command(s) on ${events} (approved)`
          : `${hookCount} command(s) on ${events} — NOT approved, inert until \`mnema hooks approve\``,
      });
    }

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
              backlogDir: path.join(projectRoot, config.paths.backlog),
            }),
          );
          // read() not getOrCreate(): doctor verifies, it never mints a
          // secret. A clone without it → v3 lines report 'unverifiable';
          // the committed fingerprint still forces v3 (downgrade detection).
          const doctorSecret = new ProjectSecretService(projectRoot, config.project.key);
          checks.push(
            ...inspectAuditIntegrity(
              adapter,
              path.join(projectRoot, config.paths.audit),
              doctorSecret.read(),
              doctorSecret.readFingerprint() !== null,
              // Machine attestation: verify the recorded head signature
              // against the committed public key. Offline (no network) — it
              // reads .mnema/keys and the local SQLite only.
              createAttestationSource(projectRoot, new AuditHeadSignatureRepository(adapter)),
            ),
          );
          // Temporal anchoring (layer 3): offline status only — how many
          // heads are anchored vs pending. Verifying receipts against a
          // provider is the online `audit verify --verify-anchors` path, so
          // doctor never contacts the network and a clone is never red for a
          // missing anchor.
          checks.push(
            anchorStatusCheck(new AnchorRepository(adapter), config.audit.anchor.provider),
          );
          checks.push(...inspectOrphanRuns(adapter, config.aging.orphan_run_after_hours));
          checks.push(
            ...inspectIdentity(
              new IdentityService(new ActorRepository(adapter)).resolveDefaultActor(),
            ),
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
    printMirrorHints(checks);
    // Record this run in the LOCAL counter log (outside the audit chain,
    // never transmitted — see MNEMA-ADR-36) so `mnema metrics` can report
    // doctor adoption. Best-effort: it never affects doctor's verdict.
    recordCounter(
      path.join(projectRoot, config.paths.state),
      'doctor_ran',
      new Date().toISOString(),
    );
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
    readonly backlogDir: string;
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

  // Tasks differ from the flat-directory entities above: their mirrors
  // live in per-state subfolders (`backlog/<STATE>/<KEY>.md`), so both
  // the missing-file probe and the orphan scan walk one level deeper.
  const taskRows = adapter
    .getDatabase()
    .prepare('SELECT key, state FROM tasks WHERE deleted_at IS NULL')
    .all() as Array<{ key: string; state: string }>;
  const taskKeys = new Set(taskRows.map((r) => r.key));
  const taskMissing = taskRows
    .filter((r) => !existsSync(path.join(dirs.backlogDir, r.state, `${r.key}.md`)))
    .map((r) => r.key);
  const taskOrphans = listNestedMirrorOrphans(dirs.backlogDir, taskKeys);
  checks.push({
    name: 'tasks mirrored',
    ok: taskMissing.length === 0 && taskOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(taskRows.length, taskMissing, taskOrphans),
  });

  return checks;
}

/**
 * Like {@link listMirrorOrphans} but for the backlog's per-state layout:
 * scans every `backlog/<STATE>/*.md` and returns the stems that match no
 * known task key. A `.md` under any state folder whose key has no live
 * SQLite row is an orphan (the row was deleted, renamed, or the file was
 * left behind after a state move).
 *
 * @param backlogDir - Backlog root (returns empty if it does not exist)
 * @param knownKeys - Authoritative set of task keys from SQLite
 * @returns Orphan key list, alphabetical
 */
function listNestedMirrorOrphans(backlogDir: string, knownKeys: ReadonlySet<string>): string[] {
  if (!existsSync(backlogDir)) return [];
  const orphans: string[] = [];
  for (const stateDir of readdirSync(backlogDir, { withFileTypes: true })) {
    if (!stateDir.isDirectory()) continue;
    for (const entry of readdirSync(path.join(backlogDir, stateDir.name), {
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'INDEX.md') continue;
      if (!entry.name.endsWith('.md')) continue;
      const key = entry.name.slice(0, -3);
      if (!knownKeys.has(key)) orphans.push(key);
    }
  }
  return orphans.sort();
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
export function pruneOrphanMirrors(
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
 * Like {@link pruneOrphanMirrors} but for the backlog's per-state
 * layout: deletes every `backlog/<STATE>/*.md` whose key has no live
 * SQLite row. Returns the keys whose mirror was removed.
 *
 * @param backlogDir - Backlog root (no-op if it does not exist)
 * @param knownKeys - Authoritative task key set from SQLite
 * @param fs - `node:fs` namespace (injected for testability + lazy load)
 * @returns Key list (alphabetical) of the files that were deleted
 */
export function pruneNestedOrphanMirrors(
  backlogDir: string,
  knownKeys: ReadonlySet<string>,
  fs: typeof import('node:fs'),
): string[] {
  if (!fs.existsSync(backlogDir)) return [];
  const removed: string[] = [];
  for (const stateDir of fs.readdirSync(backlogDir, { withFileTypes: true })) {
    if (!stateDir.isDirectory()) continue;
    const stateRoot = path.join(backlogDir, stateDir.name);
    for (const entry of fs.readdirSync(stateRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'INDEX.md') continue;
      if (!entry.name.endsWith('.md')) continue;
      const key = entry.name.slice(0, -3);
      if (!knownKeys.has(key)) {
        fs.rmSync(path.join(stateRoot, entry.name));
        removed.push(key);
      }
    }
  }
  return removed.sort();
}

// Re-exported so existing `doctor-command` importers (tests, other
// commands) keep resolving the symbol from here after the move.
export { inspectAuditIntegrity };

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
/**
 * Reports the active gate-enforcement mode. `strict` (the default) and
 * `blocking` sit at or above the safe baseline and pass. `advisory` is
 * looser — a failed gate no longer blocks agents — so a repo (e.g. a
 * clone) that ships it silently drops the protection that matters; it is
 * flagged as a warning (visible, but not a hard failure — exit stays 0).
 *
 * @param mode - The effective `enforcement_mode` from the merged config
 * @returns A single-element check list
 */
/**
 * Reports whether a default human identity resolves. Every mutation needs
 * an actor, and a fresh machine (or a clone with no `MNEMA_ACTOR`) has
 * none — yet doctor previously said nothing, so the gap was only found on
 * the first write. A missing identity is a warning (not an error): the
 * project is otherwise healthy, the user just has to set it.
 *
 * @param identity - Result of `IdentityService.resolveDefaultActor()`
 * @returns A single-element check list
 */
export function inspectIdentity(identity: {
  readonly actor: string | null;
  readonly source: 'env' | 'config' | 'none';
}): DoctorCheck[] {
  if (identity.actor === null) {
    return [
      {
        name: 'identity configured',
        ok: false,
        severity: 'warning',
        detail:
          'no default actor — set one with `mnema identity set <handle>` or export MNEMA_ACTOR ' +
          '(required before any mutation)',
      },
    ];
  }
  return [
    {
      name: 'identity configured',
      ok: true,
      detail: `${identity.actor} (${identity.source})`,
    },
  ];
}

export function inspectEnforcementMode(mode: 'advisory' | 'strict' | 'blocking'): DoctorCheck[] {
  return [
    {
      name: 'enforcement mode',
      ok: mode !== 'advisory',
      severity: 'warning',
      detail:
        mode === 'blocking'
          ? 'blocking — a failed gate blocks everyone'
          : mode === 'strict'
            ? 'strict — a failed gate blocks agents; humans may override'
            : 'advisory — gate enforcement is off (a failed gate only warns); ' +
              'set enforcement_mode to "strict" to restore it',
    },
  ];
}

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

/**
 * Surfaces agent runs left open past the orphan threshold (a dropped
 * session that never called `agent_run_end`). A warning, never an error:
 * an orphan is untidy, not broken, and `mnema agent close-orphans
 * --apply` resolves it.
 */
function inspectOrphanRuns(adapter: SqliteAdapter, thresholdHours: number): DoctorCheck[] {
  const orphans = findOrphanRuns(
    new AgentRunRepository(adapter).findRunning(),
    thresholdHours,
    Date.now(),
  );
  if (orphans.length === 0) {
    return [{ name: 'no orphaned runs', ok: true, detail: `none open > ${thresholdHours}h` }];
  }
  const oldest = orphans[orphans.length - 1];
  return [
    {
      name: 'orphaned agent runs',
      ok: false,
      severity: 'warning',
      detail: `${orphans.length} run(s) open > ${thresholdHours}h (oldest ${oldest?.ageHours}h) — \`mnema agent close-orphans --apply\` to abort`,
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

/**
 * Derives the actionable hints to show for failing mirror checks, so a
 * user does not have to know the recovery command exists. A "missing
 * files" drift (rows in SQLite with no `.md`) is healed by
 * `--rebuild-mirrors`; an "orphan files" drift (`.md` with no row) is the
 * inverse and only resolved by deletion, so its hint is phrased
 * conditionally — an orphan may well be content worth importing rather
 * than discarding. Exported (pure) so the wording is testable without
 * capturing terminal output.
 *
 * @param checks - The full doctor checklist
 * @returns Zero, one, or two hint lines (without colour codes)
 */
export function mirrorHints(checks: readonly DoctorCheck[]): string[] {
  const mirrorChecks = checks.filter((c) => !c.ok && c.name.endsWith('mirrored'));
  const hints: string[] = [];
  if (mirrorChecks.some((c) => c.detail.includes('missing files'))) {
    hints.push(
      'some rows have no markdown file — run `mnema doctor --rebuild-mirrors` to recreate them',
    );
  }
  if (mirrorChecks.some((c) => c.detail.includes('orphan files'))) {
    hints.push(
      'some markdown files have no row — register them, or, if obsolete, run `mnema doctor --rebuild-mirrors --prune-orphans` to delete them',
    );
  }
  return hints;
}

/** Prints the hints from {@link mirrorHints} under the checklist. */
function printMirrorHints(checks: readonly DoctorCheck[]): void {
  for (const hint of mirrorHints(checks)) {
    process.stdout.write(`${pc.dim('hint:')} ${hint}\n`);
  }
}
