/**
 * The `mnema switch` wiring: what it declares, and what it prints.
 *
 * A group of three, and the shape is `tail`'s rather than `task`'s: its subject is not a
 * workflow entity but MNEMA — the places this product puts the record in front of a model
 * without being asked — so there is no birth, no state a gate moves and no `move`. There
 * are two acts, off and on, and the reading that says which channels there are to act on.
 *
 * THE READING IS HERE BECAUSE THE ACTS TAKE A NAME NOTHING PRINTED, which is the argument
 * `tail list` was added for and it is stronger here: a channel name is an identifier this
 * product invented, it appears in no other reading, and a person who cannot see the list
 * cannot use the verb at all. So the bare group prints the listing — `mnema switch` with
 * no subcommand is the reading — and the two acts hang under it.
 *
 * THE CHANNEL IS A POSITIONAL and the set is ENUMERATED, never `.choices()`. That is the
 * rule `enumerated.ts` states and the reason applies here in full: `.choices()` validates
 * as well as enumerates, which would replace the surface's own typed refusal with a
 * commander usage error. The vocabulary belongs to `record-framing.ts` and the refusal
 * that names it belongs to the adapter, so a caller who mistypes a channel is told what
 * there is in the product's voice.
 *
 * `--reason` IS OPTIONAL HERE AND REQUIRED ON `tail prune`, and the asymmetry is the tie
 * read exactly. What has to be recorded is the FACT — who switched what, and when — never
 * a justification: a product that refused to be switched off until somebody composed prose
 * would be charging for the switch, and the field would fill with a full stop. A cut is
 * the opposite case, being destructive and unrepeatable.
 *
 * `--scope` IS DECLARED AND ITS DEFAULT IS THE ONE A READER WILL COME HERE TO ARGUE WITH.
 * A switch travels: the ordinary one is committed, so the team reads it and the document
 * the next session opens with says so. `--scope private` is the switch that means one
 * machine, and the help says what that costs — a committed document cannot report it, so
 * the only place it is written down is this listing.
 *
 * THE OUTPUT SAYS WHERE THE CHANNEL NOW STANDS, which is not always where the switch just
 * put it: off wins between trees that cannot be ordered, so switching a channel on in the
 * committed tree changes nothing while this machine's tree also holds an off switch. A
 * verb that reported only its own write would leave a caller believing the opposite of
 * what the next push will do.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { SWITCHABLE_CHANNELS } from '../record-framing.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { enumeratedArgument, scopeOption } from './enumerated.js';
import { writeLines } from './io.js';
import { declaredAgent, INVALID, parseScope, WHICH_HELP } from './options.js';
import { reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** What a caller is told when they name something no channel answers to. */
const NO_SUCH_CHANNEL = 'mnema pushes no channel by that name — `mnema switch` lists them.';

/**
 * What switching a channel off does NOT do, said on every off.
 *
 * It is the honest half of the act, and the moment to say it is the moment somebody
 * believes they have finished. Switching off stops what this product PUSHES; it does not
 * stop the record, it does not stop a tool an agent calls, and it does not remove the
 * rules — everything the record holds is still there and still answers whoever asks.
 */
const OFF_LIMIT =
  'Nothing was removed and nothing else stopped: the record still holds what it held, and every read and tool still answers whoever asks. What stops is this product putting it in front of a model unasked.';

/** Registers `mnema switch` on the program. */
export function registerSwitch(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const group = program
    .command('switch')
    .description('turn off, or back on, what mnema hands to a model unasked')
    .addHelpText(
      'after',
      [
        '',
        'What each line of `mnema switch` says, and why it is on it:',
        '  The name is what `switch off` and `switch on` take.',
        '  What it carries is what stops arriving when it is off.',
        '  An off switch says who made it and when, and whether a clone of this',
        '  repository holds it — a switch recorded privately governs only this machine.',
        '  Nothing arrives switched off: a channel with no switch is on.',
      ].join('\n'),
    )
    .action(async () => {
      const { runSwitchList } = await import('../commands/switch.js');
      const { switchReport } = await import('../presentation/switches.js');
      const listing = runSwitchList(here());
      writeLines(io, switchReport(render, listing.rows, listing.trees, listing.anchors));
    });

  position(group, wiring, 'off', 'stop a channel handing the record to a model unasked');
  position(group, wiring, 'on', 'let a channel hand the record to a model again');

  return mutatesTheRecord(group);
}

/**
 * One of the two acts, declared once for both.
 *
 * The two differ in a word and in nothing else — the same argument, the same three flags,
 * the same report — so they are written once. Two declarations would be two chances for
 * the flags to drift, and the flag that would drift first is `--scope`, whose default is
 * the whole of what a switch means to a team.
 */
function position(group: Command, wiring: Wiring, word: 'off' | 'on', description: string): void {
  const { io, render, pinnedRun } = wiring;
  const on = word === 'on';
  group
    .command(word)
    .description(description)
    .addArgument(enumeratedArgument('<channel>', 'the channel to switch', SWITCHABLE_CHANNELS))
    .option('--reason <text>', 'why (recorded in the fact; never required)')
    .addOption(
      scopeOption(
        'switch',
        'Defaults to public — the switch travels with the repository, so the team reads ' +
          'it and the document a session opens with says so. A private switch governs ' +
          'only this machine and no committed file can report it.',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(async (channel: string, opts: { reason?: string; scope?: string; which?: string }) => {
      const { runSwitch } = await import('../commands/switch.js');
      // Loaded HERE and not at the top, like every other verb of this directory: the module
      // reaches the copilot, so a static import would put that edge on the floor of every
      // invocation of every verb (`tests/the-floor-is-the-declaration.test.ts`).
      const { anchorText } = await import('../anchors.js');
      const scope = parseScope(opts.scope, wiring);
      if (scope === INVALID) return;
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runSwitch(here(), {
        channel,
        on,
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(opts.which !== undefined ? { which: opts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (!result.ok) {
        reportRefusal(wiring, result, { UNKNOWN_CHANNEL: NO_SUCH_CHANNEL });
        return;
      }
      io.out(`Switched ${result.channel} ${on ? 'on' : 'off'}`);
      reportRecorded(result, io);
      // Where it now stands, which is the switch's own answer unless another tree
      // disagrees — and when one does, that is the line the caller came for. Both wordings
      // are written HERE, inside the call, and not in a helper: the guard that classifies
      // every value this wiring puts on a success line reads the templates INSIDE an
      // `io.out`, so a sentence moved into a named function is a sentence it cannot see
      // (`a-line-of-success-is-one-line.test.ts`).
      io.out(
        render(
          fact(
            result.effective.on
              ? `${result.channel} is now ON: it hands the record over as it did before.`
              : `${result.channel} is now OFF: nothing of it reaches a model. The switch that decides it was made by ${anchorText(result.anchors, result.effective.by ?? '')} at ${result.effective.at ?? ''}.`,
          ),
        ),
      );
      if (!on) io.out(render(fact(OFF_LIMIT)));
    });
}
