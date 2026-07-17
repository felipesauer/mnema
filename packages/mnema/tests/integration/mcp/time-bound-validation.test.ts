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

async function setupHarness(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-timebound-'));
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

describe('malformed since/until is rejected, never failing open to all-time', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  for (const bad of ['last week', '2026-13-40', '2026-02-30']) {
    it(`audit_query rejects a malformed since (${bad}) with a structured validation error`, async () => {
      const result = (await harness.client.callTool({
        name: 'audit_query',
        arguments: { since: bad },
      })) as CallToolResult;

      expect(result.isError).toBe(true);
      const payload = parsePayload(result);
      expect(payload.error).toBe('VALIDATION_FAILED');
      const issues = payload.issues as { path: string[]; message: string }[];
      expect(issues.some((i) => i.path.includes('since'))).toBe(true);
      // Not a silent all-time dump.
      expect(payload.events).toBeUndefined();
    });
  }

  it('audit_query rejects a malformed until', async () => {
    const result = (await harness.client.callTool({
      name: 'audit_query',
      arguments: { until: 'not-a-date' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload.error).toBe('VALIDATION_FAILED');
    expect((payload.issues as { path: string[] }[]).some((i) => i.path.includes('until'))).toBe(
      true,
    );
  });

  it('metrics_flow rejects a malformed since with a structured validation error', async () => {
    const result = (await harness.client.callTool({
      name: 'metrics_flow',
      arguments: { since: 'last week' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload.error).toBe('VALIDATION_FAILED');
    expect((payload.issues as { path: string[] }[]).some((i) => i.path.includes('since'))).toBe(
      true,
    );
    expect(payload.metrics).toBeUndefined();
  });

  it('history_get rejects a malformed since with a structured validation error', async () => {
    const result = (await harness.client.callTool({
      name: 'history_get',
      arguments: { since: '2026-13-40' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload.error).toBe('VALIDATION_FAILED');
    expect((payload.issues as { path: string[] }[]).some((i) => i.path.includes('since'))).toBe(
      true,
    );
    expect(payload.events).toBeUndefined();
  });

  it('a valid ISO-8601 and a valid relative duration still pass through', async () => {
    const iso = (await harness.client.callTool({
      name: 'audit_query',
      arguments: { since: '2026-01-01T00:00:00Z' },
    })) as CallToolResult;
    expect(iso.isError).toBeFalsy();
    expect(parsePayload(iso).ok).toBe(true);

    const relative = (await harness.client.callTool({
      name: 'metrics_flow',
      arguments: { since: '30d' },
    })) as CallToolResult;
    expect(relative.isError).toBeFalsy();
    expect(parsePayload(relative).ok).toBe(true);

    const dateOnly = (await harness.client.callTool({
      name: 'history_get',
      arguments: { since: '2026-01-01' },
    })) as CallToolResult;
    expect(dateOnly.isError).toBeFalsy();
    expect(parsePayload(dateOnly).ok).toBe(true);
  });
});
