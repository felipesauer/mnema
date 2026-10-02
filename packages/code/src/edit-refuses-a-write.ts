/**
 * What the product says when the record REFUSES a write — the reason a host hands an agent
 * whose file was not written.
 *
 * It is the asking's text one grade up (`edit-asks-a-person.ts`), and it answers to the same
 * tie: the rule is the RECORD's — a decision accepted or a pattern adopted, linked to a path
 * under `refuses-a-write` on purpose — and the text names that rule by id. There is no
 * heuristic here. A refusal that cannot name the fact that caused it does not happen, and
 * {@link editRefusesNotice} has nothing to say without a rule.
 *
 * IT IS FRAMED, for the asking's measured reason: a hook's refusal reason comes back to the
 * session as the result of the refused call, where a model reads it, so it is record text in
 * front of a model and it says whose text it is before anything else.
 *
 * IT SAYS WHERE THE RULE OPENS AND WHO MAY CHANGE IT, and stops there. A reader whose write was
 * refused has no person to ask at the host, so the text names the two facts that are a way out
 * — the command that opens the rule, and that changing it is for whoever recorded it — as
 * statements about the record. It does not name the switch: a refusal that told the agent it
 * refused how to turn refusals off would be this product arguing against its own record.
 *
 * Every value from the record goes through {@link oneLine} here, at the one place a line is
 * built, for the asking's reason: a name holding a newline would end its own line and start a
 * second one, read as a rule this project never made.
 */

import type { PushedRule, RulesAtPath } from '@mnema/copilot';
import { oneLine } from './one-line.js';
import { DERIVED_FROM } from './provenance.js';
import { recordFramingBlock } from './record-framing.js';

/** What the record refuses, and about which file — passive about the record, never addressed to the reader. */
function refusesAtPath(path: string): string {
  return `A rule of this project’s record refuses a write at ${oneLine(path)} while it stands.`;
}

/** The asking's sentence for a rule that does not travel, said once. */
const ONE_IS_NOT_COMMITTED =
  'One of these is not committed to this project, so its id is not in a clone of it.';

/**
 * The text to send as the reason for refusing, or `undefined` when nothing refuses — the
 * silence as one value, so a caller cannot refuse with a blank reason.
 */
export function editRefusesNotice(at: RulesAtPath): string | undefined {
  if (at.rules.length === 0) return undefined;
  return [...opening(at), ...at.rules.map(refuseLine), ...closing(at)].join('\n');
}

/** What this channel says before the rules: whose text this is, and what is refused. */
function opening(at: RulesAtPath): readonly string[] {
  return [recordFramingBlock('edit-refuses-a-write'), refusesAtPath(at.relative ?? at.path)];
}

/** What it says after them: whether one does not travel, and where a rule opens. */
function closing(at: RulesAtPath): readonly string[] {
  return [
    ...(at.rules.every((rule) => rule.travels) ? [] : [ONE_IS_NOT_COMMITTED]),
    wayToTheRule(at.rules),
  ];
}

/**
 * Where the rule opens and who may change it — the one sentence a reader with no person to ask
 * can act on, stated as two facts about the record. With one rule it names the command whole;
 * with several, each line above already carries its id.
 */
function wayToTheRule(rules: readonly PushedRule[]): string {
  const opens =
    rules.length === 1
      ? `The rule opens with \`mnema show ${oneLine((rules[0] as PushedRule).id)}\``
      : 'Each rule opens with `mnema show` and the id on its line';
  return `${opens}; changing it is a decision for whoever recorded it.`;
}

/**
 * Every line of this notice that the PRODUCT wrote, as opposed to the record — composed from
 * the same two functions the notice is, so a sentence added to either is inside the guard that
 * holds them to saying what the text is rather than what to do about it.
 */
export function ourWordsInRefusing(at: RulesAtPath): readonly string[] {
  return [...opening(at), ...closing(at)];
}

/**
 * One rule, as one line: what it says, the address that refused, the id, and where the record
 * says the rule came from. One word differs from the asking's line — `refuses a write at` — so
 * a reader who sees both texts can tell which relation produced which.
 */
function refuseLine(rule: PushedRule): string {
  const from = (rule.origin ?? [])
    .map((target) => ` · ${DERIVED_FROM} ${oneLine(target)}`)
    .join('');
  return `“${oneLine(rule.name)}” — refuses a write at ${oneLine(rule.address)} · ${oneLine(rule.id)}${from}`;
}
