import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { inspectAuditIntegrity } from '../../../services/audit-integrity.js';
import type { SqliteAdapter } from '../../../storage/sqlite/sqlite-adapter.js';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the `audit_verify` MCP tool — recomputes the per-file
 * SHA-256 hash chain of the audit log and confirms it matches the head
 * hash and event count stored in SQLite.
 *
 * This is the agent-facing counterpart of the integrity section in
 * `mnema doctor`: it reuses {@link inspectAuditIntegrity} verbatim, so
 * the tamper-evidence promise is checkable on demand from inside a
 * session rather than only from the CLI. Read-only — no active run
 * required.
 */
export class AuditVerifyTool {
  /**
   * @param adapter - Open SQLite adapter (source of the chain head + count)
   * @param auditDir - Absolute path to `.mnema/audit/`
   * @param secret - Per-project HMAC secret for verifying v3 lines, or
   *   `null` (v3 lines then report as authenticity-unverifiable)
   */
  constructor(
    private readonly adapter: SqliteAdapter,
    private readonly auditDir: string,
    private readonly secret: Buffer | null = null,
  ) {}

  /**
   * Attaches the tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'audit_verify',
      {
        description:
          'Verify the integrity of the audit log hash chain for the current project. ' +
          'Recomputes the per-file SHA-256 chain and checks it against the event count and ' +
          'chain-head hash in SQLite, surfacing the first broken link (hash mismatch, prev_hash ' +
          'break, malformed line, or count drift) when the chain is tampered. Read-only; requires ' +
          'no active run. Returns { ok, intact, checks }, where `intact` is true only when every ' +
          'check passes and `checks` lists each invariant with its name, ok flag, detail and ' +
          'optional severity.',
        inputSchema: {},
      },
      () => {
        const checks = inspectAuditIntegrity(this.adapter, this.auditDir, this.secret);
        const intact = checks.every((check) => check.ok);
        return ok({ intact, checks });
      },
    );
  }
}
