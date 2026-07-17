import type { EvalReportService } from '@mnema/core/services/metrics/eval-report-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ok } from '../../mcp-tool-result.js';
import { timeBoundSchema } from '../../time-bound-schema.js';

/**
 * Default lower bound when the caller omits `since`: read the last 90 days
 * instead of the whole (unbounded) audit log, so an omitted window doesn't
 * silently do an O(events) full-walk. An explicit `since` reads further back.
 */
const DEFAULT_REPORT_SINCE = '90d';

/**
 * Registers the `eval_report` MCP tool — a guided-vs-unguided metrics diff
 * derived from the audit log. Partitions agent runs by an
 * observable guidance proxy (did the run use a recorded skill) and diffs
 * reopen rate and lead/cycle time per cohort. Read-only; requires no active
 * run. The payload carries the proxy and a correlational-not-causal caveat —
 * it does not run agents and is not a controlled A/B.
 */
export class EvalReportTool {
  constructor(private readonly evalReport: EvalReportService) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'eval_report',
      {
        description:
          'Guided-vs-unguided metrics diff from the audit log: partitions agent runs ' +
          'by whether they used a recorded skill (the observable guidance proxy — ' +
          'context_bootstrap/focus leave no audit trace) and diffs reopen rate, lead ' +
          'and cycle time per cohort. Read-only; requires no active run. The result ' +
          'is CORRELATIONAL, not causal (a within-project comparison, not an A/B) and ' +
          'says so in its `caveat`. Defaults to the last 90 days when `since` is ' +
          'omitted; pass an explicit `since` (e.g. "365d" or an ISO date) to read ' +
          'further back.',
        inputSchema: {
          since: timeBoundSchema(
            'Lower time bound — ISO-8601 or a relative duration (e.g. "7d", "30d"). ' +
              'Defaults to "90d" when omitted.',
          ),
        },
      },
      (input) => {
        const report = this.evalReport.compute({ since: input.since ?? DEFAULT_REPORT_SINCE });
        return ok({ report });
      },
    );
  }
}
