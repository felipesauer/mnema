import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { GitObserverService } from '@/services/git-observer-service.js';
import type { CommandResult, CommandRunner } from '@/services/github-pr-service.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

/** A git runner scripted for the observer's calls. */
function fakeGit(script: { branch?: string; log?: string; inWorkTree?: boolean }): CommandRunner {
  return (command, args): CommandResult => {
    expect(command).toBe('git');
    if (args.includes('rev-parse') && args.includes('--is-inside-work-tree')) {
      return { status: 0, stdout: script.inWorkTree === false ? 'false' : 'true' };
    }
    if (args.includes('rev-parse') && args.includes('--abbrev-ref')) {
      return { status: 0, stdout: script.branch ?? 'main' };
    }
    if (args.includes('log')) {
      return { status: 0, stdout: script.log ?? '' };
    }
    return { status: 0, stdout: '' };
  };
}

function makeConfig(): Config {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
}

describe('GitObserverService links the unambiguous in-progress task (MNEMA-230)', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-gitobs-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      const full = path.join(projectRoot, dir);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );
    container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /** An observer bound to the container's DB but with a mocked git runner. */
  function observer(gitScript: { branch?: string; log?: string; inWorkTree?: boolean }) {
    return new GitObserverService(
      new TaskRepository(container.adapter),
      { findActorIdByHandle: (h) => container.identity.findActorIdByHandle(h) },
      fakeGit(gitScript),
    );
  }

  /** Create a task and drive it to IN_PROGRESS assigned to `daniel`. */
  function inProgressTask(title: string): string {
    const created = container.task.create({ projectKey: 'TEST', title, actor: 'daniel' });
    if (!created.ok) throw new Error('create failed');
    const key = created.value.key;
    container.task.transition({
      taskKey: key,
      action: 'submit',
      payload: { title, description: `${title} ready`, acceptance_criteria: ['ok'], estimate: 1 },
      actor: 'daniel',
    });
    container.task.transition({
      taskKey: key,
      action: 'start',
      payload: { assignee_id: 'daniel' },
      actor: 'daniel',
    });
    return key;
  }

  it('links the single in-progress task to the branch + commits', () => {
    const key = inProgressTask('Wire notifier');
    const r = observer({
      branch: 'feat/notifier',
      log: 'aaaaaaa\x1fwire it\nbbbbbbb\x1fmore',
    }).observe(projectRoot, 'daniel');
    expect(r.checked).toBe(true);
    expect(r.linkedTaskKey).toBe(key);

    const task = container.task.findByKey(key);
    if (!task.ok) throw new Error('reload failed');
    expect(task.value.gitBranch).toBe('feat/notifier');
    expect(task.value.gitCommits.map((c) => c.sha)).toEqual(['aaaaaaa', 'bbbbbbb']);
  });

  it('links nothing when two in-progress tasks are ambiguous', () => {
    inProgressTask('Task one');
    inProgressTask('Task two');
    const r = observer({ branch: 'feat/x', log: 'aaa\x1fx' }).observe(projectRoot, 'daniel');
    expect(r.checked).toBe(true);
    expect(r.linkedTaskKey).toBeNull();
    expect(r.reason).toContain('ambiguous');
  });

  it('is unchecked (no-op) when git is absent', () => {
    inProgressTask('Solo');
    const r = observer({ inWorkTree: false }).observe(projectRoot, 'daniel');
    expect(r.checked).toBe(false);
    expect(r.linkedTaskKey).toBeNull();
  });

  it('works against a REAL git repo (default runner), end-to-end', () => {
    // Make the project root an actual git repo on a real branch with commits,
    // then run the observer with the DEFAULT (real) runner — no mock.
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'ignore' });
    };
    git('init');
    git('config', 'user.email', 't@t.co');
    git('config', 'user.name', 't');
    git('checkout', '-b', 'feat/real');
    git('commit', '--allow-empty', '-m', 'real one');
    git('commit', '--allow-empty', '-m', 'real two');

    const key = inProgressTask('Real work');
    const real = new GitObserverService(new TaskRepository(container.adapter), {
      findActorIdByHandle: (h) => container.identity.findActorIdByHandle(h),
    });
    const r = real.observe(projectRoot, 'daniel');
    expect(r.checked).toBe(true);
    expect(r.linkedTaskKey).toBe(key);

    const task = container.task.findByKey(key);
    if (!task.ok) throw new Error('reload failed');
    expect(task.value.gitBranch).toBe('feat/real');
    expect(task.value.gitCommits.length).toBeGreaterThanOrEqual(2);
    expect(task.value.gitCommits.some((c) => c.subject === 'real two')).toBe(true);
  });

  it('a repeated identical observe is a no-op — does not churn updated_at', () => {
    // The observer runs after every audit event under `watch --git`; an
    // unchanged link must not keep bumping updated_at (which is the
    // optimistic-concurrency token and the aging clock). Regression for the
    // audit's HIGH finding: setGitLink now skips the write when nothing changed.
    const key = inProgressTask('Steady work');
    const obs = observer({ branch: 'feat/steady', log: 'aaaaaaa\x1fone' });
    const first = obs.observe(projectRoot, 'daniel');
    expect(first.linkedTaskKey).toBe(key);
    const afterFirst = container.task.findByKey(key);
    if (!afterFirst.ok) throw new Error('reload');
    const stamp = afterFirst.value.updatedAt;

    // Spin so wall-clock advances; a real UPDATE would move updated_at.
    const t0 = Date.now();
    while (Date.now() - t0 < 10) {
      /* advance the clock */
    }
    obs.observe(projectRoot, 'daniel'); // identical link — must be inert
    const afterSecond = container.task.findByKey(key);
    if (!afterSecond.ok) throw new Error('reload');
    expect(afterSecond.value.updatedAt).toBe(stamp);
  });
});
