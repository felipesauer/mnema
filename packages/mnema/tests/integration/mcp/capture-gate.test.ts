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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-capgate-'));
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
  const container: ServiceContainer = createServiceContainer(config, projectRoot, {
    migrationsDir,
    userDir: null,
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

/** Drive a fresh task to IN_REVIEW; returns after submit_review. */
async function toReview(client: Client, key: string, title: string): Promise<void> {
  await client.callTool({ name: 'task_create', arguments: { title, acceptance_criteria: ['ok'] } });
  await client.callTool({
    name: 'task_submit',
    arguments: {
      task_key: key,
      title,
      description: `${title} — ready`,
      acceptance_criteria: ['ok'],
      estimate: 1,
    },
  });
  await client.callTool({
    name: 'task_start',
    arguments: { task_key: key, assignee_id: 'daniel' },
  });
  await client.callTool({
    name: 'task_submit_review',
    arguments: { task_key: key, pr_url: 'https://example.com/pr/1' },
  });
}

describe('capture gate nudges knowledge on a non-trivial approve (MNEMA-239)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'cap gate' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('emits a capture_prompt when approving a task that was reopened', async () => {
    await toReview(harness.client, 'TEST-1', 'First pass');
    await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: 'TEST-1', approval_note: 'lgtm' },
    });
    // Reopen (rework), then take it back through review and approve again.
    await harness.client.callTool({
      name: 'task_reopen',
      arguments: { task_key: 'TEST-1', reason: 'a real bug surfaced after merge' },
    });
    await harness.client.callTool({
      name: 'task_submit_review',
      arguments: { task_key: 'TEST-1', pr_url: 'https://example.com/pr/2' },
    });
    const approved = payload(
      (await harness.client.callTool({
        name: 'task_approve',
        arguments: { task_key: 'TEST-1', approval_note: 'fixed now' },
      })) as CallToolResult,
    );
    expect(String(approved.capture_prompt)).toContain('TEST-1');
    expect(String(approved.capture_prompt).toLowerCase()).toContain('reopen');
    expect(String(approved.capture_prompt)).toContain('memory_record');
  });

  it('emits a capture_prompt when approving a task labelled architecture', async () => {
    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Design the anchor', acceptance_criteria: ['ok'] },
    });
    await harness.client.callTool({
      name: 'task_set_labels',
      arguments: { task_key: 'TEST-1', labels: ['architecture'] },
    });
    await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: 'TEST-1',
        title: 'Design the anchor',
        description: 'a design task',
        acceptance_criteria: ['ok'],
        estimate: 1,
      },
    });
    await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: 'TEST-1', assignee_id: 'daniel' },
    });
    await harness.client.callTool({
      name: 'task_submit_review',
      arguments: { task_key: 'TEST-1', pr_url: 'https://example.com/pr/1' },
    });
    const approved = payload(
      (await harness.client.callTool({
        name: 'task_approve',
        arguments: { task_key: 'TEST-1', approval_note: 'lgtm' },
      })) as CallToolResult,
    );
    expect(String(approved.capture_prompt)).toContain('architecture');
  });

  it('does not nudge on a routine approve (no rework, no arch label)', async () => {
    await toReview(harness.client, 'TEST-1', 'Routine chore');
    const approved = payload(
      (await harness.client.callTool({
        name: 'task_approve',
        arguments: { task_key: 'TEST-1', approval_note: 'lgtm' },
      })) as CallToolResult,
    );
    expect(approved.capture_prompt).toBeUndefined();
    // The task still reached DONE — the gate never blocks.
    expect((approved.task as { state: string }).state).toBe('DONE');
  });
});
