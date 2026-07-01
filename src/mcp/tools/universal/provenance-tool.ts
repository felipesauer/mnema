import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ProvenanceKind } from '../../../domain/entities/provenance-link.js';
import type { ProvenanceService } from '../../../services/provenance-service.js';
import { ok } from '../../mcp-tool-result.js';

const KIND_VALUES = ['observation', 'note', 'decision', 'memory'] as const satisfies readonly [
  ProvenanceKind,
  ...ProvenanceKind[],
];

/**
 * Registers the read-only `provenance` MCP tool: given any node
 * (observation / note / decision / memory) it resolves the lineage in
 * both directions — what led to it (upstream) and what it led to
 * (downstream). Makes the promotion/derivation chain traceable from
 * either end. No active-run requirement (MNEMA-ADR-20).
 */
export class ProvenanceTool {
  constructor(private readonly provenance: ProvenanceService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'provenance',
      {
        description:
          "Trace a node's provenance chain in both directions: upstream (what led to it) and " +
          'downstream (what it led to), across observation → decision → memory promotion/derivation ' +
          'edges. Identify the node by kind + ref (observation/note id, decision key, memory slug). ' +
          'Read-only.',
        inputSchema: {
          kind: z.enum(KIND_VALUES).describe('Node type'),
          ref: z
            .string()
            .min(1)
            .describe('Node identifier: observation/note id, decision key, or memory slug'),
        },
      },
      ({ kind, ref }) => {
        const chain = this.provenance.chain({ kind, ref });
        return ok({ provenance: chain });
      },
    );
  }
}
