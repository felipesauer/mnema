import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectTasks, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runTask } from './task.js';
import { runTaskTransition } from './task-transition.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-move-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Creates a project and one task, returning the task's id for a move. */
function projectWithTask(): { repo: string; env: DiscoveryEnv; id: string } {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const created = runTask({ cwd: repo, env }, { title: 'a task' });
  if (!created.ok) throw new Error('setup: task create refused');
  return { repo, env, id: created.id };
}

/** Reads a task's current state from the public chain. */
function stateOf(repo: string, env: DiscoveryEnv, id: string): string | undefined {
  const root = resolveTrees(repo, env).projectPublic as string;
  return projectTasks(orderedEvents({ root }, catalogUpcasters())).get(id)?.state;
}

describe('mnema task move', () => {
  it('moves a DRAFT task through submit → start and reports each new state', () => {
    const { repo, env, id } = projectWithTask();

    const submitted = runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    expect(submitted).toMatchObject({ ok: true, to: 'READY' });
    expect(stateOf(repo, env, id)).toBe('READY');

    const started = runTaskTransition({ cwd: repo, env }, { id, action: 'start' });
    expect(started).toMatchObject({ ok: true, to: 'IN_PROGRESS' });
    if (started.ok) expect(started.alias).toMatch(/^t-[0-9a-f]{4}$/);
    expect(stateOf(repo, env, id)).toBe('IN_PROGRESS');
  });

  it('carries a required proof field through to the gate (complete needs a note)', () => {
    const { repo, env, id } = projectWithTask();
    runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    runTaskTransition({ cwd: repo, env }, { id, action: 'start' });

    const completed = runTaskTransition(
      { cwd: repo, env },
      { id, action: 'complete', proof: { note: 'shipped in v1' } },
    );
    expect(completed).toMatchObject({ ok: true, to: 'DONE' });
    expect(stateOf(repo, env, id)).toBe('DONE');
  });

  it('leaves the tree fully signed after a move', () => {
    const { repo, env, id } = projectWithTask();
    runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('reports the gate refusal for an illegal move (start from DRAFT)', () => {
    const { repo, env, id } = projectWithTask();
    // DRAFT → start is not a legal move (must submit to READY first).
    const result = runTaskTransition({ cwd: repo, env }, { id, action: 'start' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'ILLEGAL_TRANSITION' });
    // Nothing was written: the task is still DRAFT.
    expect(stateOf(repo, env, id)).toBe('DRAFT');
  });

  it('reports the gate refusal when a required proof field is missing', () => {
    const { repo, env, id } = projectWithTask();
    runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    runTaskTransition({ cwd: repo, env }, { id, action: 'start' });
    // complete requires a note; none given.
    const result = runTaskTransition({ cwd: repo, env }, { id, action: 'complete' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'MISSING_PROOF' });
    expect(stateOf(repo, env, id)).toBe('IN_PROGRESS');
  });

  it('reports the gate refusal for an unknown action (the surface does not validate it)', () => {
    const { repo, env, id } = projectWithTask();
    const result = runTaskTransition({ cwd: repo, env }, { id, action: 'frobnicate' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_ACTION' });
  });

  it('reports UNKNOWN_TASK for an id that does not exist', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runTaskTransition(
      { cwd: repo, env },
      { id: '00000000-0000-7000-8000-000000000000', action: 'submit' },
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_TASK' });
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runTaskTransition({ cwd: orphan, env }, { id: 'anything', action: 'submit' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
