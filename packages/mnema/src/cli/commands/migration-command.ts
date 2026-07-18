import path from 'node:path';
import { ConfigLoader, reconcileConfigVersion } from '@mnema/core/config/config-loader.js';
import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import { printError } from '@mnema/core/errors/error-printer.js';
import { writeStoreFormatMarker } from '@mnema/core/services/integrity/store-format.js';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { migrationsDir } from '@mnema/core/utils/asset-paths.js';
import { pc } from '@mnema/core/utils/colors.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';
import type { Command } from 'commander';
import { resolveProjectRoot } from '../project-root.js';

/**
 * Registers `mnema migration`, helpers for the SQLite schema slot.
 *
 * The schema is mnema's exclusive concern: migrations ship bundled with
 * the package and the runner walks exactly that one directory. There is
 * no project-local migration source and no `generate` scaffold.
 */
export class MigrationCommand {
  /**
   * Attaches the `migration` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('migration').description('Manage SQLite migrations');

    group
      .command('apply')
      .description('Apply every pending migration to the project database')
      .action(() => {
        runApply();
      });
  }
}

/**
 * Top-level shortcut for `mnema migration apply`. Mutating commands
 * surface a `SchemaOutOfDate` error pointing here when the database
 * has fallen behind the migrations on disk.
 *
 * @param program - Root Commander program
 */
export class MigrateCommand {
  /**
   * Attaches the `migrate` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('migrate')
      .description('Apply every pending migration (alias of `migration apply`)')
      .action(() => {
        runApply();
      });
  }
}

/**
 * Loads the active project config, opens its SQLite database, and
 * applies every pending migration. Reports each one as it lands.
 * Exits the process with a non-zero status when the config cannot be
 * located.
 */
function runApply(): void {
  const loader = new ConfigLoader();
  const configFile = loader.findConfigFile();
  if (configFile === null) {
    process.exit(printError({ kind: ErrorCode.ConfigNotFound, currentDir: process.cwd() }));
  }
  const projectRoot = resolveProjectRoot(configFile);
  const dbPath = path.join(projectRoot, LAYOUT.state, 'state.db');
  const adapter = new SqliteAdapter(dbPath);
  try {
    const applied = new MigrationRunner().run(adapter, migrationsDir());
    // migrate is the reconcile step: move the config `version` up to the
    // current shape, then rewrite the store-format marker to THIS binary's
    // format — both unconditionally. The mismatch that blocked mutations may
    // have been any input (config version, mirror layout), not only a pending
    // migration, so an up-to-date schema still reconciles and clears the marker.
    if (reconcileConfigVersion(projectRoot)) {
      process.stdout.write(`${pc.dim('config version reconciled')}\n`);
    }
    writeStoreFormatMarker(projectRoot);
    if (applied.length === 0) {
      process.stdout.write(`${pc.dim('schema already up to date')}\n`);
      return;
    }
    process.stdout.write(`${pc.green('✓')} applied ${applied.length} migration(s):\n`);
    for (const migration of applied) {
      process.stdout.write(`  ${pc.dim('→')} ${migration.file}\n`);
    }
  } finally {
    adapter.close();
  }
}
