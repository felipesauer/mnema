import type { Decision } from '../domain/entities/decision.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { DecisionStatus } from '../domain/enums/decision-status.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { DecisionRepository } from '../storage/sqlite/repositories/decision-repository.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { AuditService } from './audit-service.js';
import type { IdentityService } from './identity-service.js';
import { Err, Ok, type Result } from './result.js';

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
      authoredBy,
    });

    this.audit.write({
      kind: 'decision_recorded',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: decision.key, title: decision.title, status: decision.status },
    });

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
      supersededById = successor.id;
    }

    const updated = this.decisions.updateStatus(decision.id, input.status, supersededById);
    if (updated === null) {
      return Err({ kind: ErrorCode.DecisionNotFound, decisionKey: input.decisionKey });
    }

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
