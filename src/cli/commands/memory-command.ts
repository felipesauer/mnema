import path from 'node:path';

import type { Command } from 'commander';
import { ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import { MemoryConsolidator } from '../../services/knowledge/memory-consolidator.js';
import { MemoryLinter } from '../../services/knowledge/memory-linter.js';
import { pc } from '../../utils/colors.js';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';
import { collectRepeatable } from '../option-helpers.js';

interface LintOptions {
  readonly json?: boolean;
}

interface ListOptions {
  readonly topic?: string;
}

interface RecordOptions {
  readonly title: string;
  readonly content: string;
  readonly topic?: readonly string[];
  readonly scope?: string;
  readonly derivedFromDecision?: string;
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

    group
      .command('record <slug>')
      .description('Record (or update) a memory by slug')
      .requiredOption('--title <title>', 'Human-readable title')
      .requiredOption('--content <text>', 'Memory body')
      .option('--topic <topic>', 'Topic tag (repeatable)', collectRepeatable, [])
      .option(
        '--scope <area>',
        'Area this memory belongs to, e.g. packages/notifier (omit for a global memory)',
      )
      .option(
        '--derived-from-decision <key>',
        'Decision key (e.g. an ADR) this memory derives from — records a decision→memory provenance edge',
      )
      .action(async (slug: string, options: RecordOptions) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.memory.record({
            slug,
            title: options.title,
            content: options.content,
            topics: options.topic,
            ...(options.scope === undefined ? {} : { scope: options.scope }),
            actor: container.identity.getDefaultActor(),
            via: 'cli',
            ...(options.derivedFromDecision === undefined
              ? {}
              : { derivedFromDecision: options.derivedFromDecision }),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const { memory, action } = result.value;
          const verb =
            action === 'no_op' ? 'unchanged' : action === 'created' ? 'recorded' : 'updated';
          process.stdout.write(`${pc.green('✓')} ${verb} ${pc.bold(memory.slug)}\n`);
        });
      });

    group
      .command('list')
      .description('List recorded memories')
      .option('--topic <topic>', 'Filter by topic')
      .action(async (options: ListOptions) => {
        await withCliContext(({ container }) => {
          const memories = container.memory.list(options.topic);
          if (memories.length === 0) {
            process.stdout.write(`${pc.dim('no memories recorded yet')}\n`);
            return;
          }
          for (const m of memories) {
            const topics = m.topics.length > 0 ? `[${m.topics.join(', ')}]` : '';
            process.stdout.write(`${pc.bold(m.slug)}  ${m.title}  ${pc.dim(topics)}\n`);
          }
        });
      });

    group
      .command('show <slug>')
      .description('Show a recorded memory by slug')
      .action(async (slug: string) => {
        await withCliContext(({ container }) => {
          const result = container.memory.show(slug);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const m = result.value;
          const topics = m.topics.length > 0 ? `topics: [${m.topics.join(', ')}]` : '';
          process.stdout.write(
            `${pc.bold(m.slug)} — ${m.title}\n${pc.dim(topics)}\n\n${m.content}\n`,
          );
        });
      });

    group
      .command('archive <slug>')
      .description('Archive a memory (soft, reversible; re-record the slug to bring it back)')
      .action(async (slug: string) => {
        await withMutatingCliContext(({ container }) => {
          const archived = container.memory.archive(slug, container.identity.getDefaultActor());
          if (!archived) {
            process.stderr.write(
              `${pc.red('error:')} no active memory with slug ${pc.bold(slug)}\n`,
            );
            process.exit(1);
          }
          process.stdout.write(`${pc.green('✓')} archived ${pc.bold(slug)}\n`);
        });
      });

    group
      .command('supersede <slug> <successor>')
      .description('Supersede a memory: point it at a successor that replaces it (one-way)')
      .action(async (slug: string, successor: string) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.memory.supersede(
            slug,
            successor,
            container.identity.getDefaultActor(),
          );
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(
            `${pc.green('✓')} superseded ${pc.bold(slug)} → ${pc.bold(successor)}\n`,
          );
        });
      });
  }
}
