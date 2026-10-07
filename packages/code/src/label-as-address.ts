/**
 * What an `ADR-<n>` typed where an id goes MEANS — the one place that decides it.
 *
 * `Recorded decision ADR-1 (01a0f7…)` is the line a write prints, and `ADR-1` is what the brief and
 * the reads call the decision. A person who types that label back at a verb is naming a decision,
 * and the answer used to differ by verb: `show ADR-1` and `decision move accept ADR-1` refused it,
 * while `link ADR-1 <path>` accepted it, exit 0, and wrote the text "ADR-1" as the subject of an
 * edge that points at nothing. Three first-time walkthroughs of three typed the label and were told,
 * in effect, that the decision was not there.
 *
 * WHAT IT DECIDES: a label is accepted when it names EXACTLY ONE decision in this project, and is
 * turned into that decision's id before anything else sees it — so no verb ever records or looks up
 * the label itself. A label is numbered inside ONE tree, so two trees (the team's and this
 * machine's) can each hold an `ADR-1`; then it names no single decision and the answer lists every
 * id that carries it, and the person picks. Nothing here picks for them.
 *
 * The detector is `ProjectionCache.listDecisions` read over every tree — the same set the brief's
 * collision notice is built from. A word that is not shaped like a label, or a label no decision
 * carries, is passed through untouched: the verb's own refusal for an unknown id is then the whole
 * truth. It is a READ and opens no writer.
 */

import { resolveTrees } from '@mnema/core';
import { oneLine } from './one-line.js';
import { caches, withScopedCaches } from './tree-sources.js';
import type { Here } from './wiring/context.js';

/** The shape of a decision label as the record freezes it: `ADR-` and a number. */
const A_LABEL = /^ADR-\d+$/i;

/** What a typed word turned out to be, over the decisions in hand. */
export type LabelResolution =
  /** Not a label, or a label no decision carries: the word stands as typed. */
  | { readonly kind: 'as-typed' }
  /** A label that names exactly one decision: use its id. */
  | { readonly kind: 'one'; readonly id: string }
  /** A label two or more decisions carry (a tree numbers its own): the person picks. */
  | { readonly kind: 'many'; readonly ids: readonly string[]; readonly message: string };

/** What a verb does with an id-or-label: the id to use, or the sentence that refuses. */
export type Addressed =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

/**
 * The one rule, over decisions already in hand: the door that holds its own caches (the MCP
 * session's) reads them itself and asks only for the answer, so no surface can resolve differently.
 */
export function resolveLabel(
  named: string,
  decisions: readonly { readonly id: string; readonly adr: string }[],
): LabelResolution {
  const typed = named.trim();
  if (!A_LABEL.test(typed)) return { kind: 'as-typed' };
  const label = typed.toUpperCase();
  const ids = [
    ...new Set(decisions.filter((decision) => decision.adr === label).map((d) => d.id)),
  ].sort();
  const [only] = ids;
  if (only === undefined) return { kind: 'as-typed' };
  if (ids.length === 1) return { kind: 'one', id: only };
  const list = ids.map((id) => oneLine(id)).join(', ');
  return {
    kind: 'many',
    ids,
    message: `${label} names ${ids.length} decisions here (a tree numbers its own), so it is no address: ${list}. Use the id of the one you mean.`,
  };
}

/** The resolution as a verb needs it: the id to carry on with, or the refusal. */
export function addressed(named: string, resolution: LabelResolution): Addressed {
  if (resolution.kind === 'many') return { ok: false, message: resolution.message };
  return { ok: true, id: resolution.kind === 'one' ? resolution.id : named };
}

/** Resolves `named` against every tree visible from `ctx`. Opens no caches unless it is a label. */
export function resolveAddress(ctx: Here, named: string): Addressed {
  if (!A_LABEL.test(named.trim())) return { ok: true, id: named };
  return addressed(
    named,
    withScopedCaches(resolveTrees(ctx.cwd, ctx.env), (sources) =>
      resolveLabel(
        named,
        caches(sources).flatMap((cache) => cache.listDecisions()),
      ),
    ),
  );
}
