/**
 * `mnema retract <id> --reason "<why>"` — take a note back.
 *
 * A note — a memory or an observation — is a point-in-time fact and cannot be edited: the
 * record only grows. What it CAN be is taken back, by a later signed fact that says who did
 * it and why. The note stays in the record and `mnema show` still opens it, saying it was
 * retracted; what changes is that the reads that list notes — the opening of a session, the
 * search — no longer offer it.
 *
 * It follows the note to the tree it was written in, the way a decision's move follows the
 * decision, and takes no `--scope`: a retraction filed in another tree would leave the note's
 * history split. Only the identity that wrote the note retracts it, with any key of it; the
 * fact is attributed to this installation and, with `--which`, to the agent that carried it
 * out. Decisions and patterns keep their own lifecycle and are refused here.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  locateEntityScopeWith,
  replayingRecordProbe,
  resolveTrees,
} from '@mnema/core';
import { openTreeForWriting, retractNote } from '@mnema/core/write';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';

/** What the retract command needs — injected so it is testable. */
export interface RetractContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** A note was retracted. */
export interface NoteRetracted extends Replacement, Landed {
  readonly ok: true;
  /** The retracted note's id. */
  readonly id: string;
  /** What the note was. */
  readonly note: 'memory' | 'observation';
}

/** The retraction was refused. */
export type RetractRefused =
  /**
   * No visible tree holds a record by this id — `UNKNOWN_NOTE` inside a project, and
   * `NO_PROJECT` outside one, where the machine-global tree was looked in and held nothing
   * by that id either: the rule `show` answers by.
   */
  | { readonly ok: false; readonly reason: 'UNKNOWN_NOTE' | 'NO_PROJECT' }
  /** The core refused: not a note, already retracted, a reason that says nothing, … */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/** Retracts the note `id` in the tree it was written in. */
export function runRetract(
  ctx: RetractContext,
  input: { id: string; reason: string; which?: string; run?: string },
): NoteRetracted | RetractRefused {
  const upcasters = catalogUpcasters();
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const scope = locateEntityScopeWith(trees, input.id, replayingRecordProbe(upcasters));
  if (scope === undefined) {
    return { ok: false, reason: trees.projectPublic === undefined ? 'NO_PROJECT' : 'UNKNOWN_NOTE' };
  }

  const writer = openTreeForWriting(trees, scope);
  const retracted = retractNote(
    { writer, layout: { root: chainRootForScope(trees, scope) as string }, upcasters },
    {
      id: input.id,
      reason: input.reason,
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
  );
  if (!retracted.ok) {
    return { ok: false, reason: 'REFUSED', code: retracted.code, message: retracted.message };
  }

  // Checkpoint so the retraction is signature-covered at once.
  writer.checkpoint();
  return {
    ok: true,
    id: retracted.id,
    note: retracted.note,
    scope,
    ...forwardReplacement(retracted),
  };
}
