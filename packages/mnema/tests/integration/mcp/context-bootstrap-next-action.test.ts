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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-ctx-next-'));
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

interface NextAction {
  readonly focus: 'resume' | 'start' | 'unblock' | 'idle';
  readonly recommended: string;
  readonly ready_count: number;
  readonly top_ready_task: { key: string; title: string } | null;
  readonly in_progress_task: { key: string; title: string } | null;
  readonly blocker_count: number;
}

async function bootstrapNextAction(harness: Harness): Promise<NextAction> {
  const bootstrap = (await harness.client.callTool({
    name: 'context_bootstrap',
    arguments: {},
  })) as CallToolResult;
  return payload(bootstrap).next_action as unknown as NextAction;
}

/** Drives a fresh task all the way to READY under the default workflow. */
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
      description: `${title} — ready to pick up.`,
      acceptance_criteria: ['ships'],
      estimate: 1,
    },
  });
  return key;
}

describe('context_bootstrap.next_action tells the agent what to do now (MNEMA-222)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'next-action setup' },
    });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('is idle when the backlog is empty', async () => {
    const na = await bootstrapNextAction(harness);
    expect(na.focus).toBe('idle');
    expect(na.ready_count).toBe(0);
    expect(na.top_ready_task).toBeNull();
    expect(na.in_progress_task).toBeNull();
    expect(na.blocker_count).toBe(0);
  });

  it('recommends starting the single READY task, pointing at it', async () => {
    const key = await createReady(harness, 'Wire the notifier');

    const na = await bootstrapNextAction(harness);
    expect(na.focus).toBe('start');
    expect(na.ready_count).toBe(1);
    expect(na.top_ready_task).toEqual({ key, title: 'Wire the notifier' });
    expect(na.recommended).toContain(key);
  });

  it('recommends a stable single READY task when several compete', async () => {
    // With no priority to rank on, the recommendation settles to a stable
    // order (by committed id). The contract the agent relies on is that it is
    // deterministic and points at one of the ready tasks — not which wins.
    const firstKey = await createReady(harness, 'First ready');
    const secondKey = await createReady(harness, 'Second ready');

    const na = await bootstrapNextAction(harness);
    expect(na.focus).toBe('start');
    expect(na.ready_count).toBe(2);
    expect([firstKey, secondKey]).toContain(na.top_ready_task?.key);
    // Deterministic: a second read returns the same pick.
    const again = await bootstrapNextAction(harness);
    expect(again.top_ready_task?.key).toBe(na.top_ready_task?.key);
  });

  it('prefers resuming an IN_PROGRESS task over starting a new READY one', async () => {
    // One task the actor is already working on.
    const active = await createReady(harness, 'Half-done work');
    await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: active, assignee_id: 'daniel' },
    });
    // And a fresh READY task competing for attention.
    await createReady(harness, 'Shiny new thing');

    const na = await bootstrapNextAction(harness);
    expect(na.focus).toBe('resume');
    expect(na.in_progress_task).toEqual({ key: active, title: 'Half-done work' });
    expect(na.recommended).toContain(active);
    // The ready one is still counted, just not the recommendation.
    expect(na.ready_count).toBe(1);
  });
});
