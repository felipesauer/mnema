import type { Decision } from '@mnema/core/domain/entities/decision.js';
import { DecisionStatus } from '@mnema/core/domain/enums/decision-status.js';
import { printError } from '@mnema/core/errors/error-printer.js';
import type { MnemaError } from '@mnema/core/errors/mnema-error.js';
import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';

interface RecordOptions {
  readonly title: string;
  readonly decision: string;
  readonly context?: string;
  readonly rationale?: string;
  readonly consequences?: string;
  readonly impact?: string[];
}

interface UpdateOptions {
  readonly title?: string;
  readonly decision?: string;
  readonly context?: string;
  readonly rationale?: string;
  readonly consequences?: string;
  readonly impact?: string[];
  readonly expectedUpdatedAt?: string;
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
      .option('--impact <ref...>', 'Artefact path/key this ADR affects (repeat for multiple)')
      .action(async (options: RecordOptions) => {
        await withMutatingCliContext(({ container, config }) => {
          const result = container.decision.record({
            projectKey: config.project.key,
            title: options.title,
            decision: options.decision,
            context: options.context,
            rationale: options.rationale,
            consequences: options.consequences,
            impacts: options.impact ?? [],
            actor: container.identity.getDefaultActor(),
          });
          renderDecision(result, 'recorded');
        });
      });

    group
      .command('update <key>')
      .description('Edit a `proposed` ADR in place (refused once accepted/rejected/superseded)')
      .option('--title <title>', 'Decision title (3-200 chars)')
      .option('--decision <text>', 'What was decided')
      .option('--context <text>', 'Why this decision was needed')
      .option('--rationale <text>', 'Why this choice over alternatives')
      .option('--consequences <text>', 'What follows from this decision')
      .option('--impact <ref...>', 'Artefact path/key this ADR affects (replaces the set)')
      .option(
        '--expected-updated-at <iso>',
        "Optimistic-concurrency token: must equal the decision's current `updatedAt` or the edit is rejected with CONFLICT",
      )
      .action(async (key: string, options: UpdateOptions) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.decision.updateContent({
            decisionKey: key,
            title: options.title,
            decision: options.decision,
            context: options.context,
            rationale: options.rationale,
            consequences: options.consequences,
            impacts: options.impact,
            expectedUpdatedAt: options.expectedUpdatedAt,
            actor: container.identity.getDefaultActor(),
          });
          renderDecision(result, 'updated');
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
          // Resolve the successor's public key for the renderer so
          // `Superseded by:` shows e.g. `MNEMA-ADR-2` instead of the
          // internal UUID.
          let supersededByKey: string | null = null;
          if (result.value.supersededBy !== null) {
            const successor = container.decision.findById(result.value.supersededBy);
            supersededByKey = successor?.key ?? result.value.supersededBy;
          }
          process.stdout.write(`${formatDecisionDetail(result.value, supersededByKey)}\n`);
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
      .command('review')
      .description('List proposed ADRs with the fields a reviewer needs, to dispatch as a batch')
      .action(async () => {
        await withCliContext(({ container, config }) => {
          const proposals = container.decision.reviewProposals(config.project.key);
          if (proposals.length === 0) {
            process.stdout.write(`${pc.dim('(no proposed decisions to review)')}\n`);
            return;
          }
          const blocks = proposals.map((p) => {
            const lines = [`${pc.bold(p.key)}  ${p.title}`, `  decision: ${p.decision}`];
            if (p.rationale !== null) lines.push(`  rationale: ${p.rationale}`);
            if (p.impacts.length > 0) lines.push(`  impacts: ${p.impacts.join(', ')}`);
            return lines.join('\n');
          });
          process.stdout.write(`${blocks.join('\n\n')}\n`);
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
      .command('reopen <key>')
      .description('Reopen an accepted/rejected ADR back to `proposed` (undo a mis-click)')
      .requiredOption('--reason <text>', 'Why it is being reopened (audited)')
      .option(
        '--expected-updated-at <iso>',
        "Optimistic-concurrency token: must equal the decision's current `updatedAt` or the reopen is rejected with CONFLICT",
      )
      .action(
        async (
          key: string,
          options: { readonly reason: string; readonly expectedUpdatedAt?: string },
        ) => {
          await withMutatingCliContext(({ container }) => {
            const result = container.decision.reopen({
              decisionKey: key,
              reason: options.reason,
              actor: container.identity.getDefaultActor(),
              expectedUpdatedAt: options.expectedUpdatedAt,
            });
            renderDecision(result, 'reopened');
          });
        },
      );

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

    group
      .command('impacting <ref>')
      .description('List ADRs whose impact list contains the given artefact path/key')
      .action(async (ref: string) => {
        await withCliContext(({ container, config }) => {
          const decisions = container.decision.impacting(config.project.key, ref);
          if (decisions.length === 0) {
            process.stdout.write(`${pc.dim(`no decision impacts ${ref}`)}\n`);
            return;
          }
          process.stdout.write(`${decisions.map(formatDecisionRow).join('\n')}\n`);
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

function formatDecisionDetail(decision: Decision, supersededByKey: string | null = null): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('Decision:')} ${decision.key}`);
  lines.push(`${pc.bold('Title:')} ${decision.title}`);
  lines.push(`${pc.bold('Status:')} ${decision.status}`);
  lines.push(`${pc.bold('At:')} ${decision.at}`);
  if (decision.supersededBy !== null) {
    lines.push(`${pc.bold('Superseded by:')} ${supersededByKey ?? decision.supersededBy}`);
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
  // Impacts are persisted (--impact / mirror `impacts:`) and drive
  // `decision impacting` — omitting them here hid what the reader could
  // already query, so surface the list alongside the other sections.
  if (decision.impacts.length > 0) {
    lines.push('');
    lines.push(pc.bold('Impact'));
    for (const impact of decision.impacts) {
      lines.push(`- ${impact}`);
    }
  }
  return lines.join('\n');
}
