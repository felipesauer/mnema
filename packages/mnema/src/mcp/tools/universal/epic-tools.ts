import type { Config } from '@mnema/core/config/config-schema.js';
import { deriveAlias } from '@mnema/core/domain/entity-alias.js';
import { EpicState } from '@mnema/core/domain/enums/epic-state.js';
import type { EpicService } from '@mnema/core/services/backlog/epic-service.js';
import type { IdentityService } from '@mnema/core/services/integrity/identity-service.js';
import type { WikilinkLintService } from '@mnema/core/services/lint/wikilink-lint-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpSessionContext } from '../../mcp-session-context.js';
import {
  err,
  ok,
  type PendingMigrationsSource,
  requireActiveRun,
  requireFreshSchema,
} from '../../mcp-tool-result.js';

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
    private readonly pendingMigrations: PendingMigrationsSource,
    private readonly wikilinks: WikilinkLintService,
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
          epic: { ...result.value.epic, key: deriveAlias('epic', result.value.epic.id) },
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
        return ok({ epics: epics.map((e) => ({ ...e, key: deriveAlias('epic', e.id) })) });
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
        return ok({ epic: { ...result.value, key: deriveAlias('epic', result.value.id) } });
      },
    );

    server.registerTool(
      'epic_update',
      {
        description:
          'Edit an epic’s content (title / description) after creation. ' +
          'Only the supplied fields change. Requires an active agent run.',
        inputSchema: {
          epic_key: z.string().describe('Epic key, e.g. WEBAPP-EPIC-3'),
          title: z.string().min(3).max(200).optional(),
          description: z.string().nullable().optional(),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.epics.update({
          epicKey: input.epic_key,
          title: input.title,
          description: input.description,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ epic: { ...result.value, key: deriveAlias('epic', result.value.id) } });
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
        return ok({ task: { ...result.value, key: deriveAlias('task', result.value.id) } });
      },
    );

    server.registerTool(
      'epic_close',
      {
        description:
          'Close an OPEN epic. Pass preview:true for a non-destructive intent diff ' +
          '(attached tasks, non-terminal tasks a close would strand, referencing ' +
          'memories/skills) without closing. Requires an active agent run.',
        inputSchema: {
          epic_key: z.string().describe('Epic key, e.g. WEBAPP-EPIC-3'),
          preview: z.boolean().optional().describe('Return the projected impact without closing'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;

        if (input.preview === true) {
          return this.previewImpact(input.epic_key, 'close');
        }

        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.epics.close({
          epicKey: input.epic_key,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ epic: { ...result.value, key: deriveAlias('epic', result.value.id) } });
      },
    );

    server.registerTool(
      'epic_reopen',
      {
        description:
          'Reopen a CLOSED epic when work resumes under it, clearing its close ' +
          'timestamp. Requires an active agent run.',
        inputSchema: {
          epic_key: z.string().describe('Epic key, e.g. WEBAPP-EPIC-3'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;

        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.epics.reopen({
          epicKey: input.epic_key,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ epic: { ...result.value, key: deriveAlias('epic', result.value.id) } });
      },
    );

    server.registerTool(
      'epic_remove',
      {
        description: 'Remove a task from its epic. Requires an active agent run.',
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
        const result = this.epics.removeTask({
          epicKey: input.epic_key,
          taskKey: input.task_key,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ task: { ...result.value, key: deriveAlias('task', result.value.id) } });
      },
    );

    server.registerTool(
      'epic_delete',
      {
        description:
          'Soft-delete an epic and drop its roadmap mirror. Refused if the ' +
          'epic still has tasks attached — detach them first. Pass preview:true ' +
          'for a non-destructive intent diff (how many tasks are attached and ' +
          'whether the delete would be refused) without deleting. Requires an ' +
          'active agent run.',
        inputSchema: {
          epic_key: z.string().describe('Epic key, e.g. WEBAPP-EPIC-3'),
          preview: z.boolean().optional().describe('Return the projected impact without deleting'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;

        if (input.preview === true) {
          return this.previewImpact(input.epic_key, 'delete');
        }

        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.epics.delete({
          epicKey: input.epic_key,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ epic: { ...result.value, key: deriveAlias('epic', result.value.id) } });
      },
    );
  }

  /**
   * Builds the non-destructive intent diff for a close/delete. Combines the
   * task-attachment impact (from the service) with the knowledge that links
   * to this epic by wikilink, and a human-readable `summary` so the agent
   * can reason about the side effects before committing. Mutates nothing.
   */
  private previewImpact(epicKey: string, op: 'close' | 'delete'): ReturnType<typeof ok> {
    const impact = this.epics.impact(epicKey);
    if (!impact.ok) return err(impact.error);
    const i = impact.value;
    const referencingFiles = this.wikilinks.referencesTo(epicKey);
    const parts: string[] = [];
    if (op === 'delete' && i.deleteWouldBeRefused) {
      parts.push(
        `delete would be REFUSED — ${String(i.attachedTaskCount)} task(s) still attached (detach first)`,
      );
    }
    if (op === 'close' && i.nonTerminalTaskKeys.length > 0) {
      parts.push(
        `close would strand ${String(i.nonTerminalTaskKeys.length)} non-terminal task(s): ${i.nonTerminalTaskKeys.join(', ')}`,
      );
    }
    if (referencingFiles.length > 0) {
      parts.push(`${String(referencingFiles.length)} knowledge file(s) link to ${epicKey}`);
    }
    if (parts.length === 0) parts.push(`no side effects — safe to ${op}`);
    return ok({
      preview: true,
      op,
      impact: {
        epic_key: i.epicKey,
        state: i.state,
        attached_task_count: i.attachedTaskCount,
        attached_task_keys: i.attachedTaskKeys,
        non_terminal_task_keys: i.nonTerminalTaskKeys,
        delete_would_be_refused: i.deleteWouldBeRefused,
        referencing_files: referencingFiles,
      },
      summary: parts.join('; '),
    });
  }
}
