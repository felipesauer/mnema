import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AuditQuery } from '../../../services/audit-query.js';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the `audit_query` MCP tool — read-only search over the
 * append-only audit log.
 *
 * Mirrors the CLI's `mnema audit query` flags: `kind`, `actor`, `via`,
 * `run`, `since`, `until`, `limit`. Time bounds accept ISO8601 or
 * relative durations (`30s`, `2h`, `7d`).
 */
export class AuditQueryTool {
  constructor(private readonly query: AuditQuery) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'audit_query',
      {
        description:
          'Query the audit log of the current project. Returns events matching the supplied filters in chronological order.',
        inputSchema: {
          kind: z.string().optional(),
          actor: z.string().optional(),
          via: z.string().optional(),
          run: z.string().optional(),
          since: z.string().optional().describe('ISO8601 or relative duration (e.g. 24h)'),
          until: z.string().optional(),
          limit: z.number().int().positive().optional(),
        },
      },
      (input) => {
        const events = this.query.run({
          kind: input.kind,
          actor: input.actor,
          via: input.via,
          run: input.run,
          since: input.since,
          until: input.until,
          limit: input.limit,
        });
        return ok({ events });
      },
    );
  }
}
