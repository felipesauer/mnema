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
 *
 * IT STOPS AT THE HOLDER, unless the record it found is about more than itself.
 * An id is minted once, so the first tree that answers has THE answer and the
 * rest cost a full replay for nothing. Two kinds break that: a memory names the
 * identity that captured it, and how short that identity can be written depends on
 * the identities the WHOLE record knows; a skill's consultations are written by the
 * sessions that read it, into their own trees, not into the pattern's. So those two
 * open the trees that are left, and the other three still stop.
 */

import { catalogUpcasters } from '@mnema/chain';
import { consultationsByRun, type RecordBody, readRecord, type ScopedCache } from '@mnema/copilot';
import {
  chainRootForScope,
  type DiscoveryEnv,
  ProjectionCache,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { type AnchorForms, anchorForms, NO_ANCHORS } from '../anchors.js';

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
  /** How each identity this record knows is written for a person. */
  readonly anchors: AnchorForms;
  /** How many runs consulted this pattern — present only for a skill. */
  readonly consultations?: number;
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
  const opened: ScopedCache[] = [];
  const open = (scope: Scope): ScopedCache | undefined => {
    const root = chainRootForScope(trees, scope);
    if (root === undefined) return undefined;
    const cache = ProjectionCache.open(root, { upcasters });
    cache.rebuild();
    const source: ScopedCache = { scope, chainRoot: root, cache };
    opened.push(source);
    return source;
  };
  try {
    let found: RecordBody | null = null;
    let next = 0;
    for (; next < SCOPES.length && found === null; next++) {
      const source = open(SCOPES[next] as Scope);
      if (source !== undefined) found = readRecord([source], input.id);
    }
    if (found === null) return { ok: false, reason: 'UNKNOWN_RECORD' };
    if (found.kind !== 'memory' && found.kind !== 'skill') {
      return { ok: true, record: found, anchors: NO_ANCHORS };
    }
    // The two kinds whose answer is about the whole record and not about one tree.
    for (; next < SCOPES.length; next++) open(SCOPES[next] as Scope);
    return {
      ok: true,
      record: found,
      anchors: anchorForms(opened),
      ...(found.kind === 'skill'
        ? { consultations: consultationsByRun(opened).get(found.id) ?? 0 }
        : {}),
    };
  } finally {
    for (const source of opened) source.cache.close();
  }
}
