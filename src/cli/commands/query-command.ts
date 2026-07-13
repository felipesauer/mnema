import type { Command } from 'commander';

import type { PortfolioResult } from '../../services/portfolio-service.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';
import { parseIsoBoundOption } from '../option-helpers.js';

interface QueryOptions {
  readonly state?: string;
  readonly epic?: string;
  readonly sprint?: string;
  readonly since?: string;
  readonly until?: string;
  readonly text?: string;
  readonly label?: string[];
  readonly json?: boolean;
}

/**
 * Registers `mnema query` — the aggregate backlog read: counts and lists
 * tasks filtered by state, epic, sprint, creation window and free text.
 * The static cut that `mnema stats` (flow) doesn't give.
 */
export class QueryCommand {
  /**
   * Attaches the `query` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('query')
      .description('Query the backlog by state, epic, sprint, label, creation window or free text')
      .option('--state <state>', 'Filter by exact workflow state, e.g. IN_REVIEW')
      .option('--epic <key>', 'Filter by epic key')
      .option('--sprint <key>', 'Filter by sprint key')
      .option('--label <label...>', 'Filter by label (repeat for AND; task must carry all)')
      .option('--since <iso>', 'Created at or after (ISO-8601)', parseIsoBoundOption)
      .option('--until <iso>', 'Created at or before (ISO-8601)', parseIsoBoundOption)
      .option('--text <text>', 'Substring over title + description')
      .option('--json', 'Emit the raw result as JSON', false)
      .action(async (options: QueryOptions) => {
        await withCliContext(({ container }) => {
          const result = container.portfolio.run({
            state: options.state,
            epicKey: options.epic,
            sprintKey: options.sprint,
            labels: options.label,
            createdSince: options.since,
            createdUntil: options.until,
            text: options.text,
          });
          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }
          process.stdout.write(render(result));
        });
      });
  }
}

/** Pretty-print the portfolio result for a human terminal. */
function render(r: PortfolioResult): string {
  const lines: string[] = [];
  const byState = Object.entries(r.by_state)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s} ${n}`)
    .join('  ');
  lines.push(`${pc.bold(`${r.total} task(s)`)}${byState.length > 0 ? `  ${pc.dim(byState)}` : ''}`);
  if (r.tasks.length === 0) {
    lines.push(pc.dim('  (no matches)'));
    return `${lines.join('\n')}\n`;
  }
  for (const t of r.tasks) {
    const labels = t.labels.length > 0 ? `  ${pc.dim(`[${t.labels.join(', ')}]`)}` : '';
    lines.push(`  ${pc.bold(t.key.padEnd(12))} ${pc.dim(t.state.padEnd(12))} ${t.title}${labels}`);
  }
  return `${lines.join('\n')}\n`;
}
