/**
 * The SPA-side view of the `/api/dashboard` JSON contract. This mirrors the
 * server's `DashboardData` (src/services/dashboard/dashboard-data.ts), proven
 * pure/serialisable. It is intentionally a SEPARATE declaration,
 * not an import from the backend, so the SPA compilation unit never pulls in
 * Node/service code. Keep it in sync with the server type; the /api/dashboard
 * integration test guards the shape the panels rely on.
 *
 * The shell only needs the top-level identity + the panel roots; each panel
 * task (Needs-you 291, graph 290, charts 292) refines the sub-shapes it uses.
 */
/** One task node in the dependency graph (mirrors the server GraphNode). */
export interface GraphNode {
  readonly key: string;
  readonly state: string;
  readonly terminal: boolean;
  readonly blockedBy: readonly string[];
  readonly blocks: readonly string[];
}

/** A blocked task with the non-terminal blockers holding it (server BlockedNode). */
export interface BlockedNode {
  readonly key: string;
  readonly blockedBy: readonly string[];
}

/** The dependency graph section of the contract (mirrors server DependencyGraph). */
export interface DashboardGraph {
  readonly scope: { readonly kind: string; readonly key?: string };
  readonly nodes: readonly GraphNode[];
  readonly cycles: readonly (readonly string[])[];
  readonly frontier: {
    readonly ready: readonly string[];
    readonly blocked: readonly BlockedNode[];
  };
  readonly criticalPath: readonly string[];
}

/** A duration summary (mirrors the server DurationSummary). */
export interface DurationSummary {
  readonly count: number;
  readonly avg_hours: number | null;
  readonly median_hours: number | null;
  readonly max_hours: number | null;
}

/** Flow metrics (mirrors the server FlowMetrics; only the fields the UI reads). */
export interface FlowMetrics {
  readonly throughput: number;
  readonly lead_time: DurationSummary;
  readonly cycle_time: DurationSummary;
  readonly reopen: {
    readonly reopened_tasks: number;
    readonly completed_tasks: number;
    readonly rate: number;
  };
  readonly velocity: ReadonlyArray<{
    readonly sprint_key: string;
    readonly sprint_name: string;
    readonly completed_points: number;
    readonly completed_tasks: number;
  }>;
  readonly estimate_vs_actual: {
    readonly samples: ReadonlyArray<{
      readonly task_key: string;
      readonly estimate: number;
      readonly actual_hours: number;
      readonly actual_source: 'run_duration' | 'lead_time';
    }>;
    readonly hours_per_point: number | null;
    readonly run_duration_samples: number;
    readonly lead_time_fallback_samples: number;
  };
}

/** One recent-activity row (mirrors the server RecentEvent). */
export interface RecentEvent {
  readonly at: string;
  readonly kind: string;
  readonly actor: string;
  readonly via?: string;
  readonly key?: string;
}

/** The /api/board payload (mirrors the server PortfolioResult). */
export interface BoardData {
  readonly total: number;
  readonly by_state: Readonly<Record<string, number>>;
  readonly tasks: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly state: string;
    readonly assignee_id: string | null;
    readonly updated_at: string;
    readonly labels: readonly string[];
  }>;
}

/** A coverage summary for an epic or sprint (from /api/epics). */
export interface CoverageSummary {
  readonly total: number;
  readonly terminal: number;
  readonly percent: number;
}
export interface WorklineEpic {
  readonly key: string;
  readonly title: string;
  readonly state: string;
  readonly coverage: CoverageSummary | null;
}
export interface WorklineSprint {
  readonly key: string;
  readonly name: string;
  readonly state: string;
  readonly coverage: CoverageSummary | null;
}
/** The /api/epics payload: epics + sprints with coverage. */
export interface WorklinesData {
  readonly epics: readonly WorklineEpic[];
  readonly sprints: readonly WorklineSprint[];
}

/** One audit-trail row from /api/audit (server projection, not the raw event). */
export interface AuditRow {
  readonly index: number;
  readonly at: string;
  readonly kind: string;
  readonly actor: string;
  readonly via?: string;
  readonly key?: string;
  readonly prevHash: string | null;
}
/** The /api/audit payload: the bounded, newest-first tail of the chain. */
export interface AuditData {
  readonly total: number;
  readonly events: readonly AuditRow[];
}

/** The /api/drift payload (mirrors the server CommitDrift). */
export interface DriftData {
  readonly checked: boolean;
  readonly linkable: ReadonlyArray<{
    readonly sha: string;
    readonly subject: string;
    readonly taskKeys: readonly string[];
  }>;
  readonly untracked: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
}

/** The /api/knowledge payload (decisions/skills/memories — identifiers only). */
export interface KnowledgeData {
  readonly decisions: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly status: string;
    readonly superseded: boolean;
    readonly impacts: number;
  }>;
  readonly skills: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly flagged: boolean;
  }>;
  readonly memories: ReadonlyArray<{
    readonly slug: string;
    readonly title: string;
    readonly topics: readonly string[];
  }>;
  readonly reviewProposals: ReadonlyArray<{
    readonly slug: string;
    readonly taskKey: string;
    readonly reopenCount: number;
  }>;
}

/** The /api/agents payload: orphaned (stale-open) runs. */
export interface AgentsData {
  readonly thresholdHours: number;
  readonly orphans: ReadonlyArray<{
    readonly id: string;
    readonly goal: string;
    readonly ageHours: number;
  }>;
}

/** The /api/search payload: FTS hits for a query (the snippet is the result). */
export interface SearchData {
  readonly query: string;
  readonly hits: ReadonlyArray<{
    readonly entity: string;
    readonly key: string | null;
    readonly title: string | null;
    readonly snippet: string;
    readonly parentKey: string | null;
  }>;
}

export interface DashboardContract {
  readonly projectKey: string;
  readonly generatedAt: string;
  readonly window: string;
  readonly schemaDrift: boolean;
  readonly flow: FlowMetrics;
  readonly recent: readonly RecentEvent[];
  readonly integrity: ReadonlyArray<{ name: string; ok: boolean; detail: string }>;
  readonly inbox: {
    readonly awaitingReview: ReadonlyArray<{ key: string; title: string; state: string }>;
    readonly blocked: ReadonlyArray<{ key: string; title: string; state: string }>;
    readonly pendingDecisions: number;
    // Mirrors the server SlaBreach/WipBreach (only the fields the panel reads).
    readonly slaBreaches: ReadonlyArray<{
      readonly key: string;
      readonly title: string;
      readonly age_days: number;
      readonly sla_days: number;
    }>;
    readonly wipBreaches: ReadonlyArray<{
      readonly state: string;
      readonly count: number;
      readonly limit: number;
    }>;
  };
  readonly graph: DashboardGraph;
  readonly series: {
    readonly activityByDay: ReadonlyArray<{ label: string; value: number }>;
    readonly throughputByDay: ReadonlyArray<{ label: string; value: number }>;
    readonly eventsByKind: ReadonlyArray<{ label: string; value: number }>;
  };
}
