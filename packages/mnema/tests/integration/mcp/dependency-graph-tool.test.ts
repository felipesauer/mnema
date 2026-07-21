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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-graph-'));
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

describe('graph_dependencies MCP tool', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'graph test' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('returns the project graph with a critical path over a blocks-chain', async () => {
    // Create A, B and declare B depends on A (A blocks B).
    const createA = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Task A' },
    })) as CallToolResult;
    const createB = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Task B' },
    })) as CallToolResult;
    const idA = (payload(createA).task as { id: string }).id;
    const idB = (payload(createB).task as { id: string }).id;
    await harness.client.callTool({
      name: 'task_depends_on',
      arguments: { task_key: idB, blocks_task_key: idA },
    });

    const res = (await harness.client.callTool({
      name: 'graph_dependencies',
      arguments: {},
    })) as CallToolResult;
    const g = payload(res).graph as {
      cycles: unknown[];
      criticalPath: string[];
      frontier: { ready: string[] };
    };
    expect(g.cycles).toEqual([]);
    expect(g.criticalPath).toEqual([deriveAlias('task', idA), deriveAlias('task', idB)]);
  });

  it('rejects passing both epic_key and sprint_key', async () => {
    const res = (await harness.client.callTool({
      name: 'graph_dependencies',
      arguments: { epic_key: 'E-1', sprint_key: 'S-1' },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });
});
