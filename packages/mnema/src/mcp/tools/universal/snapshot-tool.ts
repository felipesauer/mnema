import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import { renderMarkdown } from '@mnema/core/services/snapshot/snapshot-render.js';
import type {
  SnapshotScope,
  SnapshotService,
} from '@mnema/core/services/snapshot/snapshot-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { err, ok } from '../../mcp-tool-result.js';

/**
 * Registers the read-only `snapshot_generate` MCP tool: a composed
 * executive snapshot of an epic or sprint — coverage, the dependency
 * picture (cycles + critical path) and SLA breaches — returned both as
 * structured data and as rendered markdown. Composes existing services;
 * computes nothing new. No active-run requirement (MNEMA-ADR-20).
 */
export class SnapshotTool {
  constructor(private readonly snapshot: SnapshotService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'snapshot_generate',
      {
        description:
          'Generate an executive snapshot of an epic or sprint: coverage (totals, by-state, completion %), the dependency picture (cycles + critical path + ready/blocked) and SLA breaches scoped to it. Returns structured data plus rendered markdown. Pass exactly one of epic_key / sprint_key. Read-only.',
        inputSchema: {
          epic_key: z.string().optional().describe('Snapshot this epic, e.g. WEBAPP-EPIC-3'),
          sprint_key: z.string().optional().describe('Snapshot this sprint, e.g. WEBAPP-SPRINT-1'),
        },
      },
      (input) => {
        const hasEpic = input.epic_key !== undefined;
        const hasSprint = input.sprint_key !== undefined;
        if (hasEpic === hasSprint) {
          return err({
            kind: ErrorCode.ValidationFailed,
            issues: [{ path: ['scope'], message: 'pass exactly one of epic_key / sprint_key' }],
          });
        }
        const scope: SnapshotScope = hasEpic
          ? { kind: 'epic', key: input.epic_key as string }
          : { kind: 'sprint', key: input.sprint_key as string };

        const result = this.snapshot.forScope(scope);
        if (!result.ok) return err(result.error);
        return ok({ snapshot: result.value, markdown: renderMarkdown(result.value) });
      },
    );
  }
}
