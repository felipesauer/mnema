import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { MemoryConsolidator } from '../../services/memory-consolidator.js';
import { withCliContext } from '../cli-context.js';

/**
 * Registers `mnema memory`, the human-curated memory entry point.
 *
 * Today exposes a single subcommand — `consolidate` — which rewrites
 * every `INDEX.md` under `memory/` based on the files actually
 * present. The action is idempotent: running it twice in a row leaves
 * the indices byte-identical.
 *
 * Sub-folders without an `INDEX.md` are skipped: the consolidator does
 * not invent paths, only refreshes existing ones.
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
  }
}
