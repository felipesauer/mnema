import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '@mnema/core/config/config-schema.js';
import { deriveAlias } from '@mnema/core/domain/entity-alias.js';
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

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-labelroll-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(projectRoot, '.mnema/workflows', 'default.json'),
  );
  const config = ConfigSchema.parse({
    version: '2.0',
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

// A label the zod schema accepts (min length 1) but the LabelService rejects
// (commas are ambiguous on the CLI). This is exactly the "zod accepts, service
// rejects" case that used to persist the task then fail the label apply.
const BAD_LABEL = 'a,b';

describe('task_create is all-or-nothing on a bad inline label', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'label rollback test' },
    });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('task_create with a bad inline label leaves NO task and returns an error', async () => {
    const res = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Should not persist', labels: [BAD_LABEL] },
    })) as CallToolResult;

    // The tool refuses…
    expect(res.isError).toBe(true);
    // …and, crucially, no task was persisted (the guard precedes the insert).
    const list = (await harness.client.callTool({
      name: 'tasks_list',
      arguments: {},
    })) as CallToolResult;
    expect((payload(list).tasks as unknown[]).length).toBe(0);
  });

  it('task_create returns the alias when a valid label is applied', async () => {
    const res = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Born labelled', labels: ['area:api'] },
    })) as CallToolResult;
    expect(res.isError ?? false).toBe(false);
    const task = payload(res).task as { id: string; key: string };
    expect(task.key).toBe(deriveAlias('task', task.id));
  });

  it('task_create_many counts a bad-label item as failed and never persists it', async () => {
    const res = (await harness.client.callTool({
      name: 'task_create_many',
      arguments: {
        tasks: [
          { title: 'Good one', labels: ['area:api'] },
          { title: 'Bad label item', labels: [BAD_LABEL] },
          { title: 'Another good one' },
        ],
      },
    })) as CallToolResult;

    const result = payload(res) as {
      created_count: number;
      failed_count: number;
      created: { key: string }[];
      failed: { index: number }[];
    };
    // Two persisted, one refused up front.
    expect(result.created_count).toBe(2);
    expect(result.failed_count).toBe(1);
    expect(result.failed[0]?.index).toBe(1);

    // The DB agrees: exactly the two good tasks exist — the bad-label item
    // never landed, so counts can't drift from what was persisted.
    const list = (await harness.client.callTool({
      name: 'tasks_list',
      arguments: {},
    })) as CallToolResult;
    const aliases = (payload(list).tasks as { id: string }[])
      .map((t) => deriveAlias('task', t.id))
      .sort();
    expect(aliases).toEqual(result.created.map((t) => t.key).sort());
    expect(aliases).toHaveLength(2);
  });
});
