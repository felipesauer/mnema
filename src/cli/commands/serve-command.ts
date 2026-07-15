import { spawn } from 'node:child_process';

import type { Command } from 'commander';

import {
  createDashboardServer,
  type DashboardServer,
  DEFAULT_HOST,
  DEFAULT_PORT,
  isLoopbackHost,
} from '../../services/dashboard/dashboard-server.js';
import { pc } from '../../utils/colors.js';
import { openCliContext } from '../cli-context.js';

interface ServeOptions {
  readonly port?: string;
  readonly host?: string;
  readonly open?: boolean;
  readonly limit?: string;
  readonly window?: string;
}

/** Grace period before a stuck shutdown is forced, mirroring the MCP server. */
const HARD_SHUTDOWN_MS = 5_000;

/**
 * Registers `mnema serve` — a foreground, loopback-only live dashboard:
 * a dark, tabbed UI (Overview / Flow / Activity / Graph) with inline-SVG
 * charts that pushes each audit event to the browser in real time
 * (Server-Sent Events over file-watch), so project state is watched as
 * work happens. Strictly read-only; the server binds loopback only, so
 * nothing leaves the machine.
 */
export class ServeCommand {
  /**
   * Attaches the `serve` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('serve')
      .description('Live local dashboard on localhost (real-time, read-only) — Ctrl+C to stop')
      .option('--port <n>', `Port to bind (default ${DEFAULT_PORT})`)
      .option('--host <h>', `Host to bind (default ${DEFAULT_HOST}, loopback only)`)
      .option('--no-open', 'Do not open the browser automatically')
      .option('--limit <n>', 'Recent-activity rows to backfill on load')
      .option('--window <dur>', 'Lookback for metrics and charts (e.g. 7d, 30d, 90d)')
      .action(async (options: ServeOptions) => {
        const port = parsePort(options.port);
        if (port === null) {
          process.stderr.write(`${pc.red('error:')} --port must be an integer in 1..65535\n`);
          process.exit(2);
        }
        const limit = parseLimit(options.limit);
        if (limit === null) {
          process.stderr.write(`${pc.red('error:')} --limit must be a positive integer\n`);
          process.exit(2);
        }
        const host = options.host ?? DEFAULT_HOST;
        // Enforce loopback here too, for a clear CLI message rather than a
        // raw exception from the server. The tool never binds off-box.
        if (!isLoopbackHost(host)) {
          process.stderr.write(
            `${pc.red('error:')} --host must be a loopback address (127.0.0.1, localhost or ::1)\n`,
          );
          process.exit(2);
        }
        const window = parseWindow(options.window);
        if (window === null) {
          process.stderr.write(
            `${pc.red('error:')} --window must be a duration like 7d, 24h, 30d\n`,
          );
          process.exit(2);
        }

        const context = openCliContext();
        let server: DashboardServer;
        try {
          server = await createDashboardServer({
            container: context.container,
            config: context.config,
            projectRoot: context.projectRoot,
            host,
            port,
            ...(limit !== undefined ? { limit } : {}),
            ...(window !== undefined ? { window } : {}),
          });
        } catch (error) {
          context.container.close();
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`${pc.red('error:')} could not start server: ${message}\n`);
          process.exit(1);
          return;
        }

        process.stdout.write(`${pc.green('▸')} live dashboard: ${pc.cyan(server.url)}\n`);
        process.stdout.write(`${pc.dim('  watching the trail — Ctrl+C to stop')}\n`);

        if (options.open !== false) openBrowser(server.url);

        // Graceful shutdown: stop the tail + SSE + HTTP, then release the
        // container. A hard timer guarantees exit even if a socket hangs.
        let shuttingDown = false;
        const shutdown = (signal: NodeJS.Signals): void => {
          if (shuttingDown) {
            // A second Ctrl+C means "I'm done waiting" — exit now instead of
            // silently ignoring it while a socket refuses to close.
            process.stdout.write(`\n${pc.dim('forced exit')}\n`);
            process.exit(0);
          }
          shuttingDown = true;
          const hard = setTimeout(() => process.exit(0), HARD_SHUTDOWN_MS);
          hard.unref();
          process.stdout.write(`\n${pc.dim(`received ${signal}, shutting down…`)}\n`);
          void server
            .close()
            .catch(() => {})
            .finally(() => {
              context.container.close();
              process.exit(0);
            });
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
      });
  }
}

/**
 * Parses `--port`: absent falls back to the default; an integer in
 * 1..65535 is honored; anything else (including 0, which would bind an
 * arbitrary ephemeral port and defeat the printed URL) is rejected.
 */
function parsePort(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_PORT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/**
 * Parses `--limit`: absent → `undefined` (server default); a plain decimal
 * positive integer → that number; anything else → `null` (rejected). The
 * decimal-only regex refuses hex/exponent that `Number()` would accept.
 */
export function parseLimit(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Parses `--window`: absent → `undefined` (server default); a relative
 * duration like `7d`/`24h`/`30d`/`15m` → the string; anything else →
 * `null`. Matches the durations AuditQuery/FlowMetrics accept.
 */
export function parseWindow(raw: string | undefined): string | undefined | null {
  if (raw === undefined) return undefined;
  return /^[0-9]+[smhd]$/.test(raw) ? raw : null;
}

/**
 * Opens the given URL in the platform's default browser, best-effort. A
 * failure is non-fatal — the server is already up and the URL was printed,
 * so the user can open it by hand. The child is detached and its output
 * ignored so it never holds the daemon open.
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Ignore — opening a browser is a convenience, not a requirement.
  }
}
