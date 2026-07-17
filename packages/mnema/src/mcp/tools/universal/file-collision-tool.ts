import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import type {
  CollisionScope,
  FileCollisionService,
} from '@mnema/core/services/lint/file-collision-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { err, ok } from '../../mcp-tool-result.js';

/**
 * Registers the read-only `file_collisions` MCP tool: within an epic or
 * sprint, warns when two tasks touch the same files (inferred from their
 * commit evidence) — the "parallel PRs all edited the same file" hazard.
 * Advisory; names the colliding tasks + files. No active-run requirement
 * (MNEMA-ADR-20).
 */
export class FileCollisionTool {
  constructor(private readonly collisions: FileCollisionService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'file_collisions',
      {
        description:
          "Within an epic or sprint, find tasks that touch the same files — a warning that parallel work will collide on merge. Each task's file set is inferred from its commit evidence (git show); tasks without commit evidence are reported as skipped, not analysed. Pass exactly one of epic_key / sprint_key. Read-only, advisory.",
        inputSchema: {
          epic_key: z.string().optional().describe('Scope to this epic'),
          sprint_key: z.string().optional().describe('Scope to this sprint'),
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
        const scope: CollisionScope = hasEpic
          ? { kind: 'epic', key: input.epic_key as string }
          : { kind: 'sprint', key: input.sprint_key as string };

        const result = this.collisions.scan(scope);
        if (!result.ok) return err(result.error);
        return ok({ ...result.value });
      },
    );
  }
}
