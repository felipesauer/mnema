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
  readonly server: MnemaMcpServer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setupHarness(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-gov-'));
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
    server,
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

/** Drive a fresh task all the way to IN_REVIEW inside one execution run. */
async function taskInReview(client: Client): Promise<string> {
  await client.callTool({ name: 'agent_run_start', arguments: { goal: 'bring task to review' } });
  const created = await client.callTool({
    name: 'task_create',
    arguments: { title: 'Awaiting sign-off' },
  });
  const key = (parsePayload(created as CallToolResult).task as { key: string }).key;
  await client.callTool({
    name: 'task_submit',
    arguments: {
      task_key: key,
      title: 'Awaiting sign-off',
      description: 'A description long enough to pass the readiness gate.',
      acceptance_criteria: ['it works'],
      estimate: 3,
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
  // End the execution run so the governance acts below run run-less.
  await client.callTool({ name: 'agent_run_end', arguments: { status: 'completed' } });
  return key;
}

describe('governance acts without an active execution run', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('task_approve succeeds with no active run and clears the run afterwards', async () => {
    const key = await taskInReview(harness.client);
    expect(harness.server.getSession().getCurrentRunId()).toBeNull();

    const approved = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'signed off' },
    })) as CallToolResult;

    expect(approved.isError).toBeFalsy();
    const task = parsePayload(approved).task as { state: string };
    expect(task.state).toBe('DONE');
    // The transient system run must not linger as the active run.
    expect(harness.server.getSession().getCurrentRunId()).toBeNull();
  });

  it('task_attach_evidence succeeds with no active run', async () => {
    const key = await taskInReview(harness.client);
    expect(harness.server.getSession().getCurrentRunId()).toBeNull();

    const attached = (await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: {
        task_key: key,
        criterion_index: 0,
        kind: 'commit',
        ref: 'abc1234',
        note: 'retroactive evidence',
      },
    })) as CallToolResult;

    expect(attached.isError).toBeFalsy();
    expect(parsePayload(attached).ok).toBe(true);
  });

  it('attributes the governance act to a system run in the audit log', async () => {
    const key = await taskInReview(harness.client);

    await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'signed off' },
    });

    // The approval transition must carry a run id (the system run),
    // i.e. provenance is preserved, not dropped to null.
    const audit = (await harness.client.callTool({
      name: 'audit_query',
      arguments: { kind: 'task_transitioned' },
    })) as CallToolResult;
    const events = parsePayload(audit).events as { run?: string | null; data?: unknown }[];
    const approval = events.find((e) => {
      const data = e.data as { action?: string } | undefined;
      return data?.action === 'approve';
    });
    expect(approval).toBeDefined();
    expect(approval?.run).toBeTruthy();
  });

  it('still requires a run for a work action (task_submit)', async () => {
    // No agent_run_start — a work transition must still be rejected.
    const created = (await harness.client.callTool({
      name: 'task_show',
      arguments: { task_key: 'TEST-1' },
    })) as CallToolResult;
    // TEST-1 doesn't exist yet; create one within a run, then end it.
    void created;
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'make one' } });
    const c = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Work needs a run' },
    })) as CallToolResult;
    const key = (parsePayload(c).task as { key: string }).key;
    await harness.client.callTool({ name: 'agent_run_end', arguments: { status: 'completed' } });

    const submitted = (await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: key,
        title: 'Work needs a run',
        description: 'A description long enough to pass the gate.',
        acceptance_criteria: ['x'],
        estimate: 1,
      },
    })) as CallToolResult;
    expect(submitted.isError).toBe(true);
    expect(parsePayload(submitted).error).toBe('NO_ACTIVE_RUN');
  });
});
