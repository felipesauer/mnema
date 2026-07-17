import type { WikilinkLintService } from '@mnema/core/services/lint/wikilink-lint-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the read-only wikilink tools — `wikilinks_lint` (report
 * broken `[[slug]]` links across skill/memory bodies) and
 * `wikilink_references` (what links to a given slug). Both are pure
 * reads: they mutate nothing.
 */
export class WikilinkTools {
  constructor(private readonly wikilinks: WikilinkLintService) {}

  /**
   * Attaches the wikilink tools to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'wikilinks_lint',
      {
        description:
          'Validate [[slug]] wikilinks in skill and memory bodies against known targets (skills, memories, decisions, tasks). Returns one diagnostic per broken link. Read-only.',
        inputSchema: {},
      },
      () => {
        const report = this.wikilinks.lint();
        return ok({ report });
      },
    );

    server.registerTool(
      'wikilink_references',
      {
        description:
          'List the skill/memory files that link to a given slug via a [[wikilink]]. Read-only.',
        inputSchema: {
          slug: z.string().describe('Target slug or key, e.g. safe-migration or WEBAPP-42'),
        },
      },
      ({ slug }) => {
        const files = this.wikilinks.referencesTo(slug);
        return ok({ files });
      },
    );
  }
}
