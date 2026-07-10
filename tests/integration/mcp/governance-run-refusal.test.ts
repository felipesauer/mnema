import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';
import { type CommandRunner, GitHubPrService } from '@/services/github-pr-service.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

type Policy = 'off' | 'warn' | 'block';

interface Harness {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

/** A gh runner returning a fixed `gh pr view --json` payload. */
function ghRunner(view: Record<string, unknown>): CommandRunner {
  return () => ({ status: 0, stdout: JSON.stringify(view) });
}

async function setupHarness(policy: Policy, runner: CommandRunner): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-gov-refusal-'));
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
    github: { done_pr_policy: policy },
  });
  const container: ServiceContainer = createServiceContainer(config, projectRoot, {
    migrationsDir,
  });
  (container as { githubPr: GitHubPrService }).githubPr = new GitHubPrService(runner);

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

/**
 * Drive a fresh task to IN_REVIEW, then END the execution run so a later
 * governance act (approve) runs run-less and opens a transient system run.
 */
async function taskInReviewRunLess(client: Client): Promise<string> {
  await client.callTool({ name: 'agent_run_start', arguments: { goal: 'bring task to review' } });
  const created = await client.callTool({
    name: 'task_create',
    arguments: { title: 'Gated task' },
  });
  const key = (parsePayload(created as CallToolResult).task as { key: string }).key;
  await client.callTool({
    name: 'task_submit',
    arguments: {
      task_key: key,
      title: 'Gated task',
      description: 'A description long enough to pass the readiness gate.',
      acceptance_criteria: ['works'],
      estimate: 2,
    },
  });
  await client.callTool({
    name: 'task_start',
    arguments: { task_key: key, assignee_id: 'daniel' },
  });
  await client.callTool({
    name: 'task_submit_review',
    arguments: { task_key: key, pr_url: 'https://github.com/o/r/pull/1' },
  });
  await client.callTool({ name: 'agent_run_end', arguments: { status: 'completed' } });
  return key;
}

interface AuditEventLike {
  readonly run?: string | null;
  readonly data?: { readonly goal?: string; readonly status?: string };
}

/** Every `run_ended` status keyed by the run's governance goal. */
async function governanceRunEndStatuses(client: Client): Promise<string[]> {
  const startedResult = (await client.callTool({
    name: 'audit_query',
    arguments: { kind: 'run_started' },
  })) as CallToolResult;
  const started = parsePayload(startedResult).events as AuditEventLike[];
  const governanceRunIds = new Set(
    started
      .filter((e) => (e.data?.goal ?? '').startsWith('governance:'))
      .map((e) => e.run)
      .filter((id): id is string => typeof id === 'string'),
  );

  const endedResult = (await client.callTool({
    name: 'audit_query',
    arguments: { kind: 'run_ended' },
  })) as CallToolResult;
  const ended = parsePayload(endedResult).events as AuditEventLike[];
  return ended
    .filter((e) => typeof e.run === 'string' && governanceRunIds.has(e.run))
    .map((e) => e.data?.status ?? 'unknown');
}

const OPEN = { state: 'OPEN', mergedAt: null, statusCheckRollup: [] };
const MERGED_GREEN = {
  state: 'MERGED',
  mergedAt: '2026-06-30T00:00:00Z',
  statusCheckRollup: [{ state: 'SUCCESS' }],
};
const PR = 'https://github.com/o/r/pull/1';

describe('refused governance transition writes no completed system run', () => {
  let harness: Harness;
  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });
  beforeEach(() => {
    process.env.MNEMA_ACTOR = 'daniel';
  });

  it('a blocked DONE-gate approve produces NO completed governance run', async () => {
    harness = await setupHarness('block', ghRunner(OPEN));
    const key = await taskInReviewRunLess(harness.client);

    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    // The gate refuses the move.
    expect(result.isError).toBe(true);
    expect(parsePayload(result).error).toBe('GATE_FAILED');

    // No governance system run may be recorded as completed for an act
    // that never happened.
    const statuses = await governanceRunEndStatuses(harness.client);
    expect(statuses).not.toContain('completed');
  });

  it('a successful approve still records its system run as completed', async () => {
    harness = await setupHarness('block', ghRunner(MERGED_GREEN));
    const key = await taskInReviewRunLess(harness.client);

    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect((parsePayload(result).task as { state: string }).state).toBe('DONE');

    const statuses = await governanceRunEndStatuses(harness.client);
    expect(statuses).toContain('completed');
  });
});
