import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ConfigSchema } from '../src/config/config-schema.js';
import { MnemaMcpServer } from '../src/mcp/mcp-server.js';
import {
  createServiceContainer,
  type ServiceContainer,
} from '../src/services/service-container.js';

/**
 * In-process MCP benchmark — measures the cold and warm latency of
 * `task_create`, the canonical mutating tool agents call from every
 * run. Mirrors the targets in ARCHITECTURE.md §15:
 *
 *   - Cold (first call): 200ms
 *   - Warm (steady state): 20ms
 *
 * "Cold" includes container boot + workflow load + first SQLite
 * statement preparation; "warm" is a steady-state call after the
 * server has handled at least one request.
 *
 * The harness uses `InMemoryTransport` so the measurement is fair
 * across machines — spawn cost is excluded by design (unlike
 * `cli-bench.ts`).
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(repoRoot, 'src/storage/sqlite/migrations');
const workflowsSrc = path.join(repoRoot, 'workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setupHarness(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-mcp-bench-'));
  for (const dir of ['.app', '.audit', 'backlog', 'workflows']) {
    mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(projectRoot, 'workflows', 'default.json'),
  );

  const config = ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'BNCH', name: 'Bench Project' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });
  container.adapter
    .getDatabase()
    .prepare("INSERT INTO projects (id, key, name) VALUES ('p1', 'BNCH', 'Bench')")
    .run();

  const server = new MnemaMcpServer(config, projectRoot, container, {
    agent_handle: 'bench',
  });
  server.registerTools();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const sdk = server.getSdkServer();
  await sdk.connect(serverTransport);

  const client = new Client({ name: 'bench', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  // task_create requires an active agent run.
  await client.callTool({ name: 'agent_run_start', arguments: { goal: 'bench' } });

  return {
    container,
    client,
    close: async () => {
      await client.close();
      await sdk.close();
      container.close();
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

async function timeAsync(fn: () => Promise<unknown>): Promise<number> {
  const start = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

interface BenchResult {
  readonly name: string;
  readonly elapsedMs: number;
  readonly budgetMs: number;
}

async function run(): Promise<void> {
  process.env.MNEMA_ACTOR = 'bench';
  const harness = await setupHarness();

  const results: BenchResult[] = [];

  try {
    // Cold: first call after the run is started. Boot cost is
    // already amortised in setupHarness, so what we measure here is
    // the first prepared statement + first markdown write — still
    // fairer than including spawn.
    const coldMs = await timeAsync(() =>
      harness.client.callTool({
        name: 'task_create',
        arguments: { title: 'Cold call' },
      }),
    );
    results.push({ name: 'task_create (cold)', elapsedMs: coldMs, budgetMs: 200 });

    // Warm: median over 20 consecutive calls. Picks the middle of a
    // sorted set so single outliers (GC pause, FS hiccup) don't fail
    // the budget.
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const ms = await timeAsync(() =>
        harness.client.callTool({
          name: 'task_create',
          arguments: { title: `Warm call ${i}` },
        }),
      );
      samples.push(ms);
    }
    samples.sort((a, b) => a - b);
    const warmMs = samples[Math.floor(samples.length / 2)] ?? Number.NaN;
    results.push({ name: 'task_create (warm, median of 20)', elapsedMs: warmMs, budgetMs: 20 });
  } finally {
    await harness.close();
  }

  process.stdout.write('Mnema MCP bench — budgets from ARCHITECTURE.md §15\n');
  process.stdout.write('---------------------------------------------------\n');
  let failed = 0;
  for (const r of results) {
    const ok = r.elapsedMs <= r.budgetMs;
    const mark = ok ? '✓' : '✗';
    process.stdout.write(
      `${mark} ${r.name.padEnd(34)} ${r.elapsedMs.toFixed(1).padStart(6)}ms / ${r.budgetMs}ms\n`,
    );
    if (!ok) failed += 1;
  }
  process.stdout.write('---------------------------------------------------\n');
  if (failed > 0) {
    process.stderr.write(`${failed} budget(s) exceeded.\n`);
    process.exit(1);
  }
}

run().catch((err) => {
  process.stderr.write(
    `bench: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
