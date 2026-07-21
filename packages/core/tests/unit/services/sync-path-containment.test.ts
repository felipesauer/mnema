import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Task } from '@/domain/entities/task.js';
import { SyncService } from '@/services/sync/sync-service.js';

/**
 * The task's `state` names a backlog subdirectory, and since migration
 * 004 dropped the DB CHECK on `tasks.state`, a hostile state (`../../…`)
 * could steer a markdown write outside the backlog root. `pathForTask`
 * must contain the resolved path to that root — a defence in depth beyond
 * the rebuild-time state validation, since every write/relocate/delete
 * routes through it.
 */
describe('SyncService.pathForTask containment', () => {
  /**
   * Builds just enough of a SyncService to exercise pathForTask without
   * standing up the whole dependency graph. The method only reads
   * `this.paths`.
   */
  function serviceWithRoot(projectRoot: string, backlogDir: string): SyncService {
    const svc = Object.create(SyncService.prototype) as SyncService;
    (svc as unknown as { paths: { projectRoot: string; backlogDir: string } }).paths = {
      projectRoot,
      backlogDir,
    };
    return svc;
  }

  const svc = serviceWithRoot('/tmp/proj', '.mnema/backlog');
  const task = (state: string): Task => ({ id: 'task-fixture-id', key: 'T-1', state }) as Task;

  it('resolves a normal state inside the backlog root', () => {
    const p = svc.pathForTask(task('DRAFT'));
    expect(p).toBe(path.resolve('/tmp/proj/.mnema/backlog/DRAFT/task-fixture-id.md'));
  });

  it('allows an unusual but contained state name', () => {
    // Uppercase + underscore states are legitimate across the presets.
    expect(() => svc.pathForTask(task('IN_REVIEW'))).not.toThrow();
  });

  it('refuses a state that escapes the backlog root with ..', () => {
    expect(() => svc.pathForTask(task('../../etc'))).toThrow(/escapes the backlog/);
  });

  it('refuses a state that is an absolute path', () => {
    expect(() => svc.pathForTask(task('/etc'))).toThrow(/escapes the backlog/);
  });

  it('refuses a deeper traversal', () => {
    expect(() => svc.pathForTask(task('a/../../../..'))).toThrow(/escapes the backlog/);
  });
});
