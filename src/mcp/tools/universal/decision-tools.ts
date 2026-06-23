import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config/config-schema.js';
import { DecisionStatus } from '../../../domain/enums/decision-status.js';
import type { DecisionService } from '../../../services/decision-service.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun } from '../../mcp-tool-result.js';

const decisionStatusValues = Object.values(DecisionStatus) as [DecisionStatus, ...DecisionStatus[]];

/**
 * Registers the decision-related MCP tools — `decision_record`,
 * `decision_show`, `decisions_list`.
 *
 * Mutating tools (`decision_record`) require an active agent run, in
 * line with the rest of the universal surface. Read-only tools do not.
 */
export class DecisionTools {
  constructor(
    private readonly decisions: DecisionService,
    private readonly identity: IdentityService,
    private readonly config: Config,
    private readonly session: McpSessionContext,
  ) {}

  /**
   * Attaches every decision tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'decision_record',
      {
        description:
          'Record a new Architecture Decision Record (ADR) in `proposed` status. Requires an active agent run.',
        inputSchema: {
          title: z.string().min(3).max(200),
          decision: z.string().min(1).describe('What was decided'),
          context: z.string().optional().describe('Why this decision was needed'),
          rationale: z.string().optional().describe('Why this choice over alternatives'),
          consequences: z.string().optional().describe('What follows from this decision'),
          impacts: z
            .array(z.string().min(1))
            .optional()
            .describe('Paths/keys of artefacts this decision affects (reverse-queryable)'),
        },
      },
      (input) => {
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.decisions.record({
          projectKey: this.config.project.key,
          title: input.title,
          decision: input.decision,
          context: input.context,
          rationale: input.rationale,
          consequences: input.consequences,
          impacts: input.impacts,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ decision: result.value });
      },
    );

    server.registerTool(
      'decision_promote_from_note',
      {
        description:
          'Record a new ADR and link it to an existing note via an audit event. ' +
          'The note stays put; promotion is a provenance marker, so the caller still ' +
          'supplies the full decision body. Requires an active agent run.',
        inputSchema: {
          note_id: z.string().describe('Internal UUID of the note (from `note_add` response)'),
          title: z.string().min(3).max(200),
          decision: z.string().min(1).describe('What was decided'),
          context: z.string().optional().describe('Why this decision was needed'),
          rationale: z.string().optional().describe('Why this choice over alternatives'),
          consequences: z.string().optional().describe('What follows from this decision'),
        },
      },
      (input) => {
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.decisions.promoteFromNote({
          noteId: input.note_id,
          title: input.title,
          decision: input.decision,
          context: input.context,
          rationale: input.rationale,
          consequences: input.consequences,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ decision: result.value });
      },
    );

    server.registerTool(
      'decision_show',
      {
        description: 'Return a single decision (ADR) by its human-readable key.',
        inputSchema: {
          decision_key: z.string().describe('Decision key, e.g. WEBAPP-ADR-7'),
        },
      },
      ({ decision_key: decisionKey }) => {
        const result = this.decisions.show(decisionKey);
        if (!result.ok) return err(result.error);
        return ok({ decision: result.value });
      },
    );

    server.registerTool(
      'decisions_list',
      {
        description: 'List decisions of the current project, optionally filtered by status.',
        inputSchema: {
          status: z.enum(decisionStatusValues).optional(),
        },
      },
      ({ status }) => {
        const decisions = this.decisions.list(this.config.project.key, status);
        return ok({ decisions });
      },
    );

    server.registerTool(
      'decisions_impacting',
      {
        description:
          'List the decisions (ADRs) whose impact list contains a given artefact path or key — "which decision touched this?". Read-only.',
        inputSchema: {
          ref: z.string().min(1).describe('Artefact path or key, e.g. src/foo.ts or WEBAPP-42'),
        },
      },
      ({ ref }) => {
        const decisions = this.decisions.impacting(this.config.project.key, ref);
        return ok({ decisions });
      },
    );

    server.registerTool(
      'decision_supersede',
      {
        description:
          'Supersede an accepted ADR with a successor ADR (marks the old one `superseded` and points it at the successor). Requires an active agent run.',
        inputSchema: {
          decision_key: z.string().describe('The ADR being superseded, e.g. WEBAPP-ADR-7'),
          superseded_by: z.string().describe('The successor ADR key'),
        },
      },
      (input) => {
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.decisions.transition({
          decisionKey: input.decision_key,
          status: DecisionStatus.Superseded,
          supersededBy: input.superseded_by,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ decision: result.value });
      },
    );
  }
}
