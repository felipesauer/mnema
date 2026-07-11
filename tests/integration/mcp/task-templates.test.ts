import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  readonly projectRoot: string;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-tmpl-'));
  for (const dir of [
    '.mnema/state',
    '.mnema/audit',
    '.mnema/backlog',
    '.mnema/workflows',
    '.mnema/templates',
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
    projectRoot,
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

interface CreatedTask {
  description: string | null;
  acceptanceCriteria: string[];
}

describe('task_create --template pre-fills a per-kind skeleton (MNEMA-233)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'templates' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('fills description + acceptance_criteria from the built-in bug template', async () => {
    const created = payload(
      (await harness.client.callTool({
        name: 'task_create',
        arguments: { title: 'Login 500s', template: 'bug' },
      })) as CallToolResult,
    );
    const task = created.task as CreatedTask;
    expect(task.description).toContain('What is wrong');
    expect(task.acceptanceCriteria.some((c) => c.includes('regression test'))).toBe(true);
  });

  it('does not override a caller-supplied description', async () => {
    const created = payload(
      (await harness.client.callTool({
        name: 'task_create',
        arguments: {
          title: 'Login 500s',
          template: 'bug',
          description: 'my own words',
        },
      })) as CallToolResult,
    );
    const task = created.task as CreatedTask;
    expect(task.description).toBe('my own words');
    // Criteria were omitted, so the template still fills those.
    expect(task.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('honours a project override in templates/<kind>.md', async () => {
    writeFileSync(
      path.join(harness.projectRoot, '.mnema/templates', 'chore.md'),
      '---\ndescription: CUSTOM chore skeleton\nacceptance_criteria:\n  - custom criterion\n---\n# chore\n',
      'utf-8',
    );
    const created = payload(
      (await harness.client.callTool({
        name: 'task_create',
        arguments: { title: 'Tidy up', template: 'chore' },
      })) as CallToolResult,
    );
    const task = created.task as CreatedTask;
    expect(task.description).toBe('CUSTOM chore skeleton');
    expect(task.acceptanceCriteria).toEqual(['custom criterion']);
  });
});
