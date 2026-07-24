/**
 * `mnema handoff <task> <from> <to>` — record a handoff on a task.
 *
 * A sibling of `memory` and `observe`, differing in that it mints NO id: a
 * handoff has no standalone identity — its subject IS the task, and it is an
 * entry in that task's history. So the command reports the FACT (the task and
 * the two agents), not an id there is none of.
 *
 * All three inputs are POSITIONAL (`<task> <from> <to>`): they are short
 * ids/labels, not a body of text, so none competes for the tail of the line the
 * way an observation's text would. `from == to` is legitimate (a chat restart
 * with the same agent) and is not refused — the core accepts it and so does the
 * surface.
 *
 * The `task` reference is NOT verified to exist — like an observation's `about`,
 * it is a reference resolved on read, so a task in another tree is honest
 * dangling, never a refusal here.
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
import { openTreeForWriting, recordHandoff } from '@mnema/core/write';

/** What the handoff command needs — injected so it is testable. */
export interface HandoffContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** A handoff was recorded — the fact, with its references (there is no id). */
export interface HandoffRecorded {
  readonly ok: true;
  /** The task the handoff is about (the event subject). */
  readonly task: string;
  /** The agent handing off. */
  readonly fromAgent: string;
  /** The agent taking over. */
  readonly toAgent: string;
}

/** The record was refused. */
export type HandoffRefused =
  /** There is no project here — a project-scoped handoff needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused (e.g. the authority invariant). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Records a handoff, routing its birth to the resolved scope. The scope rule is
 * identical to a memory's. The `task` reference is forwarded to the core as-is
 * and never validated. On success it echoes the fact back (task, from, to) —
 * there is no minted id to return.
 */
export function runHandoff(
  ctx: HandoffContext,
  input: { task: string; fromAgent: string; toAgent: string; scope?: Scope },
): HandoffRecorded | HandoffRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = resolveScope({}, input.scope);
  if (scope !== 'global' && trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, scope);
  recordHandoff(
    {
      writer,
      layout: { root: chainRootForScope(trees, scope) as string },
      upcasters: catalogUpcasters(),
    },
    { task: input.task, fromAgent: input.fromAgent, toAgent: input.toAgent },
  );

  // Checkpoint so the new handoff is signature-covered at once.
  writer.checkpoint();

  return { ok: true, task: input.task, fromAgent: input.fromAgent, toAgent: input.toAgent };
}
