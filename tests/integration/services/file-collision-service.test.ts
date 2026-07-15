import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ErrorCode } from '@/errors/error-codes.js';
import type { CommandRunner } from '@/services/git/github-pr-service.js';
import { FileCollisionService } from '@/services/lint/file-collision-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskEvidenceRepository } from '@/storage/sqlite/repositories/task-evidence-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/** A git runner that maps a commit sha → the files it touched. */
function gitRunner(byCommit: Record<string, string[]>): CommandRunner {
  return (_command, args) => {
    // args: -C <root> show --name-only --format= <sha>
    const sha = args[args.length - 1] ?? '';
    const files = byCommit[sha];
    if (files === undefined) return { status: 1, stdout: '' };
    return { status: 0, stdout: `${files.join('\n')}\n` };
  };
}

describe('FileCollisionService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let tasks: TaskRepository;
  let evidence: TaskEvidenceRepository;
  let epics: EpicRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-collision-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')")
      .run();
    actorId = 'a1';
    tasks = new TaskRepository(adapter);
    evidence = new TaskEvidenceRepository(adapter);
    epics = new EpicRepository(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Seed a task in an epic with one acceptance criterion + a commit evidence sha. */
  function seed(key: string, epicId: string, sha?: string): void {
    const task = tasks.insert({
      key,
      projectId,
      title: key,
      reporterId: actorId,
      epicId,
      acceptanceCriteria: ['ships'],
    });
    if (sha !== undefined) {
      evidence.insert({ taskId: task.id, criterionIndex: 0, kind: 'commit', ref: sha });
    }
  }

  function service(byCommit: Record<string, string[]>): FileCollisionService {
    return new FileCollisionService(
      tasks,
      evidence,
      epics,
      new SprintRepository(adapter),
      tempRoot,
      gitRunner(byCommit),
    );
  }

  it('flags two tasks in an epic that touch the same file', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E' });
    seed('T-A', epic.id, 'sha-a');
    seed('T-B', epic.id, 'sha-b');
    seed('T-C', epic.id, 'sha-c');
    const svc = service({
      'sha-a': ['src/mcp/mcp-server.ts', 'src/a.ts'],
      'sha-b': ['src/mcp/mcp-server.ts', 'src/b.ts'], // collides with A on mcp-server.ts
      'sha-c': ['src/c.ts'], // no overlap
    });

    const result = svc.scan({ kind: 'epic', key: 'TEST-EPIC-1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.collisions).toEqual([
      { taskA: 'T-A', taskB: 'T-B', files: ['src/mcp/mcp-server.ts'] },
    ]);
    expect(result.value.analysed.sort()).toEqual(['T-A', 'T-B', 'T-C']);
    expect(result.value.skipped).toEqual([]);
  });

  it('reports no collisions when file sets are disjoint', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E' });
    seed('T-A', epic.id, 'sha-a');
    seed('T-B', epic.id, 'sha-b');
    const svc = service({ 'sha-a': ['src/a.ts'], 'sha-b': ['src/b.ts'] });
    const result = svc.scan({ kind: 'epic', key: 'TEST-EPIC-1' });
    if (!result.ok) return;
    expect(result.value.collisions).toEqual([]);
  });

  it('skips tasks with no commit evidence (files cannot be inferred)', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E' });
    seed('T-A', epic.id, 'sha-a');
    seed('T-NOEV', epic.id); // no commit evidence
    const svc = service({ 'sha-a': ['src/a.ts'] });
    const result = svc.scan({ kind: 'epic', key: 'TEST-EPIC-1' });
    if (!result.ok) return;
    expect(result.value.analysed).toEqual(['T-A']);
    expect(result.value.skipped).toEqual(['T-NOEV']);
    expect(result.value.collisions).toEqual([]);
  });

  it('orders collisions by number of shared files, most first', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E' });
    seed('T-A', epic.id, 'sha-a');
    seed('T-B', epic.id, 'sha-b');
    seed('T-C', epic.id, 'sha-c');
    const svc = service({
      'sha-a': ['x.ts', 'y.ts', 'z.ts'],
      'sha-b': ['x.ts', 'y.ts'], // shares 2 with A
      'sha-c': ['z.ts'], // shares 1 with A
    });
    const result = svc.scan({ kind: 'epic', key: 'TEST-EPIC-1' });
    if (!result.ok) return;
    expect(result.value.collisions.map((c) => [c.taskA, c.taskB, c.files.length])).toEqual([
      ['T-A', 'T-B', 2],
      ['T-A', 'T-C', 1],
    ]);
  });

  it('returns EpicNotFound for an unknown epic', () => {
    const result = service({}).scan({ kind: 'epic', key: 'NOPE-9' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.EpicNotFound);
  });
});
