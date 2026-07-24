/**
 * The MCP tools, as thin adapters.
 *
 * Each tool is the MCP counterpart of a CLI command: it takes the session's
 * resolved context, calls ONE core function, and returns what that function
 * returned. It holds no domain logic — the id is minted by the operation, the
 * actor is the session's `who`. The scope a NEW write lands in is a per-action
 * choice: the session carries a DEFAULT (fixed when it opened), and a write tool
 * may override it per call (`capture_memory`'s `scope`); a MOVE, by contrast,
 * follows the entity's home tree, never a scope the caller picks. A tool only
 * maps the session + args onto a core call and shapes the result.
 * This is the mold the remaining tools copy; keeping it a pure function (a
 * `Session` in, a result out) is what lets the tools be tested without a
 * transport, and what keeps the surface from growing a second implementation of
 * the domain.
 *
 * The tools here: `capture_memory` (the write mold, one append via the
 * knowledge operation), `task_transition` (the same write mold applied to a
 * gated state change), and `bootstrap` (the read mold, one derivation over the
 * projection cache). The server wires these onto the protocol; the wiring adds
 * nothing but the schema and the response envelope.
 */

import { catalogUpcasters, type TransitionFields } from '@mnema/chain';
import { type Bootstrap, bootstrap } from '@mnema/copilot';
import {
  chainRootForScope,
  deriveAlias,
  locateEntityScope,
  ProjectionCache,
  type Scope,
} from '@mnema/core';
import { captureMemory, transitionTask } from '@mnema/core/write';
import { type Session, writeContext } from './session.js';

/** A memory was captured, or the requested scope was not available here. */
export type CaptureResult =
  | {
      readonly ok: true;
      /** The minted memory id (the event subject). */
      readonly id: string;
    }
  | {
      readonly ok: false;
      /** The requested scope names a tree absent in this context. */
      readonly code: 'SCOPE_UNAVAILABLE';
      /** The human-readable reason the capture was refused. */
      readonly message: string;
    };

/** A task moved (ok), or the gate refused (a typed reason in the envelope). */
export type TransitionResult =
  | {
      readonly ok: true;
      /** The task's id (the one that moved). */
      readonly id: string;
      /** The short human-facing alias (`t-xxxx`), derived from the id. */
      readonly alias: string;
      /** The state the task is now in, resolved by the gate. */
      readonly to: string;
    }
  | {
      readonly ok: false;
      /** The gate's (or operation's) typed code — e.g. ILLEGAL_TRANSITION. */
      readonly code: string;
      /** The human-readable reason the move was refused. */
      readonly message: string;
    };

/**
 * `capture_memory` — records one point-in-time fact into a tree.
 *
 * The tree is a per-action choice on top of the session's default: an explicit
 * `scope` in the args wins; when omitted, the session's own scope stands (private
 * in a project, global outside one — the default fixed when the session opened).
 * This is the cascade the scope model settles: `arg scope` > `session.scope` >
 * [a future per-context default]. It corrects the session fixing the scope for
 * every write — one agent session produces both public and private work, so the
 * scope is per-call, not per-session. The session's scope remains the DEFAULT;
 * the tool only overrides it when the arg is present.
 *
 * Opens that scope's writer, captures the memory attributed to the connecting
 * agent (`which`) and pinned to the session's run, then checkpoints so the new
 * fact is signature-covered at once — the same posture every command leaves the
 * tree in.
 */
export function runCaptureMemory(
  session: Session,
  input: { content: string; scope?: Scope },
): CaptureResult {
  const scope = input.scope ?? session.scope;
  // An override may name a tree this context does not have — `--scope public`
  // in a session with no project. Refuse as data rather than throwing, so the
  // server shapes it into a tool error and the agent sees the capture did not
  // happen. The session's own scope always resolves, so an omitted arg never
  // hits this.
  if (chainRootForScope(session.trees, scope) === undefined) {
    return {
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
      message: `no ${scope} tree here — run outside a project has only the global scope`,
    };
  }
  const ctx = writeContext(session.trees, scope);
  const captured = captureMemory(ctx, {
    content: input.content,
    which: session.which,
    run: session.runId,
  });
  // Checkpoint so the capture is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, id: captured.id };
}

/**
 * `task_transition` — moves a task through the workflow, the MCP counterpart of
 * `mnema task move`. Both call the SAME {@link transitionTask}, so the gate
 * accepts and refuses identically; only the transport and the context differ.
 *
 * The transition follows the ENTITY, not the session's scope. A task lives in
 * one tree, and a move must land there — writing it to the session's tree
 * instead (the session opened private, but the task may be public) would split
 * the task's history and hide the move from whoever reads only one tree. So the
 * tool LOCATES the task's home tree ({@link locateEntityScope}) and opens THAT
 * tree's writer; the session's scope governs where a session's NEW work is born,
 * not where an existing entity is moved. If no visible tree holds the task, it
 * refuses `UNKNOWN_TASK`.
 *
 * The agent supplies the action as a string and whichever proof field it has;
 * the tool forwards them and stamps the session's `which` (the executing agent)
 * and `run`. It holds no workflow logic — the gate decides legality and proof,
 * and the tool relays the verdict: on success the new state, on refusal the
 * gate's own code and message, returned as data (never thrown) so the server can
 * shape it into a tool error without crashing the connection.
 */
export function runTaskTransition(
  session: Session,
  input: { id: string; action: string; reason?: string; note?: string; feedback?: string },
): TransitionResult {
  // Route by the task's home tree, not the session's scope: the move follows the
  // entity so its history stays whole in one tree.
  const scope = locateEntityScope(session.trees, input.id, catalogUpcasters());
  if (scope === undefined) {
    return { ok: false, code: 'UNKNOWN_TASK', message: `task "${input.id}" does not exist` };
  }

  const ctx = writeContext(session.trees, scope);
  const fields = proofToFields(input);
  const moved = transitionTask(ctx, {
    id: input.id,
    action: input.action,
    ...(fields !== undefined ? { fields } : {}),
    which: session.which,
    run: session.runId,
  });
  if (!moved.ok) {
    return { ok: false, code: moved.code, message: moved.message };
  }
  // Checkpoint so the transition is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, id: input.id, alias: deriveAlias('task', input.id), to: moved.to };
}

/**
 * Builds the chain's proof fields from the args the agent supplied, dropping any
 * that were absent. Returns undefined when none were given. Only the three
 * textual proof fields the gate can ever require are surfaced; pr_url and links
 * are never proof and are not part of a transition here.
 */
function proofToFields(input: {
  reason?: string;
  note?: string;
  feedback?: string;
}): TransitionFields | undefined {
  const fields: { reason?: string; note?: string; feedback?: string } = {};
  if (input.reason !== undefined) fields.reason = input.reason;
  if (input.note !== undefined) fields.note = input.note;
  if (input.feedback !== undefined) fields.feedback = input.feedback;
  return Object.keys(fields).length > 0 ? fields : undefined;
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
