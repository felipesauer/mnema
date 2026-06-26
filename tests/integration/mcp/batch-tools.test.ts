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
 * Covers the best-effort batch tools (report item #10) and the ADR
 * acceptance tool (#11) end-to-end over a real in-memory MCP client.
 * Batch tools never reject the whole call for one bad item: they return
 * `{ created/added/linked, failed: [{ index, error }] }`.
 */
const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-batch-'));
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

describe('batch + decision MCP tools', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    // Batch writes need an active run.
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'batch test' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('task_create_many creates every valid task and reports per-item failures', async () => {
    const result = (await harness.client.callTool({
      name: 'task_create_many',
      arguments: {
        tasks: [
          { title: 'First task' },
          { title: 'Second task', estimate: 3 },
          // Unknown assignee — this one must fail without sinking the others.
          { title: 'Third task', assignee: 'ghost' },
        ],
      },
    })) as CallToolResult;

    const body = payload(result);
    expect(body.ok).toBe(true);
    expect(body.created_count).toBe(2);
    expect(body.failed_count).toBe(1);
    const failed = body.failed as Array<{ index: number; error: { kind: string } }>;
    expect(failed[0]?.index).toBe(2);
    expect(failed[0]?.error.kind).toBe('UNKNOWN_ASSIGNEE');
  });

  it('sprint_add_tasks attaches the tasks that exist and flags the rest', async () => {
    const created = payload(
      (await harness.client.callTool({
        name: 'task_create',
        arguments: { title: 'Sprint candidate' },
      })) as CallToolResult,
    );
    const taskKey = (created.task as { key: string }).key;

    const sprint = payload(
      (await harness.client.callTool({
        name: 'sprint_create',
        arguments: { name: 'Cycle 1' },
      })) as CallToolResult,
    );
    const sprintKey = (sprint.sprint as { key: string }).key;

    const result = payload(
      (await harness.client.callTool({
        name: 'sprint_add_tasks',
        arguments: { sprint_key: sprintKey, task_keys: [taskKey, 'TEST-9999'] },
      })) as CallToolResult,
    );
    expect(result.added_count).toBe(1);
    expect(result.failed_count).toBe(1);
  });

  it('decision_accept moves a proposed ADR to accepted', async () => {
    const recorded = payload(
      (await harness.client.callTool({
        name: 'decision_record',
        arguments: { title: 'Adopt batch tools', decision: 'We will add batch MCP tools' },
      })) as CallToolResult,
    );
    const key = (recorded.decision as { key: string; status: string }).key;
    expect((recorded.decision as { status: string }).status).toBe('proposed');

    const accepted = payload(
      (await harness.client.callTool({
        name: 'decision_accept',
        arguments: { decision_key: key },
      })) as CallToolResult,
    );
    expect((accepted.decision as { status: string }).status).toBe('accepted');
  });
});
