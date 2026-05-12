/**
 * Canonical error codes used across the codebase.
 *
 * Aligns with `errors-catalog.md`. Codes are SCREAMING_SNAKE_CASE
 * matching the `error` field in MCP responses.
 */
export enum ErrorCode {
  ConfigNotFound = 'CONFIG_NOT_FOUND',
  ConfigInvalid = 'CONFIG_INVALID',
  VersionMismatch = 'VERSION_MISMATCH',

  TaskNotFound = 'TASK_NOT_FOUND',
  GateFailed = 'GATE_FAILED',
  InvalidTransition = 'INVALID_TRANSITION',
  TaskKeyExists = 'TASK_KEY_EXISTS',
  TerminalState = 'TERMINAL_STATE',

  ProjectNotFound = 'PROJECT_NOT_FOUND',
  WorkflowNotFound = 'WORKFLOW_NOT_FOUND',
  WorkflowInvalid = 'WORKFLOW_INVALID',

  IdentityNotConfigured = 'IDENTITY_NOT_CONFIGURED',
  AgentHandleMissing = 'AGENT_HANDLE_MISSING',

  InitConflict = 'INIT_CONFLICT',
  AlreadyInitialized = 'ALREADY_INITIALIZED',

  AgentRunNotFound = 'AGENT_RUN_NOT_FOUND',
  AgentRunAlreadyEnded = 'AGENT_RUN_ALREADY_ENDED',
  DepthLimitExceeded = 'DEPTH_LIMIT_EXCEEDED',
  AgentPlanNotFound = 'AGENT_PLAN_NOT_FOUND',

  NoActiveRun = 'NO_ACTIVE_RUN',
  Conflict = 'CONFLICT',

  SprintNotFound = 'SPRINT_NOT_FOUND',
  ActiveSprintExists = 'ACTIVE_SPRINT_EXISTS',
  SprintInvalidState = 'SPRINT_INVALID_STATE',
  SprintInvalidPayload = 'SPRINT_INVALID_PAYLOAD',
  AttachmentSourceNotFound = 'ATTACHMENT_SOURCE_NOT_FOUND',
  DecisionNotFound = 'DECISION_NOT_FOUND',
  DecisionInvalidStatus = 'DECISION_INVALID_STATUS',
  EpicNotFound = 'EPIC_NOT_FOUND',
  EpicInvalidState = 'EPIC_INVALID_STATE',

  SchemaOutOfDate = 'SCHEMA_OUT_OF_DATE',

  SkillNotFound = 'SKILL_NOT_FOUND',
  MemoryNotFound = 'MEMORY_NOT_FOUND',

  SearchInvalidQuery = 'SEARCH_INVALID_QUERY',
  StorageBusy = 'STORAGE_BUSY',

  FeatureNotAvailable = 'FEATURE_NOT_AVAILABLE',

  InvalidWorkflowState = 'INVALID_WORKFLOW_STATE',
}

/**
 * Process exit codes used by CLI commands when reporting errors.
 *
 * Mirrors the table documented in `errors-catalog.md`.
 */
export const ExitCode = {
  Success: 0,
  Generic: 1,
  Usage: 2,
  State: 3,
  Conflict: 4,
  Internal: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
