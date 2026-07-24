/**
 * `mnema observe <about> --topic "<t>" --text "<obs>"` — record an observation.
 *
 * A sibling of `memory`, differing only in what an observation carries. Like a
 * memory it is a point-in-time FACT — no gate, no state, no `move` — and it mints
 * its OWN id (an observation is itself an entity, "I noted X about Y"), which the
 * command reports back.
 *
 * The shape splits about-vs-content: `about` is a POSITIONAL (the entity the
 * note is about, a short id/label), while the `topic` and the `text` are FLAGS.
 * The text would compete with about/topic for the tail of the line — where does
 * the topic end and the observation begin? — so it is named, the `gh issue
 * comment <n> --body` convention. Neither `--topic` nor `--text` is declared as
 * commander's `requiredOption`; they are plain options the action checks itself,
 * matching the posture the skill's `--body` established (nothing forces a flag on
 * a sibling verb).
 *
 * The `about` target is NOT verified to exist. The core deliberately does not
 * refuse a dangling `about` — the observed entity may live in another tree the
 * writer cannot see, an honest cross-tree assertion resolved on read — and the
 * surface only forwards it. There is no `UNKNOWN_*` for the reference here.
 *
 * The birth scope is a per-action choice, exactly as for a memory: an explicit
 * `scope` wins; when omitted, the routing default (public) stands.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  resolveScope,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { openTreeForWriting, recordObservation } from '@mnema/core/write';

/** What the observe command needs — injected so it is testable. */
export interface ObserveContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** An observation was recorded. */
export interface ObservationRecorded {
  readonly ok: true;
  /** The observation's OWN minted id (the event subject). */
  readonly id: string;
}

/** The record was refused. */
export type ObserveRefused =
  /** There is no project here — a project-scoped observation needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused (e.g. the authority invariant). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Records an observation, routing its birth to the resolved scope. The scope
 * rule is identical to a memory's: an explicit `scope` wins, else the routing
 * default (public). A PROJECT scope needs a project; with none this refuses
 * `NO_PROJECT`. The `about` reference is forwarded to the core as-is and never
 * validated — a dangling reference is honest cross-tree, not a refusal.
 */
export function runObserve(
  ctx: ObserveContext,
  input: { about: string; topic: string; text: string; scope?: Scope },
): ObservationRecorded | ObserveRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = resolveScope({}, input.scope);
  if (scope !== 'global' && trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, scope);
  const recorded = recordObservation(
    {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters: catalogUpcasters(),
    },
    { about: input.about, topic: input.topic, text: input.text },
  );

  // Checkpoint so the new observation is signature-covered at once.
  writer.checkpoint();

  return { ok: true, id: recorded.id };
}
