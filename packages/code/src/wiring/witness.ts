/**
 * The `mnema witness` wiring: what it declares, and what it prints.
 *
 * A group of three in `tail`'s shape rather than `task`'s — its subject is the
 * record's own material, so there is no birth, no state and no `move`. Like `switch`,
 * the BARE group is the reading: a person who cannot see where the witness stands
 * cannot decide whether to ask for one or to go back for one, and the two acts say
 * nothing about the tails they did not touch.
 *
 * IT IS THE ONE VERB OF THIS SURFACE THAT SPEAKS TO SOMEBODY ELSE. Every other verb
 * answers out of the record or out of this machine's own files; these two acts send a
 * 32-byte digest to a public calendar and, on the way back, ask a block source for an
 * 80-byte header. That is declared out loud in the help rather than discovered by
 * somebody watching their firewall, and it is why both flags that name a remote are
 * on the acts and on nothing else — the reading and `verify` reach nobody, ever.
 *
 * WHAT TRAVELS IS SAID IN THE HELP because it is the question anybody sensible asks
 * first, and the answer is unusually good: the digest of a checkpoint's signed
 * message and nothing else. No id, no title, no body, no count — and the calendars
 * are handed a hash OF that digest with a per-calendar nonce, so they cannot even
 * tell that two of them were asked about the same thing.
 *
 * THERE IS NO `--which`, and the absence is the design rather than an omission. That
 * flag names the executor of a fact the record keeps, and these acts keep no fact:
 * they write an attestation file named by what it attests. Recording the act as an
 * EVENT was considered and is self-defeating — the event would seal a new checkpoint,
 * which would make the checkpoint just stamped no longer the last one.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { onOneLine } from './on-one-line.js';
import { reportRefusal } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/**
 * What `--global` says, in the same words on all three, because it is the same
 * question: `verify` leaves the machine-global tree out of a project's verdict unless
 * it is asked, and a witness over a tree no verdict reads is work with no reader.
 */
const GLOBAL_HELP =
  "also cover this machine's global tree — left out by default, exactly as `verify` leaves it out: it belongs to no project and is present in every one";

/** What the acts say about the one thing a reader of `--help` wants to know. */
const WHAT_TRAVELS =
  "What leaves this machine: the SHA-256 of one checkpoint's signed message, and " +
  'nothing else — no id, no title, no body, no count. Each calendar is handed a hash ' +
  'of that digest with a nonce of its own, so no two of them see the same value.';

/** Registers `mnema witness` on the program. */
export function registerWitness(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const witness = program
    .command('witness')
    .description('ask an outside witness to date this record, and read where that stands')
    .option('--global', GLOBAL_HELP, false)
    .action(async (opts: { global: boolean }) => {
      const { runWitnessList } = await import('../commands/witness.js');
      const { witnessReport } = await import('../presentation/witness.js');
      const listing = runWitnessList({ ...here(), global: opts.global });
      writeLines(io, witnessReport(render, listing.lines, listing.trees));
    });

  witness
    .command('stamp')
    .description("ask an outside witness to date each tail's last checkpoint (T3)")
    .option(
      '--calendar <url...>',
      'the timestamp calendars to ask — several, because any one of them is enough ' +
        'and a proof asked of one server is a proof that stops completing when that ' +
        'server does. Defaults to the public OpenTimestamps calendars.',
    )
    .addHelpText(
      'after',
      [
        '',
        WHAT_TRAVELS,
        '',
        'It refuses a tree that is not fully signed: an attestation is filed under the',
        'digest of a checkpoint, and the verifier looks for one under the checkpoint IT',
        'proved. Below that level the two can be different checkpoints.',
        '',
        'The answer is a PROMISE, not a proof. It confirms when a Bitcoin block carries it,',
        'which is minutes to hours later; `mnema witness upgrade` is the return visit, and',
        'until then `verify` reads PENDING, which is not coverage.',
      ].join('\n'),
    )
    .option('--global', GLOBAL_HELP, false)
    .action(async (opts: { calendar?: string[]; global: boolean }) => {
      const { runWitnessStamp } = await import('../commands/witness.js');
      const act = await runWitnessStamp(
        { ...here(), global: opts.global },
        opts.calendar === undefined ? {} : { calendars: opts.calendar },
      );
      await report(wiring, act);
    });

  witness
    .command('upgrade')
    .description('go back for the attestations this record is waiting on')
    .option('--calendar <url...>', 'the calendars to ask, when the defaults are not the ones used')
    .option(
      '--blocks <url>',
      'where a block header is read from once an attestation confirms. Asked ONCE per ' +
        'block: the 80 bytes are then part of the record, and every verification after ' +
        'that is arithmetic on this machine. Defaults to a public block explorer.',
    )
    .addHelpText(
      'after',
      [
        '',
        'Safe to repeat: a calendar with nothing yet answers so, and the proof comes back',
        'as it went in. A header this fetches is checked against the block it claims to be',
        "— it hashes to that block's id — so a substituted one is not a matter of trust.",
      ].join('\n'),
    )
    .option('--global', GLOBAL_HELP, false)
    .action(async (opts: { calendar?: string[]; blocks?: string; global: boolean }) => {
      const { runWitnessUpgrade } = await import('../commands/witness.js');
      const act = await runWitnessUpgrade(
        { ...here(), global: opts.global },
        {
          ...(opts.calendar === undefined ? {} : { calendars: opts.calendar }),
          ...(opts.blocks === undefined ? {} : { blockSource: opts.blocks }),
        },
      );
      await report(wiring, act);
    });

  return mutatesTheRecord(witness);
}

/**
 * What an act prints: a line per tail it touched, then whoever would not answer.
 *
 * It loads the state's word rather than spelling one, and it loads it INSIDE the
 * action for the reason every other verb here loads its work there: an eager import
 * of `presentation/` raises the floor of every invocation of every verb, including
 * the ones that print nothing.
 */
async function report(
  wiring: Wiring,
  act: Awaited<ReturnType<typeof import('../commands/witness.js').runWitnessStamp>>,
): Promise<void> {
  const { io, render } = wiring;
  const { witnessWord } = await import('../presentation/witness.js');
  if (!act.ok) {
    reportRefusal(wiring, act, {});
    return;
  }
  if (act.outcomes.length === 0) {
    io.out(`No tail holds events in any tree here — looked in ${act.trees.join(', ')}.`);
    return;
  }
  for (const outcome of act.outcomes) {
    // THE TAIL ID IS A DIRECTORY NAME, so it is a value from outside on a line of a
    // list — the same origin `verify`'s findings collapse for. The rest of this line
    // is a word of a closed union or a sentence composed above, and the line is
    // collapsed WHOLE rather than value by value, which is what the tag is for.
    io.out(onOneLine`${outcome.tail} (${outcome.scope}): ${outcome.did} — ${outcome.detail}`);
    // The reading's own words are `@mnema/chain`'s, and one of them can quote a
    // calendar URI read off a file in the tree. That value goes through the chain's
    // one-line rule where it enters the sentence; this collapses again HERE for the
    // reason the census line does — the layer that lays a line out does not get to
    // depend on another package's discipline for whether its list gains a row.
    io.out(
      render(
        fact(
          onOneLine`external witness (T3): ${witnessWord(outcome.reading.status)} — ${outcome.reading.detail}`,
        ),
      ),
    );
    // Whoever would not answer is NAMED rather than counted: several calendars are
    // asked precisely so one of them can be down, and a reader deciding whether that
    // matters needs to know which one it was. Both halves come from outside — a URL
    // the caller typed, and somebody else's error message.
    for (const refusal of outcome.refusals) {
      io.out(render(fact(onOneLine`${refusal.where} did not answer: ${refusal.reason}`)));
    }
  }
}
