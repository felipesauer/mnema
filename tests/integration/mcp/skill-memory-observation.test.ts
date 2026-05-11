import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
  readonly container: ServiceContainer;
  readonly server: MnemaMcpServer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setupHarness(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-skill-mcp-'));
  for (const dir of [
    '.mnema/state',
    '.mnema/audit',
    '.mnema/backlog',
    '.mnema/workflows',
    '.mnema/skills',
    '.mnema/memory',
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
    project: { key: 'TEST', name: 'Test Project' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });
  container.adapter
    .getDatabase()
    .prepare("INSERT INTO projects (id, key, name) VALUES ('p1', 'TEST', 'Test')")
    .run();

  const server = new MnemaMcpServer(config, projectRoot, container, {
    agent_handle: 'test-agent',
  });
  server.registerTools();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    projectRoot,
    container,
    server,
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

describe('skill/memory/observation MCP tools', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();

    await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'record skills and memories' },
    });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('exposes all 9 new tools alongside the existing ones', async () => {
    const list = await harness.client.listTools();
    const names = new Set(list.tools.map((t) => t.name));
    for (const expected of [
      'skill_record',
      'skill_show',
      'skill_use',
      'skills_list',
      'memory_record',
      'memory_show',
      'memories_list',
      'observation_record',
      'observations_list',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('skill_record creates a row and writes a mirror .md', async () => {
    const result = await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 'safe-migration',
        name: 'Safe migration',
        description: 'How to migrate safely',
        content: '## Steps\n1. take a backup\n2. apply',
      },
    });
    const payload = parsePayload(result as CallToolResult);
    expect(payload.ok).toBe(true);
    expect(payload.action).toBe('created');
    expect(existsSync(path.join(harness.projectRoot, '.mnema/skills/safe-migration.md'))).toBe(
      true,
    );
  });

  it('skill_record mode=new_version bumps the version', async () => {
    await harness.client.callTool({
      name: 'skill_record',
      arguments: { slug: 's', name: 'N', description: 'd', content: 'A' },
    });
    const bumped = await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 's',
        name: 'N',
        description: 'd',
        content: 'B',
        mode: 'new_version',
      },
    });
    const payload = parsePayload(bumped as CallToolResult);
    expect(payload.action).toBe('new_version');
    const skill = payload.skill as { version: number };
    expect(skill.version).toBe(2);
  });

  it('skill_use increments usage_count', async () => {
    await harness.client.callTool({
      name: 'skill_record',
      arguments: { slug: 's', name: 'N', description: 'd', content: 'A' },
    });
    const used = await harness.client.callTool({
      name: 'skill_use',
      arguments: { slug: 's' },
    });
    const payload = parsePayload(used as CallToolResult);
    const skill = payload.skill as {
      slug: string;
      version: number;
      usage_count: number;
      last_used_at: string | null;
      content?: unknown;
    };
    expect(skill.usage_count).toBe(1);
    expect(skill.slug).toBe('s');
    expect(skill.version).toBe(1);
    // F-4: skill_use payload omits content (docstring says so).
    expect(skill.content).toBeUndefined();
  });

  it('memory_record upserts under the same slug', async () => {
    const first = await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'pci', title: 'A', content: 'first' },
    });
    const second = await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'pci', title: 'A', content: 'second' },
    });
    expect(parsePayload(first as CallToolResult).action).toBe('created');
    expect(parsePayload(second as CallToolResult).action).toBe('updated');

    const listed = await harness.client.callTool({
      name: 'memories_list',
      arguments: {},
    });
    const payload = parsePayload(listed as CallToolResult);
    expect((payload.memories as unknown[]).length).toBe(1);
  });

  it('observation_record appends without slug', async () => {
    await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'first' },
    });
    await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'second', topics: ['ci'] },
    });
    const listed = await harness.client.callTool({
      name: 'observations_list',
      arguments: {},
    });
    const payload = parsePayload(listed as CallToolResult);
    expect((payload.observations as unknown[]).length).toBe(2);
  });

  it('context_bootstrap surfaces inventories and recent observations', async () => {
    await harness.client.callTool({
      name: 'skill_record',
      arguments: { slug: 's', name: 'N', description: 'd', content: 'x' },
    });
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'm', title: 'T', content: 'x' },
    });
    await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'noted' },
    });

    const bootstrap = await harness.client.callTool({
      name: 'context_bootstrap',
      arguments: {},
    });
    const payload = parsePayload(bootstrap as CallToolResult);
    expect((payload.skills_inventory as unknown[]).length).toBe(1);
    expect((payload.memories_inventory as unknown[]).length).toBe(1);
    expect((payload.recent_observations as unknown[]).length).toBe(1);
  });

  it('F-5: bootstrap recent_observations includes id and related_task_key', async () => {
    // Need a real task to link against.
    const created = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'A linkable task' },
    });
    const task = parsePayload(created as CallToolResult).task as { key: string };

    await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'linked obs', related_task_key: task.key },
    });
    await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'orphan obs' },
    });

    const bootstrap = await harness.client.callTool({
      name: 'context_bootstrap',
      arguments: {},
    });
    const obs = parsePayload(bootstrap as CallToolResult).recent_observations as Array<{
      id: string;
      content: string;
      related_task_key: string | null;
    }>;
    expect(obs.every((o) => typeof o.id === 'string' && o.id.length > 0)).toBe(true);
    const linked = obs.find((o) => o.content === 'linked obs');
    const orphan = obs.find((o) => o.content === 'orphan obs');
    expect(linked?.related_task_key).toBe(task.key);
    expect(orphan?.related_task_key).toBeNull();
  });

  it('skill_record without an active run returns NO_ACTIVE_RUN', async () => {
    await harness.client.callTool({ name: 'agent_run_end', arguments: { status: 'completed' } });

    const result = await harness.client.callTool({
      name: 'skill_record',
      arguments: { slug: 's', name: 'N', description: 'd', content: 'x' },
    });
    expect((result as CallToolResult).isError).toBe(true);
    const payload = parsePayload(result as CallToolResult);
    expect(payload.error).toBe('NO_ACTIVE_RUN');
  });
});
