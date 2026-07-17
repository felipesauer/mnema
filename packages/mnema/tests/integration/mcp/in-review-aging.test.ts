import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '@mnema/core/config/config-schema.js';
import {
  createServiceContainer,
  type ServiceContainer,
} from '@mnema/core/services/service-container.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setupHarness(staleAfterDays?: number): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-aging-'));
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
    ...(staleAfterDays === undefined ? {} : { aging: { stale_after_days: staleAfterDays } }),
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });

  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'test-agent' });
  server.registerTools();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

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

function parsePayload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected text content');
  return JSON.parse(block.text) as Record<string, unknown>;
}

/** Backdate a task's `updated_at` directly in SQLite to simulate aging. */
function backdateTask(container: ServiceContainer, key: string, daysAgo: number): void {
  const iso = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  container.adapter
    .getDatabase()
    .prepare('UPDATE tasks SET updated_at = ? WHERE key = ?')
    .run(iso, key);
}

interface AgingPayload {
  stale_after_days: number;
  stale_tasks: { key: string; state: string; title: string; age_days: number }[];
}

describe('context_bootstrap IN_REVIEW aging', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'aging setup' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('surfaces a task aged past the threshold and omits a fresh one', async () => {
    // Aged task: created, then backdated 5 days (> default 3).
    const agedRes = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Stuck in limbo' },
    });
    const agedKey = (parsePayload(agedRes as CallToolResult).task as { key: string }).key;

    // Fresh task: stays at "now".
    await harness.client.callTool({ name: 'task_create', arguments: { title: 'Just created' } });

    backdateTask(harness.container, agedKey, 5);

    const bootstrap = await harness.client.callTool({
      name: 'context_bootstrap',
      arguments: {},
    });
    const aging = parsePayload(bootstrap as CallToolResult).aging as unknown as AgingPayload;

    expect(aging.stale_after_days).toBe(3);
    const keys = aging.stale_tasks.map((t) => t.key);
    expect(keys).toContain(agedKey);
    expect(keys).toHaveLength(1);

    const aged = aging.stale_tasks.find((t) => t.key === agedKey);
    expect(aged?.age_days).toBeGreaterThanOrEqual(5);
    expect(aged?.state).toBe('DRAFT');
  });

  it('excludes terminal-state tasks from aging even when old', async () => {
    // Drive a task to DONE, then backdate it well past the threshold.
    const created = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Finished long ago' },
    });
    const key = (parsePayload(created as CallToolResult).task as { key: string }).key;

    await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: key,
        title: 'Finished long ago',
        description: 'A task that has reached a terminal state.',
        acceptance_criteria: ['done'],
        estimate: 1,
      },
    });
    await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: key, assignee_id: 'daniel' },
    });
    await harness.client.callTool({
      name: 'task_submit_review',
      arguments: { task_key: key, pr_url: 'https://example.com/pr/1' },
    });
    await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'looks good' },
    });

    backdateTask(harness.container, key, 30);

    const bootstrap = await harness.client.callTool({
      name: 'context_bootstrap',
      arguments: {},
    });
    const aging = parsePayload(bootstrap as CallToolResult).aging as unknown as AgingPayload;

    // DONE is terminal — it must never appear in aging, no matter how old.
    expect(aging.stale_tasks.map((t) => t.key)).not.toContain(key);
  });

  it('honours a custom stale_after_days threshold', async () => {
    // A 2-day-old task does NOT surface under the default 3-day threshold.
    const created = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Two days old' },
    });
    const key = (parsePayload(created as CallToolResult).task as { key: string }).key;
    backdateTask(harness.container, key, 2);

    const defaultBootstrap = await harness.client.callTool({
      name: 'context_bootstrap',
      arguments: {},
    });
    const defaultAging = parsePayload(defaultBootstrap as CallToolResult)
      .aging as unknown as AgingPayload;
    expect(defaultAging.stale_after_days).toBe(3);
    expect(defaultAging.stale_tasks.map((t) => t.key)).not.toContain(key);

    // The same 2-day-old task DOES surface once the threshold drops to 1.
    await harness.close();
    harness = await setupHarness(1);
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'aging setup' } });
    const tightCreated = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Two days old, tight threshold' },
    });
    const tightKey = (parsePayload(tightCreated as CallToolResult).task as { key: string }).key;
    backdateTask(harness.container, tightKey, 2);

    const tightBootstrap = await harness.client.callTool({
      name: 'context_bootstrap',
      arguments: {},
    });
    const tightAging = parsePayload(tightBootstrap as CallToolResult)
      .aging as unknown as AgingPayload;
    expect(tightAging.stale_after_days).toBe(1);
    expect(tightAging.stale_tasks.map((t) => t.key)).toContain(tightKey);
  });
});
