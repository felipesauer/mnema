import { writeFileSync } from 'node:fs';

import type { Command } from 'commander';

import { buildDashboardData, DEFAULT_RECENT_LIMIT } from '../../services/dashboard-data.js';
import { renderDashboard } from '../../services/dashboard-render.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

// Re-exported so existing importers (and tests) keep a single entry point
// even though the projection now lives with the shared data helper.
export { toRecentEvent } from '../../services/dashboard-data.js';

interface DashboardOptions {
  readonly out?: string;
  readonly limit?: string;
}

/**
 * Registers `mnema dashboard` — a single self-contained HTML view over
 * data Mnema already records (audit-chain verdict, project dependency
 * graph, SLA breaches, recent trail activity). Strictly read-only: it
 * consumes the existing read services and collects nothing new (see
 * MNEMA-ADR-32). Writes to stdout, or to a file with `--out`.
 */
export class DashboardCommand {
  /**
   * Attaches the `dashboard` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('dashboard')
      .description(
        'Self-contained HTML dashboard over recorded data (audit chain, deps, SLA, activity) — read-only',
      )
      .option('--out <file>', 'Write the HTML to a file instead of stdout')
      .option('--limit <n>', `Recent-activity rows to show (default ${DEFAULT_RECENT_LIMIT})`)
      .action(async (options: DashboardOptions) => {
        const limit = parseLimit(options.limit);
        if (limit === null) {
          process.stderr.write(`${pc.red('error:')} --limit must be a positive integer\n`);
          process.exit(2);
        }

        await withCliContext(({ container, config, projectRoot }) => {
          const data = buildDashboardData(container, config, projectRoot, { limit });
          const html = renderDashboard(data);
          if (options.out !== undefined) {
            writeFileSync(options.out, html, 'utf-8');
            process.stdout.write(`${pc.green('✓')} dashboard written to ${options.out}\n`);
            return;
          }
          process.stdout.write(html);
        });
      });
  }
}

/**
 * Parses `--limit`: absent falls back to the default; a plain decimal
 * positive integer is honored; anything else is rejected (`null`) so a
 * typo is a hard error rather than silently returning the whole trail.
 *
 * The decimal-digit regex is deliberate: `Number('0x10')` is 16 and
 * `Number('1e3')` is 1000, both of which pass `Number.isInteger`, so a
 * bare `Number()` check would silently honor hex/exponent strings the
 * error message promises to reject. Matching `^[0-9]+$` first keeps the
 * contract ("positive integer") literal.
 */
export function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_RECENT_LIMIT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
