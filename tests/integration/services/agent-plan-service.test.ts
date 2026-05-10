import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentPlanState } from '@/domain/enums/agent-plan-state.js';
import { AgentRunStatus } from '@/domain/enums/agent-run-status.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AGENT_PLAN_DEPTH_LIMIT, AgentPlanService } from '@/services/agent-plan-service.js';
import { AgentRunService } from '@/services/agent-run-service.js';
import { AuditService } from '@/services/audit-service.js';
import { IdentityService } from '@/services/identity-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { AgentPlanRepository } from '@/storage/sqlite/repositories/agent-plan-repository.js';
import { AgentRunRepository } from '@/storage/sqlite/repositories/agent-run-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('AgentPlanService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let plans: AgentPlanService;
  let runs: AgentRunService;
  let runId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-agent-plan-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const actors = new ActorRepository(adapter);
    const identity = new IdentityService(actors);
    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const runRepo = new AgentRunRepository(adapter);
    const planRepo = new AgentPlanRepository(adapter);
    const taskRepo = new TaskRepository(adapter);

    runs = new AgentRunService(runRepo, actors, identity, audit);
    plans = new AgentPlanService(planRepo, runRepo, taskRepo);

    const start = runs.start({ goal: 'g', actor: 'daniel', agentHandle: 'cc' });
    if (!start.ok) throw new Error('precondition failed');
    runId = start.value.id;
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates a plan in pending state attached to the run', () => {
    const result = plans.create({ runId, content: 'do step 1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe(AgentPlanState.Pending);
    expect(result.value.depth).toBe(0);
  });

  it('returns AGENT_RUN_NOT_FOUND for an unknown run', () => {
    const result = plans.create({ runId: 'ghost', content: 'noop' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.AgentRunNotFound);
  });

  it('updateState transitions a plan and stamps timestamps', () => {
    const created = plans.create({ runId, content: 'work' });
    if (!created.ok) throw new Error('precondition failed');

    const inProgress = plans.updateState({
      planId: created.value.id,
      state: AgentPlanState.InProgress,
    });
    expect(inProgress.ok).toBe(true);
    if (!inProgress.ok) return;
    expect(inProgress.value.state).toBe(AgentPlanState.InProgress);
    expect(inProgress.value.startedAt).not.toBeNull();

    const done = plans.updateState({
      planId: created.value.id,
      state: AgentPlanState.Completed,
      result: 'finished',
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.completedAt).not.toBeNull();
    expect(done.value.result).toBe('finished');
  });

  it('rejects plans nested past the depth limit', () => {
    let parentId: string | undefined;
    for (let depth = 0; depth <= AGENT_PLAN_DEPTH_LIMIT; depth += 1) {
      const result = plans.create({
        runId,
        content: `step-${depth}`,
        parentPlanId: parentId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.depth).toBe(depth);
      parentId = result.value.id;
    }

    const overflow = plans.create({
      runId,
      content: 'too deep',
      parentPlanId: parentId,
    });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error.kind).toBe(ErrorCode.DepthLimitExceeded);
  });

  it('archives plans automatically when the parent run ends', () => {
    plans.create({ runId, content: 'a' });
    plans.create({ runId, content: 'b' });

    runs.end({ runId, status: AgentRunStatus.Completed });

    const allPlans = plans.list(runId);
    for (const plan of allPlans) {
      expect(plan.archivedAt).not.toBeNull();
    }

    const activeOnly = plans.list(runId, { activeOnly: true });
    expect(activeOnly).toHaveLength(0);
  });
});
