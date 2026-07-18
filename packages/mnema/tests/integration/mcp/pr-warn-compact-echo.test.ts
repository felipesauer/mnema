import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '@mnema/core/config/config-schema.js';
import { type CommandRunner, GitHubPrService } from '@mnema/core/services/git/github-pr-service.js';
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

function ghRunner(view: Record<string, unknown>): CommandRunner {
  return () => ({ status: 0, stdout: JSON.stringify(view) });
}

async function setupHarness(runner: CommandRunner): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-pr-warn-compact-'));
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
    github: { done_pr_policy: 'warn' },
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

/** Drive a fresh task to IN_REVIEW within an active run. Returns its key. */
async function taskInReview(client: Client): Promise<string> {
  await client.callTool({ name: 'agent_run_start', arguments: { goal: 'pr warn compact' } });
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
  return key;
}

const OPEN = { state: 'OPEN', mergedAt: null, statusCheckRollup: [] };
const PR = 'https://github.com/o/r/pull/1';

describe('verbosity:compact is honoured on a PR-warn echo', () => {
  let harness: Harness;
  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });
  beforeEach(() => {
    process.env.MNEMA_ACTOR = 'daniel';
  });

  it('returns the compact task shape (not the full entity) while surfacing pr_warning', async () => {
    harness = await setupHarness(ghRunner(OPEN));
    const key = await taskInReview(harness.client);

    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR, verbosity: 'compact' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const payload = parsePayload(result);
    // The warning must still be surfaced.
    expect(String(payload.pr_warning)).toContain('not merged');

    // Compact echo: exactly { key, state, updatedAt }, nothing more.
    const task = payload.task as Record<string, unknown>;
    expect(task.state).toBe('DONE');
    expect(Object.keys(task).sort()).toEqual(['key', 'state', 'updatedAt']);
    // The full entity's fields must NOT leak through.
    expect(task.title).toBeUndefined();
    expect(task.description).toBeUndefined();
    expect(task.acceptanceCriteria).toBeUndefined();
  });

  it('still echoes the full entity under the default (full) verbosity', async () => {
    harness = await setupHarness(ghRunner(OPEN));
    const key = await taskInReview(harness.client);

    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const payload = parsePayload(result);
    expect(String(payload.pr_warning)).toContain('not merged');
    const task = payload.task as Record<string, unknown>;
    expect(task.title).toBe('Gated task');
  });
});
