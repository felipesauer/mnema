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
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setupHarness(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-verbosity-'));
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
  });
  const container: ServiceContainer = createServiceContainer(config, projectRoot, {
    migrationsDir,
  });

  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'test-agent' });
  server.registerTools();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

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

function parsePayload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected text content');
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe('observation length signal + mutation verbosity', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'verbosity' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('rejects an over-limit observation with an actionable message naming the overflow', async () => {
    const content = 'x'.repeat(2050);
    const result = (await harness.client.callTool({
      name: 'observation_record',
      arguments: { content },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload.error).toBe('VALIDATION_FAILED');
    // The message must name the actual length and the overflow so the
    // agent can act (split the note) without guessing the cap.
    const message = JSON.stringify(payload);
    expect(message).toContain('2050');
    expect(message).toContain('50');
    expect(message.toLowerCase()).toContain('split');
  });

  it('accepts an observation at the limit', async () => {
    const content = 'y'.repeat(2000);
    const result = (await harness.client.callTool({
      name: 'observation_record',
      arguments: { content },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(parsePayload(result).ok).toBe(true);
  });

  it('task_create returns the full task by default and a compact task under compact verbosity', async () => {
    const full = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Full echo task', description: 'a long-ish description here' },
    })) as CallToolResult;
    const fullTask = parsePayload(full).task as Record<string, unknown>;
    // Full echo carries the rich fields.
    expect(fullTask.description).toBe('a long-ish description here');
    expect(fullTask).toHaveProperty('acceptanceCriteria');

    const compact = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Compact echo task', verbosity: 'compact' },
    })) as CallToolResult;
    const compactTask = parsePayload(compact).task as Record<string, unknown>;
    // Compact echo carries only the confirmation fields.
    expect(Object.keys(compactTask).sort()).toEqual(['key', 'state', 'updatedAt']);
  });

  it('task_create_many honours compact verbosity for every created task', async () => {
    const full = (await harness.client.callTool({
      name: 'task_create_many',
      arguments: { tasks: [{ title: 'Batch one' }, { title: 'Batch two' }] },
    })) as CallToolResult;
    const fullCreated = parsePayload(full).created as Record<string, unknown>[];
    expect(fullCreated).toHaveLength(2);
    expect(fullCreated[0]).toHaveProperty('acceptanceCriteria');

    const compact = (await harness.client.callTool({
      name: 'task_create_many',
      arguments: {
        tasks: [{ title: 'Lean one' }, { title: 'Lean two' }],
        verbosity: 'compact',
      },
    })) as CallToolResult;
    const compactCreated = parsePayload(compact).created as Record<string, unknown>[];
    expect(compactCreated).toHaveLength(2);
    for (const t of compactCreated) {
      expect(Object.keys(t).sort()).toEqual(['key', 'state', 'updatedAt']);
    }
  });

  it('transition tools honour compact verbosity', async () => {
    const created = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Task to submit' },
    })) as CallToolResult;
    const key = (parsePayload(created).task as { key: string }).key;

    const submitted = (await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: key,
        title: 'Task to submit',
        description: 'A description long enough to pass the readiness gate.',
        acceptance_criteria: ['works'],
        estimate: 3,
        verbosity: 'compact',
      },
    })) as CallToolResult;
    const task = parsePayload(submitted).task as Record<string, unknown>;
    expect(Object.keys(task).sort()).toEqual(['key', 'state', 'updatedAt']);
    expect(task.state).toBe('READY');
  });
});
