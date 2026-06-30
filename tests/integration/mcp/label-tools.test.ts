import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-labels-'));
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

function payload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected text content');
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe('label MCP tools', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'label test' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  /** Creates a task and returns its key. */
  async function createTask(title: string): Promise<string> {
    const res = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title },
    })) as CallToolResult;
    return (payload(res).task as { key: string }).key;
  }

  it('task_set_labels sets and replaces a task label set', async () => {
    const key = await createTask('Labelled task');

    const first = (await harness.client.callTool({
      name: 'task_set_labels',
      arguments: { task_key: key, labels: ['tipo:bug', 'area:api'] },
    })) as CallToolResult;
    expect(payload(first).labels).toEqual(['area:api', 'tipo:bug']);

    // Replaces, not appends.
    const second = (await harness.client.callTool({
      name: 'task_set_labels',
      arguments: { task_key: key, labels: ['area:web'] },
    })) as CallToolResult;
    expect(payload(second).labels).toEqual(['area:web']);
  });

  it('task_labels lists a task labels (read-only, no run needed conceptually)', async () => {
    const key = await createTask('Read labels');
    await harness.client.callTool({
      name: 'task_set_labels',
      arguments: { task_key: key, labels: ['area:api'] },
    });
    const res = (await harness.client.callTool({
      name: 'task_labels',
      arguments: { task_key: key },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ task_key: key, labels: ['area:api'] });
  });

  it('task_create accepts labels inline at creation', async () => {
    const res = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Born labelled', labels: ['area:api', 'tipo:bug'] },
    })) as CallToolResult;
    const key = (payload(res).task as { key: string }).key;

    const labels = (await harness.client.callTool({
      name: 'task_labels',
      arguments: { task_key: key },
    })) as CallToolResult;
    expect(payload(labels).labels).toEqual(['area:api', 'tipo:bug']);
  });

  it('labels_list returns the catalogue with per-label counts', async () => {
    const a = await createTask('Task A');
    const b = await createTask('Task B');
    await harness.client.callTool({
      name: 'task_set_labels',
      arguments: { task_key: a, labels: ['area:api', 'tipo:bug'] },
    });
    await harness.client.callTool({
      name: 'task_set_labels',
      arguments: { task_key: b, labels: ['area:api'] },
    });

    const res = (await harness.client.callTool({
      name: 'labels_list',
      arguments: {},
    })) as CallToolResult;
    expect(payload(res).labels).toEqual([
      { name: 'area:api', count: 2 },
      { name: 'tipo:bug', count: 1 },
    ]);
  });

  it('task_set_labels rejects an invalid label name (comma)', async () => {
    const key = await createTask('Bad label');
    const res = (await harness.client.callTool({
      name: 'task_set_labels',
      arguments: { task_key: key, labels: ['a,b'] },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });
});
