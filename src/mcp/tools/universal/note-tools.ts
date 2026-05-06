import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { NoteKind } from '../../../domain/entities/note.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { NoteService } from '../../../services/note-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun } from '../../mcp-tool-result.js';

const NOTE_KINDS: readonly NoteKind[] = [
  'comment',
  'block_reason',
  'unblock_reason',
  'review_feedback',
  'review_approval',
  'cancel_reason',
  'reopen_reason',
  'agent_observation',
];

const noteKindValues = NOTE_KINDS as unknown as [NoteKind, ...NoteKind[]];

/**
 * Registers the `note_add` MCP tool — typed annotations against tasks.
 *
 * The default kind is `comment`; agents are encouraged to use
 * `agent_observation` for free-form context they discover, and to leave
 * the workflow-coupled kinds (block_reason, review_feedback, …) to the
 * transition tools that already write them automatically.
 */
export class NoteTools {
  constructor(
    private readonly notes: NoteService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
  ) {}

  /**
   * Attaches the note tools to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'note_add',
      {
        description:
          'Attach a typed note to a task. Requires an active agent run. Default kind is `comment`; use `agent_observation` for general context.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
          content: z.string().min(1),
          kind: z.enum(noteKindValues).optional(),
        },
      },
      (input) => {
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.notes.add({
          taskKey: input.task_key,
          content: input.content,
          kind: input.kind ?? 'comment',
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ note: result.value });
      },
    );
  }
}
