import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { SearchService } from '../../../services/search-service.js';
import type { TaskService } from '../../../services/task-service.js';
import { err, ok } from '../../mcp-tool-result.js';

const ENTITY_VALUES = ['task', 'decision', 'note', 'skill', 'memory', 'observation'] as const;

/**
 * Function words dropped from a task's text before matching it against
 * skills in `skill_suggest`. Without this, a common word shared by a task
 * and an unrelated skill would produce a false suggestion. Intentionally
 * small, and only skill_suggest uses it — the raw `search` tool stays
 * literal.
 */
const SKILL_SUGGEST_STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'into',
  'onto',
  'add',
  'new',
  'use',
  'via',
  'when',
  'then',
  'than',
  'over',
  'your',
  'their',
  'have',
  'will',
  'must',
  'should',
]);

/**
 * Registers the `search` MCP tool — unified FTS5 search over every
 * text-bearing entity Mnema indexes (tasks, decisions, notes, skills,
 * memories, observations). Named `search` (not `tasks_search`) so an
 * agent scanning the tool surface sees that it spans the whole knowledge
 * layer, not just tasks.
 *
 * The tool wraps {@link SearchService}; query syntax matches FTS5
 * (`title OR description`, prefix `oauth*`, etc.). Each entity returns
 * up to `per_entity_limit` hits (default 25). Skill hits are scoped to
 * the latest version per slug.
 */
export class SearchTool {
  constructor(
    private readonly search: SearchService,
    private readonly tasks: TaskService,
  ) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'search',
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

    server.registerTool(
      'skill_suggest',
      {
        description:
          "Suggest skills relevant to a task, by full-text-matching the task's " +
          'title and description against recorded skills. Use this instead of ' +
          'skill_use when you do not already know the skill slug — it surfaces ' +
          'candidates to read (with skill_show) and then use. Read-only.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
          limit: z
            .number()
            .int()
            .positive()
            .max(25)
            .optional()
            .describe('Maximum number of skill suggestions (default 5).'),
        },
      },
      (input) => {
        const task = this.tasks.findByKey(input.task_key);
        if (!task.ok) return err(task.error);
        // Build an FTS query from the task's own words. Quote each token so
        // punctuation in the title/description can't be read as FTS5 syntax,
        // and OR them so any overlap surfaces a candidate.
        const terms = `${task.value.title} ${task.value.description ?? ''}`
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((t) => t.length >= 4 && !SKILL_SUGGEST_STOPWORDS.has(t))
          .map((t) => `"${t}"`);
        if (terms.length === 0) return ok({ suggestions: [] });
        const result = this.search.search(terms.join(' OR '), {
          entities: ['skill'],
          perEntityLimit: input.limit ?? 5,
        });
        if (!result.ok) return err(result.error);
        return ok({ suggestions: result.value });
      },
    );
  }
}
