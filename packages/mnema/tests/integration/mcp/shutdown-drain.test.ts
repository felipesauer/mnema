import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Config, ConfigSchema } from '@mnema/core/config/config-schema.js';
import { createServiceContainer } from '@mnema/core/services/service-container.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

/**
 * Graceful shutdown must drain in-flight tool calls: `waitInflight`
 * counts on every `tools/call` bracketing itself with trackStart/trackEnd
 * (in `wrapToolCallHandler`). Before that wiring, the counter stayed 0 and
 * shutdown returned instantly — a mid-write call was never awaited before
 * SQLite was flushed and closed.
 *
 * These tests register a latch-controlled tool that passes through the
 * real handler wrapper, then assert shutdown blocks until the latch
 * releases (proving the drain), and that a throwing handler still
 * decrements (so a failed call cannot wedge the drain).
 */
interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface DrainHarness {
  readonly server: MnemaMcpServer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

/** A minimal server harness plus a latch tool registered through the wrapper. */
async function setup(latch: {
  readonly started: Deferred;
  readonly release: Deferred;
  readonly throws?: boolean;
}): Promise<DrainHarness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-drain-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(projectRoot, '.mnema/workflows/default.json'),
  );
  const config: Config = ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'DRAIN', name: 'Drain Test' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });
  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'drain' });

  // Register the latch tool AFTER construction (the constructor already
  // installed wrapToolCallHandler), so this call routes through the exact
  // trackStart/finally-trackEnd bracket under test.
  server
    .getSdkServer()
    .registerTool('_latch', { description: 'test latch', inputSchema: {} }, async () => {
      latch.started.resolve();
      await latch.release.promise;
      if (latch.throws === true) throw new Error('latch handler failed on purpose');
      return { content: [{ type: 'text' as const, text: '{"ok":true}' }] };
    });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(serverTransport);
  const client = new Client({ name: 'drain-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    server,
    client,
    close: async () => {
      await client.close().catch(() => {});
      await sdk.close().catch(() => {});
      container.close();
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

/** Resolves true if `promise` settles before `ms`, false otherwise. */
function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
  ]);
}

describe('MCP graceful shutdown drains in-flight tool calls', () => {
  let harness: DrainHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it('does not complete shutdown until an in-flight call settles', async () => {
    const started = deferred();
    const release = deferred();
    harness = await setup({ started, release });

    // Fire the latch tool and do NOT await it yet — it will block inside
    // the handler on `release`.
    const call = harness.client.callTool({ name: '_latch', arguments: {} });
    await started.promise; // the handler is now inside the tracked bracket

    // Trigger shutdown; it must wait on waitInflight while the call is live.
    const shutdown = harness.server.shutdown('test');
    const finishedEarly = await settlesWithin(shutdown, 300);
    expect(finishedEarly).toBe(false); // still draining — this is the fix

    // Release the call; shutdown should now be able to complete.
    release.resolve();
    await call;
    const finishedAfterRelease = await settlesWithin(shutdown, 3_000);
    expect(finishedAfterRelease).toBe(true);
  });

  it('still decrements when the handler throws, so the drain is not wedged', async () => {
    const started = deferred();
    const release = deferred();
    harness = await setup({ started, release, throws: true });

    const call = harness.client.callTool({ name: '_latch', arguments: {} }).catch(() => {});
    await started.promise;

    const shutdown = harness.server.shutdown('test');
    expect(await settlesWithin(shutdown, 300)).toBe(false);

    release.resolve(); // handler now throws — the finally must still run trackEnd
    await call;
    expect(await settlesWithin(shutdown, 3_000)).toBe(true);
  });

  it('forces shutdown past the drain timeout when a call never settles', async () => {
    const started = deferred();
    const release = deferred(); // never resolved
    harness = await setup({ started, release });

    const call = harness.client.callTool({ name: '_latch', arguments: {} }).catch(() => {});
    await started.promise;

    // waitInflight caps at 3s; shutdown must complete despite the stuck call.
    const shutdown = harness.server.shutdown('test');
    expect(await settlesWithin(shutdown, 3_500)).toBe(true);

    release.resolve();
    await call;
  }, 6_000);
});
