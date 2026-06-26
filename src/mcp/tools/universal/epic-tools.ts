import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config/config-schema.js';
import { EpicState } from '../../../domain/enums/epic-state.js';
import type { EpicService } from '../../../services/epic-service.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun, requireFreshSchema } from '../../mcp-tool-result.js';

const epicStateValues = Object.values(EpicState) as [EpicState, ...EpicState[]];

/**
 * Registers the epic MCP tools. Reads (`epic_show`, `epics_list`) need
 * no run; the mutations (`epic_create`, `epic_add_task`) flow through an
 * agent run like every other write, so an agent that builds a roadmap
 * stays inside the dual-identity trail instead of dropping to the CLI.
 */
export class EpicTools {
  constructor(
    private readonly epics: EpicService,
    private readonly config: Config,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
    private readonly pendingMigrations: readonly string[],
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
        return ok({
          epic: result.value.epic,
          task_keys: result.value.taskKeys,
          lifecycle: result.value.lifecycle,
        });
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

    server.registerTool(
      'epic_create',
      {
        description: 'Create a new epic in OPEN state. Requires an active agent run.',
        inputSchema: {
          title: z.string().min(3).max(200),
          description: z.string().optional(),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.epics.create({
          projectKey: this.config.project.key,
          title: input.title,
          description: input.description,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ epic: result.value });
      },
    );

    server.registerTool(
      'epic_add_task',
      {
        description: 'Attach an existing task to an epic. Requires an active agent run.',
        inputSchema: {
          epic_key: z.string().describe('Epic key, e.g. WEBAPP-EPIC-3'),
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.epics.addTask({
          epicKey: input.epic_key,
          taskKey: input.task_key,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ task: result.value });
      },
    );
  }
}
