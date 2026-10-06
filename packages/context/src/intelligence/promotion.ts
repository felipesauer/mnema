/**
 * samePattern: which rules are, word for word, the same rule in more than one project.
 *
 * A pattern is worth lifting to the machine-global tree when it has been written down, and
 * put in force, in more than one repository: that is evidence and not a guess. This is the
 * ONE function that says so. The listing (`mnema promote --workspace`) asks it for the
 * candidates and the write (`mnema promote <id> --evidence …`) asks it before it appends
 * anything, so what the first shows is exactly what the second accepts.
 *
 * ## What counts as the same
 *
 * The CONTENT, compared after NFC, trim and collapsed runs of whitespace and after nothing
 * else: a skill is its name and body, a decision its title and rationale. An id cannot
 * decide it (an id is minted once in one tree), a title alone promotes a name rather than a
 * practice, and an address is relative to a repository. Equal content is the one criterion
 * where "it appears in two projects" is proof. The price is a missed candidate when one copy
 * was edited, and the person can always write to the global tree by hand.
 *
 * ## What counts as an instance
 *
 * Only an instance IN FORCE (an accepted decision, an adopted pattern — asked of the two
 * derivations that already decide it, never restated here), and only one in a PUBLIC tree.
 * That filter is in this function and nowhere else, and it is the privacy boundary: a copy
 * lands in the global tree, which every project on the machine reads, so a private tree can
 * neither count as evidence nor be cited. The global tree is read for a single purpose — to
 * see that the same content is already there.
 */

import type { ProjectionCache } from '@mnema/core';
import { decisionsInForce } from '../context/decisions.js';
import { adoptedSkills } from '../context/skills.js';
import type { ScopedCache } from '../sources.js';

/** One place a pattern is written down: the project, and the id there. */
export interface PatternInstance {
  readonly project: string;
  readonly id: string;
}

/** A pattern that is in force, with the same words, in the committed trees of 2+ projects. */
export interface PromotionCandidate {
  readonly kind: 'skill' | 'decision';
  /** The skill's name or the decision's title, as the first instance wrote it. */
  readonly title: string;
  /** The skill's body or the decision's rationale, as the first instance wrote it. */
  readonly body: string;
  /** A decision's alternatives, when the first instance recorded any. */
  readonly alternatives?: string;
  /** Where it is in force, by project then id. */
  readonly instances: readonly PatternInstance[];
}

/** Why a set of cited ids is not a promotion. */
export type PromotionRefusal =
  /** An id is not an in-force instance in a committed tree of the project it was cited under. */
  | 'UNKNOWN_INSTANCE'
  /** The cited ids span fewer than two projects. */
  | 'ONE_PROJECT'
  /** The cited instances do not say the same thing. */
  | 'NOT_THE_SAME'
  /** The global tree already holds the same content. */
  | 'ALREADY_GLOBAL'
  /** The reading does not list this set (the catch-all that keeps the two readings one). */
  | 'NOT_A_CANDIDATE';

/** The answer to "may these ids be promoted?". */
export type PromotionJudgement =
  | { readonly ok: true; readonly candidate: PromotionCandidate }
  | { readonly ok: false; readonly reason: PromotionRefusal; readonly detail: string };

interface Instance extends PatternInstance {
  readonly kind: 'skill' | 'decision';
  readonly title: string;
  readonly body: string;
  readonly alternatives?: string;
}

const normalized = (text: string): string => text.normalize('NFC').trim().replace(/\s+/g, ' ');

const sameWords = (i: { kind: string; title: string; body: string }): string =>
  `${i.kind}\u0000${normalized(i.title)}\u0000${normalized(i.body)}`;

/** The instances in force in ONE cache, as a project's. */
function inForce(project: string, cache: ProjectionCache): Instance[] {
  const found: Instance[] = adoptedSkills([cache]).map((skill) => ({
    kind: 'skill',
    project,
    id: skill.id,
    title: skill.name,
    body: skill.body,
  }));
  for (const rule of decisionsInForce([cache])) {
    const decision = cache.getDecision(rule.id);
    if (decision === null) continue;
    found.push({
      kind: 'decision',
      project,
      id: decision.id,
      title: decision.title,
      body: decision.rationale,
      ...(decision.alternatives !== undefined ? { alternatives: decision.alternatives } : {}),
    });
  }
  return found;
}

/** Every in-force instance of the PUBLIC trees that belong to a project. */
function publicInstances(sources: readonly ScopedCache[]): Instance[] {
  return sources
    .filter((source) => source.scope === 'public' && source.project !== undefined)
    .flatMap((source) => inForce(source.project as string, source.cache));
}

/** The words already in the machine-global tree, in ANY state. */
function globalWords(sources: readonly ScopedCache[]): ReadonlySet<string> {
  const held = new Set<string>();
  for (const source of sources) {
    if (source.scope !== 'global') continue;
    for (const skill of source.cache.listSkills()) {
      held.add(sameWords({ kind: 'skill', title: skill.name, body: skill.body }));
    }
    for (const decision of source.cache.listDecisions()) {
      held.add(sameWords({ kind: 'decision', title: decision.title, body: decision.rationale }));
    }
  }
  return held;
}

function byProjectThenId(a: PatternInstance, b: PatternInstance): number {
  if (a.project !== b.project) return a.project < b.project ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * The patterns in force, with the same words, in the committed trees of two or more
 * projects, and not yet in the global tree. Ordered by title, then kind, so the answer
 * does not depend on the order the projects were named.
 */
export function samePattern(sources: readonly ScopedCache[]): PromotionCandidate[] {
  const already = globalWords(sources);
  const groups = new Map<string, Instance[]>();
  for (const instance of publicInstances(sources)) {
    const key = sameWords(instance);
    if (already.has(key)) continue;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [instance]);
    else group.push(instance);
  }
  const candidates: PromotionCandidate[] = [];
  for (const group of groups.values()) {
    if (new Set(group.map((i) => i.project)).size < 2) continue;
    const instances = [...group].sort(byProjectThenId);
    const first = instances[0] as Instance;
    candidates.push({
      kind: first.kind,
      title: first.title,
      body: first.body,
      ...(first.alternatives !== undefined ? { alternatives: first.alternatives } : {}),
      instances: instances.map(({ project, id }) => ({ project, id })),
    });
  }
  return candidates.sort(
    (a, b) =>
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
}

/**
 * Whether the ids a person cites are a promotion — the same reading as {@link samePattern},
 * asked about a set. It says WHICH way a set fails, in the order a person would fix it, and
 * accepts only what {@link samePattern} lists: the last step is the list itself, so the two
 * cannot come to disagree.
 */
export function judgePromotion(
  sources: readonly ScopedCache[],
  cited: readonly PatternInstance[],
): PromotionJudgement {
  const known = publicInstances(sources);
  const found: Instance[] = [];
  for (const one of cited) {
    const instance = known.find((k) => k.project === one.project && k.id === one.id);
    if (instance === undefined) {
      return {
        ok: false,
        reason: 'UNKNOWN_INSTANCE',
        detail: `${one.id} is not a pattern or decision in force in the committed record of ${one.project}`,
      };
    }
    found.push(instance);
  }
  if (new Set(found.map((i) => i.project)).size < 2) {
    return {
      ok: false,
      reason: 'ONE_PROJECT',
      detail: 'a promotion needs the same pattern in force in at least two projects',
    };
  }
  const words = new Set(found.map(sameWords));
  if (words.size > 1) {
    return {
      ok: false,
      reason: 'NOT_THE_SAME',
      detail: 'the cited instances do not say the same thing',
    };
  }
  if (globalWords(sources).has([...words][0] as string)) {
    return {
      ok: false,
      reason: 'ALREADY_GLOBAL',
      detail: 'the machine-global tree already holds this pattern',
    };
  }
  const candidate = samePattern(sources).find((c) =>
    cited.every((one) => c.instances.some((i) => i.project === one.project && i.id === one.id)),
  );
  if (candidate === undefined) {
    return {
      ok: false,
      reason: 'NOT_A_CANDIDATE',
      detail: 'this set is not among the candidates `mnema promote --workspace` lists',
    };
  }
  // The words that travel are the FIRST CITED instance's — the one a person typed first —
  // and they are equal to the others' after normalizing, which is what was just proved.
  const first = found[0] as Instance;
  return {
    ok: true,
    candidate: {
      kind: candidate.kind,
      instances: candidate.instances,
      title: first.title,
      body: first.body,
      ...(first.alternatives !== undefined ? { alternatives: first.alternatives } : {}),
    },
  };
}
