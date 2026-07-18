import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '@mnema/core/config/config-schema.js';
import type { CommandRunner } from '@mnema/core/services/git/github-pr-service.js';
import {
  createServiceContainer,
  type ServiceContainer,
} from '@mnema/core/services/service-container.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { MnemaMcpServer } from '@/mcp/mcp-server.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

/** A git runner whose `cat-file -e` result is controlled by `found`. */
function gitRunner(found: boolean): CommandRunner {
  return (_command, args) => {
    if (args.includes('rev-parse')) return { status: 0, stdout: 'true\n' };
    return { status: found ? 0 : 1, stdout: '' };
  };
}

async function setup(commitRunner: CommandRunner): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-commit-ev-'));
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
  const container = createServiceContainer(config, projectRoot, { migrationsDir, commitRunner });
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

function payload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== 'text') throw new Error('expected text content');
  return JSON.parse(block.text) as Record<string, unknown>;
}

/** Creates a task with one acceptance criterion and returns its key. */
async function seedTask(client: Client): Promise<string> {
  const res = (await client.callTool({
    name: 'task_create',
    arguments: { title: 'Verify commit evidence', acceptance_criteria: ['ships'] },
  })) as CallToolResult;
  return (payload(res).task as { key: string }).key;
}

describe('commit evidence verification (MNEMA-89)', () => {
  let harness: Harness;

  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  it('warns but still attaches when a commit ref is not found in git', async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup(gitRunner(false));
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'commit ev' } });
    const key = await seedTask(harness.client);

    const res = (await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: { task_key: key, criterion_index: 0, kind: 'commit', ref: 'deadbeef' },
    })) as CallToolResult;

    const body = payload(res);
    // The attach succeeded …
    expect(res.isError).toBeFalsy();
    expect(body.evidence).toBeDefined();
    // … and the missing ref is surfaced as a warning, not an error.
    expect(body.warning).toContain('deadbeef');
  });

  it('sharpens the warning for a file path vs a missing SHA (both still save)', async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    // Runner reports "not found" for either ref; the verifier tells the two
    // cases apart from the ref shape, not from git.
    harness = await setup(gitRunner(false));
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'commit ev' } });

    const shaKey = await seedTask(harness.client);
    const shaRes = (await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: { task_key: shaKey, criterion_index: 0, kind: 'commit', ref: 'deadbeef' },
    })) as CallToolResult;
    const shaBody = payload(shaRes);
    expect(shaRes.isError).toBeFalsy();
    expect(shaBody.evidence).toBeDefined();
    expect(String(shaBody.warning)).toContain('not found in this repository');

    const pathKey = await seedTask(harness.client);
    const pathRes = (await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: { task_key: pathKey, criterion_index: 0, kind: 'commit', ref: 'src/foo.ts' },
    })) as CallToolResult;
    const pathBody = payload(pathRes);
    // Still advisory: the attach lands, only the wording changes.
    expect(pathRes.isError).toBeFalsy();
    expect(pathBody.evidence).toBeDefined();
    expect(String(pathBody.warning)).toContain('is not a commit');
    // The two advisories must not read the same.
    expect(pathBody.warning).not.toBe(shaBody.warning);
  });

  it('attaches without a warning when the commit ref is found', async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup(gitRunner(true));
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'commit ev' } });
    const key = await seedTask(harness.client);

    const res = (await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: { task_key: key, criterion_index: 0, kind: 'commit', ref: 'cafe1234' },
    })) as CallToolResult;

    const body = payload(res);
    expect(body.evidence).toBeDefined();
    expect(body.warning).toBeUndefined();
  });

  it('does not verify non-commit evidence kinds', async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    // Runner that would report not-found if ever consulted.
    harness = await setup(gitRunner(false));
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'commit ev' } });
    const key = await seedTask(harness.client);

    const res = (await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: { task_key: key, criterion_index: 0, kind: 'url', ref: 'https://example.com' },
    })) as CallToolResult;

    expect(payload(res).warning).toBeUndefined();
  });

  it('re-attaching an identical edge is an idempotent no_op, not an error', async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup(gitRunner(true));
    await harness.client.callTool({ name: 'agent_run_start', arguments: { goal: 'commit ev' } });
    const key = await seedTask(harness.client);
    const args = { task_key: key, criterion_index: 0, kind: 'url', ref: 'https://example.com' };

    const first = payload(
      (await harness.client.callTool({
        name: 'task_attach_evidence',
        arguments: args,
      })) as CallToolResult,
    );
    const second = (await harness.client.callTool({
      name: 'task_attach_evidence',
      arguments: args,
    })) as CallToolResult;
    const body = payload(second);

    // No error, flagged as a no_op, and it points the caller at criterion_index
    // rather than inviting a mangled ref.
    expect(second.isError).toBeFalsy();
    expect(body.no_op).toBe(true);
    expect(String(body.note)).toContain('criterion_index');
    expect((body.evidence as { id: string }).id).toBe((first.evidence as { id: string }).id);
  });
});
