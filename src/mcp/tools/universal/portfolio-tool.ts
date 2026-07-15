import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { PortfolioService } from '../../../services/knowledge/portfolio-service.js';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the `tasks_query` MCP tool — the aggregate read over the
 * backlog: counts and lists tasks filtered by state, epic, sprint,
 * creation window and free text. The static "what's in the portfolio"
 * cut that `metrics_flow` (flow over time) does not give, so a
 * levantamento no longer needs grep over the audit JSONL. Read-only;
 * requires no active run. (Per-epic / per-sprint completion snapshots
 * are served by the existing `epic_coverage` / `sprint_coverage` tools.)
 */
export class PortfolioTool {
  constructor(private readonly portfolio: PortfolioService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'tasks_query',
      {
        description:
          'Aggregate query over the backlog: returns { total, by_state, tasks, filters } for ' +
          'tasks matching the given filters (all optional, AND-combined). Filter by state, ' +
          'epic_key, sprint_key, labels (the task must carry all of them), a created-at window ' +
          '(created_since / created_until, ISO-8601) and free text over title+description. An ' +
          'unknown epic/sprint key or label yields an empty result, not a silently-ignored ' +
          'filter. Read-only; requires no active run. For per-epic/per-sprint completion %, use ' +
          'epic_coverage / sprint_coverage.',
        inputSchema: {
          state: z.string().optional().describe('Exact workflow state, e.g. IN_REVIEW'),
          epic_key: z.string().optional().describe('Epic key, e.g. WEBAPP-EPIC-3'),
          sprint_key: z.string().optional().describe('Sprint key, e.g. WEBAPP-SPRINT-1'),
          labels: z
            .array(z.string().min(1))
            .optional()
            .describe('Labels the task must all carry (AND), e.g. ["area:api", "tipo:bug"]'),
          created_since: z
            .string()
            .optional()
            .describe('Lower bound on createdAt (ISO-8601, inclusive)'),
          created_until: z
            .string()
            .optional()
            .describe('Upper bound on createdAt (ISO-8601, inclusive)'),
          text: z
            .string()
            .optional()
            .describe('Case-insensitive substring over title + description'),
        },
      },
      (input) => {
        const result = this.portfolio.run({
          state: input.state,
          epicKey: input.epic_key,
          sprintKey: input.sprint_key,
          labels: input.labels,
          createdSince: input.created_since,
          createdUntil: input.created_until,
          text: input.text,
        });
        return ok({ ...result });
      },
    );
  }
}
