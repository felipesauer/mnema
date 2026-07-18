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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpSessionContext } from '@/mcp/mcp-session-context.js';
import { AgentPlanTools } from '@/mcp/tools/universal/agent-plan-tools.js';
import { AgentRunTools } from '@/mcp/tools/universal/agent-run-tools.js';
import { DependencyTools } from '@/mcp/tools/universal/dependency-tools.js';
import { NoteTools } from '@/mcp/tools/universal/note-tools.js';

/**
 * The cooperative drift guard (requireFreshSchema) must block EVERY mutation,
 * not just the ones that already had it. These four registrars are mutations
 * that previously leaked a raw SqliteError on a drifted DB instead of the
 * structured SCHEMA_OUT_OF_DATE. Built with a FORCED non-empty pending list so
 * the guard believes the schema is behind even though the DB is fully migrated.
 */
const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');
const PENDING = ['999_pretend_pending.sql'];

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-driftuntracked-'));
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

  // A session whose run id is always present, so a NO_ACTIVE_RUN guard never
  // pre-empts the drift guard on the mutation assertions.
  const session = {
    getCurrentRunId: () => 'run-1',
    setCurrentRunId: () => {},
    getClientMetadata: () => ({ agent_handle: 'test-agent' }),
  } as unknown as McpSessionContext;

  const sdkServer = new McpServer({ name: 'drift-untracked-test', version: '0.0.0' });
  new AgentRunTools(
    container.agentRun,
    container.identity,
    session,
    container.auditQuery,
    PENDING,
  ).register(sdkServer);
  new AgentPlanTools(container.agentPlan, session, PENDING).register(sdkServer);
  new NoteTools(container.note, container.identity, session, PENDING).register(sdkServer);
  new DependencyTools(container.dependency, container.identity, session, PENDING).register(
    sdkServer,
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdkServer.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);

  return {
    container,
    client,
    close: async () => {
      await client.close();
      await sdkServer.close();
      container.close();
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

function isError(r: CallToolResult): boolean {
  return r.isError === true;
}

function text(r: CallToolResult): string {
  const block = r.content[0];
  return block?.type === 'text' ? block.text : '';
}

describe('drift guard covers previously-untracked mutations', () => {
  let harness: Harness;
  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
  });
  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  // Each mutation of the four focus registrars must fail closed with
  // SCHEMA_OUT_OF_DATE, not leak a raw SqliteError.
  const mutations: Array<[string, Record<string, unknown>]> = [
    ['task_depends_on', { task_key: 'TEST-1', blocks_task_key: 'TEST-2' }],
    ['task_depends_many', { links: [{ task_key: 'TEST-1', blocks_task_key: 'TEST-2' }] }],
    ['note_add', { task_key: 'TEST-1', content: 'a note' }],
    ['agent_run_start', { goal: 'do the thing' }],
    ['agent_run_end', { status: 'completed' }],
    ['agent_run_resume', { run_id: 'run-1' }],
    ['agent_plan_create', { content: 'a plan step' }],
    ['agent_plan_update_state', { position: 0, state: 'completed' }],
  ];
  for (const [name, args] of mutations) {
    it(`mutation ${name} is blocked by drift`, async () => {
      const r = (await harness.client.callTool({ name, arguments: args })) as CallToolResult;
      expect(isError(r), `${name} should be drift-blocked`).toBe(true);
      expect(text(r)).toContain('SCHEMA_OUT_OF_DATE');
    });
  }
});
