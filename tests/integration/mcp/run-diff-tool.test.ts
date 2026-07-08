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
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-rundiff-'));
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

type Diff = {
  run: { id: string; status: string };
  counts: { transitions: number; evidence: number; decisions: number; knowledge: number };
  transitions: { summary: string }[];
  evidence: { summary: string }[];
  knowledge: { summary: string }[];
};

describe('run_diff MCP tool (MNEMA-91)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  /** Drives a run that creates a task, attaches evidence and records a memory. */
  async function driveRun(): Promise<string> {
    const start = (await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'do some work' },
    })) as CallToolResult;
    const runId = payload(start).run_id as string;

    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'A task', acceptance_criteria: ['works'] },
    });
    await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: { task_key: 'TEST-1', criterion_index: 0, kind: 'doc', ref: 'docs/x.md' },
    });
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'a-fact', title: 'A fact', content: 'something durable', topics: ['x'] },
    });
    return runId;
  }

  it('reports the grouped diff while the run is still in progress', async () => {
    const runId = await driveRun();
    // No agent_run_end — the run is still open.
    const res = (await harness.client.callTool({
      name: 'run_diff',
      arguments: { run_id: runId },
    })) as CallToolResult;
    const diff = payload(res).diff as Diff;

    expect(diff.run.id).toBe(runId);
    expect(diff.run.status).toBe('running');
    expect(diff.counts.transitions).toBeGreaterThanOrEqual(1); // task_created
    expect(diff.counts.evidence).toBe(1);
    expect(diff.counts.knowledge).toBe(1);
    expect(diff.transitions.some((c) => c.summary.includes('TEST-1'))).toBe(true);
    expect(diff.evidence[0]?.summary).toContain('docs/x.md');
    expect(diff.knowledge[0]?.summary).toContain('a-fact');
  });

  it('reports the diff for a completed run', async () => {
    const runId = await driveRun();
    await harness.client.callTool({
      name: 'agent_run_end',
      arguments: { status: 'completed', summary: 'done' },
    });
    const res = (await harness.client.callTool({
      name: 'run_diff',
      arguments: { run_id: runId },
    })) as CallToolResult;
    const diff = payload(res).diff as Diff;
    expect(diff.run.status).toBe('completed');
    expect(diff.counts.evidence).toBe(1);
  });

  it('includes task_claim / task_release_claim in the transitions group', async () => {
    // A claim is a work reservation the reviewer should see alongside
    // assign — this pins that the run-diff surfaces it rather than silently
    // dropping it (task_claimed/task_claim_released always carry a run id,
    // so the categorizer would otherwise discard 100% of them).
    const start = (await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'claim then release' },
    })) as CallToolResult;
    const runId = payload(start).run_id as string;

    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Claimable', acceptance_criteria: ['works'] },
    });
    await harness.client.callTool({ name: 'task_claim', arguments: { task_key: 'TEST-1' } });
    await harness.client.callTool({
      name: 'task_release_claim',
      arguments: { task_key: 'TEST-1' },
    });

    const res = (await harness.client.callTool({
      name: 'run_diff',
      arguments: { run_id: runId },
    })) as CallToolResult;
    const diff = payload(res).diff as Diff;

    expect(diff.transitions.some((c) => c.summary.startsWith('claimed TEST-1'))).toBe(true);
    expect(diff.transitions.some((c) => c.summary === 'released claim on TEST-1')).toBe(true);
  });

  it('errors on an unknown run id', async () => {
    const res = (await harness.client.callTool({
      name: 'run_diff',
      arguments: { run_id: '019f0000-0000-7000-8000-000000000000' },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });
});
