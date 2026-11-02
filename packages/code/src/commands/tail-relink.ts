/**
 * `mnema tail relink <tail>... [--into <record>] --reason <text>`: the owner's relink of whole
 * tails into the record the directory's other tails name (FORMAT.md section 6.11, ADR-155).
 *
 * The adapter shape of `tail prune`: find the tree that holds the tails, then call ONE core
 * operation (`relinkTails`) and report what it returned. What differs is the key: each relink is
 * signed by the key the relinked tail's id names, the person's or an agent's kept on this machine,
 * whatever key a write here would sign with otherwise; and the writer it opens writes under the
 * record joined (`joins`), so the relink lands in a tail of that key that names it, or in one
 * born naming it.
 *
 * NO IDENTITY DOOR IS ASKED, AND THAT IS WHAT LETS IT RUN WHERE IT IS NEEDED. The directory it
 * mends names two records, where every reading of the record reads nothing, and a write that asks
 * the recorded anchor there is refused `STALE_ANCHOR` before it gets anywhere. The operation asks
 * the readers' own rule instead, over the directory as it would read with the relinks written.
 */

import { catalogUpcasters, type NewTail } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, locateTailScope, resolveTrees } from '@mnema/core';
import {
  keysOnThisMachine,
  openTreeForWriting,
  type RelinkError,
  type RelinkOk,
  relinkTails,
} from '@mnema/core/write';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';

/** What the relink command needs: injected so it is testable. */
export interface TailRelinkContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** The relinks were written; `opened` is every new tail a writer opened for them. */
export interface Relinked extends Omit<RelinkOk, 'replaced'>, Replacement, Landed {
  readonly opened: readonly NewTail[];
}

/** Why nothing was written. */
export type RelinkRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | { readonly ok: false; readonly reason: 'UNKNOWN_TAIL'; readonly tail: string }
  | { readonly ok: false; readonly reason: 'TAILS_IN_TWO_TREES' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: RelinkError['code'];
      readonly message: string;
    };

/** Relinks `tails`, each by its own key, in the tree that holds them. */
export function runTailRelink(
  ctx: TailRelinkContext,
  input: { tails: readonly string[]; into?: string; reason: string; run?: string },
): Relinked | RelinkRefused {
  const upcasters = catalogUpcasters();
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scopes = new Set<string>();
  let scope: ReturnType<typeof locateTailScope>;
  for (const tail of input.tails) {
    scope = locateTailScope(trees, tail, upcasters);
    if (scope === undefined) {
      return trees.projectPublic === undefined
        ? { ok: false, reason: 'NO_PROJECT' }
        : { ok: false, reason: 'UNKNOWN_TAIL', tail };
    }
    scopes.add(scope);
  }
  if (scope === undefined) return { ok: false, reason: 'NO_PROJECT' };
  if (scopes.size > 1) return { ok: false, reason: 'TAILS_IN_TWO_TREES' };
  const tree = scope;
  const root = chainRootForScope(trees, tree) as string;
  const opened: NewTail[] = [];
  const relinked = relinkTails(
    {
      layouts: [{ root }],
      upcasters,
      keys: keysOnThisMachine(trees.keyRoot, ctx.env),
      openWriter: (key, joins) =>
        openTreeForWriting(trees, tree, {
          keyRoot: key.keyRoot,
          joins,
          onNewTail: (one) => opened.push(one),
        }),
    },
    {
      tails: input.tails,
      reason: input.reason,
      ...(input.into !== undefined ? { into: input.into } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
  );
  if (!relinked.ok) {
    return { ok: false, reason: 'REFUSED', code: relinked.code, message: relinked.message };
  }
  const { replaced: _replaced, ...written } = relinked;
  return { ...written, opened, scope: tree, ...forwardReplacement(relinked) };
}
