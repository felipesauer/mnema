import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DecisionStatus } from '@/domain/enums/decision-status.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { DecisionService } from '@/services/backlog/decision-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { DecisionRepository } from '@/storage/sqlite/repositories/decision-repository.js';
import { NoteRepository } from '@/storage/sqlite/repositories/note-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { chainedAuditWriter } from '../../setup/audit-writer.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('DecisionService impacts', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let decisions: DecisionService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-di-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(chainedAuditWriter(adapter, path.join(tempRoot, '.audit')));
    const projects = new ProjectRepository(adapter);
    projects.insert({ key: 'TEST', name: 'Test' });
    const identity = new IdentityService(new ActorRepository(adapter));

    decisions = new DecisionService(
      new DecisionRepository(adapter),
      projects,
      identity,
      audit,
      new NoteRepository(adapter),
      new TaskRepository(adapter),
    );
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('records a decision with impacts and reads them back', () => {
    const result = decisions.record({
      projectKey: 'TEST',
      title: 'Use SQLite',
      decision: 'SQLite it is',
      impacts: ['src/storage/foo.ts', 'TEST-42'],
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impacts).toEqual(['src/storage/foo.ts', 'TEST-42']);
  });

  it('defaults impacts to an empty array', () => {
    const result = decisions.record({
      projectKey: 'TEST',
      title: 'No impacts',
      decision: 'x',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impacts).toEqual([]);
  });

  it('impacting() returns decisions whose impacts contain the ref', () => {
    decisions.record({
      projectKey: 'TEST',
      title: 'Title A',
      decision: 'a',
      impacts: ['src/a.ts'],
      actor: 'daniel',
    });
    decisions.record({
      projectKey: 'TEST',
      title: 'Title B',
      decision: 'b',
      impacts: ['src/b.ts'],
      actor: 'daniel',
    });
    decisions.record({
      projectKey: 'TEST',
      title: 'Title C',
      decision: 'c',
      impacts: ['src/a.ts', 'src/c.ts'],
      actor: 'daniel',
    });

    const hits = decisions.impacting('TEST', 'src/a.ts');
    expect(hits).toHaveLength(2);
    expect(hits.map((d) => d.title).sort()).toEqual(['Title A', 'Title C']);
  });

  it('impacting() returns empty when nothing matches', () => {
    decisions.record({ projectKey: 'TEST', title: 'Title A', decision: 'a', actor: 'daniel' });
    expect(decisions.impacting('TEST', 'nope.ts')).toEqual([]);
  });

  it('impacting() excludes rejected and superseded ADRs', () => {
    // accepted → should appear
    decisions.record({
      projectKey: 'TEST',
      title: 'Live',
      decision: 'a',
      impacts: ['src/x.ts'],
      actor: 'daniel',
    });
    decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });
    // rejected → should NOT appear
    decisions.record({
      projectKey: 'TEST',
      title: 'Dead',
      decision: 'b',
      impacts: ['src/x.ts'],
      actor: 'daniel',
    });
    decisions.transition({
      decisionKey: 'TEST-ADR-2',
      status: DecisionStatus.Rejected,
      actor: 'daniel',
    });
    // superseded → should NOT appear (ADR-3 superseded by ADR-1)
    decisions.record({
      projectKey: 'TEST',
      title: 'Old',
      decision: 'c',
      impacts: ['src/x.ts'],
      actor: 'daniel',
    });
    decisions.transition({
      decisionKey: 'TEST-ADR-3',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });
    decisions.transition({
      decisionKey: 'TEST-ADR-3',
      status: DecisionStatus.Superseded,
      supersededBy: 'TEST-ADR-1',
      actor: 'daniel',
    });

    const hits = decisions.impacting('TEST', 'src/x.ts');
    expect(hits.map((d) => d.title)).toEqual(['Live']);
  });

  it('rejects a decision superseding itself', () => {
    decisions.record({ projectKey: 'TEST', title: 'Title A', decision: 'a', actor: 'daniel' });
    decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });
    const res = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Superseded,
      supersededBy: 'TEST-ADR-1',
      actor: 'daniel',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe(ErrorCode.DecisionInvalidStatus);
  });

  it('impacting() returns hits newest-first', () => {
    const db = adapter.getDatabase();
    const setAt = (key: string, at: string) =>
      db.prepare('UPDATE decisions SET at = ? WHERE key = ?').run(at, key);

    decisions.record({
      projectKey: 'TEST',
      title: 'Title A',
      decision: 'a',
      impacts: ['src/x.ts'],
      actor: 'daniel',
    });
    decisions.record({
      projectKey: 'TEST',
      title: 'Title B',
      decision: 'b',
      impacts: ['src/x.ts'],
      actor: 'daniel',
    });
    decisions.record({
      projectKey: 'TEST',
      title: 'Title C',
      decision: 'c',
      impacts: ['src/x.ts'],
      actor: 'daniel',
    });
    // Force strictly-increasing recording times — isoNow() is millisecond
    // resolution, so three synchronous inserts can otherwise collide.
    setAt('TEST-ADR-1', '2026-01-01T00:00:00.000Z');
    setAt('TEST-ADR-2', '2026-01-02T00:00:00.000Z');
    setAt('TEST-ADR-3', '2026-01-03T00:00:00.000Z');

    // Assert raw order WITHOUT sorting — the newest-first contract is the point.
    const hits = decisions.impacting('TEST', 'src/x.ts');
    expect(hits.map((d) => d.key)).toEqual(['TEST-ADR-3', 'TEST-ADR-2', 'TEST-ADR-1']);
  });
});
