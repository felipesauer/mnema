import type { Command } from 'commander';

import type { EvalCohort, EvalReport } from '../../services/eval-report-service.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';
import { parseTimeBoundOption } from '../option-helpers.js';

interface EvalOptions {
  readonly since?: string;
  readonly json?: boolean;
}

/**
 * Registers `mnema eval` — a guided-vs-unguided metrics diff derived from
 * the audit log. The honest first slice of an eval
 * harness: it partitions runs by an observable guidance proxy (did the run
 * use a recorded skill) and diffs reopen rate and lead/cycle time. It is a
 * correlation over work that already happened — it does not run agents, and
 * the caveat is printed with the numbers. Local, zero-telemetry, read-only.
 */
export class EvalCommand {
  /**
   * Attaches the `eval` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('eval')
      .description('Guided-vs-unguided metrics diff from the audit log (correlational, not causal)')
      .option(
        '--since <duration>',
        'Lower bound — `7d`, `30d` or an ISO8601 timestamp',
        parseTimeBoundOption,
      )
      .option('--json', 'Emit the raw report object as JSON', false)
      .action(async (options: EvalOptions) => {
        await withCliContext(({ container, config }) => {
          const report = container.evalReport.compute({
            ...(options.since === undefined ? {} : { since: options.since }),
            proxy: config.eval.guided_proxy,
          });
          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
            return;
          }
          process.stdout.write(render(report, options.since));
        });
      });
  }
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

function cohortLine(label: string, c: EvalCohort): string {
  const r = c.metrics.reopen;
  const lead = c.metrics.lead_time.median_hours;
  const cycle = c.metrics.cycle_time.median_hours;
  const leadStr = lead === null ? '—' : `${lead.toFixed(1)}h`;
  const cycleStr = cycle === null ? '—' : `${cycle.toFixed(1)}h`;
  return (
    `  ${pc.bold(label.padEnd(9))} runs=${String(c.runs).padStart(3)}  ` +
    `done=${String(r.completed_tasks).padStart(3)}  ` +
    `reopen=${pct(r.rate).padStart(4)}  ` +
    `lead(med)=${leadStr.padStart(7)}  cycle(med)=${cycleStr.padStart(7)}`
  );
}

function render(report: EvalReport, since: string | undefined): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(pc.bold(`Eval — guided vs unguided${since !== undefined ? ` (since ${since})` : ''}`));
  lines.push('');
  lines.push(cohortLine('guided', report.guided));
  lines.push(cohortLine('unguided', report.unguided));
  lines.push('');
  lines.push(`  ${pc.dim(`skills flagged for review: ${report.skills_flagged_for_review}`)}`);
  lines.push('');
  lines.push(`  ${pc.dim(`proxy: ${report.proxy}`)}`);
  lines.push('');
  lines.push(pc.yellow(`  ⚠ ${report.caveat}`));
  lines.push('');
  return `${lines.join('\n')}\n`;
}
