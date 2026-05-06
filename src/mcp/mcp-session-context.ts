/**
 * Lifecycle status of the MCP server.
 */
export enum McpServerStatus {
  Running = 'running',
  ShuttingDown = 'shutting_down',
}

/**
 * Metadata carried in by the MCP client at connection time.
 *
 * The client (Claude Code, Cursor, etc.) injects this through the MCP
 * config — the LLM cannot self-declare it. Treated as "soft truth": it
 * should be combined with `client_metadata` (pid, hostname) for forensic
 * use cases.
 */
export interface McpClientMetadata {
  readonly agent_handle?: string;
  readonly [key: string]: unknown;
}

/**
 * Per-process state for the MCP server.
 *
 * Holds the currently active agent run, the client metadata captured at
 * boot, and a server-status flag flipped to `ShuttingDown` while the
 * graceful shutdown handler drains in-flight tool calls.
 */
export class McpSessionContext {
  private status: McpServerStatus = McpServerStatus.Running;
  private currentRunId: string | null = null;
  private clientMetadata: McpClientMetadata;

  constructor(clientMetadata: McpClientMetadata = {}) {
    this.clientMetadata = clientMetadata;
  }

  /**
   * Returns the active server status.
   */
  getStatus(): McpServerStatus {
    return this.status;
  }

  /**
   * Marks the server as draining; tool dispatch must reject new calls
   * once this is set.
   */
  setStatus(status: McpServerStatus): void {
    this.status = status;
  }

  /**
   * Returns the currently active agent run id, or `null` when the
   * agent has not called `agent_run_start` yet.
   */
  getCurrentRunId(): string | null {
    return this.currentRunId;
  }

  /**
   * Stores the current agent run id (set by `agent_run_start`).
   *
   * @param runId - Identifier of the active run, or `null` to clear it
   */
  setCurrentRunId(runId: string | null): void {
    this.currentRunId = runId;
  }

  /**
   * Returns the client metadata captured at connection time.
   */
  getClientMetadata(): McpClientMetadata {
    return this.clientMetadata;
  }

  /**
   * Replaces the client metadata. Useful when the connection negotiates
   * additional fields after the initial handshake.
   *
   * @param metadata - Fresh metadata payload
   */
  setClientMetadata(metadata: McpClientMetadata): void {
    this.clientMetadata = metadata;
  }
}
