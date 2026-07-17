import type {
  ActionReasonCandidate,
  EvolutionReport,
  ObservationTopicCandidate,
  RecurringTopicCandidate,
  ReopenReasonCandidate,
  SkillCandidate,
} from '@mnema/core/services/evolution-candidate-service.js';
import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';
import { withCliContext } from '../cli-context.js';

interface EvolveOptions {
  readonly json?: boolean;
}

/**
 * Registers `mnema evolve` — a read-only evolution-candidate report. It mines
 * data that already exists (skill/rework correlation, recurring reopen
 * reasons, recurring observation topics on reopened tasks) and ranks
 * candidates with their supporting evidence. It mutates nothing and decides
 * nothing: every candidate is a prompt for human/agent judgement, and the
 * caveat is printed with the numbers. Local, zero-telemetry, read-only.
 */
export class EvolveCommand {
  /**
   * Attaches the `evolve` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('evolve')
      .description('Read-only evolution-candidate report (correlational; a prompt, not a verdict)')
      .option('--json', 'Emit the raw report object as JSON', false)
      .action(async (options: EvolveOptions) => {
        await withCliContext(({ container }) => {
          const report = container.evolutionCandidate.compute();
          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
            return;
          }
          process.stdout.write(render(report));
        });
      });
  }
}

function evidence(tasks: readonly string[]): string {
  const shown = tasks.slice(0, 5).join(', ');
  const more = tasks.length > 5 ? ` +${tasks.length - 5} more` : '';
  return pc.dim(`[${shown}${more}]`);
}

function skillLine(c: SkillCandidate): string {
  return `  ${pc.bold(c.slug.padEnd(24))} rework=${String(c.reworkCount).padStart(3)}  ${evidence(c.tasks)}`;
}

function reasonLine(c: ReopenReasonCandidate): string {
  const reason = c.reason.length > 48 ? `${c.reason.slice(0, 47)}…` : c.reason;
  return `  ${reason.padEnd(48)} ×${String(c.count).padStart(3)}  ${evidence(c.tasks)}`;
}

function topicLine(c: ObservationTopicCandidate | RecurringTopicCandidate): string {
  return `  ${pc.bold(c.topic.padEnd(24))} ×${String(c.count).padStart(3)}  ${evidence(c.tasks)}`;
}

function actionReasonLine(c: ActionReasonCandidate): string {
  const reason = c.reason.length > 48 ? `${c.reason.slice(0, 47)}…` : c.reason;
  return `  ${reason.padEnd(48)} ×${String(c.count).padStart(3)}  ${evidence(c.tasks)}`;
}

function section<T>(
  lines: string[],
  title: string,
  items: readonly T[],
  fmt: (item: T) => string,
): void {
  lines.push(pc.bold(title));
  if (items.length === 0) {
    lines.push(pc.dim('  (none)'));
  } else {
    for (const item of items) lines.push(fmt(item));
  }
  lines.push('');
}

function render(report: EvolutionReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(pc.bold('Evolution candidates'));
  lines.push('');
  section(lines, 'Skills that preceded rework', report.skills, skillLine);
  section(lines, 'Recurring reopen reasons', report.reopen_reasons, reasonLine);
  section(
    lines,
    'Recurring observation topics (on reopened tasks)',
    report.observation_topics,
    topicLine,
  );
  // Reopen-independent signals — useful on a project that rarely reopens.
  section(
    lines,
    'Recurring request_changes feedback',
    report.request_changes_reasons,
    actionReasonLine,
  );
  section(lines, 'Recurring cancel reasons', report.canceled_reasons, actionReasonLine);
  section(lines, 'Recurring observation topics (all tasks)', report.recurring_topics, topicLine);
  lines.push(pc.yellow(`  ⚠ ${report.caveat}`));
  lines.push('');
  return `${lines.join('\n')}\n`;
}
