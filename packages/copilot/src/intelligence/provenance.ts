/**
 * Where a pattern came from: the two acts behind every skill in the record.
 *
 * A skill is the one thing in this product whose content comes back as
 * INSTRUCTION — its body is served into the prompt of every session that reaches
 * the tree it was adopted in. Two acts put it there: someone proposed it, and
 * someone adopted it. Until this read, neither was visible to anyone. A task's
 * movers ride the events a timeline shows; a decision's do too. A served body
 * carried nothing, so a pattern that one agent proposed and adopted in the same
 * session looked exactly like a pattern the team agreed on.
 *
 * This is the reading for a PERSON, and that is why it lives here with the other
 * intelligence reads rather than in the context an agent gets. The agent that
 * receives a body gets the one fact that frames it (who adopted it); judging
 * whether a pattern deserves to be a pattern needs context an agent in the middle
 * of a task does not have, and a full account in a prompt is metadata crowding out
 * the pattern it describes.
 *
 * It REPORTS, it does not grade. An agent adopting its own proposal is a legal act
 * of this workflow — nothing here calls it wrong, and `selfAdopted` is a
 * comparison of two names, not a verdict. What a reader does with it is theirs.
 *
 * EVERY state, not just the adopted ones. The serving read is narrow on purpose
 * (a deprecated body is a way of working the team retired); an audit is not — the
 * curation backlog is part of where the patterns came from, and a rejected
 * proposal is a fact about the record too.
 */

import type { Scope, SkillAdoption } from '@mnema/core';
import type { ScopedCache } from '../sources.js';

/** One skill, with the provenance of the two acts that shaped it. */
export interface PatternProvenance {
  /** The skill's id — the key `show` takes to read the body itself. */
  readonly id: string;
  /** The skill's short name. */
  readonly name: string;
  /** Its current state: `adopted` is live, the rest are not served. */
  readonly state: string;
  /**
   * The tree it lives in — part of where it came from, not decoration. An adopted
   * pattern in `private` reaches every agent on this machine's project, one in
   * `global` reaches every project on the machine, and one in `public` reaches
   * every machine that clones the repository.
   */
  readonly scope: Scope;
  /** The agent that proposed it; ABSENT means a person recorded it directly. */
  readonly proposedBy?: string;
  /** The adoption, when it has one: when, and the agent — absent, a person. */
  readonly adoption?: SkillAdoption;
  /**
   * True when ONE NAMED AGENT stands on both ends — it proposed the pattern and
   * it adopted it.
   *
   * False when no agent is named on both ends, and that includes two absences: a
   * person proposed and a person adopted proves nothing about them being the same
   * person, because a tree can hold the facts of more than one anchor. It is a
   * comparison of two agent names and claims nothing beyond that.
   */
  readonly selfAdopted: boolean;
}

/**
 * Every skill across `sources`, with its provenance, ordered by name (ties broken
 * by id). Same stable-output rule the serving read follows: the order is a
 * property of the CONTENT, so adding a tree to the list — or reading them in a
 * different order — never reshuffles the answer.
 */
export function patternProvenance(sources: readonly ScopedCache[]): PatternProvenance[] {
  const all: PatternProvenance[] = [];
  for (const source of sources) {
    for (const skill of source.cache.listSkills()) {
      const { proposedBy, adoption } = skill;
      all.push({
        id: skill.id,
        name: skill.name,
        state: skill.state,
        scope: source.scope,
        // The two acts, then the comparison of the two — the order a reader
        // follows them in, which is the order they are written in.
        ...(proposedBy !== undefined ? { proposedBy } : {}),
        ...(adoption !== undefined ? { adoption } : {}),
        selfAdopted: proposedBy !== undefined && adoption?.by === proposedBy,
      });
    }
  }
  return all.sort(byNameThenId);
}

function byNameThenId(a: PatternProvenance, b: PatternProvenance): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
