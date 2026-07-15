import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { buildDashboardData } from '@/services/dashboard/dashboard-data.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

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
 *     the only place buildDashboardData touches the raw SQLite adapter
 *     (dashboard-data.ts, the inspectAuditIntegrity fallback). With integrity
 *     supplied, the SPA-facing path needs no direct better-sqlite3 read.
 *  3. The returned tree is pure data: no function, no adapter/container/DB
 *     handle leaks across the seam.
 *
 * Verdict recorded in docs-local/spike-dashboard-readmodel-contract.md.
 */

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

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
    version: '1.0',
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
    const data = buildDashboardData(h.container, h.config, h.projectRoot);
    const roundTripped = JSON.parse(JSON.stringify(data));
    expect(roundTripped).toEqual(data);
  });

  it('is pure data — no function, Map/Set, class instance, or adapter handle leaks', () => {
    const data = buildDashboardData(h.container, h.config, h.projectRoot);
    expect(() => assertPureData(data)).not.toThrow();
  });

  it('can be produced with integrity INJECTED — the SPA-facing path needs no raw adapter', () => {
    // The only adapter touch in buildDashboardData is the inspectAuditIntegrity
    // fallback; supplying options.integrity bypasses it entirely. This proves
    // the read-model can be assembled from the composed read-services alone,
    // with the integrity section computed elsewhere (or cached) — exactly the
    // seam the SPA's /api layer will use.
    const injected = [{ name: 'audit hash chain', ok: true, detail: 'verified' }];
    const data = buildDashboardData(h.container, h.config, h.projectRoot, {
      integrity: injected,
    });
    expect(data.integrity).toEqual(injected);
    // Still a clean wire contract with the injected section in place.
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('exposes the exact panels the SPA tasks build against (290/291/292)', () => {
    const data = buildDashboardData(h.container, h.config, h.projectRoot);
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
});
