import { writeFileSync } from 'node:fs';
import { printError } from '@mnema/core/errors/error-printer.js';
import { renderHtml, renderMarkdown } from '@mnema/core/services/snapshot/snapshot-render.js';
import type { SnapshotScope } from '@mnema/core/services/snapshot/snapshot-service.js';
import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';
import { withCliContext } from '../cli-context.js';

interface SnapshotOptions {
  readonly epic?: string;
  readonly sprint?: string;
  readonly html?: boolean;
  readonly out?: string;
}

/**
 * Registers `mnema snapshot` — an executive snapshot of an epic or
 * sprint (coverage, dependency picture, SLA breaches), composed from
 * existing services. Markdown by default; `--html` for a self-contained
 * document; `--out` to write to a file. Read-only.
 */
export class SnapshotCommand {
  /**
   * Attaches the `snapshot` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('snapshot')
      .description(
        'Executive snapshot of an epic or sprint (coverage, deps, SLA) — markdown or HTML',
      )
      .option('--epic <key>', 'Snapshot this epic')
      .option('--sprint <key>', 'Snapshot this sprint')
      .option('--html', 'Render a self-contained HTML document instead of markdown', false)
      .option('--out <file>', 'Write the output to a file instead of stdout')
      .action(async (options: SnapshotOptions) => {
        const hasEpic = options.epic !== undefined;
        const hasSprint = options.sprint !== undefined;
        if (hasEpic === hasSprint) {
          process.stderr.write(`${pc.red('error:')} pass exactly one of --epic / --sprint\n`);
          process.exit(2);
        }
        await withCliContext(({ container }) => {
          const scope: SnapshotScope = hasEpic
            ? { kind: 'epic', key: options.epic as string }
            : { kind: 'sprint', key: options.sprint as string };
          const result = container.snapshot.forScope(scope);
          if (!result.ok) {
            process.exit(printError(result.error));
            return;
          }
          const rendered =
            options.html === true ? renderHtml(result.value) : renderMarkdown(result.value);
          if (options.out !== undefined) {
            writeFileSync(options.out, rendered, 'utf-8');
            process.stdout.write(`${pc.green('✓')} snapshot written to ${options.out}\n`);
            return;
          }
          process.stdout.write(rendered);
        });
      });
  }
}
