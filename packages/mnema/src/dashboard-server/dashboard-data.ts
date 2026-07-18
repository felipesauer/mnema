import type { SlaBreach, WipBreach } from '@mnema/core/services/backlog/inbox-service.js';
import type { IntegrityCheck } from '@mnema/core/services/integrity/audit-integrity.js';
import { parseTimeBound } from '@mnema/core/services/integrity/audit-query.js';
import type { FlowMetrics } from '@mnema/core/services/metrics/flow-metrics-service.js';
import type { DependencyGraph } from '@mnema/core/services/snapshot/dependency-graph-service.js';
import type { AuditEvent } from '@mnema/core/storage/audit/audit-writer.js';
import type { DashboardReadModel } from './dashboard-read-model.js';
import {
  activityByDay,
  eventsByKind,
  type SeriesPoint,
  throughputByDay,
} from './dashboard-series.js';

/**
 * How many recent audit events the activity feed shows by default —
 * the live backfill window.
 */
export const DEFAULT_RECENT_LIMIT = 25;

/** Default lookback for time-series and flow metrics (relative duration). */
export const DEFAULT_METRICS_WINDOW = '30d';

/**
 * Fields, in precedence order, that carry the entity key an event is
 * "about". Task-scoped events use `key`/`task_key`; decision, epic and
 * sprint events store theirs under a typed field.
 */
const KEY_FIELDS = ['key', 'task_key', 'decision_key', 'epic_key', 'sprint_key'] as const;

/** One recent-activity row, handles already resolved to display names. */
export interface RecentEvent {
  readonly at: string;
  readonly kind: string;
  readonly actor: string;
  readonly via?: string;
  readonly key?: string;
}

/** A minimal task/decision reference for the inbox panels. */
export interface InboxRef {
  readonly key: string;
  readonly title: string;
  readonly state: string;
}

/**
 * The full, JSON-serializable dashboard snapshot. Composed once from the
 * container by {@link buildDashboardData}; consumed by the renderer (for
 * the shell) and by the per-tab server routes. Pure data — no methods, no
 * services — so it can be sent as JSON to the client verbatim.
 */
export interface DashboardData {
  readonly projectKey: string;
  readonly generatedAt: string;
  /** Lookback window used for flow + series (e.g. `30d`). */
  readonly window: string;
  readonly integrity: readonly IntegrityCheck[];
  readonly graph: DependencyGraph;
  readonly recent: readonly RecentEvent[];
  readonly schemaDrift: boolean;
  /** Flow metrics (throughput, lead/cycle, reopen, velocity, …). */
  readonly flow: FlowMetrics;
  /** Human-attention queues, from the full inbox view. */
  readonly inbox: {
    readonly slaBreaches: readonly SlaBreach[];
    readonly wipBreaches: readonly WipBreach[];
    readonly awaitingReview: readonly InboxRef[];
    readonly blocked: readonly InboxRef[];
    readonly pendingDecisions: number;
  };
  /** Derived time/category series for charts. */
  readonly series: {
    readonly activityByDay: readonly SeriesPoint[];
    readonly throughputByDay: readonly SeriesPoint[];
    readonly eventsByKind: readonly SeriesPoint[];
  };
}

/**
 * Projects a persisted audit event onto {@link RecentEvent}, resolving
 * actor/via handles to display names.
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

/** Options for {@link buildDashboardData}. */
export interface BuildOptions {
  /** Recent-activity rows to include (default {@link DEFAULT_RECENT_LIMIT}). */
  readonly limit?: number;
  /** Lookback for flow + series (default {@link DEFAULT_METRICS_WINDOW}). */
  readonly window?: string;
  /**
   * Pre-computed integrity checks. A hot caller (the live dashboard) that
   * caches the full hash-chain verification passes it here to avoid
   * re-hashing the whole log on every request/tab. When omitted, the
   * checks are computed inline (the default for one-off callers).
   */
  readonly integrity?: IntegrityCheck[];
}

/**
 * Composes {@link DashboardData} from the read-model seam — the single read
 * point for the dashboard. Strictly read-only: it calls the seam's reads and
 * derives time-series from the audit stream (no new collection).
 * Takes {@link DashboardReadModel}, not the container or the
 * raw SQLite adapter, so internal frontends (SPA/real-time) build against the
 * seam rather than reaching into internals.
 *
 * @param model - The dashboard read-model seam (see {@link buildDashboardReadModel})
 * @param options - Recent-limit, metrics window, and optional cached integrity
 * @returns The composed dashboard data
 */
export function buildDashboardData(
  model: DashboardReadModel,
  options: BuildOptions = {},
): DashboardData {
  const limit = options.limit ?? DEFAULT_RECENT_LIMIT;
  const window = options.window ?? DEFAULT_METRICS_WINDOW;

  const graph = model.dependencyGraph();
  // A hot caller (the live dashboard) can pass a cached hash-chain result to
  // avoid re-hashing the whole log per request; otherwise the seam computes it.
  const integrity = options.integrity ?? model.integrity();
  const inbox = model.inbox();
  const flow = model.flow(window);
  const display = (handle: string) => model.displayFor(handle);
  const terminal = new Set(model.terminalStates());

  // A SINGLE read of the trail powers both the feed and the series — each
  // read parses every audit file, so reading twice would double the IO/CPU on
  // a large log. Events are oldest-first: the series use the whole set
  // (filtered to the window), the feed is the newest `limit` (the tail).
  const allEvents = model.auditEvents();
  const windowMs = windowStartMs(window);
  const windowEvents =
    windowMs === null ? allEvents : allEvents.filter((e) => Date.parse(e.at) >= windowMs);
  const recent = allEvents.slice(-limit).map((e) => toRecentEvent(e, display));

  return {
    projectKey: model.projectKey,
    generatedAt: new Date().toISOString(),
    window,
    integrity,
    graph,
    recent,
    schemaDrift: model.hasSchemaDrift(),
    flow,
    inbox: {
      slaBreaches: inbox.slaBreaches,
      wipBreaches: inbox.wipBreaches,
      awaitingReview: inbox.awaitingReview.map(toInboxRef),
      blocked: inbox.blocked.map(toInboxRef),
      pendingDecisions: inbox.pendingDecisions.length,
    },
    series: {
      activityByDay: activityByDay(windowEvents),
      throughputByDay: throughputByDay(windowEvents, terminal),
      eventsByKind: eventsByKind(windowEvents),
    },
  };
}

/** Narrows a task to the minimal reference the inbox panels render. */
function toInboxRef(task: { key: string; title: string; state: string }): InboxRef {
  return { key: task.key, title: task.title, state: task.state };
}

/**
 * The millisecond lower bound for a window like `30d`, or null when it
 * cannot be parsed (treat as "no bound" — show everything). Reuses the
 * same duration parser AuditQuery uses so the window semantics match.
 */
function windowStartMs(window: string): number | null {
  return parseTimeBound(window);
}
