/**
 * The `mnema verify` wiring: what it declares, and what it prints.
 *
 * The one verdict the CLI does not word itself. What `runVerify` returns is, per tree
 * of the record, a summary of what could and could not be proven, and each goes out
 * VERBATIM — the surface never re-words a guarantee, because a re-wording is where
 * "local integrity" quietly becomes "verified". The issues under it are the evidence.
 *
 * EVERY LINE SAYS WHICH TREE IT IS ABOUT. There is more than one — the committed tree
 * and this machine's private one — so an unlabelled sentence would be a verdict whose
 * subject a reader has to guess, and an unlabelled issue would send them looking for a
 * tail in the wrong tree. The label is the tree's role (`public`, `private`, `global`),
 * never its path: the role is what a reader of someone else's CI log can act on, and
 * the path is one machine's.
 *
 * THE EXIT CODE IS THE SAME VERDICT, said to a script. It is decided by the level the
 * chain derived — the weakest of the trees, folded in the command — and the minimum
 * this invocation declared, one comparison asked of the chain, so the code and the
 * sentences cannot disagree. They did: with the signatures deleted, the sentence said
 * `verified` and the exit said success, which made `mnema verify` a no-op as a gate
 * over a forged record.
 */

import { LEVEL_REQUIREMENTS, type LevelRequirement, requiredLevel } from '@mnema/chain';
import type { Command } from 'commander';
import { runVerify, type TreeReport } from '../commands/verify.js';
import { fact } from '../presentation/detail.js';
import { renderPlain } from '../presentation/plain.js';
import { statement } from '../presentation/verdict.js';
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

/**
 * What is said about a tree of the record that holds nothing.
 *
 * It is INFORMATIONAL and it says so by what it does not claim: no level, no layer,
 * no word that reads as a pass. A clone has no private tree — it is gitignored and
 * never travels — so this is the line every fresh clone sees, and a reader has to be
 * able to tell it apart from a verdict at a glance.
 */
const NO_RECORD =
  'no record here — nothing has been written to this tree on this machine, ' +
  'so there is nothing to rule on';

/** Registers `mnema verify` on the program. */
export function registerVerify(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('verify')
    .description("verify this project's record — its committed tree and its private one")
    .option(
      '--global',
      "also verify this machine's global tree, the personal record across all " +
        'projects. Off by default: that tree belongs to no project and is present ' +
        'in every one, so a weakness in it would lower the verdict of every project ' +
        'on this disk',
    )
    .option(
      '--require <level>',
      'the least this invocation accepts, for a script or a CI step: ' +
        'chained (the default — fail only on a break, which is what a bare `verify` ' +
        'has always done), signed (also fail unless every event is covered by a ' +
        'verified signature — expect this to fail while a session is in flight), ' +
        'witnessed (also fail unless an external witness covers the record — nothing ' +
        'provides one yet, so it never passes)',
    )
    .action((opts: { require?: string; global?: boolean }) => {
      const requirement = parseRequirement(opts.require, io);
      if (requirement === INVALID_REQUIREMENT) {
        io.fail();
        return;
      }
      const result = runVerify({ ...here(), requirement, global: opts.global === true });
      if (!result.ok) {
        reportRefusal(io, { reason: 'NO_PROJECT' });
        return;
      }
      for (const tree of result.trees) report(io, tree);
      if (!result.requirementMet) {
        // A break already said why the exit is non-zero — the FAILED headline and
        // the issues under it. What needs a line of its own is the exit that comes
        // from the CALLER's minimum over a record with no break in it, because
        // there the summaries read as a pass. All of the criterion goes on it: what
        // was asked for, what the record is, and — since the level is the weakest of
        // several trees — which tree is the one at it.
        if (result.record.ok) {
          io.err(
            renderPlain(
              fact(
                `requirement not met: --require=${result.requirement} needs ` +
                  `${requiredLevel(result.requirement)}, this record is ` +
                  `${result.record.level} (${result.record.scopes.join(', ')})`,
              ),
            ),
          );
        }
        io.fail();
      }
    });
}

/**
 * One tree of the record: its verdict verbatim under the tree's name, then the issues
 * that are the evidence for it — each also naming the tree, because stderr is read on
 * its own by whatever redirected it.
 */
function report(io: CliIo, tree: TreeReport): void {
  if (tree.kind === 'no-record') {
    io.out(renderPlain(statement(tree.scope, NO_RECORD)));
    return;
  }
  // The verdict's own honest summary, verbatim — the CLI never upgrades the guarantee.
  io.out(renderPlain(statement(tree.scope, tree.result.summary)));
  for (const issue of tree.result.issues) {
    io.err(
      renderPlain(
        fact(`issue [${issue.layer}] ${tree.scope} ${at(issue.tail, issue.seq)}: ${issue.detail}`),
      ),
    );
  }
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
