import type { z } from 'zod';

import type { ErrorCode } from './error-codes.js';

/**
 * One issue extracted from a Zod validation failure, formatted for
 * structured error responses.
 */
export interface ErrorIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly code?: string;
}

/**
 * Discriminated union covering every error a service may return.
 *
 * Each variant carries its own structured payload, matching the schemas
 * documented in `errors-catalog.md`.
 */
export type MnemaError =
  | { readonly kind: ErrorCode.ConfigNotFound; readonly currentDir: string }
  | { readonly kind: ErrorCode.ConfigInvalid; readonly path: string; readonly issues: ErrorIssue[] }
  | {
      readonly kind: ErrorCode.VersionMismatch;
      readonly required: string;
      readonly current: string;
    }
  | { readonly kind: ErrorCode.TaskNotFound; readonly taskKey: string }
  | {
      readonly kind: ErrorCode.GateFailed;
      readonly taskKey: string;
      readonly action: string;
      readonly issues: ErrorIssue[];
    }
  | {
      readonly kind: ErrorCode.InvalidTransition;
      readonly taskKey: string;
      readonly fromState: string;
      readonly action: string;
      readonly available: readonly string[];
    }
  | { readonly kind: ErrorCode.TaskKeyExists; readonly taskKey: string }
  | { readonly kind: ErrorCode.TerminalState; readonly taskKey: string; readonly state: string }
  | {
      readonly kind: ErrorCode.TaskAlreadyClaimed;
      readonly taskKey: string;
      readonly claimedBy: string;
      readonly leaseExpiresAt: string;
    }
  | {
      readonly kind: ErrorCode.TaskNotClaimed;
      readonly taskKey: string;
      /** Actor holding a live lease, when a *different* actor holds one; null when the task is simply unclaimed. */
      readonly claimedBy: string | null;
    }
  | { readonly kind: ErrorCode.ProjectNotFound; readonly projectKey: string }
  | { readonly kind: ErrorCode.WorkflowNotFound; readonly path: string }
  | {
      readonly kind: ErrorCode.WorkflowInvalid;
      readonly path: string;
      readonly issues: ErrorIssue[];
    }
  | { readonly kind: ErrorCode.IdentityNotConfigured }
  | { readonly kind: ErrorCode.AgentHandleMissing }
  | { readonly kind: ErrorCode.UnknownAssignee; readonly handle: string }
  | { readonly kind: ErrorCode.InitConflict; readonly path: string }
  | { readonly kind: ErrorCode.AlreadyInitialized; readonly configPath: string }
  | { readonly kind: ErrorCode.AgentRunNotFound; readonly runId: string }
  | {
      readonly kind: ErrorCode.AgentRunAlreadyEnded;
      readonly runId: string;
      readonly status: string;
    }
  | {
      readonly kind: ErrorCode.AgentRunNotResumable;
      readonly runId: string;
      readonly status: string;
    }
  | {
      readonly kind: ErrorCode.DepthLimitExceeded;
      readonly entity: 'agent_run' | 'agent_plan';
      readonly attemptedDepth: number;
      readonly limit: number;
    }
  | { readonly kind: ErrorCode.AgentPlanNotFound; readonly planId: string }
  | { readonly kind: ErrorCode.NoActiveRun }
  | {
      readonly kind: ErrorCode.Conflict;
      /**
       * Key of the entity whose row changed concurrently. The field
       * name is kept as `taskKey` for backward compatibility with the
       * first conflict path; `entity` says which kind of artefact it
       * actually is so the printer can phrase the message correctly.
       */
      readonly taskKey: string;
      readonly currentUpdatedAt: string;
      readonly entity?: 'task' | 'decision' | 'sprint';
    }
  | {
      readonly kind: ErrorCode.KeyCollision;
      /**
       * The table whose `key` UNIQUE constraint was violated, e.g. `tasks`.
       * Two writers sharing one `state.db` each minted the same sequential
       * key (the COUNT(*)-based `nextSequence` is check-then-act). Retryable:
       * a re-run re-reads the now-higher count and gets a fresh key.
       */
      readonly table: string;
    }
  | { readonly kind: ErrorCode.SprintNotFound; readonly sprintKey: string }
  | {
      readonly kind: ErrorCode.ActiveSprintExists;
      readonly projectKey: string;
      readonly activeSprintKey: string;
    }
  | {
      readonly kind: ErrorCode.SprintInvalidState;
      readonly sprintKey: string;
      readonly fromState: string;
      readonly toState: string;
    }
  | {
      readonly kind: ErrorCode.SprintInvalidPayload;
      readonly issues: ErrorIssue[];
    }
  | { readonly kind: ErrorCode.AttachmentSourceNotFound; readonly path: string }
  | { readonly kind: ErrorCode.DecisionNotFound; readonly decisionKey: string }
  | {
      readonly kind: ErrorCode.DecisionInvalidStatus;
      readonly decisionKey: string;
      readonly fromStatus: string;
      readonly toStatus: string;
    }
  | { readonly kind: ErrorCode.EpicNotFound; readonly epicKey: string }
  | {
      readonly kind: ErrorCode.EpicInvalidState;
      readonly epicKey: string;
      readonly fromState: string;
      readonly toState: string;
    }
  | {
      readonly kind: ErrorCode.EpicHasTasks;
      readonly epicKey: string;
      readonly taskCount: number;
    }
  | {
      readonly kind: ErrorCode.SchemaOutOfDate;
      readonly pending: readonly string[];
    }
  | {
      readonly kind: ErrorCode.ServerStale;
      /** Human-readable list of what diverged from the boot snapshot. */
      readonly changed: readonly string[];
    }
  | { readonly kind: ErrorCode.SkillNotFound; readonly slug: string }
  | { readonly kind: ErrorCode.MemoryNotFound; readonly slug: string }
  | {
      readonly kind: ErrorCode.SearchInvalidQuery;
      readonly query: string;
      readonly detail: string;
    }
  | { readonly kind: ErrorCode.StorageBusy; readonly detail: string }
  | {
      readonly kind: ErrorCode.FeatureNotAvailable;
      readonly feature: string;
      readonly workflow: string;
    }
  | {
      readonly kind: ErrorCode.InvalidWorkflowState;
      readonly workflow: string;
      readonly given: string;
      readonly allowed: readonly string[];
    }
  | { readonly kind: ErrorCode.NoteNotFound; readonly noteId: string }
  | { readonly kind: ErrorCode.ObservationNotFound; readonly observationId: string }
  | { readonly kind: ErrorCode.ObservationArchived; readonly observationId: string }
  | {
      readonly kind: ErrorCode.DependencyCycle;
      readonly taskKey: string;
      readonly blocksTaskKey: string;
    }
  | {
      readonly kind: ErrorCode.DependencyDuplicate;
      readonly taskKey: string;
      readonly blocksTaskKey: string;
      readonly dependencyKind: string;
    }
  | { readonly kind: ErrorCode.DependencySelf; readonly taskKey: string }
  | {
      /**
       * A memory or skill was asked to supersede itself — a self-referential
       * `superseded_by` pointer (a node that is its own replacement). `ref`
       * is the slug (memory) or slug/version label (skill) that collided.
       */
      readonly kind: ErrorCode.SelfSupersede;
      readonly entity: 'memory' | 'skill';
      readonly ref: string;
    }
  | {
      /**
       * An operation targeted a memory/skill that is already superseded:
       * re-recording a superseded slug (supersede is one-way, so the slug is
       * retired), or naming a superseded entity as a supersede successor (the
       * successor must be live). `ref` is the slug (memory) or slug/version
       * label (skill) involved.
       */
      readonly kind: ErrorCode.SupersededEntity;
      readonly entity: 'memory' | 'skill';
      readonly ref: string;
    }
  | {
      readonly kind: ErrorCode.AlreadyObsoleted;
      readonly ref: string;
      /** The slug already recorded as the contradictor of `ref`. */
      readonly obsoletedBy: string;
    }
  | {
      readonly kind: ErrorCode.EvidenceCriterionOutOfRange;
      readonly taskKey: string;
      readonly index: number;
      readonly criteriaCount: number;
    }
  | {
      readonly kind: ErrorCode.EvidenceDuplicate;
      readonly taskKey: string;
      readonly index: number;
      readonly ref: string;
    }
  | {
      readonly kind: ErrorCode.SprintMetricDuplicate;
      readonly sprintKey: string;
      readonly name: string;
    }
  | {
      /**
       * A field value failed a domain invariant before any storage write —
       * e.g. a non-integer/negative `context_budget` or a non-finite metric
       * `target`. Carries the same {@link ErrorIssue} shape as Zod-sourced
       * failures so producers (CLI, MCP, importers) reject identically.
       */
      readonly kind: ErrorCode.ValidationFailed;
      readonly issues: ErrorIssue[];
    };

/**
 * Adapts an array of Zod issues to the project-internal {@link ErrorIssue}
 * representation used in error responses.
 *
 * @param issues - Issues collected from a failed Zod parse
 * @returns Trimmed-down view suitable for serialization
 */
export function fromZodIssues(issues: readonly z.core.$ZodIssue[]): ErrorIssue[] {
  return issues.map((issue) => ({
    path: [...issue.path],
    message: issue.message,
    code: issue.code,
  }));
}
