import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from './decision.js';
import { runDecisionTransition } from './decision-transition.js';
import { runInit } from './init.js';
import { runLink } from './link.js';
import { runMemory } from './memory.js';
import { runObserve } from './observe.js';
import { runReferences } from './references.js';
import { runTask } from './task.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-refs-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/**
 * A content digest of every file under `dir`, so a read that must write nothing
 * can be proven byte-identical before and after.
 */
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

describe('mnema refs (what an entity is connected to)', () => {
  it('gathers the neighbourhood across the trees, each edge marked with its tree', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const task = runTask({ cwd: repo, env }, { title: 'the work', scope: 'public' });
    if (!task.ok) throw new Error('setup: task refused');
    // The observation lands PRIVATE and the link GLOBAL — so a walk that read one
    // tree would find neither, or only one.
    const obs = runObserve(
      { cwd: repo, env },
      { about: task.id, topic: 'note', text: 'watch this', scope: 'private' },
    );
    if (!obs.ok) throw new Error('setup: observe refused');
    const memory = runMemory({ cwd: repo, env }, { content: 'why we did it', scope: 'global' });
    if (!memory.ok) throw new Error('setup: memory refused');
    const linked = runLink(
      { cwd: repo, env },
      { subject: memory.id, target: task.id, rel: 'derived-from', scope: 'global' },
    );
    if (!linked.ok) throw new Error('setup: link refused');

    const result = runReferences({ cwd: repo, env }, { id: task.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      result.graph.links
        .map((l) => [l.role, l.from, l.to, l.scope])
        .sort((a, b) => (a[0] as string).localeCompare(b[0] as string)),
    ).toEqual([
      ['about', obs.id, task.id, 'private'],
      ['target', memory.id, task.id, 'global'],
    ]);
    // Each far end resolved to what it actually is, and to the tree holding it.
    const nodes = new Map(result.graph.nodes.map((n) => [n.id, n]));
    expect(nodes.get(memory.id)).toMatchObject({ kind: 'memory', scope: 'global', depth: 1 });
    expect(nodes.get(obs.id)).toMatchObject({ kind: 'observation', scope: 'private', depth: 1 });
  });

  it('walks a decision’s supersede chain, and sees it from the successor too', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const first = runDecision({ cwd: repo, env }, { title: 'the call', rationale: 'because' });
    if (!first.ok) throw new Error('setup: decision refused');
    const second = runDecision(
      { cwd: repo, env },
      { title: 'the newer call', rationale: 'better' },
    );
    if (!second.ok) throw new Error('setup: decision refused');
    const moved = runDecisionTransition(
      { cwd: repo, env },
      { id: first.id, action: 'supersede', by: second.id, proof: { reason: 'replaced' } },
    );
    if (!moved.ok) throw new Error(`setup: supersede refused (${JSON.stringify(moved)})`);

    // From the SUCCESSOR — the side that used to see nothing at all.
    const back = runReferences({ cwd: repo, env }, { id: second.id, direction: 'in', depth: 3 });
    if (!back.ok) throw new Error('refs refused');
    expect(back.graph.links.map((l) => [l.from, l.role, l.to])).toEqual([
      [first.id, 'by', second.id],
    ]);
    expect(back.graph.nodes.map((n) => [n.id, n.depth])).toEqual([
      [second.id, 0],
      [first.id, 1],
    ]);
  });

  it('refuses a direction that is not one', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    expect(runReferences({ cwd: repo, env }, { id: 'x', direction: 'sideways' })).toEqual({
      ok: false,
      reason: 'UNKNOWN_DIRECTION',
      direction: 'sideways',
    });
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { repo, env } = setup(); // no init
    expect(runReferences({ cwd: repo, env }, { id: 'anything' })).toEqual({
      ok: false,
      reason: 'NO_PROJECT',
    });
  });

  it('answers an id nothing references, and one nothing ever authored', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const task = runTask({ cwd: repo, env }, { title: 'alone', scope: 'public' });
    if (!task.ok) throw new Error('setup');

    const alone = runReferences({ cwd: repo, env }, { id: task.id });
    if (!alone.ok) throw new Error('refs refused');
    expect(alone.graph.links).toEqual([]);

    const ghost = runReferences({ cwd: repo, env }, { id: 'never-minted' });
    if (!ghost.ok) throw new Error('refs refused');
    expect(ghost.graph.nodes).toEqual([{ id: 'never-minted', depth: 0, resolved: false }]);
  });

  it('writes NOTHING — the sandbox is byte-identical before and after', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const task = runTask({ cwd: repo, env }, { title: 'x', scope: 'public' });
    if (!task.ok) throw new Error('setup');
    const before = digest(sandbox);
    runReferences({ cwd: repo, env }, { id: task.id, depth: 5 });
    runReferences({ cwd: repo, env }, { id: 'ghost' });
    expect(digest(sandbox)).toBe(before);
  });
});
