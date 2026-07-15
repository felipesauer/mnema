import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ErrorCode } from '../../../errors/error-codes.js';
import type {
  DependencyGraphService,
  GraphScope,
} from '../../../services/snapshot/dependency-graph-service.js';
import { err, ok } from '../../mcp-tool-result.js';

/**
 * Registers the read-only `graph_dependencies` MCP tool: the navigable
 * `blocks`-graph for an epic, a sprint, or the whole project — cycle
 * detection, the ready/blocked frontier, and the critical path (longest
 * blocking chain). Pure read, no active-run requirement (MNEMA-ADR-20).
 */
export class DependencyGraphTool {
  constructor(private readonly graph: DependencyGraphService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'graph_dependencies',
      {
        description:
          'Navigate the task blocks-graph for an epic, sprint, or the whole project: cycle detection, the blocking frontier (which open tasks are ready vs blocked-by-what), and the critical path (longest blocking chain). Scope defaults to the project; pass epic_key OR sprint_key to narrow. Read-only.',
        inputSchema: {
          epic_key: z.string().optional().describe('Scope to this epic, e.g. WEBAPP-EPIC-3'),
          sprint_key: z.string().optional().describe('Scope to this sprint, e.g. WEBAPP-SPRINT-3'),
        },
      },
      (input) => {
        if (input.epic_key !== undefined && input.sprint_key !== undefined) {
          return err({
            kind: ErrorCode.ValidationFailed,
            issues: [{ path: ['scope'], message: 'pass at most one of epic_key / sprint_key' }],
          });
        }
        const scope: GraphScope =
          input.epic_key !== undefined
            ? { kind: 'epic', key: input.epic_key }
            : input.sprint_key !== undefined
              ? { kind: 'sprint', key: input.sprint_key }
              : { kind: 'project' };

        const result = this.graph.forScope(scope);
        if (!result.ok) return err(result.error);
        return ok({ graph: result.value });
      },
    );
  }
}
