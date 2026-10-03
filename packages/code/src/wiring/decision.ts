/**
 * The `mnema decision` wiring: what it declares, and what it prints.
 *
 * `decision` is a group, shaped like `task`: one subcommand records a decision
 * (`mnema decision record "<title>" "<rationale>"`), the others move an existing one
 * or propose the ones already written in files. The group does nothing on its own,
 * for `task`'s reason (see `wiring/task.ts`). A decision needs BOTH a title and a rationale, so both are
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
import { fact } from '../presentation/detail.js';
import { RECORD_CONTRACT_HELP, replacementNotice } from '../recorded-content.js';
import { addBodySourceOptions } from './body-source.js';
import { here } from './context.js';
import {
  actionsRequiring,
  DECISION_MOVE_ACTIONS,
  enumeratedArgument,
  enumeratedOption,
  IMPORT_SCOPES,
  listed,
  scopeOption,
} from './enumerated.js';
import { fromTheGroup, REFUSED, takesFromItsGroup } from './from-the-group.js';
import { writeLines } from './io.js';
import { createsBy } from './misuse.js';
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

/** What `decision import --format` reads besides a directory of decision files. */
const IMPORT_FORMATS = ['ecc-vault', 'rulings', 'claude-memory'] as const;

/** Why a move refuses the group's `--scope`. */
const A_MOVE_FOLLOWS_THE_DECISION = 'a move follows the decision to the tree it was born in.';

/**
 * Why a move refuses the group's `--alternatives`: what a decision turned down is part of the
 * decision, recorded at its birth, and a move records no decision.
 */
const TURNED_DOWN_AT_BIRTH =
  'what a decision turned down is recorded with the decision itself — pass it to ' +
  '`mnema decision record` with the title and the rationale.';

/** What `--alternatives` is, said once for the group and for `record`, which both declare it. */
const ALTERNATIVES_HELP =
  'what was considered and turned down, and why not (optional). A decision ' +
  'is immutable, so this is recorded at birth: an option rejected later is a ' +
  'new decision, or supersedes this one.';

/** Registers `mnema decision` on the program. */
export function registerDecision(program: Command, wiring: Wiring): Declared {
  const { io, pinnedRun, render } = wiring;
  const decision = program
    .command('decision')
    .description('record a decision, or move one, in the current project')
    .option('--alternatives <text>', ALTERNATIVES_HELP)
    .addOption(
      scopeOption(
        'decision',
        'Omitted, a decision lands in the public tree (a declaration about the project).',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  addBodySourceOptions(decision, 'rationale');

  // `decision record <title> <rationale>` — the verb the agent's surface calls
  // `record_decision`. The group used to record with the two typed right after its name, and a
  // group that takes a free word cannot refuse a mistyped subcommand: `mnema decision showZZZ
  // why-not` recorded ADR-1. Its flags are its own, so its `--help` lists them; written after
  // `record` they still land on the group, which declares the same three, and are read from
  // there (`import` below has the same shape).
  const record = decision
    .command('record')
    .description('record a decision in the current project')
    .argument('<title>', 'the decision title')
    .argument('[rationale]', 'why the decision was made (or give it with --stdin or --body-file)')
    .option('--alternatives <text>', ALTERNATIVES_HELP)
    .addOption(
      scopeOption(
        'decision',
        'Omitted, a decision lands in the public tree (a declaration about the project).',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  addBodySourceOptions(record, 'rationale');
  createsBy(record);
  record.action(async (title: string, typed: string | undefined) => {
    const given = await fromTheGroup<{
      alternatives?: string;
      scope?: string;
      which?: string;
      stdin?: boolean;
      bodyFile?: string;
    }>(record, wiring);
    if (given === REFUSED) return;
    const { bodyFrom } = await import('./body-source.js');
    const rationale = await bodyFrom(wiring, 'rationale', 'as an argument', {
      typed,
      stdin: given.stdin,
      bodyFile: given.bodyFile,
    });
    if (rationale === REFUSED) return;
    const { runDecision } = await import('../commands/decision.js');
    const scope = parseScope(given.scope, wiring);
    if (scope === INVALID) return;
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runDecision(here(), {
      title,
      rationale,
      ...(given.alternatives !== undefined ? { alternatives: given.alternatives } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(given.which !== undefined ? { which: given.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    if (result.ok) {
      io.out(`Recorded decision ${result.adr} (${result.id})`);
      reportRecorded(result, io);
      return;
    }
    reportRefusal(wiring, result);
  });

  // `decision move <accept|reject> <id>` — the generic move, the sibling of
  // `task move`. The action is an argument the gate validates; the surface knows
  // no transition table. It takes the group's `--which` and NO `--scope` (a move
  // follows the entity), and it refuses every flag of the group it does not read
  // (`from-the-group.ts`). Supersede is deliberately NOT routed here — it needs a
  // successor `by` this generic form has nowhere to take; it is its own verb below.
  const decisionMove = decision
    .command('move')
    .description(
      `${DECISION_MOVE_ACTIONS.join(' or ')} a decision (follows the decision; takes no --scope)`,
    )
    .addArgument(enumeratedArgument('<action>', 'the transition', DECISION_MOVE_ACTIONS))
    .argument(
      '<id...>',
      'the decision id (the value shown when it was recorded) — several, to move each one with the same verdict and note',
    )
    .option(
      '--note <text>',
      `why this verdict (required by ${listed(actionsRequiring('decision', 'note'))})`,
    )
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  takesFromItsGroup(decisionMove, {
    takes: ['--which'],
    refuses: { '--scope': A_MOVE_FOLLOWS_THE_DECISION, '--alternatives': TURNED_DOWN_AT_BIRTH },
  });
  decisionMove.action(async (action: string, ids: string[], opts: { note?: string }) => {
    const given = await fromTheGroup<{ which?: string }>(decisionMove, wiring);
    if (given === REFUSED) return;
    const { runDecisionTransition } = await import('../commands/decision-transition.js');
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    // ONE FACT PER ID, signed on its own, in the order typed: a verdict on a hundred imported
    // proposals is a hundred judgements and the record keeps them as a hundred — the command is
    // the only thing that is one. Each id is moved or refused on its own account, and a refusal
    // does not stop the ones after it (an append-only record cannot take the ones before it
    // back, so stopping would only leave the rest undone for no reason the person gave).
    let moved = 0;
    for (const id of ids) {
      const result = runDecisionTransition(here(), {
        id,
        action,
        proof: { ...(opts.note !== undefined ? { note: opts.note } : {}) },
        ...(given.which !== undefined ? { which: given.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      await reportDecisionMove(result, id, wiring);
      if (result.ok) moved += 1;
    }
    if (ids.length > 1 && moved < ids.length) {
      io.err(
        render(
          fact(
            `Moved ${moved} of ${ids.length}; the rest were refused above and nothing was written for them.`,
          ),
        ),
      );
    }
  });

  // `decision supersede <old-id> <new-id> --reason` — supersede as its own verb.
  // A supersede replaces one decision with a later one, so it needs the successor
  // id (`by`), taken as a required positional so the parser demands the pair on
  // input rather than the gate refusing it late. Like every move it follows the
  // entity, takes the group's `--which` and no `--scope`.
  const supersede = decision
    .command('supersede')
    .description('supersede a decision with a later one (follows the decision; takes no --scope)')
    .argument('<old-id>', 'the decision being superseded')
    .argument('<new-id>', 'the successor decision that replaces it')
    .option('--reason <text>', 'why it is being replaced (required)')
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  takesFromItsGroup(supersede, {
    takes: ['--which'],
    refuses: { '--scope': A_MOVE_FOLLOWS_THE_DECISION, '--alternatives': TURNED_DOWN_AT_BIRTH },
  });
  supersede.action(async (oldId: string, newId: string, opts: { reason?: string }) => {
    const given = await fromTheGroup<{ which?: string }>(supersede, wiring);
    if (given === REFUSED) return;
    const { runDecisionTransition } = await import('../commands/decision-transition.js');
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
      ...(given.which !== undefined ? { which: given.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    await reportDecisionMove(result, oldId, wiring, newId);
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
  // after `import` landed on `decision`. The check here asked whether the GROUP held a
  // value, and therefore refused the flag in the place this help documents as well as
  // in the place it meant to refuse — no test ran the documented one. What decides now
  // is where the flag was WRITTEN (`written-before.ts`); the value is read where
  // commander put it, on the group. `the-flags-reach-the-import.test.ts` runs both
  // places on the binary and reads the agent and the tree back off the record.
  //
  // That reading is no longer this verb's own. The two `witness` acts had the same
  // pair of copies and read their own, so the rule moved to `from-the-group.ts`, which
  // also refuses the group's `--alternatives` here: a proposal takes what it turned
  // down from its file.
  //
  // THIS SAID THE OVERRIDE WAS "THE SAME" AS THE GROUP'S, and it stopped being true the
  // day the flag arrived: `--scope` could then name the machine-global tree, where the
  // path a proposal records is read by every project on the machine. `IMPORT_SCOPES`
  // carries what that did; the import offers and accepts the other two trees.
  const decisionImport = decision
    .command('import')
    .description('propose the decisions already written in this repository’s decision files')
    .argument(
      '<path>',
      'what to read: the directory holding the decision files (e.g. docs/adr), inside the project — ' +
        'or, with --format, the source of that format',
    )
    .addOption(
      enumeratedOption(
        '--format <format>',
        `what <path> holds: ${listed(IMPORT_FORMATS)}. Omitted, it is a directory of decision ` +
          'files. ecc-vault: a directory of the ECC Memory Vault’s *.json memories. rulings: ' +
          'one file whose `Ruling:` lines are read. claude-memory: a directory of the ' +
          'memory files Claude Code writes.',
        IMPORT_FORMATS,
      ),
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
        'is why nothing is accepted on your behalf. Nothing here calls a model.\n\n' +
        'The reason is what the file’s own decision section says (MADR’s “Chosen option, because”,\n' +
        'Nygard’s `## Decision`). A list of every option (MADR’s `## Considered Options`) is recorded\n' +
        'WITHOUT the option the file chose; when the file does not say which it chose, none is\n' +
        'recorded as turned down, and the plan says so.\n\n' +
        'With --format the same road reads other places decisions are written: the ECC Memory\n' +
        'Vault (a directory of *.json memories; only `kind: "decision"` is read, and a `rejected`\n' +
        'or `superseded` state is skipped), the `Ruling:` lines of one ledger file (each line is\n' +
        'one proposal, cited by file and line), and the memory files Claude Code writes under\n' +
        '~/.claude/projects/<project>/memory/ (a `name:` frontmatter and a body; MEMORY.md is\n' +
        'skipped). All are born `proposed` and cited to where they were read. A source outside the\n' +
        'project is cited as `<format>:<file>`, a name no clone can open. A file that does not\n' +
        'have its source’s shape is named and nothing is read from it.',
    )
    .addHelpText('after', RECORD_CONTRACT_HELP);
  takesFromItsGroup(decisionImport, {
    refuses: {
      '--alternatives':
        'what each proposal turned down is read from its own file, from a section such as ' +
        '`## Considered Options`.',
    },
  });
  decisionImport.action(async (dir: string, opts: { write?: boolean; format?: string }) => {
    // Written after `import`, both flags still land on the GROUP, which declares the same
    // two — so that is where their values are read. This command's own declarations are
    // what its `--help` lists and what `ownFlagsWrittenBefore` knows to look for.
    const given = await fromTheGroup<{ scope?: string; which?: string }>(decisionImport, wiring);
    if (given === REFUSED) return;
    const { linkBreakNotice } = await import('./integrity.js');
    const { runDecisionImport } = await import('../commands/decision-import.js');
    const scope = parseScope(given.scope, wiring);
    if (scope === INVALID) return;
    const format = IMPORT_FORMATS.find((one) => one === opts.format);
    if (opts.format !== undefined && format === undefined) {
      reportUsage(wiring, `--format takes one of ${listed(IMPORT_FORMATS)}, not "${opts.format}".`);
      return;
    }
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runDecisionImport(here(), {
      from: dir,
      ...(format !== undefined ? { format } : {}),
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
      // A run the door stopped partway is a run that did NOT do what it was asked: the lines
      // above say where, and the exit says it to whatever is driving this from a script.
      if (result.stopped !== undefined) io.fail();
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
  successor?: string,
): Promise<void> {
  if (result.ok) {
    const { movedLine } = await import('../moved-record.js');
    to.io.out(movedLine('decision', result.adr, result.id, result.to));
    if (result.notice !== undefined) to.io.out(to.render(fact(result.notice)));
    if (result.acceptedByAgent !== undefined) {
      const { acceptedByAnAgent } = await import('../agent-accepts.js');
      to.io.out(to.render(fact(acceptedByAnAgent(result.acceptedByAgent))));
    }
    reportReplacement(result, to.io);
    return;
  }
  reportRefusal(to, result, { UNKNOWN_DECISION: noSuchRecord('decision', id) });
  if (result.reason === 'UNKNOWN_DECISION') await sayIfALabel(to, id);
  // The successor of a supersede is an address too, and the label every write printed for it is
  // refused like the first one (`UNKNOWN_BY`, the dangling successor): the same hint, the same
  // function.
  if (result.reason === 'REFUSED' && result.code === 'UNKNOWN_BY' && successor !== undefined) {
    await sayIfALabel(to, successor);
  }
}

/**
 * After a refusal to find the decision `id`: when what was typed is the `ADR-<n>` label a write
 * printed, say so and name the id (or the ids, when more than one tree numbered the same label).
 * The bare refusal is already out; this is the half that tells a person what to type instead.
 */
async function sayIfALabel(to: Reporter, id: string): Promise<void> {
  const { labelAsAddress } = await import('../label-as-address.js');
  const sentence = labelAsAddress(here(), id);
  if (sentence !== undefined) to.io.err(to.render(fact(sentence)));
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
      ...(proposal.optionsUnclear
        ? ['lists its options but not which was chosen, so none is recorded as turned down']
        : []),
    ];
    lines.push(`      ${notes.join(' · ')}`);
    // In the words every write says it, under the proposal it is about. This was a second
    // wording — the classes' raw names, no count and no instruction to rotate.
    for (const line of replacementNotice(proposal.replaced)) lines.push(`    ${line}`);
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
  TITLE_IS_A_MARKER:
    'its title is only the marker a template leaves where the words go — nothing names the decision',
  RATIONALE_IS_A_MARKER:
    'its why is only the marker a template leaves where the words go — it never states a why',
  ALTERNATIVES_ARE_A_MARKER:
    'what it turned down is only the marker a template leaves where the words go — write what was turned down, or leave the section out',
  RETIRED: 'the document’s own status says it is no longer in force',
  HOLDS_A_SECRET: 'it holds something shaped like a credential, so nothing was read from it',
  FIELD_TOO_LARGE: 'a field is over the size a recorded field may hold',
  UNREADABLE: 'the file could not be read from disk',
  MALFORMED: 'it does not have the shape of its source, so nothing was read from it',
  NOT_A_DECISION: 'it is not a decision (its kind says so), so nothing was read from it',
};
