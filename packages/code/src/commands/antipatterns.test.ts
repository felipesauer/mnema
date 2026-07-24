import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAntipatterns } from './antipatterns.js';
import { runInit } from './init.js';
import { runTask } from './task.js';
import { runTaskTransition } from './task-transition.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-antipatterns-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/** Drives a task DRAFT→…→DONE, then reopens it and re-completes it `times` more. */
function reopenTaskTimes(repo: string, env: DiscoveryEnv, times: number): string {
  const created = runTask({ cwd: repo, env }, { title: 'churny task', scope: 'public' });
  if (!created.ok) throw new Error('setup: task refused');
  const id = created.id;
  const step = (action: string, proof?: Record<string, string>): void => {
    const r = runTaskTransition({ cwd: repo, env }, { id, action, ...(proof ? { proof } : {}) });
    if (!r.ok) throw new Error(`setup: ${action} refused (${'code' in r ? r.code : r.reason})`);
  };
  step('submit');
  step('start');
  step('complete', { note: 'done' });
  for (let i = 0; i < times; i += 1) {
    step('reopen', { reason: `round ${i}` });
    step('complete', { note: 'done again' });
  }
  return id;
}

describe('mnema antipatterns (recurring shapes, with evidence)', () => {
  it('counts a task reopened twice and points at it as a skill candidate', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const id = reopenTaskTimes(repo, env, 2);

    const result = runAntipatterns({ cwd: repo, env });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const finding = result.patterns.reopenedTasks.find((f) => f.entityId === id);
    expect(finding?.count).toBe(2);
    // The evidence is the two reopen events themselves.
    expect(finding?.evidence).toHaveLength(2);
    // Reopened MORE than once → a skill candidate (a pointer, not an action).
    expect(result.patterns.skillCandidates.map((f) => f.entityId)).toContain(id);
    // Nothing here superseded a decision or deprecated a skill.
    expect(result.patterns.supersededDecisions).toEqual([]);
    expect(result.patterns.deprecatedSkills).toEqual([]);
  });

  it('a task reopened once is a finding but NOT a candidate (threshold is >1)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const id = reopenTaskTimes(repo, env, 1);

    const result = runAntipatterns({ cwd: repo, env });
    if (!result.ok) return;
    expect(result.patterns.reopenedTasks.find((f) => f.entityId === id)?.count).toBe(1);
    expect(result.patterns.skillCandidates.map((f) => f.entityId)).not.toContain(id);
  });

  it('a shape-free record yields empty lists (never an error)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'quiet', scope: 'public' });
    const result = runAntipatterns({ cwd: repo, env });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patterns.reopenedTasks).toEqual([]);
      expect(result.patterns.skillCandidates).toEqual([]);
    }
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { repo, env } = setup(); // no init
    const result = runAntipatterns({ cwd: repo, env });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('writes NOTHING — the sandbox is byte-identical before and after', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    reopenTaskTimes(repo, env, 2);
    const before = digest(sandbox);
    runAntipatterns({ cwd: repo, env });
    expect(digest(sandbox)).toBe(before);
  });
});
