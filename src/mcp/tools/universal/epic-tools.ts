import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config/config-schema.js';
import { EpicState } from '../../../domain/enums/epic-state.js';
import type { EpicService } from '../../../services/epic-service.js';
import { err, ok } from '../../mcp-tool-result.js';

const epicStateValues = Object.values(EpicState) as [EpicState, ...EpicState[]];

/**
 * Registers the read-only epic MCP tools — `epic_show` and
 * `epics_list`. Mutating the epic surface (create/close/add task) is
 * available through the CLI; agents are expected to surface high-level
 * feature work through tasks, not by minting epics during a run.
 */
export class EpicTools {
  constructor(
    private readonly epics: EpicService,
    private readonly config: Config,
  ) {}

  /**
   * Attaches the epic tools to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'epic_show',
      {
        description: 'Return an epic by its human-readable key, with the keys of its tasks.',
        inputSchema: {
          epic_key: z.string().describe('Epic key, e.g. WEBAPP-EPIC-3'),
        },
      },
      ({ epic_key: epicKey }) => {
        const result = this.epics.show(epicKey);
        if (!result.ok) return err(result.error);
        return ok({ epic: result.value.epic, task_keys: result.value.taskKeys });
      },
    );

    server.registerTool(
      'epics_list',
      {
        description: 'List epics of the current project, optionally filtered by state.',
        inputSchema: {
          state: z.enum(epicStateValues).optional(),
        },
      },
      ({ state }) => {
        const epics = this.epics.list(this.config.project.key, state);
        return ok({ epics });
      },
    );
  }
}
