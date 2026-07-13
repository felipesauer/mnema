import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { EvolutionCandidateService } from '../../../services/evolution-candidate-service.js';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the `evolve_report` MCP tool — a read-only evolution-candidate
 * report mined from existing data. Ranks skills by their correlation with
 * rework, aggregates recurring reopen reasons, and aggregates observation
 * topics on reopened tasks, each with supporting evidence. Read-only; requires
 * no active run. Every candidate is a PROMPT for human/agent judgement, not a
 * verdict — the payload's `caveat` says so.
 */
export class EvolveReportTool {
  constructor(private readonly evolution: EvolutionCandidateService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'evolve_report',
      {
        description:
          'Read-only evolution-candidate report mined from existing data: ranks skills ' +
          'by their correlation with rework, aggregates recurring reopen reasons and ' +
          'observation topics on reopened tasks, plus reopen-independent signals ' +
          '(recurring request_changes feedback, cancel reasons, and topics recurring ' +
          'across all tasks) so the report is useful on a zero-reopen project — each ' +
          'with supporting evidence (task keys, counts). Read-only; requires no active ' +
          'run; mutates nothing. Every candidate is a PROMPT for judgement, NOT a ' +
          'verdict that the guidance is wrong — see the `caveat`.',
        inputSchema: {},
      },
      () => ok({ report: this.evolution.compute() }),
    );
  }
}
