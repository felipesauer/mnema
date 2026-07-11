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

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-relskills-'));
  for (const dir of [
    '.mnema/state',
    '.mnema/audit',
    '.mnema/backlog',
    '.mnema/workflows',
    'skills',
  ]) {
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
  const container: ServiceContainer = createServiceContainer(config, projectRoot, {
    migrationsDir,
    userDir: null,
  });
  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'test-agent' });
  server.registerTools();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(st);
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(ct);
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

function payload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected text content');
  return JSON.parse(block.text) as Record<string, unknown>;
}

interface RelevantSkill {
  slug: string;
  name: string | null;
  snippet: string;
}

describe('context_bootstrap injects skills relevant to the active task (MNEMA-235)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'rel skills' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('surfaces a skill whose text matches the in-progress task', async () => {
    // A skill about notification channels.
    await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 'add-notification-channel',
        name: 'Add a notification channel',
        description: 'How to wire a new notifier channel into the dispatcher',
        content: 'Register the channel, add config, cover it with a test.',
      },
    });
    // A task about the notifier, driven to IN_PROGRESS.
    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Wire the notifier channel', acceptance_criteria: ['sends'] },
    });
    await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: 'TEST-1',
        title: 'Wire the notifier channel',
        description: 'Add a new notifier dispatcher channel.',
        acceptance_criteria: ['sends'],
        estimate: 2,
      },
    });
    await harness.client.callTool({
      name: 'task_start',
      arguments: { task_key: 'TEST-1', assignee_id: 'daniel' },
    });

    const boot = payload(
      (await harness.client.callTool({
        name: 'context_bootstrap',
        arguments: {},
      })) as CallToolResult,
    );
    const relevant = boot.relevant_skills as RelevantSkill[];
    expect(relevant.some((s) => s.slug === 'add-notification-channel')).toBe(true);
  });

  it('is empty when nothing is in focus', async () => {
    const boot = payload(
      (await harness.client.callTool({
        name: 'context_bootstrap',
        arguments: {},
      })) as CallToolResult,
    );
    expect(boot.relevant_skills).toEqual([]);
  });
});
