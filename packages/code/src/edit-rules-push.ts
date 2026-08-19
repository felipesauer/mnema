/**
 * What the product says when a rule of the record reaches the moment a file is about
 * to be written — the first thing mnema pushes that nobody asked for and that is not
 * the opening document.
 *
 * WHAT IT CLOSES, measured rather than supposed. The opening document arrives once, and
 * a round of use scored the arm carrying it at 1/4 on the task that discriminates
 * (`a4-collation`): the rule reached the session and did not survive to the moment the
 * code was written. This is that moment, and it is the only one this module answers —
 * one event, one path, one text.
 *
 * ## The thin form, and the number that decided it
 *
 * A rule arrives as its NAME, its ADDRESS and its ID, and never its body. The measured
 * difference is 3,783 bytes against 401 for one record
 * (`measurements/channel-cost/results/2026-08-19/injection-size.json`), and it is paid on
 * EVERY edit: the median session of this machine edits 34 files, the p90 edits 121 and
 * the largest seen edited 3,424. There is a second reason the totals hide, and it was
 * measured on this host: the injected text does not replace the previous one, it is
 * appended to the conversation and stays there — so a per-edit push spends its bytes
 * once and then carries them for the rest of the session.
 *
 * The id is on the line because a charge cites the id. That is G1 of the axis rather
 * than a nicety: the grade this module ships informs and never refuses, and the grade
 * that refuses has to name the rule it came from — a text pushed without the id would
 * leave the later charge with nothing to cite.
 *
 * ## It is silent when no rule in force addresses the path, and that is a DECISION
 *
 * The alternative was considered and rejected with a number. Always injecting — "nothing
 * governs this file; N rules address this project" — satisfies to the letter the rule
 * that an empty answer must say which kind of empty it is, and pays for it 121 times in
 * a p90 session to say nothing, in a channel where every payment persists. So the empty
 * case is answered ONCE, where a session opens: the document `mnema brief` prints says
 * how many of the rules it carries have an address (see `presentation/brief.ts`), which
 * is what gives the silence here a known meaning — "none of them addresses this path"
 * rather than "there is no mechanism".
 *
 * WHAT THAT DOES NOT BUY, said plainly because the guard cannot say it: a reader that
 * has been told the record holds twelve addresses and then edits a file quietly cannot
 * tell "none of the twelve addresses this one" from "the hook did not run". Closing that
 * would take an index of the addressed paths in the opening document — measured at 3,921
 * bytes for a realistic record, once per session — and it is not this slice.
 *
 * ## What is left out, and why each
 *
 * A rule that ADDRESSES the path but is not in force is not here: `rulesInForceAt`
 * narrows to what holds, because pushing a superseded decision as the rule for an edit
 * is the product asserting what the record denies. Whoever asks `governing_rules` still
 * gets it, with its state.
 *
 * STALENESS IS NOT CONSULTED, and the first version of this note had it backwards. It
 * said a stale address "matches nothing, so there is no moment at which it would fire" —
 * false, and the case that falsifies it is the ordinary one: an address naming a
 * directory the tree does not hold YET is stale by the disk probe, and the edit that
 * creates a file under it is exactly the moment its rule should arrive. So the push asks
 * which addresses cover the path and never whether they exist, and
 * `the-rule-reaches-the-writing.test.ts` holds it ("reaches a file the tree does not hold
 * yet"). What the third count is for stays what it was — a rule whose file was MOVED
 * stops governing in silence — and it is reported by the readings that count it
 * (`mnema rules`, `governing_rules`) and by the once-per-session document.
 *
 * The THREE COUNTS are not here, for the reason `rulesInForceAt` gives: a count paid on
 * every edit to say the same thing is the shape the thin form exists to avoid.
 *
 * ## The rule of the line
 *
 * Every value on a line came out of the record — the rule's name, the address someone
 * typed into `--rel governs`, and the id, which is a caller's string too since a link's
 * subject reaches the chain without being checked to exist. All three go through
 * {@link oneLine}, HERE, at the one place a line is built: a name holding a newline
 * would end its own line and start a second one, and the second would read as a rule
 * this project never made, in a text that arrives while code is being written.
 */

import type { PushedRule, RulesAtPath } from '@mnema/copilot';
import { oneLine } from './one-line.js';
import { recordFramingBlock } from './record-framing.js';

/**
 * What these rules are ABOUT — the one sentence this channel adds over the framing.
 *
 * The framing says what the text IS and whose it is; it cannot say why it arrived, and
 * a reader handed rules in the middle of writing a file has no way to know which file
 * they are about. So the path is named, and named as the record compares it rather than
 * as the host spelled it.
 *
 * It says what the text is and stops. There is no "check these before you write", and
 * there will not be: a sentence telling a reader what to do about somebody else's code
 * is the one thing `record-framing.ts` exists to keep out of a pushed text, and the
 * record already says a rule governs in its own voice.
 */
function addressedAt(path: string): string {
  return `Addressed at ${oneLine(path)}:`;
}

/**
 * What a rule not in the committed tree says about itself — one line for the whole
 * notice, never one word per rule.
 *
 * A private rule governs the work on this machine and its id resolves nowhere else, so a
 * reader that cited it in a commit would be citing something a teammate cannot open.
 * Saying so per rule would spend bytes on every line of every edit for a fact that is
 * usually about none of them; saying it once, when at least one of them is that way, is
 * the same information at the cost of the case that has it.
 */
const ONE_IS_NOT_COMMITTED =
  'One of these is not committed to this project, so its id is not in a clone of it.';

/**
 * The text to push for `at`, or `undefined` when there is nothing to say.
 *
 * `undefined` is the silence, and it is one value rather than an empty string so that
 * the caller has to decide what silence means on its channel — on this host it is a
 * reply carrying no context at all, which is not the same thing as a reply carrying
 * empty text.
 */
export function editRulesNotice(at: RulesAtPath): string | undefined {
  if (at.rules.length === 0) return undefined;
  return [
    recordFramingBlock('edit-rules-push'),
    addressedAt(at.relative ?? at.path),
    ...at.rules.map(ruleLine),
    ...(at.rules.every((rule) => rule.travels) ? [] : [ONE_IS_NOT_COMMITTED]),
  ].join('\n');
}

/**
 * One rule, as one line: what it says, the address that matched, and the id.
 *
 * The name is in quotes because it is text somebody wrote, the address follows the
 * relation's own word, and the id comes last because it is what a reader copies. The
 * order is the derivation's — most specific first — so the rule that speaks to this file
 * is the first one read.
 */
function ruleLine(rule: PushedRule): string {
  return `“${oneLine(rule.name)}” — governs ${oneLine(rule.address)} · ${oneLine(rule.id)}`;
}
