/**
 * The `mnema verify` wiring: what it declares, and what it prints.
 *
 * The one verdict the CLI does not word itself. What `runVerify` returns is, per tree
 * of the record, what could and could not be proven, and every word of it goes out as it
 * came — the surface never re-words a guarantee, because a re-wording is where "local
 * integrity" quietly becomes "verified". The issues under it are the evidence.
 *
 * IT COMPOSES THE VERDICT NOW, AND THAT IS NOT A RE-WORDING. The chain hands over its
 * one-line verdict as the CLAUSES it is made of, and this file lays them out on a line:
 * one of them is the level, which is the only clause that is good or bad news, and it is
 * the one that carries a colour. The clause a hue lands on is chosen by WHAT THE CLAUSE
 * IS — never by matching its text, which on a verdict would be the surface deciding what
 * the chain said. And the composition adds nothing: rendered without style, the line is
 * the tree's name, a colon, and the chain's own `summary`, byte for byte, which is what
 * `the-verdict-is-parts.test.ts` asserts. The clause list was the alternative to a
 * sentence composed HERE beside the chain's own — two sentences about one record, which
 * is how a surface ends up promising more than the proof does.
 *
 * WHY THE COLOUR IS NOT ON THE LABEL. Every other verdict on this surface paints its
 * label, because the label is the word that answers (`guard` says `REFUSED`). Here the
 * label is a TREE'S NAME, and a red `private` would say the tree was bad news rather
 * than the verdict over it.
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

import type {
  CensusNote,
  LevelRequirement,
  ProvenLevel,
  VerdictClause,
  VerifyResult,
} from '@mnema/chain';
import type { Command } from 'commander';
import type { TreeReport } from '../commands/verify.js';
import { fact } from '../presentation/detail.js';
import type { Line, Severity } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { type Clause, clauseStatement, statement } from '../presentation/verdict.js';
import { here } from './context.js';
import { enumeratedOption, glossedList, LEVEL_REQUIREMENTS, listed } from './enumerated.js';
import type { CliIo } from './io.js';
import { type Reporter, reportRefusal, reportUsage } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/**
 * What each requirement MEANS, in the phrase `--require` prints beside it.
 *
 * Total over the chain's `LevelRequirement`, so a fourth level does not compile until
 * this says what asking for it does — the omission the help used to be able to make
 * silently, since the three were typed out in a sentence nothing compared to anything.
 */
const LEVEL_MEANS: Readonly<Record<LevelRequirement, string>> = {
  chained: 'the default — fail only on a break, which is what a bare `verify` has always done',
  signed:
    'also fail unless every event is covered by a verified signature — expect this to fail ' +
    'while a session is in flight',
  witnessed:
    'also fail unless an external witness covers the record — nothing provides one yet, so ' +
    'it never passes',
};

/**
 * The minimum this surface accepts when the caller declares nothing: a break, and
 * nothing more — which is what `mnema verify` has always exited non-zero on.
 *
 * Asking for a signature by default is refused deliberately. Events above the last
 * checkpoint are the normal state of a session in flight, so `signed` as the
 * default would fail on a healthy project in the middle of its work, every time;
 * a gate that always fails is a gate somebody turns off, and then the break it
 * existed for goes out with it.
 *
 * Exported for the console's opening panel, which verifies without a caller to declare
 * anything: it shows what the record IS and never gates on it, so the minimum it asks
 * for has to be the one a bare `verify` asks for, and naming it twice is how those two
 * come to differ.
 */
export const DEFAULT_REQUIREMENT: LevelRequirement = 'chained';

/**
 * WHAT THIS VERB IS CALLED, and the one place it is spelled.
 *
 * It is registered below and it is also NAMED — by the console, in the badge that sits in
 * the corner of every frame and says what the record proved. That badge is a level and the
 * word that prints the whole verdict behind it, so the word has to be the one commander
 * routes; typed a second time, the day this verb is renamed is the day the console starts
 * telling a caller to run something that does not exist. The same shape `repl.ts` already
 * uses for its own name.
 */
export const VERIFY_VERB = 'verify';

/** Returned by {@link parseRequirement} when the value names no requirement. */
const INVALID_REQUIREMENT = Symbol('invalid-requirement');

/**
 * Validates `--require` on the surface. The set is closed and comes from the chain's
 * own tuple, so the accepted values cannot drift from the ones that have an answer;
 * a bad value is a usage error the CLI reports itself rather than forwarding a
 * meaningless minimum to a verdict.
 *
 * THE TUPLE USED TO BE HANDED IN, on the argument that it is the chain's and the caller
 * is the action, which is where the chain is loaded. What falsified it: the flag's HELP
 * now lists the levels, and help is built while commander is being configured — so the
 * tuple is at module scope either way, and passing it as a parameter only made it
 * possible for the sentence and the check to read two different tuples. They read
 * {@link LEVEL_REQUIREMENTS}, once, and the message it words is unchanged.
 */
function parseRequirement(
  value: string | undefined,
  to: Reporter,
): LevelRequirement | typeof INVALID_REQUIREMENT {
  if (value === undefined) return DEFAULT_REQUIREMENT;
  if ((LEVEL_REQUIREMENTS as readonly string[]).includes(value)) return value as LevelRequirement;
  reportUsage(to, `Invalid --require "${value}". Use one of: ${listed(LEVEL_REQUIREMENTS)}.`);
  return INVALID_REQUIREMENT;
}

/**
 * What is said about a tree of the record that holds nothing, in the two pieces every
 * verdict on this surface comes in: what it IS, and what qualifies it.
 *
 * It is INFORMATIONAL and it says so by what it does not claim: no level, no layer,
 * no word that reads as a pass. A clone has no private tree — it is gitignored and
 * never travels — so this is the line every fresh clone sees, and a reader has to be
 * able to tell it apart from a verdict at a glance.
 *
 * THE SPLIT IS THE CHAIN'S SHAPE, borrowed. A verified tree's sentence arrives as a
 * headline clause and the clauses that qualify it, and a caller with room for one line
 * shows the headline; this tree had no chain to ask, so the surface says the same thing
 * in the same two pieces rather than making the short reading impossible for the one
 * tree whose sentence it words itself. {@link NO_RECORD} is the two joined, by the one
 * expression that joins them, so the full reading cannot come to disagree with the short
 * one — and the byte the golden holds is unchanged.
 */
const NO_RECORD_HEADLINE = 'no record here';
const NO_RECORD_WHY =
  ' — nothing has been written to this tree on this machine, so there is nothing to rule on';
const NO_RECORD = NO_RECORD_HEADLINE + NO_RECORD_WHY;

/** Registers `mnema verify` on the program. */
export function registerVerify(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verify = program
    .command(VERIFY_VERB)
    .description("verify this project's record — its committed tree and its private one")
    .option(
      '--global',
      "also verify this machine's global tree, the personal record across all " +
        'projects. Off by default: that tree belongs to no project and is present ' +
        'in every one, so a weakness in it would lower the verdict of every project ' +
        'on this disk',
    )
    .addOption(
      enumeratedOption(
        '--require <level>',
        'the least this invocation accepts, for a script or a CI step: ' +
          glossedList(LEVEL_REQUIREMENTS, LEVEL_MEANS),
        LEVEL_REQUIREMENTS,
      ),
    )
    .action(async (opts: { require?: string; global?: boolean }) => {
      const { requiredLevel } = await import('@mnema/chain');
      const { runVerify } = await import('../commands/verify.js');
      const requirement = parseRequirement(opts.require, wiring);
      if (requirement === INVALID_REQUIREMENT) return;
      const result = runVerify({ ...here(), requirement, global: opts.global === true });
      if (!result.ok) {
        reportRefusal(wiring, { reason: 'NO_PROJECT' });
        return;
      }
      for (const tree of result.trees) report(io, render, tree);
      if (!result.requirementMet) {
        // A break already said why the exit is non-zero — the FAILED headline and
        // the issues under it. What needs a line of its own is the exit that comes
        // from the CALLER's minimum over a record with no break in it, because
        // there the summaries read as a pass. All of the criterion goes on it: what
        // was asked for, what the record is, and — since the level is the weakest of
        // several trees — which tree is the one at it.
        if (result.record.ok) {
          io.err(
            render(
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
  return readsTheRecord(verify);
}

/**
 * One tree of the record: its verdict verbatim under the tree's name, then the issues
 * that are the evidence for it — each also naming the tree, because stderr is read on
 * its own by whatever redirected it.
 */
function report(io: CliIo, render: Render, tree: TreeReport): void {
  if (tree.kind === 'no-record') {
    io.out(render(statement(tree.scope, NO_RECORD)));
    return;
  }
  // The verdict's own honest clauses, laid out — the CLI never upgrades the guarantee.
  io.out(render(clauseStatement(tree.scope, said(tree.result))));
  // The census, in the same shape as an issue and on the OTHER stream. Its clause has
  // said "see census" since the day the notes existed and there was nowhere to see
  // them: a reader was told a count and left with no way to learn WHICH key, or what
  // the record says about it. They go to stdout because a note is not a break — it
  // does not move the verdict and it does not move the exit — and stderr on this
  // surface is where the evidence for a failure goes.
  for (const note of tree.result.census) {
    io.out(
      render(fact(`census [${note.kind}] ${tree.scope} ${censusLocus(note)}: ${note.detail}`)),
    );
  }
  for (const issue of tree.result.issues) {
    io.err(
      render(
        fact(`issue [${issue.layer}] ${tree.scope} ${at(issue.tail, issue.seq)}: ${issue.detail}`),
      ),
    );
  }
}

/**
 * WHERE A CENSUS NOTE POINTS — total over the chain's union by type, so a third kind
 * of observation does not compile until somebody says what a reader should go and
 * look at. A note whose locus was guessed from whichever field happened to be there
 * would send a reader to the wrong file, which is worse than not printing it.
 *
 * The two are different things and they name different things: one is about a KEY
 * with no tail (so it names the fingerprint), the other about a TAIL whose last line
 * was dropped (so it names the tail).
 */
function censusLocus(note: CensusNote): string {
  switch (note.kind) {
    case 'key-without-tail':
      return note.fingerprint;
    case 'partial-final-line':
      return note.tail;
  }
}

/**
 * WHAT A PROVEN LEVEL IS AS NEWS — the one place this surface decides it.
 *
 * TOTAL OVER THE UNION BY TYPE, and that is the whole reason it is a table rather than a
 * branch: the chain's levels are a closed tuple, so the day a rung is added between two
 * of these, this file does not build until somebody says whether it is good news. A
 * fallback would have painted it whatever the fallback chose, which on a verdict is the
 * surface answering a question the proof did not.
 *
 * The three, and the argument for each:
 *
 *   - `unreadable` and `broken` are RED. Something is wrong with the record, and the
 *     sentence already says FAILED — the hue is a second copy of the word for an eye
 *     scanning a screen, never the thing that says it.
 *   - `hash-chain-only` is YELLOW, and it is the entry that matters. The hash chain holds
 *     and NO signature was checked, because there was none to check. Green there is
 *     exactly the pass this product was measured giving over a record whose signatures
 *     had been deleted; red is a project between its first event and its first
 *     checkpoint, which is a legitimate state, and a verdict that fails on it teaches its
 *     reader to ignore verdicts. It is neither, and there is a hue for neither.
 *   - the three signed rungs are GREEN, including `signed-through-last-checkpoint`. Its
 *     residual is the normal state of a session in flight, the clause beside it says how
 *     many events rest on the hash chain alone, and a caller who cannot live with that
 *     says `--require=signed` and gets an exit code. Yellow there would be a caution on
 *     nearly every healthy project, and a caution that is always on is not one.
 *
 * It lives in this verb rather than in the refusal funnel because it is not a refusal:
 * `verify` naming a broken tree DID what it was asked. `every-refusal-is-red.test.ts`
 * names the two places a severity is decided and why each is its own.
 */
const LEVEL_SEVERITY: Readonly<Record<ProvenLevel, Severity>> = {
  unreadable: 'bad',
  broken: 'bad',
  'hash-chain-only': 'warn',
  'signed-through-last-checkpoint': 'good',
  'fully-signed': 'good',
  'externally-witnessed': 'good',
};

/** How each level reads as news, for a caller that has to say which levels paint how. */
export function levelSeverity(level: ProvenLevel): Severity {
  return LEVEL_SEVERITY[level];
}

/**
 * The chain's verdict as the clauses of a line: its words untouched, with the news on
 * the ONE clause that carries any.
 *
 * The level's clause is found by WHAT IT IS and never by where it sits or what it says.
 * By position, a chain that put a clause before the level would silently paint the wrong
 * one; by text, this file would be reading the verdict out of its own rendering of it,
 * and the match would break the day a level was reworded — which is the coupling that
 * made a pre-joined summary impossible to paint at all.
 */
function said(result: VerifyResult): readonly [Clause, ...Clause[]] {
  const [lead, ...rest] = result.clauses;
  const paint = news(result);
  return [paint(lead), ...rest.map(paint)];
}

/**
 * How one clause of THIS verdict reads: its words, and the news where it is the level.
 *
 * One function and two readers, which is what keeps the short reading below from being
 * a second opinion about which clause is the answer.
 */
function news(result: VerifyResult): (clause: VerdictClause) => Clause {
  return (clause) =>
    clause.of === 'level'
      ? { text: clause.text, severity: levelSeverity(result.level) }
      : { text: clause.text };
}

/**
 * WHAT ONE TREE'S VERDICT IS, IN A LINE THAT FITS A COLUMN: the tree's name, and the
 * clause that IS the answer.
 *
 * The console's opening panel has room for one line per tree and `verify` has room for
 * the sentence, and this is the whole of the difference between them: the panel drops
 * the clauses that QUALIFY the verdict and drops not a word of the verdict itself. That
 * is a property rather than an intention — what this returns, rendered, is a PREFIX of
 * what {@link report} writes for the same tree, and `tests/the-panel.test.ts` asserts it
 * over every tree of a real record. A surface that shortened a verdict any other way
 * would be wording one, which is the one thing this file exists not to do.
 *
 * Which clause is the answer is asked of {@link news}, so the panel and the full reading
 * cannot come to disagree about it. A verdict with no level clause — which the chain does
 * not produce and which this cannot rule out by type — keeps every clause it has: saying
 * less than the record does is the failure worth guarding against, and saying all of it
 * is still a prefix.
 */
export function treeHeadline(tree: TreeReport, depth: number): Line {
  if (tree.kind === 'no-record') {
    return statement(tree.scope, NO_RECORD_HEADLINE, undefined, depth);
  }
  return clauseStatement(tree.scope, headline(tree.result), depth);
}

/** The clause that is the answer, alone — or every clause, when none says it is one. */
function headline(result: VerifyResult): readonly [Clause, ...Clause[]] {
  const paint = news(result);
  const level = result.clauses.find((clause) => clause.of === 'level');
  return level === undefined ? said(result) : [paint(level)];
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
