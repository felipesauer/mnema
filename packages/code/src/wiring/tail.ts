/**
 * The `mnema tail` wiring: what it declares, and what it prints.
 *
 * A group of two, and the shape is `key`'s rather than `task`'s: its subject is not
 * a workflow entity but the record's own storage, so there is no birth, no state and
 * no `move` — there is one act, authorizing the cut of a whole tail, and the reading
 * that says which tails there are to act on.
 *
 * THE READING IS HERE BECAUSE THE ACT TAKES AN ID NOTHING PRINTED. `prune`'s
 * argument is a tail id, and until `list` existed no read of this product put one on
 * a screen — the help said *"as `verify` spells it"* and `verify` spells a COUNT
 * (`1 tail(s)`), so the only way to use the verb was to read `.mnema/tails/` by
 * hand. The two are declared together now, and the argument's help points at the
 * verb that actually spells it (`the-verb-says-which-tails.test.ts` is what holds
 * that sentence to being true).
 *
 * THE TAIL IS A POSITIONAL and the reason is what the verb is about: it is the whole
 * subject of the command and competes with nothing. `--reason` is a REQUIRED flag,
 * exactly as `key revoke`'s is and for the same reason — it is the field the record
 * keeps, and a cut with no recorded reason is the one an audit cannot read later.
 *
 * THERE IS NO `--force`, NO `--yes` AND NO PROMPT, and their absence is the design.
 * This verb removes nothing, so there is nothing to confirm; a confirmation would
 * say that there is, which is the one thing this output must not imply. There is no
 * `--scope` either: a waiver follows the tail to the tree that holds it, the way a
 * move follows its entity.
 *
 * THE OUTPUT SAYS THE LIMIT IN THE SAME BREATH AS THE RECORD, because the person who
 * needs to hear it is the one cutting right now, believing they have finished. It is
 * the content door's posture (tell the author while they can still act) and the
 * verdict's rigour (say the level reached, not "verified"). The sentence does not
 * change with what git says: reading the repository to soften it was considered and
 * turned down — that is the design a study proposed for redaction and a decision
 * already deferred once, to when an external witness exists. One sentence, true in
 * the worst case, every time.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { declaredAgent } from './options.js';
import { reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/**
 * How far a cut reaches, said in one sentence on every authorization.
 *
 * IT IS THE MEASUREMENT, not a caution. On a project whose chain is committed —
 * which is how a record travels — deleting a tail's directory left `git status`
 * reporting the deletions and `git show HEAD:<segment>` printing every line back.
 * A person who has just run this command and then `rm -rf` is one command away from
 * believing the content is gone, and it is on the remote and in every clone.
 */
export const CUT_LIMIT =
  "Git history, any remote and every clone still hold what that tail recorded: taking it out of those is `git filter-repo` plus coordination with everyone who has a copy, and it is outside this command's reach.";

/** Registers `mnema tail` on the program. */
export function registerTail(program: Command, wiring: Wiring): Declared {
  const { io, render, pinnedRun } = wiring;
  const tail = program.command('tail').description("authorize a cut in the record's own tails");

  tail
    .command('list')
    .description('list the tails the record holds here, with the id `prune` takes')
    .addHelpText(
      'after',
      [
        '',
        'What each line says, and why it is on it:',
        '  The id is whole — it is what `mnema tail prune` takes.',
        '  The tree is where a waiver over that tail has to land, so `prune` writes there.',
        '  The events and the head are what a waiver would claim; `prune` reads them again.',
        '  `cut authorized` means a waiver in that same tree already authorizes the cut.',
        '  Nothing here removes anything, and a cut this lists is still yours to carry out.',
      ].join('\n'),
    )
    .action(async () => {
      const { runTailList } = await import('../commands/tail-list.js');
      const { tailReport } = await import('../presentation/tails.js');
      const listing = runTailList(here());
      writeLines(io, tailReport(render, listing.tails, listing.trees));
    });

  tail
    .command('prune')
    .description('record that one whole tail was authorized to be cut (it removes nothing)')
    .argument('<tail>', 'the tail to cut, as `tail list` spells it: <fingerprint>-<installation>')
    .requiredOption('--reason <text>', 'why it is being cut (recorded in the fact)')
    .option(
      '--which <agent>',
      'the agent that executed this, when an agent (a script, a CI step) is driving ' +
        'mnema — omit it when you are acting directly. It names the executor only: a ' +
        'waiver always follows the tail to the tree that holds it.',
      declaredAgent,
    )
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(async (named: string, opts: { reason: string; which?: string }) => {
      const { runTailPrune } = await import('../commands/tail-prune.js');
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runTailPrune(here(), {
        tail: named,
        reason: opts.reason,
        ...(opts.which !== undefined ? { which: opts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (!result.ok) {
        reportRefusal(wiring, result, {
          UNKNOWN_TAIL: `No tail ${named} holds events in any tree here.`,
        });
        return;
      }
      // What was recorded, then where the files still are, then how far a cut
      // reaches. The order is the order a reader acts in.
      io.out(`Authorized the cut of tail ${result.tail}`);
      io.out(
        render(
          fact(
            `${result.eventCount} event(s) through ${result.throughHash}, the tail of ${result.anchor}`,
          ),
        ),
      );
      io.out(render(fact(`authorized by ${result.authorizedBy}`)));
      reportRecorded(result, io);
      // Said plainly, because this is the moment somebody assumes otherwise: the
      // waiver is what makes the cut legible, and the cut itself is theirs to make.
      io.out(
        render(fact(`The tail is still on disk at ${result.tailDirectory} — nothing was removed.`)),
      );
      io.out(render(fact(CUT_LIMIT)));
    });

  return mutatesTheRecord(tail);
}
