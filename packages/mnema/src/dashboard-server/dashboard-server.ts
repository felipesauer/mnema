import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '@mnema/core/config/config-schema.js';
import { deriveAlias } from '@mnema/core/domain/entity-alias.js';
import { buildContentAttestation } from '@mnema/core/services/audit/attestation-cli.js';
import { rebaselineResolverFor } from '@mnema/core/services/audit/rebaseline-resolve.js';
import { CachedAuditIntegrity } from '@mnema/core/services/integrity/audit-integrity.js';
import { AuditTail } from '@mnema/core/services/integrity/audit-tail.js';
import { createAttestationSource } from '@mnema/core/services/integrity/head-checkpoint.js';
import { localTailDir } from '@mnema/core/services/integrity/machine-id.js';
import { ProjectSecretService } from '@mnema/core/services/integrity/project-secret.js';
import { userKnowledgeDir } from '@mnema/core/services/knowledge/user-knowledge.js';
import type { ServiceContainer } from '@mnema/core/services/service-container.js';
import { AuditHeadSignatureRepository } from '@mnema/core/storage/sqlite/repositories/audit-head-signature-repository.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';
import {
  buildDashboardData,
  DEFAULT_METRICS_WINDOW,
  DEFAULT_RECENT_LIMIT,
} from './dashboard-data.js';
import { buildDashboardReadModel } from './dashboard-read-model.js';

/** Loopback host the server binds to by default. Never `0.0.0.0`. */
export const DEFAULT_HOST = '127.0.0.1';
/** Default port for the live dashboard. */
export const DEFAULT_PORT = 4700;
/** SSE heartbeat interval — keeps proxies/browsers from idling the socket. */
const HEARTBEAT_MS = 25_000;

/**
 * The only hosts we ever bind. The live dashboard is a single-machine
 * tool; binding anything reachable off-box would expose the whole trail
 * to the network, so a non-loopback host is refused rather than honored.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** Loopback host names accepted in a request's `Host` header. */
const ALLOWED_HOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Absolute path to the built SPA bundle (Vite output). Resolved
 * relative to this compiled module so it works both from `dist/` at runtime
 * and from source during tests. The SPA is served under `/app`; the legacy
 * string-rendered shell keeps `/` as the bridge until the SPA reaches parity.
 */
const SPA_DIR = fileURLToPath(new URL('../../dist/dashboard', import.meta.url));

/** Minimal content types for the static SPA assets — no external lookup. */
const SPA_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

/** Options for {@link createDashboardServer}. */
export interface DashboardServerOptions {
  readonly container: ServiceContainer;
  readonly config: Config;
  readonly projectRoot: string;
  readonly host?: string;
  readonly port?: number;
  /** Recent-activity rows to backfill on page load. */
  readonly limit?: number;
  /** Lookback window for flow metrics + time-series (e.g. `30d`). */
  readonly window?: string;
}

/** A running dashboard server. */
export interface DashboardServer {
  /** The URL to open (e.g. `http://127.0.0.1:4700`). */
  readonly url: string;
  /** The bound port (useful when port 0 was requested for an ephemeral one). */
  readonly port: number;
  /** Stops the tail, closes every SSE connection, and closes the socket. */
  close(): Promise<void>;
}

/** True when the host is one we are willing to bind (loopback only). */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/**
 * Creates and starts a live dashboard server: a loopback-only HTTP server
 * that serves the live shell, exposes the aggregate panels as JSON, and
 * pushes each new audit event to connected browsers via Server-Sent
 * Events. Strictly read-only — it composes the existing read services and
 * reuses {@link AuditTail} (file-watch) as the push source, so it learns
 * of events written by ANY process (the MCP server, a CLI mutation)
 * without coupling to them.
 *
 * The caller owns the container lifecycle; `close()` here does not close
 * the container.
 *
 * @param options - Container/config/root plus optional host/port/limit
 * @returns The running server once it is listening
 * @throws If `host` is not a loopback host — the tool never binds off-box.
 */
export async function createDashboardServer(
  options: DashboardServerOptions,
): Promise<DashboardServer> {
  const { container, config, projectRoot } = options;
  const host = options.host ?? DEFAULT_HOST;
  // Enforce the loopback-only promise at the bind: making loopback the
  // default is not enough — a caller could pass `0.0.0.0` and expose the
  // whole trail to the network. Refuse rather than honor it.
  if (!isLoopbackHost(host)) {
    throw new Error(
      `refusing to bind non-loopback host "${host}"; use 127.0.0.1, localhost or ::1`,
    );
  }
  const port = options.port ?? DEFAULT_PORT;
  const limit = options.limit ?? DEFAULT_RECENT_LIMIT;
  const window = options.window ?? DEFAULT_METRICS_WINDOW;
  const auditDir = path.join(projectRoot, LAYOUT.audit);
  // Live-follow this machine's own tail: events from other machines arrive by
  // git pull (a file appearing, not an in-process append), so the local tail
  // is the one `fs.watch` can stream in real time.
  const tailDir = localTailDir(auditDir, userKnowledgeDir());
  const display = container.identity.getDisplayFor.bind(container.identity);

  // Verify the hash chain at most once per audit-file change, not once per
  // request/tab. The cache recomputes when the files' stat signature moves
  // (append, rotation, or an in-place edit — so tampering between requests
  // is still caught) and serves the prior result otherwise.
  const integrityCache = new CachedAuditIntegrity(
    container.adapter,
    auditDir,
    new ProjectSecretService(projectRoot, config.project.key),
    // Attestation source so the dashboard runs the machine head-signature
    // check too — otherwise a forged head signature is red in doctor/verify
    // but invisible here. The cache key folds the signature identity so a
    // signature change invalidates it.
    createAttestationSource(projectRoot, new AuditHeadSignatureRepository(container.adapter)),
    // Content attestation so the dashboard shows the same
    // anonymous-verifiability verdict as verify/doctor. Passed as a builder so
    // audit-integrity does not import the attestation layer (cycle); the cache
    // key folds the attest-dir signature so a new/edited .att invalidates it.
    () => buildContentAttestation(projectRoot, auditDir),
    // The mirror tracks this machine's tail, so the count check compares
    // against the local tail, not the project-wide total.
    tailDir,
    // Accept a re-baselined genesis whose committed waiver verifies, so a
    // legitimate prune does not read as tamper on the dashboard.
    rebaselineResolverFor(projectRoot),
  );

  // The read-model seam the snapshot builds against — the SPA and any future
  // internal frontend target this, never the container/adapter directly.
  const readModel = buildDashboardReadModel(container, config, projectRoot);

  /** Composes a fresh snapshot for a request. */
  function snapshot() {
    return buildDashboardData(readModel, {
      limit,
      window,
      integrity: integrityCache.get(),
    });
  }

  /**
   * The Board read: the backlog counted + listed by state (portfolio),
   * optionally filtered. Filters are echoed by the portfolio
   * service and pushed into its query — an unknown epic/sprint key yields an
   * honest empty result, not a silent ignore.
   */
  function boardData(filter: { epicKey?: string; sprintKey?: string; state?: string } = {}) {
    return container.portfolio.run(filter);
  }

  /**
   * The Audit-trail read (Integrity module): the most recent chained events,
   * newest-first, projected to the wire (kind/actor/via/at + a short prev_hash
   * pointer + the entity key). Bounded to a tail — the full log can be huge —
   * and reads only the existing AuditQuery service.
   */
  function auditData() {
    const AUDIT_TAIL = 60;
    const all = container.auditQuery.run({});
    const tail = all.slice(-AUDIT_TAIL);
    const rows = tail
      .map((e, i) => {
        // Absolute index in the full log (1-based), so the UI can show #N.
        const index = all.length - tail.length + i + 1;
        const keyField = ['key', 'task_key', 'decision_key', 'epic_key', 'sprint_key'].find(
          (k) => typeof e.data[k] === 'string',
        );
        return {
          index,
          at: e.at,
          kind: e.kind,
          actor: display(e.actor),
          via: e.via,
          key: keyField ? (e.data[keyField] as string) : undefined,
          prevHash: typeof e.prev_hash === 'string' ? e.prev_hash.slice(0, 8) : null,
        };
      })
      .reverse();
    return { total: all.length, events: rows };
  }

  /** The Drift read (Integrity module): commits on this branch with no task. */
  function driftData() {
    return container.drift.scan(projectRoot, { limit: 50 });
  }

  /**
   * The Knowledge read (Knowledge module): decisions, skills, memories, and the
   * skill-review proposals. Projected to identifiers/metadata ONLY — the free
   * text (a decision's context/rationale, a skill/memory body) is never sent to
   * the wire, same discipline as the audit trail. Reads only existing services.
   */
  function knowledgeData() {
    const key = config.project.key;
    const decisions = container.decision.list(key).map((d) => ({
      key: d.key,
      title: d.title,
      status: d.status,
      superseded: d.supersededBy !== null,
      impacts: d.impacts.length,
    }));
    const flagged = container.skillQuality.reviewProposals();
    const flaggedSlugs = new Set(flagged.map((p) => p.slug));
    const skills = container.skill.list().map((s) => ({
      slug: s.slug,
      name: s.name,
      flagged: flaggedSlugs.has(s.slug),
    }));
    const memories = container.memory.list().map((m) => ({
      slug: m.slug,
      title: m.title,
      topics: m.topics ?? [],
    }));
    const reviewProposals = flagged.map((p) => ({
      slug: p.slug,
      taskKey: p.taskKey,
      reopenCount: p.reopenCount,
    }));
    return { decisions, skills, memories, reviewProposals };
  }

  /**
   * Global search (Integrity-independent): FTS hits for `q` via the existing
   * search service. A blank/too-short query returns no hits rather than an
   * error. The snippet is the search result itself (what the user asked to
   * see), so it is intentionally included.
   */
  function searchData(q: string) {
    const query = q.trim();
    if (query.length < 2) return { query, hits: [] as unknown[] };
    const result = container.search.search(query, { perEntityLimit: 8 });
    if (!result.ok) return { query, hits: [] as unknown[] };
    return {
      query,
      hits: result.value.map((h) => ({
        entity: h.entity,
        key: h.key,
        title: h.title,
        snippet: h.snippet,
        parentKey: h.parentKey,
      })),
    };
  }

  /** The Agents read (Agents module): orphaned (stale-open) runs. */
  function agentsData() {
    const threshold = config.aging.orphan_run_after_hours;
    const orphans = container.orphanRun.detect(threshold);
    return {
      thresholdHours: threshold,
      orphans: orphans.map((o) => ({ id: o.id, goal: o.goal, ageHours: o.ageHours })),
    };
  }

  /** Epics and sprints with their coverage — the "worklines" read. */
  function worklineData() {
    const key = config.project.key;
    const epics = container.epic.list(key).map((e) => {
      const cov = container.coverage.forEpic(e.id);
      return {
        key: deriveAlias('epic', e.id),
        title: e.title,
        state: e.state,
        coverage: cov.ok
          ? { total: cov.value.total, terminal: cov.value.terminal, percent: cov.value.percent }
          : null,
      };
    });
    const sprints = container.sprint.list(key).map((s) => {
      const cov = container.coverage.forSprint(s.id);
      return {
        key: deriveAlias('sprint', s.id),
        name: s.name,
        state: s.state,
        coverage: cov.ok
          ? { total: cov.value.total, terminal: cov.value.terminal, percent: cov.value.percent }
          : null,
      };
    });
    return { epics, sprints };
  }

  // Every connected /stream response. Broadcast writes to all of them.
  const clients = new Set<ServerResponse>();

  const server = createServer((req, res) => {
    // A single try/catch so a failure composing the page (e.g. the graph
    // becoming momentarily unavailable) returns a 500 for that one request
    // instead of throwing out of the callback and killing the daemon.
    try {
      handleRequest(req, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain' });
      }
      res.end('internal error\n');
    }
  });

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Reject anything but a loopback Host so a page on another site cannot
    // drive this server via a victim's browser (DNS-style rebinding).
    if (!isAllowedHost(req.headers.host, boundPort())) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden host\n');
      return;
    }

    const url = req.url ?? '/';
    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain' });
      res.end('method not allowed\n');
      return;
    }

    // The SPA now owns the root. `/` serves the built index.html and
    // `/assets/*` its bundle (Vite `base:'./'` → the page requests `/assets/…`
    // from the root). The legacy string-rendered dashboard has been retired.
    if (url === '/' || url === '/index.html') {
      serveSpaFile('index.html', res);
      return;
    }
    if (url.startsWith('/assets/')) {
      serveSpaFile(url.slice(1), res); // strip leading '/'
      return;
    }
    // Back-compat: the SPA used to live under /app; redirect any old link home.
    if (url === '/app' || url === '/app/' || url.startsWith('/app/')) {
      res.writeHead(301, { location: '/' });
      res.end();
      return;
    }

    if (url === '/stream') {
      openStream(req, res);
      return;
    }

    // JSON contract for the SPA: the same composed snapshot the
    // string-rendered shell uses, serialised verbatim. Proven pure/serialisable;
    // integrity is injected from the cache, so this path never
    // reaches the raw SQLite adapter itself.
    if (url === '/api/dashboard') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snapshot()));
      return;
    }

    // Work module. Served on demand — kept off the always-on
    // /api/dashboard payload so the Overview stays lean. Both read only the
    // existing services (no second source of truth).
    if (url.startsWith('/api/board')) {
      const params = new URL(url, 'http://localhost').searchParams;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify(
          boardData({
            epicKey: params.get('epic') ?? undefined,
            sprintKey: params.get('sprint') ?? undefined,
            state: params.get('state') ?? undefined,
          }),
        ),
      );
      return;
    }
    if (url === '/api/epics') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(worklineData()));
      return;
    }

    // Integrity module. On-demand reads over existing services.
    if (url === '/api/audit') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(auditData()));
      return;
    }
    if (url === '/api/drift') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(driftData()));
      return;
    }

    // Global search: FTS over tasks/decisions/notes/skills/
    // memories/observations, via the existing search service. The query is the
    // `q` param; an empty/absent q returns no hits (not an error).
    if (url.startsWith('/api/search')) {
      const q = new URL(url, 'http://localhost').searchParams.get('q') ?? '';
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(searchData(q)));
      return;
    }

    // Knowledge + Agents modules. On-demand, existing services.
    if (url === '/api/knowledge') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(knowledgeData()));
      return;
    }
    if (url === '/api/agents') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(agentsData()));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  }

  /**
   * Serves a file from the built SPA bundle, defending against path traversal
   * by resolving inside {@link SPA_DIR} and refusing anything that escapes it.
   * The caller passes `index.html` for `/` and the bundle-relative path for
   * `/assets/*`; the SPA owns the server root after the cutover.
   */
  function serveSpaFile(rel: string, res: ServerResponse): void {
    // Strip any query/hash, then resolve and confirm containment in SPA_DIR
    // (path-traversal guard).
    const clean = rel.split('?')[0]?.split('#')[0] ?? 'index.html';
    const resolved = path.resolve(SPA_DIR, clean);
    if (resolved !== SPA_DIR && !resolved.startsWith(SPA_DIR + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden\n');
      return;
    }
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found (SPA bundle missing — run `pnpm build`)\n');
      return;
    }
    const type = SPA_CONTENT_TYPES[path.extname(resolved)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    createReadStream(resolved).pipe(res);
  }

  /** Registers an SSE client and keeps the connection open. */
  function openStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    // A write to a peer-closed socket emits an 'error' on the response; an
    // unhandled one would crash the daemon. Swallow it and drop the client.
    res.on('error', () => {
      clients.delete(res);
    });
    // An initial comment flushes headers and confirms the stream is open.
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => {
      clients.delete(res);
    });
  }

  /** Writes a frame to a client, dropping it if the socket has gone away. */
  function writeToClient(res: ServerResponse, frame: string): void {
    if (res.writableEnded || res.destroyed) {
      clients.delete(res);
      return;
    }
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }

  // One tail for the whole server; its handler fans each event out to every
  // connected client as a compact JSON tick. The SPA refetches /api/dashboard
  // on any tick (it does not consume rendered HTML). Only the event `kind` is
  // sent — a stable enum token, so no recorded free-text reaches the wire and
  // CR/LF cannot break the SSE framing.
  const tail = new AuditTail(tailDir, (event) => {
    if (clients.size === 0) return;
    const frame = `data: ${JSON.stringify({ kind: event.kind })}\n\n`;
    for (const res of clients) writeToClient(res, frame);
  });

  // Heartbeat so idle SSE sockets are not reaped.
  const heartbeat = setInterval(() => {
    for (const res of clients) writeToClient(res, ': keep-alive\n\n');
  }, HEARTBEAT_MS);
  // Do not let the heartbeat keep the process alive on its own.
  heartbeat.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  await tail.start();

  function boundPort(): number {
    const addr = server.address();
    return addr !== null && typeof addr === 'object' ? addr.port : port;
  }

  const actualPort = boundPort();

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    close(): Promise<void> {
      clearInterval(heartbeat);
      tail.stop();
      for (const res of clients) res.end();
      clients.clear();
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

/**
 * True when the request's `Host` header is a loopback host on our bound
 * port. Rejects a foreign `Host` so a remote page cannot use a victim's
 * browser to reach this server. The accepted names are a fixed loopback
 * set — deliberately NOT widened by the bound host, so this check does not
 * become a rubber stamp even if the bind were ever non-loopback.
 */
function isAllowedHost(hostHeader: string | undefined, boundPort: number): boolean {
  if (hostHeader === undefined || hostHeader === '') return false;
  // Strip a trailing port for the name comparison; accept loopback names.
  const name = hostHeader.replace(/:\d+$/, '').toLowerCase();
  if (!ALLOWED_HOST_NAMES.has(name)) return false;
  // If a port is present it must match the port we actually bound.
  const portMatch = hostHeader.match(/:(\d+)$/);
  if (portMatch !== null && Number(portMatch[1]) !== boundPort) return false;
  return true;
}
