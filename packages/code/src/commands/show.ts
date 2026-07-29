/**
 * `mnema show <id>` — one whole record, by the id a search gave.
 *
 * The other half of `mnema search`: the index says what exists, this says what
 * it says. It looks in every visible tree (an id is minted once and lives in
 * one) and returns the projection the chain proves, marked with the tree it came
 * from.
 *
 * It serves a SKILL like any other record, and that is a deliberate difference
 * from the agent's surface, where a skill's body is refused and routed to the
 * `skills` tool. The reason the two differ is the reader: an agent asking for a
 * pattern is asking how to work, so it is served only ADOPTED ones and the
 * consultation is recorded. A person on the command line is CURATING — reading a
 * proposed pattern to review it, or a deprecated one to see what was dropped —
 * and refusing them the text of the thing they are deciding about would make the
 * workflow unusable. Nothing is recorded here either: there is no session on the
 * command line to attribute a consultation to, and inventing one would put a
 * fact on the chain that no agent ever asked for.
 *
 * Read-only: it opens a cache per tree, rebuilds it in memory, and reads. No
 * writer, no key, no event — so no `--actor`.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type RecordBody, readRecord, type ScopedCache } from '@mnema/copilot';
import {
  chainRootForScope,
  type DiscoveryEnv,
  ProjectionCache,
  resolveTrees,
  type Scope,
} from '@mnema/core';

/** The trees a lookup reads, in a fixed order. An id lives in exactly one. */
const SCOPES: readonly Scope[] = ['public', 'private', 'global'];

/** What the show command needs — injected so it is testable. */
export interface ShowContext {
  /** The working directory to resolve the trees from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The record, whole, with the tree it lives in. */
export interface ShowDone {
  readonly ok: true;
  /** The record and its faithful projection. */
  readonly record: RecordBody;
}

/** No visible tree holds a record with this id. */
export interface ShowRefused {
  readonly ok: false;
  readonly reason: 'UNKNOWN_RECORD';
}

/**
 * Reads the record with `id` from the first visible tree that holds it. An id
 * that belongs to a run, a handoff or a link is `UNKNOWN_RECORD`: those are
 * facts about other things, with no record of their own to show (a task's
 * handoffs are part of the task's story — `mnema timeline`).
 */
export function runShow(ctx: ShowContext, input: { id: string }): ShowDone | ShowRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const upcasters = catalogUpcasters();
  // One tree at a time, stopping at the first that holds the id. On the command
  // line each tree costs a full replay, and the answer cannot change by reading
  // further: an id is minted once, so a second holder does not exist.
  for (const scope of SCOPES) {
    const root = chainRootForScope(trees, scope);
    if (root === undefined) continue;
    const cache = ProjectionCache.open(root, { upcasters });
    try {
      cache.rebuild();
      const source: ScopedCache = { scope, chainRoot: root, cache };
      const record = readRecord([source], input.id);
      if (record !== null) return { ok: true, record };
    } finally {
      cache.close();
    }
  }
  return { ok: false, reason: 'UNKNOWN_RECORD' };
}
