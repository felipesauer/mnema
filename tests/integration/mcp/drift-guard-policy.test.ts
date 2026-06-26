import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import type { McpSessionContext } from '@/mcp/mcp-session-context.js';
import { DecisionTools } from '@/mcp/tools/universal/decision-tools.js';
import { EvidenceTools } from '@/mcp/tools/universal/evidence-tools.js';
import { SprintTools } from '@/mcp/tools/universal/sprint-tools.js';
import { TaskTools } from '@/mcp/tools/universal/task-tools.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * Policy under test (requireFreshSchema's contract, mcp-tool-result.ts): the
 * cooperative drift guard blocks ONLY mutations. Read-only tools stay
 * drift-tolerant so an upgraded-but-unmigrated DB can still be inspected — the
 * same posture the CLI takes. This pins the policy at the handler layer, where
 * a regression (over-guarding reads) had slipped in undetected.
 *
 * The tools are constructed with a FORCED non-empty pendingMigrations list, so
 * the DB itself is fully migrated (reads return real data) while the guard
 * believes the schema is behind.
 */
const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');
const PENDING = ['999_pretend_pending.sql'];

interface Harness {
  readonly container: ServiceContainer;
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function setup(): Promise<Harness> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-driftpol-'));
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
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });
  // Seed real data the read tools can return.
  container.adapter
    .getDatabase()
    .prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')")
    .run();
  const dec = container.decision.record({
    projectKey: 'TEST',
    title: 'Seed',
    decision: 'seeded',
    actor: 'daniel',
  });
  if (!dec.ok) throw new Error('seed decision failed');
  const task = container.task.create({ projectKey: 'TEST', title: 'Seed task', actor: 'daniel' });
  if (!task.ok) throw new Error('seed task failed');

  // A session whose run id is always present, so a NO_ACTIVE_RUN guard never
  // pre-empts the drift guard on the mutation assertions.
  const session = {
    getCurrentRunId: () => 'run-1',
    getClientMetadata: () => ({ agent_handle: 'test-agent' }),
  } as unknown as McpSessionContext;

  const sdkServer = new McpServer({ name: 'drift-test', version: '0.0.0' });
  // Construct the Sprint-5 tool classes with a FORCED pending list.
  new DecisionTools(container.decision, container.identity, config, session, PENDING).register(
    sdkServer,
  );
  new TaskTools(
    container.task,
    container.identity,
    config,
    session,
    container.stateMachine,
    PENDING,
  ).register(sdkServer);
  new EvidenceTools(container.taskEvidence, container.identity, session, PENDING).register(
    sdkServer,
  );
  new SprintTools(container.sprint, container.identity, config, session, PENDING).register(
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

describe('drift-guard policy: reads pass, mutations block (MNEMA-ADR contract)', () => {
  let harness: Harness;
  beforeEach(async () => {
    process.env.MNEMA_ACTOR = 'daniel';
    harness = await setup();
  });
  afterEach(async () => {
    await harness.close();
    delete process.env.MNEMA_ACTOR;
  });

  // Read-only tools must NOT be blocked by drift.
  const reads: Array<[string, Record<string, unknown>]> = [
    ['decision_show', { decision_key: 'TEST-ADR-1' }],
    ['decisions_list', {}],
    ['decisions_impacting', { ref: 'src/x.ts' }],
    ['tasks_list', {}],
    ['task_show', { task_key: 'TEST-1' }],
    ['task_evidence', { task_key: 'TEST-1' }],
    ['sprint_show', { sprint_key: 'TEST-SPRINT-1' }],
  ];
  for (const [name, args] of reads) {
    it(`read ${name} succeeds despite pending migrations`, async () => {
      const r = (await harness.client.callTool({ name, arguments: args })) as CallToolResult;
      expect(isError(r), `${name} should not be drift-blocked`).toBe(false);
    });
  }

  // Mutating tools MUST be blocked by drift (SCHEMA_OUT_OF_DATE). Covers every
  // mutation in the four focus files, including the two decision-transition
  // mutations a prior version of this test omitted.
  const mutations: Array<[string, Record<string, unknown>]> = [
    ['decision_record', { title: 'New', decision: 'x' }],
    ['decision_promote_from_note', { note_id: 'n1', title: 'Promoted', decision: 'x' }],
    ['decision_supersede', { decision_key: 'TEST-ADR-1', superseded_by: 'TEST-ADR-2' }],
    ['task_create', { title: 'New task' }],
    ['task_attach_evidence', { task_key: 'TEST-1', criterion_index: 0, ref: 'r' }],
    ['sprint_add_task', { sprint_key: 'TEST-SPRINT-1', task_key: 'TEST-1' }],
  ];
  for (const [name, args] of mutations) {
    it(`mutation ${name} is blocked by drift`, async () => {
      const r = (await harness.client.callTool({ name, arguments: args })) as CallToolResult;
      expect(isError(r), `${name} should be drift-blocked`).toBe(true);
      const block = r.content[0];
      if (block?.type === 'text') {
        expect(block.text).toContain('SCHEMA_OUT_OF_DATE');
      }
    });
  }
});
