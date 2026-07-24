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
 * The tools here: `capture_memory`, `record_decision`, `create_skill`,
 * `record_observation`, `record_handoff`, and `link_knowledge` (the write mold,
 * one append via a birth/fact operation), `task_transition`,
 * `decision_transition`, and `skill_transition` (the same mold applied to a gated
 * state change), and `bootstrap` (the read mold, one derivation over the
 * projection cache). The knowledge FACTS (observation/handoff/link) share the
 * memory mold exactly — one append, no gate — and forward the ids they reference
 * without validating them (a dangling reference is honest cross-tree). The server
 * wires these onto the protocol; the wiring adds nothing but the schema and the
 * response envelope.
 */

import { catalogUpcasters, type TransitionFields } from '@mnema/chain';
import { type Bootstrap, bootstrap } from '@mnema/copilot';
import {
  chainRootForScope,
  DECISION_ACTIONS,
  deriveAlias,
  locateEntityScope,
  orderedEvents,
  ProjectionCache,
  projectDecisions,
  projectSkills,
  type Scope,
  SKILL_ACTIONS,
} from '@mnema/core';
import {
  acceptDecision,
  adoptSkill,
  captureMemory,
  createSkill,
  deprecateSkill,
  linkKnowledge,
  recordDecision,
  recordHandoff,
  recordObservation,
  rejectDecision,
  rejectSkill,
  reviewSkill,
  supersedeDecision,
  transitionTask,
} from '@mnema/core/write';
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

/** A decision was recorded, or the requested scope was not available here. */
export type RecordDecisionResult =
  | {
      readonly ok: true;
      /** The minted decision id (the event subject). */
      readonly id: string;
      /** The citable `ADR-<n>` label frozen into the record — a decision's name. */
      readonly adr: string;
    }
  | {
      readonly ok: false;
      /** The requested scope names a tree absent in this context. */
      readonly code: 'SCOPE_UNAVAILABLE';
      /** The human-readable reason the record was refused. */
      readonly message: string;
    };

/** A decision moved (ok), or the gate refused (a typed reason in the envelope). */
export type DecisionTransitionResult =
  | {
      readonly ok: true;
      /** The decision's id (the one that moved). */
      readonly id: string;
      /** The decision's citable `ADR-<n>` label, resolved from the projection. */
      readonly adr: string;
      /** The state the decision is now in, resolved by the gate. */
      readonly to: string;
    }
  | {
      readonly ok: false;
      /** The gate's (or operation's) typed code — e.g. ILLEGAL_TRANSITION. */
      readonly code: string;
      /** The human-readable reason the move was refused. */
      readonly message: string;
    };

/** A skill was proposed, or the requested scope was not available here. */
export type CreateSkillResult =
  | {
      readonly ok: true;
      /** The minted skill id — the canonical identifier, the key a move takes. */
      readonly id: string;
      /** The skill's short name — DISPLAY only, not a key (not unique). */
      readonly name: string;
    }
  | {
      readonly ok: false;
      /** The requested scope names a tree absent in this context. */
      readonly code: 'SCOPE_UNAVAILABLE';
      /** The human-readable reason the propose was refused. */
      readonly message: string;
    };

/** A skill moved (ok), or the gate refused (a typed reason in the envelope). */
export type SkillTransitionResult =
  | {
      readonly ok: true;
      /** The skill's id (the one that moved). */
      readonly id: string;
      /** The skill's short name, resolved from the projection (DISPLAY only). */
      readonly name: string;
      /** The state the skill is now in, resolved by the gate. */
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
      message: `no ${scope} tree here — a session outside a project has only the global scope`,
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

/** An observation was recorded, or the requested scope was not available here. */
export type RecordObservationResult =
  | {
      readonly ok: true;
      /** The observation's OWN minted id (the event subject). */
      readonly id: string;
    }
  | {
      readonly ok: false;
      /** The requested scope names a tree absent in this context. */
      readonly code: 'SCOPE_UNAVAILABLE';
      /** The human-readable reason the record was refused. */
      readonly message: string;
    };

/** A handoff or a link was recorded, or the requested scope was not available. */
export type FactRecordedResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      /** The requested scope names a tree absent in this context. */
      readonly code: 'SCOPE_UNAVAILABLE';
      /** The human-readable reason the record was refused. */
      readonly message: string;
    };

/**
 * `record_observation` — records one observation about an entity, the MCP
 * counterpart of `mnema observe`. Like `capture_memory`, the tree is a per-action
 * choice on top of the session's default: an explicit `scope` wins, else the
 * session's own scope stands. An observation mints its OWN id (it is an entity),
 * which is returned.
 *
 * The `about` reference is forwarded to the core as-is and NEVER validated — the
 * observed entity may live in a tree this session cannot see, an honest
 * cross-tree assertion resolved on read. Opens the scope's writer, records the
 * observation attributed to the connecting agent (`which`) and pinned to the run,
 * then checkpoints. An override naming a tree absent here is refused as data
 * (SCOPE_UNAVAILABLE), never thrown.
 */
export function runRecordObservation(
  session: Session,
  input: { about: string; topic: string; text: string; scope?: Scope },
): RecordObservationResult {
  const scope = input.scope ?? session.scope;
  if (chainRootForScope(session.trees, scope) === undefined) {
    return {
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
      message: `no ${scope} tree here — a session outside a project has only the global scope`,
    };
  }
  const ctx = writeContext(session.trees, scope);
  const recorded = recordObservation(ctx, {
    about: input.about,
    topic: input.topic,
    text: input.text,
    which: session.which,
    run: session.runId,
  });
  // Checkpoint so the record is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, id: recorded.id };
}

/**
 * `record_handoff` — records one handoff on a task, the MCP counterpart of
 * `mnema handoff`. The tree is a per-action choice on top of the session default.
 * A handoff mints NO id (its subject IS the task), so the result carries no id —
 * only whether it landed.
 *
 * The `task` reference is forwarded as-is and NEVER validated. `from == to` is
 * legitimate (a chat restart) and is not refused. Opens the writer, records the
 * handoff attributed to the agent (`which`) and pinned to the run, checkpoints.
 * An override naming an absent tree is refused as data.
 */
export function runRecordHandoff(
  session: Session,
  input: { task: string; from: string; to: string; scope?: Scope },
): FactRecordedResult {
  const scope = input.scope ?? session.scope;
  if (chainRootForScope(session.trees, scope) === undefined) {
    return {
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
      message: `no ${scope} tree here — a session outside a project has only the global scope`,
    };
  }
  const ctx = writeContext(session.trees, scope);
  recordHandoff(ctx, {
    task: input.task,
    fromAgent: input.from,
    toAgent: input.to,
    which: session.which,
    run: session.runId,
  });
  // Checkpoint so the record is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true };
}

/**
 * `link_knowledge` — links one entity to another, the MCP counterpart of `mnema
 * link`. The tree is a per-action choice on top of the session default. A link
 * mints NO id (it is an edge), so the result carries no id.
 *
 * Neither `subject` nor `target` is validated — a link is legitimately cross-tree
 * and a dangling reference is honest, resolved on read. `rel` is an OPEN string,
 * forwarded verbatim (no enum on the surface). Opens the writer, records the link
 * attributed to the agent (`which`) and pinned to the run, checkpoints. An
 * override naming an absent tree is refused as data.
 */
export function runLinkKnowledge(
  session: Session,
  input: { subject: string; target: string; rel: string; scope?: Scope },
): FactRecordedResult {
  const scope = input.scope ?? session.scope;
  if (chainRootForScope(session.trees, scope) === undefined) {
    return {
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
      message: `no ${scope} tree here — a session outside a project has only the global scope`,
    };
  }
  const ctx = writeContext(session.trees, scope);
  linkKnowledge(ctx, {
    subject: input.subject,
    target: input.target,
    rel: input.rel,
    which: session.which,
    run: session.runId,
  });
  // Checkpoint so the record is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true };
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
 * `record_decision` — records one decision into a tree, the MCP counterpart of
 * `mnema decision`. Like `capture_memory`, the tree is a per-action choice on top
 * of the session's default: an explicit `scope` wins, else the session's own
 * scope stands. A decision needs both a `title` and a `rationale`, both required
 * by the schema.
 *
 * Opens that scope's writer, records the decision attributed to the connecting
 * agent (`which`) and pinned to the session's run, then checkpoints. Returns the
 * frozen `ADR-<n>` label — a decision has no alias, the ADR is its human name. An
 * override naming a tree this context lacks is refused as data (SCOPE_UNAVAILABLE),
 * never thrown, so the server shapes it into a tool error.
 */
export function runRecordDecision(
  session: Session,
  input: { title: string; rationale: string; scope?: Scope },
): RecordDecisionResult {
  const scope = input.scope ?? session.scope;
  if (chainRootForScope(session.trees, scope) === undefined) {
    return {
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
      message: `no ${scope} tree here — a session outside a project has only the global scope`,
    };
  }
  const ctx = writeContext(session.trees, scope);
  const recorded = recordDecision(ctx, {
    title: input.title,
    rationale: input.rationale,
    which: session.which,
    run: session.runId,
  });
  // A decision birth cannot be gate-refused (birth is not a gated transition; the
  // only check is who != which, which holds for a real client), but the operation
  // return is a union — surface any refusal honestly rather than asserting ok.
  if (!recorded.ok) {
    return { ok: false, code: 'SCOPE_UNAVAILABLE', message: recorded.message };
  }
  // Checkpoint so the record is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, id: recorded.id, adr: recorded.adr };
}

/**
 * `decision_transition` — moves a decision through its workflow, the MCP
 * counterpart of `mnema decision move` and `mnema decision supersede` folded into
 * ONE tool. Both surfaces call the SAME operations, so the gate accepts and
 * refuses identically; only the transport differs — the CLI splits supersede into
 * its own verb for a required positional `by`, the MCP carries `by` as an optional
 * arg on the single tool.
 *
 * The transition follows the ENTITY, not the session's scope: it locates the
 * decision's home tree ({@link locateEntityScope}) and opens THAT writer, so the
 * move never splits the history. If no visible tree holds it, `UNKNOWN_DECISION`.
 *
 * The action string routes to the operation — `accept`/`reject` carry the `note`,
 * `supersede` carries the `by` (successor id) and the `reason`. `by` is forwarded
 * ONLY on supersede; a supersede with no `by` reaches the gate as an empty
 * successor and is refused MISSING_BY, the honest refusal. It holds no workflow
 * logic; the gate decides, and a refusal is returned as data (never thrown).
 */
export function runDecisionTransition(
  session: Session,
  input: { id: string; action: string; by?: string; note?: string; reason?: string },
): DecisionTransitionResult {
  const upcasters = catalogUpcasters();
  // Route by the decision's home tree, not the session's scope: the move follows
  // the entity so its history stays whole in one tree.
  const scope = locateEntityScope(session.trees, input.id, upcasters);
  if (scope === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_DECISION',
      message: `decision "${input.id}" does not exist`,
    };
  }

  // Dispatch on the action to pick the right typed operation (accept/reject vs
  // supersede differ in the core's types). That needs the closed set of verbs;
  // an action outside it is refused UNKNOWN_ACTION rather than falling through to
  // a default op. The transition table itself stays the gate's.
  if (!(DECISION_ACTIONS as readonly string[]).includes(input.action)) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: `"${input.action}" is not a decision action`,
    };
  }

  const ctx = writeContext(session.trees, scope);
  const fields = decisionProofToFields(input);
  // Every move carries the session's `which` (the executing agent) and `run`, so
  // the transition is attributed to the agent even when it lands in the public
  // tree — who (the machine) != which (the agent) is preserved on a decision move
  // exactly as it is on a task move.
  const stamp = { which: session.which, run: session.runId };
  const moved =
    input.action === 'supersede'
      ? supersedeDecision(ctx, {
          id: input.id,
          // A missing `by` becomes '', which the gate reads as no successor and
          // refuses MISSING_BY. `by` reaches only supersede — the other ops have
          // no channel for it.
          by: input.by ?? '',
          ...(fields !== undefined ? { fields } : {}),
          ...stamp,
        })
      : input.action === 'reject'
        ? rejectDecision(ctx, {
            id: input.id,
            ...(fields !== undefined ? { fields } : {}),
            ...stamp,
          })
        : acceptDecision(ctx, {
            id: input.id,
            ...(fields !== undefined ? { fields } : {}),
            ...stamp,
          });
  if (!moved.ok) {
    return { ok: false, code: moved.code, message: moved.message };
  }
  // Checkpoint so the transition is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  // Resolve the ADR from the projection — a decision has no alias, so its human
  // name is the frozen label. Read the ONE resolved tree after the append.
  const root = chainRootForScope(session.trees, scope) as string;
  const adr = projectDecisions(orderedEvents({ root }, upcasters)).get(input.id)?.adr ?? input.id;
  return { ok: true, id: input.id, adr, to: moved.to };
}

/**
 * Builds a decision's proof fields from the args the agent supplied, dropping any
 * absent. Only the two a decision action can require are surfaced: `note`
 * (accept/reject) and `reason` (supersede).
 */
function decisionProofToFields(input: {
  note?: string;
  reason?: string;
}): TransitionFields | undefined {
  const fields: { note?: string; reason?: string } = {};
  if (input.note !== undefined) fields.note = input.note;
  if (input.reason !== undefined) fields.reason = input.reason;
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/**
 * `create_skill` — proposes a reusable pattern into a tree, the MCP counterpart
 * of `mnema skill`. Like `capture_memory` and `record_decision`, the tree is a
 * per-action choice on top of the session's default: an explicit `scope` wins,
 * else the session's own scope stands. A skill needs both a `name` and a `body`,
 * both required by the schema.
 *
 * Opens that scope's writer, proposes the skill attributed to the connecting
 * agent (`which`) and pinned to the session's run, then checkpoints. Returns the
 * minted `id` (the key a move takes) and the `name` (DISPLAY only) — a skill has
 * no alias. An override naming a tree this context lacks is refused as data
 * (SCOPE_UNAVAILABLE), never thrown, so the server shapes it into a tool error.
 */
export function runCreateSkill(
  session: Session,
  input: { name: string; body: string; scope?: Scope },
): CreateSkillResult {
  const scope = input.scope ?? session.scope;
  if (chainRootForScope(session.trees, scope) === undefined) {
    return {
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
      message: `no ${scope} tree here — a session outside a project has only the global scope`,
    };
  }
  const ctx = writeContext(session.trees, scope);
  const created = createSkill(ctx, {
    name: input.name,
    body: input.body,
    which: session.which,
    run: session.runId,
  });
  // A skill birth cannot be gate-refused (birth is not a gated transition; the
  // only check is who != which, which holds for a real client), but the operation
  // return is a union — surface any refusal honestly rather than asserting ok.
  if (!created.ok) {
    return { ok: false, code: 'SCOPE_UNAVAILABLE', message: created.message };
  }
  // Checkpoint so the propose is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, id: created.id, name: input.name };
}

/**
 * `skill_transition` — moves a skill through its workflow, the MCP counterpart of
 * `mnema skill move`. Both surfaces call the SAME operations, so the gate accepts
 * and refuses identically; only the transport differs.
 *
 * The transition follows the ENTITY, not the session's scope: it locates the
 * skill's home tree ({@link locateEntityScope}) and opens THAT writer, so the move
 * never splits the history. If no visible tree holds it, `UNKNOWN_SKILL`.
 *
 * The action string routes to the named operation — review/adopt/reject carry a
 * `note`, deprecate a `reason`. Unlike a decision's supersede, NO action carries a
 * `by` (a skill is not relational). An action outside `SKILL_ACTIONS` is refused
 * `UNKNOWN_ACTION` before any op is called, never falling through to a default.
 * It holds no workflow logic; the gate decides, and a refusal is returned as data
 * (never thrown).
 */
export function runSkillTransition(
  session: Session,
  input: { id: string; action: string; note?: string; reason?: string },
): SkillTransitionResult {
  const upcasters = catalogUpcasters();
  // Route by the skill's home tree, not the session's scope: the move follows the
  // entity so its history stays whole in one tree.
  const scope = locateEntityScope(session.trees, input.id, upcasters);
  if (scope === undefined) {
    return { ok: false, code: 'UNKNOWN_SKILL', message: `skill "${input.id}" does not exist` };
  }

  // Dispatch on the action to pick the right named op. An action outside the
  // closed vocabulary is refused UNKNOWN_ACTION rather than falling through to a
  // default op. The transition table itself stays the gate's.
  if (!(SKILL_ACTIONS as readonly string[]).includes(input.action)) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: `"${input.action}" is not a skill action`,
    };
  }

  const ctx = writeContext(session.trees, scope);
  const fields = skillProofToFields(input);
  // Every move carries the session's `which` (the executing agent) and `run`, so
  // the transition is attributed to the agent even when it lands in the public
  // tree — who (the machine) != which (the agent) is preserved on a skill move
  // exactly as it is on a task move.
  const stamp = { which: session.which, run: session.runId };
  const args = { id: input.id, ...(fields !== undefined ? { fields } : {}), ...stamp };
  const moved =
    input.action === 'review'
      ? reviewSkill(ctx, args)
      : input.action === 'adopt'
        ? adoptSkill(ctx, args)
        : input.action === 'reject'
          ? rejectSkill(ctx, args)
          : deprecateSkill(ctx, args);
  if (!moved.ok) {
    return { ok: false, code: moved.code, message: moved.message };
  }
  // Checkpoint so the transition is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  // Resolve the name from the projection to orient the human — a skill has no
  // alias. Read the ONE resolved tree after the append; fall back to the id.
  const root = chainRootForScope(session.trees, scope) as string;
  const name = projectSkills(orderedEvents({ root }, upcasters)).get(input.id)?.name ?? input.id;
  return { ok: true, id: input.id, name, to: moved.to };
}

/**
 * Builds a skill's proof fields from the args the agent supplied, dropping any
 * absent. Only the two a skill action can require are surfaced: `note`
 * (review/adopt/reject) and `reason` (deprecate).
 */
function skillProofToFields(input: {
  note?: string;
  reason?: string;
}): TransitionFields | undefined {
  const fields: { note?: string; reason?: string } = {};
  if (input.note !== undefined) fields.note = input.note;
  if (input.reason !== undefined) fields.reason = input.reason;
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
