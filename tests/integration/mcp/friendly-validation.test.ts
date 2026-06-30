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
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setupHarness(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-validation-'));
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

describe('friendly pre-handler validation errors', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'validation' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('rewrites a missing required field into a structured VALIDATION_FAILED, not a raw Zod dump', async () => {
    // Create a task and drive it to IN_REVIEW so task_submit_review is
    // a legal transition — the failure we want is the missing pr_url,
    // not an invalid-transition error.
    const created = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Needs a PR url' },
    });
    const key = (parsePayload(created as CallToolResult).task as { key: string }).key;
    await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: key,
        title: 'Needs a PR url',
        description: 'A description long enough to pass the readiness gate.',
        acceptance_criteria: ['works'],
        estimate: 3,
      },
    });
    await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: key, assignee_id: 'daniel' },
    });

    // Missing required `pr_url` — the SDK validates before the handler.
    const result = (await harness.client.callTool({
      name: 'task_submit_review',
      arguments: { task_key: key },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    const payload = parsePayload(result);

    // Canonical structured shape, not the raw "[{expected:string,...}]" dump.
    expect(payload.error).toBe('VALIDATION_FAILED');
    expect(payload.tool).toBe('task_submit_review');
    const issues = payload.issues as { path: string[]; message: string }[];
    expect(issues.some((i) => i.path.includes('pr_url'))).toBe(true);
    // Human, field-named message from the global Zod error map.
    const prIssue = issues.find((i) => i.path.includes('pr_url'));
    expect(prIssue?.message).toBe('pr_url is required');

    // The raw SDK prefix and JSON-dump keys must NOT survive.
    const text = JSON.stringify(payload);
    expect(text).not.toContain('Invalid arguments for tool');
    expect(text).not.toContain('"expected"');
  });

  it('leaves a normal domain error untouched', async () => {
    // A non-validation failure (unknown task) should pass through as its
    // own structured error, not be mistaken for a validation leak.
    const result = (await harness.client.callTool({
      name: 'task_show',
      arguments: { task_key: 'TEST-9999' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload.error).toBe('TASK_NOT_FOUND');
  });
});
