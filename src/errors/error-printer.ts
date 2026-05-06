import pc from 'picocolors';

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
      lines.push(`${pc.dim('hint:')} Check the schema at https://mnema.dev/docs/config`);
      break;

    case ErrorCode.VersionMismatch:
      lines.push(`Project requires mnema ${error.required}, but you have ${error.current}`);
      lines.push(`${pc.dim('hint:')} Update with \`npm i -g @saurim/mnema@latest\``);
      break;

    case ErrorCode.TaskNotFound:
      lines.push(`Task ${error.taskKey} not found`);
      lines.push(`${pc.dim('hint:')} List existing tasks with \`mnema task list\``);
      break;

    case ErrorCode.GateFailed:
      lines.push(`Cannot ${error.action} ${error.taskKey}: gate validation failed`);
      for (const issue of error.issues) {
        lines.push(`  - ${formatPath(issue.path)}: ${issue.message}`);
      }
      lines.push(`${pc.dim('hint:')} Add the missing fields and try again`);
      break;

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

    case ErrorCode.DepthLimitExceeded:
      lines.push(`${error.entity} depth ${error.attemptedDepth} exceeds limit ${error.limit}`);
      lines.push(`${pc.dim('hint:')} Flatten the call hierarchy or split the work`);
      break;

    case ErrorCode.AgentPlanNotFound:
      lines.push(`Agent plan ${error.planId} not found`);
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
    case ErrorCode.VersionMismatch:
    case ErrorCode.AlreadyInitialized:
      return ExitCode.State;
    case ErrorCode.InitConflict:
      return ExitCode.Conflict;
    default:
      return ExitCode.Usage;
  }
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
