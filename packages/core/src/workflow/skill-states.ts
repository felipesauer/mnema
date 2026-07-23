/**
 * The skill workflow's states, fixed in typed code.
 *
 * Like the task and decision workflows, this is the product's one opinion about
 * how a skill moves — not data loaded from a project file. States are stored on
 * events as literal strings, never pointers into this table, so a fact written
 * today stays legible even if the workflow later grows or drops a state. This
 * module only NAMES the states; the legal moves live in the transition table.
 *
 * A skill is a reusable pattern of work. It is proposed, then reviewed, then
 * adopted as a live pattern or rejected; an adopted skill may later be
 * deprecated when it falls out of use. The machine is DISTINCT from a decision's
 * (proposed/accepted/rejected/superseded): a skill has an intermediate
 * `reviewed` state a decision does not, and a `deprecated` — "was adopted, now
 * out of use" — that is not the same as `rejected` ("never adopted"). There is
 * no reopening: `rejected` and `deprecated` are terminal, and a skill that fell
 * out of use is replaced by a new one (a `knowledge.linked` supersedes edge),
 * never revived.
 */

/** The five states a skill can be in. */
export const SKILL_STATES = ['proposed', 'reviewed', 'adopted', 'rejected', 'deprecated'] as const;

/** A skill's state — one of the five, as a literal string. */
export type SkillState = (typeof SKILL_STATES)[number];

/** The state every skill is born into. */
export const INITIAL_SKILL_STATE: SkillState = 'proposed';

/** True when `value` is one of the workflow's states. */
export function isSkillState(value: string): value is SkillState {
  return (SKILL_STATES as readonly string[]).includes(value);
}
