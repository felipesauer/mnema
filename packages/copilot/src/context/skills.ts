/**
 * skills: the adopted patterns an agent may actually use.
 *
 * A skill is a distilled way of working, and until now it was write-only — the
 * `body`, which IS the pattern, was projected and never returned to anyone. This
 * is the read that gives it back: the ADOPTED skills, by name for an index and
 * by body on demand.
 *
 * ONLY `adopted`. Proposed, reviewed, rejected and deprecated are states of the
 * process of DECIDING about a pattern, not patterns to work by. Serving a
 * deprecated body would hand an agent a way of working the team retired — the
 * one outcome worse than serving nothing.
 *
 * ACROSS THE TREES the caller can see, not one. A skill is a CAPABILITY, and a
 * capability does not belong to a tree the way a piece of work does: the team's
 * patterns are adopted in the public tree, an agent's own in the private one,
 * and a personal convention in the global one — and all three apply to whatever
 * the agent is doing. This is the deliberate asymmetry with bootstrap's work
 * list, which stays on the actor's single tree because work IS scoped.
 *
 * Reading per-tree projections and concatenating is not an approximation of
 * reading the union: a skill's whole history lands in ONE tree (a move follows
 * the entity), so the per-tree fold and the union fold see the same events for
 * it. Concatenating warm caches is the same answer as replaying every tail, at
 * an indexed lookup instead of a linear scan.
 */

import type { ProjectionCache, SkillProjection, SkillState } from '@mnema/core';

/** The one state whose skills are served — typed, so a typo fails the build. */
const ADOPTED: SkillState = 'adopted';

/** An adopted skill named but not spelled out — what an index is made of. */
export interface SkillRef {
  /** The skill's id — the key that asks for its body. */
  readonly id: string;
  /** The skill's short name — DISPLAY, and the trigger a reader recognizes. */
  readonly name: string;
}

/** An adopted skill with the pattern itself. */
export interface AdoptedSkill extends SkillRef {
  /** The reusable pattern — the whole point of having recorded the skill. */
  readonly body: string;
}

/** Asking for one skill by id: served, present but not adopted, or absent. */
export type SkillLookup =
  /** Adopted here — the body is served. */
  | { readonly outcome: 'adopted'; readonly skill: AdoptedSkill }
  /**
   * A skill with this id exists, but it is not an adopted pattern. The state is
   * reported (never the body), so an agent holding a stale name learns what
   * happened to it rather than being told it never existed.
   */
  | { readonly outcome: 'not-adopted'; readonly state: string }
  /** No tree the caller can see holds a skill with this id. */
  | { readonly outcome: 'unknown' };

/**
 * Every adopted skill across `caches`, with its body, ordered by name (ties
 * broken by id). The order is a property of the CONTENT, not of the tree the
 * skill happens to live in, so adding a tree to the list — or reading them in a
 * different order — never reshuffles the answer. Callers put this in a prompt;
 * a stable order is what keeps the host's cache of that prefix valid.
 */
export function adoptedSkills(caches: readonly ProjectionCache[]): AdoptedSkill[] {
  const all: AdoptedSkill[] = [];
  for (const cache of caches) {
    for (const skill of cache.listSkillsByState(ADOPTED)) all.push(toAdopted(skill));
  }
  return all.sort(byNameThenId);
}

/**
 * Looks one skill up by id across `caches`, reporting whether it is an adopted
 * pattern. The first tree that holds the id answers — an id is minted once and
 * lives in one tree, so there is no second holder to disagree.
 */
export function lookupAdoptedSkill(caches: readonly ProjectionCache[], id: string): SkillLookup {
  for (const cache of caches) {
    const skill = cache.getSkill(id);
    if (skill === null) continue;
    if (skill.state !== ADOPTED) return { outcome: 'not-adopted', state: skill.state };
    return { outcome: 'adopted', skill: toAdopted(skill) };
  }
  return { outcome: 'unknown' };
}

function toAdopted(skill: SkillProjection): AdoptedSkill {
  return { id: skill.id, name: skill.name, body: skill.body };
}

function byNameThenId(a: SkillRef, b: SkillRef): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
