import path from 'node:path';
import {
  type AdoptableComponent,
  type AdoptionResult,
  AdoptionService,
} from '@mnema/core/services/knowledge/adoption-service.js';
import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';
import { enforceStoreFormat, withCliContext } from '../cli-context.js';
import { writeAgentsMd } from '../templates/agents-md.js';

const SUPPORTED: ReadonlyArray<AdoptableComponent | 'all'> = [
  'skills',
  'memory',
  'roadmap',
  'commands',
  'templates',
  'all',
];

/**
 * Registers `mnema adopt`, the gradual-adoption entry point.
 *
 * Components: `skills`, `memory`, `roadmap`, or `all`. Idempotent — a
 * second invocation only writes files that did not yet exist, and
 * never overwrites pre-existing content.
 *
 * Targeted at projects initialised with `--minimal` (or projects that
 * never had Mnema content folders).
 *
 * Adopting `skills` (directly or via `all`) also records the freshly
 * written seed skills as SQLite rows — the same `importSeeds('system')`
 * step `mnema init` runs. Without it the files would read as orphan
 * mirrors and the next `mnema upgrade` would prune them, so the adopt
 * path must reach the DB, not just the filesystem. Every other component
 * is pure files and needs no import.
 */
export class AdoptCommand {
  /**
   * Attaches the `adopt` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('adopt <component>')
      .description(
        'Add an optional layout component (skills, memory, roadmap, commands, templates, all). Idempotent.',
      )
      .action(async (component: string) => {
        if (!SUPPORTED.includes(component as AdoptableComponent | 'all')) {
          process.stderr.write(
            `error: unknown component "${component}". Supported: ${SUPPORTED.join(', ')}\n`,
          );
          process.exit(2);
        }

        await withCliContext((ctx) => {
          enforceStoreFormat(ctx);
          const { config, projectRoot, container } = ctx;
          const service = new AdoptionService(projectRoot);
          const results: AdoptionResult[] =
            component === 'all'
              ? [...service.adoptAll().results]
              : [service.adopt(component as AdoptableComponent)];

          // Skills need a matching DB row per file, or `upgrade` prunes them
          // as orphans. Record the seeds as `system` — the tool is the author,
          // never the human — mirroring `mnema init`. Files already present
          // are no-ops (content-equal), so re-running adopt stays idempotent.
          if (results.some((r) => r.component === 'skills')) {
            container.skill.importSeeds('system');
          }

          for (const result of results) {
            const created = result.created.length;
            const skipped = result.skipped.length;
            process.stdout.write(
              `${pc.green('✓')} ${pc.bold(result.component)} → ${path.relative(projectRoot, result.path)}` +
                ` ${pc.dim(`(created=${created}, skipped=${skipped})`)}\n`,
            );
          }

          // AGENTS.md imports `@memory/INDEX.md` at generation time. When adopt
          // has just created the memory index (it did not exist at init, or
          // this is a --minimal project growing memory), regenerate AGENTS.md
          // now so the index is embedded in one pass — instead of leaving a
          // "skipped — file not found" note for a later `agents sync` to fix.
          const memoryBorn = results.some((r) => r.component === 'memory' && r.created.length > 0);
          if (memoryBorn) {
            const outcome = writeAgentsMd(projectRoot, config);
            process.stdout.write(
              `${pc.green('✓')} ${pc.bold('AGENTS.md')} ${pc.dim(`(${outcome}; embedded the memory index)`)}\n`,
            );
          }
        });
      });
  }
}
