import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { printError } from '../../errors/error-printer.js';
import { inspectAuditIntegrity } from '../../services/audit-integrity.js';
import {
  type DashboardData,
  type RecentEvent,
  renderDashboard,
} from '../../services/dashboard-render.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

interface DashboardOptions {
  readonly out?: string;
  readonly limit?: string;
}

/** How many recent audit events the activity panel shows by default. */
const DEFAULT_RECENT_LIMIT = 25;

/**
 * Registers `mnema dashboard` — a single self-contained HTML view over
 * data Mnema already records (audit-chain verdict, project dependency
 * graph, SLA breaches, recent trail activity). Strictly read-only: it
 * consumes the existing read services and collects nothing new (see
 * MNEMA-ADR-32). Writes to stdout, or to a file with `--out`.
 */
export class DashboardCommand {
  /**
   * Attaches the `dashboard` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('dashboard')
      .description(
        'Self-contained HTML dashboard over recorded data (audit chain, deps, SLA, activity) — read-only',
      )
      .option('--out <file>', 'Write the HTML to a file instead of stdout')
      .option('--limit <n>', `Recent-activity rows to show (default ${DEFAULT_RECENT_LIMIT})`)
      .action(async (options: DashboardOptions) => {
        const limit = parseLimit(options.limit);
        if (limit === null) {
          process.stderr.write(`${pc.red('error:')} --limit must be a positive integer\n`);
          process.exit(2);
        }

        await withCliContext(({ container, config, projectRoot }) => {
          const graphResult = container.dependencyGraph.forScope({ kind: 'project' });
          if (!graphResult.ok) {
            process.exit(printError(graphResult.error));
            return;
          }

          const auditDir = path.join(projectRoot, config.paths.audit);
          const integrity = inspectAuditIntegrity(container.adapter, auditDir);
          const inbox = container.inbox.view();
          const recent = container.auditQuery
            .run({ limit })
            .map((event) =>
              toRecentEvent(event, container.identity.getDisplayFor.bind(container.identity)),
            );

          const data: DashboardData = {
            projectKey: config.project.key,
            generatedAt: new Date().toISOString(),
            integrity,
            graph: graphResult.value,
            slaBreaches: inbox.slaBreaches,
            recent,
            schemaDrift: container.pendingMigrations.length > 0,
          };

          const html = renderDashboard(data);
          if (options.out !== undefined) {
            writeFileSync(options.out, html, 'utf-8');
            process.stdout.write(`${pc.green('✓')} dashboard written to ${options.out}\n`);
            return;
          }
          process.stdout.write(html);
        });
      });
  }
}

/**
 * Parses `--limit`: absent falls back to the default; a plain decimal
 * positive integer is honored; anything else is rejected (`null`) so a
 * typo is a hard error rather than silently returning the whole trail.
 *
 * The decimal-digit regex is deliberate: `Number('0x10')` is 16 and
 * `Number('1e3')` is 1000, both of which pass `Number.isInteger`, so a
 * bare `Number()` check would silently honor hex/exponent strings the
 * error message promises to reject. Matching `^[0-9]+$` first keeps the
 * contract ("positive integer") literal.
 */
export function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_RECENT_LIMIT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Fields, in precedence order, that carry the entity key an event is
 * "about". Task-scoped events use `key`/`task_key`; decision, epic and
 * sprint events store theirs under a typed field. Without this fallback
 * chain, decision/sprint/epic rows (e.g. an `attachment_added` on a
 * decision, which has only `decision_key`) render an empty key column.
 */
const KEY_FIELDS = ['key', 'task_key', 'decision_key', 'epic_key', 'sprint_key'] as const;

/** Projects an audit event onto the renderer's {@link RecentEvent} shape. */
export function toRecentEvent(event: AuditEvent, display: (handle: string) => string): RecentEvent {
  const data = event.data as Record<string, unknown>;
  let key: string | undefined;
  for (const field of KEY_FIELDS) {
    if (typeof data[field] === 'string') {
      key = data[field] as string;
      break;
    }
  }
  return {
    at: event.at,
    kind: event.kind,
    actor: display(event.actor),
    ...(event.via !== undefined ? { via: display(event.via) } : {}),
    ...(key !== undefined ? { key } : {}),
  };
}
