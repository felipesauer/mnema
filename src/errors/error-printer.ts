import { pc } from '../utils/colors.js';

import { ErrorCode, ExitCode, type ExitCodeValue } from './error-codes.js';
import type { MnemaError } from './mnema-error.js';

/**
 * Formats a {@link MnemaError} into a human-readable multi-line string.
 *
 * Output format mirrors the catalog in `errors-catalog.md`:
 * - First line: short message ending without a period (Unix style)
 * - Optional indented sub-bullets (issues, fields)
 * - Final `hint:` line in dim colour
 *
 * @param error - Structured error to render
 * @returns Multi-line string ready for stderr
 */
export function formatError(error: MnemaError): string {
  const lines: string[] = [];

  switch (error.kind) {
    case ErrorCode.ConfigNotFound:
      lines.push(`mnema.config.json not found in ${error.currentDir} or any parent directory`);
      lines.push(`${pc.dim('hint:')} Run \`mnema init\` to create a new project`);
      break;

    case ErrorCode.ConfigInvalid:
      lines.push(`${error.path} is invalid`);
      for (const issue of error.issues) {
        lines.push(`  ${formatPath(issue.path)}: ${issue.message}`);
      }
      lines.push(
        `${pc.dim('hint:')} Check the schema at https://github.com/felipesauer/mnema#configuration`,
      );
      break;

    case ErrorCode.VersionMismatch:
      lines.push(`Project requires mnema ${error.required}, but you have ${error.current}`);
      lines.push(`${pc.dim('hint:')} Update with \`npm i -g @felipesauer/mnema@latest\``);
      break;

    case ErrorCode.TaskNotFound:
      lines.push(`Task ${error.taskKey} not found`);
      lines.push(`${pc.dim('hint:')} List existing tasks with \`mnema task list\``);
      break;

    case ErrorCode.GateFailed: {
      lines.push(`Cannot ${error.action} ${error.taskKey}: gate validation failed`);
      const fieldHints = new Set<string>();
      for (const issue of error.issues) {
        lines.push(`  - ${formatPath(issue.path)}: ${issue.message}`);
        const hint = fieldHintFor(formatPath(issue.path));
        if (hint !== null) fieldHints.add(hint);
      }
      lines.push(`${pc.dim('hint:')} Add the missing fields and try again`);
      for (const hint of fieldHints) {
        lines.push(`${pc.dim('  ·')} ${hint}`);
      }
      break;
    }

    case ErrorCode.InvalidTransition: {
      lines.push(
        `Cannot ${error.action} ${error.taskKey}: not available from state ${error.fromState}`,
      );
      const available = error.available.length > 0 ? error.available.join(', ') : '(none)';
      lines.push(`${pc.dim('hint:')} Available actions from ${error.fromState}: ${available}`);
      break;
    }

    case ErrorCode.TaskKeyExists:
      lines.push(`Task ${error.taskKey} already exists`);
      lines.push(`${pc.dim('hint:')} Use a different key or move the existing task`);
      break;

    case ErrorCode.TerminalState:
      lines.push(`Task ${error.taskKey} is in terminal state ${error.state}`);
      lines.push(`${pc.dim('hint:')} Terminal states cannot be transitioned out of`);
      break;

    case ErrorCode.TaskAlreadyClaimed:
      lines.push(
        `Task ${error.taskKey} is already claimed by ${error.claimedBy} (lease expires ${error.leaseExpiresAt})`,
      );
      lines.push(
        `${pc.dim('hint:')} Wait for the lease to expire, or ask ${error.claimedBy} to release it`,
      );
      break;

    case ErrorCode.ProjectNotFound:
      lines.push(`Project ${error.projectKey} not found in the database`);
      lines.push(`${pc.dim('hint:')} Run \`mnema doctor\` to inspect the workspace`);
      break;

    case ErrorCode.WorkflowNotFound:
      lines.push(`Workflow file not found: ${error.path}`);
      lines.push(`${pc.dim('hint:')} Restore it from the templates or pick a preset`);
      break;

    case ErrorCode.WorkflowInvalid:
      lines.push(`Workflow ${error.path} is invalid`);
      for (const issue of error.issues) {
        lines.push(`  ${formatPath(issue.path)}: ${issue.message}`);
      }
      break;

    case ErrorCode.IdentityNotConfigured:
      lines.push('No identity configured');
      lines.push(`${pc.dim('hint:')} Set MNEMA_ACTOR or create ~/.config/mnema/identity.json`);
      break;

    case ErrorCode.AgentHandleMissing:
      lines.push('No agent handle on the MCP session');
      lines.push(
        `${pc.dim('hint:')} Set MNEMA_AGENT_HANDLE in the env that spawns the server, or pass --agent-handle <name> to \`mnema mcp serve\``,
      );
      break;

    case ErrorCode.UnknownAssignee:
      lines.push(`Unknown assignee: ${error.handle}`);
      lines.push(
        `${pc.dim('hint:')} Register the actor with \`mnema identity add ${error.handle}\`, or pass a known handle`,
      );
      break;

    case ErrorCode.InitConflict:
      lines.push(`init aborted: ${error.path} already exists and would be overwritten`);
      lines.push(`${pc.dim('hint:')} Remove it or choose a dedicated paths-mode`);
      break;

    case ErrorCode.AlreadyInitialized:
      lines.push(`Project already initialised: ${error.configPath}`);
      lines.push(`${pc.dim('hint:')} Run \`mnema doctor\` to verify the workspace`);
      break;

    case ErrorCode.AgentRunNotFound:
      lines.push(`Agent run ${error.runId} not found`);
      lines.push(
        `${pc.dim('hint:')} Verify the run id with \`mnema audit query --kind=run_started\``,
      );
      break;

    case ErrorCode.AgentRunAlreadyEnded:
      lines.push(`Agent run ${error.runId} is already in terminal state ${error.status}`);
      lines.push(`${pc.dim('hint:')} Start a new run with agent_run_start`);
      break;

    case ErrorCode.AgentRunNotResumable:
      lines.push(`Agent run ${error.runId} cannot be resumed (status ${error.status})`);
      lines.push(
        `${pc.dim('hint:')} Only interrupted runs (aborted, failed) reopen; a completed run is closed — start a new one`,
      );
      break;

    case ErrorCode.DepthLimitExceeded:
      lines.push(`${error.entity} depth ${error.attemptedDepth} exceeds limit ${error.limit}`);
      lines.push(`${pc.dim('hint:')} Flatten the call hierarchy or split the work`);
      break;

    case ErrorCode.AgentPlanNotFound:
      lines.push(`Agent plan ${error.planId} not found`);
      break;

    case ErrorCode.NoActiveRun:
      lines.push('No active agent run for this session');
      lines.push(`${pc.dim('hint:')} Call agent_run_start before any mutation`);
      break;

    case ErrorCode.Conflict: {
      const entityLabel =
        error.entity === 'decision' ? 'Decision' : error.entity === 'sprint' ? 'Sprint' : 'Task';
      lines.push(
        `${entityLabel} ${error.taskKey} changed since you read it (current updated_at: ${error.currentUpdatedAt})`,
      );
      lines.push(
        `${pc.dim('hint:')} Re-read the ${entityLabel.toLowerCase()} and retry with the new updated_at`,
      );
      break;
    }

    case ErrorCode.SprintNotFound:
      lines.push(`Sprint ${error.sprintKey} not found`);
      lines.push(`${pc.dim('hint:')} List sprints with \`mnema sprint list\``);
      break;

    case ErrorCode.ActiveSprintExists:
      lines.push(
        `Project ${error.projectKey} already has an active sprint (${error.activeSprintKey})`,
      );
      lines.push(`${pc.dim('hint:')} Close it first with \`mnema sprint close\``);
      break;

    case ErrorCode.SprintInvalidState:
      lines.push(
        `Sprint ${error.sprintKey} cannot move from ${error.fromState} to ${error.toState}`,
      );
      lines.push(`${pc.dim('hint:')} Allowed transitions: PLANNED → ACTIVE → CLOSED`);
      break;

    case ErrorCode.SprintInvalidPayload:
      lines.push('Sprint payload is invalid');
      for (const issue of error.issues) {
        lines.push(`  - ${formatPath(issue.path)}: ${issue.message}`);
      }
      lines.push(`${pc.dim('hint:')} Use ISO8601 dates and a positive integer capacity`);
      break;

    case ErrorCode.AttachmentSourceNotFound:
      lines.push(`Source file does not exist: ${error.path}`);
      lines.push(`${pc.dim('hint:')} Check the path is reachable from the project root`);
      break;

    case ErrorCode.DecisionNotFound:
      lines.push(`Decision ${error.decisionKey} not found`);
      lines.push(`${pc.dim('hint:')} List decisions with \`mnema decision list\``);
      break;

    case ErrorCode.DecisionInvalidStatus:
      lines.push(
        `Decision ${error.decisionKey} cannot move from ${error.fromStatus} to ${error.toStatus}`,
      );
      lines.push(
        `${pc.dim('hint:')} Allowed transitions: proposed → accepted/rejected, any → superseded`,
      );
      break;

    case ErrorCode.EpicNotFound:
      lines.push(`Epic ${error.epicKey} not found`);
      lines.push(`${pc.dim('hint:')} List epics with \`mnema epic list\``);
      break;

    case ErrorCode.EpicInvalidState:
      lines.push(`Epic ${error.epicKey} cannot move from ${error.fromState} to ${error.toState}`);
      lines.push(`${pc.dim('hint:')} Allowed transitions: OPEN → CLOSED`);
      break;

    case ErrorCode.SchemaOutOfDate: {
      const count = error.pending.length;
      const noun = count === 1 ? 'migration' : 'migrations';
      lines.push(`Schema is out of date — ${count} ${noun} pending`);
      for (const file of error.pending) {
        lines.push(`  - ${file}`);
      }
      lines.push(`${pc.dim('hint:')} Run \`mnema migrate\` to apply pending migrations`);
      break;
    }

    case ErrorCode.SkillNotFound:
      lines.push(`Skill not found: ${error.slug}`);
      lines.push(`${pc.dim('hint:')} Run \`mnema skill list\` to see recorded skills`);
      break;

    case ErrorCode.MemoryNotFound:
      lines.push(`Memory not found: ${error.slug}`);
      lines.push(`${pc.dim('hint:')} Run \`mnema memory list\` to see recorded memories`);
      break;

    case ErrorCode.SearchInvalidQuery:
      lines.push(`Invalid search query: ${error.query}`);
      lines.push(`  ${error.detail}`);
      lines.push(
        `${pc.dim('hint:')} FTS5 reserves operators like AND/OR/NOT and characters like ", ', :, *. ` +
          `Quote the term ("O'Brien") or remove the special character.`,
      );
      break;

    case ErrorCode.StorageBusy:
      lines.push(`Storage is busy: ${error.detail}`);
      lines.push(
        `${pc.dim('hint:')} Another mutation is in flight against the SQLite database. ` +
          `Wait a moment and retry; if it persists, check for stuck \`mnema mcp serve\` processes.`,
      );
      break;

    case ErrorCode.FeatureNotAvailable: {
      lines.push(
        `Feature \`${error.feature}\` is not available in the \`${error.workflow}\` workflow`,
      );
      // Suggest only presets that actually ship the feature, and
      // exclude the active workflow from the suggestion so the hint
      // doesn't tell the user to switch back to where they already are.
      const presetsWithFeature: Readonly<Record<string, readonly string[]>> = {
        sprints: ['default', 'jira-classic'],
        epics: ['default', 'jira-classic'],
        review_workflow: ['default', 'jira-classic'],
        blocked_state: ['default', 'kanban'],
      };
      const suggestions = (presetsWithFeature[error.feature] ?? []).filter(
        (preset) => preset !== error.workflow,
      );
      const eg = suggestions.length > 0 ? ` (e.g. \`${suggestions.join('`, `')}\`)` : '';
      lines.push(
        `${pc.dim('hint:')} Pick a workflow that declares \`features.${error.feature}: true\`${eg} when running \`mnema init\`, or edit the active workflow JSON.`,
      );
      break;
    }

    case ErrorCode.InvalidWorkflowState:
      lines.push(`Unknown state \`${error.given}\` for workflow \`${error.workflow}\`.`);
      lines.push(`${pc.dim('hint:')} Valid states: ${error.allowed.join(', ')}.`);
      break;

    case ErrorCode.ObservationNotFound:
      lines.push(`Observation ${error.observationId} not found`);
      break;

    case ErrorCode.ObservationArchived:
      lines.push(`Observation ${error.observationId} is archived and cannot be promoted`);
      break;

    case ErrorCode.NoteNotFound:
      lines.push(`Note ${error.noteId} not found`);
      lines.push(
        `${pc.dim('hint:')} List notes with \`mnema note list <task_key>\` or query the audit log`,
      );
      break;
    case ErrorCode.DependencyCycle:
      lines.push(
        `Cannot make ${error.taskKey} depend on ${error.blocksTaskKey}: would create a cycle`,
      );
      lines.push(
        `${pc.dim('hint:')} ${error.blocksTaskKey} already depends on ${error.taskKey} (directly or transitively)`,
      );
      break;
    case ErrorCode.DependencyDuplicate:
      lines.push(
        `${error.taskKey} already depends on ${error.blocksTaskKey} (kind: ${error.dependencyKind})`,
      );
      break;
    case ErrorCode.DependencySelf:
      lines.push(`${error.taskKey} cannot depend on itself`);
      break;
    case ErrorCode.SelfSupersede:
      lines.push(`${error.entity} ${error.ref} cannot supersede itself`);
      break;
    case ErrorCode.SupersededEntity:
      lines.push(`${error.entity} ${error.ref} is superseded`);
      lines.push(
        `${pc.dim('hint:')} supersede is one-way — record under a new slug instead of reviving a superseded one`,
      );
      break;
    case ErrorCode.EvidenceCriterionOutOfRange:
      lines.push(
        `${error.taskKey} has ${error.criteriaCount} acceptance criteria; index ${error.index} is out of range`,
      );
      lines.push(
        `${pc.dim('hint:')} criterion_index is 0-based; check \`mnema task show ${error.taskKey}\``,
      );
      break;
    case ErrorCode.EvidenceDuplicate:
      lines.push(
        `${error.taskKey} criterion ${error.index} already has that evidence (${error.ref})`,
      );
      break;
    case ErrorCode.SprintMetricDuplicate:
      lines.push(`Sprint ${error.sprintKey} already has a metric named "${error.name}"`);
      break;

    case ErrorCode.ValidationFailed:
      lines.push('Invalid input');
      for (const issue of error.issues) {
        lines.push(`  - ${formatPath(issue.path)}: ${issue.message}`);
      }
      break;
  }

  return lines.join('\n');
}

/**
 * Returns the appropriate process exit code for an error.
 *
 * @param error - Structured error
 * @returns Numeric exit code in the range defined by {@link ExitCode}
 */
export function exitCodeFor(error: MnemaError): ExitCodeValue {
  switch (error.kind) {
    // Conflict (4): retryable — the caller raced a concurrent change or hit a
    // contended resource. A wrapper script keys its retry loop off this code,
    // so it must be distinct from Usage. (errors-catalog.md: E_CONFLICT, E_DB_LOCKED.)
    // Only genuine races belong here. Deterministic "already exists" duplicates
    // (DependencyDuplicate/EvidenceDuplicate/SprintMetricDuplicate) are NOT
    // retryable — they live under Usage with TaskKeyExists.
    case ErrorCode.Conflict:
    case ErrorCode.InitConflict:
    case ErrorCode.ActiveSprintExists:
    case ErrorCode.StorageBusy:
    case ErrorCode.TaskAlreadyClaimed:
      return ExitCode.Conflict;

    // State (3): the artefact exists but is in the wrong state for the action;
    // resolvable by changing state (migrate, upgrade, pick a valid transition).
    case ErrorCode.VersionMismatch:
    case ErrorCode.AlreadyInitialized:
    case ErrorCode.SchemaOutOfDate:
    case ErrorCode.TerminalState:
    case ErrorCode.InvalidTransition:
    case ErrorCode.SprintInvalidState:
    case ErrorCode.DecisionInvalidStatus:
    case ErrorCode.EpicInvalidState:
    case ErrorCode.InvalidWorkflowState:
    case ErrorCode.AgentRunAlreadyEnded:
    case ErrorCode.AgentRunNotResumable:
    case ErrorCode.DependencyCycle:
    case ErrorCode.DependencySelf:
      return ExitCode.State;

    // Internal (5): a bug or an unrecoverable runtime fault.
    case ErrorCode.DepthLimitExceeded:
      return ExitCode.Internal;

    // Usage (2): bad invocation or a not-found / validation failure the caller
    // can fix by changing arguments. The remaining catalogued codes.
    case ErrorCode.ConfigNotFound:
    case ErrorCode.ConfigInvalid:
    case ErrorCode.TaskNotFound:
    case ErrorCode.GateFailed:
    case ErrorCode.TaskKeyExists:
    case ErrorCode.DependencyDuplicate:
    case ErrorCode.EvidenceDuplicate:
    case ErrorCode.SprintMetricDuplicate:
    case ErrorCode.ProjectNotFound:
    case ErrorCode.WorkflowNotFound:
    case ErrorCode.WorkflowInvalid:
    case ErrorCode.IdentityNotConfigured:
    case ErrorCode.AgentHandleMissing:
    case ErrorCode.UnknownAssignee:
    case ErrorCode.AgentRunNotFound:
    case ErrorCode.AgentPlanNotFound:
    case ErrorCode.NoActiveRun:
    case ErrorCode.SprintNotFound:
    case ErrorCode.SprintInvalidPayload:
    case ErrorCode.AttachmentSourceNotFound:
    case ErrorCode.DecisionNotFound:
    case ErrorCode.EpicNotFound:
    case ErrorCode.SkillNotFound:
    case ErrorCode.MemoryNotFound:
    case ErrorCode.SearchInvalidQuery:
    case ErrorCode.FeatureNotAvailable:
    case ErrorCode.NoteNotFound:
    case ErrorCode.ObservationNotFound:
    case ErrorCode.ObservationArchived:
    case ErrorCode.SelfSupersede:
    case ErrorCode.SupersededEntity:
    case ErrorCode.EvidenceCriterionOutOfRange:
    case ErrorCode.ValidationFailed:
      return ExitCode.Usage;

    default:
      return assertNever(error);
  }
}

/**
 * Compile-time exhaustiveness guard. If a new {@link MnemaError} variant is
 * added without a matching `exitCodeFor` case, this stops compiling — turning a
 * silent fall-through to {@link ExitCode.Usage} into a type error. At runtime it
 * still degrades to {@link ExitCode.Generic} rather than throwing.
 */
function assertNever(error: never): ExitCodeValue {
  void error;
  return ExitCode.Generic;
}

/**
 * Writes a formatted error to stderr and returns the matching exit code.
 *
 * @param error - Structured error
 * @returns Exit code suitable for `process.exit`
 */
export function printError(error: MnemaError): ExitCodeValue {
  process.stderr.write(`${pc.red('error:')} ${formatError(error)}\n`);
  return exitCodeFor(error);
}

/**
 * Converts the structured form expected by MCP responses for an error.
 *
 * @param error - Structured error
 * @returns Plain object ready to JSON-serialise as an MCP tool response
 */
export function toStructured(error: MnemaError): Record<string, unknown> {
  return {
    error: error.kind,
    ...Object.fromEntries(Object.entries(error).filter(([key]) => key !== 'kind')),
  };
}

function formatPath(parts: readonly PropertyKey[]): string {
  if (parts.length === 0) return '<root>';
  return parts.map(String).join('.');
}

/**
 * Returns a one-line guidance string for common gate fields. The
 * workflow JSON expresses constraints as Zod-like schemas, but agents
 * still hit ambiguity around fields whose semantics are richer than
 * the schema can express (e.g. `assignee_id` accepts a handle *or* a
 * UUID, but the schema only sees a string). Returning `null` means no
 * extra guidance — the generic "missing fields" hint already covers it.
 *
 * @param fieldPath - Path produced by {@link formatPath}
 * @returns Inline hint or `null`
 */
function fieldHintFor(fieldPath: string): string | null {
  switch (fieldPath) {
    case 'assignee_id':
      return 'assignee_id accepts an actor handle (e.g. `maria`) or a UUID';
    case 'pr_url':
      return 'pr_url validates URL format only — fictional URLs are accepted';
    case 'estimate':
      return 'estimate must be one of the Fibonacci values declared in the workflow (e.g. 1,2,3,5,8,13)';
    case 'acceptance_criteria':
      return 'acceptance_criteria is a non-empty array of strings — pass at least one criterion';
    default:
      return null;
  }
}
