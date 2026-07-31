/**
 * The `mnema decision` wiring: what it declares, and what it prints.
 *
 * `decision` is a group, shaped like `task`: its default action records a
 * decision (`mnema decision "<title>" "<rationale>"`), and its subcommands move
 * an existing one. A decision needs BOTH a title and a rationale, so both are
 * required positionals — a missing one is the parser's clear error, not a late
 * gate refusal. Record takes an optional `--scope` (the per-action birth
 * override, defaulting to public); the moves take none (they follow the
 * entity). A decision has no alias — record prints its frozen `ADR-<n>` label.
 */

import type { Command } from 'commander';
import { runDecision } from '../commands/decision.js';
import { runDecisionTransition } from '../commands/decision-transition.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import type { CliIo } from './io.js';
import {
  declaredAgent,
  INVALID,
  parseScope,
  WHICH_HELP,
  WHICH_ON_SUBCOMMAND_HELP,
} from './options.js';
import { reportRefusal, reportReplacement } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import type { Wiring } from './verb.js';

/** Registers `mnema decision` on the program. */
export function registerDecision(program: Command, wiring: Wiring): void {
  const { io, pinnedRun } = wiring;
  const decision = program
    .command('decision')
    .description('record a decision in the current project')
    .argument('<title>', 'the decision title')
    .argument('<rationale>', 'why the decision was made')
    .option(
      '--scope <scope>',
      'where the decision is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action((title: string, rationale: string, opts: { scope?: string; which?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runDecision(here(), {
        title,
        rationale,
        ...(scope !== undefined ? { scope } : {}),
        ...(opts.which !== undefined ? { which: opts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        io.out(`Recorded decision ${result.adr} (${result.id})`);
        reportReplacement(result, io);
        return;
      }
      reportRefusal(io, result);
    });

  // `decision move <accept|reject> <id>` — the generic move, the sibling of
  // `task move`. The action is an argument the gate validates; the surface knows
  // no transition table. It takes NO `--scope` (a move follows the entity), and
  // rejects one that leaks in from the `decision` group's option. Supersede is
  // deliberately NOT routed here — it needs a successor `by` this generic form
  // has nowhere to take; it is its own verb below.
  const decisionMove = decision
    .command('move')
    .description('accept or reject a decision (follows the decision; takes no --scope)')
    .argument('<action>', 'the transition: accept or reject')
    .argument('<id>', 'the decision id (the value shown when it was recorded)')
    .option('--note <text>', 'why this verdict (required by accept and reject)')
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  decisionMove.action((action: string, id: string, opts: { note?: string }) => {
    const parentOpts = (decisionMove.parent?.opts() ?? {}) as { scope?: string; which?: string };
    if (parentOpts.scope !== undefined) {
      io.err(
        '`decision move` takes no --scope: a move follows the decision to the tree it was born in.',
      );
      io.fail();
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
    reportDecisionMove(result, id, io);
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
  supersede.action((oldId: string, newId: string, opts: { reason?: string }) => {
    const parentOpts = (supersede.parent?.opts() ?? {}) as { scope?: string; which?: string };
    if (parentOpts.scope !== undefined) {
      io.err(
        '`decision supersede` takes no --scope: a move follows the decision to the tree it was born in.',
      );
      io.fail();
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
    reportDecisionMove(result, oldId, io);
  });
}

/**
 * Prints the verdict of a decision move (accept/reject/supersede) — both verbs
 * share it. On success the frozen `ADR-<n>` label and the new state; on refusal
 * the surface's own message for a missing project or an unknown decision, else
 * the gate's own code and message. A decision has no alias, so its human name in
 * the output is the ADR.
 */
function reportDecisionMove(
  result: ReturnType<typeof runDecisionTransition>,
  id: string,
  io: CliIo,
): void {
  if (result.ok) {
    io.out(`Decision ${result.adr} → ${result.to}`);
    reportReplacement(result, io);
    return;
  }
  reportRefusal(io, result, { UNKNOWN_DECISION: `No decision ${id} here.` });
}
