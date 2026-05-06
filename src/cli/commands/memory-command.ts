import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { ExitCode } from '../../errors/error-codes.js';
import { MemoryConsolidator } from '../../services/memory-consolidator.js';
import { MemoryLinter } from '../../services/memory-linter.js';
import { withCliContext } from '../cli-context.js';

interface LintOptions {
  readonly json?: boolean;
}

/**
 * Registers `mnema memory`, the human-curated memory entry point.
 *
 * Subcommands:
 * - `memory consolidate` — rewrites every `INDEX.md` under `memory/`
 *   based on the files actually present. Idempotent.
 * - `memory lint`        — validates the shape of ADRs in
 *   `memory/decisions/` (frontmatter status, canonical sections).
 */
export class MemoryCommand {
  /**
   * Attaches the `memory` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('memory').description('Manage human-curated memory');

    group
      .command('consolidate')
      .description('Regenerate memory/INDEX.md and decisions/notes indices')
      .action(async () => {
        await withCliContext(({ config, projectRoot }) => {
          const memoryDir = path.join(projectRoot, config.paths.memory);
          const summary = new MemoryConsolidator(memoryDir).run();

          const sections: { name: string; payload: typeof summary.memory }[] = [
            { name: 'memory', payload: summary.memory },
            { name: 'decisions', payload: summary.decisions },
            { name: 'notes', payload: summary.notes },
          ];
          for (const { name, payload } of sections) {
            if (payload === null) {
              process.stdout.write(`${pc.dim('—')} ${name}: not initialised\n`);
              continue;
            }
            process.stdout.write(
              `${pc.green('✓')} ${name}: ${payload.entries.length} entry/entries → ${path.relative(projectRoot, payload.indexPath)}\n`,
            );
          }
        });
      });

    group
      .command('lint')
      .description('Validate ADRs in memory/decisions/ (frontmatter, canonical sections)')
      .option('--json', 'Print diagnostics as JSON', false)
      .action(async (options: LintOptions) => {
        await withCliContext(({ config, projectRoot }) => {
          const memoryDir = path.join(projectRoot, config.paths.memory);
          const report = new MemoryLinter(memoryDir).lint();

          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
          } else if (report.diagnostics.length === 0) {
            process.stdout.write(
              `${pc.green('✓')} ${report.filesScanned} memory file(s) lint clean\n`,
            );
          } else {
            for (const diag of report.diagnostics) {
              const badge = diag.severity === 'error' ? pc.red('error:') : pc.yellow('warning:');
              process.stdout.write(`${badge} ${pc.dim(diag.file)}\n  ${diag.message}\n`);
            }
            process.stdout.write(
              `${pc.dim('---')} scanned=${report.filesScanned} errors=${report.errorCount} warnings=${report.warningCount}\n`,
            );
          }

          if (report.errorCount > 0) {
            process.exit(ExitCode.State);
          }
        });
      });
  }
}
