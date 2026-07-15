import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { get, request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import {
  createDashboardServer,
  type DashboardServer,
  isLoopbackHost,
} from '@/services/dashboard/dashboard-server.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly projectRoot: string;
  readonly config: ReturnType<typeof ConfigSchema.parse>;
}

function setup(): Harness {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-serve-'));
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

/** GET a path and resolve with { status, headers, body }. */
function httpGet(
  port: number,
  urlPath: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
  });
}

describe('isLoopbackHost', () => {
  it('accepts loopback names and addresses', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
  });

  it('rejects anything reachable off-box', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('::')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
  });
});

describe('createDashboardServer (integration)', () => {
  let h: Harness;
  let server: DashboardServer;

  beforeEach(async () => {
    h = setup();
    // Port 0 = an ephemeral free port, avoiding collisions in CI.
    server = await createDashboardServer({
      container: h.container,
      config: h.config,
      projectRoot: h.projectRoot,
      port: 0,
    });
  });

  afterEach(async () => {
    await server.close();
    h.container.close();
    rmSync(h.projectRoot, { recursive: true, force: true });
  });

  it('serves a self-contained live page (no external requests; one inline script)', async () => {
    const { status, body } = await httpGet(server.port, '/');
    expect(status).toBe(200);
    expect(body.startsWith('<!doctype html>')).toBe(true);
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toContain('<link');
    expect((body.match(/<script/g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/<script[^>]*\ssrc=/);
    expect(body).toContain("new EventSource('stream')");
  });

  it('serves each per-tab HTML fragment', async () => {
    for (const tab of ['/overview', '/flow', '/activity', '/graph']) {
      const { status, body } = await httpGet(server.port, tab);
      expect(status).toBe(200);
      expect(body.length).toBeGreaterThan(0);
      // A fragment, not a full document.
      expect(body).not.toContain('<!doctype html>');
    }
    // The overview fragment carries the coverage card; the graph fragment
    // carries the dependency-graph card (its SVG appears once there are
    // nodes — the seeded temp project has none).
    expect((await httpGet(server.port, '/overview')).body).toContain('Coverage');
    expect((await httpGet(server.port, '/graph')).body).toContain('Dependency graph');
  });

  it('rejects a foreign Host header and accepts a loopback one', async () => {
    const foreign = await httpGet(server.port, '/', { host: 'evil.example' });
    expect(foreign.status).toBe(403);
    const ok = await httpGet(server.port, '/overview', { host: `localhost:${server.port}` });
    expect(ok.status).toBe(200);
  });

  it('404s an unknown path', async () => {
    const { status } = await httpGet(server.port, '/nope');
    expect(status).toBe(404);
  });

  it('serves the DashboardData contract as JSON at /api/dashboard (SPA data source)', async () => {
    const { status, body } = await httpGet(server.port, '/api/dashboard');
    expect(status).toBe(200);
    // Valid JSON that round-trips and carries the panels the SPA builds on.
    const data = JSON.parse(body);
    expect(data).toHaveProperty('projectKey', 'TEST');
    expect(data).toHaveProperty('inbox');
    expect(data.inbox).toHaveProperty('awaitingReview');
    expect(data.inbox).toHaveProperty('pendingDecisions');
    expect(data).toHaveProperty('graph');
    expect(data).toHaveProperty('series');
    expect(data).toHaveProperty('integrity');
  });

  it('serves the Board read (portfolio by state) at /api/board', async () => {
    const { status, body } = await httpGet(server.port, '/api/board');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    // PortfolioResult shape — from the existing portfolio service.
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('by_state');
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  it('serves epics + sprints with coverage at /api/epics', async () => {
    const { status, body } = await httpGet(server.port, '/api/epics');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(Array.isArray(data.epics)).toBe(true);
    expect(Array.isArray(data.sprints)).toBe(true);
  });

  it('serves the audit trail (newest-first, bounded) at /api/audit', async () => {
    const { status, body } = await httpGet(server.port, '/api/audit');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(data).toHaveProperty('total');
    expect(Array.isArray(data.events)).toBe(true);
    // Each row carries the wire projection (no raw payload dump).
    if (data.events.length > 0) {
      const e = data.events[0];
      expect(e).toHaveProperty('index');
      expect(e).toHaveProperty('kind');
      expect(e).toHaveProperty('actor');
      // Thesis guard: the raw event envelope must NOT leak to the wire — no
      // `data` payload (arbitrary task content), no internal hash/run/v fields.
      expect(e).not.toHaveProperty('data');
      expect(e).not.toHaveProperty('run');
      expect(e).not.toHaveProperty('v');
    }
  });

  it('never leaks a raw event payload through /api/audit', async () => {
    // Write an event whose payload carries a sensitive marker, then confirm
    // the marker never appears in the /api/audit response body.
    h.container.audit.write({
      kind: 'test_event',
      actor: 'tester',
      data: { key: 'TEST-9', secret_marker: 'DO-NOT-LEAK-abc123' },
    });
    const { body } = await httpGet(server.port, '/api/audit');
    expect(body).not.toContain('DO-NOT-LEAK-abc123');
    // The entity key IS allowed through (it's an identifier, not content).
    const data = JSON.parse(body);
    expect(data.events.some((e: { key?: string }) => e.key === 'TEST-9')).toBe(true);
  });

  it('serves the commit-drift scan at /api/drift', async () => {
    const { status, body } = await httpGet(server.port, '/api/drift');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    // CommitDrift shape — `checked` is the honesty bit.
    expect(data).toHaveProperty('checked');
    expect(data).toHaveProperty('untracked');
    expect(data).toHaveProperty('linkable');
  });

  const spaBuilt = existsSync(path.resolve('dist/dashboard/index.html'));

  it('redirects /app (no trailing slash) to /app/ so relative assets resolve', async () => {
    // Without this the browser resolves the bundle's `./assets/…` against `/`
    // → /assets/… (404) → blank page. The redirect makes `./` resolve under
    // /app/ where the assets are actually served.
    const { status, headers } = await httpGet(server.port, '/app');
    expect(status).toBe(301);
    expect(headers.location).toBe('/app/');
  });

  it.skipIf(!spaBuilt)('serves the built SPA bundle at /app/', async () => {
    const { status, body } = await httpGet(server.port, '/app/');
    expect(status).toBe(200);
    expect(body).toContain('<div id="root">');
    // The SPA entry script is a relative, self-hosted asset (offline-first).
    expect(body).toMatch(/src="\.\/assets\//);
    expect(body).not.toMatch(/https?:\/\//);
  });

  it('refuses a path-traversal escape from the /app static root', async () => {
    const { status } = await httpGet(server.port, '/app/../../package.json');
    // Either the server normalises and 403s, or the escape simply misses the
    // bundle dir and 404s — never a 200 leaking a file outside dist/dashboard.
    expect([403, 404]).toContain(status);
  });

  it('refuses to bind a non-loopback host', async () => {
    await expect(
      createDashboardServer({
        container: h.container,
        config: h.config,
        projectRoot: h.projectRoot,
        host: '0.0.0.0',
        port: 0,
      }),
    ).rejects.toThrow(/loopback/i);
  });

  it('recovers a request even if it would throw (never crashes the daemon)', async () => {
    // After a bad request the server must still serve the next one — a
    // throw inside the handler must become a response, not a process exit.
    await httpGet(server.port, '/overview');
    const again = await httpGet(server.port, '/');
    expect(again.status).toBe(200);
  });

  it('pushes a newly-written audit event to a connected stream', async () => {
    // Open an SSE stream and collect frames.
    const received: string[] = [];
    const streamReq = request(
      { host: '127.0.0.1', port: server.port, path: '/stream', method: 'GET' },
      (res) => {
        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => received.push(chunk));
      },
    );
    streamReq.end();

    // Give the stream a moment to register, then write a real audit event
    // through the container (the write lands in current.jsonl; AuditTail
    // sees it via fs.watch and broadcasts it).
    await new Promise((r) => setTimeout(r, 200));
    h.container.audit.write({ kind: 'test_event', actor: 'tester', data: { key: 'TEST-1' } });

    // Wait for the push (fs.watch latency + read).
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !received.join('').includes('TEST-1')) {
      await new Promise((r) => setTimeout(r, 100));
    }
    streamReq.destroy();

    const all = received.join('');
    // The row now carries data-* filter attributes, so match the opening tag.
    expect(all).toContain('data: <tr');
    expect(all).toContain('TEST-1');
    expect(all).toContain('test_event');
  });
});
