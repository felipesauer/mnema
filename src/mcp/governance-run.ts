import { AgentRunStatus } from '../domain/enums/agent-run-status.js';
import type { AgentRunService } from '../services/agent-run-service.js';
import type { IdentityService } from '../services/identity-service.js';
import type { McpSessionContext } from './mcp-session-context.js';

/**
 * A resolved run for a governance act, plus a finalizer to close it.
 *
 * `runId` is `undefined` only when no run is active and one could not be
 * opened (no agent handle on the session) — the caller then proceeds
 * run-less, exactly as before. `finalize` is a no-op unless this call
 * opened a transient run, in which case it ends it.
 *
 * `finalize` takes the terminal status to close a transient run with. The
 * default is `Completed` — the governance act proceeded. A caller that
 * refuses or errors out of the act (a blocked gate, a failed transition, a
 * thrown handler) must pass `Aborted` so the system run is not recorded as
 * a completed governance act that never happened.
 */
export interface GovernanceRun {
  readonly runId: string | undefined;
  readonly finalize: (status?: AgentRunStatus) => void;
}

/**
 * Resolves the run id to attribute a governance act to — approving a
 * task, attaching retroactive evidence — without forcing the agent to
 * open an execution run first.
 *
 * Governance acts are administrative, not units of work: requiring a
 * live execution run to approve an already-finished task is the friction
 * the usage audit flagged. When a run is already active, this returns it
 * untouched (the act joins that run). When none is active, it opens a
 * short-lived **system run** so provenance (actor / via / run) is still
 * captured in the audit trail, and hands back a `finalize` that ends it.
 *
 * @param session - The MCP session (source of the active run + handle)
 * @param agentRun - Service used to open/close the transient system run
 * @param identity - Resolves the default human actor
 * @param toolName - Name of the governance tool, for the run goal
 * @returns The run id to use and a finalizer to close any opened run
 */
export function resolveGovernanceRun(
  session: McpSessionContext,
  agentRun: AgentRunService,
  identity: IdentityService,
  toolName: string,
): GovernanceRun {
  const active = session.getCurrentRunId();
  if (active !== null) {
    // Already inside a run — the governance act simply joins it.
    return { runId: active, finalize: () => {} };
  }

  const handle = session.getClientMetadata().agent_handle;
  if (handle === undefined || handle.length === 0) {
    // No handle to attribute a system run to; proceed run-less rather
    // than block a governance act on metadata the client did not send.
    return { runId: undefined, finalize: () => {} };
  }

  const started = agentRun.start({
    goal: `governance: ${toolName}`,
    actor: identity.getDefaultActor(),
    agentHandle: handle,
    metadata: { governance: true, tool: toolName },
    clientMetadata: session.getClientMetadata() as Record<string, unknown>,
  });
  if (!started.ok) {
    // Opening the system run failed (e.g. depth limit) — fall back to a
    // run-less act rather than fail the governance operation outright.
    return { runId: undefined, finalize: () => {} };
  }

  const runId = started.value.id;
  return {
    runId,
    finalize: (status: AgentRunStatus = AgentRunStatus.Completed) => {
      agentRun.end({ runId, status });
    },
  };
}
