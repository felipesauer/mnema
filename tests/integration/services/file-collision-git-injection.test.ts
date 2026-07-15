import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileCollisionService } from '@/services/lint/file-collision-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskEvidenceRepository } from '@/storage/sqlite/repositories/task-evidence-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * Security regression: `FileCollisionService.filesFor` expands each task's
 * commit-evidence ref through the REAL `git show` shell-out (production
 * `defaultRunner`, no mock). Evidence refs are not format-validated at
 * attach time, so a hostile ref such as `--output=<path>` must not be
 * honoured by git as a flag — that would write an arbitrary file from a
 * read-only, advisory tool. The `--end-of-options` guard forces the ref to
 * be read as a revision operand.
 */
describe('FileCollisionService git argument injection', () => {
  let repo: string;
  let adapter: SqliteAdapter;
  let tasks: TaskRepository;
  let evidence: TaskEvidenceRepository;
  let epics: EpicRepository;
  let projectId: string;
  let actorId: string;

  /** Hermetic git env: never reads the developer's global config. */
  function git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  }

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'mnema-collision-git-'));
    git(['init', '-b', 'main']);
    writeFileSync(path.join(repo, 'file.txt'), 'hello\n', 'utf-8');
    git(['add', '-A']);
    git(['commit', '-m', 'initial']);

    // The SQLite state lives inside the repo dir but is not committed.
    adapter = new SqliteAdapter(path.join(repo, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    projectId = new ProjectRepository(adapter).insert({ key: 'TEST', name: 'Test' }).id;
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
    rmSync(repo, { recursive: true, force: true });
  });

  /** Seeds a task in the epic carrying one commit-evidence ref. */
  function seed(key: string, epicId: string, ref: string): void {
    const task = tasks.insert({
      key,
      projectId,
      title: key,
      reporterId: actorId,
      epicId,
      acceptanceCriteria: ['ships'],
    });
    evidence.insert({ taskId: task.id, criterionIndex: 0, kind: 'commit', ref });
  }

  it('does not write an arbitrary file when a commit ref is `--output=<path>`', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E' });
    const sink = path.join(repo, 'PWNED.txt');
    // Two tasks so the pair comparison runs; both carry a hostile ref.
    seed('T-A', epic.id, `--output=${sink}`);
    seed('T-B', epic.id, `--output=${sink}`);

    // Production service: no runner injected → real `git show`.
    const svc = new FileCollisionService(
      tasks,
      evidence,
      epics,
      new SprintRepository(adapter),
      repo,
    );
    const result = svc.scan({ kind: 'epic', key: 'TEST-EPIC-1' });

    // The scan completes (advisory, never throws) and, crucially, the
    // hostile ref wrote nothing — the guard neutralised it.
    expect(result.ok).toBe(true);
    expect(existsSync(sink)).toBe(false);
    if (result.ok) {
      // A ref that resolves to no files yields no collision.
      expect(result.value.collisions).toEqual([]);
    }
  });

  it('still resolves a legitimate commit SHA to its files', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-2', projectId, title: 'E' });
    const sha = git(['rev-parse', 'HEAD']).trim();
    seed('T-A', epic.id, sha);
    seed('T-B', epic.id, sha);

    const svc = new FileCollisionService(
      tasks,
      evidence,
      epics,
      new SprintRepository(adapter),
      repo,
    );
    const result = svc.scan({ kind: 'epic', key: 'TEST-EPIC-2' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Both tasks touch file.txt (the only file in the initial commit),
      // so they collide on it — proving the guard did not break resolution.
      expect(result.value.collisions).toEqual([
        { taskA: 'T-A', taskB: 'T-B', files: ['file.txt'] },
      ]);
    }
  });
});
