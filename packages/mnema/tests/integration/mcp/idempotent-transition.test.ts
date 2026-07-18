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
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-idem-'));
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
  const container: ServiceContainer = createServiceContainer(config, projectRoot, {
    migrationsDir,
  });
  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'test-agent' });
  server.registerTools();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(st);
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(ct);
  return {
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

describe('idempotent transitions (MNEMA-241)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'idem setup' } });
    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Retry target', acceptance_criteria: ['done'] },
    });
    await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: 'TEST-1',
        title: 'Retry target',
        description: 'a task to retry the start on',
        acceptance_criteria: ['done'],
        estimate: 2,
      },
    });
    await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: 'TEST-1', assignee_id: 'daniel' },
    });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('a repeated task_start returns a no_op success, not INVALID_TRANSITION', async () => {
    const retry = (await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: 'TEST-1', assignee_id: 'daniel' },
    })) as CallToolResult;

    expect(retry.isError ?? false).toBe(false);
    const body = payload(retry);
    expect(body.no_op).toBe(true);
    expect(String(body.note)).toContain('IN_PROGRESS');
  });

  it('a genuinely invalid action still errors', async () => {
    // From IN_PROGRESS, `submit` is not valid and does not target IN_PROGRESS.
    const bad = (await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: 'TEST-1',
        title: 'Retry target',
        description: 'a task to retry the start on',
        acceptance_criteria: ['done'],
        estimate: 2,
      },
    })) as CallToolResult;
    expect(bad.isError ?? false).toBe(true);
  });
});
