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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-contradict-'));
  for (const dir of [
    '.mnema/state',
    '.mnema/audit',
    '.mnema/backlog',
    '.mnema/workflows',
    'memory',
  ]) {
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

interface InventoryMemory {
  slug: string;
  obsolete?: boolean;
  obsoleted_by?: string;
}

describe('memory_contradict annotates + de-ranks the obsoleted memory (MNEMA-240)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'contradict' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('marks A obsolete when B contradicts it; A stays listed but de-ranked', async () => {
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'old-fact', title: 'Old fact', content: 'the isup port is 5000' },
    });
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'new-fact', title: 'New fact', content: 'the isup port is actually 6000' },
    });

    // B (new-fact) contradicts A (old-fact).
    const res = payload(
      (await harness.client.callTool({
        name: 'memory_contradict',
        arguments: { slug: 'new-fact', obsoletes: 'old-fact' },
      })) as CallToolResult,
    );
    expect((res.obsoleted as { obsoletedBy?: string }).obsoletedBy).toBe('new-fact');

    // The bootstrap inventory annotates old-fact obsolete, and it sinks below
    // the live memory (de-ranked).
    const boot = payload(
      (await harness.client.callTool({
        name: 'context_bootstrap',
        arguments: {},
      })) as CallToolResult,
    );
    const inv = boot.memories_inventory as InventoryMemory[];
    const old = inv.find((m) => m.slug === 'old-fact');
    const fresh = inv.find((m) => m.slug === 'new-fact');
    expect(old?.obsolete).toBe(true);
    expect(old?.obsoleted_by).toBe('new-fact');
    expect(fresh?.obsolete).toBeUndefined();
    // De-ranked: the live memory appears before the obsoleted one.
    expect(inv.findIndex((m) => m.slug === 'new-fact')).toBeLessThan(
      inv.findIndex((m) => m.slug === 'old-fact'),
    );
  });

  it('rejects a memory contradicting itself', async () => {
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'solo', title: 'Solo', content: 'x' },
    });
    const res = (await harness.client.callTool({
      name: 'memory_contradict',
      arguments: { slug: 'solo', obsoletes: 'solo' },
    })) as CallToolResult;
    expect(res.isError ?? false).toBe(true);
  });
});
