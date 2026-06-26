import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';
import { listAvailableToolNames } from '@/mcp/tool-registry.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

interface Harness {
  readonly projectRoot: string;
  readonly container: ServiceContainer;
  readonly server: MnemaMcpServer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setupHarness(
  options: {
    readonly clientMetadata?: Record<string, unknown>;
    readonly workflow?: 'default' | 'lean' | 'kanban' | 'jira-classic';
  } = {},
): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-mcp-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  const workflowName = options.workflow ?? 'default';
  copyFileSync(
    path.join(workflowsSrc, `${workflowName}.json`),
    path.join(projectRoot, '.mnema/workflows', `${workflowName}.json`),
  );

  const config = ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test Project' },
    workflow: workflowName,
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });

  const clientMetadata = options.clientMetadata ?? { agent_handle: 'test-agent' };
  const server = new MnemaMcpServer(config, projectRoot, container, clientMetadata);
  server.registerTools();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const sdk = server.getSdkServer();
  await sdk.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    projectRoot,
    container,
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

describe('MnemaMcpServer (in-memory)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('lists every expected universal and transition tool', async () => {
    const list = await harness.client.listTools();
    const names = new Set(list.tools.map((t) => t.name));

    expect(names).toContain('context_bootstrap');
    expect(names).toContain('agent_run_start');
    expect(names).toContain('agent_run_end');
    expect(names).toContain('agent_run_show');
    expect(names).toContain('task_create');
    expect(names).toContain('tasks_list');
    expect(names).toContain('task_show');
    expect(names).toContain('agent_plan_create');
    expect(names).toContain('agent_plan_update_state');
    expect(names).toContain('agent_plans_list');
    expect(names).toContain('audit_query');

    // Newer surface added for batch + roadmap + assignment parity.
    expect(names).toContain('task_create_many');
    expect(names).toContain('task_assign');
    expect(names).toContain('epic_create');
    expect(names).toContain('epic_add_task');
    expect(names).toContain('sprint_create');
    expect(names).toContain('sprint_add_tasks');
    expect(names).toContain('task_depends_many');
    expect(names).toContain('decision_accept');
    expect(names).toContain('decision_reject');

    // Transition tools generated from default workflow
    expect(names).toContain('task_submit');
    expect(names).toContain('task_start');
    expect(names).toContain('task_approve');
  });

  it('registers exactly the tools the registry advertises (no orphans, none missing)', async () => {
    const list = await harness.client.listTools();
    const registered = new Set(list.tools.map((t) => t.name));
    // The registry's canonical set, plus the `task_<action>` tools the
    // active workflow generates, must match what the server exposes
    // one-for-one — a name listed but not wired (or wired but not listed)
    // is a silent bug this guards against.
    const expected = listAvailableToolNames(harness.container.stateMachine.getWorkflow());

    const missing = [...expected].filter((n) => !registered.has(n));
    const orphan = [...registered].filter((n) => !expected.has(n));
    expect(missing, `listed in registry but not registered: ${missing.join(', ')}`).toEqual([]);
    expect(orphan, `registered but absent from registry: ${orphan.join(', ')}`).toEqual([]);
  });

  it('context_bootstrap returns project + workflow + statistics', async () => {
    const result = await harness.client.callTool({
      name: 'context_bootstrap',
      arguments: {},
    });
    const payload = parsePayload(result as CallToolResult);

    expect(payload.ok).toBe(true);
    const project = payload.project as Record<string, unknown>;
    expect(project.key).toBe('TEST');

    const workflow = payload.workflow as Record<string, unknown>;
    expect(workflow.name).toBe('default');
    expect(workflow.states as string[]).toContain('IN_PROGRESS');
  });

  it('agent_run_start captures the run id in the session and lets task_create proceed', async () => {
    const start = await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'audit task creation flow' },
    });
    const payload = parsePayload(start as CallToolResult);
    expect(payload.ok).toBe(true);
    const runId = payload.run_id as string;
    expect(runId).toBeTruthy();
    expect(harness.server.getSession().getCurrentRunId()).toBe(runId);

    const created = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Implement OAuth login' },
    });
    const createdPayload = parsePayload(created as CallToolResult);
    expect(createdPayload.ok).toBe(true);
    const task = createdPayload.task as { key: string; state: string };
    expect(task.key).toBe('TEST-1');
    expect(task.state).toBe('DRAFT');
  });

  it('task_create without an active run returns NO_ACTIVE_RUN', async () => {
    const result = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Forbidden' },
    });
    expect((result as CallToolResult).isError).toBe(true);
    const payload = parsePayload(result as CallToolResult);
    expect(payload.error).toBe('NO_ACTIVE_RUN');
  });

  it('agent_run_start without an agent_handle returns AGENT_HANDLE_MISSING', async () => {
    // Spin up a fresh harness with metadata that omits agent_handle —
    // the failure mode users hit when the MCP client does not
    // propagate it (Claude Code stdio without MNEMA_AGENT_HANDLE).
    await harness.close();
    harness = await setupHarness({ clientMetadata: { pid: process.pid } });

    const result = await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'should fail' },
    });
    expect((result as CallToolResult).isError).toBe(true);
    const payload = parsePayload(result as CallToolResult);
    expect(payload.error).toBe('AGENT_HANDLE_MISSING');
  });

  it('transition tool reflects optimistic concurrency via expected_updated_at', async () => {
    await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'concurrency test' },
    });

    const created = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Locked task' },
    });
    const createdPayload = parsePayload(created as CallToolResult);
    const task = createdPayload.task as { key: string; updated_at: string };

    const conflict = await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: task.key,
        expected_updated_at: '1999-01-01T00:00:00.000Z',
        title: 'Locked task',
        description: 'Submit with a stale updated_at to trigger conflict.',
        acceptance_criteria: ['must conflict'],
        estimate: 5,
      },
    });
    expect((conflict as CallToolResult).isError).toBe(true);
    const conflictPayload = parsePayload(conflict as CallToolResult);
    expect(conflictPayload.error).toBe('CONFLICT');
    expect(conflictPayload.taskKey).toBe(task.key);

    const ok = await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: task.key,
        title: 'Locked task',
        description: 'Submit without an expected_updated_at succeeds.',
        acceptance_criteria: ['succeeds'],
        estimate: 5,
      },
    });
    const okPayload = parsePayload(ok as CallToolResult);
    expect(okPayload.ok).toBe(true);
    const updated = okPayload.task as { state: string };
    expect(updated.state).toBe('READY');
  });

  it('agent_run_end clears the run and triggers a buffer flush', async () => {
    await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'flush check' },
    });
    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Buffered task' },
    });

    const ended = await harness.client.callTool({
      name: 'agent_run_end',
      arguments: { status: 'completed' },
    });
    const endedPayload = parsePayload(ended as CallToolResult);
    expect(endedPayload.ok).toBe(true);
    expect(harness.server.getSession().getCurrentRunId()).toBeNull();
  });
});

describe('MnemaMcpServer under workflow=lean (1.4 sweep)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness({ workflow: 'lean' });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('tasks_list accepts lean states (TODO/DOING/DONE) and rejects default-workflow states', async () => {
    await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'state filter check' },
    });

    // TODO is the initial state in lean — should be valid.
    const okResult = await harness.client.callTool({
      name: 'tasks_list',
      arguments: { state: 'TODO' },
    });
    expect((okResult as CallToolResult).isError).toBeFalsy();

    // DRAFT is the default-workflow initial — should be rejected under lean.
    const draftResult = await harness.client.callTool({
      name: 'tasks_list',
      arguments: { state: 'DRAFT' },
    });
    expect((draftResult as CallToolResult).isError).toBe(true);
  });

  it('context_bootstrap reports blocked=0 and in_progress derives from DOING under lean', async () => {
    const bootstrap = await harness.client.callTool({
      name: 'context_bootstrap',
      arguments: {},
    });
    const payload = parsePayload(bootstrap as CallToolResult);
    const stats = payload.statistics as {
      blocked: number;
      in_progress: number;
      by_state: Record<string, number>;
    };
    // Lean has no BLOCKED state — blocked must be 0.
    expect(stats.blocked).toBe(0);
    // by_state must use the lean state names, not the default workflow's.
    expect(Object.keys(stats.by_state).sort()).toEqual(['DOING', 'DONE', 'TODO']);
    // in_progress matches the DOING count (initially 0 — no tasks yet).
    expect(stats.in_progress).toBe(0);
  });
});
