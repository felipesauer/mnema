import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { ConfigLoader } from '../../config/config-loader.js';
import { WorkflowLoader } from '../../domain/state-machine/workflow-loader.js';
import { ErrorCode, ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
import { migrationsDir } from '../../utils/asset-paths.js';
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
      .description('Run a read-only diagnostic check on the current project')
      .option(
        '--rebuild-mirrors',
        'Recreate any missing `.md` files under paths.skills and paths.memory from the SQLite rows',
      )
      .action(async (options: { readonly rebuildMirrors?: boolean }) => {
        if (options.rebuildMirrors === true) {
          const exit = await this.rebuildMirrors();
          process.exit(exit);
        }
        const exit = this.run();
        process.exit(exit);
      });
  }

  /**
   * Rebuilds skill/memory `.md` mirror files for every SQLite row that
   * has no matching file on disk. Existing files are left alone — this
   * is a one-way "heal drift" operation, not a reformat.
   *
   * @returns Exit code (`0` on success, `3` if the context could not be
   *   opened)
   */
  private async rebuildMirrors(): Promise<number> {
    const { withCliContext } = await import('../cli-context.js');
    let exit = ExitCode.Success;
    await withCliContext(({ container }) => {
      const skills = container.skill.rebuildMirrors();
      const memories = container.memory.rebuildMirrors();
      if (skills.length === 0 && memories.length === 0) {
        process.stdout.write('✓ nothing to rebuild — every row already has a mirror\n');
        return;
      }
      if (skills.length > 0) {
        process.stdout.write(`↻ skills mirrored: ${skills.length} — ${skills.join(', ')}\n`);
      }
      if (memories.length > 0) {
        process.stdout.write(`↻ memories mirrored: ${memories.length} — ${memories.join(', ')}\n`);
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
    try {
      new WorkflowLoader().load(workflowPath);
      checks.push({ name: 'workflow loads', ok: true, detail: workflowPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      checks.push({ name: 'workflow loads', ok: false, detail: message });
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
          checks.push(...inspectMigrationDrift(adapter, migrationsDir()));
          checks.push(
            ...inspectMirrorDrift(adapter, {
              skillsDir: path.join(projectRoot, config.paths.skills),
              memoryDir: path.join(projectRoot, config.paths.memory),
            }),
          );
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
export function inspectMigrationDrift(adapter: SqliteAdapter, dir: string): DoctorCheck[] {
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
  dirs: { readonly skillsDir: string; readonly memoryDir: string },
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
  const skillDrift = skillRows.filter(
    (r) => !existsSync(path.join(dirs.skillsDir, `${r.slug}.md`)),
  );
  checks.push({
    name: 'skills mirrored',
    ok: skillDrift.length === 0,
    severity: 'warning',
    detail:
      skillDrift.length === 0
        ? `${skillRows.length} mirrored`
        : `${skillRows.length} rows, missing files: ${skillDrift.map((r) => r.slug).join(', ')}`,
  });

  const memoryRows = adapter.getDatabase().prepare('SELECT slug FROM memories').all() as Array<{
    slug: string;
  }>;
  const memoryDrift = memoryRows.filter(
    (r) => !existsSync(path.join(dirs.memoryDir, `${r.slug}.md`)),
  );
  checks.push({
    name: 'memories mirrored',
    ok: memoryDrift.length === 0,
    severity: 'warning',
    detail:
      memoryDrift.length === 0
        ? `${memoryRows.length} mirrored`
        : `${memoryRows.length} rows, missing files: ${memoryDrift.map((r) => r.slug).join(', ')}`,
  });

  return checks;
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
