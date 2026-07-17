import type { DriftService } from '@mnema/core/services/drift-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the `drift_commits` MCP tool — a read-only scan for "ghost
 * work": commits on the current branch that no task claims.
 *
 * The report's governance gap is a session that commits code with no task
 * tracking it. This surfaces those commits so the agent (or a human) can
 * tie them to a task. A signal, never a gate: it reads git read-only and
 * returns `checked: false` when git is unavailable rather than raising a
 * false alarm. No active run required.
 */
export class DriftTool {
  constructor(
    private readonly drift: DriftService,
    private readonly projectRoot: string,
  ) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'drift_commits',
      {
        description:
          'Scan the current branch for commits not tied to any task (no commit-kind ' +
          'evidence references them) — the "committed code with no task" governance gap. ' +
          'Pass `base` (e.g. "main") to scan only commits ahead of that ref; otherwise the ' +
          'recent tail is scanned. Read-only; returns checked:false when git is unavailable ' +
          '(never a false alarm). A signal, not a gate.',
        inputSchema: {
          base: z
            .string()
            .optional()
            .describe('Base ref to scan against (e.g. "main"); scans base..HEAD when given'),
          limit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('When no base is given, how many recent commits to scan'),
        },
      },
      ({ base, limit }) => {
        const result = this.drift.scan(this.projectRoot, {
          ...(base === undefined ? {} : { base }),
          ...(limit === undefined ? {} : { limit }),
        });
        return ok({
          checked: result.checked,
          scanned: result.scanned,
          // Commits that name an existing task but carry no evidence link — one
          // command away from tracked. Each item carries the exact call to make.
          linkable_count: result.linkable.length,
          linkable: result.linkable.map((c) => ({
            sha: c.sha,
            subject: c.subject,
            task_keys: c.taskKeys,
            // criterion_index points at the acceptance criterion this commit
            // satisfies — pick it from task_show; a task with no criteria yet
            // needs one before commit evidence can attach.
            hint: `task_attach_evidence({ task_key: "${c.taskKeys[0]}", criterion_index: <i>, kind: "commit", ref: "${c.sha}" })`,
          })),
          untracked_count: result.untracked.length,
          untracked: result.untracked.map((c) => ({ sha: c.sha, subject: c.subject })),
          ...(result.reason === undefined ? {} : { reason: result.reason }),
        });
      },
    );
  }
}
