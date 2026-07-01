import type { Decision } from '../domain/entities/decision.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { DecisionStatus } from '../domain/enums/decision-status.js';
import { hasInvocationMarkup } from '../domain/invocation-markup.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { ErrorIssue, MnemaError } from '../errors/mnema-error.js';
import type { DecisionRepository } from '../storage/sqlite/repositories/decision-repository.js';
import type { NoteRepository } from '../storage/sqlite/repositories/note-repository.js';
import type { ObservationRepository } from '../storage/sqlite/repositories/observation-repository.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { ProvenanceLinkRepository } from '../storage/sqlite/repositories/provenance-link-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { AuditService } from './audit-service.js';
import type { IdentityService } from './identity-service.js';
import { Err, Ok, type Result } from './result.js';
import type { RoadmapMirror } from './roadmap-mirror.js';

/**
 * Input for {@link DecisionService.record}.
 */
export interface RecordDecisionInput {
  readonly projectKey: string;
  readonly title: string;
  readonly decision: string;
  readonly context?: string;
  readonly rationale?: string;
  readonly consequences?: string;
  /** Paths/keys of artefacts this decision affects. */
  readonly impacts?: readonly string[];
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Input for {@link DecisionService.promoteFromNote}.
 *
 * `noteId` is the internal UUID returned by `note_add`. The full
 * decision body (`title`, `decision`, optional context/rationale/
 * consequences) still comes from the caller — promotion is a
 * convenience that adds a linkage event to the audit log, not a
 * format conversion of the note content.
 */
export interface PromoteNoteToDecisionInput {
  readonly noteId: string;
  readonly title: string;
  readonly decision: string;
  readonly context?: string;
  readonly rationale?: string;
  readonly consequences?: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Input for {@link DecisionService.promoteFromObservation}. Unlike a
 * note (which carries a parent task the project key is derived from), an
 * observation has no such anchor, so `projectKey` is explicit.
 */
export interface PromoteObservationToDecisionInput {
  readonly observationId: string;
  readonly projectKey: string;
  readonly title: string;
  readonly decision: string;
  readonly context?: string;
  readonly rationale?: string;
  readonly consequences?: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Input for {@link DecisionService.transition}.
 */
export interface TransitionDecisionInput {
  readonly decisionKey: string;
  readonly status: DecisionStatus;
  readonly supersededBy?: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
  /**
   * Optional optimistic-concurrency token. When supplied, the
   * transition only proceeds if the decision's current `updatedAt`
   * matches; otherwise a `Conflict` error is returned with the
   * latest server-side timestamp.
   */
  readonly expectedUpdatedAt?: string;
}

const VALID_TRANSITIONS: Readonly<Record<DecisionStatus, readonly DecisionStatus[]>> = {
  [DecisionStatus.Proposed]: [
    DecisionStatus.Accepted,
    DecisionStatus.Rejected,
    DecisionStatus.Superseded,
  ],
  [DecisionStatus.Accepted]: [DecisionStatus.Superseded],
  [DecisionStatus.Rejected]: [DecisionStatus.Superseded],
  [DecisionStatus.Superseded]: [],
};

/**
 * Orchestrates the lifecycle of Architecture Decision Records (ADRs).
 *
 * Decisions are append-mostly: once recorded their immutable text stays
 * put, only `status` flips through `proposed → accepted/rejected →
 * superseded`. Rejection is terminal in practice; supersedure points the
 * record at its replacement so history remains linkable.
 */
export class DecisionService {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly projects: ProjectRepository,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    private readonly notes: NoteRepository,
    private readonly tasks: TaskRepository,
    // Optional so unit tests can drive the service without a filesystem.
    private readonly mirror: RoadmapMirror | null = null,
    // Optional provenance wiring: when present, promotion records a
    // navigable source→decision edge. Absent in lean unit tests.
    private readonly provenance: ProvenanceLinkRepository | null = null,
    private readonly observations: ObservationRepository | null = null,
  ) {}

  /**
   * Records a new decision in `proposed` status.
   *
   * @param input - Decision fields + identity tuple
   * @returns The created decision or a structured error
   */
  record(input: RecordDecisionInput): Result<Decision, MnemaError> {
    const project = this.projects.findByKey(input.projectKey);
    if (project === null) {
      return Err({ kind: ErrorCode.ProjectNotFound, projectKey: input.projectKey });
    }

    // Reject tool-invocation markup leaking into any text field — a malformed
    // MCP call can spill `<parameter name=...>` / `</invoke>` into a value,
    // which would persist a garbage trailer and leave sibling fields empty.
    const markupIssues: ErrorIssue[] = [];
    for (const [field, value] of [
      ['title', input.title],
      ['decision', input.decision],
      ['context', input.context],
      ['rationale', input.rationale],
      ['consequences', input.consequences],
    ] as const) {
      if (value !== undefined && value !== null && hasInvocationMarkup(value)) {
        markupIssues.push({
          path: [field],
          message: 'contains tool-invocation markup; pass each field as its own argument',
        });
      }
    }
    if (markupIssues.length > 0) {
      return Err({ kind: ErrorCode.ValidationFailed, issues: markupIssues });
    }

    const sequence = this.decisions.nextSequence(project.id);
    const key = `${project.key}-ADR-${sequence}`;
    const authoredBy = this.identity.ensureActor(input.actor, ActorKind.Human);

    const decision = this.decisions.insert({
      key,
      projectId: project.id,
      title: input.title,
      decision: input.decision,
      context: input.context ?? null,
      rationale: input.rationale ?? null,
      consequences: input.consequences ?? null,
      impacts: input.impacts ?? [],
      authoredBy,
    });

    this.audit.write({
      kind: 'decision_recorded',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: decision.key, title: decision.title, status: decision.status },
    });

    this.mirror?.writeDecision(decision);

    return Ok(decision);
  }

  /**
   * Records a new decision and links it to an existing note via an
   * extra audit event. The note itself stays put — promotion is a
   * provenance marker, not a content transform: the caller still has
   * to supply the full decision body (title, decision text, optional
   * context/rationale/consequences). The note's parent task key is
   * looked up and carried in the linkage event so a single
   * `audit query --kind decision_promoted_from_note --task-key X`
   * surfaces the trail.
   *
   * @param input - Note id + decision fields + identity tuple
   * @returns The created decision or a structured error
   */
  promoteFromNote(input: PromoteNoteToDecisionInput): Result<Decision, MnemaError> {
    const note = this.notes.findById(input.noteId);
    if (note === null) {
      return Err({ kind: ErrorCode.NoteNotFound, noteId: input.noteId });
    }
    const task = this.tasks.findById(note.taskId);
    if (task === null) {
      // Note's parent task was soft-deleted; surface a structured
      // error so the caller knows the promotion can't be linked.
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: note.taskId });
    }

    // Resolve the project key from the task so the caller doesn't have
    // to know it; matches how `decision_record` is shaped at the MCP
    // boundary (project is implicit from the active workspace).
    const recorded = this.record({
      projectKey: task.key.split('-')[0] ?? '',
      title: input.title,
      decision: input.decision,
      context: input.context,
      rationale: input.rationale,
      consequences: input.consequences,
      actor: input.actor,
      via: input.via,
      runId: input.runId,
    });
    if (!recorded.ok) return recorded;
    const decision = recorded.value;

    this.audit.write({
      kind: 'decision_promoted_from_note',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: {
        decision_key: decision.key,
        note_id: note.id,
        task_key: task.key,
      },
    });

    // First-class, navigable edge: note → decision.
    this.provenance?.link({ kind: 'note', ref: note.id }, { kind: 'decision', ref: decision.key });

    return Ok(decision);
  }

  /**
   * Promotes an observation into a decision — the observation's parallel
   * to {@link promoteFromNote}. The observation stays put (it is
   * append-only); this records the full decision body the caller supplies
   * plus a navigable observation → decision provenance edge and a
   * linkage audit event.
   *
   * @param input - Observation id + decision fields + identity tuple
   * @returns The created decision or a structured error
   */
  promoteFromObservation(input: PromoteObservationToDecisionInput): Result<Decision, MnemaError> {
    if (this.observations === null) {
      // Wiring invariant: production always injects the observation repo.
      // A missing one is a construction bug, not a user-facing state.
      throw new Error('DecisionService.promoteFromObservation requires an ObservationRepository');
    }
    const observation = this.observations.findById(input.observationId);
    if (observation === null) {
      return Err({ kind: ErrorCode.ObservationNotFound, observationId: input.observationId });
    }

    const recorded = this.record({
      projectKey: input.projectKey,
      title: input.title,
      decision: input.decision,
      context: input.context,
      rationale: input.rationale,
      consequences: input.consequences,
      actor: input.actor,
      via: input.via,
      runId: input.runId,
    });
    if (!recorded.ok) return recorded;
    const decision = recorded.value;

    this.audit.write({
      kind: 'decision_promoted_from_observation',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { decision_key: decision.key, observation_id: observation.id },
    });

    this.provenance?.link(
      { kind: 'observation', ref: observation.id },
      { kind: 'decision', ref: decision.key },
    );

    return Ok(decision);
  }

  /**
   * Transitions a decision to a new status. When marking as superseded,
   * the successor decision key must be supplied.
   *
   * @param input - Transition request + identity tuple
   * @returns The updated decision or a structured error
   */
  transition(input: TransitionDecisionInput): Result<Decision, MnemaError> {
    const decision = this.decisions.findByKey(input.decisionKey);
    if (decision === null) {
      return Err({ kind: ErrorCode.DecisionNotFound, decisionKey: input.decisionKey });
    }

    const allowed = VALID_TRANSITIONS[decision.status];
    if (!allowed.includes(input.status)) {
      return Err({
        kind: ErrorCode.DecisionInvalidStatus,
        decisionKey: decision.key,
        fromStatus: decision.status,
        toStatus: input.status,
      });
    }

    let supersededById: string | null = null;
    if (input.status === DecisionStatus.Superseded) {
      if (input.supersededBy === undefined) {
        return Err({
          kind: ErrorCode.DecisionInvalidStatus,
          decisionKey: decision.key,
          fromStatus: decision.status,
          toStatus: input.status,
        });
      }
      const successor = this.decisions.findByKey(input.supersededBy);
      if (successor === null) {
        return Err({ kind: ErrorCode.DecisionNotFound, decisionKey: input.supersededBy });
      }
      // A decision cannot supersede itself — that produces a self-referential
      // supersededBy pointer (and a node that is its own replacement).
      if (successor.id === decision.id) {
        return Err({
          kind: ErrorCode.DecisionInvalidStatus,
          decisionKey: decision.key,
          fromStatus: decision.status,
          toStatus: input.status,
        });
      }
      supersededById = successor.id;
    }

    // Default the optimistic-concurrency token to the row we just
    // read so two concurrent `decision accept`/`decision reject`
    // calls can't lose-write each other.
    const expectedUpdatedAt =
      input.expectedUpdatedAt !== undefined ? input.expectedUpdatedAt : decision.updatedAt;

    const result = this.decisions.updateStatus(
      decision.id,
      input.status,
      supersededById,
      expectedUpdatedAt,
    );
    if (!result.ok) {
      if (result.reason.kind === 'NOT_FOUND') {
        return Err({ kind: ErrorCode.DecisionNotFound, decisionKey: input.decisionKey });
      }
      return Err({
        kind: ErrorCode.Conflict,
        entity: 'decision',
        taskKey: decision.key,
        currentUpdatedAt: result.reason.currentUpdatedAt,
      });
    }
    const updated = result.decision;

    this.audit.write({
      kind: 'decision_status_changed',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: {
        key: updated.key,
        from: decision.status,
        to: updated.status,
        superseded_by: input.supersededBy,
      },
    });

    this.mirror?.writeDecision(updated);

    return Ok(updated);
  }

  /**
   * Returns a decision by its human key.
   *
   * @param decisionKey - Decision key (e.g. `WEBAPP-ADR-7`)
   * @returns The decision or a structured error when unknown
   */
  show(decisionKey: string): Result<Decision, MnemaError> {
    const decision = this.decisions.findByKey(decisionKey);
    if (decision === null) {
      return Err({ kind: ErrorCode.DecisionNotFound, decisionKey });
    }
    return Ok(decision);
  }

  /**
   * Returns a decision by its internal UUID, or `null` if absent.
   * Used by the CLI renderer to resolve `supersededBy` (stored as a
   * UUID FK) back to the human-readable key.
   *
   * @param id - Internal decision UUID
   * @returns The decision or `null` when unknown
   */
  findById(id: string): Decision | null {
    return this.decisions.findById(id);
  }

  /**
   * Lists decisions of a project ordered by record time.
   *
   * @param projectKey - Project key
   * @param status - Optional status filter
   * @returns Decisions ordered by `at`
   */
  list(projectKey: string, status?: DecisionStatus): readonly Decision[] {
    const project = this.projects.findByKey(projectKey);
    if (project === null) return [];
    return this.decisions.findByProject(project.id, status);
  }

  /**
   * Writes a markdown mirror for every decision that has none — the
   * recovery path for projects created before mirrors existed, or after
   * a manual deletion. Existing files are left untouched.
   *
   * @param projectKey - Project key
   * @returns Keys of the decisions whose mirror was just written
   */
  rebuildMirrors(projectKey: string): string[] {
    if (this.mirror === null) return [];
    const rebuilt: string[] = [];
    for (const decision of this.list(projectKey)) {
      if (!this.mirror.hasDecision(decision.key)) {
        this.mirror.writeDecision(decision);
        rebuilt.push(decision.key);
      }
    }
    return rebuilt;
  }

  /**
   * Returns the decisions of a project whose `impacts` list contains the
   * given artefact path/key — "which decision touched this?".
   *
   * @param projectKey - Project key
   * @param ref - Artefact path or key to match
   * @returns Matching decisions (empty when the project is unknown)
   */
  impacting(projectKey: string, ref: string): readonly Decision[] {
    const project = this.projects.findByKey(projectKey);
    if (project === null) return [];
    return this.decisions.findImpacting(project.id, ref);
  }

  /**
   * Returns every decision currently in `proposed` status for the given
   * project — used by the inbox to surface ADRs awaiting review.
   *
   * @param projectKey - Project key
   * @returns Pending decisions ordered by `at`
   */
  listPending(projectKey: string): readonly Decision[] {
    return this.list(projectKey, DecisionStatus.Proposed);
  }
}
