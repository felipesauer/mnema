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

/**
 * `agent_run_end` nudges the agent to record what it learned when a
 * completed run captured nothing durable, and stays silent otherwise.
 */
const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-nudge-'));
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

describe('agent_run_end knowledge nudge', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  async function startRun(): Promise<void> {
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'do some work' } });
  }

  it('reminds when a completed run recorded nothing durable', async () => {
    await startRun();
    const ended = payload(
      (await harness.client.callTool({
        name: 'agent_run_end',
        arguments: { status: 'completed' },
      })) as CallToolResult,
    );
    expect(ended.reminder).toBeDefined();
    expect(String(ended.reminder)).toContain('skill_record');
  });

  it('stays silent when the run recorded a memory', async () => {
    await startRun();
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'a-fact', title: 'A fact', content: 'something durable' },
    });
    const ended = payload(
      (await harness.client.callTool({
        name: 'agent_run_end',
        arguments: { status: 'completed' },
      })) as CallToolResult,
    );
    expect(ended.reminder).toBeUndefined();
  });

  it('stays silent when the run recorded an observation', async () => {
    await startRun();
    await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'a passing signal worth noting later' },
    });
    const ended = payload(
      (await harness.client.callTool({
        name: 'agent_run_end',
        arguments: { status: 'completed' },
      })) as CallToolResult,
    );
    expect(ended.reminder).toBeUndefined();
  });

  it('does not nudge a failed run (nothing to celebrate)', async () => {
    await startRun();
    const ended = payload(
      (await harness.client.callTool({
        name: 'agent_run_end',
        arguments: { status: 'failed', error: 'gave up' },
      })) as CallToolResult,
    );
    expect(ended.reminder).toBeUndefined();
  });
});
