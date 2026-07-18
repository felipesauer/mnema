import type { RunDiffService } from '@mnema/core/services/metrics/run-diff-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { err, ok } from '../../mcp-tool-result.js';

/**
 * Registers the read-only `run_diff` MCP tool: given a run id, the
 * grouped set of changes that run produced — transitions, evidence,
 * decisions, knowledge — so a whole agent session can be audited at
 * once. Works for completed and in-progress runs. Pure read, no
 * active-run requirement.
 */
export class RunDiffTool {
  constructor(private readonly runDiff: RunDiffService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'run_diff',
      {
        description:
          'Summarise everything one agent run changed: task transitions, evidence attached, decisions recorded, and durable knowledge (memories / skills / observations / notes), grouped with counts. Works for a completed or in-progress run. Read-only.',
        inputSchema: {
          run_id: z.string().describe('The agent run id (from agent_run_start / agent_run_show)'),
        },
      },
      ({ run_id: runId }) => {
        const result = this.runDiff.forRun(runId);
        if (!result.ok) return err(result.error);
        return ok({ diff: result.value });
      },
    );
  }
}
