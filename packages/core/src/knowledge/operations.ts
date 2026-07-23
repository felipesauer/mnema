/**
 * Capturing knowledge: the write operations for the knowledge domain.
 *
 * Knowledge is a point-in-time FACT, not a gated move. A memory has no state to
 * judge, no prior state to check, and no lifecycle — so unlike a task
 * transition, capturing one runs no gate. It is one append: mint the memory's
 * own id, stamp the envelope, emit `memory.captured`. That the fact is
 * immutable is what makes the gate irrelevant here — there is nothing to
 * authorize about a fact that will never move.
 *
 * The disciplines the work operations rely on still hold, because they defend
 * the proof, not the workflow:
 *   - `who` (the authorizing anchor) and `signerFp` (the signing key) come from
 *     the writer's own key, never supplied — a caller cannot forge who captured
 *     a memory by typing a name.
 *   - the memory's id is MINTED by the operation (see {@link mintId}), never
 *     chosen by the caller, so two offline clones never mint the same id and two
 *     unrelated memories cannot false-merge when their chains are unioned.
 *   - the installation founds its anchor before its first fact, so the captured
 *     memory's signer is a key valid for its anchor at verify.
 *
 * WHICH tree a capture lands in is not decided here: a caller opens the tree
 * for the resolved scope (`openTreeForWriting`) and hands the resulting writer
 * in via the context. This operation writes to whatever chain that writer owns.
 */

import { memoryCaptured } from '@mnema/chain';
import { mintId } from '../identity/id.js';
import { canonicalIdentity } from '../identity/who.js';
import { systemClock } from '../workflow/clock.js';
import { ensureFounded } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';

/** A memory was captured: the fact was appended. */
export interface CaptureOk {
  readonly ok: true;
  /** The new memory's id (the event subject). */
  readonly id: string;
}

/** What the caller asks to capture. */
export interface CaptureInput {
  /** The content of the memory. */
  readonly content: string;
  /** The agent that captured it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * Captures a memory: mints its id, then appends the single `memory.captured`
 * fact stamped with one `at`. The id is minted here, never supplied — the caller
 * receives it back in {@link CaptureOk.id}. There is no birth pair and no gate:
 * a memory has no state, so nothing is judged and nothing is transitioned. `who`
 * is the writer's anchor, derived from its key; `which` is the executing agent,
 * whose presence is exactly what the scope resolver reads to default an
 * automatic capture to the private tree.
 */
export function captureMemory(ctx: WriteContext, input: CaptureInput): CaptureOk {
  const who = ctx.writer.anchor;
  const which = canonicalIdentity(input.which);

  // Minted here, not chosen by the caller: derived from randomness so two
  // offline clones never mint the same one, closing false-merge of memories at
  // the root (the same move `who` makes). Canonical by construction.
  const id = mintId();

  // Found this installation's anchor before the fact, so its signer is a key
  // valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.append(
    memoryCaptured(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: id,
        ...(which !== undefined ? { which } : {}),
        ...(input.run !== undefined ? { run: input.run } : {}),
      },
      { content: input.content },
    ),
  );
  return { ok: true, id };
}
