import type { Command } from 'commander';
import pc from 'picocolors';

import type { Decision } from '../../domain/entities/decision.js';
import { DecisionStatus } from '../../domain/enums/decision-status.js';
import { printError } from '../../errors/error-printer.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';

interface RecordOptions {
  readonly title: string;
  readonly decision: string;
  readonly context?: string;
  readonly rationale?: string;
  readonly consequences?: string;
}

interface ListOptions {
  readonly status?: string;
}

interface SupersedeOptions {
  readonly by: string;
  readonly expectedUpdatedAt?: string;
}

/**
 * Registers the `mnema decision` command group.
 *
 * Subcommands:
 * - `decision record --title=... --decision=...` → record a new ADR
 * - `decision show <key>`                        → show an ADR
 * - `decision list [--status=...]`               → list ADRs of the project
 * - `decision accept <key>`                      → mark ADR as accepted
 * - `decision reject <key>`                      → mark ADR as rejected
 * - `decision supersede <key> --by=<other>`      → mark ADR as superseded
 */
export class DecisionCommand {
  /**
   * Attaches the `decision` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program
      .command('decision')
      .alias('decisions')
      .description('Manage Architecture Decision Records');

    group
      .command('record')
      .description('Record a new ADR in `proposed` status')
      .requiredOption('--title <title>', 'Decision title (3-200 chars)')
      .requiredOption('--decision <text>', 'What was decided')
      .option('--context <text>', 'Why this decision was needed')
      .option('--rationale <text>', 'Why this choice over alternatives')
      .option('--consequences <text>', 'What follows from this decision')
      .action(async (options: RecordOptions) => {
        await withMutatingCliContext(({ container, config }) => {
          const result = container.decision.record({
            projectKey: config.project.key,
            title: options.title,
            decision: options.decision,
            context: options.context,
            rationale: options.rationale,
            consequences: options.consequences,
            actor: container.identity.getDefaultActor(),
          });
          renderDecision(result, 'recorded');
        });
      });

    group
      .command('show <key>')
      .description('Show a single ADR')
      .option('--json', 'Print raw entity as JSON', false)
      .action(async (key: string, options: { readonly json?: boolean }) => {
        await withCliContext(({ container }) => {
          const result = container.decision.show(key);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
            return;
          }
          process.stdout.write(`${formatDecisionDetail(result.value)}\n`);
        });
      });

    group
      .command('list')
      .description('List ADRs of the current project')
      .option('--status <status>', 'Filter by status (proposed/accepted/rejected/superseded)')
      .action(async (options: ListOptions) => {
        await withCliContext(({ container, config }) => {
          const status = parseStatus(options.status);
          const decisions = container.decision.list(config.project.key, status);
          if (decisions.length === 0) {
            process.stdout.write(`${pc.dim('(no decisions yet)')}\n`);
            return;
          }
          process.stdout.write(`${decisions.map(formatDecisionRow).join('\n')}\n`);
        });
      });

    group
      .command('accept <key>')
      .description('Move a `proposed` ADR to `accepted`')
      .option(
        '--expected-updated-at <iso>',
        "Optimistic-concurrency token: must equal the decision's current `updatedAt` or the transition is rejected with CONFLICT",
      )
      .action(async (key: string, options: { readonly expectedUpdatedAt?: string }) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.decision.transition({
            decisionKey: key,
            status: DecisionStatus.Accepted,
            actor: container.identity.getDefaultActor(),
            expectedUpdatedAt: options.expectedUpdatedAt,
          });
          renderDecision(result, 'accepted');
        });
      });

    group
      .command('reject <key>')
      .description('Move a `proposed` ADR to `rejected`')
      .option(
        '--expected-updated-at <iso>',
        "Optimistic-concurrency token: must equal the decision's current `updatedAt` or the transition is rejected with CONFLICT",
      )
      .action(async (key: string, options: { readonly expectedUpdatedAt?: string }) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.decision.transition({
            decisionKey: key,
            status: DecisionStatus.Rejected,
            actor: container.identity.getDefaultActor(),
            expectedUpdatedAt: options.expectedUpdatedAt,
          });
          renderDecision(result, 'rejected');
        });
      });

    group
      .command('supersede <key>')
      .description('Mark an ADR as superseded by another')
      .requiredOption('--by <successor>', 'Key of the decision that replaces this one')
      .option(
        '--expected-updated-at <iso>',
        "Optimistic-concurrency token: must equal the decision's current `updatedAt` or the transition is rejected with CONFLICT",
      )
      .action(async (key: string, options: SupersedeOptions) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.decision.transition({
            decisionKey: key,
            status: DecisionStatus.Superseded,
            supersededBy: options.by,
            actor: container.identity.getDefaultActor(),
            expectedUpdatedAt: options.expectedUpdatedAt,
          });
          renderDecision(result, 'superseded');
        });
      });
  }
}

function parseStatus(raw: string | undefined): DecisionStatus | undefined {
  if (raw === undefined) return undefined;
  const values = Object.values(DecisionStatus) as string[];
  if (!values.includes(raw)) {
    process.stderr.write(`${pc.red('error:')} unknown status \`${raw}\`\n`);
    process.exit(2);
  }
  return raw as DecisionStatus;
}

function renderDecision(
  result: { ok: true; value: Decision } | { ok: false; error: MnemaError },
  verb: string,
): void {
  if (!result.ok) {
    process.exit(printError(result.error));
  }
  process.stdout.write(
    `${pc.green('✓')} decision ${pc.bold(result.value.key)} ${verb} ${pc.dim(`[${result.value.status}]`)}\n`,
  );
}

function formatDecisionRow(decision: Decision): string {
  return `${pc.bold(decision.key.padEnd(20))} ${decision.status.padEnd(11)} ${decision.title}`;
}

function formatDecisionDetail(decision: Decision): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('Decision:')} ${decision.key}`);
  lines.push(`${pc.bold('Title:')} ${decision.title}`);
  lines.push(`${pc.bold('Status:')} ${decision.status}`);
  lines.push(`${pc.bold('At:')} ${decision.at}`);
  if (decision.supersededBy !== null) {
    lines.push(`${pc.bold('Superseded by:')} ${decision.supersededBy}`);
  }
  if (decision.context !== null) {
    lines.push('');
    lines.push(pc.bold('Context'));
    lines.push(decision.context);
  }
  lines.push('');
  lines.push(pc.bold('Decision'));
  lines.push(decision.decision);
  if (decision.rationale !== null) {
    lines.push('');
    lines.push(pc.bold('Rationale'));
    lines.push(decision.rationale);
  }
  if (decision.consequences !== null) {
    lines.push('');
    lines.push(pc.bold('Consequences'));
    lines.push(decision.consequences);
  }
  return lines.join('\n');
}
