import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import type { AuditEvent } from '../storage/audit/audit-writer.js';
import { inspectAuditIntegrity } from './audit-integrity.js';
import type { DashboardData, RecentEvent } from './dashboard-render.js';
import type { ServiceContainer } from './service-container.js';

/**
 * How many recent audit events the activity panel shows by default —
 * shared by the static `dashboard` command and the live server's initial
 * backfill so both open on the same window.
 */
export const DEFAULT_RECENT_LIMIT = 25;

/**
 * Fields, in precedence order, that carry the entity key an event is
 * "about". Task-scoped events use `key`/`task_key`; decision, epic and
 * sprint events store theirs under a typed field. Without this fallback
 * chain, decision/sprint/epic rows (e.g. an `attachment_added` on a
 * decision, which has only `decision_key`) render an empty key column.
 */
const KEY_FIELDS = ['key', 'task_key', 'decision_key', 'epic_key', 'sprint_key'] as const;

/**
 * Projects a persisted audit event onto the renderer's {@link RecentEvent}
 * shape, resolving actor/via handles to display names. Shared by the
 * static table and the live SSE stream so a pushed row is identical to a
 * reloaded one.
 *
 * @param event - The persisted audit event
 * @param display - Resolves a handle to a display name (IdentityService)
 * @returns The row-ready recent event
 */
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

/**
 * Composes {@link DashboardData} from an open container — the single place
 * both the static `dashboard` command and the live `serve` server read
 * from, so the two views never drift. Strictly read-only: it calls the
 * existing read services and collects nothing new (see MNEMA-ADR-32/34).
 *
 * @param container - An open service container
 * @param config - The loaded project config
 * @param projectRoot - Absolute project root (to locate the audit dir)
 * @param options.limit - Recent-activity rows to include
 * @returns The composed dashboard data
 */
export function buildDashboardData(
  container: ServiceContainer,
  config: Config,
  projectRoot: string,
  options: { limit?: number } = {},
): DashboardData {
  const limit = options.limit ?? DEFAULT_RECENT_LIMIT;
  const graphResult = container.dependencyGraph.forScope({ kind: 'project' });
  // The project graph is derived from the same repos the rest of the
  // container reads; a failure here is a programming error, not a user
  // input error, so surface it rather than rendering a half-empty page.
  if (!graphResult.ok) {
    throw new Error(`dependency graph unavailable: ${graphResult.error.kind}`);
  }

  const auditDir = path.join(projectRoot, config.paths.audit);
  const integrity = inspectAuditIntegrity(container.adapter, auditDir);
  const inbox = container.inbox.view();
  const display = container.identity.getDisplayFor.bind(container.identity);
  const recent = container.auditQuery.run({ limit }).map((event) => toRecentEvent(event, display));

  return {
    projectKey: config.project.key,
    generatedAt: new Date().toISOString(),
    integrity,
    graph: graphResult.value,
    slaBreaches: inbox.slaBreaches,
    recent,
    schemaDrift: container.pendingMigrations.length > 0,
  };
}
