import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentRunStatus } from '@/domain/enums/agent-run-status.js';
import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AGENT_RUN_DEPTH_LIMIT, AgentRunService } from '@/services/agent/agent-run-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { AgentPlanRepository } from '@/storage/sqlite/repositories/agent-plan-repository.js';
import { AgentRunRepository } from '@/storage/sqlite/repositories/agent-run-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { TransitionRepository } from '@/storage/sqlite/repositories/transition-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { loadWorkflowFile } from '@/storage/workflow-file.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('AgentRunService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let runs: AgentRunRepository;
  let plans: AgentPlanRepository;
  let transitions: TransitionRepository;
  let stateMachine: StateMachine;
  let service: AgentRunService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-agent-run-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const actors = new ActorRepository(adapter);
    runs = new AgentRunRepository(adapter);
    plans = new AgentPlanRepository(adapter);
    transitions = new TransitionRepository(adapter);
    const identity = new IdentityService(actors);
    const auditDir = path.join(tempRoot, '.audit');
    const audit = new AuditService(new AuditWriter(auditDir));
    stateMachine = new StateMachine(
      loadWorkflowFile(path.resolve('packages/core/workflows/default.json')),
    );
    const tasks = new TaskRepository(adapter);
    service = new AgentRunService(
      runs,
      actors,
      identity,
      audit,
      plans,
      transitions,
      tasks,
      stateMachine,
    );
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('start creates a running run with both actor and agent_actor', () => {
    const result = service.start({
      goal: 'audit auth flow',
      actor: 'daniel',
      agentHandle: 'claude-code',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe(AgentRunStatus.Running);
    expect(result.value.depth).toBe(0);
  });

  it('end transitions a run to a terminal status', () => {
    const start = service.start({ goal: 'g', actor: 'daniel', agentHandle: 'cc' });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const ended = service.end({
      runId: start.value.id,
      status: AgentRunStatus.Completed,
      result: 'all good',
    });
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.value.status).toBe(AgentRunStatus.Completed);
    expect(ended.value.result).toBe('all good');
    expect(ended.value.endedAt).not.toBeNull();
  });

  it('end on an already-ended run returns AGENT_RUN_ALREADY_ENDED', () => {
    const start = service.start({ goal: 'g', actor: 'daniel', agentHandle: 'cc' });
    if (!start.ok) throw new Error('precondition failed');
    service.end({ runId: start.value.id, status: AgentRunStatus.Completed });

    const second = service.end({ runId: start.value.id, status: AgentRunStatus.Aborted });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe(ErrorCode.AgentRunAlreadyEnded);
  });

  it('child run inherits depth + 1 and rejects past the limit', () => {
    let parentId: string | undefined;
    for (let depth = 0; depth <= AGENT_RUN_DEPTH_LIMIT; depth += 1) {
      const result = service.start({
        goal: `level-${depth}`,
        actor: 'daniel',
        agentHandle: 'cc',
        parentRunId: parentId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.depth).toBe(depth);
      parentId = result.value.id;
    }

    const overflow = service.start({
      goal: 'too deep',
      actor: 'daniel',
      agentHandle: 'cc',
      parentRunId: parentId,
    });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error.kind).toBe(ErrorCode.DepthLimitExceeded);
  });

  it('findChildren returns direct children of a parent run, ordered by start', () => {
    const parent = service.start({ goal: 'parent', actor: 'daniel', agentHandle: 'cc' });
    if (!parent.ok) throw new Error('precondition failed');

    const childA = service.start({
      goal: 'child-a',
      actor: 'daniel',
      agentHandle: 'cc',
      parentRunId: parent.value.id,
    });
    const childB = service.start({
      goal: 'child-b',
      actor: 'daniel',
      agentHandle: 'cc',
      parentRunId: parent.value.id,
    });
    if (!childA.ok || !childB.ok) throw new Error('precondition failed');

    // Sibling run with a different parent must not appear.
    const stranger = service.start({ goal: 'stranger', actor: 'daniel', agentHandle: 'cc' });
    if (!stranger.ok) throw new Error('precondition failed');

    const children = service.findChildren(parent.value.id);
    expect(children.map((c) => c.goal)).toEqual(['child-a', 'child-b']);
  });

  it('triggers the run-end hook on terminal status', () => {
    const calls: string[] = [];
    const actors = new ActorRepository(adapter);
    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const hooked = new AgentRunService(
      runs,
      actors,
      new IdentityService(actors),
      audit,
      plans,
      transitions,
      new TaskRepository(adapter),
      stateMachine,
      (run) => calls.push(run.id),
    );

    const start = hooked.start({ goal: 'g', actor: 'daniel', agentHandle: 'cc' });
    if (!start.ok) throw new Error('precondition failed');
    hooked.end({ runId: start.value.id, status: AgentRunStatus.Completed });

    expect(calls).toEqual([start.value.id]);
  });

  describe('resume', () => {
    it('reopens an aborted run back to running with the same id', () => {
      const start = service.start({ goal: 'interrupted work', actor: 'ana', agentHandle: 'cc' });
      if (!start.ok) throw new Error('precondition failed');
      service.end({ runId: start.value.id, status: AgentRunStatus.Aborted });

      const resumed = service.resume({ runId: start.value.id, actor: 'ana' });
      if (!resumed.ok) throw new Error('expected resume to succeed');
      expect(resumed.value.id).toBe(start.value.id);
      expect(resumed.value.status).toBe(AgentRunStatus.Running);
      expect(resumed.value.endedAt).toBeNull();
      expect(resumed.value.error).toBeNull();
    });

    it('reopens a failed run', () => {
      const start = service.start({ goal: 'failed work', actor: 'ana', agentHandle: 'cc' });
      if (!start.ok) throw new Error('precondition failed');
      service.end({ runId: start.value.id, status: AgentRunStatus.Failed, errorMessage: 'boom' });

      const resumed = service.resume({ runId: start.value.id, actor: 'ana' });
      if (!resumed.ok) throw new Error('expected resume to succeed');
      expect(resumed.value.status).toBe(AgentRunStatus.Running);
      expect(resumed.value.error).toBeNull();
    });

    it('rejects resuming a completed run', () => {
      const start = service.start({ goal: 'done work', actor: 'ana', agentHandle: 'cc' });
      if (!start.ok) throw new Error('precondition failed');
      service.end({ runId: start.value.id, status: AgentRunStatus.Completed });

      const resumed = service.resume({ runId: start.value.id, actor: 'ana' });
      expect(resumed.ok).toBe(false);
      if (!resumed.ok) {
        expect(resumed.error.kind).toBe(ErrorCode.AgentRunNotResumable);
      }
    });

    it('is a safe no-op when the run is still running', () => {
      const start = service.start({ goal: 'live work', actor: 'ana', agentHandle: 'cc' });
      if (!start.ok) throw new Error('precondition failed');

      const resumed = service.resume({ runId: start.value.id, actor: 'ana' });
      if (!resumed.ok) throw new Error('expected resume to succeed');
      expect(resumed.value.id).toBe(start.value.id);
      expect(resumed.value.status).toBe(AgentRunStatus.Running);
    });

    it('errors on an unknown run id', () => {
      const resumed = service.resume({ runId: 'does-not-exist', actor: 'ana' });
      expect(resumed.ok).toBe(false);
      if (!resumed.ok) {
        expect(resumed.error.kind).toBe(ErrorCode.AgentRunNotFound);
      }
    });
  });

  describe('summarize', () => {
    it('reports counts and lists open child runs', () => {
      const parent = service.start({ goal: 'parent', actor: 'ana', agentHandle: 'cc' });
      if (!parent.ok) throw new Error('precondition failed');
      const child = service.start({
        goal: 'open child',
        actor: 'ana',
        agentHandle: 'cc',
        parentRunId: parent.value.id,
      });
      if (!child.ok) throw new Error('precondition failed');

      const summary = service.summarize(parent.value.id);
      if (!summary.ok) throw new Error('expected summary to succeed');
      expect(summary.value.mutationCount).toBe(0);
      expect(summary.value.openItems).toHaveLength(1);
      expect(summary.value.openItems[0]).toMatchObject({
        kind: 'child_run',
        id: child.value.id,
        status: AgentRunStatus.Running,
      });
    });

    it('errors on an unknown run id', () => {
      const summary = service.summarize('nope');
      expect(summary.ok).toBe(false);
    });
  });
});
