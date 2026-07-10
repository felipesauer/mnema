import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AuditQuery } from '../../../services/audit-query.js';
import { ok } from '../../mcp-tool-result.js';
import { timeBoundSchema } from '../../time-bound-schema.js';

/**
 * Registers the `history_get` MCP tool — a curated, human-friendly view
 * of the audit log.
 *
 * Where `audit_query` exposes raw events for diagnostics, `history_get`
 * trims the noise: it scopes the result to the requested time window,
 * caps the page size at 100, and groups events by run when one is
 * specified. Agents asking "what happened recently" should reach for
 * this tool first.
 */
export class HistoryTool {
  constructor(private readonly query: AuditQuery) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'history_get',
      {
        description:
          'Recent activity overview. Optionally scoped to a single agent run or a time window.',
        inputSchema: {
          since: timeBoundSchema('ISO8601 or relative duration (e.g. 24h). Defaults to 24h.'),
          run: z.string().optional().describe('Filter by agent run id'),
          limit: z.number().int().positive().max(100).optional(),
        },
      },
      (input) => {
        const events = this.query.run({
          since: input.since ?? '24h',
          run: input.run,
          limit: input.limit ?? 50,
        });
        return ok({ events, count: events.length });
      },
    );
  }
}
