import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentRunStatus } from '@/domain/enums/agent-run-status.js';
import { AgentRunService } from '@/services/agent-run-service.js';
import { AuditService } from '@/services/audit-service.js';
import { IdentityService } from '@/services/identity-service.js';
import { OrphanRunService } from '@/services/orphan-run-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { AgentPlanRepository } from '@/storage/sqlite/repositories/agent-plan-repository.js';
import { AgentRunRepository } from '@/storage/sqlite/repositories/agent-run-repository.js';
import { TransitionRepository } from '@/storage/sqlite/repositories/transition-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const HOUR = 3_600_000;

describe('OrphanRunService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let runs: AgentRunRepository;
  let agentRun: AgentRunService;
  let orphan: OrphanRunService;
  /** Fixed reference clock so age is deterministic across runtimes. */
  const now = Date.parse('2026-06-30T12:00:00.000Z');

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-orphan-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const actors = new ActorRepository(adapter);
    runs = new AgentRunRepository(adapter);
    const identity = new IdentityService(actors);
    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    agentRun = new AgentRunService(
      runs,
      actors,
      identity,
      audit,
      new AgentPlanRepository(adapter),
      new TransitionRepository(adapter),
    );
    orphan = new OrphanRunService(runs, agentRun);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Start a run, then backdate its started_at to `hoursAgo` before `now`. */
  function startRunAged(goal: string, hoursAgo: number): string {
    const result = agentRun.start({ goal, actor: 'daniel', agentHandle: 'claude' });
    if (!result.ok) throw new Error('failed to start run');
    const id = result.value.id;
    const at = new Date(now - hoursAgo * HOUR).toISOString();
    adapter.getDatabase().prepare('UPDATE agent_runs SET started_at = ? WHERE id = ?').run(at, id);
    return id;
  }

  it('detects only runs older than the threshold', () => {
    const stale = startRunAged('stale work', 30); // 30h old
    startRunAged('fresh work', 2); // 2h old
    const found = orphan.detect(24, now);
    expect(found.map((o) => o.id)).toEqual([stale]);
    expect(found[0]?.ageHours).toBe(30);
  });

  it('closes a stale run as aborted with a note, leaving the fresh one running', () => {
    const stale = startRunAged('stale work', 48);
    const fresh = startRunAged('fresh work', 1);

    const result = orphan.closeStale(24, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ id: stale, ageHours: 48, closed: true }]);

    // Provenance preserved: the run still exists, now aborted with a note.
    const reloaded = runs.findById(stale);
    expect(reloaded?.status).toBe(AgentRunStatus.Aborted);
    expect(reloaded?.result).toContain('orphaned');

    // The fresh run is untouched.
    expect(runs.findById(fresh)?.status).toBe(AgentRunStatus.Running);
  });

  it('does nothing when no run is stale', () => {
    startRunAged('fresh', 1);
    expect(orphan.detect(24, now)).toEqual([]);
    const result = orphan.closeStale(24, now);
    expect(result.ok && result.value).toEqual([]);
  });

  it('leaves an already-ended run alone (it is no longer running, so not detected)', () => {
    const ended = startRunAged('stale but already ended', 30);
    // A run that reached a terminal status is no longer `running`, so
    // findRunning() excludes it and the sweep never touches it — the
    // closeStale path only ever aborts runs that are still open.
    agentRun.end({ runId: ended, status: AgentRunStatus.Completed, result: 'finished elsewhere' });

    expect(orphan.detect(24, now)).toEqual([]);
    const result = orphan.closeStale(24, now);
    expect(result.ok && result.value).toEqual([]);
    // Its terminal status is preserved, never overwritten to aborted.
    expect(runs.findById(ended)?.status).toBe(AgentRunStatus.Completed);
  });
});
