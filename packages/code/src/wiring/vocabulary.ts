/**
 * THE CLOSED SETS OF DOMAIN WORDS THIS SURFACE TAKES — one source, read by the help
 * and by the shell, and by neither one twice.
 *
 * An `<action>`, a `--scope`, a `--require`: each takes one word out of a set the
 * DOMAIN owns and this surface only forwards. The help used to re-type those words —
 * twenty-two declarations spelling out lists the machine already holds — so the day a
 * workflow gained an action, the help kept listing ten of eleven and nothing failed. A
 * help that omits a word the gate accepts is worse than a help that says nothing: the
 * reader concludes the word does not exist.
 *
 * So a declaration NAMES its set here, and the two readers downstream read the same
 * value: the prose commander prints (built by the functions below, never typed at the
 * site) and the words a Tab offers (`completion/tree.ts`, through
 * {@link valuesDeclaredOn}). Nothing else has to be remembered — which is the whole
 * point, because remembering is what failed.
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
 * a bad `--scope` from {@link SCOPES} — the same tuple the help lists — so the flag's
 * prose, its refusal and its Tab cannot disagree about what a scope is.
 *
 * WHAT IT COSTS THE FLOOR: the sets are values, so this module loads the domain while
 * commander is still being built. It is declared in
 * `the-floor-is-the-declaration.test.ts`, and it is free today — `wiring/options.ts`
 * already holds `@mnema/core` open for `--which`'s parser, and `pinned-run.ts` holds
 * `@mnema/chain`. Measured before and after: no change to `mnema --version`.
 */

import { LEVEL_REQUIREMENTS } from '@mnema/chain';
import {
  DECISION_ACTIONS,
  DECISION_TRANSITIONS,
  type DecisionAction,
  type ProofField,
  type Scope,
  SEARCH_KINDS,
  SKILL_ACTIONS,
  SKILL_TRANSITIONS,
  TASK_ACTIONS,
  TRANSITIONS,
} from '@mnema/core';
import { Argument, Option } from 'commander';

export { LEVEL_REQUIREMENTS, SEARCH_KINDS, SKILL_ACTIONS, TASK_ACTIONS };

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
// The prose
// ---------------------------------------------------------------------------

/** `a, b, c` — the members, in the order the machine declares them. */
export function listed(values: readonly string[]): string {
  return values.join(', ');
}

/**
 * `a (why), b (why), or c (why)` — every member with its one-phrase gloss, as a
 * sentence that ENDS at the list.
 *
 * The gloss is a total record over the set's own type, which is what makes a value
 * added to the domain a COMPILE error here instead of a silent omission in the help.
 */
export function glossedChoice<T extends string>(
  values: readonly T[],
  gloss: Readonly<Record<T, string>>,
): string {
  const glossed = values.map((value) => `${value} (${gloss[value]})`);
  if (glossed.length < 2) return glossed.join('');
  return `${glossed.slice(0, -1).join(', ')}, or ${glossed[glossed.length - 1]}`;
}

/** The same, where the sentence continues past the list: `a (why), b (why), c (why)`. */
export function glossedList<T extends string>(
  values: readonly T[],
  gloss: Readonly<Record<T, string>>,
): string {
  return values.map((value) => `${value} (${gloss[value]})`).join(', ');
}

// ---------------------------------------------------------------------------
// The scopes — the surface's view of the three trees
// ---------------------------------------------------------------------------

/**
 * What each scope MEANS, in the one phrase every `--scope` prints.
 *
 * Keyed by the core's `Scope`, so a fourth tree does not compile until this says what
 * it is — the totality lives here, in `src`, and not in an assertion. It is also the
 * source of {@link SCOPES}: the core exports the type and no ordered tuple, so the key
 * order of this record IS the order the surface lists them in (insertion order, which
 * the language guarantees for string keys).
 */
const SCOPE_GLOSS: Readonly<Record<Scope, string>> = {
  public: 'team-visible',
  private: 'this machine',
  global: 'personal, cross-project',
};

/** The scopes `--scope` accepts, in the order every reading of them prints. */
export const SCOPES = Object.keys(SCOPE_GLOSS) as readonly Scope[];

/**
 * The `--scope` help for a BIRTH, one wording on all seven verbs that take one.
 *
 * `what` is the noun ("task", "observation"); `tail` is the sentence about where an
 * omitted flag lands, which is the verb's own and differs — the kind decides the tree,
 * so each verb states its own default rather than one wording claiming a rule that is
 * false on five of them.
 */
export function scopeOption(what: string, tail: string): Option {
  return enumeratedOption(
    '--scope <scope>',
    `where the ${what} is born: ${glossedChoice(SCOPES, SCOPE_GLOSS)}. ${tail}`,
    SCOPES,
  );
}

// ---------------------------------------------------------------------------
// The workflow actions, and the proof each one needs
// ---------------------------------------------------------------------------

/** The workflows this surface moves entities through, by the word a caller types. */
type Workflow = 'task' | 'decision' | 'skill';

/** One workflow's vocabulary and the table that says what each of its actions needs. */
interface WorkflowVocabulary {
  readonly actions: readonly string[];
  readonly transitions: readonly {
    readonly action: string;
    readonly requires: readonly ProofField[];
  }[];
}

/**
 * Every workflow, its vocabulary and its table — total over {@link Workflow}, so a
 * fourth kind of move cannot be wired to a help that reads another one's table.
 */
const WORKFLOWS: Readonly<Record<Workflow, WorkflowVocabulary>> = {
  task: { actions: TASK_ACTIONS, transitions: TRANSITIONS },
  decision: { actions: DECISION_ACTIONS, transitions: DECISION_TRANSITIONS },
  skill: { actions: SKILL_ACTIONS, transitions: SKILL_TRANSITIONS },
};

/**
 * The actions of `workflow` that cannot move without `field` — the list a proof flag's
 * help names.
 *
 * It reads the TABLE, which is the only thing that knows: the help used to say "required
 * by cancel, block, reopen" from memory, and there was nothing anywhere comparing that
 * sentence to the rows the gate enforces. In the vocabulary's own order, so the flag's
 * list and the `<action>` list above it read the same way round.
 *
 * An action legal from several states appears ONCE. It also assumes every row for one
 * action requires the same fields — true of all three tables, and asserted, because a
 * workflow where `cancel` needed a reason from one state and not another could not be
 * described by this sentence at all.
 */
export function actionsRequiring(workflow: Workflow, field: ProofField): readonly string[] {
  const { actions, transitions } = WORKFLOWS[workflow];
  return actions.filter((action) =>
    transitions.some((row) => row.action === action && row.requires.includes(field)),
  );
}

/**
 * The actions `decision move` offers: the decision vocabulary MINUS the ones that have
 * a verb of their own.
 *
 * `supersede` needs the successor's id, which the generic `move <action> <id>` form has
 * nowhere to take, so it is `mnema decision supersede <old> <new>` instead. Deriving
 * the offer by exclusion rather than typing "accept, reject" keeps the promise the file
 * is for: a fourth decision action arrives in this help by itself.
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
