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
  readonly graph: {
    readonly nodes: readonly unknown[];
    readonly frontier: { readonly ready: readonly string[]; readonly blocked: readonly unknown[] };
    readonly criticalPath: readonly string[];
  };
  readonly series: {
    readonly activityByDay: ReadonlyArray<{ label: string; value: number }>;
    readonly throughputByDay: ReadonlyArray<{ label: string; value: number }>;
    readonly eventsByKind: ReadonlyArray<{ label: string; value: number }>;
  };
}
