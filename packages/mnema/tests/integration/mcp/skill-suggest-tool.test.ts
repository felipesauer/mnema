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

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-skillsuggest-'));
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

describe('skill_suggest MCP tool', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('suggests a skill whose text overlaps the task', async () => {
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'seed' } });
    await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 'oauth-setup',
        name: 'OAuth setup',
        description: 'How to wire an OAuth login flow',
        content: 'Steps to configure OAuth authentication and the callback route.',
      },
    });
    await harness.client.callTool({
      name: 'task_create',
      arguments: {
        title: 'Implement OAuth login',
        description: 'Add the Google OAuth authentication flow',
        acceptance_criteria: ['users authenticate'],
      },
    });

    const res = (await harness.client.callTool({
      name: 'skill_suggest',
      arguments: { task_key: 'TEST-1' },
    })) as CallToolResult;
    const suggestions = payload(res).suggestions as { key: string | null; entity: string }[];

    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.every((s) => s.entity === 'skill')).toBe(true);
    expect(suggestions.some((s) => s.key === 'oauth-setup')).toBe(true);
  });

  it('returns an empty list when nothing overlaps', async () => {
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'seed' } });
    await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 'db-migrations',
        name: 'DB migrations',
        description: 'Writing forward-only SQLite migrations',
        content: 'Add a numbered SQL file and register the version.',
      },
    });
    await harness.client.callTool({
      name: 'task_create',
      arguments: {
        title: 'Redesign the marketing homepage',
        description: 'New hero copy and imagery',
        acceptance_criteria: ['approved by design'],
      },
    });

    const res = (await harness.client.callTool({
      name: 'skill_suggest',
      arguments: { task_key: 'TEST-1' },
    })) as CallToolResult;
    expect((payload(res).suggestions as unknown[]).length).toBe(0);
  });

  it('errors on an unknown task key', async () => {
    const res = (await harness.client.callTool({
      name: 'skill_suggest',
      arguments: { task_key: 'TEST-999' },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });
});
