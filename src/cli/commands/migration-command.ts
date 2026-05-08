import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { ConfigLoader } from '../../config/config-loader.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
import { migrationsDir } from '../../utils/asset-paths.js';
import { resolveProjectRoot } from '../project-root.js';

/**
 * Registers `mnema migration`, helpers for the SQLite schema slot.
 *
 * Today exposes a single subcommand — `generate <slug>` — that drops
 * the next `NNN_<slug>.sql` file under the bundled migrations
 * directory with a commented stub. The runner picks it up
 * automatically the next time the database is opened.
 *
 * `<slug>` is normalised to snake_case so the file matches the
 * established naming.
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
      .command('generate <slug>')
      .description('Create the next NNN_<slug>.sql migration file')
      .action((slug: string) => {
        const result = generateMigration(migrationsDir(), slug);
        if (!result.ok) {
          process.stderr.write(`${pc.red('error:')} ${result.message}\n`);
          process.exit(2);
        }
        process.stdout.write(`${pc.green('✓')} ${path.relative(process.cwd(), result.filePath)}\n`);
        process.stdout.write(
          `${pc.dim(`  next time the database is opened, version ${result.version} runs and stamps schema_migrations.`)}\n`,
        );
      });

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
  const config = loader.load();
  const projectRoot = resolveProjectRoot(configFile);
  const dbPath = path.join(projectRoot, config.paths.state, 'state.db');
  const adapter = new SqliteAdapter(dbPath);
  try {
    const applied = new MigrationRunner().run(adapter, migrationsDir());
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

/**
 * Outcome of {@link generateMigration}. Exported so tests can assert
 * on the structured form without parsing CLI stdout.
 */
export type GenerateMigrationResult =
  | {
      readonly ok: true;
      readonly filePath: string;
      readonly version: number;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

/**
 * Writes the next `NNN_<slug>.sql` stub into `migrationsDir`.
 *
 * The version is the highest version already on disk plus one; the
 * filename follows the established `NNN_snake_case.sql` convention.
 * Refuses to overwrite an existing file.
 *
 * @param migrationsDir - Absolute path to the migrations directory
 * @param slug - Free-text label, normalised to snake_case
 * @returns Either the new file path + assigned version, or an error
 */
export function generateMigration(migrationsDir: string, slug: string): GenerateMigrationResult {
  const normalised = normaliseSlug(slug);
  if (normalised.length === 0) {
    return { ok: false, message: 'slug must contain alphanumerics' };
  }

  const onDisk = new MigrationRunner().listAvailable(migrationsDir);
  const nextVersion = (onDisk.at(-1)?.version ?? 0) + 1;
  const padded = String(nextVersion).padStart(3, '0');
  const fileName = `${padded}_${normalised}.sql`;
  const filePath = path.join(migrationsDir, fileName);

  if (existsSync(filePath)) {
    return { ok: false, message: `${fileName} already exists` };
  }

  writeFileSync(filePath, renderStub(nextVersion, normalised), 'utf-8');
  return { ok: true, filePath, version: nextVersion };
}

function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function renderStub(version: number, slug: string): string {
  return [
    '-- =============================================================================',
    `-- Migration ${String(version).padStart(3, '0')}: ${slug}`,
    '-- =============================================================================',
    '-- Add your DDL/DML below. Each migration runs inside the implicit',
    '-- transaction provided by Database.exec — keep it idempotent where',
    '-- you can (CREATE TABLE IF NOT EXISTS, etc.).',
    '',
    '-- TODO: implement the migration.',
    '',
    '-- The runner inserts the version row only after the SQL above runs',
    '-- without throwing — leave this line as the last statement.',
    `INSERT INTO schema_migrations (version) VALUES (${version});`,
    '',
  ].join('\n');
}
