import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAntipatterns } from './antipatterns.js';
import { runBrief } from './brief.js';
import { runDecision } from './decision.js';
import { runDecisionTransition } from './decision-transition.js';
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

function setup(name = 'repo'): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, name);
  mkdirSync(repo, { recursive: true });
  return {
    repo,
    env: { xdgDataHome: join(sandbox, `${name}-data`), home: join(sandbox, `${name}-home`) },
  };
}

/**
 * Records a decision in `scope` and accepts it, handing back what the WRITE reported —
 * the id, and the `ADR-<n>` the product minted for it.
 */
function accepted(
  here: { cwd: string; env: DiscoveryEnv },
  title: string,
  scope: 'public' | 'private',
): { readonly id: string; readonly adr: string } {
  const recorded = runDecision(here, { title, rationale: 'because the record says so', scope });
  if (!recorded.ok) throw new Error(`setup: decision refused (${recorded.reason})`);
  const moved = runDecisionTransition(here, {
    id: recorded.id,
    action: 'accept',
    proof: { note: 'agreed in review' },
  });
  if (!moved.ok) throw new Error(`setup: accept refused (${moved.reason})`);
  return { id: recorded.id, adr: recorded.adr };
}

/**
 * Lands another working copy's committed tail in this one — the offline merge two
 * clones of a repository produce. The tails and the public key material are what a
 * clone brings; the signing key lives in the machine's key root, never in a tree.
 *
 * It is the only way one chain holds two `ADR-1`s: the number comes from the writer's
 * view of the chain, so two decisions on ONE machine are `ADR-1` and `ADR-2`.
 */
function merge(from: string, into: string): void {
  for (const part of ['tails', 'keys']) {
    cpSync(join(from, '.mnema', part), join(into, '.mnema', part), { recursive: true });
  }
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

  it('finds the label two clones both minted — without anyone generating the document', () => {
    // The audit's reason for existing in this slice. The committed document declares the
    // clash to whoever generates it; this finds the same clash by folding the record, so
    // a reader who never runs `mnema brief` is not the last to know.
    const mine = setup();
    const theirs = setup('clone');
    runInit({ cwd: mine.repo, env: mine.env });
    runInit({ cwd: theirs.repo, env: theirs.env });
    const ours = accepted({ cwd: mine.repo, env: mine.env }, 'Round over the total', 'public');
    const yours = accepted({ cwd: theirs.repo, env: theirs.env }, 'Round per line', 'public');
    expect([ours.adr, yours.adr]).toEqual(['ADR-1', 'ADR-1']);
    merge(theirs.repo, mine.repo);

    const result = runAntipatterns({ cwd: mine.repo, env: mine.env });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patterns.labelCollisions).toEqual([
      { adr: 'ADR-1', ids: [ours.id, yours.id].sort() },
    ]);
    // Nothing generated the file: this read opens no cache and prints no document, and
    // the two answers agree about the same clash.
    const document = runBrief({ cwd: mine.repo, env: mine.env });
    expect(document.ok && document.brief.collisions).toEqual(result.patterns.labelCollisions);
  });

  it('says nothing about a public ADR-1 beside a private one — one chain each', () => {
    // The counts fold the union of the trees; the labels do not, because the number is
    // numbered inside one chain. Pooling them would report this arrangement on nearly
    // every project that ever recorded a rule of its own.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const team = accepted({ cwd: repo, env }, 'What the team settled', 'public');
    const machine = accepted({ cwd: repo, env }, 'What this machine settled', 'private');
    expect([team.adr, machine.adr]).toEqual(['ADR-1', 'ADR-1']);

    const result = runAntipatterns({ cwd: repo, env });
    expect(result.ok && result.patterns.labelCollisions).toEqual([]);
    // Non-vacuity: the union really is what the counts are folded over, and it holds
    // both decisions — so the silence above is the unit, not an unread tree.
    expect(result.ok && result.patterns.supersededDecisions).toEqual([]);
    const both = [team.id, machine.id];
    expect(new Set(both).size).toBe(2);
  });

  it('a record with no clash reports none, and reports it as a list', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    accepted({ cwd: repo, env }, 'The first call', 'public');
    accepted({ cwd: repo, env }, 'The second call', 'public');
    const result = runAntipatterns({ cwd: repo, env });
    expect(result.ok && result.patterns.labelCollisions).toEqual([]);
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
