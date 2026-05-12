import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { SearchService } from '../../../services/search-service.js';
import { err, ok } from '../../mcp-tool-result.js';

const ENTITY_VALUES = ['task', 'decision', 'note', 'skill', 'memory', 'observation'] as const;

/**
 * Registers the `tasks_search` MCP tool — unified FTS5 search over
 * every text-bearing entity Mnema indexes (tasks, decisions, notes,
 * skills, memories, observations).
 *
 * The tool wraps {@link SearchService}; query syntax matches FTS5
 * (`title OR description`, prefix `oauth*`, etc.). Each entity returns
 * up to `per_entity_limit` hits (default 25). Skill hits are scoped to
 * the latest version per slug.
 */
export class SearchTool {
  constructor(private readonly search: SearchService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'tasks_search',
      {
        description:
          'Full-text search across tasks, decisions, notes, skills, memories and observations. Diacritic-insensitive. FTS5 syntax: prefix wildcards, AND/OR/NOT operators. Skills return the latest version per slug.',
        inputSchema: {
          query: z.string().min(1).describe('FTS5 MATCH expression'),
          entities: z.array(z.enum(ENTITY_VALUES)).optional(),
          per_entity_limit: z.number().int().positive().max(100).optional(),
        },
      },
      (input) => {
        const result = this.search.search(input.query, {
          entities: input.entities,
          perEntityLimit: input.per_entity_limit,
        });
        if (!result.ok) return err(result.error);
        return ok({ hits: result.value });
      },
    );
  }
}
