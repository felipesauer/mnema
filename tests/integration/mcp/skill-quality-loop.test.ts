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
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-skillqual-'));
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

interface ListedSkill {
  slug: string;
  review_flag: boolean;
}

/** Drive a fresh task all the way to DONE within the current run. */
async function driveToDone(client: Client, key: string, title: string): Promise<void> {
  await client.callTool({ name: 'task_create', arguments: { title, acceptance_criteria: ['ok'] } });
  await client.callTool({
    name: 'task_submit',
    arguments: {
      task_key: key,
      title,
      description: `${title} — ready`,
      acceptance_criteria: ['ok'],
      estimate: 1,
    },
  });
  await client.callTool({
    name: 'task_start',
    arguments: { task_key: key, assignee_id: 'daniel' },
  });
  await client.callTool({
    name: 'task_submit_review',
    arguments: { task_key: key, pr_url: 'https://example.com/pr/1' },
  });
  await client.callTool({
    name: 'task_approve',
    arguments: { task_key: key, approval_note: 'lgtm' },
  });
}

describe('skill quality loop flags skills that preceded rework (MNEMA-236)', () => {
  let harness: Harness;

  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
  });

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('flags a skill used in a run whose task later reopened; leaves a clean one unflagged', async () => {
    // The correlation is per-run, so each skill+task gets its OWN run.
    // Run A: record both skills, use risky-skill, drive TEST-1 to DONE.
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'run A' } });
    for (const slug of ['risky-skill', 'safe-skill']) {
      await harness.client.callTool({
        name: 'skill_record',
        arguments: { slug, name: slug, description: 'a skill', content: 'do the thing' },
      });
    }
    await harness.client.callTool({ name: 'skill_use', arguments: { slug: 'risky-skill' } });
    await driveToDone(harness.client, 'TEST-1', 'Risky work');
    await harness.client.callTool({ name: 'agent_run_end', arguments: { status: 'completed' } });

    // Run B: use safe-skill, drive TEST-2 to DONE (stays clean).
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'run B' } });
    await harness.client.callTool({ name: 'skill_use', arguments: { slug: 'safe-skill' } });
    await driveToDone(harness.client, 'TEST-2', 'Safe work');

    // TEST-1 is reopened (in run B) → run A, which used risky-skill, now
    // precedes rework; run B (safe-skill) touched only the clean TEST-2.
    await harness.client.callTool({
      name: 'task_reopen',
      arguments: { task_key: 'TEST-1', reason: 'a bug slipped through and needs rework' },
    });

    const list = payload(
      (await harness.client.callTool({ name: 'skills_list', arguments: {} })) as CallToolResult,
    );
    const skills = list.skills as ListedSkill[];
    const risky = skills.find((s) => s.slug === 'risky-skill');
    const safe = skills.find((s) => s.slug === 'safe-skill');
    expect(risky?.review_flag).toBe(true);
    expect(safe?.review_flag).toBe(false);
  });

  it('skill_review_proposals carries the task, run and reopen reason (MNEMA-249)', async () => {
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'run A' } });
    await harness.client.callTool({
      name: 'skill_record',
      arguments: { slug: 'risky-skill', name: 'Risky', description: 'a skill', content: 'do it' },
    });
    await harness.client.callTool({ name: 'skill_use', arguments: { slug: 'risky-skill' } });
    await driveToDone(harness.client, 'TEST-1', 'Risky work');
    await harness.client.callTool({ name: 'agent_run_end', arguments: { status: 'completed' } });

    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'run B' } });
    await harness.client.callTool({
      name: 'task_reopen',
      arguments: { task_key: 'TEST-1', reason: 'auth regression under load' },
    });

    const res = payload(
      (await harness.client.callTool({
        name: 'skill_review_proposals',
        arguments: {},
      })) as CallToolResult,
    );
    const proposals = res.proposals as Array<{
      slug: string;
      taskKey: string;
      runId: string;
      reopenCount: number;
      reopenReason: string | null;
    }>;
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p?.slug).toBe('risky-skill');
    expect(p?.taskKey).toBe('TEST-1');
    expect(p?.reopenCount).toBe(1);
    expect(p?.reopenReason).toBe('auth regression under load');
    expect(typeof p?.runId).toBe('string');
  });

  it('a clean run produces no proposals', async () => {
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'clean' } });
    await harness.client.callTool({
      name: 'skill_record',
      arguments: { slug: 'safe-skill', name: 'Safe', description: 'a skill', content: 'do it' },
    });
    await harness.client.callTool({ name: 'skill_use', arguments: { slug: 'safe-skill' } });
    await driveToDone(harness.client, 'TEST-1', 'Safe work');

    const res = payload(
      (await harness.client.callTool({
        name: 'skill_review_proposals',
        arguments: {},
      })) as CallToolResult,
    );
    expect(res.proposals).toEqual([]);
  });
});
