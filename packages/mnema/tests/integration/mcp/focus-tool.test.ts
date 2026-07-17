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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-focus-'));
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

interface FocusPayload {
  readonly line: string;
  readonly focus: 'resume' | 'start' | 'idle';
  readonly active_task: { key: string; title: string } | null;
  readonly next_task: { key: string; title: string } | null;
}

async function focus(harness: Harness): Promise<FocusPayload> {
  return payload(
    (await harness.client.callTool({ name: 'focus', arguments: {} })) as CallToolResult,
  ) as unknown as FocusPayload;
}

async function createReady(harness: Harness, title: string): Promise<string> {
  const created = payload(
    (await harness.client.callTool({
      name: 'task_create',
      arguments: { title, acceptance_criteria: ['ships'] },
    })) as CallToolResult,
  );
  const key = (created.task as { key: string }).key;
  await harness.client.callTool({
    name: 'task_submit',
    arguments: {
      task_key: key,
      title,
      description: `${title} — ready.`,
      acceptance_criteria: ['ships'],
      estimate: 1,
    },
  });
  return key;
}

describe('focus tool re-pulls the current focus in one line (MNEMA-224)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'focus setup' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('is idle with a helpful line when nothing is ready or in progress', async () => {
    const f = await focus(harness);
    expect(f.focus).toBe('idle');
    expect(f.active_task).toBeNull();
    expect(f.next_task).toBeNull();
    expect(f.line.length).toBeGreaterThan(0);
  });

  it('points at the next task to start when one is ready', async () => {
    const key = await createReady(harness, 'Wire the notifier');
    const f = await focus(harness);
    expect(f.focus).toBe('start');
    expect(f.next_task).toEqual({ key, title: 'Wire the notifier' });
    expect(f.line).toContain(key);
    expect(f.line).toContain('task_start');
  });

  it('tells the agent to resume the task it already has in progress', async () => {
    const key = await createReady(harness, 'Half-done work');
    await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: key, assignee_id: 'daniel' },
    });
    // A competing ready task must not steal focus from work in progress.
    await createReady(harness, 'Shiny new thing');

    const f = await focus(harness);
    expect(f.focus).toBe('resume');
    expect(f.active_task).toEqual({ key, title: 'Half-done work' });
    expect(f.line).toContain(key);
    expect(f.line.toLowerCase()).toContain('resume');
  });
});
