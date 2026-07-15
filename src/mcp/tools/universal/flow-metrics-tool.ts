import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { FlowMetricsService } from '../../../services/flow-metrics-service.js';
import { ok } from '../../mcp-tool-result.js';
import { timeBoundSchema } from '../../time-bound-schema.js';

/**
 * Default lower bound when the caller omits `since`: read the last 90 days
 * instead of the whole (unbounded) audit log, so an omitted window doesn't
 * silently do an O(events) full-walk. An explicit `since` reads further back.
 */
const DEFAULT_METRICS_SINCE = '90d';

/**
 * Registers the `metrics_flow` MCP tool — derived flow metrics (lead
 * time, cycle time, throughput, reopen rate, estimate-vs-actual) read
 * straight from the audit log. Read-only; requires no active run.
 *
 * Everything it returns was already in the log; this just spares the
 * agent from re-deriving it by hand with grep over `current.jsonl`.
 */
export class FlowMetricsTool {
  constructor(private readonly flowMetrics: FlowMetricsService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'metrics_flow',
      {
        description:
          'Derive flow metrics for the current project from the audit log: throughput ' +
          '(tasks reaching a terminal state), lead time (created → done), cycle time ' +
          '(first move off the initial state → done), reopen rate, and estimate-vs-actual ' +
          "(each done task's estimate against its realised lead time). Durations are in " +
          'hours. Read-only; requires no active run. Defaults to the last 90 days when ' +
          '`since` is omitted; pass an explicit `since` (ISO-8601 or a relative duration ' +
          'like "365d") to read further back.',
        inputSchema: {
          since: timeBoundSchema(
            'Lower time bound — ISO-8601 or a relative duration (e.g. "7d", "30d"). ' +
              'Defaults to "90d" when omitted.',
          ),
        },
      },
      (input) => {
        const metrics = this.flowMetrics.compute({ since: input.since ?? DEFAULT_METRICS_SINCE });
        return ok({ metrics });
      },
    );
  }
}
