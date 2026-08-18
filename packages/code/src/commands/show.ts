/**
 * `mnema show <id>` — one whole record, by the id a search gave.
 *
 * The other half of `mnema search`: the index says what exists, this says what
 * it says. It looks in every visible tree (an id is minted once and lives in
 * one) and returns the projection the chain proves, marked with the tree it came
 * from.
 *
 * It serves a SKILL like any other record, and that is a deliberate difference
 * from the agent's surface, where a skill's body comes through the `skills` tool
 * instead. What differs there is the DOOR, not the body: that tool serves an adopted
 * pattern and one still awaiting a ruling, and refuses only the two states the
 * project has closed. Here every state is served, including those two, because a
 * person on the command line is CURATING — reading a deprecated pattern to see what
 * was dropped is the reason this surface exists — and refusing them the text of the
 * thing they are deciding about would make the workflow unusable.
 *
 * That sentence is the one this product's rule for the agent's surface was widened
 * to match: it is about whoever JUDGES, not about whoever is human. What stays
 * one-sided is the RECORDING — and THE REASON GIVEN HERE USED TO BE FALSE. It read
 * *"there is no session on the command line to attribute a consultation to"*, which was
 * true when it was written and stopped being true when `mnema run start` put a run on
 * this surface: a person reading here may well be inside one, and `MNEMA_RUN` would
 * name it.
 *
 * What is true, and is why nothing is recorded anyway, was measured instead of assumed.
 * A `skill.consulted` routes to the PUBLIC tree (`core/src/topology/routing.ts`), so a
 * third party who clones a repository and reads inside a run would append to the
 * committed record of the very people they are auditing. Any reader founds an identity
 * on the spot — `run start` does it — so there is no reader the mechanism could tell
 * apart and decline. And it would not close the hole it was for: whoever reads outside
 * a run goes on reading in silence. Under all three sits the structural half: no system
 * of proof makes the READER sign their own reading. Where a log of reading exists, what
 * records it is the system that SERVES — which is why `skill.consulted` works on the MCP
 * surface, which has a server, and cannot work here, where the person opens the file.
 *
 * That is also what kills a gate of the shape "you may only move what you have
 * consulted" — it would not be one rule across both surfaces, it would be a rule the
 * auditor's surface cannot obey. What stands in its place is a REPORT that declares its
 * own scope: `mnema antipatterns` says whether the run that MOVED a pattern had been
 * served its body, and answers NOT OBSERVABLE — never "did not consult" — for every move
 * whose run recorded no consultation at all, which is the state every move following a
 * read through this verb is in. `tests/what-the-record-can-witness.test.ts` drives that
 * exact sequence (`run start` → `show` → `skill move`) and holds the answer to being the
 * third one.
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
