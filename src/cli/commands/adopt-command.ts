import path from 'node:path';

import type { Command } from 'commander';
import {
  type AdoptableComponent,
  type AdoptionResult,
  AdoptionService,
} from '../../services/adoption-service.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

const SUPPORTED: ReadonlyArray<AdoptableComponent | 'all'> = [
  'skills',
  'memory',
  'roadmap',
  'commands',
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
 * never had Mnema content folders). The service does not touch the
 * SQLite cache or audit log.
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
        'Add an optional layout component (skills, memory, roadmap, commands, all). Idempotent.',
      )
      .action(async (component: string) => {
        if (!SUPPORTED.includes(component as AdoptableComponent | 'all')) {
          process.stderr.write(
            `error: unknown component "${component}". Supported: ${SUPPORTED.join(', ')}\n`,
          );
          process.exit(2);
        }

        await withCliContext(({ config, projectRoot }) => {
          const service = new AdoptionService(projectRoot, config);
          const results: AdoptionResult[] =
            component === 'all'
              ? [...service.adoptAll().results]
              : [service.adopt(component as AdoptableComponent)];

          for (const result of results) {
            const created = result.created.length;
            const skipped = result.skipped.length;
            process.stdout.write(
              `${pc.green('✓')} ${pc.bold(result.component)} → ${path.relative(projectRoot, result.path)}` +
                ` ${pc.dim(`(created=${created}, skipped=${skipped})`)}\n`,
            );
          }
        });
      });
  }
}
