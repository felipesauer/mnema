/**
 * That a move REPLAYS the record at most once before it writes, and reads it once more only to find
 * the lines about its subject.
 *
 * `task move` and `decision move` used to read it twice outside the lock: once to find the tree
 * the entity was born in (a replay of the chain) and once for what the gate judges (the kept
 * projection, brought forward). At 100 thousand events each was about 2 s. The tree is found in the
 * projection the tree keeps, and a projection already kept is not walked again.
 *
 * WHAT THE GATE JUDGES IS NOT TAKEN FROM THAT PROJECTION ANY MORE: it is a file beside the record
 * that nothing signs, and a row of it edited by hand let a gate append a move it refuses. The gate
 * searches the segments for the lines that name its subject (`subjectEvents`) and parses those
 * alone, so every move reads each segment ONE more time, as bytes, and that reading is not a replay.
 *
 * WHAT IS COUNTED is the segment files read whole, split by who read them: the gate's search, and
 * every other reading (a replay of a tail reads its segments, so a second walk of the record, by
 * whichever door, shows as a second read of the same file). It is counted on a record whose
 * projection is already kept, which is every move but the first on a clone.
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

/** What `act` read of the tail's segment files, whole: by the gate's search, and otherwise. */
function wholeReads(act: () => void): { readonly searched: number; readonly walked: number } {
  const real = fs.readFileSync;
  let searched = 0;
  let walked = 0;
  (fs as { readFileSync: unknown }).readFileSync = (...args: unknown[]) => {
    const path = String(args[0]);
    if (path.startsWith(root) && path.endsWith('.jsonl')) {
      // By the frame that asked: the stack names the module, as built or as mapped to its source.
      if (/subject-events\.[jt]s/.test(new Error().stack ?? '')) searched += 1;
      else walked += 1;
    }
    return (real as (...a: unknown[]) => unknown)(...args);
  };
  syncBuiltinESMExports();
  try {
    act();
  } finally {
    (fs as { readFileSync: unknown }).readFileSync = real;
    syncBuiltinESMExports();
  }
  return { searched, walked };
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
  it('task move on a record nobody has read: the one walk is the one that builds the projection', () => {
    const id = aTask();
    const moved = { ok: false as boolean };
    const reads = wholeReads(() => {
      moved.ok = runTaskTransition({ cwd: repo, env }, { id, action: 'submit' }).ok;
    });
    expect(moved.ok).toBe(true);
    expect(reads).toEqual({ searched: 1, walked: 1 });
  });

  it('task move on a record whose projection is kept: the chain is not walked, only searched', () => {
    const id = aTask();
    keep();
    const moved = { ok: false as boolean };
    const reads = wholeReads(() => {
      moved.ok = runTaskTransition({ cwd: repo, env }, { id, action: 'submit' }).ok;
    });
    expect(moved.ok).toBe(true);
    expect(reads).toEqual({ searched: 1, walked: 0 });
  });

  it('decision move: neither the lookup nor the report that follows the write walks the chain; the gate searches it', () => {
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
    expect(reads).toEqual({ searched: 1, walked: 0 });
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
    expect(reads).toEqual({ searched: 1, walked: 0 });
  });
});
