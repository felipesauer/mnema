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

/** Boots a server whose IN_REVIEW SLA is 1 day. */
async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-ctx-sla-'));
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
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
    aging: { stale_after_days: 99, sla_days: { IN_REVIEW: 1 } },
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });
  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'test-agent' });
  server.registerTools();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(st);
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(ct);
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

function payload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected text content');
  return JSON.parse(block.text) as Record<string, unknown>;
}

interface AgingPayload {
  readonly sla_breaches: { key: string; state: string; sla_days: number }[];
}

describe('context_bootstrap surfaces SLA breaches (MNEMA-85)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'sla setup' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('reports an IN_REVIEW task past its 1-day SLA in aging.sla_breaches', async () => {
    // Create a task and drive it to IN_REVIEW (each transition carries the
    // fields its gate requires).
    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Needs review', acceptance_criteria: ['ships'] },
    });
    await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: 'TEST-1',
        title: 'Needs review',
        description: 'A task awaiting review.',
        acceptance_criteria: ['ships'],
        estimate: 1,
      },
    });
    await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: 'TEST-1', assignee_id: 'daniel' },
    });
    await harness.client.callTool({
      name: 'task_submit_review',
      arguments: { task_key: 'TEST-1', pr_url: 'https://example.com/pr/1' },
    });

    // Backdate updated_at 3 days (> the 1-day IN_REVIEW SLA).
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    harness.container.adapter
      .getDatabase()
      .prepare('UPDATE tasks SET updated_at = ? WHERE key = ?')
      .run(at, 'TEST-1');

    const bootstrap = (await harness.client.callTool({
      name: 'context_bootstrap',
      arguments: {},
    })) as CallToolResult;
    const aging = payload(bootstrap).aging as unknown as AgingPayload;

    const breach = aging.sla_breaches.find((b) => b.key === 'TEST-1');
    expect(breach).toBeDefined();
    expect(breach?.state).toBe('IN_REVIEW');
    expect(breach?.sla_days).toBe(1);
  });
});
