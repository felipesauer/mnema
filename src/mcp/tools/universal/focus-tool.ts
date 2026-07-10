import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { FocusService } from '../../../services/focus-service.js';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the `focus` MCP tool — a one-line, re-pullable answer to
 * "what am I doing right now".
 *
 * `context_bootstrap` gives direction once at session start; a long
 * session then drifts and the agent forgets it has a task open. Mnema
 * cannot push a reminder into the client, so this makes focus cheap to
 * re-pull at any point. A client can call it periodically or before an
 * edit; the cadence is the client's to choose. Read-only; no active run
 * required.
 */
export class FocusTool {
  constructor(private readonly focus: FocusService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'focus',
      {
        description:
          'Return a one-line, re-pullable focus for the current session: the task ' +
          'in progress to resume, or the next task to start, or that the backlog is ' +
          'idle. A cheap re-pull of the direction context_bootstrap gives once at ' +
          'session start, for long sessions where that drifts. Read-only; no active run required.',
      },
      () => {
        const focus = this.focus.current();
        return ok({
          line: focus.line,
          focus: focus.focus,
          active_task: focus.activeTask,
          next_task: focus.nextTask,
        });
      },
    );
  }
}
