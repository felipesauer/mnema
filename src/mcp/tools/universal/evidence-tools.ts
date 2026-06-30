import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { EvidenceKind } from '../../../domain/entities/task-evidence.js';
import type { AgentRunService } from '../../../services/agent-run-service.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { TaskEvidenceService } from '../../../services/task-evidence-service.js';
import { resolveGovernanceRun } from '../../governance-run.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireFreshSchema } from '../../mcp-tool-result.js';

const evidenceKindValues = [
  'test',
  'route',
  'commit',
  'doc',
  'url',
  'other',
] as const satisfies readonly EvidenceKind[];

/**
 * Registers the acceptance-evidence MCP tools — `task_attach_evidence`
 * (mutation; links a criterion to a concrete artefact) and
 * `task_evidence` (read-only; pairs each criterion with its evidence).
 * Evidence is additive over the existing acceptance_criteria — it never
 * changes the criteria or gates a transition. See MNEMA-ADR-23.
 */
export class EvidenceTools {
  constructor(
    private readonly evidence: TaskEvidenceService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
    private readonly pendingMigrations: readonly string[],
    private readonly agentRun: AgentRunService,
  ) {}

  /**
   * Attaches every evidence tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'task_attach_evidence',
      {
        description:
          "Attach concrete evidence (a test path, route, commit, doc or url) to one of a task's acceptance criteria, identified by its 0-based index. A governance act: if no agent run is active, a short-lived system run is opened to attribute it, so you can attach evidence retroactively without starting work.",
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
          criterion_index: z
            .number()
            .int()
            .min(0)
            .describe('0-based index into acceptance_criteria'),
          kind: z
            .enum(evidenceKindValues)
            .optional()
            .describe('Evidence kind; defaults to "other"'),
          ref: z.string().min(1).describe('The path / route / commit sha / url'),
          note: z.string().optional(),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;

        // Governance act: attaching evidence (often retroactive) should
        // not require an execution run. If none is active, open a
        // short-lived system run so provenance is still captured.
        const gov = resolveGovernanceRun(
          this.session,
          this.agentRun,
          this.identity,
          'task_attach_evidence',
        );
        const handle = this.session.getClientMetadata().agent_handle;
        // try/finally so a thrown attach still closes any system run the
        // governance resolver opened — no dangling run on error.
        try {
          const result = this.evidence.attach({
            taskKey: input.task_key,
            criterionIndex: input.criterion_index,
            kind: input.kind,
            ref: input.ref,
            note: input.note,
            actor: this.identity.getDefaultActor(),
            via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
            runId: gov.runId,
          });
          if (!result.ok) return err(result.error);
          return ok({ evidence: result.value });
        } finally {
          gov.finalize();
        }
      },
    );

    server.registerTool(
      'task_evidence',
      {
        description:
          "List a task's acceptance criteria paired with the evidence attached to each. Criteria with no evidence come back with an empty list. Read-only.",
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
        },
      },
      ({ task_key: taskKey }) => {
        const result = this.evidence.forTask(taskKey);
        if (!result.ok) return err(result.error);
        return ok({ criteria: result.value.criteria, orphaned: result.value.orphaned });
      },
    );
  }
}
