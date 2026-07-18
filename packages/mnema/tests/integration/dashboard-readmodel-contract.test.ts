import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '@mnema/core/config/config-schema.js';
import {
  createServiceContainer,
  type ServiceContainer,
} from '@mnema/core/services/service-container.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDashboardData } from '@/dashboard-server/dashboard-data.js';
import { buildDashboardReadModel } from '@/dashboard-server/dashboard-read-model.js';

/**
 * MNEMA-330 spike proof (ADR-65 pre-work). ADR-65 amends ADR-8: the coming
 * SPA must read the SAME composed read-model the current serve builds
 * (buildDashboardData), NOT open better-sqlite3 directly, so there is no
 * second source of truth. These tests are the executable go/no-go for that
 * decoupling:
 *
 *  1. `DashboardData` survives a JSON round-trip byte-for-byte — so it can be
 *     served over HTTP to the SPA verbatim (it is the wire contract).
 *  2. It can be produced with the integrity section INJECTED via options —
 *     the raw-SQLite-adapter touch now lives ONLY behind the read-model seam
 *     (dashboard-read-model.ts's integrity()), never in buildDashboardData.
 *     With integrity supplied, that seam method is never called.
 *  3. The returned tree is pure data: no function, no adapter/container/DB
 *     handle leaks across the seam.
 *
 * The seam itself (MNEMA-319): buildDashboardData takes a DashboardReadModel,
 * not the ServiceContainer or the adapter — so an internal frontend targets
 * the interface, and the raw-adapter access is confined to
 * buildDashboardReadModel.
 *
 * Verdict recorded in docs-local/spike-dashboard-readmodel-contract.md.
 */

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly projectRoot: string;
  readonly config: ReturnType<typeof ConfigSchema.parse>;
}

function setup(): Harness {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-readmodel-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(projectRoot, '.mnema/workflows', 'default.json'),
  );
  const config = ConfigSchema.parse({
    version: '2.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test Project' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });
  return { container, projectRoot, config };
}

/** Recursively assert a value is pure JSON data (no fn/class/Map/Set/bigint). */
function assertPureData(value: unknown, pathTrail = '$'): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return;
  if (t === 'function' || t === 'bigint' || t === 'symbol') {
    throw new Error(`non-serialisable ${t} at ${pathTrail}`);
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      assertPureData(v, `${pathTrail}[${i}]`);
    });
    return;
  }
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    // Plain objects only: a Map/Set/class instance has a non-Object prototype.
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`non-plain object (${proto?.constructor?.name}) at ${pathTrail}`);
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertPureData(v, `${pathTrail}.${k}`);
    }
    return;
  }
  throw new Error(`unexpected type ${t} at ${pathTrail}`);
}

describe('MNEMA-330 — dashboard read-model is a serialisable SPA contract', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });
  afterEach(() => {
    h.container.close?.();
    rmSync(h.projectRoot, { recursive: true, force: true });
  });

  it('DashboardData survives a JSON round-trip byte-for-byte (wire contract)', () => {
    const data = buildDashboardData(buildDashboardReadModel(h.container, h.config, h.projectRoot));
    const roundTripped = JSON.parse(JSON.stringify(data));
    expect(roundTripped).toEqual(data);
  });

  it('is pure data — no function, Map/Set, class instance, or adapter handle leaks', () => {
    const data = buildDashboardData(buildDashboardReadModel(h.container, h.config, h.projectRoot));
    expect(() => assertPureData(data)).not.toThrow();
  });

  it('can be produced with integrity INJECTED — the SPA-facing path needs no raw adapter', () => {
    // The only adapter touch in buildDashboardData is the inspectAuditIntegrity
    // fallback; supplying options.integrity bypasses it entirely. This proves
    // the read-model can be assembled from the composed read-services alone,
    // with the integrity section computed elsewhere (or cached) — exactly the
    // seam the SPA's /api layer will use.
    const injected = [{ name: 'audit hash chain', ok: true, detail: 'verified' }];
    const data = buildDashboardData(buildDashboardReadModel(h.container, h.config, h.projectRoot), {
      integrity: injected,
    });
    expect(data.integrity).toEqual(injected);
    // Still a clean wire contract with the injected section in place.
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('exposes the exact panels the SPA tasks build against (290/291/292)', () => {
    const data = buildDashboardData(buildDashboardReadModel(h.container, h.config, h.projectRoot));
    // 291 — Needs-you panel source
    expect(data.inbox).toHaveProperty('awaitingReview');
    expect(data.inbox).toHaveProperty('blocked');
    expect(data.inbox).toHaveProperty('pendingDecisions');
    // 290 — dependency graph source (with a focusable frontier + critical path)
    expect(data.graph).toHaveProperty('nodes');
    expect(data.graph).toHaveProperty('frontier');
    expect(data.graph).toHaveProperty('criticalPath');
    // 292 — chart series source
    expect(data.series).toHaveProperty('activityByDay');
    expect(data.series).toHaveProperty('eventsByKind');
  });

  it('builds from a plain DashboardReadModel with NO container or adapter (the seam)', () => {
    // The strongest proof of MNEMA-319: buildDashboardData depends only on the
    // interface. A hand-rolled read-model — no ServiceContainer, no SqliteAdapter
    // anywhere — produces a valid, serialisable snapshot. If buildDashboardData
    // reached for the container/adapter, this would not compile or would throw.
    const fake: import('@/services/dashboard/dashboard-read-model.js').DashboardReadModel = {
      projectKey: 'FAKE',
      dependencyGraph: () => ({
        scope: { kind: 'project' },
        nodes: [],
        cycles: [],
        frontier: { ready: [], blocked: [] },
        criticalPath: [],
      }),
      inbox: () => ({
        awaitingReview: [],
        blocked: [],
        pendingDecisions: [],
        slaBreaches: [],
        wipBreaches: [],
      }),
      flow: () => ({
        throughput: 0,
        lead_time: { count: 0, avg_hours: null, median_hours: null, max_hours: null },
        cycle_time: { count: 0, avg_hours: null, median_hours: null, max_hours: null },
        reopen: { reopened_tasks: 0, completed_tasks: 0, rate: 0 },
        velocity: [],
        estimate_vs_actual: {
          samples: [],
          hours_per_point: null,
          run_duration_samples: 0,
          lead_time_fallback_samples: 0,
        },
        skill_adoption: { recorded: 0, used: 0, uses_per_run: null, used_vs_recorded: null },
      }),
      displayFor: (h) => h,
      terminalStates: () => ['DONE', 'CANCELED'],
      auditEvents: () => [],
      hasSchemaDrift: () => false,
      integrity: () => [{ name: 'audit hash chain', ok: true, detail: 'verified' }],
    };

    const data = buildDashboardData(fake);
    expect(data.projectKey).toBe('FAKE');
    expect(data.schemaDrift).toBe(false);
    expect(() => assertPureData(data)).not.toThrow();
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});
