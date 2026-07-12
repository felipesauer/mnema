import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(
  options: { workflow?: 'default' | 'lean'; knowledge?: boolean } = {},
): Promise<Harness> {
  const workflowName = options.workflow ?? 'default';
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-ctx-risk-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, `${workflowName}.json`),
    path.join(projectRoot, '.mnema/workflows', `${workflowName}.json`),
  );
  const config = ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: workflowName,
    ...(options.knowledge === false ? { features: { knowledge: false } } : {}),
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });
  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'test-agent' });
  server.registerTools();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(st);
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(ct);
  return {
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

function payload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected text content');
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe('context_bootstrap surfaces the tool risk vocabulary', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('exposes tool_risk with correct hints for a sample of tools', async () => {
    const boot = payload(
      (await harness.client.callTool({
        name: 'context_bootstrap',
        arguments: {},
      })) as CallToolResult,
    );
    const risk = boot.tool_risk as Record<string, ToolAnnotations>;
    expect(risk).toBeDefined();

    // A read-only tool: only readOnly + openWorld, no destructive/idempotent.
    expect(risk.task_show).toEqual({ readOnlyHint: true, openWorldHint: false });
    // The one open-world read.
    expect(risk.pr_status).toEqual({ readOnlyHint: true, openWorldHint: true });
    // A destructive write.
    expect(risk.epic_delete?.readOnlyHint).toBe(false);
    expect(risk.epic_delete?.destructiveHint).toBe(true);
    // A derived transition tool: present, a mutation, destructive on the rewind.
    expect(risk.task_reopen?.readOnlyHint).toBe(false);
    expect(risk.task_reopen?.destructiveHint).toBe(true);
    // A forward transition: a mutation but not destructive.
    expect(risk.task_submit?.readOnlyHint).toBe(false);
    expect(risk.task_submit?.destructiveHint).toBe(false);
  });

  it('tool_risk matches, for every advertised tool, what tools/list carries', async () => {
    const boot = payload(
      (await harness.client.callTool({
        name: 'context_bootstrap',
        arguments: {},
      })) as CallToolResult,
    );
    const risk = boot.tool_risk as Record<string, ToolAnnotations>;

    const list = await harness.client.listTools();
    // Exact key-set equality both ways: every advertised tool is in tool_risk,
    // AND tool_risk carries no extra (unadvertised) key.
    const advertised = new Set(list.tools.map((t) => t.name));
    expect(new Set(Object.keys(risk))).toEqual(advertised);
    for (const tool of list.tools) {
      expect(tool.annotations, `${tool.name} annotation matches`).toEqual(risk[tool.name]);
    }
  });

  it('gated profile: tool_risk drops disabled tools and matches the advertised set exactly', async () => {
    // Audit-only: lean workflow (no epics/sprints) + knowledge off.
    const audit = await setup({ workflow: 'lean', knowledge: false });
    try {
      const boot = payload(
        (await audit.client.callTool({
          name: 'context_bootstrap',
          arguments: {},
        })) as CallToolResult,
      );
      const risk = boot.tool_risk as Record<string, ToolAnnotations>;

      // Knowledge / planning tools are gated OFF → absent from tool_risk,
      // not merely present-but-unregistered (the over-listing bug this guards).
      for (const gated of ['memory_record', 'skill_record', 'decision_record', 'epic_delete']) {
        expect(risk[gated], `${gated} must be absent in audit-only`).toBeUndefined();
      }
      // Core stays.
      expect(risk.task_show).toBeDefined();

      // And it equals the advertised set exactly — no extra keys.
      const advertised = new Set((await audit.client.listTools()).tools.map((t) => t.name));
      expect(new Set(Object.keys(risk))).toEqual(advertised);
    } finally {
      await audit.close();
    }
  });
});
