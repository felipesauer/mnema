import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { WorkGraphLintService } from '../../../services/work-graph-lint-service.js';
import { err, ok } from '../../mcp-tool-result.js';

/**
 * Registers the read-only work-graph lint tools — `sprint_lint` and
 * `epic_lint`. They surface integrity/process diagnostics (incomplete
 * tasks, subagent-bypass, broken dependencies) without mutating state,
 * so an orchestrating agent can check a sprint before declaring it done.
 */
export class WorkGraphLintTools {
  constructor(private readonly lint: WorkGraphLintService) {}

  /**
   * Attaches the lint tools to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'sprint_lint',
      {
        description:
          'Run read-only integrity checks over a sprint: tasks not in a terminal state, terminal tasks with no agent-run trail (subagent-bypass), and broken dependencies. Returns diagnostics; mutates nothing.',
        inputSchema: {
          sprint_key: z.string().describe('Sprint key, e.g. WEBAPP-SPRINT-3'),
        },
      },
      ({ sprint_key: sprintKey }) => {
        const result = this.lint.lintSprint(sprintKey);
        if (!result.ok) return err(result.error);
        return ok({ report: result.value });
      },
    );

    server.registerTool(
      'epic_lint',
      {
        description:
          'Run read-only integrity checks over an epic: empty epic, tasks not in a terminal state, subagent-bypass, and broken dependencies. Returns diagnostics; mutates nothing.',
        inputSchema: {
          epic_key: z.string().describe('Epic key, e.g. WEBAPP-EPIC-3'),
        },
      },
      ({ epic_key: epicKey }) => {
        const result = this.lint.lintEpic(epicKey);
        if (!result.ok) return err(result.error);
        return ok({ report: result.value });
      },
    );
  }
}
