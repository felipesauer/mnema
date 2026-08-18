/**
 * The `mnema decision` wiring: what it declares, and what it prints.
 *
 * `decision` is a group, shaped like `task`: its default action records a
 * decision (`mnema decision "<title>" "<rationale>"`), and its subcommands move
 * an existing one. A decision needs BOTH a title and a rationale, so both are
 * required positionals — a missing one is the parser's clear error, not a late
 * gate refusal. What it turned down is `--alternatives`, a flag rather than a
 * third positional: most decisions had no contender, and a positional that is
 * usually absent forces every caller to type an empty argument for it. Record also
 * takes an optional `--scope` (the per-action birth override, defaulting to
 * public); the moves take none (they follow the entity). A decision has no alias —
 * record prints its frozen `ADR-<n>` label.
 */

import type { Command } from 'commander';
import type { runDecisionTransition } from '../commands/decision-transition.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import {
  actionsRequiring,
  DECISION_MOVE_ACTIONS,
  enumeratedArgument,
  listed,
  scopeOption,
} from './enumerated.js';
import { noSuchRecord } from './no-such-record.js';
import {
  declaredAgent,
  INVALID,
  parseScope,
  WHICH_HELP,
  WHICH_ON_SUBCOMMAND_HELP,
} from './options.js';
import {
  type Reporter,
  reportRecorded,
  reportRefusal,
  reportReplacement,
  reportUsage,
} from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema decision` on the program. */
export function registerDecision(program: Command, wiring: Wiring): Declared {
  const { io, pinnedRun } = wiring;
  const decision = program
    .command('decision')
    .description('record a decision in the current project')
    .argument('<title>', 'the decision title')
    .argument('<rationale>', 'why the decision was made')
    .option(
      '--alternatives <text>',
      'what was considered and turned down, and why not (optional). A decision ' +
        'is immutable, so this is recorded at birth: an option rejected later is a ' +
        'new decision, or supersedes this one.',
    )
    .addOption(
      scopeOption(
        'decision',
        'Omitted, a decision lands in the public tree (a declaration about the project).',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(
      async (
        title: string,
        rationale: string,
        opts: { alternatives?: string; scope?: string; which?: string },
      ) => {
        const { runDecision } = await import('../commands/decision.js');
        const scope = parseScope(opts.scope, wiring);
        if (scope === INVALID) return;
        const run = pinnedRun();
        if (run === PIN_REFUSED) {
          io.fail();
          return;
        }
        const result = runDecision(here(), {
          title,
          rationale,
          ...(opts.alternatives !== undefined ? { alternatives: opts.alternatives } : {}),
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        });
        if (result.ok) {
          io.out(`Recorded decision ${result.adr} (${result.id})`);
          reportRecorded(result, io);
          return;
        }
        reportRefusal(wiring, result);
      },
    );

  // `decision move <accept|reject> <id>` — the generic move, the sibling of
  // `task move`. The action is an argument the gate validates; the surface knows
  // no transition table. It takes NO `--scope` (a move follows the entity), and
  // rejects one that leaks in from the `decision` group's option. Supersede is
  // deliberately NOT routed here — it needs a successor `by` this generic form
  // has nowhere to take; it is its own verb below.
  const decisionMove = decision
    .command('move')
    .description(
      `${DECISION_MOVE_ACTIONS.join(' or ')} a decision (follows the decision; takes no --scope)`,
    )
    .addArgument(enumeratedArgument('<action>', 'the transition', DECISION_MOVE_ACTIONS))
    .argument('<id>', 'the decision id (the value shown when it was recorded)')
    .option(
      '--note <text>',
      `why this verdict (required by ${listed(actionsRequiring('decision', 'note'))})`,
    )
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  decisionMove.action(async (action: string, id: string, opts: { note?: string }) => {
    const { runDecisionTransition } = await import('../commands/decision-transition.js');
    const parentOpts = (decisionMove.parent?.opts() ?? {}) as { scope?: string; which?: string };
    if (parentOpts.scope !== undefined) {
      reportUsage(
        wiring,
        '`decision move` takes no --scope: a move follows the decision to the tree it was born in.',
      );
      return;
    }
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runDecisionTransition(here(), {
      id,
      action,
      proof: { ...(opts.note !== undefined ? { note: opts.note } : {}) },
      ...(parentOpts.which !== undefined ? { which: parentOpts.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    await reportDecisionMove(result, id, wiring);
  });

  // `decision supersede <old-id> <new-id> --reason` — supersede as its own verb.
  // A supersede replaces one decision with a later one, so it needs the successor
  // id (`by`), taken as a required positional so the parser demands the pair on
  // input rather than the gate refusing it late. Like every move it follows the
  // entity and takes no `--scope`.
  const supersede = decision
    .command('supersede')
    .description('supersede a decision with a later one (follows the decision; takes no --scope)')
    .argument('<old-id>', 'the decision being superseded')
    .argument('<new-id>', 'the successor decision that replaces it')
    .option('--reason <text>', 'why it is being replaced (required)')
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  supersede.action(async (oldId: string, newId: string, opts: { reason?: string }) => {
    const { runDecisionTransition } = await import('../commands/decision-transition.js');
    const parentOpts = (supersede.parent?.opts() ?? {}) as { scope?: string; which?: string };
    if (parentOpts.scope !== undefined) {
      reportUsage(
        wiring,
        '`decision supersede` takes no --scope: a move follows the decision to the tree it was born in.',
      );
      return;
    }
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runDecisionTransition(here(), {
      id: oldId,
      action: 'supersede',
      by: newId,
      proof: { ...(opts.reason !== undefined ? { reason: opts.reason } : {}) },
      ...(parentOpts.which !== undefined ? { which: parentOpts.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    await reportDecisionMove(result, oldId, wiring);
  });
  return mutatesTheRecord(decision);
}

/**
 * Prints the verdict of a decision move (accept/reject/supersede) — both verbs
 * share it. On success the frozen `ADR-<n>` label AND the id, plus the new state; on
 * refusal the surface's own message for a missing project or an unknown decision,
 * else the gate's own code and message. A decision has no alias, so its human name in
 * the output is the ADR, and {@link movedLine} is what composes the pair — the same
 * line the MCP surface returns.
 *
 * IT USED TO SAY NOTHING WHEN TWO RULES ANSWER TO THAT LABEL, and the argument for
 * that was: the line acknowledges a move the caller just asked for by id, so the id is
 * in the command they typed and in the `--json` object beside this text, and nobody
 * cites a rule out of an acknowledgement. What falsified it is that the LINE is what
 * outlives the invocation. Over a record whose public and private trees each hold an
 * `ADR-1`, two different decisions moved by two different ids produced the same eleven
 * bytes — so the line, read anywhere the command that produced it is not (a
 * scrollback, a pasted transcript, a review comment), named two rules and said which
 * one was neither. It says the id now, which is the half a reader can act on;
 * `moved-record.ts` carries the whole argument, and `the-echo-names-the-record.test.ts`
 * pins the collision case.
 */
async function reportDecisionMove(
  result: ReturnType<typeof runDecisionTransition>,
  id: string,
  to: Reporter,
): Promise<void> {
  if (result.ok) {
    const { movedLine } = await import('../moved-record.js');
    to.io.out(movedLine('decision', result.adr, result.id, result.to));
    reportReplacement(result, to.io);
    return;
  }
  reportRefusal(to, result, { UNKNOWN_DECISION: noSuchRecord('decision', id) });
}
