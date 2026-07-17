import type { CoverageService } from '@mnema/core/services/backlog/coverage-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { err, ok } from '../../mcp-tool-result.js';

/**
 * Registers the read-only coverage MCP tools — `epic_coverage` and
 * `sprint_coverage`. Coverage is a computed aggregate (terminal/total
 * percent + the open task list), never a stored field, so these are
 * pure reads with no active-run requirement. See MNEMA-ADR-20.
 */
export class CoverageTools {
  constructor(private readonly coverage: CoverageService) {}

  /**
   * Attaches the coverage tools to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'epic_coverage',
      {
        description:
          'Report coverage of an epic: how many of its tasks are in a terminal state, the per-state breakdown, the percent complete, and the keys of the tasks still open. Read-only.',
        inputSchema: {
          epic_key: z.string().describe('Epic key, e.g. WEBAPP-EPIC-3'),
        },
      },
      ({ epic_key: epicKey }) => {
        const result = this.coverage.forEpic(epicKey);
        if (!result.ok) return err(result.error);
        return ok({ coverage: result.value });
      },
    );

    server.registerTool(
      'sprint_coverage',
      {
        description:
          'Report coverage of a sprint: how many of its tasks are in a terminal state, the per-state breakdown, the percent complete, and the keys of the tasks still open. Read-only.',
        inputSchema: {
          sprint_key: z.string().describe('Sprint key, e.g. WEBAPP-SPRINT-3'),
        },
      },
      ({ sprint_key: sprintKey }) => {
        const result = this.coverage.forSprint(sprintKey);
        if (!result.ok) return err(result.error);
        return ok({ coverage: result.value });
      },
    );
  }
}
