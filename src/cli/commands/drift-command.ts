import type { Command } from 'commander';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

interface DriftOptions {
  readonly json?: boolean;
  readonly base?: string;
  readonly limit?: string;
}

/**
 * Registers `mnema drift`, a scan for commits no task claims.
 *
 * Surfaces the "committed code with no task" governance gap so a human
 * can tie the commits to a task. Read-only; prints nothing alarming when
 * git is unavailable — it just says the scan was skipped.
 */
export class DriftCommand {
  /**
   * Attaches the `drift` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('drift')
      .description('List commits on this branch not tied to any task')
      .option('--json', 'Print the scan as JSON', false)
      .option('--base <ref>', 'Scan only commits ahead of this ref (e.g. main)')
      .option('--limit <n>', 'When no base is given, how many recent commits to scan')
      .action(async (options: DriftOptions) => {
        await withCliContext(({ container, projectRoot }) => {
          const limit =
            options.limit === undefined ? undefined : Number.parseInt(options.limit, 10);
          const result = container.drift.scan(projectRoot, {
            ...(options.base === undefined ? {} : { base: options.base }),
            ...(limit === undefined || Number.isNaN(limit) ? {} : { limit }),
          });

          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }
          if (!result.checked) {
            process.stdout.write(
              `${pc.dim(`drift scan skipped — ${result.reason ?? 'unavailable'}`)}\n`,
            );
            return;
          }
          if (result.untracked.length === 0) {
            process.stdout.write(
              `${pc.green('✓')} ${result.scanned} commit(s) scanned — all tied to a task\n`,
            );
            return;
          }
          const lines: string[] = [];
          lines.push(
            `${pc.yellow('▲')} ${pc.bold(`${result.untracked.length} commit(s) with no task`)} ` +
              `${pc.dim(`(of ${result.scanned} scanned)`)}`,
          );
          for (const c of result.untracked) {
            lines.push(`  ${pc.yellow(c.sha)} ${c.subject}`);
          }
          lines.push(
            pc.dim(
              '  tie a commit to a task with `mnema task evidence <key> --criterion <i> --ref <sha> --kind commit`',
            ),
          );
          process.stdout.write(`${lines.join('\n')}\n`);
        });
      });
  }
}
