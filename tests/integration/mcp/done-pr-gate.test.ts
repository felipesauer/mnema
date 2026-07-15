import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';
import { type CommandRunner, GitHubPrService } from '@/services/git/github-pr-service.js';
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

/**
 * A gh runner that answers `pr view` with `view` and routes the merge-commit
 * `gh api .../{check-runs,status}` lookups to their own fixtures — so the gate
 * can be exercised on the base-branch CI signal, not just the head rollup.
 */
function ghBaseRunner(
  view: Record<string, unknown>,
  checkRuns: unknown,
  combinedStatus: unknown,
): CommandRunner {
  return (_command, args) => {
    const joined = args.join(' ');
    if (args[0] === 'pr') return { status: 0, stdout: JSON.stringify(view) };
    if (args[0] === 'api' && joined.includes('/check-runs')) {
      return { status: 0, stdout: JSON.stringify(checkRuns) };
    }
    if (args[0] === 'api' && joined.endsWith('/status')) {
      return { status: 0, stdout: JSON.stringify(combinedStatus) };
    }
    return { status: 1, stdout: '' };
  };
}

/** Merged, head green, but carrying a merge commit whose base CI we can probe. */
const MERGED_GREEN_HEAD_WITH_MERGE_OID = {
  state: 'MERGED',
  mergedAt: '2026-06-30T00:00:00Z',
  statusCheckRollup: [{ state: 'SUCCESS' }],
  mergeCommit: { oid: 'basecommitsha' },
  baseRefName: 'main',
};
const CHECK_RUNS_RED = { check_runs: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] };
const CHECK_RUNS_GREEN = { check_runs: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] };
const COMBINED_EMPTY = { state: 'success', statuses: [] };

async function setupHarness(policy: Policy, runner: CommandRunner): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-pr-gate-'));
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
  // Swap the GitHub service for one backed by our mock gh runner, so the
  // gate sees a deterministic PR status without touching the network.
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
  await client.callTool({ name: 'agent_run_start', arguments: { goal: 'pr gate' } });
  const created = await client.callTool({
    name: 'task_create',
    arguments: { title: 'Gated task' },
  });
  const key = ((await parsePayload(created as CallToolResult)).task as { key: string }).key;
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

const MERGED_GREEN = {
  state: 'MERGED',
  mergedAt: '2026-06-30T00:00:00Z',
  statusCheckRollup: [{ state: 'SUCCESS' }],
};
const OPEN = { state: 'OPEN', mergedAt: null, statusCheckRollup: [] };
const MERGED_RED = {
  state: 'MERGED',
  mergedAt: '2026-06-30T00:00:00Z',
  statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }],
};
const PR = 'https://github.com/o/r/pull/1';

describe('DONE-transition PR/CI gate', () => {
  let harness: Harness;
  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });
  beforeEach(() => {
    process.env.MNEMA_ACTOR = 'daniel';
  });

  it('blocks approve on an unmerged PR when policy=block', async () => {
    harness = await setupHarness('block', ghRunner(OPEN));
    const key = await taskInReview(harness.client);
    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(parsePayload(result).error).toBe('GATE_FAILED');
  });

  it('blocks approve on a merged-but-red-CI PR when policy=block', async () => {
    harness = await setupHarness('block', ghRunner(MERGED_RED));
    const key = await taskInReview(harness.client);
    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(parsePayload(result).error).toBe('GATE_FAILED');
  });

  it('allows approve on a merged+green PR when policy=block', async () => {
    harness = await setupHarness('block', ghRunner(MERGED_GREEN));
    const key = await taskInReview(harness.client);
    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    if (result.isError) console.error('GREEN_FAIL', JSON.stringify(parsePayload(result)));
    expect(result.isError).toBeFalsy();
    expect((parsePayload(result).task as { state: string }).state).toBe('DONE');
  });

  it('warns but allows approve on an unmerged PR when policy=warn', async () => {
    harness = await setupHarness('warn', ghRunner(OPEN));
    const key = await taskInReview(harness.client);
    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const payload = parsePayload(result);
    expect((payload.task as { state: string }).state).toBe('DONE');
    expect(String(payload.pr_warning)).toContain('not merged');
  });

  it('does nothing when policy=off (default), even on an unmerged PR', async () => {
    harness = await setupHarness('off', ghRunner(OPEN));
    const key = await taskInReview(harness.client);
    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(parsePayload(result).pr_warning).toBeUndefined();
  });

  it('does not block when gh is unavailable, even under policy=block', async () => {
    // gh missing → available:false → can't prove a problem → don't gate.
    const enoent: CommandRunner = () => ({ status: null, stdout: '', error: new Error('ENOENT') });
    harness = await setupHarness('block', enoent);
    const key = await taskInReview(harness.client);
    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect((parsePayload(result).task as { state: string }).state).toBe('DONE');
  });

  it('blocks approve when the head is green but the base merge commit is red', async () => {
    // The regression the dogfooding run surfaced: a branch can be green and
    // still break the base once merged. The gate must read the base signal.
    harness = await setupHarness(
      'block',
      ghBaseRunner(MERGED_GREEN_HEAD_WITH_MERGE_OID, CHECK_RUNS_RED, COMBINED_EMPTY),
    );
    const key = await taskInReview(harness.client);
    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(parsePayload(result).error).toBe('GATE_FAILED');
  });

  it('allows approve when both the head and the base merge commit are green', async () => {
    harness = await setupHarness(
      'block',
      ghBaseRunner(MERGED_GREEN_HEAD_WITH_MERGE_OID, CHECK_RUNS_GREEN, COMBINED_EMPTY),
    );
    const key = await taskInReview(harness.client);
    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm', pr_url: PR },
    })) as CallToolResult;
    if (result.isError) console.error('GREEN_BASE_FAIL', JSON.stringify(parsePayload(result)));
    expect(result.isError).toBeFalsy();
    expect((parsePayload(result).task as { state: string }).state).toBe('DONE');
  });

  it('does nothing when no pr_url is supplied, even under policy=block', async () => {
    harness = await setupHarness('block', ghRunner(OPEN));
    const key = await taskInReview(harness.client);
    const result = (await harness.client.callTool({
      name: 'task_approve',
      arguments: { task_key: key, approval_note: 'lgtm' },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect((parsePayload(result).task as { state: string }).state).toBe('DONE');
  });
});
