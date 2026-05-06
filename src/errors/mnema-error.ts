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
  | { readonly kind: ErrorCode.ProjectNotFound; readonly projectKey: string }
  | { readonly kind: ErrorCode.WorkflowNotFound; readonly path: string }
  | {
      readonly kind: ErrorCode.WorkflowInvalid;
      readonly path: string;
      readonly issues: ErrorIssue[];
    }
  | { readonly kind: ErrorCode.IdentityNotConfigured }
  | { readonly kind: ErrorCode.InitConflict; readonly path: string }
  | { readonly kind: ErrorCode.AlreadyInitialized; readonly configPath: string }
  | { readonly kind: ErrorCode.AgentRunNotFound; readonly runId: string }
  | {
      readonly kind: ErrorCode.AgentRunAlreadyEnded;
      readonly runId: string;
      readonly status: string;
    }
  | {
      readonly kind: ErrorCode.DepthLimitExceeded;
      readonly entity: 'agent_run' | 'agent_plan';
      readonly attemptedDepth: number;
      readonly limit: number;
    }
  | { readonly kind: ErrorCode.AgentPlanNotFound; readonly planId: string };

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
