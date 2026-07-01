import type { Command } from 'commander';
import type { AgentPlan } from '../../domain/entities/agent-plan.js';
import type { AgentRun } from '../../domain/entities/agent-run.js';
import { AgentPlanState } from '../../domain/enums/agent-plan-state.js';
import { AgentRunStatus } from '../../domain/enums/agent-run-status.js';
import { printError } from '../../errors/error-printer.js';
import type { RunDiff } from '../../services/run-diff-service.js';
import type { ServiceContainer } from '../../services/service-container.js';
import type { TransitionWithKey } from '../../storage/sqlite/repositories/transition-repository.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';
import { formatTimestamp, type TimestampMode } from '../formatters/timestamp-formatter.js';

interface InspectOptions {
  readonly iso?: boolean;
}

/**
 * Registers the `mnema agent` command group.
 *
 * Exposes `agent inspect <runId>` (full plan tree + transitions) and
 * `agent resume <runId>` (reattach to an interrupted run and print a
 * summary of what is still open).
 */
export class AgentCommand {
  /**
   * Attaches the `agent` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('agent').description('Inspect agent activity');

    group
      .command('inspect <runId>')
      .description('Show a detailed view of a single agent run')
      .option('--iso', 'Show timestamps as ISO8601 instead of relative', false)
      .action(async (runId: string, options: InspectOptions) => {
        await withCliContext(({ container }) => {
          const runResult = container.agentRun.findById(runId);
          if (!runResult.ok) {
            process.exit(printError(runResult.error));
          }
          const run = runResult.value;
          const plans = container.agentPlan.list(run.id);
          const transitions = container.transitions.findByRun(run.id);
          const children = container.agentRun.findChildren(run.id);
          let parent: AgentRun | null = null;
          if (run.parentRunId !== null) {
            const parentResult = container.agentRun.findById(run.parentRunId);
            if (parentResult.ok) parent = parentResult.value;
          }
          const mode: TimestampMode = options.iso === true ? 'iso' : 'relative';

          process.stdout.write(
            `${formatRunDetail(run, plans, transitions, parent, children, mode)}\n`,
          );
        });
      });

    group
      .command('diff <runId>')
      .description(
        'Summarise everything one run changed (transitions, evidence, decisions, knowledge)',
      )
      .option('--json', 'Emit the raw diff as JSON', false)
      .action(async (runId: string, options: { json?: boolean }) => {
        await withCliContext(({ container }) => {
          const result = container.runDiff.forRun(runId);
          if (!result.ok) {
            process.exit(printError(result.error));
            return;
          }
          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
            return;
          }
          process.stdout.write(`${formatRunDiff(result.value)}\n`);
        });
      });

    group
      .command('close-orphans')
      .description('Find runs left open past the threshold; with --apply, abort them with a note')
      .option('--apply', 'Actually abort the stale runs (otherwise just list them)', false)
      .option('--hours <n>', 'Override the orphan threshold in hours')
      .action(async (options: { apply?: boolean; hours?: string }) => {
        await withCliContext(({ container, config }) => {
          const threshold =
            options.hours !== undefined
              ? Number.parseInt(options.hours, 10)
              : config.aging.orphan_run_after_hours;
          if (!Number.isInteger(threshold) || threshold <= 0) {
            process.stderr.write(`${pc.red('error:')} --hours must be a positive integer\n`);
            process.exit(2);
          }
          if (options.apply === true) {
            const result = container.orphanRun.closeStale(threshold);
            if (!result.ok) {
              process.exit(printError(result.error));
              return;
            }
            if (result.value.length === 0) {
              process.stdout.write(`${pc.dim('No orphaned runs to close.')}\n`);
              return;
            }
            for (const c of result.value) {
              const mark = c.closed ? pc.green('✓') : pc.yellow('—');
              process.stdout.write(`${mark} ${c.id} ${pc.dim(`(${c.ageHours}h)`)}\n`);
            }
            return;
          }
          const orphans = container.orphanRun.detect(threshold);
          if (orphans.length === 0) {
            process.stdout.write(`${pc.dim(`No runs open longer than ${threshold}h.`)}\n`);
            return;
          }
          process.stdout.write(
            `${pc.yellow(`${orphans.length} orphaned run(s)`)} ${pc.dim(`(open > ${threshold}h; rerun with --apply to abort)`)}\n`,
          );
          for (const o of orphans) {
            process.stdout.write(`  ${o.id} ${pc.dim(`${o.ageHours}h — ${o.goal}`)}\n`);
          }
        });
      });

    group
      .command('resume <runId>')
      .description('Reattach to an interrupted run and summarise what is still open')
      .action(async (runId: string) => {
        await withCliContext(({ container }) => {
          const actor = container.identity.getDefaultActor();
          const result = container.agentRun.resume({ runId, actor });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const run = result.value;

          const summaryResult = container.agentRun.summarize(run.id);
          process.stdout.write(`${formatResume(run, summaryResult)}\n`);
        });
      });
  }
}

function formatResume(
  run: AgentRun,
  summaryResult: ReturnType<ServiceContainer['agentRun']['summarize']>,
): string {
  const lines: string[] = [];
  lines.push(`${pc.green('Resumed run:')} ${run.id}`);
  lines.push(`${pc.bold('Goal:')} ${run.goal}`);
  lines.push(`${pc.bold('Status:')} ${formatStatus(run.status)}`);

  if (!summaryResult.ok) {
    return lines.join('\n');
  }
  const summary = summaryResult.value;
  lines.push('');
  lines.push(
    `${pc.bold('So far:')} ${summary.mutationCount} mutation(s), ${summary.planCount} plan(s)`,
  );

  lines.push('');
  lines.push(`${pc.bold(`Open items (${summary.openItems.length}):`)}`);
  if (summary.openItems.length === 0) {
    lines.push(`  ${pc.dim('(nothing left open — pick up fresh work)')}`);
  } else {
    for (const item of summary.openItems) {
      const tag = item.kind === 'plan' ? pc.dim('plan') : pc.dim('run ');
      lines.push(`  ${tag} ${pc.yellow(`[${item.status}]`)} ${item.label}`);
    }
  }
  return lines.join('\n');
}

function formatRunDiff(diff: RunDiff): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('Run:')} ${diff.run.id} ${pc.dim(`(${formatStatus(diff.run.status)})`)}`);
  lines.push(`${pc.bold('Goal:')} ${diff.run.goal}`);
  lines.push(
    pc.dim(
      `${diff.counts.transitions} transition(s), ${diff.counts.evidence} evidence, ` +
        `${diff.counts.decisions} decision(s), ${diff.counts.knowledge} knowledge`,
    ),
  );

  const section = (title: string, changes: RunDiff['transitions']): void => {
    if (changes.length === 0) return;
    lines.push('');
    lines.push(pc.bold(title));
    for (const c of changes) {
      lines.push(`  ${c.summary}`);
    }
  };
  section('Transitions', diff.transitions);
  section('Evidence', diff.evidence);
  section('Decisions', diff.decisions);
  section('Knowledge', diff.knowledge);

  if (
    diff.counts.transitions +
      diff.counts.evidence +
      diff.counts.decisions +
      diff.counts.knowledge ===
    0
  ) {
    lines.push('');
    lines.push(pc.dim('(this run produced no substantive changes)'));
  }
  return lines.join('\n');
}

function formatRunDetail(
  run: AgentRun,
  plans: readonly AgentPlan[],
  transitions: readonly TransitionWithKey[],
  parent: AgentRun | null,
  children: readonly AgentRun[],
  mode: TimestampMode,
): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('Run:')} ${run.id}`);
  lines.push(`${pc.bold('Goal:')} ${run.goal}`);
  lines.push(`${pc.bold('Status:')} ${formatStatus(run.status)}`);
  lines.push(`${pc.bold('Started:')} ${formatTimestamp(run.startedAt, mode)}`);
  lines.push(
    `${pc.bold('Ended:')} ${run.endedAt !== null ? formatTimestamp(run.endedAt, mode) : pc.dim('(still running)')}` +
      (run.endedAt !== null ? ` (${formatDuration(run.startedAt, run.endedAt)})` : ''),
  );
  lines.push(`${pc.bold('Depth:')} ${run.depth}`);
  if (parent !== null) {
    lines.push(`${pc.bold('Parent:')} ${parent.id} ${pc.dim(`(${parent.goal})`)}`);
  }
  if (run.error !== null) {
    lines.push(`${pc.bold('Error:')} ${pc.red(run.error)}`);
  }

  lines.push('');
  lines.push(`${pc.bold(`Children (${children.length}):`)}`);
  if (children.length === 0) {
    lines.push(`  ${pc.dim('(no nested runs)')}`);
  } else {
    for (const child of children) {
      const ended =
        child.endedAt !== null
          ? `${formatTimestamp(child.endedAt, mode)} (${formatDuration(child.startedAt, child.endedAt)})`
          : pc.dim('(still running)');
      lines.push(
        `  ${formatStatus(child.status).padEnd(10)} ${pc.bold(child.id)} ${pc.dim(`d=${child.depth}`)}  ${child.goal}`,
      );
      lines.push(
        `    ${pc.dim(`started ${formatTimestamp(child.startedAt, mode)}, ended ${ended}`)}`,
      );
    }
  }

  lines.push('');
  lines.push(`${pc.bold(`Plans (${plans.length}):`)}`);
  if (plans.length === 0) {
    lines.push(`  ${pc.dim('(no plans recorded)')}`);
  } else {
    for (const plan of buildPlanTree(plans)) {
      renderPlan(plan, plans, lines, '  ');
    }
  }

  lines.push('');
  lines.push(`${pc.bold(`Mutations (${transitions.length}):`)}`);
  if (transitions.length === 0) {
    lines.push(`  ${pc.dim('(no mutations attributed to this run)')}`);
  } else {
    for (const transition of transitions) {
      const arrow =
        transition.fromState !== null
          ? `${transition.fromState} → ${transition.toState}`
          : `→ ${transition.toState}`;
      lines.push(
        `  ${pc.dim(formatTimestamp(transition.at, mode))}  ${transition.action.padEnd(14)} ${pc.bold(transition.taskKey.padEnd(12))} ${pc.cyan(arrow)}`,
      );
    }
  }

  return lines.join('\n');
}

function formatStatus(status: AgentRunStatus): string {
  switch (status) {
    case AgentRunStatus.Completed:
      return pc.green(status);
    case AgentRunStatus.Running:
      return pc.cyan(status);
    case AgentRunStatus.Failed:
      return pc.red(status);
    case AgentRunStatus.Aborted:
      return pc.yellow(status);
    default:
      return status;
  }
}

function formatDuration(startedAt: string, endedAt: string): string {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return '';
  if (ms < 1_000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

interface PlanNode {
  readonly plan: AgentPlan;
}

function buildPlanTree(plans: readonly AgentPlan[]): PlanNode[] {
  return plans
    .filter((plan) => plan.parentPlanId === null)
    .sort(byPosition)
    .map((plan) => ({ plan }));
}

function byPosition(a: AgentPlan, b: AgentPlan): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.createdAt.localeCompare(b.createdAt);
}

function renderPlan(
  node: PlanNode,
  allPlans: readonly AgentPlan[],
  lines: string[],
  indent: string,
): void {
  const mark = planMark(node.plan.state);
  lines.push(`${indent}${mark} ${node.plan.content} ${pc.dim(`[${node.plan.state}]`)}`);
  const children = allPlans.filter((plan) => plan.parentPlanId === node.plan.id).sort(byPosition);
  for (const child of children) {
    renderPlan({ plan: child }, allPlans, lines, `${indent}  `);
  }
}

function planMark(state: AgentPlanState): string {
  switch (state) {
    case AgentPlanState.Completed:
      return pc.green('✓');
    case AgentPlanState.Failed:
      return pc.red('✗');
    case AgentPlanState.Skipped:
      return pc.yellow('↷');
    case AgentPlanState.InProgress:
      return pc.cyan('●');
    default:
      return pc.dim('○');
  }
}
