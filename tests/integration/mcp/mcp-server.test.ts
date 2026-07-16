import { copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Config, ConfigSchema } from '@/config/config-schema.js';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';
import { listAvailableToolNames } from '@/mcp/tool-registry.js';
import { TOOL_RISK } from '@/mcp/tool-risk.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

interface Harness {
  readonly projectRoot: string;
  readonly config: Config;
  readonly container: ServiceContainer;
  readonly server: MnemaMcpServer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setupHarness(
  options: {
    readonly clientMetadata?: Record<string, unknown>;
    readonly workflow?: 'default' | 'lean' | 'kanban' | 'jira-classic';
    readonly knowledge?: boolean;
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
    ...(options.knowledge === false ? { features: { knowledge: false } } : {}),
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
    config,
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

  it('surfaces the compact verbosity option in a transition tool description', async () => {
    const list = await harness.client.listTools();
    const submit = list.tools.find((t) => t.name === 'task_submit');
    expect(submit?.description).toContain('compact');
  });

  it('registers exactly the tools the registry advertises (no orphans, none missing)', async () => {
    const list = await harness.client.listTools();
    const registered = new Set(list.tools.map((t) => t.name));
    // The registry's canonical set, plus the `task_<action>` tools the
    // active workflow generates, must match what the server exposes
    // one-for-one — a name listed but not wired (or wired but not listed)
    // is a silent bug this guards against.
    const workflow = harness.container.stateMachine.getWorkflow();
    const expected = listAvailableToolNames(workflow, {
      epics: workflow.features.epics,
      sprints: workflow.features.sprints,
      knowledge: harness.config.features.knowledge,
    });

    const missing = [...expected].filter((n) => !registered.has(n));
    const orphan = [...registered].filter((n) => !expected.has(n));
    expect(missing, `listed in registry but not registered: ${missing.join(', ')}`).toEqual([]);
    expect(orphan, `registered but absent from registry: ${orphan.join(', ')}`).toEqual([]);
  });

  it('every non-transition tool carries a risk annotation and TOOL_RISK has no orphans', async () => {
    const list = await harness.client.listTools();
    // Transition tools (`task_<action>`) derive their annotation from the
    // workflow, so they are intentionally absent from TOOL_RISK; every OTHER
    // registered tool must have a table entry, surfaced in tools/list. This
    // is what makes it impossible to ship a new static tool unclassified.
    // A transition is a `task_<action>` tool with no TOOL_RISK entry; the
    // static task tools (task_show, task_actions, …) do have entries.
    const isTransition = (name: string): boolean =>
      name.startsWith('task_') && !(name in TOOL_RISK);
    const staticTools = list.tools.filter((t) => !isTransition(t.name));

    const unclassified = staticTools.filter((t) => !(t.name in TOOL_RISK)).map((t) => t.name);
    expect(
      unclassified,
      `registered but absent from TOOL_RISK: ${unclassified.join(', ')}`,
    ).toEqual([]);

    // The annotation the table declares is the annotation tools/list carries.
    for (const tool of staticTools) {
      expect(tool.annotations, `${tool.name} annotation`).toEqual(TOOL_RISK[tool.name]);
    }

    // No orphan entries: every TOOL_RISK key maps to a really-registered tool
    // (guards against a typo'd key that silently annotates nothing).
    const registeredNames = new Set(list.tools.map((t) => t.name));
    const orphanEntries = Object.keys(TOOL_RISK).filter((n) => !registeredNames.has(n));
    expect(orphanEntries, `TOOL_RISK keys with no tool: ${orphanEntries.join(', ')}`).toEqual([]);

    // Transition tools still get a (derived) annotation — never left blank.
    const reopen = list.tools.find((t) => t.name === 'task_reopen');
    expect(reopen?.annotations?.readOnlyHint).toBe(false);
    expect(reopen?.annotations?.destructiveHint).toBe(true); // reopen rewinds a terminal task
    const submit = list.tools.find((t) => t.name === 'task_submit');
    expect(submit?.annotations?.readOnlyHint).toBe(false);
    expect(submit?.annotations?.destructiveHint).toBe(false); // a forward move loses nothing
  });

  it('the audit-only profile hides epic/sprint/knowledge tools but keeps the core', async () => {
    // lean workflow (no epics/sprints) + knowledge feature off = audit-only.
    const audit = await setupHarness({ workflow: 'lean', knowledge: false });
    try {
      const registered = new Set((await audit.client.listTools()).tools.map((t) => t.name));
      // Core stays.
      expect(registered.has('audit_verify')).toBe(true);
      expect(registered.has('task_create')).toBe(true);
      expect(registered.has('note_add')).toBe(true);
      // Epic/sprint/knowledge groups are gone.
      expect(registered.has('epic_create')).toBe(false);
      expect(registered.has('sprint_start')).toBe(false);
      expect(registered.has('decision_record')).toBe(false);
      expect(registered.has('memory_record')).toBe(false);
      expect(registered.has('observation_record')).toBe(false);
      expect(registered.has('skill_record')).toBe(false);
      // The shared coverage/lint tools span both planning domains and must
      // also be hidden when both are off — they used to leak because their
      // registrars were unconditional.
      expect(registered.has('epic_coverage')).toBe(false);
      expect(registered.has('sprint_coverage')).toBe(false);
      expect(registered.has('epic_lint')).toBe(false);
      expect(registered.has('sprint_lint')).toBe(false);

      // context_bootstrap advertises the same shape: Planning + Knowledge off.
      const boot = parsePayload(
        (await audit.client.callTool({
          name: 'context_bootstrap',
          arguments: {},
        })) as CallToolResult,
      );
      const groups = boot.tool_groups as { name: string; enabled: boolean }[];
      const enabled = Object.fromEntries(groups.map((g) => [g.name, g.enabled]));
      expect(enabled.Core).toBe(true);
      expect(enabled.Planning).toBe(false);
      expect(enabled.Knowledge).toBe(false);
    } finally {
      await audit.close();
    }
  });

  it('registered set matches the advertised set for a gated (audit-only) project', async () => {
    // The default-workflow parity test can't catch registered-vs-advertised
    // drift that only appears when features are OFF. Exercise a gated config
    // so a tool that is registered-but-unlisted (or vice-versa) fails here.
    const audit = await setupHarness({ workflow: 'lean', knowledge: false });
    try {
      const registered = new Set((await audit.client.listTools()).tools.map((t) => t.name));
      const workflow = audit.container.stateMachine.getWorkflow();
      const expected = listAvailableToolNames(workflow, {
        epics: workflow.features.epics,
        sprints: workflow.features.sprints,
        knowledge: audit.config.features.knowledge,
      });
      const missing = [...expected].filter((n) => !registered.has(n));
      const orphan = [...registered].filter((n) => !expected.has(n));
      expect(missing, `listed but not registered: ${missing.join(', ')}`).toEqual([]);
      expect(orphan, `registered but not listed: ${orphan.join(', ')}`).toEqual([]);
    } finally {
      await audit.close();
    }
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

    // The protocol directive must ride on every bootstrap so the agent is
    // told to record durable knowledge in Mnema, not its native memory —
    // without depending on having read AGENTS.md.
    const protocol = payload.protocol as { record_durable_knowledge_here?: string };
    expect(protocol?.record_durable_knowledge_here).toContain('memory_record');
    expect(protocol?.record_durable_knowledge_here).toMatch(/native memory/i);

    // The layered tool surface rides on bootstrap so the agent reasons about
    // buckets, not a flat list. Default project → all four layers enabled.
    const groups = payload.tool_groups as { name: string; enabled: boolean }[];
    expect(groups.map((g) => g.name)).toEqual([
      'Core',
      'Workflow transitions',
      'Planning',
      'Knowledge',
    ]);
    expect(groups.every((g) => g.enabled)).toBe(true);
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

  describe('stale-server signal (MNEMA-325)', () => {
    /** Touch the active workflow's mtime to a future instant → schema diverged. */
    function touchWorkflow(h: Harness): void {
      const wf = path.join(h.projectRoot, h.config.paths.workflows, `${h.config.workflow}.json`);
      const future = new Date(Date.now() + 60_000);
      utimesSync(wf, future, future);
    }

    it('returns SERVER_STALE on a mutating call after the schema inputs diverge', async () => {
      touchWorkflow(harness);
      // task_create is a mutation — the stale gate fires before the handler
      // (so it does not even need an active run to trip).
      const result = await harness.client.callTool({
        name: 'task_create',
        arguments: { title: 'anything' },
      });
      expect(result.isError).toBe(true);
      const payload = parsePayload(result as CallToolResult);
      expect(payload.error).toBe('SERVER_STALE');
      expect(Array.isArray(payload.changed)).toBe(true);
      expect((payload.changed as string[]).join(' ')).toMatch(/workflow/i);
      // The hint tells the agent what to do.
      expect(String(payload.hint)).toMatch(/restart/i);
    });

    it('leaves read-only tools working when the server is stale', async () => {
      touchWorkflow(harness);
      // A read (tasks_list) must NOT be blocked by the stale gate.
      const result = await harness.client.callTool({ name: 'tasks_list', arguments: {} });
      expect(result.isError).toBeFalsy();
      const payload = parsePayload(result as CallToolResult);
      expect(payload.error).toBeUndefined();
    });

    it('does not block mutations when the schema is fresh', async () => {
      // No touch: fingerprint matches. A mutation gets past the stale gate and
      // fails for its OWN reason (no active run), not SERVER_STALE.
      const result = await harness.client.callTool({
        name: 'task_create',
        arguments: { title: 'anything' },
      });
      const payload = parsePayload(result as CallToolResult);
      expect(payload.error).not.toBe('SERVER_STALE');
    });
  });
});
