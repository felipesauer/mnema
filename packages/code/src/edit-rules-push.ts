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
 * A rule arrives as its NAME, its ADDRESS, its ID and where the record says it CAME
 * FROM, and never its body. The measured
 * difference is 3,783 bytes against 401 for one record
 * (`measurements/channel-cost/results/2026-08-19/injection-size.json`), and it is paid on
 * EVERY edit: the median session of this machine edits 34 files, the p90 edits 121 and
 * the largest seen edited 3,424. There is a second reason the totals hide, and it was
 * measured on this host: the injected text does not replace the previous one, it is
 * appended to the conversation and stays there — so a per-edit push spends its bytes
 * once and then carries them for the rest of the session.
 *
 * The id is on the line because a charge cites the id. That is a requirement rather
 * than a nicety: the grade this module ships informs and never refuses, and the grade
 * that refuses has to name the rule it came from — a text pushed without the id would
 * leave the later charge with nothing to cite.
 *
 * THAT SENTENCE READ "ITS NAME, ITS ADDRESS AND ITS ID", AND THE FOURTH FIELD IS WHY IT
 * IS REWRITTEN RATHER THAN WIDENED. What it protected is the clause that survives it —
 * NEVER ITS BODY — and the number behind that clause is the one above: a record's text is
 * 3,783 bytes against 401, paid on every edit and carried for the rest of the session. A
 * provenance is not a body. It is an ADDRESS, of the same kind as the one already on the
 * line: 54 to 80 bytes measured over the rules in force on a real project, against a
 * rationale that is two orders larger.
 *
 * WHAT FALSIFIED THE THREE-FIELD FORM AS A RULE. Nothing on the line could be OPENED. The
 * `ADR-<n>` this channel does not even print is a counter of the chain — measured on a
 * real project, 241 of 247 labels name a different file from the one the decision came
 * out of — and the id opens through `read_record` alone, which two instrumented captures
 * say the agent does not call: `mcp_asked` false in 20 of 20 and then in 40 of 40 cells
 * (`measurements/p1/`). So the channel that arrives unasked was the only one
 * giving its reader no path they could follow without asking for something. The
 * `derived-from` edge was already in the record and already served by the three reads
 * somebody ASKS for (`presentation/record.ts`); the thin form was thin in the field that
 * cost nothing and fat in the one that bought nothing.
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
 * THE SILENCE HAS THREE READINGS NOW, AND THE DOCUMENT CLOSES ONE OF THEM. This paragraph
 * used to name two — "none of the twelve addresses this one" against "the hook did not run"
 * — and the third arrived with the switch: somebody turned this channel off, which produces
 * the identical nothing. So the once-per-session document does not only carry the count any
 * more; when the push is switched off in the COMMITTED record it says so, names who switched
 * it and when, and stops claiming that the rules arrive (`presentation/brief.ts`). The
 * reading that spans every tree, including a switch kept on one machine, is `mnema switch`.
 *
 * WHAT THAT STILL DOES NOT BUY, said plainly because the guard cannot say it: a switch
 * recorded `--scope private` is invisible to that document — it carries the committed record
 * — so on that machine the silence still reads as "nothing addresses this file". And "the
 * hook did not run" is distinguishable from neither. Closing the first would put a fact
 * about one machine into a file that is committed and compared with `diff`; closing the
 * second would take an index of the addressed paths in the opening document, measured at
 * 3,921 bytes for a realistic record.
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
 * typed into `--rel governs`, the id, and the provenance, the last two being callers'
 * strings too since a link's subject and its target both reach the chain without being
 * checked to exist. All of them go through
 * {@link oneLine}, HERE, at the one place a line is built: a name holding a newline
 * would end its own line and start a second one, and the second would read as a rule
 * this project never made, in a text that arrives while code is being written.
 */

import type { PushedRule, RulesAtPath } from '@mnema/copilot';
import { oneLine } from './one-line.js';
import { DERIVED_FROM } from './provenance.js';
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
 * record already says a rule governs in its own voice. That used to be a promise this
 * comment made on its own — a mutation put an imperative here and the only red was the
 * shape assertion the same diff would have updated. It is held now, over every sentence
 * this channel writes rather than over the declaration alone; see {@link ourWordsIn}.
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
  return [...opening(at), ...at.rules.map(ruleLine), ...closing(at)].join('\n');
}

/** What this channel says before the rules: whose text this is, and about which file. */
function opening(at: RulesAtPath): readonly string[] {
  return [recordFramingBlock('edit-rules-push'), addressedAt(at.relative ?? at.path)];
}

/** What it says after them, which is nothing unless one of them does not travel. */
function closing(at: RulesAtPath): readonly string[] {
  return at.rules.every((rule) => rule.travels) ? [] : [ONE_IS_NOT_COMMITTED];
}

/**
 * Every line of a notice that this PRODUCT wrote, as opposed to the record.
 *
 * THE LINE BETWEEN THE TWO VOICES, AND IT IS WHY THIS IS EXPORTED. A pushed text says
 * what the text IS and never what to do about it — but only the half mnema wrote can be
 * held to that. The rule lines carry a name somebody typed into their own record, and a
 * project is free to call a decision "Follow the style guide"; scanning those would make
 * this product an opinion about how other people name their own rules, which is the
 * inverse of the tie.
 *
 * So this returns the product's half and `the-rule-reaches-the-writing.test.ts` runs
 * `record-framing.ts`'s `tellsWhatToDo` over it — over the lines a person composing a new
 * sentence would add to, rather than over a list kept in step by hand. A sentence added
 * to {@link opening} or {@link closing} arrives inside the guard without anybody
 * remembering it, which is the only reason this is composed from the same two functions
 * the notice is.
 */
export function ourWordsIn(at: RulesAtPath): readonly string[] {
  return [...opening(at), ...closing(at)];
}

/**
 * One rule, as one line: what it says, the address that matched, the id, and where the
 * record says the rule came from.
 *
 * The name is in quotes because it is text somebody wrote, and the address follows the
 * relation's own word. The order is the derivation's — most specific first — so the rule
 * that speaks to this file is the first one read.
 *
 * WHY THE PROVENANCE IS LAST, since the id used to be and for a stated reason: the id is
 * "what a reader copies". That was the whole of what a reader could do with this line,
 * and it is what this field changes. An id opens through `read_record` and nothing else;
 * a provenance opens with what the reader is already holding — a file read. So the field
 * a reader ACTS on is the last one, which is where this line has always put it, and the
 * id stays on the line because a charge cites the id and because a target may name
 * an id too.
 *
 * ONE FIELD PER SOURCE, the word repeated rather than the targets joined by a comma: a
 * target is a caller's string and a file name may hold one, so a join would leave a
 * reader unable to tell two sources from one.
 *
 * EVERY VALUE ON IT GOES THROUGH {@link oneLine}, here, including this one — a link's
 * target reaches the chain without being checked, so it is a caller's string on the same
 * terms as the name and the address.
 */
function ruleLine(rule: PushedRule): string {
  const from = (rule.origin ?? [])
    .map((target) => ` · ${DERIVED_FROM} ${oneLine(target)}`)
    .join('');
  return `“${oneLine(rule.name)}” — governs ${oneLine(rule.address)} · ${oneLine(rule.id)}${from}`;
}
