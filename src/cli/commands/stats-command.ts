import type { Command } from 'commander';

import type { DurationSummary, FlowMetrics } from '../../services/flow-metrics-service.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

interface StatsOptions {
  readonly since?: string;
  readonly json?: boolean;
}

/**
 * Registers `mnema stats` — derived flow metrics from the audit log
 * (throughput, lead/cycle time, reopen rate, estimate-vs-actual). The
 * numbers the usage reports had to compute by hand with grep.
 */
export class StatsCommand {
  /**
   * Attaches the `stats` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('stats')
      .description(
        'Show derived flow metrics (throughput, lead/cycle time, reopen rate) from the audit log',
      )
      .option('--since <duration>', 'Lower bound — `7d`, `30d` or an ISO8601 timestamp')
      .option('--json', 'Emit the raw metrics object as JSON', false)
      .action(async (options: StatsOptions) => {
        await withCliContext(({ container }) => {
          const metrics = container.flowMetrics.compute(
            options.since === undefined ? {} : { since: options.since },
          );
          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
            return;
          }
          process.stdout.write(render(metrics, options.since));
        });
      });
  }
}

/** Pretty-print the metrics for a human terminal. */
function render(m: FlowMetrics, since: string | undefined): string {
  const lines: string[] = [];
  const window = since !== undefined ? ` ${pc.dim(`(since ${since})`)}` : '';
  lines.push(`${pc.bold('Flow metrics')}${window}\n`);
  lines.push(`  ${pc.dim('throughput')}     ${m.throughput} task(s) reached a terminal state`);
  lines.push(`  ${pc.dim('lead time')}      ${summary(m.lead_time)}`);
  lines.push(`  ${pc.dim('cycle time')}     ${summary(m.cycle_time)}`);
  const pct = Math.round(m.reopen.rate * 100);
  lines.push(
    `  ${pc.dim('reopen rate')}    ${pct}% ${pc.dim(`(${m.reopen.reopened_tasks}/${m.reopen.completed_tasks})`)}`,
  );
  const hpp = m.estimate_vs_actual.hours_per_point;
  const eva = m.estimate_vs_actual;
  const evaSource =
    eva.lead_time_fallback_samples > 0
      ? pc.dim(
          `(${eva.run_duration_samples} by run, ${eva.lead_time_fallback_samples} by lead-time fallback)`,
        )
      : pc.dim(`(${eva.run_duration_samples} sample(s), by run duration)`);
  lines.push(
    `  ${pc.dim('est vs actual')}  ${
      hpp === null ? pc.dim('no estimated+done tasks') : `${hpp}h per point ${evaSource}`
    }`,
  );

  if (m.velocity.length === 0) {
    lines.push(`  ${pc.dim('velocity')}       ${pc.dim('no sprint has completed tasks')}`);
  } else {
    lines.push(`  ${pc.dim('velocity')}`);
    for (const v of m.velocity) {
      lines.push(
        `    ${v.sprint_key} ${v.completed_points} pt ${pc.dim(`(${v.completed_tasks} task(s)) — ${v.sprint_name}`)}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** One-line rendering of a duration summary. */
function summary(s: DurationSummary): string {
  if (s.count === 0) return pc.dim('no samples');
  return `median ${s.median_hours}h ${pc.dim(`(avg ${s.avg_hours}h, max ${s.max_hours}h, n=${s.count})`)}`;
}
