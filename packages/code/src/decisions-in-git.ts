/**
 * The decisions of a project as the git bridge needs them: who they are, what they address,
 * and how a trailer's value or a typed word names one.
 *
 * ONE READING FOR THREE VERBS (`commits`, `why`, `aging`) AND THE TRAILER LINE, because "which
 * decision does this word mean" and "which paths does it address" are answers that must not come
 * out differently depending on which verb asked. The addresses are the push's own
 * ({@link readGovernsInForceEverywhere}), so a path this lists for a decision is a path
 * `mnema rules` would report it for — and only a decision IN FORCE has any: a superseded
 * decision governs nothing, and the verbs say so rather than listing a stale address.
 *
 * A LABEL IS DISPLAY, NOT IDENTITY (two trees each hold an `ADR-1`). So a word that is a label
 * names a decision only when exactly one decision of the trees carries it; otherwise it names
 * none and {@link Named} carries the ids that do, for the person to choose between.
 */

import type { ScopedCache } from '@mnema/context';
import { readGovernsInForceEverywhere } from './governed-tree.js';
import { caches } from './tree-sources.js';

/** A decision as the bridge reads it. */
export interface DecisionFacts {
  readonly id: string;
  /** The citable `ADR-<n>` label — display, not identity. */
  readonly adr: string;
  readonly title: string;
  readonly state: string;
  /** `at` of its last transition — the acceptance, for a decision whose state is `accepted`. */
  readonly settledAt: string;
  /** The project-relative paths it governs, when it is in force; empty otherwise. */
  readonly addresses: readonly string[];
}

/** Every decision of the trees, with the addresses of those in force. */
export function readDecisionFacts(sources: readonly ScopedCache[], root: string): DecisionFacts[] {
  const addressed = new Map<string, Set<string>>();
  for (const one of readGovernsInForceEverywhere(sources, root)) {
    if (!one.inProject) continue;
    const set = addressed.get(one.rule.id) ?? new Set<string>();
    set.add(one.rule.address);
    addressed.set(one.rule.id, set);
  }
  const seen = new Set<string>();
  const all: DecisionFacts[] = [];
  for (const cache of caches(sources)) {
    for (const decision of cache.listDecisions()) {
      if (seen.has(decision.id)) continue;
      seen.add(decision.id);
      const addresses = [...(addressed.get(decision.id) ?? [])].sort();
      all.push({
        id: decision.id,
        adr: decision.adr,
        title: decision.title,
        state: decision.state,
        settledAt: decision.updatedAt,
        addresses,
      });
    }
  }
  return all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What a word names among the decisions. */
export type Named =
  | { readonly kind: 'decision'; readonly decision: DecisionFacts }
  | { readonly kind: 'ambiguous'; readonly ids: readonly string[] }
  | { readonly kind: 'none' };

/** The shape of a label as the record freezes it. */
const A_LABEL = /^ADR-\d+$/i;

/** The decision `word` names: an id exactly, or a label carried by exactly one decision. */
export function nameOf(all: readonly DecisionFacts[], word: string): Named {
  const typed = word.trim();
  const byId = all.find((decision) => decision.id === typed);
  if (byId !== undefined) return { kind: 'decision', decision: byId };
  if (!A_LABEL.test(typed)) return { kind: 'none' };
  const label = typed.toUpperCase();
  const carrying = all.filter((decision) => decision.adr === label);
  const [only] = carrying;
  if (carrying.length === 1 && only !== undefined) return { kind: 'decision', decision: only };
  return carrying.length > 1
    ? { kind: 'ambiguous', ids: carrying.map((decision) => decision.id) }
    : { kind: 'none' };
}

/** Whether a trailer value cites `decision` — by its id, or by its label when only it carries it. */
export function cites(
  all: readonly DecisionFacts[],
  decision: DecisionFacts,
  value: string,
): boolean {
  const named = nameOf(all, value);
  return named.kind === 'decision' && named.decision.id === decision.id;
}
