import type { Command } from 'commander';
import pc from 'picocolors';

import type { AgentPlan } from '../../domain/entities/agent-plan.js';
import type { AgentRun } from '../../domain/entities/agent-run.js';
import type { Transition } from '../../domain/entities/transition.js';
import { AgentPlanState } from '../../domain/enums/agent-plan-state.js';
import { AgentRunStatus } from '../../domain/enums/agent-run-status.js';
import { printError } from '../../errors/error-printer.js';
import { withCliContext } from '../cli-context.js';
import { formatTimestamp, type TimestampMode } from '../formatters/timestamp-formatter.js';

interface InspectOptions {
  readonly iso?: boolean;
}

/**
 * Registers the `mnema agent` command group.
 *
 * Right now it exposes a single subcommand — `agent inspect <runId>` —
 * which renders an agent run together with its plan tree and the
 * transitions caused by the run.
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
          const mode: TimestampMode = options.iso === true ? 'iso' : 'relative';

          process.stdout.write(`${formatRunDetail(run, plans, transitions, mode)}\n`);
        });
      });
  }
}

function formatRunDetail(
  run: AgentRun,
  plans: readonly AgentPlan[],
  transitions: readonly Transition[],
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
  if (run.error !== null) {
    lines.push(`${pc.bold('Error:')} ${pc.red(run.error)}`);
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
        `  ${pc.dim(formatTimestamp(transition.at, mode))}  ${transition.action.padEnd(14)} ${pc.cyan(arrow)}`,
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
