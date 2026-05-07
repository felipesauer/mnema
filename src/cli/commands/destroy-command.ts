import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

// `@inquirer/prompts` is loaded lazily inside `resolveDecision` —
// `--yes` skips the cost, and unrelated CLI paths never touch it.

import { ConfigLoader } from '../../config/config-loader.js';
import { ErrorCode, ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';

interface DestroyOptions {
  readonly yes?: boolean;
  readonly keepMarkdown?: boolean;
  readonly keepAudit?: boolean;
}

/**
 * Registers `mnema destroy`, the uninstall command.
 *
 * DESIGN.md §7.4 prescribes two confirmations: a yes/no prompt and a
 * key-typing prompt. Both can be skipped together with `--yes` for CI
 * scripts. By default, `mnema.config.json`, `.app/`, `AGENTS.md` and
 * `workflows/` are removed; markdown trees (`backlog/`, `sprints/`,
 * `roadmap/`, `memory/`) and the audit log (`.audit/`) are kept unless
 * the user explicitly opts in.
 */
export class DestroyCommand {
  /**
   * Attaches the `destroy` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('destroy')
      .description('Remove the local Mnema project (two confirmations required)')
      .option('--yes', 'Skip confirmations and use the default preservation set', false)
      .option('--keep-markdown', 'Force-keep backlog/sprints/roadmap/memory', false)
      .option('--keep-audit', 'Force-keep .audit/', false)
      .action(async (options: DestroyOptions) => {
        const loader = new ConfigLoader();
        const configFile = loader.findConfigFile();
        if (configFile === null) {
          process.exit(printError({ kind: ErrorCode.ConfigNotFound, currentDir: process.cwd() }));
        }
        const config = loader.load();
        const projectRoot = path.dirname(configFile);

        const decision = await resolveDecision(options, config.project.key);
        if (decision === null) {
          process.stdout.write(`${pc.dim('aborted')}\n`);
          return;
        }

        const removed = removeArtifacts(projectRoot, config.paths, decision);
        for (const target of removed) {
          process.stdout.write(`${pc.dim('removed')} ${target}\n`);
        }
        process.stdout.write(`${pc.green('✓')} project ${pc.bold(config.project.key)} destroyed\n`);
        if (decision.keepMarkdown) {
          process.stdout.write(
            `${pc.dim('  kept markdown trees (backlog/sprints/roadmap/memory)')}\n`,
          );
        }
        if (decision.keepAudit) {
          process.stdout.write(`${pc.dim('  kept .audit/')}\n`);
        }
      });
  }
}

/**
 * Outcome of the destroy confirmation flow.
 */
export interface DestroyDecision {
  readonly keepMarkdown: boolean;
  readonly keepAudit: boolean;
}

async function resolveDecision(
  options: DestroyOptions,
  projectKey: string,
): Promise<DestroyDecision | null> {
  if (options.yes === true) {
    return {
      keepMarkdown: options.keepMarkdown === true,
      keepAudit: options.keepAudit === true,
    };
  }

  // Lazy: --yes path above never touches @inquirer/prompts.
  const { confirm, input } = await import('@inquirer/prompts');

  const proceed = await confirm({
    message: 'This will delete the SQLite database and project config. Continue?',
    default: false,
  });
  if (!proceed) return null;

  const keepMarkdown =
    options.keepMarkdown === true
      ? true
      : await confirm({
          message: 'Keep markdown trees (backlog/, sprints/, roadmap/, memory/)?',
          default: true,
        });

  const keepAudit =
    options.keepAudit === true
      ? true
      : await confirm({
          message: 'Keep the audit log (.audit/)?',
          default: true,
        });

  const typed = await input({
    message: `Type the project key (${projectKey}) to confirm:`,
  });
  if (typed.trim() !== projectKey) {
    process.stderr.write(`${pc.red('error:')} key did not match — destroy cancelled\n`);
    process.exit(ExitCode.Usage);
  }

  return { keepMarkdown, keepAudit };
}

/**
 * Paths affected by destroy. Mirrors the relevant subset of
 * {@link import('../../config/config-schema.js').Config.paths}.
 */
export interface DestroyPaths {
  readonly state: string;
  readonly audit: string;
  readonly workflows: string;
  readonly backlog: string;
  readonly sprints: string;
  readonly roadmap: string;
  readonly memory: string;
  readonly skills: string;
}

/**
 * Removes the project artifacts and returns the list of relative paths
 * actually deleted (those that did not exist are silently skipped).
 *
 * Exported for tests; the CLI command wraps it after collecting the
 * confirmation flow.
 *
 * @param projectRoot - Absolute path containing `mnema.config.json`
 * @param paths - Configured project paths
 * @param decision - Whether to keep markdown trees and the audit log
 * @returns The relative paths that were removed, in execution order
 */
export function removeArtifacts(
  projectRoot: string,
  paths: DestroyPaths,
  decision: DestroyDecision,
): string[] {
  const removed: string[] = [];

  const alwaysRemove = [
    paths.state,
    paths.workflows,
    paths.skills,
    'mnema.config.json',
    'AGENTS.md',
  ];
  for (const rel of alwaysRemove) {
    if (removeIfExists(projectRoot, rel)) removed.push(rel);
  }

  if (!decision.keepAudit) {
    if (removeIfExists(projectRoot, paths.audit)) removed.push(paths.audit);
  }

  if (!decision.keepMarkdown) {
    for (const rel of [paths.backlog, paths.sprints, paths.roadmap, paths.memory]) {
      if (removeIfExists(projectRoot, rel)) removed.push(rel);
    }
  }

  return removed;
}

function removeIfExists(projectRoot: string, relative: string): boolean {
  const target = path.join(projectRoot, relative);
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}
