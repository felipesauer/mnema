import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { GitHubPrService } from '../../../services/github-pr-service.js';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the `pr_status` MCP tool — resolves a pull request's state
 * and CI status from its URL, closing the loop `submit_review` leaves
 * open (it accepts a `pr_url` but never checks it).
 *
 * Read-only; requires no active run. Uses the GitHub CLI under the hood
 * and degrades gracefully (`available: false` with a reason) when `gh`
 * is missing, unauthenticated, or offline — so an agent can decide
 * whether a task is genuinely safe to approve without the call ever
 * failing the session.
 */
export class PrStatusTool {
  constructor(private readonly githubPr: GitHubPrService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'pr_status',
      {
        description:
          "Resolve a pull request's state (open/merged/closed) and CI status from its URL, " +
          'via the GitHub CLI. Use it before approving a task to check whether the PR merged ' +
          'and its code passed. Returns { available, ref, state, merged, ci, ciBase, ' +
          'mergeCommit }: `ci` is the PR HEAD (branch tip) rollup; `ciBase` is the merge ' +
          "commit's CI on the base branch — the signal that matters once merged (a green " +
          'branch can still break the base), resolved only when merged and available. ' +
          'Read-only; requires no active run. When GitHub cannot be reached, `available` is ' +
          'false and `reason` explains why (CI fields are then `unknown`, never a false green).',
        inputSchema: {
          pr_url: z.string().describe('A github.com pull-request URL'),
        },
      },
      (input) => {
        const status = this.githubPr.status(input.pr_url);
        return ok({ pr: status });
      },
    );
  }
}
