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

type Policy = 'off' | 'warn' | 'block';

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

/** A gh runner returning a fixed `gh pr view --json` payload. */
function ghRunner(view: Record<string, unknown>): CommandRunner {
  return () => ({ status: 0, stdout: JSON.stringify(view) });
}

async function setupHarness(policy: Policy, runner: CommandRunner): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-complete-merged-'));
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

function parsePayload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected text content');
  return JSON.parse(block.text) as Record<string, unknown>;
}

/** Drive a fresh task to IN_PROGRESS within an active run. Returns its key. */
async function taskInProgress(client: Client): Promise<string> {
  await client.callTool({ name: 'agent_run_start', arguments: { goal: 'complete merged code' } });
  const created = await client.callTool({
    name: 'task_create',
    arguments: { title: 'Merged code task' },
  });
  const key = (parsePayload(created as CallToolResult).task as { key: string }).key;
  await client.callTool({
    name: 'task_submit',
    arguments: {
      task_key: key,
      title: 'Merged code task',
      description: 'A description long enough to pass the readiness gate.',
      acceptance_criteria: ['works'],
      estimate: 2,
    },
  });
  await client.callTool({
    name: 'task_start',
    arguments: { task_key: key, assignee_id: 'me' },
  });
  return key;
}

const MERGED_GREEN = {
  state: 'MERGED',
  mergedAt: '2026-06-30T00:00:00Z',
  statusCheckRollup: [{ state: 'SUCCESS' }],
};
const OPEN = { state: 'OPEN', mergedAt: null, statusCheckRollup: [] };
const PR = 'https://github.com/o/r/pull/7';

describe('complete: merged-code IN_PROGRESS → DONE with pr_url evidence', () => {
  let harness: Harness;
  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });
  beforeEach(() => {
    process.env.MNEMA_ACTOR = 'daniel';
  });

  it('reaches DONE in one hop and records pr_url as transition evidence', async () => {
    harness = await setupHarness('block', ghRunner(MERGED_GREEN));
    const key = await taskInProgress(harness.client);

    const result = (await harness.client.callTool({
      name: 'task_complete',
      arguments: { task_key: key, completion_note: 'merged in PR', pr_url: PR },
    })) as CallToolResult;
    if (result.isError) console.error('COMPLETE_FAIL', JSON.stringify(parsePayload(result)));
    expect(result.isError).toBeFalsy();
    expect((parsePayload(result).task as { state: string }).state).toBe('DONE');

    // The pr_url must survive into the transition's payload as evidence —
    // not be stripped like the synthetic gate-only field.
    const transitions = harness.container.adapter
      .getDatabase()
      .prepare('SELECT payload FROM transitions WHERE action = ?')
      .all('complete') as { payload: string }[];
    expect(transitions.length).toBe(1);
    const recorded = JSON.parse(transitions[0]?.payload ?? '{}') as { pr_url?: string };
    expect(recorded.pr_url).toBe(PR);
  });

  it('is still blocked when done_pr_policy=block and the PR is unmerged', async () => {
    harness = await setupHarness('block', ghRunner(OPEN));
    const key = await taskInProgress(harness.client);

    const result = (await harness.client.callTool({
      name: 'task_complete',
      arguments: { task_key: key, completion_note: 'claims merged', pr_url: PR },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(parsePayload(result).error).toBe('GATE_FAILED');

    // The gate refused before any state change: the task stays IN_PROGRESS.
    const show = (await harness.client.callTool({
      name: 'task_show',
      arguments: { task_key: key },
    })) as CallToolResult;
    expect((parsePayload(show).task as { state: string }).state).toBe('IN_PROGRESS');
  });
});
