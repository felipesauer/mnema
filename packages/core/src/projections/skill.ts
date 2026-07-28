/**
 * The skill projection: fold an ordered event stream into current skill state.
 *
 * Like every projection this is a pure, deterministic replay — no validation, no
 * re-judging; it replays facts the gate already judged at write time. The rule
 * mirrors tasks and decisions:
 *   - a skill EXISTS once its `skill.created` is seen;
 *   - its STATE is the `to` of its last `skill.transitioned` (birth included);
 *   - its name and body are read literally from the record.
 *
 * A skill is NOT relational — there is no supersede, no `by`, none of the
 * two-sided link a decision's supersede folds. It is the simplest of the three
 * workflow projections: existence plus state, nothing more. Because state is
 * read from the literal `to`, never derived from a workflow, replaying old facts
 * yields the state that happened, not one re-derived from today's rules.
 *
 * IT ALSO FOLDS PROVENANCE — who proposed the pattern and who adopted it — and
 * that is the one thing it keeps beyond existence and state. A skill is the only
 * entity whose content comes back as INSTRUCTION: its body is served into the
 * prompt of every session that reaches the tree it was adopted in. For a task or
 * a decision, whoever consumes the fact can already see who moved it — both
 * `which` values ride the events a timeline shows. For a skill nobody could:
 * the body was served with no trace of the two acts that put it there. Folding
 * the two envelopes here is what makes the consumption visible, and the fold is
 * the only place both events are already in hand.
 *
 * An ABSENT actor is a fact, not a gap: `which` is present when an agent
 * executed the act and absent when a person acted directly (see the envelope's
 * three identities). The fold never fabricates a value for it.
 */

import type { CatalogEvent } from '@mnema/chain';

/** The state whose transition marks a pattern as live — the one adoption. */
const ADOPTED = 'adopted';

/**
 * The act that made a pattern live: when it happened and who did it.
 *
 * The object's PRESENCE is the answer to "was it ever adopted", which is why the
 * instant is here and not a flag: `by` alone could not tell a pattern adopted by
 * a person from one nobody has adopted, and those are different facts about a
 * pattern that is being served.
 *
 * It happens at most once. The workflow reaches `adopted` only from `reviewed`,
 * and leaves it only for the terminal `deprecated` — there is no reopen, so
 * there is no "latest adoption" to resolve. Should a later workflow ever allow
 * one, the fold takes the last, which is the rule `state` already follows.
 */
export interface SkillAdoption {
  /** `at` of the transition into `adopted`. */
  readonly at: string;
  /** The agent that adopted it; ABSENT means a person adopted it directly. */
  readonly by?: string;
}

/** Current projected state of one skill. */
export interface SkillProjection {
  /** The skill's id (the event subject). */
  readonly id: string;
  /** The short title of the pattern. */
  readonly name: string;
  /** The reusable pattern itself. */
  readonly body: string;
  /** The `to` of the last transition. */
  readonly state: string;
  /** The agent that proposed it; ABSENT means a person recorded it directly. */
  readonly proposedBy?: string;
  /** The adoption, when the pattern has one; absent until it is adopted. */
  readonly adoption?: SkillAdoption;
  /** `at` of the record (skill.created). */
  readonly createdAt: string;
  /** `at` of the last transition. */
  readonly updatedAt: string;
}

/** Mutable accumulator; existence and state are tracked separately, then joined. */
interface SkillAccumulator {
  name?: string;
  body?: string;
  state?: string;
  proposedBy?: string;
  adoption?: SkillAdoption;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Folds ordered events into a map of skill id → projection. A skill is projected
 * only when it has BOTH a `skill.created` (existence) and at least one
 * transition (state) — birth emits the two together, so an intact chain always
 * has both; the guard matters only for a truncated tail.
 *
 * The two provenance fields come off the ENVELOPE of those same events: the
 * record's `which` proposed the pattern, and the `which` of the transition that
 * reached `adopted` adopted it. Nothing is derived from the workflow table — the
 * fold recognizes the adoption by the literal `to`, exactly as it reads state.
 */
export function projectSkills(events: readonly CatalogEvent[]): Map<string, SkillProjection> {
  const acc = new Map<string, SkillAccumulator>();

  for (const event of events) {
    if (event.kind === 'skill.created') {
      const entry = getOrInit(acc, event.subject);
      entry.name = event.payload.name;
      entry.body = event.payload.body;
      entry.createdAt = event.at;
      if (event.which !== undefined) entry.proposedBy = event.which;
    } else if (event.kind === 'skill.transitioned') {
      const entry = getOrInit(acc, event.subject);
      entry.state = event.payload.to;
      entry.updatedAt = event.at;
      if (event.payload.to === ADOPTED) {
        entry.adoption =
          event.which === undefined ? { at: event.at } : { at: event.at, by: event.which };
      }
    }
  }

  const result = new Map<string, SkillProjection>();
  for (const [id, entry] of acc) {
    // Existence needs the record; state needs a transition. A subject missing
    // either is not a complete skill and is not projected — never given a
    // fabricated state.
    if (
      entry.name === undefined ||
      entry.body === undefined ||
      entry.state === undefined ||
      entry.createdAt === undefined ||
      entry.updatedAt === undefined
    ) {
      continue;
    }
    const projection: Mutable<SkillProjection> = {
      id,
      name: entry.name,
      body: entry.body,
      state: entry.state,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
    // Set only when the record holds one: an absent actor is "a person acted
    // directly", and a key holding `undefined` would read as a missing value.
    if (entry.proposedBy !== undefined) projection.proposedBy = entry.proposedBy;
    if (entry.adoption !== undefined) projection.adoption = entry.adoption;
    result.set(id, projection);
  }
  return result;
}

/** Local helper: build the readonly projection through a mutable shape. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function getOrInit(acc: Map<string, SkillAccumulator>, id: string): SkillAccumulator {
  let entry = acc.get(id);
  if (entry === undefined) {
    entry = {};
    acc.set(id, entry);
  }
  return entry;
}
