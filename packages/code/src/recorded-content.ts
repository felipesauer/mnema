/**
 * What the surfaces say about the text they just recorded — one wording, both of
 * them.
 *
 * Four things belong here because they are the same statement told at two moments.
 *
 * AFTER a write, {@link landedNotice} says which tree it went to,
 * {@link replacementNotice} says what was taken out, and {@link reachNotice} — on the
 * one verb whose target can be an address — says how much of the working tree that
 * address covers. The last is a fact and not a warning, and it is here rather than in
 * either surface for the reason the other two are: a person recording an address at the
 * command line and an agent recording one through a tool must be told the same thing,
 * and a number worded twice is two numbers that can come to differ. A scrub that
 * happened in silence would be the tool lying to its caller: it asked to record X
 * and X is not what landed, so the next session reads a placeholder with no idea
 * why, and — the part that actually costs something — a live credential stays
 * unrotated because nobody was told it had been typed. The notice names the
 * classes and says what to do, which is the only useful instruction there is: the
 * record is permanent, so rotating is the remedy, not deleting.
 *
 * BEFORE a write, {@link RECORD_CONTRACT} declares what recording here means.
 * Three facts, none of them obvious from a tool's name: it is permanent; a public
 * record is committed and clones to the whole team (and is published with a public
 * repository); and the scrub only catches formats it recognizes, so what it does
 * not recognize goes in verbatim. That last clause is the one that earns the other
 * two — the scrub covers recognizable shapes and the declaration covers exactly
 * what it cannot, so leaving it out would let silence read as safety. Neither half
 * is a substitute for the other.
 *
 * The wording lives in one place because the two surfaces would drift apart
 * otherwise, and a contract that differs between the CLI and the MCP is not a
 * contract. The FORM differs — the CLI writes lines, a tool call returns one text
 * block — and only that.
 */

import { RECOMMENDED_LINK_RELATIONS } from '@mnema/chain';
import type { AddressReach } from '@mnema/copilot';
import type { Scope, SecretClass } from '@mnema/core';
import { FIELD_BYTE_LIMIT, secretPlaceholder } from '@mnema/core';

/**
 * The lines to print after a link whose target is an ADDRESS, or none at all when it
 * is not one.
 *
 * A FACT AND NOTHING ELSE. It says what the address covers and stops; there is no
 * threshold on it, no warning word, no advice about whether the address is too wide.
 * A rule addressed at a whole repository is a legitimate thing to record, and a
 * product with an opinion about how much of somebody's tree their own rule should
 * reach would be charging for a judgement nobody recorded. What was missing was never
 * a policy — it was that the person typing the address could not see what it reached
 * until after they had recorded it.
 *
 * THE FRACTION AND NOT THE NUMBER, because the number alone lies by omission: 128
 * files is most of a small repository and a corner of a large one, and it is the pair
 * that makes a cliff visible — an address one segment shallower can multiply what it
 * covers tenfold, and that is the whole reason this line exists.
 *
 * IT SAYS "FILES, NOT EDITS" ON THE LINE ITSELF. The measurement that produced this
 * line counted file touches across commits; this counts what is ON DISK, and the two
 * are not the same quantity — a directory of a thousand files nobody opens weighs
 * here exactly as much as a thousand files touched daily, and will fire far less. A
 * reader who takes this for a rate of firing has been misled by a number, which is
 * worse than not having one, so the qualification travels ON the line and never only
 * in a report.
 *
 * IT NAMES WHAT THE BASE LEFT OUT, for the same reason: the base is a judgement
 * (`NOT_HAND_WRITTEN`), and a fraction whose denominator was decided out of sight
 * cannot be argued with. A truncated walk says so too — a count cut in silence is
 * worse than no count.
 */
export function reachNotice(reach: AddressReach | undefined): string[] {
  if (reach === undefined) return [];
  if (reach.address === undefined) {
    // An address outside the project covers nothing here, and saying "0 of 1,204"
    // would report that as a narrow address rather than as a different question.
    return [`  That address lies outside this project, so it covers nothing here.`];
  }
  const counted = `${reach.under} of ${reach.counted} file(s)`;
  const floor = reach.truncated
    ? ` (the walk stopped at ${reach.counted}, so both are floors)`
    : '';
  const left = reach.skipped.length === 0 ? '' : `; not counted: ${[...reach.skipped].join(', ')}`;
  return [
    `  ${reach.address} covers ${counted} counted in the working tree${floor}${left}.`,
    '  Files on disk, not edits — a directory nobody touches counts the same as a busy one.',
  ];
}

/**
 * The lines to print after a write that replaced something, or none at all when
 * it did not.
 *
 * Every placeholder is listed, including a repeat, so the count and the list agree
 * — "2 values" next to one placeholder would leave a reader wondering which of the
 * two it stood for. The second line is the instruction, and it is unconditional:
 * the caller cannot know whether the value was real, and the cost of rotating a
 * credential that was fake is nothing next to the cost of not rotating one that
 * was not.
 */
export function replacementNotice(replaced: readonly SecretClass[] | undefined): string[] {
  if (replaced === undefined || replaced.length === 0) return [];
  const placeholders = replaced.map(secretPlaceholder).join(', ');
  return [
    `  ${replaced.length} value(s) replaced before recording: ${placeholders}`,
    '  This record is permanent. If those were real credentials, rotate them.',
  ];
}

/**
 * WHERE the write landed, as the line that follows every confirmation.
 *
 * The tree a fact lands in is now decided by what the fact IS, and nothing on the
 * call said it — so the reply is the only place the author can learn it. That is the
 * product's own doctrine applied to the one thing it did not cover: the content door
 * tells the author what it replaced AT THE MOMENT they can still act, and the scope
 * said nothing at all. A session of real use discovered its own scope by reading the
 * record afterwards and passed it on to the person as a caveat; it was right to, and
 * it is the proof that the surface had not spoken.
 *
 * Each line names the tree AND the consequence, because the name alone is a word
 * ("private") that reads as reassurance to one caller and as a dead end to another.
 * What a caller acts on is whether the fact travels: a decision that reaches the team
 * on clone, or a note that never leaves this machine.
 *
 * It states the fact and stops there — no instruction to re-record elsewhere. The
 * override is in every write's own interface, the routing is deliberate, and a
 * suggestion appended to every successful write would be noise on the path that is
 * working as designed.
 */
export function landedNotice(scope: Scope): string {
  switch (scope) {
    case 'public':
      return '  Landed in the public tree — committed with the repository, so it reaches every clone.';
    case 'private':
      return "  Landed in the private tree — this machine's own; it is not committed and does not travel.";
    case 'global':
      return '  Landed in the global tree — personal and cross-project, outside any repository.';
  }
}

/** The half of a write result that reports what the content door replaced. */
export interface Replacement {
  readonly replaced?: readonly SecretClass[];
}

/**
 * The half of a write result that reports WHERE it landed — the tree the kind (or
 * the caller's override) routed it to.
 *
 * Present on every successful write of both surfaces, and not optional: a write
 * that could not say where it went is the state this closes. It is the RESOLVED
 * scope, never the argument — the argument is regularly absent.
 */
export interface Landed {
  readonly scope: Scope;
}

/**
 * The replacement report, ready to spread onto an adapter's own result — present
 * when something was replaced, absent when nothing was.
 *
 * Every adapter between the core and a surface has to forward it, and forwarding
 * it by hand is where one of them would quietly drop it: the write would still
 * succeed, the record would still be clean, and the caller would simply never
 * learn that a credential of theirs is now permanent and unrotated. One function
 * makes the forwarding uniform and the omission visible.
 */
export function forwardReplacement(result: Replacement): Replacement {
  return result.replaced !== undefined ? { replaced: result.replaced } : {};
}

/**
 * What a link's relation may be, as both surfaces say it: the catalog's recommended
 * labels, and the fact that any other label is taken.
 *
 * Read from the catalog's own tuple rather than typed out. It was typed out — the
 * four labels appeared in the CLI's help, in the tool description, and in two
 * doc-comments, while `RECOMMENDED_LINK_RELATIONS` sat exported with no caller and
 * a docstring saying it existed so nobody would hard-code the strings. Four copies
 * of a list is four places to forget; the vocabulary is the catalog's, so it is
 * read from there and worded once.
 *
 * `cli.help.golden.txt` pins the wording this composes, so a label added to the
 * catalog shows up as a golden diff rather than as help that has gone stale.
 */
export const RECOMMENDED_RELATIONS = `recommended: ${RECOMMENDED_LINK_RELATIONS.join(
  ', ',
)}; any label is accepted`;

/**
 * What recording here means, for a caller reading a tool description. Appended to
 * every write tool, in one wording, so the contract cannot differ between two of
 * them.
 */
export const RECORD_CONTRACT =
  ' RECORDING IS PERMANENT: mnema is append-only and nothing deletes a fact. ' +
  'A record in the public scope is committed to the repository and reaches every ' +
  'machine that clones it — published, if that repository is public. So do NOT ' +
  'record credentials here. Values in a recognized format (cloud keys, API ' +
  'tokens, private keys, a password inside a URL) are replaced with a typed ' +
  'placeholder before anything is written and the reply says what was replaced, ' +
  'but a format mnema does not recognize is written verbatim and cannot be taken ' +
  `back. Each text field holds at most ${FIELD_BYTE_LIMIT} bytes; a longer one ` +
  'is refused, not truncated.';

/**
 * The same contract for a `--help` reader, wrapped as lines.
 *
 * Shorter than the tool description on purpose. An agent reads a description once
 * and acts on it, so it gets the whole contract; a person reads `--help` while
 * trying to do something else, and a paragraph there is a paragraph that gets
 * skipped. The three facts survive; the elaboration does not.
 */
export const RECORD_CONTRACT_HELP = [
  '',
  'What recording means here:',
  '  Permanent — mnema is append-only and nothing deletes a fact. A public record',
  '  is committed and reaches every machine that clones the repository.',
  '  Do not record credentials: a recognized format is replaced with a placeholder',
  '  and reported back, but what mnema does not recognize is written verbatim.',
  `  Each text field holds at most ${FIELD_BYTE_LIMIT} bytes; a longer one is refused.`,
].join('\n');
