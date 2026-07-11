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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-skilldiff-'));
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

describe('skill_diff shows version diff + change rationale (MNEMA-237)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'skill diff' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('diffs two versions and returns the newer version rationale', async () => {
    await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 'close-a-task',
        name: 'Close a task',
        description: 'How to close a task',
        content: 'Step 1: submit\nStep 2: review\nStep 3: approve',
      },
    });
    const bump = payload(
      (await harness.client.callTool({
        name: 'skill_record',
        arguments: {
          slug: 'close-a-task',
          name: 'Close a task',
          description: 'How to close a task',
          content: 'Step 1: submit\nStep 2: review\nStep 3: approve with note\nStep 4: attach PR',
          mode: 'new_version',
          change_rationale: 'the approve gate now requires a note and a PR link',
        },
      })) as CallToolResult,
    );
    expect(bump.action as string).toBe('new_version');

    const diff = payload(
      (await harness.client.callTool({
        name: 'skill_diff',
        arguments: { slug: 'close-a-task' },
      })) as CallToolResult,
    );
    expect(diff.from_version).toBe(1);
    expect(diff.to_version).toBe(2);
    expect(diff.change_rationale).toBe('the approve gate now requires a note and a PR link');

    const hunks = diff.hunks as { kind: string; text: string }[];
    // The changed step is a remove + add; the new step is a pure add.
    expect(hunks.some((h) => h.kind === 'remove' && h.text === 'Step 3: approve')).toBe(true);
    expect(hunks.some((h) => h.kind === 'add' && h.text === 'Step 4: attach PR')).toBe(true);
    // The unchanged first line is context.
    expect(hunks.some((h) => h.kind === 'context' && h.text === 'Step 1: submit')).toBe(true);
  });

  it('diffs a single version against an empty base (whole body added)', async () => {
    await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 'only-one',
        name: 'Only one',
        description: 'single version',
        content: 'alpha\nbeta',
      },
    });
    const diff = payload(
      (await harness.client.callTool({
        name: 'skill_diff',
        arguments: { slug: 'only-one' },
      })) as CallToolResult,
    );
    expect(diff.from_version).toBe(0);
    expect(diff.to_version).toBe(1);
    expect(diff.change_rationale).toBeNull();
    const hunks = diff.hunks as { kind: string; text: string }[];
    expect(hunks.every((h) => h.kind === 'add')).toBe(true);
    expect(hunks.map((h) => h.text)).toEqual(['alpha', 'beta']);
  });
});
