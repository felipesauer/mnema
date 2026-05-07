import { existsSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

// `@inquirer/prompts` is loaded lazily inside `resolveDecision` —
// `--yes` skips the cost, and unrelated CLI paths never touch it.

import { ConfigLoader } from '../../config/config-loader.js';
import { ErrorCode, ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import { workflowsDir } from '../../utils/asset-paths.js';
import { isPromptAbort } from '../prompt-helpers.js';

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

        let decision: DestroyDecision | null;
        try {
          decision = await resolveDecision(options, config.project.key);
        } catch (error) {
          if (isPromptAbort(error)) {
            process.stdout.write(`${pc.dim('aborted')}\n`);
            return;
          }
          throw error;
        }
        if (decision === null) {
          process.stdout.write(`${pc.dim('aborted')}\n`);
          return;
        }

        const removed = removeArtifacts(
          projectRoot,
          { ...config.paths, workflow: config.workflow },
          decision,
        );
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
 * {@link import('../../config/config-schema.js').Config.paths} plus
 * the active workflow name so destroy can target only the JSON file
 * `init` actually wrote (rather than the whole `workflows/`
 * directory, which the user might own for unrelated reasons —
 * notably the Mnema repo dogfooding itself, where `workflows/`
 * carries the bundled presets).
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
  readonly workflow: string;
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

  // Owned by Mnema unconditionally: the config file, the AGENTS.md
  // template (init no-ops on a pre-existing one, but if we are here
  // the project was Mnema-managed, so AGENTS.md is fair game), and
  // the state directory (`.app/` by default — gitignored, holds the
  // SQLite database and attachments).
  for (const rel of ['mnema.config.json', 'AGENTS.md', paths.state]) {
    if (removeIfExists(projectRoot, rel)) removed.push(rel);
  }

  // The bundled workflow JSON: only remove the file `init` actually
  // wrote, not the whole directory. Use a byte-for-byte match against
  // the package's bundled template — if the user customised the
  // workflow, it stays. The directory is left in place either way;
  // the user might keep custom workflows there.
  const removedWorkflow = removeBundledWorkflow(projectRoot, paths.workflows, paths.workflow);
  if (removedWorkflow !== null) removed.push(removedWorkflow);

  // The skills directory: init creates it empty, so only delete it
  // when still empty. Any skill the user wrote (or that `mnema adopt`
  // dropped in) keeps the directory alive.
  if (removeIfEmptyDir(projectRoot, paths.skills)) removed.push(paths.skills);

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

function removeIfEmptyDir(projectRoot: string, relative: string): boolean {
  const target = path.join(projectRoot, relative);
  if (!existsSync(target)) return false;
  const stat = statSync(target);
  if (!stat.isDirectory()) return false;
  if (readdirSync(target).length > 0) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

/**
 * Removes the workflow JSON only when it byte-matches the bundled
 * template — i.e. the user has not customised it since `init`. Returns
 * the relative path that was removed, or `null` when nothing was.
 *
 * Refuses to delete the file when its absolute path is the same as
 * the bundled template's; that case happens when Mnema dogfoods on
 * itself (the project root and the package root coincide), and the
 * file in question IS the source-of-truth for every other consumer.
 */
function removeBundledWorkflow(
  projectRoot: string,
  workflowsRel: string,
  workflowName: string,
): string | null {
  const filename = `${workflowName}.json`;
  const target = path.join(projectRoot, workflowsRel, filename);
  if (!existsSync(target)) return null;

  const bundled = path.join(workflowsDir(), filename);
  if (!existsSync(bundled)) return null;

  if (path.resolve(target) === path.resolve(bundled)) return null;

  const targetBytes = readFileSync(target);
  const bundledBytes = readFileSync(bundled);
  if (!targetBytes.equals(bundledBytes)) return null;

  unlinkSync(target);
  return path.join(workflowsRel, filename);
}
