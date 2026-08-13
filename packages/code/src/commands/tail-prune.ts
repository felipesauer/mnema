/**
 * `mnema tail prune <tail> --reason <text>` — authorize the cut of one whole tail.
 *
 * The same adapter shape as every other write here (resolve which tree the write
 * belongs to, open its writer, call ONE core operation, report what it returned),
 * and the difference is what it does NOT do: it removes nothing. It appends the
 * signed `tail.pruned` that names the tail, how many events it held and the head it
 * held them through — read off the disk by the operation, never supplied — and hands
 * back the path of the directory, which is still there.
 *
 * THAT IS NOT A HALF-BUILT VERB, it is the measurement. On a real project with the
 * chain committed — which is how a record travels — deleting a tail's directory left
 * `git status` reporting three deletions and `git show HEAD:<the segment>` printing
 * all twenty-two lines back. Deleting does not remove: the content is in the index,
 * on the remote and in every clone, and a command that ran `rm` would give a sense of
 * completion over work that had barely started. So this records the authorization
 * while the tail is still there — which is exactly what makes its claims checkable —
 * and says where the files are and how far a cut reaches.
 *
 * THE WAIVER FOLLOWS THE TAIL, the way a transition follows its entity: the census
 * that later reads it is per-tree, so a waiver in another tree is a signed fact
 * nobody meets. {@link locateTailScope} finds the tree that holds the tail and THAT
 * tree's writer is opened. With no tree holding it, this refuses `UNKNOWN_TAIL`
 * rather than opening a writer somewhere and letting the core say the same thing
 * about a tree the caller never named.
 *
 * IT IS NOT PERMISSION. Anyone who can write to this record can authorize the cut of
 * any tail in it, exactly as anyone who can write can record any other fact — the
 * declaration is signed and attributed. What makes this verb the CLI's alone is the
 * other half: on the MCP surface a run opens by itself on the first write, with the
 * `who` derived from the key and nobody authorizing that session out loud, and a cut
 * is the one write whose consequence is destructive.
 */

import { catalogUpcasters, tailDir } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, locateTailScope, resolveTrees } from '@mnema/core';
import { authorizeTailPrune, openTreeForWriting } from '@mnema/core/write';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';

/** What the prune command needs — injected so it is testable. */
export interface TailPruneContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The cut was authorized. Nothing was removed. */
export interface CutAuthorized extends Replacement, Landed {
  readonly ok: true;
  /** The tail the waiver names. */
  readonly tail: string;
  /** The anchor that tail served — the identity the fact is filed under. */
  readonly anchor: string;
  /** The identity that authorized the cut — the one that signed the waiver. */
  readonly authorizedBy: string;
  /** How many events the tail held when the waiver was written. */
  readonly eventCount: number;
  /** The head it held them through. */
  readonly throughHash: string;
  /**
   * Where the tail's files are — the directory a cut would remove.
   *
   * It is reported because the verb does not touch it: whoever authorized the cut is
   * the one who carries it out, and the path is what they need to do it.
   */
  readonly tailDirectory: string;
}

/** The authorization was refused; nothing was written and nothing was touched. */
export type CutRefused =
  /** There is no project here — a tail belongs to a record. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** No visible tree holds that tail with events in it. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_TAIL' }
  /** The core operation refused (the writer's own tail, an oversize reason, …). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Authorizes the cut of `tail`, in the tree that holds it.
 *
 * With no `.mnema/` found from the cwd and no global tree holding the tail either,
 * this refuses `NO_PROJECT`; with a project present and no tree holding the tail, it
 * refuses `UNKNOWN_TAIL`. Everything the waiver claims is read by the core off the
 * disk — the caller says only WHICH tail and WHY.
 */
export function runTailPrune(
  ctx: TailPruneContext,
  input: { tail: string; reason: string; which?: string; run?: string },
): CutAuthorized | CutRefused {
  const upcasters = catalogUpcasters();
  const trees = resolveTrees(ctx.cwd, ctx.env);

  // The tree that holds the tail; the waiver has to land THERE. When no tree does,
  // distinguish "you are not in a project" from "this record simply has no such
  // tail" — the same distinction a move makes about an entity it cannot see.
  const scope = locateTailScope(trees, input.tail, upcasters);
  if (scope === undefined) {
    return trees.projectPublic === undefined
      ? { ok: false, reason: 'NO_PROJECT' }
      : { ok: false, reason: 'UNKNOWN_TAIL' };
  }

  const root = chainRootForScope(trees, scope) as string;
  const writer = openTreeForWriting(trees, scope);
  const authorized = authorizeTailPrune(
    { writer, layout: { root }, upcasters },
    {
      tail: input.tail,
      reason: input.reason,
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
  );
  if (!authorized.ok) {
    return { ok: false, reason: 'REFUSED', code: authorized.code, message: authorized.message };
  }

  // Checkpoint so the waiver is signature-covered at once. It matters more here than
  // anywhere else: an unsigned waiver is the one fact whose whole purpose is to be
  // believed about something that is no longer on disk to check it against.
  writer.checkpoint();

  return {
    ok: true,
    tail: authorized.tail,
    anchor: authorized.anchor,
    authorizedBy: writer.anchor,
    eventCount: authorized.eventCount,
    throughHash: authorized.throughHash,
    // The chain's own idea of where a tail lives, asked rather than composed: a path
    // spelled out here could name a directory the verifier does not read. It is a
    // path to READ OUT and nothing in this file opens it.
    tailDirectory: tailDir({ root }, authorized.tail),
    scope,
    ...forwardReplacement(authorized),
  };
}
