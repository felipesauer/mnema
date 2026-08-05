/**
 * The `mnema verify` wiring: what it declares, and what it prints.
 *
 * The one verdict the CLI does not word itself. What `runVerify` returns is a
 * summary of what could and could not be proven, and it goes out VERBATIM — the
 * surface never re-words a guarantee, because a re-wording is where "local
 * integrity" quietly becomes "verified". The issues under it are the evidence.
 *
 * THE EXIT CODE IS THE SAME VERDICT, said to a script. It is decided by the level
 * the chain derived and the minimum this invocation declared — one comparison, in
 * the chain, asked by the adapter — so the code and the sentence cannot disagree.
 * They did: with the signatures deleted, the sentence said `verified` and the exit
 * said success, which made `mnema verify` a no-op as a gate over a forged record.
 */

import { LEVEL_REQUIREMENTS, type LevelRequirement, requiredLevel } from '@mnema/chain';
import type { Command } from 'commander';
import { runVerify } from '../commands/verify.js';
import { fact } from '../presentation/detail.js';
import { here } from './context.js';
import type { CliIo } from './io.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/**
 * The minimum this surface accepts when the caller declares nothing: a break, and
 * nothing more — which is what `mnema verify` has always exited non-zero on.
 *
 * Asking for a signature by default is refused deliberately. Events above the last
 * checkpoint are the normal state of a session in flight, so `signed` as the
 * default would fail on a healthy project in the middle of its work, every time;
 * a gate that always fails is a gate somebody turns off, and then the break it
 * existed for goes out with it.
 */
const DEFAULT_REQUIREMENT: LevelRequirement = 'chained';

/** Returned by {@link parseRequirement} when the value names no requirement. */
const INVALID_REQUIREMENT = Symbol('invalid-requirement');

/**
 * Validates `--require` on the surface. The set is closed and comes from the chain's
 * own tuple, so the accepted values cannot drift from the ones that have an answer;
 * a bad value is a usage error the CLI reports itself rather than forwarding a
 * meaningless minimum to a verdict.
 */
function parseRequirement(
  value: string | undefined,
  io: CliIo,
): LevelRequirement | typeof INVALID_REQUIREMENT {
  if (value === undefined) return DEFAULT_REQUIREMENT;
  if ((LEVEL_REQUIREMENTS as readonly string[]).includes(value)) return value as LevelRequirement;
  io.err(`Invalid --require "${value}". Use one of: ${LEVEL_REQUIREMENTS.join(', ')}.`);
  return INVALID_REQUIREMENT;
}

/** Registers `mnema verify` on the program. */
export function registerVerify(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('verify')
    .description("verify the current project's chain")
    .option(
      '--require <level>',
      'the least this invocation accepts, for a script or a CI step: ' +
        'chained (the default — fail only on a break, which is what a bare `verify` ' +
        'has always done), signed (also fail unless every event is covered by a ' +
        'verified signature — expect this to fail while a session is in flight), ' +
        'witnessed (also fail unless an external witness covers the record — nothing ' +
        'provides one yet, so it never passes)',
    )
    .action((opts: { require?: string }) => {
      const requirement = parseRequirement(opts.require, io);
      if (requirement === INVALID_REQUIREMENT) {
        io.fail();
        return;
      }
      const result = runVerify({ ...here(), requirement });
      if (!result.ok) {
        reportRefusal(io, { reason: 'NO_PROJECT' });
        return;
      }
      // Print the verdict's own honest summary verbatim — the CLI never upgrades
      // the guarantee.
      io.out(result.result.summary);
      for (const issue of result.result.issues) {
        io.err(fact(`issue [${issue.layer}] ${at(issue.tail, issue.seq)}: ${issue.detail}`));
      }
      if (!result.requirementMet) {
        // A break already said why the exit is non-zero — the FAILED headline and
        // the issues under it. What needs a line of its own is the exit that comes
        // from the CALLER's minimum over a record with no break in it, because
        // there the summary reads as a pass. Both halves of the criterion go on it:
        // what was asked for, and what the record is.
        if (result.result.ok) {
          io.err(
            fact(
              `requirement not met: --require=${result.requirement} needs ` +
                `${requiredLevel(result.requirement)}, this record is ${result.result.level}`,
            ),
          );
        }
        io.fail();
      }
    });
}

/**
 * Where an issue is, for the evidence line: the tail, and the seq when the finding
 * has one.
 *
 * Not every finding does. A checkpoint that names another tail is about the whole
 * file, and a line that will not parse has no seq BECAUSE it could not be read —
 * asking for one is asking the record a question it cannot answer. Those printed as
 * `<tail>#undefined`, which is the shape of a verdict that lost a number, not of one
 * that never had it.
 */
function at(tail: string, seq: number | undefined): string {
  return seq === undefined ? tail : `${tail}#${seq}`;
}
