/**
 * The `mnema skill` wiring: what it declares, and what it prints.
 *
 * `skill` is a group, shaped like `task` and `decision`: its default action
 * proposes a skill (`mnema skill "<name>" --body "<text>"`), and its one
 * subcommand moves an existing one. A skill needs BOTH a name and a body; the
 * name is a short positional, the body a flag (`--body`) — content that big
 * never goes in a positional (the `git commit -m` / `gh --body` convention).
 * The body is required, but NOT declared as commander's `requiredOption`: an
 * option on the GROUP is inherited by the `move` subcommand, and a required one
 * there would force `--body` on a move too. So it is a plain option the create
 * action checks itself — a missing `--body` on a propose is a usage error the
 * CLI reports (nothing is born), while `move` is unaffected. Propose takes an
 * optional `--scope` (the per-action birth override, defaulting to public); the
 * move takes none (it follows the entity). A skill has no alias — propose prints
 * its `name` and its `id` (the key).
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import {
  declaredAgent,
  INVALID,
  parseScope,
  WHICH_HELP,
  WHICH_ON_SUBCOMMAND_HELP,
} from './options.js';
import { reportRecorded, reportRefusal, reportReplacement } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import type { Wiring } from './verb.js';

/** Registers `mnema skill` on the program. */
export function registerSkill(program: Command, wiring: Wiring): void {
  const { io, pinnedRun } = wiring;
  const skill = program
    .command('skill')
    .description('propose a reusable skill in the current project')
    .argument('<name>', 'a short title for the pattern')
    .option('--body <text>', 'the reusable pattern itself (required)')
    .option(
      '--scope <scope>',
      'where the skill is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Omitted, a skill lands in the ' +
        'public tree (a declaration about the project).',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(async (name: string, opts: { body?: string; scope?: string; which?: string }) => {
      const { runSkill } = await import('../commands/skill.js');
      // The body is required for a propose, but declared as a plain option (so it
      // is not inherited as mandatory by `move`); enforce it here.
      if (opts.body === undefined) {
        io.err('`mnema skill` requires --body: the reusable pattern itself.');
        io.fail();
        return;
      }
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
      const result = runSkill(here(), {
        name,
        body: opts.body,
        ...(scope !== undefined ? { scope } : {}),
        ...(opts.which !== undefined ? { which: opts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        // Print both the name (orients the human) and the id (the key a move
        // takes) — a skill has no alias.
        io.out(`Proposed skill "${result.name}" (${result.id})`);
        reportRecorded(result, io);
        return;
      }
      reportRefusal(wiring, result);
    });

  // `skill move <action> <id>` — the generic move, the sibling of `task move`.
  // The action is an argument; the surface knows no transition table. It takes
  // NO `--scope` (a move follows the entity), and rejects one that leaks in from
  // the `skill` group's option — routing a move elsewhere would split the skill's
  // history across the public/private boundary.
  const skillMove = skill
    .command('move')
    .description('move a skill through the workflow (follows the skill; takes no --scope)')
    .argument('<action>', 'the transition: review, adopt, reject, or deprecate')
    .argument('<id>', 'the skill id (the value shown when it was proposed)')
    .option('--note <text>', 'why this verdict (required by review, adopt, reject)')
    .option('--reason <text>', 'why it fell out of use (required by deprecate)')
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  skillMove.action(async (action: string, id: string, opts: { note?: string; reason?: string }) => {
    const { runSkillTransition } = await import('../commands/skill-transition.js');
    const { movedLine } = await import('../moved-record.js');
    const parentOpts = (skillMove.parent?.opts() ?? {}) as { scope?: string; which?: string };
    if (parentOpts.scope !== undefined) {
      io.err('`skill move` takes no --scope: a move follows the skill to the tree it was born in.');
      io.fail();
      return;
    }
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runSkillTransition(here(), {
      id,
      action,
      proof: {
        ...(opts.note !== undefined ? { note: opts.note } : {}),
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      },
      ...(parentOpts.which !== undefined ? { which: parentOpts.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    if (result.ok) {
      io.out(movedLine('skill', result.name, result.id, result.to));
      reportReplacement(result, io);
      return;
    }
    reportRefusal(wiring, result, { UNKNOWN_SKILL: `No skill ${id} here.` });
  });
}
