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

/**
 * Evidence for MNEMA-ADR-28: "every producer (CLI, MCP, direct caller) rejects
 * invalid numeric input identically." This drives the SAME bad inputs through
 * both the service (the direct/CLI path — the CLI argParsers reject the string
 * forms before this, so the service is the floor every caller shares) AND the
 * MCP tool via a real in-memory client, and asserts the two AGREE: both reject,
 * neither silently persists. A divergence here is a producer/consumer gap.
 */
const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-parity-'));
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
  const container = createServiceContainer(config, projectRoot, { migrationsDir });

  const server = new MnemaMcpServer(config, projectRoot, container, { agent_handle: 'test-agent' });
  server.registerTools();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sdk = server.getSdkServer();
  await sdk.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

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

/** True when an MCP call rejected the input (either schema-rejected or a structured isError). */
function mcpRejected(result: CallToolResult): boolean {
  return result.isError === true;
}

describe('producer/consumer validation parity (MNEMA-ADR-28)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
    // MCP mutations need an active run.
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'parity probe' } });
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  // Each row: a bad value plus its name on each surface (the service uses
  // camelCase, the MCP tool snake_case). Both producers must reject it. The
  // "good" control proves the agreement is not vacuous.
  const taskCases = [
    {
      label: 'context_budget negative',
      svcField: 'contextBudget',
      mcpField: 'context_budget',
      value: -10,
    },
    {
      label: 'context_budget float',
      svcField: 'contextBudget',
      mcpField: 'context_budget',
      value: 3.7,
    },
    {
      label: 'context_budget NaN',
      svcField: 'contextBudget',
      mcpField: 'context_budget',
      value: Number('abc'),
    },
    { label: 'estimate negative', svcField: 'estimate', mcpField: 'estimate', value: -1 },
    { label: 'estimate float', svcField: 'estimate', mcpField: 'estimate', value: 2.5 },
  ] as const;

  for (const c of taskCases) {
    it(`task_create rejects ${c.label} on BOTH the service and MCP`, async () => {
      // Service path (shared by CLI + direct callers).
      const svc = harness.container.task.create({
        projectKey: 'TEST',
        title: 'probe',
        [c.svcField]: c.value,
        actor: 'daniel',
      } as Parameters<typeof harness.container.task.create>[0]);
      expect(svc.ok, `service should reject ${c.label}`).toBe(false);

      // MCP path (real client round-trip).
      const mcp = (await harness.client.callTool({
        name: 'task_create',
        arguments: { title: 'probe', [c.mcpField]: c.value },
      })) as CallToolResult;
      expect(mcpRejected(mcp), `MCP should reject ${c.label}`).toBe(true);
    });
  }

  it('task_create accepts the valid control on BOTH (agreement is not vacuous)', async () => {
    const svc = harness.container.task.create({
      projectKey: 'TEST',
      title: 'good',
      contextBudget: 0,
      estimate: 5,
      actor: 'daniel',
    });
    expect(svc.ok).toBe(true);

    const mcp = (await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'good', context_budget: 0, estimate: 5 },
    })) as CallToolResult;
    expect(mcpRejected(mcp)).toBe(false);
  });

  it('task_attach_evidence rejects a fractional criterion index on BOTH', async () => {
    // seed a task with two criteria via the service
    const created = harness.container.task.create({
      projectKey: 'TEST',
      title: 'with criteria',
      acceptanceCriteria: ['a', 'b'],
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    const svc = harness.container.taskEvidence.attach({
      taskKey: id,
      criterionIndex: 0.5,
      ref: 'x',
      actor: 'daniel',
    });
    expect(svc.ok).toBe(false);

    const mcp = (await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: { task_key: id, criterion_index: 0.5, ref: 'x' },
    })) as CallToolResult;
    expect(mcpRejected(mcp)).toBe(true);
  });
});
