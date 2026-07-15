import type { Command } from 'commander';
import { printError } from '../../errors/error-printer.js';
import type { WorkGraphLintReport } from '../../services/lint/work-graph-lint-service.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

/**
 * Registers the `mnema lint` command group — read-only integrity checks
 * over the work graph.
 *
 * Subcommands:
 * - `lint sprint <key>` → diagnostics for a sprint's tasks
 * - `lint epic <key>`   → diagnostics for an epic's tasks
 *
 * Mirrors `skill lint` / `memory lint`: it reports, it never mutates.
 * Exit code is 1 when any `error`-severity diagnostic is present, so it
 * can gate CI; warnings alone keep exit 0.
 */
export class LintCommand {
  /**
   * Attaches the `lint` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program
      .command('lint')
      .description('Read-only integrity checks over the work graph');

    group
      .command('sprint <key>')
      .description('Lint a sprint: incomplete tasks, subagent-bypass, broken dependencies')
      .action(async (key: string) => {
        await withCliContext(({ container }) => {
          const result = container.workGraphLint.lintSprint(key);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.exit(renderReport(`sprint ${key}`, result.value));
        });
      });

    group
      .command('epic <key>')
      .description('Lint an epic: empty, incomplete tasks, subagent-bypass, broken dependencies')
      .action(async (key: string) => {
        await withCliContext(({ container }) => {
          const result = container.workGraphLint.lintEpic(key);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.exit(renderReport(`epic ${key}`, result.value));
        });
      });
  }
}

/**
 * Prints a lint report and returns the process exit code (1 when any
 * error-severity diagnostic is present, 0 otherwise).
 */
function renderReport(scope: string, report: WorkGraphLintReport): number {
  if (report.diagnostics.length === 0) {
    process.stdout.write(`${pc.green('✓')} ${scope}: clean (${report.tasksScanned} task(s))\n`);
    return 0;
  }

  for (const d of report.diagnostics) {
    const tag = d.severity === 'error' ? pc.red('error') : pc.yellow('warning');
    process.stdout.write(`${tag} ${pc.dim(`[${d.rule}]`)} ${d.message}\n`);
  }
  process.stdout.write(
    `${pc.dim('---')} scanned=${report.tasksScanned} errors=${report.errorCount} warnings=${report.warningCount}\n`,
  );
  return report.errorCount > 0 ? 1 : 0;
}
