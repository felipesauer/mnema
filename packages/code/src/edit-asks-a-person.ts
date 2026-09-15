/**
 * What the product says when the record asks that a PERSON look before a file is
 * written — the first thing mnema has ever said that stops somebody.
 *
 * Everything upstream of this module informs. The document a session opens with, the
 * patterns a tool answers, the rules handed over as a file is about to change: all of them
 * hand over text and the reader does what they like with it. This one is different in kind,
 * and the difference is not a matter of degree — the text below comes back as the RESULT of
 * a refused call, and until somebody decides, the file is not written.
 *
 * ## What it is allowed to be, and the tie it answers to
 *
 * The rule is the RECORD's. It is a decision that was accepted or a pattern that was
 * adopted, somebody linked it to a path on purpose, and the text names that rule by id.
 * There is no heuristic here — no "sensitive file", no inference from a path, no reading of
 * what the code says. A charge that cannot name the fact that caused it does not happen,
 * and the shape of {@link editAsksNotice} is what makes that structural: it is handed rules
 * and it has nothing to say without one.
 *
 * ## Why the text is FRAMED, which is the half a reader would not guess
 *
 * A refusal reason looks like a diagnostic and is not one. Measured against the real host:
 * `permissionDecisionReason` comes back to the session as the tool result of the refused
 * call, byte for byte, marked as an error
 * (`measurements/asks-a-person/results/2026-08-19/the-door-exists.json`). So it is text
 * this product pushes at a model, on the same channel class as everything else it pushes,
 * carrying a rule NAME somebody typed into their own record — which makes it the same
 * prompt-injection surface, with the same answer: it says what it is, in the record's
 * declaration, before it says anything else.
 *
 * ## It says what the record asks and never what to do about it
 *
 * The hardest sentence in this module is the one that is not here. A reader whose write just
 * stopped is the reader most likely to be handed an instruction — "get an approval",
 * "record an ADR first", "ask your lead" — and every one of those is this product having an
 * opinion about how somebody else's team works. What the text does is name the path, name
 * the rules, and stop. `the-record-asks-for-a-person.test.ts` runs `record-framing.ts`'s
 * `tellsWhatToDo` over {@link ourWordsInAsking}, which is composed from the same functions
 * the notice is, so a sentence added here arrives inside the guard without anybody
 * remembering it.
 *
 * ## Every value on a line came out of the record, so every one is ONE line
 *
 * The rule's name, the address somebody typed, the id, and the provenance — a link's
 * subject and its target both reach the chain without being checked to exist, so all of
 * them are callers' strings. They go through
 * {@link oneLine} HERE, at the one place a line is built. A name holding a newline would end
 * its own line and start a second one, and on this channel the second line would read as a
 * rule this project never made, in the text explaining why somebody's work stopped.
 */

import type { PushedRule, RulesAtPath } from '@mnema/copilot';
import { oneLine } from './one-line.js';
import { DERIVED_FROM } from './provenance.js';
import { recordFramingBlock } from './record-framing.js';

/**
 * What the record asks, and about which file — the one sentence this channel adds over
 * the framing.
 *
 * It is in the PASSIVE VOICE about the record and not about the reader, and that is the
 * whole care in the wording. "A rule of this project asks that a person look at X" states
 * what a signed fact says; anything addressed to the reader — even "wait for a person" —
 * would be this product instructing somebody about their own work, which is the line
 * `record-framing.ts` exists to hold. The path is named as the record COMPARED it rather
 * than as the host spelled it, so the sentence and the addresses below are in one spelling.
 */
function asksAboutPath(path: string): string {
  return `A rule of this project’s record asks that a person look at ${oneLine(path)} before it is written.`;
}

/**
 * What it says after the rules, which is nothing unless one of them does not travel.
 *
 * A gate whose rule lives outside the committed tree is the sharpest case this channel has.
 * On the informing channel a private rule is a citation a teammate cannot open; here it is a
 * STOP a teammate cannot explain, so the notice says so — once, when at least one of them is
 * that way, for the same reason the other channel says it once.
 */
const ONE_IS_NOT_COMMITTED =
  'One of these is not committed to this project, so its id is not in a clone of it.';

/**
 * The text to send as the reason for asking, or `undefined` when nothing asks.
 *
 * `undefined` is the ordinary case and it is the SILENCE, one value rather than an empty
 * string, so the caller has to decide what silence means on its channel — on this one it is
 * a reply carrying no permission decision at all, which is not the same thing as asking with
 * a blank reason. The host would accept the blank one: it takes any string, so a charge with
 * nothing to say would stop the write and hand the model an empty error, which is precisely
 * the charge the axis's first tie forbids.
 */
export function editAsksNotice(at: RulesAtPath): string | undefined {
  if (at.rules.length === 0) return undefined;
  return [...opening(at), ...at.rules.map(askLine), ...closing(at)].join('\n');
}

/** What this channel says before the rules: whose text this is, and what is being asked. */
function opening(at: RulesAtPath): readonly string[] {
  return [recordFramingBlock('edit-asks-a-person'), asksAboutPath(at.relative ?? at.path)];
}

/** What it says after them. */
function closing(at: RulesAtPath): readonly string[] {
  return at.rules.every((rule) => rule.travels) ? [] : [ONE_IS_NOT_COMMITTED];
}

/**
 * Every line of this notice that the PRODUCT wrote, as opposed to the record.
 *
 * Exported for the same reason its twin on the informing channel is: only the half mnema
 * wrote can be held to saying what the text is rather than what to do about it. The rule
 * lines carry a name somebody typed into their own record, and a project is free to call a
 * decision "Follow the style guide" — scanning those would make this product an opinion
 * about how other people name their own rules, which is the inverse of the tie.
 *
 * It is composed from the same two functions the notice is, so a sentence added to
 * {@link opening} or {@link closing} is inside the guard without anybody remembering it.
 */
export function ourWordsInAsking(at: RulesAtPath): readonly string[] {
  return [...opening(at), ...closing(at)];
}

/**
 * One rule, as one line: what it says, the address that asked, the id, and where the
 * record says the rule came from.
 *
 * The words differ from the informing channel's by one — `asks for a person at` where that
 * one says `governs` — and the difference is the relation's own label rather than a
 * flourish: a reader who sees both channels in one session must be able to tell which fact
 * produced which text, and the relation is the only thing that separates them.
 *
 * THE PROVENANCE IS LAST, AND THIS IS THE CHANNEL THAT MOST NEEDED IT. This module was not
 * named by the item that put the fact on the two channels that inform; it was found by
 * asking which sites carry a {@link PushedRule}, and it is the sharpest of the three. The
 * reader of this text has had their write STOPPED, and what they are handed to act on is a
 * name somebody typed and a uuid that opens through one tool. The id is still here — it is
 * what somebody supersedes, removes or argues with to get their afternoon back, and a
 * charge that cannot name the fact that caused it does not happen — but a person who wants
 * to read the ARGUMENT before arguing can now open a file instead of asking for one.
 *
 * ONE FIELD PER SOURCE, the word repeated rather than the targets joined by a comma, for
 * the reason the informing channel gives: a file name may hold a comma.
 *
 * It goes through {@link oneLine} with the rest, on the same terms: a link's target is a
 * caller's string, and on THIS channel a second line would read as a rule this project
 * never made, inside the text explaining why somebody's work stopped.
 */
function askLine(rule: PushedRule): string {
  const from = (rule.origin ?? [])
    .map((target) => ` · ${DERIVED_FROM} ${oneLine(target)}`)
    .join('');
  return `“${oneLine(rule.name)}” — asks for a person at ${oneLine(rule.address)} · ${oneLine(rule.id)}${from}`;
}
