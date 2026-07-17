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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-resume-'));
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

interface ResumePayload {
  readonly run_id: string;
  readonly resume_hint: string;
  readonly active_tasks: { key: string; state: string; last_action: string }[];
  readonly recent_changes: string[];
  readonly mutation_count: number;
}

describe('agent_run_resume reconstructs focus (MNEMA-223)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('surfaces the in-flight task, a resume_hint and recent changes after an interrupted run', async () => {
    // A run that starts a task, attaches evidence, then is interrupted
    // (aborted) mid-flight — the classic dropped session.
    const started = payload(
      (await harness.client.callTool({
        name: 'agent_run_start',
        arguments: { goal: 'wire the notifier' },
      })) as CallToolResult,
    );
    const runId = started.run_id as string;

    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Notifier channel', acceptance_criteria: ['sends'] },
    });
    await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: 'TEST-1',
        title: 'Notifier channel',
        description: 'Add a notification channel.',
        acceptance_criteria: ['sends'],
        estimate: 3,
      },
    });
    await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: 'TEST-1', assignee_id: 'daniel' },
    });
    await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: {
        task_key: 'TEST-1',
        criterion_index: 0,
        kind: 'commit',
        ref: 'abc123',
      },
    });
    // Interrupt: end the run as aborted so it becomes resumable.
    await harness.client.callTool({
      name: 'agent_run_end',
      arguments: { status: 'aborted' },
    });

    const resume = payload(
      (await harness.client.callTool({
        name: 'agent_run_resume',
        arguments: { run_id: runId },
      })) as CallToolResult,
    ) as unknown as ResumePayload;

    // The task the run left IN_PROGRESS is surfaced as in-flight.
    expect(resume.active_tasks).toHaveLength(1);
    expect(resume.active_tasks[0]?.key).toBe('TEST-1');
    expect(resume.active_tasks[0]?.state).toBe('IN_PROGRESS');

    // The hint is derived from the real audit (names the task + points at resuming it),
    // not a placeholder.
    expect(resume.resume_hint).toContain('TEST-1');
    expect(resume.resume_hint.toLowerCase()).toContain('resume');

    // Recent changes reflect the actual transition timeline.
    expect(resume.recent_changes.some((c) => c.includes('TEST-1'))).toBe(true);
    expect(resume.mutation_count).toBeGreaterThan(0);
  });

  it('tells a finished-clean run there is nothing to resume', async () => {
    // A run that drives a task all the way to a terminal state leaves
    // nothing in flight; the hint must say so rather than invent focus.
    const started = payload(
      (await harness.client.callTool({
        name: 'agent_run_start',
        arguments: { goal: 'close it out' },
      })) as CallToolResult,
    );
    const runId = started.run_id as string;

    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Quick chore', acceptance_criteria: ['done'] },
    });
    await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: 'TEST-1',
        title: 'Quick chore',
        description: 'A quick chore to finish.',
        acceptance_criteria: ['done'],
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
    await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: 'TEST-1', approval_note: 'lgtm' },
    });
    await harness.client.callTool({
      name: 'agent_run_end',
      arguments: { status: 'aborted' },
    });

    const resume = payload(
      (await harness.client.callTool({
        name: 'agent_run_resume',
        arguments: { run_id: runId },
      })) as CallToolResult,
    ) as unknown as ResumePayload;

    expect(resume.active_tasks).toHaveLength(0);
    expect(resume.resume_hint.toLowerCase()).toContain('nothing to resume');
  });
});
