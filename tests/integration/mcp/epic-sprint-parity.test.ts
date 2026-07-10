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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-parity-'));
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

async function call(client: Client, name: string, args: Record<string, unknown>) {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

describe('epic/sprint lifecycle MCP parity', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'parity' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('registers every new lifecycle tool', async () => {
    const names = new Set((await harness.client.listTools()).tools.map((t) => t.name));
    for (const n of [
      'epic_close',
      'epic_remove',
      'sprint_start',
      'sprint_close',
      'sprint_remove',
      'sprint_metric',
    ]) {
      expect(names, `expected ${n} to be registered`).toContain(n);
    }
  });

  it('epic_add_task → epic_remove → epic_close round-trips via MCP', async () => {
    const epic = parsePayload(await call(harness.client, 'epic_create', { title: 'Parity epic' }))
      .epic as { key: string };
    const task = parsePayload(await call(harness.client, 'task_create', { title: 'A task' }))
      .task as { key: string };

    await call(harness.client, 'epic_add_task', { epic_key: epic.key, task_key: task.key });
    const removed = await call(harness.client, 'epic_remove', {
      epic_key: epic.key,
      task_key: task.key,
    });
    expect(removed.isError).toBeFalsy();

    const closed = await call(harness.client, 'epic_close', { epic_key: epic.key });
    expect(closed.isError).toBeFalsy();
    expect((parsePayload(closed).epic as { state: string }).state).toBe('CLOSED');
  });

  it('sprint_start → sprint_metric → sprint_remove → sprint_close round-trips via MCP', async () => {
    const sprint = parsePayload(
      await call(harness.client, 'sprint_create', { name: 'Parity sprint' }),
    ).sprint as { key: string };
    const task = parsePayload(await call(harness.client, 'task_create', { title: 'Sprint task' }))
      .task as { key: string };
    await call(harness.client, 'sprint_add_task', { sprint_key: sprint.key, task_key: task.key });

    const started = await call(harness.client, 'sprint_start', { sprint_key: sprint.key });
    expect(started.isError).toBeFalsy();
    expect((parsePayload(started).sprint as { state: string }).state).toBe('ACTIVE');

    const metric = await call(harness.client, 'sprint_metric', {
      sprint_key: sprint.key,
      name: 'p95 latency',
      target: 200,
      unit: 'ms',
    });
    expect(metric.isError).toBeFalsy();
    expect((parsePayload(metric).metric as { name: string }).name).toBe('p95 latency');

    const removed = await call(harness.client, 'sprint_remove', {
      sprint_key: sprint.key,
      task_key: task.key,
    });
    expect(removed.isError).toBeFalsy();

    const closed = await call(harness.client, 'sprint_close', { sprint_key: sprint.key });
    expect(closed.isError).toBeFalsy();
    expect((parsePayload(closed).sprint as { state: string }).state).toBe('CLOSED');
  });

  it('a lifecycle mutation without an active run is rejected', async () => {
    const epic = parsePayload(await call(harness.client, 'epic_create', { title: 'No-run epic' }))
      .epic as { key: string };
    await harness.client.callTool({ name: 'agent_run_end', arguments: { status: 'completed' } });

    const closed = await call(harness.client, 'epic_close', { epic_key: epic.key });
    expect(closed.isError).toBe(true);
    expect(parsePayload(closed).error).toBe('NO_ACTIVE_RUN');
  });

  // Domain precondition errors — one per lifecycle tool, asserting the
  // specific structured error code (not just the cross-cutting run guard).

  it('epic_close on an already-closed epic returns EPIC_INVALID_STATE', async () => {
    const epic = parsePayload(await call(harness.client, 'epic_create', { title: 'Twice closed' }))
      .epic as { key: string };
    await call(harness.client, 'epic_close', { epic_key: epic.key });
    const again = await call(harness.client, 'epic_close', { epic_key: epic.key });
    expect(again.isError).toBe(true);
    expect(parsePayload(again).error).toBe('EPIC_INVALID_STATE');
  });

  it('epic_remove with a non-existent task returns TASK_NOT_FOUND', async () => {
    const epic = parsePayload(await call(harness.client, 'epic_create', { title: 'Holder' }))
      .epic as { key: string };
    const result = await call(harness.client, 'epic_remove', {
      epic_key: epic.key,
      task_key: 'TEST-9999',
    });
    expect(result.isError).toBe(true);
    expect(parsePayload(result).error).toBe('TASK_NOT_FOUND');
  });

  it('sprint_start on an already-active sprint returns SPRINT_INVALID_STATE', async () => {
    const sprint = parsePayload(await call(harness.client, 'sprint_create', { name: 'Live once' }))
      .sprint as { key: string };
    await call(harness.client, 'sprint_start', { sprint_key: sprint.key }); // PLANNED → ACTIVE
    const again = await call(harness.client, 'sprint_start', { sprint_key: sprint.key });
    expect(again.isError).toBe(true);
    expect(parsePayload(again).error).toBe('SPRINT_INVALID_STATE');
  });

  it('sprint_close on a PLANNED (never-started) sprint returns SPRINT_INVALID_STATE', async () => {
    const sprint = parsePayload(await call(harness.client, 'sprint_create', { name: 'Never live' }))
      .sprint as { key: string };
    const result = await call(harness.client, 'sprint_close', { sprint_key: sprint.key });
    expect(result.isError).toBe(true);
    expect(parsePayload(result).error).toBe('SPRINT_INVALID_STATE');
  });

  it('sprint_remove with a non-existent task returns TASK_NOT_FOUND', async () => {
    const sprint = parsePayload(await call(harness.client, 'sprint_create', { name: 'Holder' }))
      .sprint as { key: string };
    const result = await call(harness.client, 'sprint_remove', {
      sprint_key: sprint.key,
      task_key: 'TEST-9999',
    });
    expect(result.isError).toBe(true);
    expect(parsePayload(result).error).toBe('TASK_NOT_FOUND');
  });

  it('sprint_metric with a duplicate name returns SPRINT_METRIC_DUPLICATE', async () => {
    const sprint = parsePayload(await call(harness.client, 'sprint_create', { name: 'Measured' }))
      .sprint as { key: string };
    const metric = { sprint_key: sprint.key, name: 'p95 latency', target: 200 };
    await call(harness.client, 'sprint_metric', metric);
    const dup = await call(harness.client, 'sprint_metric', metric);
    expect(dup.isError).toBe(true);
    expect(parsePayload(dup).error).toBe('SPRINT_METRIC_DUPLICATE');
  });

  it('epic_update edits an epic description via MCP', async () => {
    const epic = parsePayload(
      await call(harness.client, 'epic_create', { title: 'Editable epic', description: 'before' }),
    ).epic as { key: string };
    const updated = await call(harness.client, 'epic_update', {
      epic_key: epic.key,
      description: 'after',
    });
    expect(updated.isError).toBeFalsy();
    expect((parsePayload(updated).epic as { description: string }).description).toBe('after');
  });

  it('task_update edits a task title via MCP', async () => {
    const task = parsePayload(await call(harness.client, 'task_create', { title: 'Before title' }))
      .task as { key: string };
    const updated = await call(harness.client, 'task_update', {
      task_key: task.key,
      title: 'After title',
    });
    expect(updated.isError).toBeFalsy();
    expect((parsePayload(updated).task as { title: string }).title).toBe('After title');
  });

  it('epic_delete removes an epic; deleting one with a task returns EPIC_HAS_TASKS', async () => {
    const empty = parsePayload(await call(harness.client, 'epic_create', { title: 'Empty epic' }))
      .epic as { key: string };
    const gone = await call(harness.client, 'epic_delete', { epic_key: empty.key });
    expect(gone.isError).toBeFalsy();
    const shown = await call(harness.client, 'epic_show', { epic_key: empty.key });
    expect(shown.isError).toBe(true);
    expect(parsePayload(shown).error).toBe('EPIC_NOT_FOUND');

    const held = parsePayload(await call(harness.client, 'epic_create', { title: 'Held epic' }))
      .epic as { key: string };
    const task = parsePayload(await call(harness.client, 'task_create', { title: 'Held task' }))
      .task as { key: string };
    await call(harness.client, 'epic_add_task', { epic_key: held.key, task_key: task.key });
    const refused = await call(harness.client, 'epic_delete', { epic_key: held.key });
    expect(refused.isError).toBe(true);
    expect(parsePayload(refused).error).toBe('EPIC_HAS_TASKS');
  });
});
