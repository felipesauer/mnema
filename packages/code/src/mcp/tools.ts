/**
 * The MCP tools, as thin adapters.
 *
 * Each tool is the MCP counterpart of a CLI command: it takes the session's
 * resolved context, calls ONE core function, and returns what that function
 * returned. It holds no domain logic — the id is minted by the operation, the
 * actor is the session's `who`. WHERE a NEW write lands is a per-action choice in
 * two dimensions, and the session carries the default for both: the PROJECT (the
 * cascade's, overridable per call with `project`) and the SCOPE inside it (the
 * origin rule's, overridable per call with `scope`). Both are answered by one
 * function, {@link routeWrite}, so ten verbs cannot disagree about where a write
 * goes; a MOVE, by contrast, follows the entity's home tree, never a destination
 * the caller picks. A tool only maps the session + args onto a core call and shapes
 * the result.
 * This is the mold the remaining tools copy; keeping it a pure function (a
 * `Session` in, a result out) is what lets the tools be tested without a
 * transport, and what keeps the surface from growing a second implementation of
 * the domain.
 *
 * The tools here: `capture_memory`, `record_decision`, `create_task`,
 * `create_skill`, `record_observation`, `record_handoff`, and `link_knowledge`
 * (the write mold, one append via a birth/fact operation), `task_transition`,
 * `decision_transition`, and `skill_transition` (the same mold applied to a gated
 * state change), `bootstrap`/`focus`/`resume`/`next_actions` (the read mold, one
 * derivation over the projection cache), `guard` (the read mold applied to a
 * DRY-RUN of the gate — it simulates a move and returns the verdict, writing
 * nothing), `skills` (the one read that also WRITES: it serves the adopted
 * patterns and records that they were served, because that fact is derivable
 * from nothing else afterwards), `search`/`read_record` (the read mold widened to
 * every tree the session can see: an index of what matched, then one whole record
 * by the id that index gave), and the intelligence reads `runTimelineTool`/
 * `runReferencesTool`/`runAccountabilityTool`/`runAntipatternsTool`/
 * `runExposureTool` (the auditor's view — they fold every tree the session can
 * see, opening no cache and no writer; `runExposureTool` keeps them separate
 * because its answer has to name the tree). The knowledge
 * FACTS (observation/handoff/link) share the
 * memory mold exactly — one append, no gate — and forward the ids they reference
 * without validating them (a dangling reference is honest cross-tree). The server
 * wires these onto the protocol; the wiring adds nothing but the schema and the
 * response envelope.
 *
 * The read mold does not OPEN a cache: it asks the session's registry for the
 * one over the tree it serves — the session's own for the actor reads, the
 * ENTITY's home tree for `next_actions` and `guard`. So a connection replays a
 * chain when a write has made that necessary, not once per call, and the answer
 * is the same either way (the registry rebuilds a stale cache before handing it
 * over). The write mold needs no counterpart discipline: every write asks
 * {@link openWrite} for its context, and that door is where the invalidation lives.
 *
 * That door is also where the session's RUN comes from — never off the session — and
 * a write mold added later inherits both by asking for the same two things. A write
 * cannot reach a run any other way: the session's own cell is `string | undefined`,
 * so an operation that needs one will not take it.
 */

import { catalogUpcasters, type TransitionFields } from '@mnema/chain';
import {
  type Accountability,
  type AccountabilityFilter,
  type AdoptedSkill,
  type Antipatterns,
  accountability,
  adoptedSkills,
  antipatterns,
  type Bootstrap,
  bootstrap,
  type Exposure,
  exposure,
  type Focus,
  focus,
  type GuardWithFocus,
  guardWithFocus,
  lookupAdoptedSkill,
  type NextAction,
  nextActionsForTask,
  type RecordBody,
  type RecordQuery,
  type RecordSearch,
  type ReferenceGraph,
  type Resume,
  readRecord,
  references,
  resume,
  type ScopedCache,
  searchRecords,
  type TimelineEntry,
  timeline,
} from '@mnema/copilot';
import {
  chainRootForScope,
  DECISION_ACTIONS,
  deriveAlias,
  isSearchKind,
  orderedEvents,
  type ProjectionCache,
  projectDecisions,
  projectSkills,
  type ReferenceDirection,
  type ResolvedTrees,
  type Scope,
  SEARCH_KINDS,
  type SecretClass,
  SKILL_ACTIONS,
} from '@mnema/core';
import {
  acceptDecision,
  adoptSkill,
  captureMemory,
  createSkill,
  createTask,
  deprecateSkill,
  linkKnowledge,
  recordConsultation,
  recordDecision,
  recordHandoff,
  recordObservation,
  rejectDecision,
  rejectSkill,
  reviewSkill,
  supersedeDecision,
  transitionTask,
} from '@mnema/core/write';
import { scopedEvents, unionEvents } from '../intelligence-source.js';
import { forwardReplacement, type Replacement } from '../recorded-content.js';
import { oneLine } from '../served-patterns.js';
import { bornHereButUnreadable, locateEntityInSession, notFoundInVisibleTrees } from './locate.js';
import { namedProjects, routeWrite } from './route.js';
import { openWrite, type Session } from './session.js';

/** A memory was captured, or the requested scope was not available here. */
export type CaptureResult =
  | (Replacement & {
      readonly ok: true;
      /** The minted memory id (the event subject). */
      readonly id: string;
    })
  | {
      readonly ok: false;
      /**
       * Why it was refused: `SCOPE_UNAVAILABLE` when the requested scope names a
       * tree absent here, else the core operation's own code (the authority
       * invariant, `WHO_IS_WHICH`).
       */
      readonly code: string;
      /** The human-readable reason the capture was refused. */
      readonly message: string;
    };

/** A task was created, or the write was refused (the scope guard, or the core). */
export type CreateTaskResult =
  | (Replacement & {
      readonly ok: true;
      /** The minted task id (the event subject) — the key a move takes. */
      readonly id: string;
      /** The short human-facing alias (`t-xxxx`), derived from the id. */
      readonly alias: string;
    })
  | {
      readonly ok: false;
      /** `SCOPE_UNAVAILABLE` (a tree absent here), or the core operation's code. */
      readonly code: string;
      /** The human-readable reason the create was refused. */
      readonly message: string;
    };

/** A task moved (ok), or the gate refused (a typed reason in the envelope). */
export type TransitionResult =
  | (Replacement & {
      readonly ok: true;
      /** The task's id (the one that moved). */
      readonly id: string;
      /** The short human-facing alias (`t-xxxx`), derived from the id. */
      readonly alias: string;
      /** The state the task is now in, resolved by the gate. */
      readonly to: string;
    })
  | {
      readonly ok: false;
      /** The gate's (or operation's) typed code — e.g. ILLEGAL_TRANSITION. */
      readonly code: string;
      /** The human-readable reason the move was refused. */
      readonly message: string;
    };

/** A decision was recorded, or the requested scope was not available here. */
export type RecordDecisionResult =
  | (Replacement & {
      readonly ok: true;
      /** The minted decision id (the event subject). */
      readonly id: string;
      /** The citable `ADR-<n>` label frozen into the record — a decision's name. */
      readonly adr: string;
    })
  | {
      readonly ok: false;
      /** `SCOPE_UNAVAILABLE` (a tree absent here), or the core operation's code. */
      readonly code: string;
      /** The human-readable reason the record was refused. */
      readonly message: string;
    };

/** A decision moved (ok), or the gate refused (a typed reason in the envelope). */
export type DecisionTransitionResult =
  | (Replacement & {
      readonly ok: true;
      /** The decision's id (the one that moved). */
      readonly id: string;
      /** The decision's citable `ADR-<n>` label, resolved from the projection. */
      readonly adr: string;
      /** The state the decision is now in, resolved by the gate. */
      readonly to: string;
    })
  | {
      readonly ok: false;
      /** The gate's (or operation's) typed code — e.g. ILLEGAL_TRANSITION. */
      readonly code: string;
      /** The human-readable reason the move was refused. */
      readonly message: string;
    };

/** A skill was proposed, or the requested scope was not available here. */
export type CreateSkillResult =
  | (Replacement & {
      readonly ok: true;
      /** The minted skill id — the canonical identifier, the key a move takes. */
      readonly id: string;
      /** The skill's short name — DISPLAY only, not a key (not unique). */
      readonly name: string;
    })
  | {
      readonly ok: false;
      /** `SCOPE_UNAVAILABLE` (a tree absent here), or the core operation's code. */
      readonly code: string;
      /** The human-readable reason the propose was refused. */
      readonly message: string;
    };

/** A skill moved (ok), or the gate refused (a typed reason in the envelope). */
export type SkillTransitionResult =
  | (Replacement & {
      readonly ok: true;
      /** The skill's id (the one that moved). */
      readonly id: string;
      /** The skill's short name, resolved from the projection (DISPLAY only). */
      readonly name: string;
      /** The state the skill is now in, resolved by the gate. */
      readonly to: string;
    })
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
 * The tree is a per-action choice on top of the session's defaults: an explicit
 * `project` names which of the workspace's projects it belongs to, and an explicit
 * `scope` which of that project's trees; either omitted, the session's own stands
 * (the project the cascade landed on; private in a project, global outside one).
 * This is the cascade the routing model settles: `arg` > `session` > [a future
 * per-context default], one dimension at a time. It corrects the session fixing
 * the destination for every write — one agent session produces work in more than
 * one project and both public and private work in each, so the destination is
 * per-call, not per-session. The session's own remains the DEFAULT; the tool only
 * overrides it when an arg is present.
 *
 * Opens that tree's writer, captures the memory attributed to the connecting
 * agent (`which`) and pinned to that destination's run, then checkpoints so the new
 * fact is signature-covered at once — the same posture every command leaves the
 * tree in.
 */
export function runCaptureMemory(
  session: Session,
  input: { content: string; scope?: Scope; project?: string },
): CaptureResult {
  // Where this write goes, in one answer. A `project` naming nothing this session
  // can write to, a `project` naming two of them, or a `scope` naming a tree the
  // destination lacks are all refused as data rather than thrown, so the server
  // shapes them into a tool error and the agent sees the capture did not happen.
  const route = routeWrite(session, input);
  if (!route.ok) return route;
  const { ctx, run } = openWrite(session, route.scope, route.target);
  const captured = captureMemory(ctx, {
    content: input.content,
    which: session.which,
    run,
  });
  // A capture runs no gate, but the authority invariant still applies — surface
  // the core's refusal rather than asserting ok, and checkpoint nothing.
  if (!captured.ok) {
    return { ok: false, code: captured.code, message: captured.message };
  }
  // Checkpoint so the capture is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, id: captured.id, ...forwardReplacement(captured) };
}

/** An observation was recorded, or the requested scope was not available here. */
export type RecordObservationResult =
  | (Replacement & {
      readonly ok: true;
      /** The observation's OWN minted id (the event subject). */
      readonly id: string;
    })
  | {
      readonly ok: false;
      /** `SCOPE_UNAVAILABLE` (a tree absent here), or the core operation's code. */
      readonly code: string;
      /** The human-readable reason the record was refused. */
      readonly message: string;
    };

/** A handoff or a link was recorded, or the requested scope was not available. */
export type FactRecordedResult =
  | (Replacement & {
      readonly ok: true;
      /**
       * The label or relation AS RECORDED — screened, so an echo shows what
       * landed. A handoff and a link mint no id, so this is what a caller has to
       * report the fact by.
       */
      readonly recorded: readonly string[];
    })
  | {
      readonly ok: false;
      /** `SCOPE_UNAVAILABLE` (a tree absent here), or the core operation's code. */
      readonly code: string;
      /** The human-readable reason the record was refused. */
      readonly message: string;
    };

/**
 * `record_observation` — records one observation about an entity, the MCP
 * counterpart of `mnema observe`. Like `capture_memory`, the destination is a
 * per-action choice on top of the session's defaults: an explicit `project` and
 * `scope` win, else the session's own stand. An observation mints its OWN id (it is
 * an entity), which is returned.
 *
 * The `about` reference is forwarded to the core as-is and NEVER validated — the
 * observed entity may live in a tree this session cannot see, an honest
 * cross-tree assertion resolved on read. That is also why `project` matters most
 * here and on the other two verbs that carry a foreign id: nothing about the
 * reference can tell this tool it landed in the wrong project, so the caller
 * naming one is the only thing that can. Opens the destination's writer, records
 * the observation attributed to the connecting agent (`which`) and pinned to that
 * destination's run, then checkpoints. A destination it cannot resolve is refused
 * as data, never thrown.
 */
export function runRecordObservation(
  session: Session,
  input: { about: string; topic: string; text: string; scope?: Scope; project?: string },
): RecordObservationResult {
  const route = routeWrite(session, input);
  if (!route.ok) return route;
  const { ctx, run } = openWrite(session, route.scope, route.target);
  const recorded = recordObservation(ctx, {
    about: input.about,
    topic: input.topic,
    text: input.text,
    which: session.which,
    run,
  });
  if (!recorded.ok) {
    return { ok: false, code: recorded.code, message: recorded.message };
  }
  // Checkpoint so the record is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, id: recorded.id, ...forwardReplacement(recorded) };
}

/**
 * `record_handoff` — records one handoff on a task, the MCP counterpart of
 * `mnema handoff`. The destination is a per-action choice on top of the session's
 * defaults (`project`, then `scope`). A handoff mints NO id (its subject IS the
 * task), so the result carries no id — only whether it landed.
 *
 * The `task` reference is forwarded as-is and NEVER validated, so — as with
 * `record_observation` and `link_knowledge` — the reference cannot reveal a write
 * that went to the wrong project, and `project` is the only thing that can.
 * `from == to` is legitimate (a chat restart) and is not refused. Opens the
 * destination's writer, records the handoff attributed to the agent (`which`) and
 * pinned to that destination's run, checkpoints. A destination it cannot resolve is
 * refused as data.
 */
export function runRecordHandoff(
  session: Session,
  input: { task: string; from: string; to: string; scope?: Scope; project?: string },
): FactRecordedResult {
  const route = routeWrite(session, input);
  if (!route.ok) return route;
  const { ctx, run } = openWrite(session, route.scope, route.target);
  const recorded = recordHandoff(ctx, {
    task: input.task,
    fromAgent: input.from,
    toAgent: input.to,
    which: session.which,
    run,
  });
  if (!recorded.ok) {
    return { ok: false, code: recorded.code, message: recorded.message };
  }
  // Checkpoint so the record is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  // The labels AS RECORDED, not as asked for: a label that carried a credential
  // reached the chain as a placeholder, and the echo has to say so.
  return {
    ok: true,
    recorded: [recorded.fromAgent, recorded.toAgent],
    ...forwardReplacement(recorded),
  };
}

/**
 * `link_knowledge` — links one entity to another, the MCP counterpart of `mnema
 * link`. The destination is a per-action choice on top of the session's defaults
 * (`project`, then `scope`). A link mints NO id (it is an edge), so the result
 * carries no id.
 *
 * Neither `subject` nor `target` is validated — a link is legitimately cross-tree
 * and a dangling reference is honest, resolved on read — which is exactly why the
 * EDGE's own project has to be said rather than inferred: a link between two
 * projects is a legitimate thing to write, and the tree it is written in is the one
 * that will report it. `rel` is an OPEN string, forwarded verbatim (no enum on the
 * surface). Opens the destination's writer, records the link attributed to the agent
 * (`which`) and pinned to that destination's run, checkpoints. A destination it
 * cannot resolve is refused as data.
 */
export function runLinkKnowledge(
  session: Session,
  input: { subject: string; target: string; rel: string; scope?: Scope; project?: string },
): FactRecordedResult {
  const route = routeWrite(session, input);
  if (!route.ok) return route;
  const { ctx, run } = openWrite(session, route.scope, route.target);
  const recorded = linkKnowledge(ctx, {
    subject: input.subject,
    target: input.target,
    rel: input.rel,
    which: session.which,
    run,
  });
  if (!recorded.ok) {
    return { ok: false, code: recorded.code, message: recorded.message };
  }
  // Checkpoint so the record is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  // The relation AS RECORDED — screened, so the echo shows what landed.
  return { ok: true, recorded: [recorded.rel], ...forwardReplacement(recorded) };
}

/**
 * `create_task` — creates a task, the MCP counterpart of `mnema task`. Until it
 * existed the agent could MOVE tasks but never open one, so an agent told to
 * break work down had no tool for it — the asymmetry this closes.
 *
 * The birth mold of `create_skill` exactly: the destination is a per-action choice
 * on top of the session's defaults (an explicit `project` and `scope` win, else the
 * session's own stand), the id is MINTED by the operation, and the write is
 * attributed to the connecting agent (`which`) and pinned to that destination's run.
 *
 * Returns the minted `id` (the key a move takes) AND the derived `alias` — the
 * short name the human reads afterwards, the same pair the CLI reports. A
 * destination it cannot resolve is refused as data, never thrown, so the server
 * shapes it into a tool error.
 */
export function runCreateTask(
  session: Session,
  input: { title: string; scope?: Scope; project?: string },
): CreateTaskResult {
  const route = routeWrite(session, input);
  if (!route.ok) return route;
  const { ctx, run } = openWrite(session, route.scope, route.target);
  const created = createTask(ctx, {
    title: input.title,
    which: session.which,
    run,
  });
  // A birth is not a gated transition, but the operation's return is a union —
  // surface the refusal it can carry (the authority invariant) rather than
  // asserting ok, and checkpoint nothing when no event was appended.
  if (!created.ok) {
    return { ok: false, code: created.code, message: created.message };
  }
  // Checkpoint so the new task is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return {
    ok: true,
    id: created.id,
    alias: deriveAlias('task', created.id),
    ...forwardReplacement(created),
  };
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
 * tool LOCATES the task's home tree ({@link locateEntityInSession}) and opens THAT
 * tree's writer; the session's scope governs where a session's NEW work is born,
 * not where an existing entity is moved. If no visible tree holds the task, it
 * refuses `UNKNOWN_TASK`.
 *
 * That is also why a move takes no `project`, here or on the other two transitions,
 * while every BIRTH does: the entity's own tree is the answer, and a `project` could
 * only ever agree with it or contradict it. A move whose task lives in a project this
 * session did not land on is refused by name — the refusal says which trees were
 * searched — which is an honest answer a caller can act on, and the opposite of the
 * silence a birth produces when nobody says where it belongs.
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
  const scope = locateEntityInSession(session, input.id);
  if (scope === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_TASK',
      message: notFoundInVisibleTrees(session, 'task', input.id),
    };
  }

  const { ctx, run } = openWrite(session, scope);
  const fields = proofToFields(input);
  const moved = transitionTask(ctx, {
    id: input.id,
    action: input.action,
    ...(fields !== undefined ? { fields } : {}),
    which: session.which,
    run,
  });
  if (!moved.ok) {
    return { ok: false, code: moved.code, message: moved.message };
  }
  // Checkpoint so the transition is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return {
    ok: true,
    id: input.id,
    alias: deriveAlias('task', input.id),
    to: moved.to,
    ...forwardReplacement(moved),
  };
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
 * `mnema decision`. Like `capture_memory`, the destination is a per-action choice on
 * top of the session's defaults: an explicit `project` and `scope` win, else the
 * session's own stand. A decision needs both a `title` and a `rationale`, both
 * required by the schema.
 *
 * Opens that tree's writer, records the decision attributed to the connecting
 * agent (`which`) and pinned to that destination's run, then checkpoints. Returns the
 * frozen `ADR-<n>` label — a decision has no alias, the ADR is its human name, and
 * the number is the destination tree's own count, so a decision recorded in another
 * project is numbered in that project's series. A destination it cannot resolve is
 * refused as data, never thrown, so the server shapes it into a tool error.
 */
export function runRecordDecision(
  session: Session,
  input: { title: string; rationale: string; scope?: Scope; project?: string },
): RecordDecisionResult {
  const route = routeWrite(session, input);
  if (!route.ok) return route;
  const { ctx, run } = openWrite(session, route.scope, route.target);
  const recorded = recordDecision(ctx, {
    title: input.title,
    rationale: input.rationale,
    which: session.which,
    run,
  });
  // A decision birth cannot be gate-refused (birth is not a gated transition; the
  // only check is who != which, which holds for a real client), but the operation
  // return is a union — surface any refusal honestly rather than asserting ok.
  if (!recorded.ok) {
    return { ok: false, code: recorded.code, message: recorded.message };
  }
  // Checkpoint so the record is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, id: recorded.id, adr: recorded.adr, ...forwardReplacement(recorded) };
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
 * decision's home tree ({@link locateEntityInSession}) and opens THAT writer, so the
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
  const scope = locateEntityInSession(session, input.id);
  if (scope === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_DECISION',
      message: notFoundInVisibleTrees(session, 'decision', input.id),
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

  const { ctx, run } = openWrite(session, scope);
  const fields = decisionProofToFields(input);
  // Every move carries the session's `which` (the executing agent) and `run`, so
  // the transition is attributed to the agent even when it lands in the public
  // tree — who (the machine) != which (the agent) is preserved on a decision move
  // exactly as it is on a task move.
  const stamp = { which: session.which, run };
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
  return { ok: true, id: input.id, adr, to: moved.to, ...forwardReplacement(moved) };
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
 * of `mnema skill`. Like `capture_memory` and `record_decision`, the destination is
 * a per-action choice on top of the session's defaults: an explicit `project` and
 * `scope` win, else the session's own stand. A skill needs both a `name` and a
 * `body`, both required by the schema.
 *
 * Opens that tree's writer, proposes the skill attributed to the connecting
 * agent (`which`) and pinned to that destination's run, then checkpoints. Returns the
 * minted `id` (the key a move takes) and the `name` (DISPLAY only) — a skill has
 * no alias. A destination it cannot resolve is refused as data, never thrown, so the
 * server shapes it into a tool error.
 */
export function runCreateSkill(
  session: Session,
  input: { name: string; body: string; scope?: Scope; project?: string },
): CreateSkillResult {
  const route = routeWrite(session, input);
  if (!route.ok) return route;
  const { ctx, run } = openWrite(session, route.scope, route.target);
  const created = createSkill(ctx, {
    name: input.name,
    body: input.body,
    which: session.which,
    run,
  });
  // A skill birth cannot be gate-refused (birth is not a gated transition; the
  // only check is who != which, which holds for a real client), but the operation
  // return is a union — surface any refusal honestly rather than asserting ok.
  if (!created.ok) {
    return { ok: false, code: created.code, message: created.message };
  }
  // Checkpoint so the propose is fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, id: created.id, name: created.name, ...forwardReplacement(created) };
}

/**
 * `skill_transition` — moves a skill through its workflow, the MCP counterpart of
 * `mnema skill move`. Both surfaces call the SAME operations, so the gate accepts
 * and refuses identically; only the transport differs.
 *
 * The transition follows the ENTITY, not the session's scope: it locates the
 * skill's home tree ({@link locateEntityInSession}) and opens THAT writer, so the move
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
  const scope = locateEntityInSession(session, input.id);
  if (scope === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_SKILL',
      message: notFoundInVisibleTrees(session, 'skill', input.id),
    };
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

  const { ctx, run } = openWrite(session, scope);
  const fields = skillProofToFields(input);
  // Every move carries the session's `which` (the executing agent) and `run`, so
  // the transition is attributed to the agent even when it lands in the public
  // tree — who (the machine) != which (the agent) is preserved on a skill move
  // exactly as it is on a task move.
  const stamp = { which: session.which, run };
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
  return { ok: true, id: input.id, name, to: moved.to, ...forwardReplacement(moved) };
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
 * Takes the session's cache over its resolved tree and composes the copilot's
 * `bootstrap` derivation for the machine's anchor (`who`): where the actor left
 * off, the actionable work, and the NAMES of the adopted patterns. Read-only —
 * it opens no writer and emits no event. The actor's cache is over the ONE
 * resolved tree (the session's), not the union of all three; a session works on
 * one tree, and that is the context it serves. The skills are the exception the
 * copilot documents: they come from every tree this session can see, because a
 * pattern applies to the work whatever tree it was adopted in.
 *
 * The caches come from the session's registry rather than being opened here, so
 * a second read in the same connection reuses the replay this one paid for. The
 * registry rebuilds one when a write has made it stale, so what this reads is
 * always the chain as it stands — the reuse is invisible to the answer.
 */
export function runBootstrap(session: Session): Bootstrap {
  const chainRoot = chainRootForScope(session.trees, session.scope) as string;
  return bootstrap(session.caches.get(chainRoot), { actor: session.who }, skillCaches(session));
}

/**
 * The trees of the session's OWN project, each paired with the scope it stands for
 * and with the project itself, in a fixed order. Outside a project that is the global
 * tree alone; inside one it is public, private and global — the team's record, this
 * machine's, and the personal cross-project one.
 *
 * The sources of the reads whose question IS scoped to a project — `search` ("what is
 * in this record"), `accountability` ("who authorized what here"). For a read keyed by
 * an id, whose question is not, see {@link workspaceCaches}.
 *
 * Asking the registry means each is warm after the first read of that tree, and
 * rebuilt when this session's own writes left it behind. The order here does not
 * reach an answer: every reader over these sorts by a property of the CONTENT,
 * precisely so the order the trees are read in cannot reshuffle what an agent
 * sees.
 */
function scopedCaches(session: Session): ScopedCache[] {
  return scopedCachesOf(session, session.trees, session.project);
}

/** The order the trees of one project are read in — a role at a time, fixed. */
const SCOPE_ORDER = ['public', 'private', 'global'] as const;

/**
 * Every tree of every project this workspace holds — the sources of a read keyed by
 * an ID.
 *
 * The boundary of a project is not a property of such a question. An id is minted
 * once and lives in one tree, so "what does this record say" has one answer wherever
 * it was written; the entities that point AT something are regularly the ones in the
 * OTHER projects (that is what normalizing a fix across three codebases produces);
 * and a history does not end where a repository does. Asking one project and
 * answering about the world is the shape of claim this product exists not to make —
 * and it is worse than a short answer, because the reply looks complete.
 *
 * It is not a flag and takes no argument, deliberately. The surface already reads
 * every tree for `skills` (a capability is not scoped to a project) and one tree for
 * `work` (work is): what decides is the NATURE of the question, which is fixed per
 * tool, and an option to choose would put a decision on the caller that the caller
 * has no better information to make.
 *
 * The session's OWN trees come first, and BY {@link scopedCaches} — so a workspace
 * with one project produces that list and nothing else, which is the non-regression
 * held by construction rather than by two loops agreeing. It also means a read cannot
 * lose what the session could already see, whatever the announced list turns out to
 * hold.
 *
 * Deduplicated by CHAIN ROOT, and the machine-global tree is why it has to be. Every
 * project resolves the same global tree, so iterating projects hands that one tree
 * over N times — and a reader given the same tree three times reports each of its
 * facts three times. Two of the three readers here would have absorbed it silently
 * (a merged history would not; see the test), which is exactly the reason to dedupe
 * at the source rather than rely on each reader's own keying.
 */
function workspaceCaches(session: Session): ScopedCache[] {
  const sources = scopedCaches(session);
  const seen = new Set(sources.map((source) => source.chainRoot));
  for (const project of session.workspaceProjects) {
    for (const source of scopedCachesOf(session, project.trees, project.dir)) {
      if (seen.has(source.chainRoot)) continue;
      seen.add(source.chainRoot);
      sources.push(source);
    }
  }
  return sources;
}

/**
 * One project's trees as read sources, each labelled with the project — except the
 * global tree, which belongs to none.
 *
 * The label is dropped for `global` at this one place, so no caller can attach it: a
 * personal cross-project note reported as coming from whichever project a read
 * reached it through would be a false claim about where to find it, and the tree is
 * shared, so every project would make that claim differently.
 */
function scopedCachesOf(
  session: Session,
  trees: ResolvedTrees,
  project: string | undefined,
): ScopedCache[] {
  const sources: ScopedCache[] = [];
  for (const scope of SCOPE_ORDER) {
    const root = chainRootForScope(trees, scope);
    if (root === undefined) continue;
    sources.push({
      scope,
      chainRoot: root,
      ...(scope !== 'global' && project !== undefined ? { project } : {}),
      cache: session.caches.get(root),
    });
  }
  return sources;
}

/**
 * The caches whose adopted skills this session can see — every tree, because a
 * pattern is a CAPABILITY and applies to the work whatever tree it was adopted
 * in. The scope is dropped here: a skill is served by name and body, and which
 * tree it was adopted in is not something an agent acts on.
 */
function skillCaches(session: Session): ProjectionCache[] {
  return scopedCaches(session).map((source) => source.cache);
}

/** The adopted patterns served, or a typed refusal when one was asked for by id. */
export type SkillsResult =
  | (Replacement & {
      readonly ok: true;
      /** The adopted patterns, each with its body. Empty when none are adopted. */
      readonly skills: readonly AdoptedSkill[];
    })
  | {
      readonly ok: false;
      /**
       * `UNKNOWN_SKILL` when no visible tree holds the id, `NOT_ADOPTED` when one
       * does but the pattern is not live, or the core's own code when recording
       * the consultation was refused.
       */
      readonly code: string;
      /** The human-readable reason. */
      readonly message: string;
    };

/**
 * `skills` — serve the adopted patterns, and record that they were served.
 *
 * With no argument it returns every adopted pattern WITH its body; with an `id`
 * it returns that one. This is the read the `bootstrap` names point at: the
 * opening context lists patterns by name (one line each), and this is where the
 * body comes from when a name turns out to match the task at hand.
 *
 * Named `…Tool` because the command line has a `runSkills` of its own doing
 * something else — this serves a pattern to an agent, that audits where every
 * pattern came from for a person — the same split `runFocus`/`runFocusTool` and
 * `runSearch`/`runSearchTool` already carry.
 *
 * Each pattern comes back with the agent that adopted it, which the projection
 * folds off the adopting transition's envelope. The transport frames that in one
 * line beside the bodies: a body is served as instruction, and until it carried
 * its adopter nobody receiving it could see who put it there.
 *
 * It is a read that WRITES, deliberately, and it is the only one. Whether work
 * was informed by a pattern is not derivable after the fact — nothing else in
 * the record would ever show it — so the moment of serving is the only moment
 * the fact can be captured, and a session that passes without it is a session
 * that can never be compared. What lands is `skill.consulted`, ONE per (run,
 * skill): consulting the same pattern twice in one run is one run that used it. The
 * deduplication is the session's own memory ({@link Session.consulted}), not a
 * query, and it is asked per RUN — a connection has one per project it writes to,
 * and a pattern used in two projects is two facts.
 *
 * The consultation lands in the session's OWN tree, and this takes no `project`: it
 * is a fact about a reading, and the reading happened here. So a session whose work
 * goes to a second project records that work there and this consultation here —
 * honest about what each event is, and leaving the second project's record unable to
 * show on its own which pattern informed it.
 *
 * The fact says CONSULTED, never "followed". Reading a pattern and ignoring it
 * is possible, and nothing observable here separates the two.
 *
 * Nothing is recorded for a call that serves nothing — an empty workspace, an
 * unknown id, a skill that is not adopted. A refusal to record IS surfaced
 * rather than swallowed: a silently unrecorded consultation is exactly the
 * perishable fact this exists to capture, so it is reported like any other
 * refused write.
 */
export function runSkillsTool(session: Session, input: { id?: string } = {}): SkillsResult {
  // READ before WRITE: the caches are consulted first, because building a write
  // context marks the written tree stale — doing it the other way round would
  // make every call rebuild the tree it is about to read.
  const caches = skillCaches(session);
  const served = input.id === undefined ? undefined : lookupAdoptedSkill(caches, input.id);
  if (served?.outcome === 'unknown') {
    return {
      ok: false,
      code: 'UNKNOWN_SKILL',
      // `input.id` is defined here — `served` is undefined without it.
      message: notFoundInVisibleTrees(session, 'skill', input.id as string),
    };
  }
  if (served?.outcome === 'not-adopted') {
    return {
      ok: false,
      code: 'NOT_ADOPTED',
      message: `skill "${input.id}" is ${served.state}, not an adopted pattern`,
    };
  }
  const skills = served === undefined ? adoptedSkills(caches) : [served.skill];

  const recorded = recordConsultations(session, skills);
  if (!recorded.ok) return recorded;
  // This is a READ that writes, so it is the one place a replacement report could
  // reasonably be dropped — and dropping it is exactly the silence the report
  // exists against. A consultation carries the session's agent name on its
  // envelope like every other fact, so if that name held a credential this call is
  // the one that recorded it, and this reply is where the caller can still act.
  return { ok: true, skills, ...forwardReplacement(recorded) };
}

/**
 * Records one `skill.consulted` for each pattern served that this RUN has not
 * already recorded, in the session's default scope — the agent's own tree, like
 * every other fact it produces. The subject may name a skill that lives in
 * ANOTHER tree (a public pattern read by a private session); that is an honest
 * cross-tree reference, resolved on read.
 *
 * The dedup is asked per run, and the run is identified by the tree these facts go
 * to (see {@link Session.consulted}) — which is also why the question is asked
 * BEFORE the write context is built rather than off the run the door returns. What
 * this decides is whether to write at all, and a call that turns out to have nothing
 * to record must not have opened a run, or marked a cache stale, to find that out.
 *
 * A skill joins the run's set only once its fact is on the chain, so a refused
 * write leaves it eligible for a later attempt rather than marking it recorded. All
 * the facts share one write context and one checkpoint: they are one act of
 * consultation, and signing once is cheaper than signing each.
 */
function recordConsultations(
  session: Session,
  skills: readonly AdoptedSkill[],
):
  | (Replacement & { readonly ok: true })
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const root = chainRootForScope(session.trees, session.scope) as string;
  const already = session.consulted.get(root);
  const fresh = already === undefined ? skills : skills.filter((skill) => !already.has(skill.id));
  if (fresh.length === 0) return { ok: true };

  const { ctx, run } = openWrite(session, session.scope);
  // The set for this run, created on the first consultation recorded against it.
  const recordedInRun = already ?? new Set<string>();
  session.consulted.set(root, recordedInRun);
  let appended = 0;
  // The classes across every consultation this call appended, distinct: the agent
  // name is the same on all of them, so listing it once per skill would turn one
  // dirty session name into a report as long as the pattern list.
  const replaced = new Set<SecretClass>();
  for (const skill of fresh) {
    const done = recordConsultation(ctx, {
      skill: skill.id,
      which: session.which,
      run,
    });
    if (!done.ok) {
      // Every fact here shares one authority decision, so this is unreachable
      // for a real client — but a fact already appended must still be signed.
      if (appended > 0) ctx.writer.checkpoint();
      return { ok: false, code: done.code, message: done.message };
    }
    recordedInRun.add(skill.id);
    appended += 1;
    for (const secret of done.replaced ?? []) replaced.add(secret);
  }
  // Checkpoint so the consultations are fully signed the moment the tool returns.
  ctx.writer.checkpoint();
  return { ok: true, ...(replaced.size > 0 ? { replaced: [...replaced] } : {}) };
}

/**
 * `focus` — the session actor's open runs (what they are touching now).
 *
 * The read mold applied to the copilot's `focus`: take the session's cache over
 * its resolved tree and derive for the session's `who`. Read-only — no writer,
 * no event. The actor is the session's anchor (never a client-supplied value),
 * so the result carries only the machine's OWN open runs.
 */
export function runFocusTool(session: Session): Focus {
  const chainRoot = chainRootForScope(session.trees, session.scope) as string;
  return focus(session.caches.get(chainRoot), { actor: session.who });
}

/**
 * `resume` — where the session actor left off: their latest run plus focus.
 *
 * The read mold applied to the copilot's `resume`. Read-only. Like `focus`, the
 * actor is the session's `who`, so the latest run reported is the machine's own —
 * open OR already ended, the "where was I" anchor.
 */
export function runResumeTool(session: Session): Resume {
  const chainRoot = chainRootForScope(session.trees, session.scope) as string;
  return resume(session.caches.get(chainRoot), { actor: session.who });
}

/** The task's legal moves, or a typed refusal when no visible tree holds it. */
export type NextActionsResult =
  | {
      readonly ok: true;
      /** The transitions the workflow allows from the task's state; empty when terminal. */
      readonly actions: readonly NextAction[];
    }
  | {
      readonly ok: false;
      /** No visible tree holds a task with this id. */
      readonly code: 'UNKNOWN_TASK';
      /** The human-readable reason. */
      readonly message: string;
    };

/**
 * `next_actions` — the moves the workflow allows a task next.
 *
 * Keyed by an ENTITY, not the actor: it locates the task's home tree
 * ({@link locateEntityInSession}) — a task lives in exactly one of the session's
 * trees — takes THAT tree's cache, and returns the copilot's `nextActionsForTask`.
 * Read-only. An id no visible tree holds is refused `UNKNOWN_TASK` (returned as
 * data so the server shapes it into a tool error, never thrown); an existing
 * terminal task yields an empty list — "no legal moves", not "no such task".
 *
 * This is the read that makes the session's caches per-TREE rather than one: the
 * tree it serves is the entity's, which need not be the session's own. Asking
 * the registry by chain root keeps those apart — a task read out of the public
 * tree can never be answered from the private tree's projection.
 */
export function runNextActionsTool(session: Session, input: { id: string }): NextActionsResult {
  const scope = locateEntityInSession(session, input.id);
  if (scope === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_TASK',
      message: notFoundInVisibleTrees(session, 'task', input.id),
    };
  }
  const chainRoot = chainRootForScope(session.trees, scope) as string;
  const actions = nextActionsForTask(session.caches.get(chainRoot), input.id);
  // The birth was located, so a null here is not a missing task: this session has
  // no state for it in that tree — its history stops at the creation, or another
  // process appended past what this session has read. Report that rather than a
  // false empty terminal list, and name the tree, because repeating the sentence
  // above would deny a birth this very call just found.
  if (actions === null) {
    return {
      ok: false,
      code: 'UNKNOWN_TASK',
      message: bornHereButUnreadable(session, 'task', input.id, scope),
    };
  }
  return { ok: true, actions };
}

/** A guard verdict (plus the asker's focus), or a typed refusal when no tree holds the task. */
export type GuardResult =
  | {
      readonly ok: true;
      /** The gate's verdict for the simulated move, paired with the session actor's focus. */
      readonly result: GuardWithFocus;
    }
  | {
      readonly ok: false;
      /** No visible tree holds a task with this id. */
      readonly code: 'UNKNOWN_TASK';
      /** The human-readable reason. */
      readonly message: string;
    };

/**
 * `guard` — a DRY-RUN of the workflow gate: "would this move be allowed on this
 * task, and if not, why?" — the MCP counterpart of `mnema guard`. Read-only: it
 * locates the task's home tree ({@link locateEntityInSession}), takes THAT tree's
 * cache, reads the task's current state as the `from`, and calls the copilot's
 * pure {@link guardWithFocus} — no writer, no event. The verdict is the gate's
 * own, the SAME function `task_transition` consults, so a guard that says ALLOWED
 * and a move that succeeds can never drift.
 *
 * The actor is the session's `who` (never a client-supplied value), so the
 * simulated authority is the machine's own — and it is paired with the actor's
 * focus, so the agent gets "you may (or may not) do this, and here is what you
 * are in the middle of" in one read. The proof (`note`/`reason`/`feedback`) and
 * `which` are simulated exactly as a real move would carry them: with the
 * required proof the verdict is ALLOWED, without it REFUSED (MISSING_PROOF), the
 * useful "you are only missing the note" answer. An id no visible tree holds is
 * refused `UNKNOWN_TASK`, returned as data so the server shapes it into a tool
 * error (never thrown).
 */
export function runGuardTool(
  session: Session,
  input: {
    id: string;
    action: string;
    reason?: string;
    note?: string;
    feedback?: string;
    which?: string;
  },
): GuardResult {
  const scope = locateEntityInSession(session, input.id);
  if (scope === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_TASK',
      message: notFoundInVisibleTrees(session, 'task', input.id),
    };
  }
  const chainRoot = chainRootForScope(session.trees, scope) as string;
  const cache = session.caches.get(chainRoot);
  const task = cache.getTask(input.id);
  // The birth was located, so a null here is not a missing task: this session has
  // no state for it in that tree (a history that stops at the creation, or a write
  // by another process it has not read). Refuse rather than simulate from a state
  // we cannot read, and name the tree instead of denying the birth just found.
  if (task === null) {
    return {
      ok: false,
      code: 'UNKNOWN_TASK',
      message: bornHereButUnreadable(session, 'task', input.id, scope),
    };
  }
  const fields = proofToFields(input);
  const result = guardWithFocus(cache, {
    from: task.state,
    action: input.action,
    who: session.who,
    ...(fields !== undefined ? { fields } : {}),
    ...(input.which !== undefined ? { which: input.which } : {}),
  });
  return { ok: true, result };
}

/** The index of what matched, or a refusal (a scope or a kind that is not there). */
export type SearchToolResult =
  | {
      readonly ok: true;
      /** The hits, each marked with the tree it came from, plus the true total. */
      readonly value: RecordSearch;
    }
  | {
      readonly ok: false;
      /** `SCOPE_UNAVAILABLE` (a tree absent here) or `UNKNOWN_KIND`. */
      readonly code: 'SCOPE_UNAVAILABLE' | 'UNKNOWN_KIND';
      /** The human-readable reason. */
      readonly message: string;
    };

/**
 * `search` — find records across the trees this session can see, or list the
 * most recent ones.
 *
 * The read that makes the record readable. Everything an agent captures — a
 * memory, an observation, a decision, a task, a skill — was write-only until
 * now: recoverable by id if you still had the id, and otherwise gone. This
 * returns an INDEX of what matched (id, kind, tree, instant, one line each),
 * never the bodies; `read_record` serves one whole record when the index says
 * which one is worth reading.
 *
 * The term is OPTIONAL. Without one the answer is the most recent records —
 * "what has been going on here" — and with one it is the best matches. They are
 * the same read because an inverted index makes them the same query.
 *
 * Read-only in the strict sense: it asks the session's warm caches and composes
 * the copilot's pure `searchRecords`. No writer, no event — including for a
 * skill, whose NAME may appear here. Only serving a skill's BODY is a
 * consultation worth recording, and that has its own tool.
 */
export function runSearchTool(session: Session, input: RecordQuery = {}): SearchToolResult {
  // A scope this context does not have would silently return nothing, which
  // reads as "no matches" when the truth is "that tree is not here".
  if (input.scope !== undefined && chainRootForScope(session.trees, input.scope) === undefined) {
    return {
      ok: false,
      code: 'SCOPE_UNAVAILABLE',
      message: `no ${input.scope} tree here — a session outside a project has only the global scope`,
    };
  }
  // The kinds are a closed vocabulary. The transport's schema already names
  // them, but this adapter is a function anyone may call, and an unrecognized
  // kind that quietly matched nothing would be indistinguishable from an empty
  // record.
  if (input.kind !== undefined && !isSearchKind(input.kind)) {
    return {
      ok: false,
      code: 'UNKNOWN_KIND',
      message: `"${input.kind}" is not a kind of record — one of: ${SEARCH_KINDS.join(', ')}`,
    };
  }
  return { ok: true, value: searchRecords(scopedCaches(session), input) };
}

/** One whole record, or a typed refusal. */
export type ReadRecordResult =
  | {
      readonly ok: true;
      /** The record with the projection the chain proves, and the tree it lives in. */
      readonly value: RecordBody;
    }
  | {
      readonly ok: false;
      /** `UNKNOWN_RECORD`, or `USE_SKILLS_TOOL` for a pattern's body. */
      readonly code: 'UNKNOWN_RECORD' | 'USE_SKILLS_TOOL';
      /** The human-readable reason. */
      readonly message: string;
    };

/**
 * `read_record` — the whole of one record, by the id the index gave.
 *
 * The second half of the search: the index says what exists and this says what
 * it says. It looks in every tree of every project this workspace holds (an id
 * lives in exactly one) and returns the projection the chain proves, marked with
 * that tree AND with the project that owns it. Read-only: no writer, no event.
 *
 * The union is not a widening of the question, it is the question. An id is minted
 * once; which project it landed in is a fact about where the work happened, not a
 * filter the caller meant to apply — so looking in one project and reporting "no
 * record" is a false answer with a true-sounding shape, and it is the answer an agent
 * got for any id from a sibling project of the same workspace.
 *
 * A SKILL is refused here, and pointed at the `skills` tool instead. Two reasons,
 * both of them the skills tool's own rules: serving a pattern's body is a
 * consultation, and that fact is derivable from nothing else afterwards; and
 * only ADOPTED patterns are served, because handing an agent the body of a way
 * of working the team retired is worse than handing it nothing. Letting a body
 * out through a second door would quietly undo both. The auditor's surface (the
 * CLI) makes the opposite call for the opposite reason: a person curating
 * patterns has to be able to read the one they are about to reject.
 */
export function runReadRecordTool(session: Session, input: { id: string }): ReadRecordResult {
  const record = readRecord(workspaceCaches(session), input.id);
  if (record === null) {
    return { ok: false, code: 'UNKNOWN_RECORD', message: notInAnyProject(session, input.id) };
  }
  if (record.kind === 'skill') {
    return {
      ok: false,
      code: 'USE_SKILLS_TOOL',
      message:
        `"${input.id}" is a skill — read it with the \`skills\` tool, which serves ` +
        'the adopted patterns and records that they were consulted',
    };
  }
  return { ok: true, value: record };
}

/**
 * What `read_record` says about an id no tree of the workspace holds: WHERE IT
 * LOOKED, and nothing more.
 *
 * The sentence had to grow because the search did. It used to say "in any tree this
 * session can see", which was true of three trees and is now true of every tree of
 * every project — a claim that got wider without a word of it changing, which is the
 * kind of sentence a reader cannot check. So it names the projects, the same way the
 * entity-keyed refusals name the one project they search
 * ({@link notFoundInVisibleTrees}) and the same way a routed write names the projects
 * it could have meant ({@link namedProjects}, shared with those).
 *
 * It still does not say the id does not exist, and now it has more reason not to: the
 * read covered every project the client announced, and that is still not the world — a
 * project nobody opened, and a partial clone of one that was, both hold records this
 * cannot see. What is reported is the search.
 *
 * ⚠️ The id goes through {@link oneLine}, because unlike a project path it comes from
 * the CALLER. A refusal is read as one line, so an id holding a newline lets the
 * argument write a second, well-formed refusal about something nobody asked — the
 * defect measured on a directory name, one step closer to whoever is calling.
 */
function notInAnyProject(session: Session, id: string): string {
  if (session.workspaceProjects.length === 0) {
    return (
      `no record with id "${oneLine(id)}" in the machine-global tree, the only tree ` +
      'this session sees — it resolved to no project'
    );
  }
  return (
    `no record with id "${oneLine(id)}" in any tree of this workspace's projects ` +
    `(${namedProjects(session.workspaceProjects)}) or in the machine-global tree — ` +
    'the only trees this session sees'
  );
}

/** An intelligence read's result: the derivation, or a refusal when no project. */
type IntelligenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      /** There is no project here — an intelligence read is about a project's record. */
      readonly code: 'NO_PROJECT';
      /** The human-readable reason. */
      readonly message: string;
    };

/** The `audit_timeline` result — the entity's history, or a refusal. */
export type TimelineToolResult = IntelligenceResult<readonly TimelineEntry[]>;

/** The `audit_accountability` result — the account, or a refusal. */
export type AccountabilityToolResult = IntelligenceResult<Accountability>;

/** The `audit_antipatterns` result — the recurring shapes, or a refusal. */
export type AntipatternsToolResult = IntelligenceResult<Antipatterns>;

/**
 * The refusal an intelligence read gives with no project, shared by the three.
 * An intelligence read is the auditor's view of a PROJECT's record; a session on
 * the global tree alone has no project to audit, so it refuses `NO_PROJECT`
 * (returned as data so the server shapes it into a tool error), the same refusal
 * the CLI intelligence reads give.
 *
 * In a project, WHICH trees the read then folds depends on the read: the two keyed by
 * an id fold every project of the workspace ({@link workspaceCaches}), and
 * `accountability` folds the session's own ({@link scopedCaches}) — "who authorized
 * what" is a question about a record, and summing three projects would answer a
 * different one under the same name. The guard is shared because the CONDITION is
 * shared: without a project there is no record to audit, however wide the fold would
 * have been.
 */
function requireProject(
  session: Session,
): { readonly ok: false; readonly code: 'NO_PROJECT'; readonly message: string } | undefined {
  if (!session.inProject) {
    return {
      ok: false,
      code: 'NO_PROJECT',
      message: 'no project here — an intelligence read is about a project’s record',
    };
  }
  return undefined;
}

/**
 * `audit_timeline` — the whole history of one entity across every project of the
 * workspace.
 *
 * The auditor's counterpart of `next_actions`: it takes an id and merges every
 * tree's reference index into the entity's story — every event where it is the
 * subject, plus the events that refer to it (an observation `about` it, a link
 * whose `target` is it, a supersede whose successor it is), which may live in a
 * different tree AND in a different project. Read-only: it asks the session's warm
 * caches and composes the copilot's pure `timeline`, opening no writer. An id no
 * event touches yields an empty history (a valid answer, not a refusal); with no
 * project it refuses `NO_PROJECT`.
 *
 * The union is the story, not more of it. A fix written in one codebase and
 * normalized into two others has three quarters of its history outside the record it
 * started in; a history that stopped at the project boundary reported the first
 * quarter and read as the whole. Each entry says which project it came from, which is
 * what makes the merged list a history rather than a pile.
 */
export function runTimelineTool(session: Session, input: { id: string }): TimelineToolResult {
  const refused = requireProject(session);
  if (refused !== undefined) return refused;
  return { ok: true, value: timeline(workspaceCaches(session), input.id) };
}

/** The `audit_refs` result — the graph around an entity, or a refusal. */
export type ReferencesToolResult = IntelligenceResult<ReferenceGraph>;

/**
 * `audit_refs` — what an entity is connected to, across every project of the
 * workspace.
 *
 * The graph reading of the index `audit_timeline` reads: not the events that
 * touch an entity but the ENTITIES it connects to. One hop either way is its
 * neighbourhood — the natural next question after a `search` hit; a direction
 * and more depth is a lineage (a decision's supersede chain, everything derived
 * from a memory).
 *
 * `direction: 'in'` over the union is the question this whole surface was extended
 * for: *"have I normalized this in all three?"* The entities that point AT something
 * are the ones in the OTHER projects — that is what normalizing produces — so asking
 * one project answers with the edges of the project least likely to have any, and the
 * answer used to declare itself complete while doing it. Each edge now says which
 * project's record asserts it, which is what turns a count into an account.
 *
 * It walks across trees, because an edge lives in the tree its event was written
 * to while its far end may live in another. A far end no visible tree ever
 * authored comes back marked unresolved rather than dropped, and an answer the
 * depth cut says so — which is a promise the union makes harder to keep and not
 * easier: a graph that fitted inside the cap over one project can be cut by it over
 * three, and the cut has to keep declaring itself. Read-only: the session's warm
 * caches and the copilot's pure `references`; with no project it refuses `NO_PROJECT`.
 */
export function runReferencesTool(
  session: Session,
  input: { id: string; direction?: ReferenceDirection; depth?: number },
): ReferencesToolResult {
  const refused = requireProject(session);
  if (refused !== undefined) return refused;
  return { ok: true, value: references(workspaceCaches(session), input) };
}

/**
 * `audit_accountability` — who authorized what across the session's trees.
 *
 * Sums every present tree's grouped counts into a factual account of authorship.
 * With no filter it accounts for the whole record (git shortlog -sn);
 * `from`/`to`/`who`/`which` only narrow it — they are aggregation filters, never
 * the session actor's identity (the session's `who` is not imposed as a filter).
 * Read-only: the session's warm caches and the copilot's pure `accountability`.
 * With no project it refuses `NO_PROJECT`.
 */
export function runAccountabilityTool(
  session: Session,
  input: AccountabilityFilter = {},
): AccountabilityToolResult {
  const refused = requireProject(session);
  if (refused !== undefined) return refused;
  return { ok: true, value: accountability(scopedCaches(session), input) };
}

/** The `audit_exposure` result — where a credential format sits, or a refusal. */
export type ExposureToolResult = IntelligenceResult<Exposure>;

/**
 * `audit_exposure` — which records hold something shaped like a credential.
 *
 * The one intelligence read about the record's PAST rather than its shape. Writing
 * screens what arrives, so an agent cannot put a recognized credential into the
 * chain today; everything written before that could, and in a committed tree the
 * past is what decides the damage. This is how an agent asked to check finds out.
 *
 * It answers WHERE and never WHAT — the id, the kind, the tree, the instant and the
 * class. There is no value in the result to return, by construction, because the
 * detector behind it reports classes only: a tool that handed a credential back
 * would put it in a transcript, which is a second disclosure and a worse one (a
 * transcript travels further than a chain).
 *
 * It takes the trees SEPARATELY rather than merged, unlike the other `audit_*`
 * reads: a fact in the public tree is committed and clones to the team, and the
 * same fact in the global tree is on one disk — the merge is exactly what would
 * lose the difference. Read-only: it reads the tails and folds them, opening no
 * writer and no cache. With no project it refuses `NO_PROJECT`.
 */
export function runExposureTool(session: Session): ExposureToolResult {
  const refused = requireProject(session);
  if (refused !== undefined) return refused;
  return { ok: true, value: exposure(scopedEvents(session.trees, catalogUpcasters())) };
}

/**
 * `audit_antipatterns` — recurring shapes across the session's trees.
 *
 * Folds the UNION of the session's present trees and surfaces the shapes that
 * recur (reopened tasks, superseded decisions, deprecated skills), each with its
 * evidence, plus the skill candidates POINTED at. It points, it does not conclude,
 * and it creates no skill. Read-only: it reads the tails and folds them with the
 * copilot's pure `antipatterns`. With no project it refuses `NO_PROJECT`.
 */
export function runAntipatternsTool(session: Session): AntipatternsToolResult {
  const refused = requireProject(session);
  if (refused !== undefined) return refused;
  const events = unionEvents(session.trees, catalogUpcasters());
  return { ok: true, value: antipatterns(events) };
}
