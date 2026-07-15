import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../config/config-schema.js';
import { AuditHeadSignatureRepository } from '../../storage/sqlite/repositories/audit-head-signature-repository.js';
import { buildContentAttestation } from '../audit/attestation-cli.js';
import { CachedAuditIntegrity } from '../integrity/audit-integrity.js';
import { AuditTail } from '../integrity/audit-tail.js';
import { createAttestationSource } from '../integrity/head-checkpoint.js';
import { ProjectSecretService } from '../integrity/project-secret.js';
import type { ServiceContainer } from '../service-container.js';
import {
  buildDashboardData,
  DEFAULT_METRICS_WINDOW,
  DEFAULT_RECENT_LIMIT,
  toRecentEvent,
} from './dashboard-data.js';
import { renderEventRow, renderLiveShell, renderTabBody } from './dashboard-render.js';

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
 * Absolute path to the built SPA bundle (Vite output, MNEMA-ADR-66). Resolved
 * relative to this compiled module so it works both from `dist/` at runtime
 * and from source during tests. The SPA is served under `/app`; the legacy
 * string-rendered shell keeps `/` as the bridge until the SPA reaches parity
 * (ADR-65).
 */
const SPA_DIR = fileURLToPath(new URL('../../../dist/dashboard', import.meta.url));

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
  const auditDir = path.join(projectRoot, config.paths.audit);
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
    // Content attestation (ADR-41) so the dashboard shows the same
    // anonymous-verifiability verdict as verify/doctor. Passed as a builder so
    // audit-integrity does not import the attestation layer (cycle); the cache
    // key folds the attest-dir signature so a new/edited .att invalidates it.
    () => buildContentAttestation(projectRoot, auditDir),
  );

  /** Composes a fresh snapshot for a request. */
  function snapshot() {
    return buildDashboardData(container, config, projectRoot, {
      limit,
      window,
      integrity: integrityCache.get(),
    });
  }

  /** The four tab routes → the tab id their fragment renders. */
  const TAB_ROUTES: Record<string, string> = {
    '/overview': 'overview',
    '/flow': 'flow',
    '/activity': 'activity',
    '/graph': 'graph',
  };

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

    if (url === '/' || url === '/index.html') {
      const html = renderLiveShell(snapshot());
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Per-tab HTML fragments — the client fetches only the visible tab and
    // swaps the pane, so a live refresh redraws just that tab's charts.
    const tab = TAB_ROUTES[url];
    if (tab !== undefined) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderTabBody(tab, snapshot()));
      return;
    }

    if (url === '/stream') {
      openStream(req, res);
      return;
    }

    // JSON contract for the SPA (ADR-65/ADR-8): the same composed snapshot the
    // string-rendered shell uses, serialised verbatim. Proven pure/serialisable
    // by MNEMA-330; integrity is injected from the cache, so this path never
    // reaches the raw SQLite adapter itself.
    if (url === '/api/dashboard') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snapshot()));
      return;
    }

    // The Vite-built SPA (ADR-66), served under /app so it coexists with the
    // legacy string-rendered shell at / (the bridge, per ADR-65). A missing
    // bundle (SPA not built) is a plain 404, not a crash.
    if (url === '/app' || url === '/app/' || url.startsWith('/app/')) {
      serveSpa(url, res);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  }

  /**
   * Serves a file from the built SPA bundle, defending against path traversal
   * by resolving inside {@link SPA_DIR} and refusing anything that escapes it.
   * `/app` and `/app/` map to the SPA's index.html so a deep link still boots
   * the app.
   */
  function serveSpa(url: string, res: ServerResponse): void {
    const rel = url === '/app' || url === '/app/' ? 'index.html' : url.slice('/app/'.length);
    // Strip any query/hash, then resolve and confirm containment.
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

  // One tail for the whole server; its handler fans each event out to
  // every connected client as a ready-to-insert table row. renderEventRow
  // escapes CR/LF, so a recorded value cannot break the SSE framing.
  const tail = new AuditTail(auditDir, (event) => {
    if (clients.size === 0) return;
    const row = renderEventRow(toRecentEvent(event, display));
    const frame = `data: ${row}\n\n`;
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
