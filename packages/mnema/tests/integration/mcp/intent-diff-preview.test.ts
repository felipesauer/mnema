import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '@mnema/core/config/config-schema.js';
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

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-intent-'));
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
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
  const container: ServiceContainer = createServiceContainer(config, projectRoot, {
    migrationsDir,
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

describe('intent-diff preview before destructive mutation (MNEMA-228)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'intent setup' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('epic_delete preview reports attached tasks and refuses-would-be, without deleting', async () => {
    const epic = payload(
      (await harness.client.callTool({
        name: 'epic_create',
        arguments: { title: 'Big epic' },
      })) as CallToolResult,
    );
    const epicId = (epic.epic as { id: string }).id;
    // Two tasks attached to the epic.
    for (const title of ['Task one', 'Task two']) {
      const created = payload(
        (await harness.client.callTool({
          name: 'task_create',
          arguments: { title, acceptance_criteria: ['x'] },
        })) as CallToolResult,
      );
      await harness.client.callTool({
        name: 'epic_add_task',
        arguments: { epic_key: epicId, task_key: (created.task as { id: string }).id },
      });
    }

    const preview = payload(
      (await harness.client.callTool({
        name: 'epic_delete',
        arguments: { epic_key: epicId, preview: true },
      })) as CallToolResult,
    );
    expect(preview.preview).toBe(true);
    const impact = preview.impact as {
      attached_task_count: number;
      delete_would_be_refused: boolean;
    };
    expect(impact.attached_task_count).toBe(2);
    expect(impact.delete_would_be_refused).toBe(true);
    expect(String(preview.summary)).toContain('REFUSED');

    // Non-destructive: the epic is still there and still OPEN.
    const show = payload(
      (await harness.client.callTool({
        name: 'epic_show',
        arguments: { epic_key: epicId },
      })) as CallToolResult,
    );
    expect((show.epic as { state: string }).state).toBe('OPEN');
    expect((show.epic as { task_keys?: string[] }) !== undefined).toBe(true);
  });

  it('epic_close preview flags non-terminal tasks a close would strand', async () => {
    const epic = payload(
      (await harness.client.callTool({
        name: 'epic_create',
        arguments: { title: 'Epic C' },
      })) as CallToolResult,
    );
    const epicId = (epic.epic as { id: string }).id;
    const created = payload(
      (await harness.client.callTool({
        name: 'task_create',
        arguments: { title: 'Unfinished', acceptance_criteria: ['x'] },
      })) as CallToolResult,
    );
    await harness.client.callTool({
      name: 'epic_add_task',
      arguments: { epic_key: epicId, task_key: (created.task as { id: string }).id },
    });

    const preview = payload(
      (await harness.client.callTool({
        name: 'epic_close',
        arguments: { epic_key: epicId, preview: true },
      })) as CallToolResult,
    );
    const impact = preview.impact as { non_terminal_task_keys: string[] };
    expect(impact.non_terminal_task_keys.length).toBe(1);
    expect(String(preview.summary)).toContain('strand');
  });

  it('memory_archive preview lists dangling wikilink references, without archiving', async () => {
    // A memory that is linked to by another memory via [[slug]].
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'target-fact', title: 'Target', content: 'the referenced fact' },
    });
    await harness.client.callTool({
      name: 'memory_record',
      arguments: {
        slug: 'referrer',
        title: 'Referrer',
        content: 'see [[target-fact]] for details',
      },
    });

    const preview = payload(
      (await harness.client.callTool({
        name: 'memory_archive',
        arguments: { slug: 'target-fact', preview: true },
      })) as CallToolResult,
    );
    expect(preview.preview).toBe(true);
    const impact = preview.impact as { dangling_reference_files: string[] };
    expect(impact.dangling_reference_files.length).toBeGreaterThanOrEqual(1);

    // Non-destructive: the memory is still listed (not archived).
    const list = payload(
      (await harness.client.callTool({ name: 'memories_list', arguments: {} })) as CallToolResult,
    );
    const slugs = (list.memories as { slug: string }[]).map((m) => m.slug);
    expect(slugs).toContain('target-fact');
  });
});
