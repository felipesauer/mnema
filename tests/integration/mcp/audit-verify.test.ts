import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  readonly auditDir: string;
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setupHarness(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-audit-verify-'));
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
  const container = createServiceContainer(config, projectRoot, { migrationsDir });

  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'test-agent' });
  server.registerTools();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    projectRoot,
    auditDir: path.join(projectRoot, '.mnema/audit'),
    container,
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

/** Generate at least one chained audit event so the integrity check is live. */
async function recordSomeHistory(client: Client): Promise<void> {
  await client.callTool({ name: 'agent_run_start', arguments: { goal: 'seed audit history' } });
  await client.callTool({ name: 'task_create', arguments: { title: 'A task that emits events' } });
}

/** Find the single JSONL file the audit writer produced. */
function auditFile(auditDir: string): string {
  const files = readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'));
  if (files.length === 0) throw new Error('no audit jsonl file produced');
  return path.join(auditDir, files[0] as string);
}

interface VerifyPayload {
  ok: boolean;
  intact: boolean;
  checks: { name: string; ok: boolean; detail: string; severity?: string }[];
}

describe('audit_verify MCP tool', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('is registered and requires no active run (read-only)', async () => {
    // Called before any agent_run_start — must not fail with NO_ACTIVE_RUN.
    const result = (await harness.client.callTool({
      name: 'audit_verify',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const payload = parsePayload(result) as unknown as VerifyPayload;
    expect(payload.ok).toBe(true);
  });

  it('reports intact=true for a healthy hash chain', async () => {
    await recordSomeHistory(harness.client);

    const result = (await harness.client.callTool({
      name: 'audit_verify',
      arguments: {},
    })) as CallToolResult;
    const payload = parsePayload(result) as unknown as VerifyPayload;

    expect(payload.intact).toBe(true);
    expect(payload.checks.every((c) => c.ok)).toBe(true);
    // The chain check should have actually run (not the legacy/dormant path).
    const chain = payload.checks.find((c) => c.name === 'audit hash chain');
    expect(chain?.ok).toBe(true);
  });

  it('reports intact=false and flags the broken link for a tampered chain', async () => {
    await recordSomeHistory(harness.client);

    // Tamper: rewrite a chained event's payload on disk without
    // recomputing its hash, so the SHA-256 recompute no longer matches.
    const file = auditFile(harness.auditDir);
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    const idx = lines.findIndex((l) => {
      const e = JSON.parse(l) as { v?: number };
      return typeof e.v === 'number' && e.v >= 2;
    });
    expect(idx).toBeGreaterThanOrEqual(0);
    const event = JSON.parse(lines[idx] as string) as Record<string, unknown>;
    event.actor = 'mallory-the-forger';
    lines[idx] = JSON.stringify(event);
    writeFileSync(file, `${lines.join('\n')}\n`);

    const result = (await harness.client.callTool({
      name: 'audit_verify',
      arguments: {},
    })) as CallToolResult;
    const payload = parsePayload(result) as unknown as VerifyPayload;

    expect(payload.intact).toBe(false);
    const chain = payload.checks.find((c) => c.name === 'audit hash chain');
    expect(chain?.ok).toBe(false);
    expect(chain?.severity).toBe('error');
  });
});
