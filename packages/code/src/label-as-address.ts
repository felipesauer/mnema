/**
 * What a refusal says when the "id" it was handed is a LABEL — `ADR-3`, the name every write
 * prints for a decision and every read cites.
 *
 * THE TRAP. `Recorded decision ADR-1 (01a0f7…)` is the line a write prints, `ADR-1` is what the
 * brief and the reads call the decision, and `mnema show ADR-1` answers `No record ADR-1 here.` —
 * and so does `decision move accept ADR-3`. By design: a label is numbered inside ONE tree, so two
 * trees (the team's and this machine's) can each hold an `ADR-1`, and an address that can name two
 * things is no address. But the refusal was the same bare sentence as for an id that exists
 * nowhere, so a person who did exactly what the output showed them was told, in effect, that the
 * decision was not there. Measured on the built binary: 3 of the 3 first-time walkthroughs typed
 * the label and got that sentence.
 *
 * WHAT IT SAYS: that the thing typed is a label and not an id, and which id or ids carry it here.
 * The detector is `ProjectionCache.listDecisions` read over every tree — the same set the brief's
 * collision notice is built from — so a label two decisions carry is answered with BOTH ids, and
 * the person picks; nothing here picks for them.
 *
 * It answers `undefined` for anything that is not shaped like a label and for a label no decision
 * here carries: then the bare refusal is the whole truth. It is a READ and opens no writer.
 */

import { resolveTrees } from '@mnema/core';
import { oneLine } from './one-line.js';
import { caches, withScopedCaches } from './tree-sources.js';
import type { Here } from './wiring/context.js';

/** The shape of a decision label as the record freezes it: `ADR-` and a number. */
const A_LABEL = /^ADR-\d+$/i;

/** The sentence for a typed `named`, or undefined when it is not a label some decision carries. */
export function labelAsAddress(ctx: Here, named: string): string | undefined {
  const typed = named.trim();
  if (!A_LABEL.test(typed)) return undefined;
  const label = typed.toUpperCase();
  const ids = withScopedCaches(resolveTrees(ctx.cwd, ctx.env), (sources) => [
    ...new Set(
      caches(sources)
        .flatMap((cache) => cache.listDecisions())
        .filter((decision) => decision.adr === label)
        .map((decision) => decision.id),
    ),
  ]).sort();
  if (ids.length < 1) return undefined;
  const list = ids.map((id) => oneLine(id)).join(', ');
  return ids.length === 1
    ? `${label} is a label, not an id: in this project it names the decision ${list}. Use the id.`
    : `${label} is a label, not an id, and ${ids.length} decisions here carry it (a tree numbers its own): ${list}. Use the id of the one you mean.`;
}
