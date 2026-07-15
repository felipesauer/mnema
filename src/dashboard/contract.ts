/**
 * The SPA-side view of the `/api/dashboard` JSON contract. This mirrors the
 * server's `DashboardData` (src/services/dashboard/dashboard-data.ts), proven
 * pure/serialisable by MNEMA-330. It is intentionally a SEPARATE declaration,
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

export interface DashboardContract {
  readonly projectKey: string;
  readonly generatedAt: string;
  readonly window: string;
  readonly schemaDrift: boolean;
  readonly integrity: ReadonlyArray<{ name: string; ok: boolean; detail: string }>;
  readonly inbox: {
    readonly awaitingReview: ReadonlyArray<{ key: string; title: string; state: string }>;
    readonly blocked: ReadonlyArray<{ key: string; title: string; state: string }>;
    readonly pendingDecisions: number;
    readonly slaBreaches: readonly unknown[];
    readonly wipBreaches: readonly unknown[];
  };
  readonly graph: DashboardGraph;
  readonly series: {
    readonly activityByDay: ReadonlyArray<{ label: string; value: number }>;
    readonly throughputByDay: ReadonlyArray<{ label: string; value: number }>;
    readonly eventsByKind: ReadonlyArray<{ label: string; value: number }>;
  };
}
