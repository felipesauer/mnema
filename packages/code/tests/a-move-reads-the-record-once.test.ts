/**
 * That a move reads the record ONCE before it writes.
 *
 * `task move` and `decision move` used to read it twice outside the lock: once to find the tree
 * the entity was born in (a replay of the chain) and once for what the gate judges (the kept
 * projection, brought forward). At 100 thousand events each was about 2 s. They are one reading
 * now: the tree is found in the projection the judgement reads.
 *
 * WHAT IS COUNTED is the segment files the chain is read from whole: every replay of a tail reads
 * its segments, so a second walk of the record, by whichever door, shows as a second read of the
 * same file. It is counted on a record whose projection is already kept, which is every move but
 * the first on a clone.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from '../src/commands/decision.js';
import { runDecisionTransition } from '../src/commands/decision-transition.js';
import { runInit } from '../src/commands/init.js';
import { runTask } from '../src/commands/task.js';
import { runTaskTransition } from '../src/commands/task-transition.js';
import { withCache } from '../src/tree-sources.js';

/** The CommonJS `fs`, whose properties can be replaced; the ESM namespace's cannot. */
const fs = createRequire(import.meta.url)('node:fs') as { readFileSync: unknown };

let sandbox: string;
let repo: string;
let env: { home: string };
let root: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-move-reads-once-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  root = chainRootForScope(resolveTrees(repo, env), 'public') as string;
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Runs `act`; returns how many times each file under the tree was read whole, by path. */
function readsDuring(act: () => void): Map<string, number> {
  const real = fs.readFileSync;
  const seen = new Map<string, number>();
  (fs as { readFileSync: unknown }).readFileSync = (...args: unknown[]) => {
    const path = String(args[0]);
    if (path.startsWith(root)) seen.set(path, (seen.get(path) ?? 0) + 1);
    return (real as (...a: unknown[]) => unknown)(...args);
  };
  syncBuiltinESMExports();
  try {
    act();
  } finally {
    (fs as { readFileSync: unknown }).readFileSync = real;
    syncBuiltinESMExports();
  }
  return seen;
}

/** How many times the tail's segment file was read whole while `act` ran. */
function wholeReads(act: () => void): number {
  let total = 0;
  for (const [path, times] of readsDuring(act)) if (path.endsWith('.jsonl')) total += times;
  return total;
}

/** Brings the projection forward and keeps it, as any read before the move would have. */
function keep(): void {
  withCache(root, catalogUpcasters(), () => undefined);
}

function aTask(): string {
  const created = runTask({ cwd: repo, env }, { title: 'a task' });
  if (!created.ok) throw new Error('setup: task refused');
  return created.id;
}

function aDecision(title: string): string {
  const recorded = runDecision({ cwd: repo, env }, { title, rationale: 'because' });
  if (!recorded.ok) throw new Error('setup: decision refused');
  return recorded.id;
}

describe('a move reads the record once', () => {
  it('task move on a record nobody has read: the one reading is the one that builds the projection', () => {
    const id = aTask();
    const moved = { ok: false as boolean };
    const reads = wholeReads(() => {
      moved.ok = runTaskTransition({ cwd: repo, env }, { id, action: 'submit' }).ok;
    });
    expect(moved.ok).toBe(true);
    expect(reads).toBe(1);
  });

  it('task move on a record whose projection is kept: the chain is not walked at all', () => {
    const id = aTask();
    keep();
    const moved = { ok: false as boolean };
    const reads = wholeReads(() => {
      moved.ok = runTaskTransition({ cwd: repo, env }, { id, action: 'submit' }).ok;
    });
    expect(moved.ok).toBe(true);
    expect(reads).toBe(0);
  });

  it('decision move: neither the lookup nor the report that follows the write walks the chain', () => {
    const id = aDecision('use sqlite');
    keep();
    const moved = { adr: '' };
    const reads = wholeReads(() => {
      const result = runDecisionTransition(
        { cwd: repo, env },
        { id, action: 'accept', proof: { note: 'agreed' } },
      );
      if (result.ok) moved.adr = result.adr;
    });
    expect(moved.adr).toMatch(/^ADR-\d+$/);
    expect(reads).toBe(0);
  });

  it('a supersede by a proposal still says nothing is in force, read from the kept projection', () => {
    const old = aDecision('use sqlite');
    const successor = aDecision('use postgres');
    runDecisionTransition({ cwd: repo, env }, { id: old, action: 'accept', proof: { note: 'ok' } });
    keep();
    const moved = { notice: '' };
    const reads = wholeReads(() => {
      const result = runDecisionTransition(
        { cwd: repo, env },
        { id: old, action: 'supersede', by: successor, proof: { reason: 'replaced' } },
      );
      if (result.ok) moved.notice = result.notice ?? '';
    });
    expect(moved.notice).toContain('is still proposed');
    expect(reads).toBe(0);
  });
});
