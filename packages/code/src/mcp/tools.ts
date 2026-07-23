/**
 * The MCP tools, as thin adapters.
 *
 * Each tool is the MCP counterpart of a CLI command: it takes the session's
 * resolved context, calls ONE core function, and returns what that function
 * returned. It holds no domain logic — the id is minted by the operation, the
 * scope was decided when the session opened, the actor is the session's `who`.
 * A tool only maps the session + args onto a core call and shapes the result.
 * This is the mold the remaining tools copy; keeping it a pure function (a
 * `Session` in, a result out) is what lets the tools be tested without a
 * transport, and what keeps the surface from growing a second implementation of
 * the domain.
 *
 * Two tools live here: `capture_memory` (the write mold, one append via the
 * knowledge operation) and `bootstrap` (the read mold, one derivation over the
 * projection cache). The server wires these onto the protocol; the wiring adds
 * nothing but the schema and the response envelope.
 */

import { type Bootstrap, bootstrap } from '@mnema/copilot';
import { chainRootForScope, ProjectionCache } from '@mnema/core';
import { captureMemory } from '@mnema/core/write';
import { type Session, writeContext } from './session.js';

/** A memory was captured. */
export interface CaptureResult {
  /** The minted memory id (the event subject). */
  readonly id: string;
}

/**
 * `capture_memory` — records one point-in-time fact in the session's tree.
 *
 * Opens the session scope's writer, captures the memory attributed to the
 * connecting agent (`which`) and pinned to the session's run, then checkpoints
 * so the new fact is signature-covered at once — the same posture every command
 * leaves the tree in. Which tree it lands in is the session's (private in a
 * project, global outside one); this tool does not re-decide that.
 */
export function runCaptureMemory(session: Session, input: { content: string }): CaptureResult {
  const ctx = writeContext(session.trees, session.scope);
  const captured = captureMemory(ctx, {
    content: input.content,
    which: session.which,
    run: session.runId,
  });
  // Checkpoint so the capture is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { id: captured.id };
}

/**
 * `bootstrap` — the opening context for the session's actor.
 *
 * Rebuilds a projection cache over the session's resolved tree and composes the
 * copilot's `bootstrap` derivation for the machine's anchor (`who`): where the
 * actor left off and the actionable work. Read-only — it opens no writer and
 * emits no event. The cache is over the ONE resolved tree (the session's), not
 * the union of all three; a session works on one tree, and that is the context
 * it serves.
 */
export function runBootstrap(session: Session): Bootstrap {
  const chainRoot = chainRootForScope(session.trees, session.scope) as string;
  const cache = ProjectionCache.open(chainRoot);
  cache.rebuild();
  return bootstrap(cache, { actor: session.who });
}
