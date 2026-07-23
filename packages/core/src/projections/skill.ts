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
 */

import type { CatalogEvent } from '@mnema/chain';

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
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Folds ordered events into a map of skill id → projection. A skill is projected
 * only when it has BOTH a `skill.created` (existence) and at least one
 * transition (state) — birth emits the two together, so an intact chain always
 * has both; the guard matters only for a truncated tail.
 */
export function projectSkills(events: readonly CatalogEvent[]): Map<string, SkillProjection> {
  const acc = new Map<string, SkillAccumulator>();

  for (const event of events) {
    if (event.kind === 'skill.created') {
      const entry = getOrInit(acc, event.subject);
      entry.name = event.payload.name;
      entry.body = event.payload.body;
      entry.createdAt = event.at;
    } else if (event.kind === 'skill.transitioned') {
      const entry = getOrInit(acc, event.subject);
      entry.state = event.payload.to;
      entry.updatedAt = event.at;
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
    result.set(id, {
      id,
      name: entry.name,
      body: entry.body,
      state: entry.state,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  }
  return result;
}

function getOrInit(acc: Map<string, SkillAccumulator>, id: string): SkillAccumulator {
  let entry = acc.get(id);
  if (entry === undefined) {
    entry = {};
    acc.set(id, entry);
  }
  return entry;
}
