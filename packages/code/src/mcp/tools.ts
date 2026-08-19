/**
 * The MCP tools, as thin adapters.
 *
 * Each tool is the MCP counterpart of a CLI command: it takes the session's
 * resolved context, calls ONE core function, and returns what that function
 * returned. It holds no domain logic — the id is minted by the operation, the
 * actor is the session's `who`. WHERE a NEW write lands is a per-action choice in
 * two dimensions: the PROJECT (the session carries the cascade's answer, overridable
 * per call with `project`) and the TREE inside it (the KIND decides, overridable per
 * call with `scope`). The second one is NOT the session's — the tree follows what the
 * fact IS, and the kind only exists here, at the tool. Both are answered by one
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
 * nothing), `skills` (the one read that also WRITES: it serves a pattern's body and
 * records that it was served, because that fact is derivable
 * from nothing else afterwards), `search`/`read_record` (the read mold widened to
 * every tree the session can see: an index of what matched, then one whole record
 * by the id that index gave), and the intelligence reads `runTimelineTool`/
 * `runReferencesTool`/`runAccountabilityTool`/`runAntipatternsTool`/
 * `runExposureTool` (the auditor's view — they fold every tree of every project the
 * workspace holds, opening no cache and no writer; `runExposureTool` keeps them
 * separate because its answer has to name the tree). The knowledge
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
  type AccountabilityFilter,
  type AskerContext,
  accountabilityByProject,
  adoptedSkills,
  antipatternsByProject,
  type Bootstrap,
  bootstrap,
  type Focus,
  focus,
  type GoverningRules,
  type GuardWithFocus,
  guardWithFocus,
  lookupServedSkill,
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
  type ServedSkill,
  type SkillCatalogue,
  searchRecords,
  skillCatalogue,
  type TimelineEntry,
  timeline,
  type WorkspaceAccountability,
  type WorkspaceAntipatterns,
  type WorkspaceExposure,
  workspaceExposure,
} from '@mnema/copilot';
import {
  chainRootForScope,
  DECISION_ACTIONS,
  deriveAlias,
  isSearchKind,
  type ProjectionCache,
  type ReferenceDirection,
  type Scope,
  SEARCH_KINDS,
  type SecretClass,
  SKILL_ACTIONS,
  systemClock,
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
import { readGoverningRules } from '../governed-tree.js';
import {
  projectEventsOf,
  recordTrees,
  type ScopedTree,
  scopedEventsOf,
} from '../intelligence-source.js';
import { movedDisplay } from '../moved-record.js';
import { oneLine } from '../one-line.js';
import { forwardReplacement, type Landed, type Replacement } from '../recorded-content.js';
import {
  type EntityLocation,
  inEveryTreeThisSessionSees,
  locatedButUnreadable,
  locateEntityAcross,
  notFoundInSessionTrees,
  refuseUnlocated,
  type WorkspaceTree,
} from './locate.js';
import { routeWrite } from './route.js';
import { openWrite, type Session } from './session.js';

/** A memory was captured, or the requested scope was not available here. */
export type CaptureResult =
  | (Replacement &
      Landed & {
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
  | (Replacement &
      Landed & {
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
  | (Replacement &
      Landed & {
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
  | (Replacement &
      Landed & {
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
 * The destination is a per-action choice: an explicit `project` names which of the
 * workspace's projects it belongs to, and an explicit `scope` which of that project's
 * trees. Omitted, the project is the one the cascade landed on and the tree is the
 * rule's answer for this KIND — which for a memory is the one place the rule still
 * reads the AUTHOR, so an agent's capture goes private (global outside a project).
 * That exception is deliberate and documented in the core: the same kind holds a fact
 * the team needs and a note that is nobody's business but the writer's, so the kind
 * cannot say who it is for.
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
  const route = routeWrite(session, 'memory.captured', input);
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
  return { ok: true, id: captured.id, scope: route.scope, ...forwardReplacement(captured) };
}

/** An observation was recorded, or the requested scope was not available here. */
export type RecordObservationResult =
  | (Replacement &
      Landed & {
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
  | (Replacement &
      Landed & {
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
 * per-action choice: an explicit `project` and `scope` win, else the cascade's project
 * and the rule's answer for this kind — the other kind that still reads the author, so
 * an agent's observation goes private. An observation mints its OWN id (it is an
 * entity), which is returned.
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
  const route = routeWrite(session, 'observation.recorded', input);
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
  return { ok: true, id: recorded.id, scope: route.scope, ...forwardReplacement(recorded) };
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
  const route = routeWrite(session, 'handoff.recorded', input);
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
    scope: route.scope,
    ...forwardReplacement(recorded),
  };
}

/**
 * `link_knowledge` — links one entity to another, the MCP counterpart of `mnema
 * link`. The destination is a per-action choice (`project`, then `scope`); omitted,
 * the cascade's project and the tree this KIND names — a link asserts a relation
 * between the project's records, so it travels with them. A link mints NO id (it is an
 * edge), so the result carries no id.
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
  const route = routeWrite(session, 'knowledge.linked', input);
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
  return {
    ok: true,
    recorded: [recorded.rel],
    scope: route.scope,
    ...forwardReplacement(recorded),
  };
}

/**
 * `create_task` — creates a task, the MCP counterpart of `mnema task`. Until it
 * existed the agent could MOVE tasks but never open one, so an agent told to
 * break work down had no tool for it — the asymmetry this closes.
 *
 * The birth mold of `create_skill` exactly: the destination is a per-action choice (an
 * explicit `project` and `scope` win, else the cascade's project and the tree this KIND
 * names — the team's board travels), the id is MINTED by the operation, and the write is
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
  const route = routeWrite(session, 'task.created', input);
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
    scope: route.scope,
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
 * tool LOCATES the task's home tree ({@link locateEntity}) and opens THAT tree's
 * writer; the session's scope governs where a session's NEW work is born, not where
 * an existing entity is moved. If no tree of the workspace holds the task, it
 * refuses `UNKNOWN_TASK`; if several records hold the id, `AMBIGUOUS_RECORD`.
 *
 * The home may be in ANOTHER project, and then the write is routed there — through
 * the same door a named write goes through ({@link openWrite}), so the move lands in
 * that project's tree and pins to that project's run. A birth routed to the second
 * project of a workspace used to succeed while the move of that same task was
 * refused: a task that could be created and not moved.
 *
 * That is also why a move takes no `project`, here or on the other two transitions,
 * while every BIRTH does: the entity's own tree is the answer, and a `project` could
 * only ever agree with it or contradict it. A birth takes one because there is no id
 * yet to ask.
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
  // entity so its history stays whole in one tree — in whichever project that is.
  const located = locateEntity(session, input.id);
  if (located.outcome !== 'found') return refuseUnlocated(session, 'task', input.id, located);

  const { ctx, run } = openWrite(session, located.home.scope, located.home.target);
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
 * `mnema decision`. The destination is a per-action choice: an explicit `project` and
 * `scope` win, else the cascade's project and the tree this KIND names — a decision is
 * a declaration about the project, so it goes to the record that travels. A decision
 * needs both a `title` and a `rationale`, both required by the schema; what it
 * turned down (`alternatives`) is optional and forwarded only when given, so a
 * decision with no contender records no key for one.
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
  input: {
    title: string;
    rationale: string;
    alternatives?: string;
    scope?: Scope;
    project?: string;
  },
): RecordDecisionResult {
  const route = routeWrite(session, 'decision.recorded', input);
  if (!route.ok) return route;
  const { ctx, run } = openWrite(session, route.scope, route.target);
  const recorded = recordDecision(ctx, {
    title: input.title,
    rationale: input.rationale,
    ...(input.alternatives !== undefined ? { alternatives: input.alternatives } : {}),
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
  return {
    ok: true,
    id: recorded.id,
    adr: recorded.adr,
    scope: route.scope,
    ...forwardReplacement(recorded),
  };
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
 * decision's home tree ({@link locateEntity}) and opens THAT writer, so the move
 * never splits the history — including when that tree belongs to another project of
 * the workspace, which the door routes to. If no tree of the workspace holds it,
 * `UNKNOWN_DECISION`; if several records do, `AMBIGUOUS_RECORD`.
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
  // the entity so its history stays whole in one tree — in whichever project it is.
  const located = locateEntity(session, input.id);
  if (located.outcome !== 'found') return refuseUnlocated(session, 'decision', input.id, located);

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

  const { ctx, run } = openWrite(session, located.home.scope, located.home.target);
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
  // name is the frozen label. Read the ONE tree the entity was located in, and read
  // it through the one function both surfaces resolve a moved display with, fallback
  // included.
  const adr = movedDisplay('decision', located.home.chainRoot, input.id, upcasters);
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
 * of `mnema skill`. Like `record_decision`, the destination is a per-action choice: an
 * explicit `project` and `scope` win, else the cascade's project and the tree this KIND
 * names — a pattern states how the work is done here, so it travels. A skill needs both
 * a `name` and a `body`, both required by the schema.
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
  const route = routeWrite(session, 'skill.created', input);
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
  return {
    ok: true,
    id: created.id,
    name: created.name,
    scope: route.scope,
    ...forwardReplacement(created),
  };
}

/**
 * `skill_transition` — moves a skill through its workflow, the MCP counterpart of
 * `mnema skill move`. Both surfaces call the SAME operations, so the gate accepts
 * and refuses identically; only the transport differs.
 *
 * The transition follows the ENTITY, not the session's scope: it locates the
 * skill's home tree ({@link locateEntity}) and opens THAT writer, so the move never
 * splits the history — including when that tree belongs to another project of the
 * workspace, which the door routes to. If no tree of the workspace holds it,
 * `UNKNOWN_SKILL`; if several records do, `AMBIGUOUS_RECORD`.
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
  // entity so its history stays whole in one tree — in whichever project it is.
  const located = locateEntity(session, input.id);
  if (located.outcome !== 'found') return refuseUnlocated(session, 'skill', input.id, located);

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

  const { ctx, run } = openWrite(session, located.home.scope, located.home.target);
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
  // alias. Read the ONE tree the entity was located in (not the session's own tree
  // of that scope, which is a different chain when the skill lives in another
  // project), through the one function that resolves a moved display and falls back
  // to the id.
  const name = movedDisplay('skill', located.home.chainRoot, input.id, upcasters);
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
 * Takes the session's caches over EVERY tree of its project and composes the
 * copilot's `bootstrap` derivation for the machine's anchor (`who`): where the actor
 * left off, the NAMES of the live work, the NAMES of the adopted patterns, and
 * the NAMES of the decisions in force. Read-only — it opens no writer and emits no
 * event.
 *
 * Names on every half, and each second read named in the tool's own description: the
 * moves a task allows come from `next_actions`, a pattern's body from `skills`, and a
 * decision's rationale from `read_record`. That an agent knows it may ask is the whole
 * of what makes an index an index, so it is stated where the agent reads before
 * calling, not only in the payload.
 *
 * THE SESSION'S PROJECT, not the workspace, and that is a choice rather than an
 * oversight. `sessionCaches` is the three trees of the project this connection landed
 * in; the decisions that govern THIS work are that project's. Widening it would drag
 * in the union question AND the cut that can silence a whole project without saying so
 * (`search` answers that one with `hidden`) — so if a later slice makes this read
 * workspace-wide, it owes the `hidden` half in the same change.
 *
 * Every tree, and no longer the one the session's writes defaulted to. A task lands
 * in the tree that travels and a memory in this machine's own, whoever wrote either,
 * so "the session's tree" names none of them in particular — and the work list read
 * from one came back EMPTY while looking like an answer. An agent told there is
 * nothing to do proceeds as if that were true, which is the worst shape the opening
 * read can have. It also closes the older half of the same hole: a person's tasks,
 * created on the command line into the committed tree, were invisible to every agent
 * session that asked what there was to do.
 *
 * The caches come from the session's registry rather than being opened here, so
 * a second read in the same connection reuses the replay this one paid for. The
 * registry rebuilds one when a write has made it stale, so what this reads is
 * always the chain as it stands — the reuse is invisible to the answer.
 */
export function runBootstrap(session: Session): Bootstrap {
  return bootstrap(sessionCaches(session), { actor: session.who, ...askerContext(session) });
}

/**
 * What THIS CONNECTION knows about itself that the record cannot hold: the runs it
 * opened, and the instant it is answering at.
 *
 * The runs come from `session.runs`, which is a STRUCTURAL fact rather than a claim
 * — the session opened them, so it knows their ids. That is the whole reason this
 * exists: the record cannot tell two sessions of one machine apart, because they
 * share the authorizing anchor, and the other candidate (compare the agent NAME) is
 * a declared value that two homonymous agents defeat. So the distinction has to come
 * from the party that cannot be wrong about it.
 *
 * EVERY run of the map, not the session's own tree's. A connection that wrote to a
 * second project holds a run there too, and a read served from one tree that omitted
 * it would report that run — if it ever saw it — as somebody else's.
 *
 * The clock is the CORE's, in the core's own uniform shape, because the answer
 * compares this instant against instants the core minted. A second format would still
 * parse and would still be honest; taking the same one means it cannot come to differ.
 *
 * Derived per call, never cached on the session: a session lives for hours, and an
 * `asOf` frozen at the handshake would report every run as being the age it was when
 * the connection opened.
 */
function askerContext(session: Session): AskerContext {
  return {
    asOf: systemClock(),
    sessionRuns: [...session.runs.values()].map((run) => run.id),
  };
}

/**
 * The trees of the session's OWN project, each paired with the scope it stands for
 * and with the project itself, in a fixed order. Outside a project that is the global
 * tree alone; inside one it is public, private and global — the team's record, this
 * machine's, and the personal cross-project one.
 *
 * The sources of the reads that serve THE SESSION rather than audit a record: the
 * skills it can see, and — through {@link workspaceCaches}, which starts here — the
 * first project of every read that spans the workspace. No read composes this list
 * directly any more; a question about a record reaches every project the client
 * announced, and this is the part of that answer the session already had.
 *
 * Asking the registry means each is warm after the first read of that tree, and
 * rebuilt when this session's own writes left it behind. The order here does not
 * reach an answer: every reader over these sorts by a property of the CONTENT,
 * precisely so the order the trees are read in cannot reshuffle what an agent
 * sees.
 */
function scopedCaches(session: Session): ScopedCache[] {
  return withCaches(session, recordTrees(session.trees, session.project));
}

/**
 * Every tree of every project this workspace holds — the sources of every read about
 * THE RECORD (the three keyed by an id, `search` and `accountability`, and the two
 * that fold TAILS rather than caches: `exposure`, `antipatterns`) AND the trees the
 * entity-keyed tools locate a home in ({@link locateEntity}).
 *
 * Exported for that last reader alone, and exported rather than reached for: the
 * locate takes the list, so which trees it covers is decided HERE, in the same
 * function that decides it for the seven reads. A locate that walked the workspace
 * itself would be the second place this rule lives, one week after it stopped being
 * two.
 *
 * The boundary of a project is not a property of such a question. An id is minted
 * once and lives in one tree, so "what does this record say" has one answer wherever
 * it was written; the entities that point AT something are regularly the ones in the
 * OTHER projects (that is what normalizing a fix across three codebases produces);
 * a history does not end where a repository does; and words a person wrote are in the
 * project they were written in, not the one a cascade picked. Asking one project and
 * answering about the world is the shape of claim this product exists not to make —
 * and it is worse than a short answer, because the reply looks complete.
 *
 * The list is the same for all seven; what differs is what each may MERGE from it, and
 * that follows from the shape of the answer rather than from an option. An index, a
 * history and a list of exposed records are ITEMS: widening them adds without
 * changing, so they merge, each item labelled with the project. An account of
 * authorship, a scan's denominator and a count of recurring shapes are AGGREGATES:
 * widening them sums, and a sum answers a different question under the same name — so
 * they come back decomposed, one entry per record, and no total across them.
 *
 * `exposure` is the read where BOTH halves of that rule land in ONE answer: its
 * findings merge and its denominator decomposes, which is what stops an empty list
 * from reading as "nothing is exposed" when it means "nothing was found in these
 * records".
 *
 * It is not a flag and takes no argument, deliberately. The surface already reads
 * every tree for `skills` (a capability is not scoped to a project) and one tree for
 * `work` (work is): what decides is the NATURE of the question, which is fixed per
 * tool, and an option to choose would put a decision on the caller that the caller
 * has no better information to make.
 *
 * The session's OWN trees come first — so a workspace with one project produces that
 * list and nothing else, which is the non-regression held by construction rather than
 * by two loops agreeing. It also means a read cannot lose what the session could
 * already see, whatever the announced list turns out to hold.
 *
 * Deduplicated by CHAIN ROOT, and the machine-global tree is why it has to be. Every
 * project resolves the same global tree, so iterating projects hands that one tree
 * over N times — and a reader given the same tree three times reports each of its
 * facts three times. Some of the readers here would have absorbed it silently and
 * some would not (a merged history would not, and neither would a count — it would
 * report every personal note three times over), which is exactly the reason to dedupe
 * at the source rather than rely on each reader's own keying.
 *
 * It is one list of TREES, not of caches, because the two reads that fold tails need
 * the same list and must not be handed a cache: their question is about the text of
 * every event, which no projection keeps. {@link withCaches} attaches a reader to it
 * for the five that do read projections, so which trees a read covers cannot come to
 * differ from how it reads them.
 *
 * Each tree of ANOTHER project also carries that project's write door
 * ({@link WorkspaceTree.target}), attached here because this is the one loop that
 * holds both the tree and the project object at once. A locate ends in a write, and
 * pairing them at the source is what stops a transition from reaching for the door by
 * name later and landing in the session's own trees when the lookup misses — a move
 * into the wrong repository, reported as success. The session's own trees and the
 * machine-global tree carry none: they are reached through the session, which is what
 * {@link openWrite} does when it is given no target.
 */
export function workspaceTrees(session: Session): WorkspaceTree[] {
  const trees: WorkspaceTree[] = recordTrees(session.trees, session.project);
  const seen = new Set(trees.map((tree) => tree.chainRoot));
  for (const project of session.workspaceProjects) {
    for (const tree of recordTrees(project.trees, project.dir)) {
      if (seen.has(tree.chainRoot)) continue;
      seen.add(tree.chainRoot);
      trees.push({ ...tree, target: project });
    }
  }
  return trees;
}

/**
 * Where an entity lives, across every tree of the workspace — the ONE locate every
 * entity-keyed tool asks, and the only place the coverage and the walk are put
 * together.
 *
 * Five tools call it, and each of them then refuses through {@link refuseUnlocated}
 * or writes through the home's own door. A tool that composed its own pair would get
 * a different answer than the other four: a narrower list is the defect this closed,
 * and a walk of its own is a second rule to keep in step.
 */
function locateEntity(session: Session, id: string): EntityLocation {
  return locateEntityAcross(session, workspaceTrees(session), id);
}

/** Every tree of the workspace with its warm projection cache attached. */
function workspaceCaches(session: Session): ScopedCache[] {
  return withCaches(session, workspaceTrees(session));
}

/**
 * The given trees as PROJECTION sources: each paired with the session's warm cache
 * over it.
 *
 * Asking the registry means each is warm after the first read of that tree, and
 * rebuilt when this session's own writes left it behind — so a read composes the
 * caches without knowing whether a replay just happened.
 */
function withCaches(session: Session, trees: readonly ScopedTree[]): ScopedCache[] {
  return trees.map((tree) => ({ ...tree, cache: session.caches.get(tree.chainRoot) }));
}

/**
 * The caches of every tree of the session's own project — the source of every read
 * that serves THE SESSION rather than audits a record: the opening context, the
 * actor's runs, the patterns it may use.
 *
 * The scope is dropped here, and that is what these answers have in common: none of
 * them names a tree. A pattern is a CAPABILITY and applies to the work whatever tree
 * it was adopted in; a run is the actor's session wherever it was opened; a task is
 * work whether the team's record holds it or this machine's. The readings that DO
 * label items by tree (the index, a history) take the sources themselves.
 *
 * It used to serve the skills alone, while the work and the runs came from the one
 * tree the session's writes defaulted to. Routing by kind removed that tree's claim
 * to be "the session's", so the asymmetry went with it.
 */
function sessionCaches(session: Session): ProjectionCache[] {
  return scopedCaches(session).map((source) => source.cache);
}

/** The patterns served, or a typed refusal when one was asked for by id. */
export type SkillsResult =
  /**
   * The catalogue the copilot decided ({@link SkillCatalogue}), verbatim: `served`
   * says whether the `skills` on it carry their bodies or are the NAMES of patterns
   * whose bodies did not fit one read. A caller reads the arm rather than the shape
   * of the items — which is also what makes a consumer that assumed bodies fail
   * loudly instead of quietly finding `body` undefined.
   */
  | (Replacement & { readonly ok: true } & SkillCatalogue)
  | {
      readonly ok: false;
      /**
       * `UNKNOWN_SKILL` when no visible tree holds the id, `NOT_SERVED` when one
       * does but its state is not one a body is served in, or the core's own code
       * when recording the consultation was refused.
       */
      readonly code: string;
      /** The human-readable reason. */
      readonly message: string;
    };

/**
 * `skills` — serve a pattern's body, and record that it was served.
 *
 * With no argument it returns every ADOPTED pattern — with their bodies when those
 * fit in one read, and by NAME when they do not ({@link skillCatalogue}); with an
 * `id` it returns that one with no ceiling at all, and a pattern the project has not
 * ruled on is served THERE and only there. This is the read the `bootstrap` names
 * point at, for both of its lists: the opening context lists the adopted patterns by
 * name and the ones awaiting a judgement by name, and this is where either body comes
 * from once a name turns out to matter.
 *
 * THE CEILING IS THE COPILOT'S, and it is asked here for the reason the disposition
 * is asked here: the sentence that frames names is this surface's, the decision that
 * they are what fits is not. The premise the paragraph above used to state — every
 * adopted body, however many there are — was falsified by measuring it: 40 patterns
 * of the market's median size came back at 146,431 B in one call, ~18% of a 200k
 * window, and recorded 40 consultations against a reader that had named none of them.
 *
 * WHAT IS SERVED IS DECIDED BY DISPOSITION, and not here — `lookupServedSkill`
 * classifies (`SKILL_DISPOSITION` in `@mnema/copilot`), this adapter serves what it
 * gets back. Two places deciding which states are live is the shape that produces a
 * refusal disagreeing with the list beside it.
 *
 * THE DEFAULT IS THE THING BEING PROTECTED, and the bifurcation below is the whole
 * of the protection: the mass branch is `adoptedSkills`, so nothing awaiting a
 * judgement can reach a caller that did not NAME it. A candidate arriving unasked
 * would be a candidate served as an instruction; a candidate arriving by id is a
 * caller reading what it was asked to rule on. Asserted in `mcp-e2e.test.ts` —
 * "skills with no id serves ONLY the adopted, over a record that holds a candidate".
 *
 * Named `…Tool` because the command line has a `runSkills` of its own doing
 * something else — this serves a pattern to an agent, that audits where every
 * pattern came from for a person — the same split `runFocus`/`runFocusTool` and
 * `runSearch`/`runSearchTool` already carry.
 *
 * Each pattern comes back with its `state` and with the agent that adopted it, which
 * the projection folds off the adopting transition's envelope. The transport frames
 * both in one line beside the bodies: a body in force is served as instruction, and
 * until it carried its adopter nobody receiving it could see who put it there; a body
 * awaiting a judgement has no adopter at all, and the line says the state instead of
 * asserting an adoption that never happened.
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
 * unknown id, a pattern the project has closed. A refusal to record IS surfaced
 * rather than swallowed: a silently unrecorded consultation is exactly the
 * perishable fact this exists to capture, so it is reported like any other
 * refused write.
 *
 * A CALL ANSWERED IN NAMES SERVES NOTHING, and it is the same rule and not an
 * exception to it: a name is not a pattern, and nobody can be said to have consulted
 * text they were not handed. So the recording is asked over the bodies this call
 * served — an empty list when the catalogue answered names, which is a question
 * settled before a run is opened or a cache marked stale.
 *
 * And the converse holds with no branch to keep it holding: a body that IS served
 * goes through {@link recordConsultations} whatever its state, because the recording
 * is downstream of the bifurcation and reads the served list. The invariant that
 * justified making this the only door — a body never leaves THIS SURFACE without the
 * fact of the reading — would have been the first casualty of a candidate served on a
 * shortcut. Asserted in `mcp-e2e.test.ts` — "skills with an id serves the body of a
 * pattern awaiting a judgement, and records the consultation".
 *
 * THE THREE WORDS "THIS SURFACE" USED TO BE ABSENT, and the sentence was too broad
 * before this slice as well as after it. The command line already took a body out with
 * nothing recorded (`mnema show <id>`, for a person curating), and `mnema skill export`
 * now takes one out as a FILE. Neither is a shortcut past this door: both are the
 * auditor's surface, and the invariant is about the AGENT's — which is exactly what
 * `read_record` refusing a skill (`USE_SKILLS_TOOL`) buys, and what it would stop buying
 * if a tool here served a body without recording.
 *
 * THE REASON THAT USED TO BE IN THAT PARENTHESIS WAS *"where there is no session to
 * attribute a consultation to"*, AND IT IS FALSE NOW: `mnema run start` put a run on the
 * command line, so a person reading there may well be inside one. The reason the auditor's
 * surface still records nothing is written where that verb lives (`commands/show.ts`), and
 * it is three measurements and one structural fact rather than an absence of sessions. What
 * the command line got instead is a REPORT — `mnema antipatterns` says whether the run that
 * moved a pattern had been served its body, and says NOT OBSERVABLE where nothing was
 * listening. It is deliberately not a tool here: an auditor's finding the audited party can
 * query and clear before anyone reads it is not a finding.
 */
export function runSkillsTool(session: Session, input: { id?: string } = {}): SkillsResult {
  // READ before WRITE: the caches are consulted first, because building a write
  // context marks the written tree stale — doing it the other way round would
  // make every call rebuild the tree it is about to read.
  const caches = sessionCaches(session);
  const served = input.id === undefined ? undefined : lookupServedSkill(caches, input.id);
  if (served?.outcome === 'unknown') {
    return {
      ok: false,
      code: 'UNKNOWN_SKILL',
      // The SESSION's sentence, not the workspace's: this read serves the patterns of
      // the trees the session can see, and a refusal claiming a search of every
      // project would claim more than it did. `input.id` is defined here — `served`
      // is undefined without it.
      message: notFoundInSessionTrees(session, 'skill', input.id as string),
    };
  }
  if (served?.outcome === 'not-served') {
    return {
      ok: false,
      code: 'NOT_SERVED',
      // The STATE is what the refusal is for: an agent holding a name from an older
      // session learns what became of the pattern instead of being told nothing.
      // The clause after it states the RULE, not a claim about this record — which is
      // what keeps the sentence true of a state the workflow has never had.
      //
      // THE ID GOES THROUGH {@link oneLine}, like every other refusal that echoes a
      // caller's argument (`notInAnyProject`, `notFoundInSessionTrees`): a refusal is
      // read as ONE line, so an id holding a newline writes a second, well-formed
      // refusal about something nobody asked. This and `read_record`'s
      // `USE_SKILLS_TOOL` were the two refusals on this surface that echoed the id
      // raw. Reaching either with a break in it needs an id the RECORD holds, and
      // every id the product mints is a UUID — so this is the rule applied where it
      // belongs, not a case that can be demonstrated (`mcp-e2e.test.ts` pins the
      // branch that a caller CAN reach, "a skills refusal stays ONE line whatever id
      // the caller sent"). `input.id` is defined here — `served` is undefined without
      // it, the same narrowing the branch above relies on.
      message:
        `skill "${oneLine(input.id as string)}" is ${served.state}: a pattern the ` +
        'project turned down or retired is not served as a way of working',
    };
  }
  // The bifurcation, and the ceiling ON ONE SIDE of it: a caller that named an id is
  // served that body whatever it weighs — it asked for exactly this one, and what a
  // body may weigh at all was settled on the way in, by the content door. A caller
  // that named nothing gets what fits.
  const catalogue: SkillCatalogue =
    served === undefined
      ? skillCatalogue(adoptedSkills(caches))
      : { served: 'bodies', skills: [served.skill] };

  const recorded = recordConsultations(
    session,
    catalogue.served === 'bodies' ? catalogue.skills : [],
  );
  if (!recorded.ok) return recorded;
  // This is a READ that writes, so it is the one place a replacement report could
  // reasonably be dropped — and dropping it is exactly the silence the report
  // exists against. A consultation carries the session's agent name on its
  // envelope like every other fact, so if that name held a credential this call is
  // the one that recorded it, and this reply is where the caller can still act.
  return { ok: true, ...catalogue, ...forwardReplacement(recorded) };
}

/**
 * Records one `skill.consulted` for each pattern served that this RUN has not
 * already recorded, in the tree the KIND names — the same tree a skill's own facts go
 * to, because "this pattern was used" is a fact about the pattern. The evidence that
 * an adopted pattern earns its place is worth nothing on one machine, which is why it
 * travels with the pattern rather than staying where the reader happens to be.
 *
 * IT DOES NOT ASK WHAT STATE THE PATTERN IS IN, and that is deliberate: it records
 * every body the caller was served, so a candidate read by three sessions that nobody
 * then ruled on is a fact the curation audit can see. The reading that counts these
 * says of itself that it COUNTS and does not judge, and the auditor's own pattern list
 * already includes the never-adopted — so nothing downstream reads a consultation as
 * evidence of adoption.
 *
 * The subject may name a skill that lives in ANOTHER tree — the read serves patterns
 * from every tree the session can see, so a consultation of a privately adopted one
 * is recorded in the committed tree and points across. That is the same honest
 * cross-tree reference a link or an observation makes, resolved on read; unlike a
 * `run`, it is a reference the caller chose and not one the envelope imposes.
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
  skills: readonly ServedSkill[],
):
  | (Replacement & { readonly ok: true })
  | { readonly ok: false; readonly code: string; readonly message: string } {
  // Routed by KIND like every other write, through the same door, even though this
  // one takes no `scope` and no `project` from its caller: a consultation is a fact
  // about a pattern, and the rule that says where a pattern's facts live is the same
  // one. Reaching for a session default here — there is none now — is what used to put
  // it in a tree the pattern itself was not in.
  const route = routeWrite(session, 'skill.consulted', {});
  if (!route.ok) return route;
  const root = chainRootForScope(session.trees, route.scope) as string;
  const already = session.consulted.get(root);
  const fresh = already === undefined ? skills : skills.filter((skill) => !already.has(skill.id));
  if (fresh.length === 0) return { ok: true };

  const { ctx, run } = openWrite(session, route.scope);
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
  return focus(sessionCaches(session), { actor: session.who, ...askerContext(session) });
}

/**
 * `resume` — where the session actor left off: their latest run plus focus.
 *
 * The read mold applied to the copilot's `resume`. Read-only. Like `focus`, the
 * actor is the session's `who`, so the latest run reported is the machine's own —
 * open OR already ended, the "where was I" anchor.
 */
export function runResumeTool(session: Session): Resume {
  return resume(sessionCaches(session), { actor: session.who, ...askerContext(session) });
}

/** The task's legal moves, or a typed refusal when no one tree of the workspace holds it. */
export type NextActionsResult =
  | {
      readonly ok: true;
      /** The transitions the workflow allows from the task's state; empty when terminal. */
      readonly actions: readonly NextAction[];
    }
  | {
      readonly ok: false;
      /** No tree of the workspace holds a task with this id, or several records do. */
      readonly code: 'UNKNOWN_TASK' | 'AMBIGUOUS_RECORD';
      /** The human-readable reason. */
      readonly message: string;
    };

/**
 * `next_actions` — the moves the workflow allows a task next.
 *
 * Keyed by an ENTITY, not the actor: it locates the task's home tree
 * ({@link locateEntity}) — a task lives in exactly one tree of the workspace — takes
 * THAT tree's cache, and returns the copilot's `nextActionsForTask`. Read-only. An id
 * no tree of the workspace holds is refused `UNKNOWN_TASK` (returned as data so the
 * server shapes it into a tool error, never thrown); an existing terminal task yields
 * an empty list — "no legal moves", not "no such task".
 *
 * The union is the same rule the reads keyed by an id follow: a task in a sibling
 * project is a task with one home, and asking one project answered "no such task"
 * about a task the workspace holds — the answer that made a move impossible on a task
 * the same session had just created.
 *
 * This is the read that makes the session's caches per-TREE rather than one: the
 * tree it serves is the entity's, which need not be the session's own — nor even
 * this project's. Asking the registry by chain root keeps those apart — a task read
 * out of the public tree can never be answered from the private tree's projection.
 */
export function runNextActionsTool(session: Session, input: { id: string }): NextActionsResult {
  const located = locateEntity(session, input.id);
  if (located.outcome !== 'found') return refuseUnlocated(session, 'task', input.id, located);
  const actions = nextActionsForTask(session.caches.get(located.home.chainRoot), input.id);
  // The birth was located, so a null here is not a missing task: this session has
  // no state for it in that tree — its history stops at the creation, or another
  // process appended past what this session has read. Report that rather than a
  // false empty terminal list, and name the tree, because repeating the sentence
  // above would deny a birth this very call just found.
  if (actions === null) {
    return {
      ok: false,
      code: 'UNKNOWN_TASK',
      message: locatedButUnreadable('task', input.id, located.home),
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
      /** No tree of the workspace holds a task with this id, or several records do. */
      readonly code: 'UNKNOWN_TASK' | 'AMBIGUOUS_RECORD';
      /** The human-readable reason. */
      readonly message: string;
    };

/**
 * `guard` — a DRY-RUN of the workflow gate: "would this move be allowed on this
 * task, and if not, why?" — the MCP counterpart of `mnema guard`. Read-only: it
 * locates the task's home tree ({@link locateEntity}), takes THAT tree's cache, reads
 * the task's current state as the `from`, and calls the copilot's pure
 * {@link guardWithFocus} — no writer, no event. The verdict is the gate's own, the
 * SAME function `task_transition` consults, over the SAME locate, so a guard that
 * says ALLOWED and a move that succeeds can never drift — including for a task in
 * another project, where a guard that refused what the move then did would be worse
 * than either answer alone.
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
  const located = locateEntity(session, input.id);
  if (located.outcome !== 'found') return refuseUnlocated(session, 'task', input.id, located);
  const cache = session.caches.get(located.home.chainRoot);
  const task = cache.getTask(input.id);
  // The birth was located, so a null here is not a missing task: this session has
  // no state for it in that tree (a history that stops at the creation, or a write
  // by another process it has not read). Refuse rather than simulate from a state
  // we cannot read, and name the tree instead of denying the birth just found.
  if (task === null) {
    return {
      ok: false,
      code: 'UNKNOWN_TASK',
      message: locatedButUnreadable('task', input.id, located.home),
    };
  }
  const fields = proofToFields(input);
  const result = guardWithFocus(
    // The FOCUS's trees, not the task's. The verdict needs no cache (the gate is
    // pure, and the state it decides from was read above), and the runs the asker
    // has open are the asker's — a session that wrote in two trees holds a run in
    // each, and the tree this task happens to live in answers about neither.
    sessionCaches(session),
    {
      from: task.state,
      action: input.action,
      who: session.who,
      ...(fields !== undefined ? { fields } : {}),
      ...(input.which !== undefined ? { which: input.which } : {}),
    },
    askerContext(session),
  );
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
 * `search` — find records across every project of the workspace, or list the
 * most recent ones.
 *
 * The read that makes the record readable. Everything an agent captures — a
 * memory, an observation, a decision, a task, a skill — was write-only until
 * now: recoverable by id if you still had the id, and otherwise gone. This
 * returns an INDEX of what matched (id, kind, tree, project, instant, one line
 * each), never the bodies; `read_record` serves one whole record when the index
 * says which one is worth reading.
 *
 * The term is OPTIONAL. Without one the answer is the most recent records —
 * "what has been going on here" — and with one it is the best matches. They are
 * the same read because an inverted index makes them the same query.
 *
 * The union is what "have we written about X" has always meant. The words are in the
 * project they were written in, and the cascade's choice of one project is not a
 * filter the caller applied — so a search of one codebase answering "nothing matches"
 * about a workspace says the one thing this product must not: it reports the world
 * from a search of a corner, in the same words it would use if the corner were the
 * world. Every hit says which project holds it, which is what makes filtering the
 * reader's option instead of ours.
 *
 * IT CARRIES A LIMIT THE ANSWER NOW HAS TO STATE: the merged ranking is an
 * approximation across corpora, and `limit` can fill the list from one project and
 * leave a sibling's matches out entirely. The constant half is in this description and
 * in `searchRecords`; the per-answer half is the `hidden` field, present only when a
 * whole record was shut out. No per-project quota — declared, not resolved.
 *
 * Read-only in the strict sense: it asks the session's warm caches and composes
 * the copilot's pure `searchRecords`. No writer, no event — including for a
 * skill, whose NAME may appear here. Only serving a skill's BODY is a
 * consultation worth recording, and that has its own tool.
 */
export function runSearchTool(session: Session, input: RecordQuery = {}): SearchToolResult {
  // A scope this context does not have would silently return nothing, which
  // reads as "no matches" when the truth is "that tree is not here". Checked on the
  // session's own trees and still right over the union: a workspace with a project in
  // it is a session IN a project, so the roles a sibling has are the roles this one
  // has — what differs across projects is the tree behind a role, never the roles.
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
  return { ok: true, value: searchRecords(workspaceCaches(session), input) };
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
 * `read_record` — the whole of one record, by the id an index gave.
 *
 * The second half of the search: the index says what exists and this says what
 * it says. It looks in every tree of every project this workspace holds (an id
 * lives in exactly one) and returns the projection the chain proves, marked with
 * that tree AND with the project that owns it. Read-only: no writer, no event.
 *
 * TWO INDEXES POINT HERE NOW, and the description says so. `search` was the first;
 * the opening read is the second, since it serves the decisions in force by title and
 * `adr` and never their `rationale`. The door an index sends a reader to has to name
 * the index, or an agent holding a decision id from `bootstrap` has been told the
 * argument exists somewhere and not where.
 *
 * The union is not a widening of the question, it is the question. An id is minted
 * once; which project it landed in is a fact about where the work happened, not a
 * filter the caller meant to apply — so looking in one project and reporting "no
 * record" is a false answer with a true-sounding shape, and it is the answer an agent
 * got for any id from a sibling project of the same workspace.
 *
 * A SKILL is refused here, and pointed at the `skills` tool instead. ONE reason, and
 * it is the skills tool's own: serving a pattern's body is a CONSULTATION, and that
 * fact is derivable from nothing else afterwards — so a body leaving through a second
 * door would leave without it. That is the whole of it now.
 *
 * It used to be two, and the second was "only ADOPTED patterns are served". That is
 * no longer the rule (`skills` serves a pattern awaiting a judgement to a caller that
 * names it by id), and it was never a reason to refuse HERE: what this refusal
 * protects is the ledger, not the body. The refusal that survived the change of rule
 * is the `skills` tool's own, for a pattern the project CLOSED.
 *
 * The auditor's surface (the CLI) makes the opposite call for the opposite reason: a
 * person curating patterns has to be able to read the one they are about to reject,
 * and there is no session there to attribute a consultation to.
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
        `"${oneLine(input.id)}" is a skill — read it with the \`skills\` tool, which ` +
        'serves a pattern’s body and records that it was consulted',
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
 * kind of sentence a reader cannot check. So it names the projects, the same way a
 * routed write names the projects it could have meant (`namedProjects`, shared with
 * it).
 *
 * The clause that names them is now the entity-keyed refusals' too
 * ({@link inEveryTreeThisSessionSees}): those tools search exactly the trees this read
 * searches, so the account of where they looked is one function rather than two
 * wordings of one walk. What varies is only the subject in front of it — a record by
 * id here, a task or a decision or a skill there.
 *
 * It still does not say the id does not exist, and it has every reason not to: the
 * read covered every project the client announced, and that is still not the world — a
 * project nobody opened, and a partial clone of one that was, both hold records this
 * cannot see. What is reported is the search.
 *
 * THE ID GOES THROUGH {@link oneLine}, because unlike a project path it comes from
 * the CALLER. A refusal is read as one line, so an id holding a newline lets the
 * argument write a second, well-formed refusal about something nobody asked — the
 * defect measured on a directory name, one step closer to whoever is calling.
 */
function notInAnyProject(session: Session, id: string): string {
  return `no record with id "${oneLine(id)}" ${inEveryTreeThisSessionSees(session)}`;
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

/** The `audit_accountability` result — an account per project, or a refusal. */
export type AccountabilityToolResult = IntelligenceResult<WorkspaceAccountability>;

/** The `audit_antipatterns` result — the shapes of each record, or a refusal. */
export type AntipatternsToolResult = IntelligenceResult<WorkspaceAntipatterns>;

/**
 * The refusal an intelligence read gives with no project, shared by the five.
 * An intelligence read is the auditor's view of a PROJECT's record; a session on
 * the global tree alone has no project to audit, so it refuses `NO_PROJECT`
 * (returned as data so the server shapes it into a tool error), the same refusal
 * the CLI intelligence reads give.
 *
 * All five read every project of the workspace ({@link workspaceTrees}); what differs
 * is what each merges from it. The two keyed by an id merge items into one answer;
 * `accountability` and `antipatterns` keep their counts per record rather than summing
 * — "who authorized what" and "what keeps recurring" are questions about a record, and
 * three added together answer a different one under the same name; and `exposure` does
 * both, merging its findings and decomposing its denominator. The guard is shared
 * because the CONDITION is shared: without a project there is no record to audit,
 * however the fold then works.
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

/** The `governing_rules` result — the rules addressed at a path, or a refusal. */
export type GoverningRulesToolResult = IntelligenceResult<GoverningRules>;

/**
 * `governing_rules` — which recorded rules govern a path of this project.
 *
 * The reverse reading of the one relation whose target is a PATH: a decision or a
 * pattern linked with `rel: "governs"` to `src/billing` is a rule with an address,
 * and this finds it from the file rather than from the id. It is what turns "the
 * record holds rules" into "these rules apply to what I am about to touch".
 *
 * IT CHARGES NOTHING. It refuses nothing, blocks nothing and grades nothing; it
 * does not even decide which rules still hold — each rule's state travels beside it
 * and reading it is the caller's. What it hands back is the id, which is what any
 * later charge would have to cite.
 *
 * THREE NUMBERS RIDE ON EVERY ANSWER, including when all three are zero: how many
 * addresses cover this path, how many the project's record holds at all, and how
 * many name something the working tree no longer holds. Without the third an
 * address whose file was moved or deleted stops governing in silence, and a quiet
 * answer reads exactly like an empty mechanism.
 *
 * THE ADDRESSES ARE THIS PROJECT'S, and only this project's. An address is relative
 * to a project root, so a rule written in a sibling project's record addresses that
 * project's tree; importing it here would make it govern code nobody addressed. The
 * machine-global tree is left out for the same reason — it belongs to no project, so
 * a path in it is relative to nothing. That is the one read of this surface that
 * deliberately does NOT span the workspace, and the reason is the question's, not a
 * preference.
 *
 * A RELATIVE PATH IS RESOLVED AGAINST THE PROJECT ROOT, not against a working
 * directory: a server is spawned with an arbitrary cwd by its host, so it has none to
 * mean. Read-only: the session's warm caches, the copilot's pure derivation, and one
 * `existsSync` per address. With no project it refuses `NO_PROJECT`.
 */
export function runGoverningRulesTool(
  session: Session,
  input: { path: string },
): GoverningRulesToolResult {
  const refused = requireProject(session);
  if (refused !== undefined) return refused;
  // `inProject` is what `requireProject` just checked, and a project session always
  // carries its directory — the two are set together by the cascade.
  const root = session.project ?? '';
  return {
    ok: true,
    value: readGoverningRules(workspaceCaches(session), {
      path: input.path,
      root,
      from: root,
    }),
  };
}

/**
 * `audit_accountability` — who authorized what, accounted for one project at a time.
 *
 * Every project of the workspace, and the machine-global tree, each folded into its
 * own factual account of authorship. With no filter it accounts for the whole record
 * (git shortlog -sn); `from`/`to`/`who`/`which` only narrow it — they are aggregation
 * filters, never the session actor's identity (the session's `who` is not imposed as
 * a filter).
 *
 * DECOMPOSED and never summed, which is the whole difference between this read and the
 * four others that span the workspace. They return items, and an item is the same fact
 * wherever it was written. This returns counts, and a count is about a record: three
 * codebases added up answer "how much have I written" while still being called "how
 * much is in this record", and the reader takes the bigger number for the smaller
 * question with nothing in the reply to catch it. Each entry here means exactly what
 * the single answer meant when a session saw one project — the arithmetic is
 * unchanged, the attribution is new.
 *
 * Not decomposing was the other way to be wrong. These reads take no project
 * argument, deliberately, so an account locked to the session's own project leaves an
 * agent unable to ask about the others at all — a write already says which project it
 * belongs to ({@link routeWrite}), and the auditing of it would have stayed blind.
 *
 * Read-only: the session's warm caches and the copilot's pure
 * `accountabilityByProject`. With no project it refuses `NO_PROJECT`.
 */
export function runAccountabilityTool(
  session: Session,
  input: AccountabilityFilter = {},
): AccountabilityToolResult {
  const refused = requireProject(session);
  if (refused !== undefined) return refused;
  return { ok: true, value: accountabilityByProject(workspaceCaches(session), input) };
}

/** The `audit_exposure` result — where a credential format sits, or a refusal. */
export type ExposureToolResult = IntelligenceResult<WorkspaceExposure>;

/**
 * `audit_exposure` — which records of which projects hold something shaped like a
 * credential.
 *
 * The one intelligence read about the record's PAST rather than its shape. Writing
 * screens what arrives, so an agent cannot put a recognized credential into the
 * chain today; everything written before that could, and in a committed tree the
 * past is what decides the damage. This is how an agent asked to check finds out.
 *
 * It answers WHERE and never WHAT — the id, the kind, the tree, the project, the
 * instant and the class. There is no value in the result to return, by construction,
 * because the detector behind it reports classes only: a tool that handed a credential
 * back would put it in a transcript, which is a second disclosure and a worse one (a
 * transcript travels further than a chain).
 *
 * EVERY PROJECT, because the defence is scoped to a project and the exposure is not.
 * The content door screens the writes of the project a session adopted; the record of
 * the neighbouring project is on the same disk, was written before that door existed
 * or imported from elsewhere, and this read answered about neither while reporting a
 * denominator that looked like coverage. It is worth saying plainly what widening it
 * does and does not do: `search` and `read_record` still serve the raw text of a
 * neighbour's record, because that is what a record is for, so this is not a leak being
 * stopped. It is the WARNING reaching as far as the service already reached.
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
  return {
    ok: true,
    value: workspaceExposure(scopedEventsOf(workspaceTrees(session), catalogUpcasters())),
  };
}

/**
 * `audit_antipatterns` — recurring shapes, one record of the workspace at a time.
 *
 * Folds the union of EACH record's trees — every project's, and the machine-global
 * tree — and surfaces the shapes that recur in it (reopened tasks, superseded
 * decisions, deprecated skills), each with its evidence, plus the skill candidates
 * POINTED at. It points, it does not conclude, and it creates no skill.
 *
 * The `ADR-<n>` clashes come from each CHAIN of a record rather than from the union of
 * them, and the source hands over both views from one reading. A label is numbered
 * inside one chain, so a project's public and private trees hold an `ADR-1` each the
 * moment both have a decision — pooling them would report that on nearly every project
 * and mean nothing when it did.
 *
 * DECOMPOSED rather than merged, for the reason `accountability` is: everything here
 * is a count, and counts of three codebases added up answer a question about a
 * workspace under the name of a question about a record. The skill candidates make it
 * concrete — a pattern is distilled by the person doing the work that kept reopening,
 * so a candidate list that pooled three projects would point them at somebody else's.
 *
 * Read-only: it reads the tails and folds them with the copilot's pure
 * `antipatternsByProject`. With no project it refuses `NO_PROJECT`.
 */
export function runAntipatternsTool(session: Session): AntipatternsToolResult {
  const refused = requireProject(session);
  if (refused !== undefined) return refused;
  const records = projectEventsOf(workspaceTrees(session), catalogUpcasters());
  return { ok: true, value: antipatternsByProject(records) };
}
