import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { ConfigLoader } from '../../config/config-loader.js';
import { WorkflowLoader } from '../../domain/state-machine/workflow-loader.js';
import { ErrorCode, ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
import { checkVersion } from '../../utils/version-check.js';

interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
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
      .action(() => {
        const exit = this.run();
        process.exit(exit);
      });
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

    const projectRoot = path.dirname(configFile);
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
        adapter.close();
        checks.push({ name: 'database opens', ok: true, detail: dbPath });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        checks.push({ name: 'database opens', ok: false, detail: message });
      }
    } else {
      checks.push({ name: 'database opens', ok: false, detail: `${dbPath} missing` });
    }

    printChecks(checks);
    return checks.every((c) => c.ok) ? ExitCode.Success : ExitCode.State;
  }
}

function printChecks(checks: readonly DoctorCheck[]): void {
  for (const check of checks) {
    const mark = check.ok ? pc.green('✓') : pc.red('✗');
    process.stdout.write(`${mark} ${check.name}  ${pc.dim(check.detail)}\n`);
  }
}
