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

import type { ScanRefusalCode } from '@mnema/core';
import type { Command } from 'commander';
import type { runDecisionImport } from '../commands/decision-import.js';
import type { runDecisionTransition } from '../commands/decision-transition.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import {
  actionsRequiring,
  DECISION_MOVE_ACTIONS,
  enumeratedArgument,
  IMPORT_SCOPES,
  listed,
  scopeOption,
} from './enumerated.js';
import { writeLines } from './io.js';
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
  const { io, pinnedRun, render } = wiring;
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
  // `decision import <dir>` — propose the decisions this repository already wrote.
  //
  // It is a SUBCOMMAND of `decision` and not a top-level verb because what it
  // produces is decisions, and the group for that kind already exists; a top-level
  // `mnema import` would promise to import anything and deliver one kind.
  //
  // It declares its OWN `--scope` and `--which`, unlike the moves, because it is a
  // BIRTH — the per-action override the group's default action takes, over one tree
  // fewer (the last paragraph). The group's own copies are refused rather than
  // inherited: `mnema decision --scope private import docs/adr` puts the flag before the
  // verb it belongs to, and silently honouring it would teach two spellings of one
  // option.
  //
  // DECLARING THEM WAS NOT ENOUGH TO RECEIVE THEM, and for as long as this verb
  // existed it received neither. The group declares the same two flags, and commander
  // hands a group every flag it knows wherever the flag is written, so `--which ci`
  // after `import` landed on `decision`. The check below asked whether the GROUP held a
  // value, and therefore refused the flag in the place this help documents as well as
  // in the place it meant to refuse — no test ran the documented one. What decides now
  // is where the flag was WRITTEN (`written-before.ts`); the value is read where
  // commander put it, on the group. `the-flags-reach-the-import.test.ts` runs both
  // places on the binary and reads the agent and the tree back off the record.
  //
  // THIS SAID THE OVERRIDE WAS "THE SAME" AS THE GROUP'S, and it stopped being true the
  // day the flag arrived: `--scope` could then name the machine-global tree, where the
  // path a proposal records is read by every project on the machine. `IMPORT_SCOPES`
  // carries what that did; the import offers and accepts the other two trees.
  const decisionImport = decision
    .command('import')
    .description('propose the decisions already written in this repository’s decision files')
    .argument(
      '<dir>',
      'the directory holding the decision files (e.g. docs/adr), inside the project',
    )
    .option(
      '--write',
      'record the plan. Omitted, nothing is written: the plan is printed and the record is untouched.',
    )
    .addOption(
      scopeOption(
        'decision',
        'Omitted, an imported decision lands in the public tree, like any other. The ' +
          'global tree is not offered: a proposal records a path inside this project, and ' +
          'every project reads the global tree.',
        IMPORT_SCOPES,
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText(
      'after',
      '\nEvery proposal is born `proposed`, whatever the file says its status is: what\n' +
        'the file states is reported, never applied. Accepting one is a person’s move,\n' +
        'with a note, through `decision move accept`.\n\n' +
        'One decision per file, a level-1 title and named `##` sections — the Nygard and\n' +
        'MADR shape. A file this cannot read that way is refused by name. A file it CAN\n' +
        'is proposed — including one that is no decision at all: an index page or a\n' +
        'roadmap wears the same shape, and no fact of the document separates them. That\n' +
        'is why nothing is accepted on your behalf. Nothing here calls a model.',
    )
    .addHelpText('after', RECORD_CONTRACT_HELP);
  decisionImport.action(async (dir: string, opts: { write?: boolean }) => {
    const { linkBreakNotice } = await import('./integrity.js');
    const { runDecisionImport } = await import('../commands/decision-import.js');
    const { ownFlagsWrittenBefore } = await import('./written-before.js');
    const [leaked] = ownFlagsWrittenBefore(decisionImport);
    if (leaked !== undefined) {
      reportUsage(
        wiring,
        `\`decision import\` takes its own ${leaked}: put it after \`import\`, not before.`,
      );
      return;
    }
    // Written after `import`, both flags still land on the GROUP, which declares the same
    // two — so that is where their values are read. This command's own declarations are
    // what its `--help` lists and what `ownFlagsWrittenBefore` knows to look for.
    const given = (decisionImport.parent?.opts() ?? {}) as { scope?: string; which?: string };
    const scope = parseScope(given.scope, wiring);
    if (scope === INVALID) return;
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runDecisionImport(here(), {
      from: dir,
      ...(opts.write === true ? { write: true } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(given.which !== undefined ? { which: given.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    if (result.ok) {
      // BEFORE the plan, and on the other stream. An import is the one place a read
      // of the record decides what gets WRITTEN to it — the set of files already
      // derived is what stops a duplicate — so a broken proof under it is the worst
      // moment on this surface to be silent about.
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
      writeLines(io, importLines(result));
      return;
    }
    reportRefusal(wiring, result, {
      OUTSIDE_PROJECT: `"${dir}" is not inside this project. The provenance a proposal records has to be citable by every clone, so the directory has to be one.`,
      GLOBAL_TREE:
        '`decision import` does not write to the global tree: a proposal records the file it came from as a path inside this project, and every project reads the global tree, where that path names a file of its own. Leave --scope out, or use --scope private.',
    });
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

/**
 * What one run of `decision import` prints — the plan, or what it recorded.
 *
 * ONE FUNCTION FOR BOTH, because they are the same list read at two moments and a
 * second renderer is how the two come to disagree about what a proposal is. The
 * only difference between them is the tense of the opening line and whether an id
 * is known yet.
 *
 * THE CLOSING LINE IS THE POINT OF THE PLAN. A read that ends without saying it
 * wrote nothing reads exactly like a write, and the whole design of this verb is
 * that those two are never confused. So the plan says it, and says the flag.
 */
function importLines(
  result: Extract<ReturnType<typeof runDecisionImport>, { ok: true }>,
): string[] {
  const lines: string[] = [];
  const n = result.proposals.length;
  lines.push(
    result.wrote
      ? `Recorded ${n} decision(s) as proposals from ${result.from}, in the ${result.scope} tree.`
      : `Read ${result.from}: ${n} decision(s) to propose.`,
  );
  for (const proposal of result.proposals) {
    const name = proposal.adr !== undefined ? `${proposal.adr} (${proposal.id})` : 'proposed';
    lines.push(`  ${name} — ${proposal.title}`);
    const notes = [
      `from ${proposal.path}`,
      ...(proposal.status !== undefined ? [`the file says "${proposal.status}"`] : []),
      ...(proposal.alternatives ? ['names what it turned down'] : []),
      ...(proposal.replaced !== undefined
        ? [`a ${proposal.replaced.join(', ')} was replaced`]
        : []),
    ];
    lines.push(`      ${notes.join(' · ')}`);
  }
  if (result.already.length > 0) {
    lines.push(`${result.already.length} file(s) already in the record, unchanged:`);
    for (const skipped of result.already) lines.push(`  ${skipped.path} — ${skipped.decision}`);
  }
  if (result.refused.length > 0) {
    lines.push(`${result.refused.length} file(s) produced nothing:`);
    for (const refusal of result.refused) {
      const why = IMPORT_REFUSALS[refusal.code];
      const classes = refusal.classes !== undefined ? ` (${refusal.classes.join(', ')})` : '';
      lines.push(`  ${refusal.path} — ${why}${classes}`);
    }
  }
  if (result.stopped !== undefined) {
    lines.push(
      `Stopped at ${result.stopped.path} (${result.stopped.code}): ${result.stopped.message}`,
    );
    lines.push('What was already recorded stays recorded — the record is append-only.');
  }
  if (!result.wrote) {
    lines.push('Nothing was written. Run it again with --write to record these as proposals.');
  } else if (n > 0) {
    lines.push(
      'Each one is `proposed`. Accepting is a person’s move: `mnema decision move accept <id> --note "<why>"`.',
    );
  }
  return lines;
}

/**
 * Why a file produced no proposal, in a sentence a person can act on.
 *
 * It is a TOTAL record over the refusal codes, so a code added to the scan does not
 * compile until it has a sentence here — the alternative being a file reported with
 * a bare code, or worse, reported with the wrong neighbour's sentence.
 */
const IMPORT_REFUSALS: Record<ScanRefusalCode, string> = {
  NO_TITLE: 'no level-1 title — nothing names the decision',
  NO_RATIONALE: 'no context section and no lead — it states a decision and never states a why',
  RETIRED: 'the document’s own status says it is no longer in force',
  HOLDS_A_SECRET: 'it holds something shaped like a credential, so nothing was read from it',
  FIELD_TOO_LARGE: 'a field is over the size a recorded field may hold',
  UNREADABLE: 'the file could not be read from disk',
};
