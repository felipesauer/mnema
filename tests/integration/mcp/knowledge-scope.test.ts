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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-scope-'));
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
}

describe('knowledge scope narrows relevance by area (MNEMA-238)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'scope' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('surfaces a skill scoped to the focus task’s label, even without a text match', async () => {
    // A skill scoped to packages/notifier whose text does NOT overlap the task.
    await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 'channel-recipe',
        name: 'Channel recipe',
        description: 'Steps for the dispatcher subsystem',
        content: 'unrelated words alpha beta gamma',
        scope: 'packages/notifier',
      },
    });
    // A task labelled packages/notifier, driven to IN_PROGRESS.
    await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Ship the quarterly report', acceptance_criteria: ['done'] },
    });
    await harness.client.callTool({
      name: 'task_set_labels',
      arguments: { task_key: 'TEST-1', labels: ['packages/notifier'] },
    });
    await harness.client.callTool({
      name: 'task_submit',
      arguments: {
        task_key: 'TEST-1',
        title: 'Ship the quarterly report',
        description: 'Produce the report.',
        acceptance_criteria: ['done'],
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
    // Scope match surfaces it despite no text overlap.
    expect(relevant.some((s) => s.slug === 'channel-recipe')).toBe(true);
  });

  it('record round-trips the scope on the skill', async () => {
    await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 'scoped-one',
        name: 'Scoped',
        description: 'd',
        content: 'c',
        scope: 'packages/web',
      },
    });
    const show = payload(
      (await harness.client.callTool({
        name: 'skill_show',
        arguments: { slug: 'scoped-one' },
      })) as CallToolResult,
    );
    expect((show.skill as { scope: string }).scope).toBe('packages/web');
  });
});
