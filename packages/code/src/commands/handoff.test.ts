import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectHandoffs, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHandoff } from './handoff.js';
import { runInit } from './init.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-handoff-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Reads the handoffs projected from a tree root. */
function handoffsOf(root: string) {
  return projectHandoffs(orderedEvents({ root }, catalogUpcasters()));
}

describe('mnema handoff', () => {
  it('records a handoff on a task, echoing the fact (there is no id)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runHandoff(
      { cwd: repo, env },
      { task: 'a-task-id', fromAgent: 'claude-code', toAgent: 'cursor' },
    );
    expect(result).toEqual({
      ok: true,
      task: 'a-task-id',
      fromAgent: 'claude-code',
      toAgent: 'cursor',
    });
    // The handoff really landed, keyed by the task.
    const root = resolveTrees(repo, env).projectPublic as string;
    const list = handoffsOf(root).get('a-task-id');
    expect(list?.length).toBe(1);
    expect(list?.[0]?.fromAgent).toBe('claude-code');
    expect(list?.[0]?.toAgent).toBe('cursor');
  });

  it('from == to is legitimate (a chat restart with the same agent), not refused', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runHandoff(
      { cwd: repo, env },
      { task: 'a-task-id', fromAgent: 'claude-code', toAgent: 'claude-code' },
    );
    expect(result.ok).toBe(true);
    const root = resolveTrees(repo, env).projectPublic as string;
    expect(handoffsOf(root).get('a-task-id')?.[0]?.toAgent).toBe('claude-code');
  });

  it('does NOT validate the `task` reference: a dangling task is accepted', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runHandoff(
      { cwd: repo, env },
      { task: '00000000-0000-7000-8000-000000000000', fromAgent: 'a', toAgent: 'b' },
    );
    expect(result.ok).toBe(true);
  });

  it('multiple handoffs on one task accumulate into a list', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runHandoff({ cwd: repo, env }, { task: 'T', fromAgent: 'a', toAgent: 'b' });
    runHandoff({ cwd: repo, env }, { task: 'T', fromAgent: 'b', toAgent: 'c' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const list = handoffsOf(root).get('T');
    expect(list?.length).toBe(2);
    expect(list?.map((h) => h.toAgent)).toEqual(['b', 'c']);
  });

  it('leaves the tree fully signed after recording a handoff', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runHandoff({ cwd: repo, env }, { task: 'T', fromAgent: 'a', toAgent: 'b' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runHandoff({ cwd: orphan, env }, { task: 'T', fromAgent: 'a', toAgent: 'b' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('--scope private is honored: the handoff is born in the private tree', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runHandoff(
      { cwd: repo, env },
      { task: 'T', fromAgent: 'a', toAgent: 'b', scope: 'private' },
    );
    expect(result.ok).toBe(true);
    const trees = resolveTrees(repo, env);
    expect(handoffsOf(trees.projectPrivate as string).has('T')).toBe(true);
    expect(handoffsOf(trees.projectPublic as string).has('T')).toBe(false);
  });
});
