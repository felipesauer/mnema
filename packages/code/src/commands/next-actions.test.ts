import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runNextActions } from './next-actions.js';
import { runTask } from './task.js';
import { runTaskTransition } from './task-transition.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-next-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

function projectWithTask(): { repo: string; env: DiscoveryEnv; id: string } {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const created = runTask({ cwd: repo, env }, { title: 'a task' });
  if (!created.ok) throw new Error('setup: task create refused');
  return { repo, env, id: created.id };
}

describe('mnema next-actions', () => {
  it('lists the legal moves from a DRAFT task’s state', () => {
    const { repo, env, id } = projectWithTask();
    const result = runNextActions({ cwd: repo, env }, { id });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe(id);
      // DRAFT allows submit (no proof) and cancel (needs a reason).
      const byAction = new Map(result.actions.map((a) => [a.action, a]));
      expect(byAction.get('submit')).toEqual({ action: 'submit', to: 'READY', requires: [] });
      expect(byAction.get('cancel')).toEqual({
        action: 'cancel',
        to: 'CANCELED',
        requires: ['reason'],
      });
    }
  });

  it('returns an EMPTY list for a terminal task (exists, no legal moves)', () => {
    const { repo, env, id } = projectWithTask();
    // Cancel the task → CANCELED, which no transition leaves (terminal).
    const canceled = runTaskTransition(
      { cwd: repo, env },
      { id, action: 'cancel', proof: { reason: 'abandoned' } },
    );
    expect(canceled.ok).toBe(true);

    const result = runNextActions({ cwd: repo, env }, { id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.actions).toEqual([]);
  });

  it('refuses UNKNOWN_TASK for an id no visible tree holds (distinct from terminal)', () => {
    const { repo, env } = projectWithTask();
    const result = runNextActions({ cwd: repo, env }, { id: 'no-such-task-id' });
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_TASK' });
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { repo, env } = setup(); // no init
    const result = runNextActions({ cwd: repo, env }, { id: 'anything' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
