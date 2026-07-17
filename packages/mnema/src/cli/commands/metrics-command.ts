import path from 'node:path';
import {
  type AdoptionMetrics,
  computeAdoptionMetrics,
} from '@mnema/core/services/metrics/adoption-metrics.js';
import { readCounters } from '@mnema/core/services/metrics/metrics-counter.js';
import { pc } from '@mnema/core/utils/colors.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';
import type { Command } from 'commander';
import { withCliContext } from '../cli-context.js';

interface MetricsOptions {
  readonly json?: boolean;
}

/**
 * Registers `mnema metrics` — a LOCAL adoption report for the alpha. It
 * aggregates already-recorded local data (the audit log, the local counter
 * log, and flow metrics) into the alpha success metrics. Strictly local,
 * zero remote telemetry (see MNEMA-ADR-36). Read-only.
 */
export class MetricsCommand {
  /**
   * Attaches the `metrics` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('metrics')
      .description(
        'Local adoption report (quickstart time, feature activation, doctor use) — no telemetry',
      )
      .option('--json', 'Emit the raw adoption metrics as JSON', false)
      .action(async (options: MetricsOptions) => {
        await withCliContext(({ container, projectRoot }) => {
          const stateDir = path.join(projectRoot, LAYOUT.state);
          const events = container.auditQuery.run();
          const counters = readCounters(stateDir);
          const terminal = new Set(container.stateMachine.terminalStates());
          // Reuse the single read above — flow metrics walk the same log, so
          // passing the pre-read events avoids a second full read + parse.
          const flow = container.flowMetrics.compute({ events });

          const metrics = computeAdoptionMetrics(events, counters, terminal, flow);
          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
            return;
          }
          process.stdout.write(render(metrics));
        });
      });
  }
}

/** Pretty-print the adoption report for a human terminal. */
function render(m: AdoptionMetrics): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('Adoption metrics')} ${pc.dim('(local, no telemetry)')}\n`);

  const t = m.timeToFirstDone;
  // Key the message on what actually exists, not on `hours` — `hours` is
  // null both when nothing completed AND when a completion exists but its
  // duration is non-positive/unparseable (clock skew, a rotated-away
  // create event). Reporting "no task completed yet" in the latter case
  // would hide a real completion.
  let quickstart: string;
  if (t.firstTaskAt === null) {
    quickstart = pc.dim('no tasks yet');
  } else if (t.firstDoneAt === null) {
    quickstart = pc.dim('no task completed yet');
  } else if (t.hours === null) {
    quickstart = pc.dim('completed (duration unavailable — check clock skew)');
  } else {
    quickstart = `${t.hours}h ${pc.dim('(first task → first done)')}`;
  }
  lines.push(`  ${pc.dim('time to first done')}   ${quickstart}`);

  const fa = m.featureActivation;
  const badge = (on: boolean, label: string): string =>
    on ? pc.green(`✓ ${label}`) : pc.dim(`· ${label}`);
  lines.push(
    `  ${pc.dim('features activated')}   ${fa.activatedCount}/${fa.trackedCount} ${pc.dim(
      `(${[
        badge(fa.epics, 'epics'),
        badge(fa.decisions, 'ADRs'),
        badge(fa.sprints, 'sprints'),
        badge(fa.dependencies, 'deps'),
        badge(fa.skills, 'skills'),
      ].join(' ')})`,
    )}`,
  );

  lines.push(`  ${pc.dim('doctor runs')}          ${m.doctorRuns}`);

  const sa = m.skillAdoption;
  const adoption =
    sa.recorded === 0 && sa.used === 0
      ? pc.dim('no skill activity')
      : `${sa.used} used / ${sa.recorded} recorded`;
  lines.push(`  ${pc.dim('skill adoption')}       ${adoption}`);

  lines.push('');
  lines.push(
    pc.dim('  doctor/sync performance at >500 tasks: run `pnpm bench:scale` (synthetic).'),
  );
  lines.push(
    pc.dim('  All metrics are derived locally from your audit log — nothing is transmitted.'),
  );
  return `${lines.join('\n')}\n`;
}
