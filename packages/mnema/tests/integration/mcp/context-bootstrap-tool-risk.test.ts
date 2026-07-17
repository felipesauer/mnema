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
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');
const fixtureWorkflows = path.resolve('packages/core/tests/fixtures/workflows');

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
    path.join(workflowName === 'default' ? workflowsSrc : fixtureWorkflows, `${workflowName}.json`),
    // The runtime always loads default.json; a retired-preset fixture
    // stands in AS default.json to exercise the feature-gating machinery.
    path.join(projectRoot, '.mnema/workflows', 'default.json'),
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

// The risk vocabulary used to be duplicated into the context_bootstrap payload
// (a `tool_risk` map). It was removed because tools/list already carries the
// same annotations for every tool and lands in the model's context at session
// start, so bootstrap was paying ~8.8k tokens to repeat it. These tests lock
// in that the payload no longer carries it AND that the information a client
// needs for a permission policy is still fully available — via tools/list.
describe('context_bootstrap no longer duplicates the tool risk vocabulary', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('does not emit a tool_risk block in the bootstrap payload', async () => {
    const boot = payload(
      (await harness.client.callTool({
        name: 'context_bootstrap',
        arguments: {},
      })) as CallToolResult,
    );
    expect(boot.tool_risk).toBeUndefined();
    // The unique layered view is retained — this is what bootstrap keeps.
    expect(boot.tool_groups).toBeDefined();
  });

  it('the same risk annotations are still available for every tool via tools/list', async () => {
    // What tool_risk used to provide, tools/list carries losslessly: each
    // advertised tool has readOnly/destructive/idempotent/openWorld hints.
    const list = await harness.client.listTools();
    const byName = new Map(list.tools.map((t) => [t.name, t.annotations]));

    // A read-only tool: only readOnly + openWorld, no destructive/idempotent.
    expect(byName.get('task_show')).toEqual({ readOnlyHint: true, openWorldHint: false });
    // The one open-world read.
    expect(byName.get('pr_status')).toEqual({ readOnlyHint: true, openWorldHint: true });
    // A destructive write.
    const epicDelete = byName.get('epic_delete') as ToolAnnotations | undefined;
    expect(epicDelete?.readOnlyHint).toBe(false);
    expect(epicDelete?.destructiveHint).toBe(true);
    // A derived transition tool: a mutation, destructive on the rewind.
    const reopen = byName.get('task_reopen') as ToolAnnotations | undefined;
    expect(reopen?.readOnlyHint).toBe(false);
    expect(reopen?.destructiveHint).toBe(true);
    // A forward transition: a mutation but not destructive.
    const submit = byName.get('task_submit') as ToolAnnotations | undefined;
    expect(submit?.readOnlyHint).toBe(false);
    expect(submit?.destructiveHint).toBe(false);
  });

  it('gated profile: tools/list drops disabled tools (no risk info leaks for them)', async () => {
    // Audit-only: lean workflow (no epics/sprints) + knowledge off. The gating
    // that tool_risk used to have to mirror is inherent to tools/list.
    const audit = await setup({ workflow: 'lean', knowledge: false });
    try {
      const advertised = new Set((await audit.client.listTools()).tools.map((t) => t.name));
      // Knowledge / planning tools are gated OFF → absent from tools/list.
      for (const gated of ['memory_record', 'skill_record', 'decision_record', 'epic_delete']) {
        expect(advertised.has(gated), `${gated} must be absent in audit-only`).toBe(false);
      }
      // Core stays.
      expect(advertised.has('task_show')).toBe(true);

      // And the bootstrap payload still carries no tool_risk in this profile.
      const boot = payload(
        (await audit.client.callTool({
          name: 'context_bootstrap',
          arguments: {},
        })) as CallToolResult,
      );
      expect(boot.tool_risk).toBeUndefined();
    } finally {
      await audit.close();
    }
  });
});
