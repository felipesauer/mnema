import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Config, ConfigSchema } from '@mnema/core/config/config-schema.js';
import {
  createServiceContainer,
  type ServiceContainer,
} from '@mnema/core/services/service-container.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

/**
 * shutdown() arms a 5s watchdog that force-exits with code 1 if the drain
 * hangs. On the clean path the watchdog must be disarmed — otherwise its
 * pending process.exit(1) still fires later (turning a graceful shutdown
 * into a non-zero exit) whenever something keeps the loop alive past the
 * timeout. This is exactly what leaked into the suite as an intermittent
 * unhandled process.exit(1).
 */
interface Built {
  readonly server: MnemaMcpServer;
  readonly cleanup: () => void;
}

function build(): Built {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-watchdog-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(projectRoot, '.mnema/workflows/default.json'),
  );
  const config: Config = ConfigSchema.parse({
    version: '2.0',
    mnema_version: '^0.1.0',
    project: { key: 'WD', name: 'Watchdog Test' },
    workflow: 'default',
  });
  const container: ServiceContainer = createServiceContainer(config, projectRoot, {
    migrationsDir,
  });
  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'wd' });
  return {
    server,
    cleanup: () => {
      container.close();
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

describe('MCP graceful-shutdown watchdog', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup?.();
    cleanup = undefined;
  });

  it('does not force-exit after a clean shutdown, even past the hard timeout', async () => {
    const built = build();
    cleanup = built.cleanup;

    // Connect a transport so sdk.close() has something to tear down.
    const [, serverTransport] = InMemoryTransport.createLinkedPair();
    await built.server.getSdkServer().connect(serverTransport);

    // process.exit must never run on the clean path — stub it so a stray
    // call is observable rather than killing the test worker.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as (code?: number) => never);

    // Fake timers BEFORE shutdown so the watchdog's setTimeout is a fake
    // one we can later advance. The drain has no in-flight calls, so
    // waitInflight returns without ever awaiting a timer, and the awaited
    // sdk/container closes are promise-based (unaffected by fake timers).
    vi.useFakeTimers();
    await built.server.shutdown('test');

    // Advance well past HARD_SHUTDOWN_MS (5s). With the fix the watchdog was
    // cleared on the clean path, so nothing fires; without it, process.exit(1).
    await vi.advanceTimersByTimeAsync(10_000);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('a second shutdown still force-exits (guard path is unaffected)', async () => {
    const built = build();
    cleanup = built.cleanup;
    const [, serverTransport] = InMemoryTransport.createLinkedPair();
    await built.server.getSdkServer().connect(serverTransport);

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as (code?: number) => never);

    await built.server.shutdown('first'); // sets shuttingDown = true
    await built.server.shutdown('second'); // hits the already-shutting-down guard

    // The guard path force-exits immediately with code 1.
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
