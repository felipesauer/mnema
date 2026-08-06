/**
 * THE CLOSED SETS OF DOMAIN WORDS THE SURFACES TAKE — one source, and BOTH doors read
 * it.
 *
 * An `<action>`, a `--scope`, a `direction`: each takes one word out of a set the DOMAIN
 * owns and a surface only forwards. Both surfaces used to re-type those words — the CLI
 * in twenty-two declarations, the MCP in fourteen tool descriptions and nine `z.enum`
 * arrays — so the day a workflow gained an action, every one of them kept listing the old
 * set and nothing failed. A help that omits a word the gate accepts is worse than a help
 * that says nothing: the reader concludes the word does not exist.
 *
 * THE MCP's COPY WAS WORSE THAN PROSE, AND THAT IS WHY THIS MODULE IS HERE RATHER THAN
 * UNDER `wiring/`. The CLI validates a `--scope` through `parseScope`, which READS the
 * set below; the MCP validated it with `z.enum(['public', 'private', 'global'])` typed by
 * hand, and a `z.enum` does not describe — it ACCEPTS. So a fourth tree added to the
 * domain would have reached the CLI's help, the CLI's Tab and the CLI's refusal, and the
 * MCP would have gone on refusing the word its own product accepts, in the SDK's voice,
 * on the surface agents use. That is not two prose styles drifting; it is two doors
 * accepting different things.
 *
 * WHAT LIVES HERE, AND WHAT DOES NOT. This module is surface-NEUTRAL: the sets, the
 * gloss each scope carries, and the functions that turn a set into a phrase. It imports
 * from the domain and from nothing else — no commander, no zod — which is what lets both
 * surfaces read it without either one reaching into the other. The commander channel
 * (which declaration takes which set, so the shell can complete it) is `wiring/
 * enumerated.ts`, and the zod schemas are `mcp/server.ts`'s own.
 *
 * NOTHING HERE VALIDATES, AND THAT IS MEASURED. commander's `.choices()` would enumerate
 * AND validate, moving ownership of the vocabulary from the gate to the parser: the
 * refusal a CLI caller gets today is the gate's own —
 *
 *     $ mnema task move nonsense <id>
 *     Refused (UNKNOWN_ACTION): "nonsense" is not a workflow action
 *
 * — and `.choices()` would replace it with a usage error about an invalid argument. The
 * MCP is the other way round by the protocol's nature: a tool's input schema IS the
 * contract the client checks against, so `z.enum` there is not a second opinion but the
 * only way to state the set. Both are served by ONE set, which is the whole point.
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
  type ProofField,
  type Scope,
  SEARCH_KINDS,
  SKILL_ACTIONS,
  SKILL_TRANSITIONS,
  TASK_ACTIONS,
  TRANSITIONS,
} from '@mnema/core';

export { DECISION_ACTIONS, LEVEL_REQUIREMENTS, SEARCH_KINDS, SKILL_ACTIONS, TASK_ACTIONS };

// ---------------------------------------------------------------------------
// The prose: a set, as a phrase
// ---------------------------------------------------------------------------

/** `a, b, c` — the members, in the order the machine declares them. */
export function listed(values: readonly string[]): string {
  return values.join(', ');
}

/**
 * `a, b, or c` — the members as a sentence that ENDS at the list.
 *
 * One member is itself, and two are `a, or b`: the comma before a two-member `or` is
 * what the surfaces already printed, and this function was factored out of the glossed
 * version rather than written next to it, so the two cannot disagree about the shape.
 */
export function orListed(values: readonly string[]): string {
  if (values.length < 2) return values.join('');
  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

/** `a and b`, `a, b, and c` — the same list where the sentence CONTINUES past it. */
export function andListed(values: readonly string[]): string {
  if (values.length < 2) return values.join('');
  if (values.length === 2) return values.join(' and ');
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

/**
 * `a/b/c` — the members as one token of a sentence about all of them.
 *
 * The shape a rule reads best in ("block/cancel/reopen need a reason"), where a comma
 * would compete with the commas of the sentence around it.
 */
export function slashed(values: readonly string[]): string {
  return values.join('/');
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
  return orListed(values.map((value) => `${value} (${gloss[value]})`));
}

/** The same, where the sentence continues past the list: `a (why), b (why), c (why)`. */
export function glossedList<T extends string>(
  values: readonly T[],
  gloss: Readonly<Record<T, string>>,
): string {
  return values.map((value) => `${value} (${gloss[value]})`).join(', ');
}

// ---------------------------------------------------------------------------
// The scopes — the surfaces' view of the three trees
// ---------------------------------------------------------------------------

/**
 * What each scope MEANS, in the one phrase both doors print.
 *
 * Keyed by the core's `Scope`, so a fourth tree does not compile until this says what
 * it is — the totality lives here, in `src`, and not in an assertion. It is also the
 * source of {@link SCOPES}: the core exports the type and no ordered tuple, so the key
 * order of this record IS the order the surfaces list them in (insertion order, which
 * the language guarantees for string keys).
 *
 * WHY `private` SAYS TWO THINGS. It used to say `this machine` on the CLI and `this
 * machine, this project` on the MCP, and the second one is the true one: the private
 * tree is `.mnema/private/` INSIDE a project, so a machine with four projects has four
 * private trees and a fact written in one is not in the others. The CLI's shorter wording
 * was not a summary of that, it was a different claim — a reader who had it would expect
 * a private memory to follow them to the next repository. The more precise gloss won on
 * precision and not on age, and the CLI's help changed to it.
 */
const SCOPE_GLOSS: Readonly<Record<Scope, string>> = {
  public: 'team-visible',
  private: 'this machine, this project',
  global: 'personal, cross-project',
};

/** The scopes a `--scope` or a `scope` accepts, in the order every reading prints. */
export const SCOPES = Object.keys(SCOPE_GLOSS) as readonly Scope[];

/**
 * The three scopes with their glosses, as ONE phrase — computed once, at load.
 *
 * A constant and not a function because it takes no argument and both surfaces want the
 * identical bytes: the CLI's seven `--scope` declarations and the MCP's four tool
 * descriptions interpolate THIS, so "the two doors gloss a scope the same way" is true by
 * construction rather than by two people wording it alike.
 */
export const SCOPE_CHOICES = glossedChoice(SCOPES, SCOPE_GLOSS);

// ---------------------------------------------------------------------------
// The workflow actions, and the proof each one needs
// ---------------------------------------------------------------------------

/** The workflows the surfaces move entities through, by the word a caller types. */
export type Workflow = 'task' | 'decision' | 'skill';

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
 * help, and a proof field's tool description, both name.
 *
 * It reads the TABLE, which is the only thing that knows: both surfaces used to say
 * "required by cancel, block, reopen" from memory, and there was nothing anywhere
 * comparing either sentence to the rows the gate enforces. In the vocabulary's own order,
 * so a flag's list and the `<action>` list above it read the same way round — and so the
 * MCP's four sentences about proof read the same way round as the CLI's nine.
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
