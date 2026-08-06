/**
 * THE COMMANDER CHANNEL over the vocabulary: which declaration takes which closed set,
 * so the help and the shell read one value and neither one twice.
 *
 * The sets themselves, the gloss a scope carries and the functions that turn a set into a
 * phrase are `../vocabulary.ts`, which both surfaces read. What is HERE is the half that
 * only commander has: a `--scope` or an `<action>` is an `Option`/`Argument` object, and
 * something has to know that THIS object takes THAT set — the completion generator asks,
 * and the prose is generated at the same moment so no site can write a member by hand.
 *
 * THE SET IS NOT `.choices()`, AND THAT IS MEASURED, NOT PREFERRED. commander's
 * `.choices()` does two things: it enumerates AND it validates, installing a parser
 * that throws before any action runs. The second one would move ownership of the
 * vocabulary from the gate to the parser, and the refusal a caller gets today is the
 * gate's own:
 *
 *     $ mnema task move nonsense <id>
 *     Refused (UNKNOWN_ACTION): "nonsense" is not a workflow action
 *
 * `UNKNOWN_ACTION` is a typed refusal of the DOMAIN, in the product's voice, and a
 * `.choices()` on `<action>` would make it UNREACHABLE — replaced by a usage error
 * about an invalid argument. So this file enumerates and never validates: the gate
 * keeps the vocabulary, and the help stops being a second copy of it. (`--color` and
 * `completion <shell>` keep their `.choices()`, because their vocabulary belongs to the
 * SURFACE — there is no gate behind them to own it.)
 *
 * THE THIRD READER IS ALREADY HERE. `parseScope` in `options.ts` words the refusal for
 * a bad `--scope` from `SCOPES` — the same tuple the help lists — so the flag's prose,
 * its refusal and its Tab cannot disagree about what a scope is. The FOURTH reader is on
 * the other surface: `mcp/server.ts` builds its `z.enum` from the same value, and there
 * the enumeration IS the validation, which is why the set had to leave this file.
 */

import { DECISION_ACTIONS, type DecisionAction } from '@mnema/core';
import { Argument, Option } from 'commander';
import { listed, SCOPE_CHOICES, SCOPES } from '../vocabulary.js';

export {
  actionsRequiring,
  glossedList,
  LEVEL_REQUIREMENTS,
  listed,
  SCOPES,
  SEARCH_KINDS,
  SKILL_ACTIONS,
  TASK_ACTIONS,
} from '../vocabulary.js';

// ---------------------------------------------------------------------------
// The channel: a declaration says which set it takes
// ---------------------------------------------------------------------------

/**
 * The set each declaration takes, keyed by the object the parser holds.
 *
 * A WeakMap and not a field on the declaration, and not `argChoices`: writing
 * commander's own `argChoices` would make its help print a second list of its own next
 * to the generated prose, and a subclass would only be a field the parser does not read
 * with extra ceremony. The keys are the very Option and Argument instances commander
 * hands back from `visibleOptions` and `registeredArguments`, so a reader that has the
 * declaration has the set.
 */
const ENUMERATED = new WeakMap<Argument | Option, readonly string[]>();

/**
 * The closed set of values `declaration` takes, or empty when it names none.
 *
 * This is the completion generator's way in. Empty is the honest answer for the many
 * declarations that take free text: a `--note` enumerates nothing, and a Tab that
 * offered something there would be inventing it.
 */
export function valuesDeclaredOn(declaration: Argument | Option): readonly string[] {
  return ENUMERATED.get(declaration) ?? [];
}

/**
 * A positional ARGUMENT whose value is one of `values`, with the list generated into
 * its help: `<lead> (a, b, c)`.
 *
 * The parenthesis and the list belong to this function, so no site writes a member —
 * which is what makes "the help lists the domain's set" true by construction rather
 * than by review. `values` is stored as GIVEN, not copied: two declarations that read
 * one constant hold the same array, and `one-source-for-a-vocabulary.test.ts` asserts
 * that identity for `task move` and `guard`.
 */
export function enumeratedArgument(
  name: string,
  lead: string,
  values: readonly string[],
): Argument {
  const argument = new Argument(name, `${lead} (${listed(values)})`);
  ENUMERATED.set(argument, values);
  return argument;
}

/**
 * An OPTION whose value is one of `values`.
 *
 * The description arrives whole rather than as a lead, because each of these sentences
 * continues differently after its list — one names a default, one says which tree an
 * omission picks — and a template with four holes would be harder to read than the
 * sentence. What keeps the two halves from drifting is not this signature: the guard
 * asserts every member of `values` appears in the description of every declaration
 * registered here, so a list built from another set, or a member typed by hand and then
 * removed from the set, is red.
 */
export function enumeratedOption(
  flags: string,
  description: string,
  values: readonly string[],
): Option {
  const option = new Option(flags, description);
  ENUMERATED.set(option, values);
  return option;
}

// ---------------------------------------------------------------------------
// The declarations that need more than a list
// ---------------------------------------------------------------------------

/**
 * The `--scope` help for a BIRTH, one wording on all seven verbs that take one.
 *
 * `what` is the noun ("task", "observation"); `tail` is the sentence about where an
 * omitted flag lands, which is the verb's own and differs — the kind decides the tree,
 * so each verb states its own default rather than one wording claiming a rule that is
 * false on five of them.
 *
 * The glossed list is {@link SCOPE_CHOICES}, the same constant the MCP's four tool
 * descriptions interpolate: one phrase, so the two doors cannot tell a reader different
 * things about what a private tree is.
 */
export function scopeOption(what: string, tail: string): Option {
  return enumeratedOption(
    '--scope <scope>',
    `where the ${what} is born: ${SCOPE_CHOICES}. ${tail}`,
    SCOPES,
  );
}

/**
 * The actions `decision move` offers: the decision vocabulary MINUS the ones that have
 * a verb of their own.
 *
 * `supersede` needs the successor's id, which the generic `move <action> <id>` form has
 * nowhere to take, so it is `mnema decision supersede <old> <new>` instead. Deriving
 * the offer by exclusion rather than typing "accept, reject" keeps the promise the
 * vocabulary is for: a fourth decision action arrives in this help by itself.
 *
 * It lives on THIS side of the split, not in `../vocabulary.ts`, because it is a fact
 * about how the CLI lays its verbs out and about nothing else: the MCP has one
 * `decision_transition` tool that takes all three actions, so a set named "what the
 * generic move offers" would be false on that surface.
 *
 * The exclusion is TYPED, so a rename in the core breaks here rather than quietly
 * offering a word the move cannot take. It is also narrower than what the adapter
 * accepts, deliberately: `decision move supersede <id>` is not refused as an unknown
 * action — it reaches the gate and is refused for the successor it has no way to name.
 */
const MOVE_HAS_ITS_OWN_VERB: readonly DecisionAction[] = ['supersede'];

/** The decision actions the generic `decision move` offers. */
export const DECISION_MOVE_ACTIONS: readonly string[] = DECISION_ACTIONS.filter(
  (action) => !MOVE_HAS_ITS_OWN_VERB.includes(action),
);
