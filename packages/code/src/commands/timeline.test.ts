import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runLink } from './link.js';
import { runObserve } from './observe.js';
import { runTask } from './task.js';
import { runTaskTransition } from './task-transition.js';
import { runTimeline } from './timeline.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-timeline-'));
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

describe('mnema timeline (an entity’s history across the trees)', () => {
  it('gathers the entity across the union: subject in public, about in private, target in global', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    // The task is born PUBLIC and moved once — two events on its own subject.
    const task = runTask({ cwd: repo, env }, { title: 'the task', scope: 'public' });
    if (!task.ok) throw new Error('setup: task refused');
    const moved = runTaskTransition({ cwd: repo, env }, { id: task.id, action: 'submit' });
    if (!moved.ok) throw new Error('setup: submit refused');

    // An observation ABOUT the task lands in the PRIVATE tree (its own subject is
    // the observation's minted id — a filter on `subject` alone would miss it).
    const obs = runObserve(
      { cwd: repo, env },
      { about: task.id, topic: 'note', text: 'watch this', scope: 'private' },
    );
    if (!obs.ok) throw new Error('setup: observe refused');

    // A link whose TARGET is the task lands in the GLOBAL tree.
    const linked = runLink(
      { cwd: repo, env },
      { subject: 'other-entity', target: task.id, rel: 'relates-to', scope: 'global' },
    );
    if (!linked.ok) throw new Error('setup: link refused');

    const result = runTimeline({ cwd: repo, env }, { id: task.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Events touch the task on three axes — its own subject (created +
    // transition(s)), the observation (about), and the link (target) — proving the
    // union crosses public/private/global. Exactly one about and one target; the
    // rest are the task's own subject events.
    const byRole = (role: string): number => result.entries.filter((e) => e.role === role).length;
    expect(byRole('about')).toBe(1);
    expect(byRole('target')).toBe(1);
    expect(byRole('subject')).toBeGreaterThanOrEqual(2);
    const kinds = result.entries.map((e) => e.kind);
    expect(kinds).toContain('task.created');
    expect(kinds).toContain('task.transitioned');
    expect(kinds).toContain('observation.recorded');
    expect(kinds).toContain('knowledge.linked');
    // The about entry and the target entry have their OWN subjects, not the task.
    const about = result.entries.find((e) => e.role === 'about');
    expect(about?.subject).toBe(obs.id);
  });

  it('returns an empty history for an id no event touches (a valid answer, not a refusal)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runTimeline({ cwd: repo, env }, { id: 'never-minted-id' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toEqual([]);
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { repo, env } = setup(); // no init
    const result = runTimeline({ cwd: repo, env }, { id: 'anything' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('writes NOTHING — the sandbox is byte-identical before and after', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const task = runTask({ cwd: repo, env }, { title: 'x', scope: 'public' });
    if (!task.ok) throw new Error('setup');
    const before = digest(sandbox);
    runTimeline({ cwd: repo, env }, { id: task.id });
    runTimeline({ cwd: repo, env }, { id: 'ghost' });
    expect(digest(sandbox)).toBe(before);
  });
});
