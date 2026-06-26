import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { DependencyKind } from '../../../domain/entities/dependency.js';
import type { DependencyService } from '../../../services/dependency-service.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun } from '../../mcp-tool-result.js';

const dependencyKindValues = [
  'blocks',
  'relates_to',
  'duplicates',
  'parent_of',
] as const satisfies readonly DependencyKind[];

/**
 * Registers the task-dependency MCP tools — `task_depends_on`,
 * `tasks_ready`, `task_dependencies`.
 *
 * `task_depends_on` is a mutation and requires an active agent run.
 * `tasks_ready` and `task_dependencies` are read-only. Readiness is a
 * query: a task is ready when it is in the pickable state and every
 * `blocks` dependency points at a task in a terminal state — Mnema never
 * auto-transitions a task when its blocker completes (MNEMA-ADR-18).
 */
export class DependencyTools {
  constructor(
    private readonly dependencies: DependencyService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
  ) {}

  /**
   * Attaches every dependency tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'task_depends_on',
      {
        description:
          'Declare that one task is blocked by another (or relates to / duplicates / is a parent of it). `task_key` depends on `blocks_task_key`. Defaults to kind `blocks`. Requires an active agent run.',
        inputSchema: {
          task_key: z.string().describe('The dependent task, e.g. WEBAPP-43'),
          blocks_task_key: z.string().describe('The task it depends on / is blocked by'),
          kind: z
            .enum(dependencyKindValues)
            .optional()
            .describe('Relationship kind; defaults to "blocks"'),
        },
      },
      (input) => {
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.dependencies.link({
          taskKey: input.task_key,
          blocksTaskKey: input.blocks_task_key,
          kind: input.kind,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ dependency: result.value });
      },
    );

    server.registerTool(
      'task_depends_many',
      {
        description:
          'Declare several dependencies in one call (best-effort): each edge is ' +
          'attempted and the result lists what was linked and what failed, with ' +
          'its input index. Requires an active agent run.',
        inputSchema: {
          links: z
            .array(
              z.object({
                task_key: z.string().describe('The dependent task'),
                blocks_task_key: z.string().describe('The task it depends on / is blocked by'),
                kind: z.enum(dependencyKindValues).optional().describe('Defaults to "blocks"'),
              }),
            )
            .min(1)
            .max(200)
            .describe('Dependency edges, in order'),
        },
      },
      (input) => {
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const via = handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined;

        const linked: unknown[] = [];
        const failed: { index: number; error: unknown }[] = [];
        input.links.forEach((link, index) => {
          const result = this.dependencies.link({
            taskKey: link.task_key,
            blocksTaskKey: link.blocks_task_key,
            kind: link.kind,
            actor: this.identity.getDefaultActor(),
            via,
            runId: runId ?? undefined,
          });
          if (result.ok) linked.push(result.value);
          else failed.push({ index, error: result.error });
        });

        return ok({ linked, failed, linked_count: linked.length, failed_count: failed.length });
      },
    );

    server.registerTool(
      'tasks_ready',
      {
        description:
          'List tasks ready to be picked up: in the pickable state with every blocking dependency in a terminal state. Optionally scoped to one sprint. Read-only.',
        inputSchema: {
          sprint_key: z
            .string()
            .optional()
            .describe('Scope to a single sprint, e.g. WEBAPP-SPRINT-3'),
        },
      },
      ({ sprint_key: sprintKey }) => {
        const result = this.dependencies.ready(sprintKey);
        if (!result.ok) return err(result.error);
        return ok({ tasks: result.value });
      },
    );

    server.registerTool(
      'task_dependencies',
      {
        description:
          'List the dependencies a task declares (depends_on) and the ones pointing at it (blocks). Read-only.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-43'),
        },
      },
      ({ task_key: taskKey }) => {
        const result = this.dependencies.listFor(taskKey);
        if (!result.ok) return err(result.error);
        return ok({ depends_on: result.value.dependsOn, blocks: result.value.blocks });
      },
    );
  }
}
