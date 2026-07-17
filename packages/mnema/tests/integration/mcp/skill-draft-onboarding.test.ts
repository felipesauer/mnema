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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-skilldraft-'));
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

interface SkillDraft {
  slug: string;
  name: string;
  description: string;
  steps: string;
}

describe('run-end skill draft onboarding', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setupHarness();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('offers a skill draft whose steps come from the run’s real actions', async () => {
    await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'Add the audit verify tool' },
    });
    const created = await harness.client.callTool({
      name: 'task_create',
      arguments: { title: 'Touched task' },
    });
    const key = (parsePayload(created as CallToolResult).task as { key: string }).key;

    const ended = await harness.client.callTool({
      name: 'agent_run_end',
      arguments: { status: 'completed' },
    });
    const payload = parsePayload(ended as CallToolResult);

    // The reminder still fires...
    expect(payload.reminder).toBeDefined();
    // ...and now carries a concrete draft whose steps are the run's real
    // actions (creating that task), not placeholders.
    const draft = payload.skill_draft as SkillDraft;
    expect(draft).toBeDefined();
    expect(draft.name).toBe('Add the audit verify tool');
    expect(draft.slug).toBe('add-the-audit-verify-tool');
    expect(draft.steps).toContain(`create task ${key}`);
    // No misleading placeholder from the old template.
    expect(draft.steps).not.toContain('first step you took');
    expect(draft.steps).toContain('skill_record');
  });

  it('generalises a repeated per-task cycle into one skill draft', async () => {
    await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'Ship two small tasks the same way' },
    });
    // Drive TWO tasks through the same submit → start cycle.
    for (const title of ['First', 'Second']) {
      const created = parsePayload(
        (await harness.client.callTool({
          name: 'task_create',
          arguments: { title, acceptance_criteria: ['done'] },
        })) as CallToolResult,
      );
      const key = (created.task as { key: string }).key;
      await harness.client.callTool({
        name: 'task_submit',
        arguments: {
          task_key: key,
          title,
          description: `${title} — ready`,
          acceptance_criteria: ['done'],
          estimate: 1,
        },
      });
      await harness.client.callTool({
        name: 'task_start',
        arguments: { task_key: key, assignee_id: 'daniel' },
      });
    }

    const ended = await harness.client.callTool({
      name: 'agent_run_end',
      arguments: { status: 'completed' },
    });
    const draft = parsePayload(ended as CallToolResult).skill_draft as SkillDraft;
    expect(draft).toBeDefined();
    // The repeated cycle is recognised and generalised, not listed twice.
    expect(draft.description).toContain('cycle');
    expect(draft.description).toContain('2');
    expect(draft.steps).toContain('submit');
    expect(draft.steps).toContain('start');
  });

  it('does not offer a skill draft when the run recorded a skill', async () => {
    await harness.client.callTool({
      name: 'agent_run_start',
      arguments: { goal: 'A run that captures a skill' },
    });
    await harness.client.callTool({
      name: 'skill_record',
      arguments: {
        slug: 'something-learned',
        name: 'Something learned',
        description: 'A real captured procedure.',
        content: 'Do the thing, then verify it.',
      },
    });

    const ended = await harness.client.callTool({
      name: 'agent_run_end',
      arguments: { status: 'completed' },
    });
    const payload = parsePayload(ended as CallToolResult);
    expect(payload.reminder).toBeUndefined();
    expect(payload.skill_draft).toBeUndefined();
  });
});
