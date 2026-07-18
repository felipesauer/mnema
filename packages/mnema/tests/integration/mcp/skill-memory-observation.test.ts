import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
    version: '2.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test Project' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });

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

  it('exposes the knowledge tools alongside the existing ones', async () => {
    const list = await harness.client.listTools();
    const names = new Set(list.tools.map((t) => t.name));
    for (const expected of [
      'skill_record',
      'skill_show',
      'skill_use',
      'skills_list',
      'skill_supersede',
      'memory_record',
      'memory_show',
      'memories_list',
      'memory_archive',
      'memory_supersede',
      'observation_record',
      'observations_list',
      'observation_archive',
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
    // ADR-51: an agent/human-authored skill mirrors under authored/.
    expect(
      existsSync(path.join(harness.projectRoot, '.mnema/skills/authored/safe-migration.md')),
    ).toBe(true);
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
    // skill_use payload omits content (docstring says so).
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

  it('observation_archive hides the row from the default list; include_archived reveals it', async () => {
    const rec = await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'to be retired' },
    });
    const observation = parsePayload(rec as CallToolResult).observation as { id: string };

    const archived = await harness.client.callTool({
      name: 'observation_archive',
      arguments: { observation_id: observation.id },
    });
    const archivedPayload = parsePayload(archived as CallToolResult);
    expect(archivedPayload.ok).toBe(true);
    expect(archivedPayload.archived).toBe(true);

    // Default list excludes it.
    const def = await harness.client.callTool({ name: 'observations_list', arguments: {} });
    expect((parsePayload(def as CallToolResult).observations as unknown[]).length).toBe(0);

    // include_archived reveals it (the snake_case→camelCase remap works).
    const withArchived = await harness.client.callTool({
      name: 'observations_list',
      arguments: { include_archived: true },
    });
    expect((parsePayload(withArchived as CallToolResult).observations as unknown[]).length).toBe(1);
  });

  it('observation_archive returns OBSERVATION_NOT_FOUND for an unknown id', async () => {
    const result = await harness.client.callTool({
      name: 'observation_archive',
      arguments: { observation_id: 'no-such-observation' },
    });
    const payload = parsePayload(result as CallToolResult);
    expect(payload.error).toBe('OBSERVATION_NOT_FOUND');
  });

  it('memory_supersede hides the old memory from the default list and returns the successor', async () => {
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'old-way', title: 'Old', content: 'old approach' },
    });
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'new-way', title: 'New', content: 'new approach' },
    });

    const result = await harness.client.callTool({
      name: 'memory_supersede',
      arguments: { slug: 'old-way', superseded_by: 'new-way' },
    });
    const payload = parsePayload(result as CallToolResult);
    expect(payload.ok).toBe(true);
    expect(payload.superseded_by).toBe('new-way');
    expect((payload.successor as { slug: string }).slug).toBe('new-way');

    const listed = await harness.client.callTool({ name: 'memories_list', arguments: {} });
    const slugs = (parsePayload(listed as CallToolResult).memories as Array<{ slug: string }>).map(
      (m) => m.slug,
    );
    expect(slugs).toEqual(['new-way']);
  });

  it('memory_supersede returns MEMORY_NOT_FOUND for an unknown successor', async () => {
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'exists', title: 'E', content: 'x' },
    });
    const result = await harness.client.callTool({
      name: 'memory_supersede',
      arguments: { slug: 'exists', superseded_by: 'ghost' },
    });
    expect(parsePayload(result as CallToolResult).error).toBe('MEMORY_NOT_FOUND');
  });

  it('memory_supersede rejects a memory superseding itself with SELF_SUPERSEDE', async () => {
    await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 's', title: 'S', content: 'x' },
    });
    const result = await harness.client.callTool({
      name: 'memory_supersede',
      arguments: { slug: 's', superseded_by: 's' },
    });
    expect(parsePayload(result as CallToolResult).error).toBe('SELF_SUPERSEDE');
  });

  it('skill_supersede drops the superseded latest version from the list', async () => {
    await harness.client.callTool({
      name: 'skill_record',
      arguments: { slug: 'old-flow', name: 'Old', description: 'd', content: 'A' },
    });
    await harness.client.callTool({
      name: 'skill_record',
      arguments: { slug: 'new-flow', name: 'New', description: 'd', content: 'B' },
    });

    const result = await harness.client.callTool({
      name: 'skill_supersede',
      arguments: { slug: 'old-flow', superseded_by: 'new-flow' },
    });
    const payload = parsePayload(result as CallToolResult);
    expect(payload.ok).toBe(true);
    expect((payload.successor as { slug: string }).slug).toBe('new-flow');

    const listed = await harness.client.callTool({ name: 'skills_list', arguments: {} });
    const slugs = (parsePayload(listed as CallToolResult).skills as Array<{ slug: string }>).map(
      (s) => s.slug,
    );
    expect(slugs).toEqual(['new-flow']);
  });

  it('skill_supersede returns SKILL_NOT_FOUND for an unknown target', async () => {
    const result = await harness.client.callTool({
      name: 'skill_supersede',
      arguments: { slug: 'ghost', superseded_by: 'ghost2' },
    });
    expect(parsePayload(result as CallToolResult).error).toBe('SKILL_NOT_FOUND');
  });

  it('skill_supersede rejects a skill superseding itself with SELF_SUPERSEDE', async () => {
    await harness.client.callTool({
      name: 'skill_record',
      arguments: { slug: 's', name: 'S', description: 'd', content: 'x' },
    });
    const result = await harness.client.callTool({
      name: 'skill_supersede',
      arguments: { slug: 's', superseded_by: 's' },
    });
    expect(parsePayload(result as CallToolResult).error).toBe('SELF_SUPERSEDE');
  });

  it('memory_record refuses derived_from_observation pointing at an archived observation', async () => {
    const rec = await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'retired source' },
    });
    const observation = parsePayload(rec as CallToolResult).observation as { id: string };
    await harness.client.callTool({
      name: 'observation_archive',
      arguments: { observation_id: observation.id },
    });

    const result = await harness.client.callTool({
      name: 'memory_record',
      arguments: {
        slug: 'from-archived',
        title: 'nope',
        content: 'should be rejected',
        derived_from_observation: observation.id,
      },
    });
    const payload = parsePayload(result as CallToolResult);
    expect(payload.error).toBe('OBSERVATION_ARCHIVED');
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

  it('bootstrap recent_observations includes id and related_task_key', async () => {
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

  it('observation_record with no active run succeeds and opens an attributed system run', async () => {
    // End the run the beforeEach opened so this records run-less.
    await harness.client.callTool({ name: 'agent_run_end', arguments: { status: 'completed' } });
    expect(harness.server.getSession().getCurrentRunId()).toBeNull();

    const rec = (await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'jotted without a run' },
    })) as CallToolResult;
    expect(rec.isError).toBeFalsy();
    expect(parsePayload(rec).observation).toBeDefined();
    // The transient system run must not linger as the active run.
    expect(harness.server.getSession().getCurrentRunId()).toBeNull();

    // A governance system run was opened, attributed the record, and closed
    // completed — provenance was preserved, not dropped to null.
    const started = parsePayload(
      (await harness.client.callTool({
        name: 'audit_query',
        arguments: { kind: 'run_started' },
      })) as CallToolResult,
    ).events as Array<{ run?: string | null; data?: { goal?: string } }>;
    const govRun = started.find((e) => e.data?.goal === 'governance: observation_record');
    expect(govRun?.run).toBeTruthy();

    const recorded = parsePayload(
      (await harness.client.callTool({
        name: 'audit_query',
        arguments: { kind: 'observation_recorded' },
      })) as CallToolResult,
    ).events as Array<{ run?: string | null }>;
    expect(recorded[0]?.run).toBe(govRun?.run);
  });

  it('memory_record with no active run succeeds and opens an attributed system run', async () => {
    await harness.client.callTool({ name: 'agent_run_end', arguments: { status: 'completed' } });
    expect(harness.server.getSession().getCurrentRunId()).toBeNull();

    const rec = (await harness.client.callTool({
      name: 'memory_record',
      arguments: { slug: 'runless', title: 'T', content: 'recorded without a run' },
    })) as CallToolResult;
    expect(rec.isError).toBeFalsy();
    expect(parsePayload(rec).action).toBe('created');
    expect(harness.server.getSession().getCurrentRunId()).toBeNull();

    const started = parsePayload(
      (await harness.client.callTool({
        name: 'audit_query',
        arguments: { kind: 'run_started' },
      })) as CallToolResult,
    ).events as Array<{ run?: string | null; data?: { goal?: string } }>;
    const govRun = started.find((e) => e.data?.goal === 'governance: memory_record');
    expect(govRun?.run).toBeTruthy();

    const recorded = parsePayload(
      (await harness.client.callTool({
        name: 'audit_query',
        arguments: { kind: 'memory_recorded' },
      })) as CallToolResult,
    ).events as Array<{ run?: string | null }>;
    expect(recorded[0]?.run).toBe(govRun?.run);
  });

  it('observation_record inside an active run uses that run, opening no system run', async () => {
    // The beforeEach run is still active.
    const activeRunId = harness.server.getSession().getCurrentRunId();
    expect(activeRunId).not.toBeNull();

    const rec = (await harness.client.callTool({
      name: 'observation_record',
      arguments: { content: 'inside the active run' },
    })) as CallToolResult;
    expect(rec.isError).toBeFalsy();
    // The record joined the active run (unchanged), which is still current.
    expect(harness.server.getSession().getCurrentRunId()).toBe(activeRunId);

    const recorded = parsePayload(
      (await harness.client.callTool({
        name: 'audit_query',
        arguments: { kind: 'observation_recorded' },
      })) as CallToolResult,
    ).events as Array<{ run?: string | null }>;
    expect(recorded[0]?.run).toBe(activeRunId);

    // No transient governance run was opened.
    const started = parsePayload(
      (await harness.client.callTool({
        name: 'audit_query',
        arguments: { kind: 'run_started' },
      })) as CallToolResult,
    ).events as Array<{ data?: { goal?: string } }>;
    expect(started.some((e) => (e.data?.goal ?? '').startsWith('governance:'))).toBe(false);
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
