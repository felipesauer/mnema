import type { Config } from '@mnema/core/config/config-schema.js';
import { DecisionStatus } from '@mnema/core/domain/enums/decision-status.js';
import type { DecisionService } from '@mnema/core/services/backlog/decision-service.js';
import type { IdentityService } from '@mnema/core/services/integrity/identity-service.js';
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
    private readonly pendingMigrations: PendingMigrationsSource,
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
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
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
      'decision_update',
      {
        description:
          'Edit a PROPOSED ADR in place (title/context/decision/rationale/consequences/impacts). Refused once accepted/rejected/superseded — that text is immutable history; supersede instead. Only supplied fields change; mints no new key. Requires an active agent run.',
        inputSchema: {
          decision_key: z.string().describe('The ADR key, e.g. MYAPP-ADR-3'),
          title: z.string().min(3).max(200).optional(),
          decision: z.string().min(1).optional().describe('What was decided'),
          context: z.string().optional().describe('Why this decision was needed'),
          rationale: z.string().optional().describe('Why this choice over alternatives'),
          consequences: z.string().optional().describe('What follows from this decision'),
          impacts: z
            .array(z.string().min(1))
            .optional()
            .describe('Paths/keys of artefacts this decision affects (replaces the set)'),
          expected_updated_at: z
            .string()
            .optional()
            .describe('Optimistic-concurrency token; omitted = last write wins'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.decisions.updateContent({
          decisionKey: input.decision_key,
          title: input.title,
          decision: input.decision,
          context: input.context,
          rationale: input.rationale,
          consequences: input.consequences,
          impacts: input.impacts,
          expectedUpdatedAt: input.expected_updated_at,
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
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
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
      'decision_promote_from_observation',
      {
        description:
          'Record a new ADR and link it to an existing observation (the observation-side ' +
          'parallel of decision_promote_from_note). The observation stays put; the caller ' +
          'supplies the full decision body. Records a navigable observation→decision provenance ' +
          'edge. Requires an active agent run.',
        inputSchema: {
          observation_id: z
            .string()
            .describe('Internal UUID of the observation (from `observation_record` response)'),
          title: z.string().min(3).max(200),
          decision: z.string().min(1).describe('What was decided'),
          context: z.string().optional().describe('Why this decision was needed'),
          rationale: z.string().optional().describe('Why this choice over alternatives'),
          consequences: z.string().optional().describe('What follows from this decision'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.decisions.promoteFromObservation({
          observationId: input.observation_id,
          projectKey: this.config.project.key,
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
      'decisions_review',
      {
        description:
          'List every PROPOSED ADR with the fields a reviewer needs (title, context, decision, rationale, consequences, impacts) in one call, so a batch can be presented together. Read-only — apply verdicts with `decisions_apply`.',
        inputSchema: {},
      },
      () => ok({ proposals: this.decisions.reviewProposals(this.config.project.key) }),
    );

    server.registerTool(
      'decisions_apply',
      {
        description:
          'Apply a batch of accept/reject verdicts to proposed ADRs. Best-effort: each verdict is a full transition emitting its own audit event (batch is a throughput affordance, not an audit bypass), and one failure does not abort the rest. Returns a per-verdict outcome. Requires an active agent run.',
        inputSchema: {
          verdicts: z
            .array(
              z.object({
                decision_key: z.string().describe('The ADR key, e.g. WEBAPP-ADR-7'),
                verdict: z.enum(['accept', 'reject']),
              }),
            )
            .min(1)
            .describe('Accept/reject verdicts to apply, in order'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const results = this.decisions.applyVerdicts({
          verdicts: input.verdicts.map((v) => ({
            decisionKey: v.decision_key,
            verdict: v.verdict,
          })),
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        // Project each outcome to a serialisable shape (errors → their code).
        return ok({
          results: results.map((r) =>
            r.ok
              ? { decision_key: r.decisionKey, verdict: r.verdict, ok: true, status: r.status }
              : { decision_key: r.decisionKey, verdict: r.verdict, ok: false, error: r.error.kind },
          ),
        });
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
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
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

    server.registerTool(
      'decision_accept',
      {
        description: 'Accept a `proposed` ADR (marks it `accepted`). Requires an active agent run.',
        inputSchema: {
          decision_key: z.string().describe('The ADR being accepted, e.g. WEBAPP-ADR-7'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.decisions.transition({
          decisionKey: input.decision_key,
          status: DecisionStatus.Accepted,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ decision: result.value });
      },
    );

    server.registerTool(
      'decision_reject',
      {
        description: 'Reject a `proposed` ADR (marks it `rejected`). Requires an active agent run.',
        inputSchema: {
          decision_key: z.string().describe('The ADR being rejected, e.g. WEBAPP-ADR-7'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.decisions.transition({
          decisionKey: input.decision_key,
          status: DecisionStatus.Rejected,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ decision: result.value });
      },
    );

    server.registerTool(
      'decision_reopen',
      {
        description:
          'Reopen an accepted/rejected ADR back to `proposed` (the undo for a mis-click or changed mind), so it can be edited or re-decided. Refused on a superseded ADR. Requires an active agent run.',
        inputSchema: {
          decision_key: z.string().describe('The ADR being reopened, e.g. WEBAPP-ADR-7'),
          reason: z.string().min(1).describe('Why it is being reopened (audited)'),
          expected_updated_at: z
            .string()
            .optional()
            .describe('Optimistic-concurrency token; omitted = last write wins'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.decisions.reopen({
          decisionKey: input.decision_key,
          reason: input.reason,
          expectedUpdatedAt: input.expected_updated_at,
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
