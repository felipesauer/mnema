import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from './decision.js';
import { runInit } from './init.js';
import { runMemory } from './memory.js';
import { runObserve } from './observe.js';
import { runSearch } from './search.js';
import { runShow } from './show.js';
import { runSkill } from './skill.js';
import { runTask } from './task.js';
import { runTaskTransition } from './task-transition.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-search-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** A content digest of every file under `dir` — proof a read wrote nothing. */
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

/** Captures a memory in a scope, returning its id (throws if the write refused). */
function capture(ctx: { cwd: string; env: DiscoveryEnv }, content: string, scope: string): string {
  const result = runMemory(ctx, { content, scope: scope as never });
  if (!result.ok) throw new Error(`setup: memory refused (${result.code})`);
  return result.id;
}

describe('mnema search (finding what was recorded)', () => {
  it('finds the same term in two trees and says which tree each came from', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const team = capture({ cwd: repo, env }, 'the deploy runbook lives in the wiki', 'public');
    const mine = capture({ cwd: repo, env }, 'my own note about the deploy', 'global');

    const found = runSearch({ cwd: repo, env }, { term: 'deploy' });
    if (!found.ok) throw new Error('search refused');

    expect(found.result.total).toBe(2);
    const byId = new Map(found.result.hits.map((hit) => [hit.id, hit.scope]));
    expect(byId.get(team)).toBe('public');
    expect(byId.get(mine)).toBe('global');
  });

  it('finds every indexed kind by the words a person wrote', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const ctx = { cwd: repo, env };
    capture(ctx, 'a memory about pineapple', 'public');
    const task = runTask(ctx, { title: 'buy pineapple', scope: 'public' });
    const decision = runDecision(ctx, {
      title: 'On pineapple',
      rationale: 'it ripened',
      scope: 'public',
    });
    const skill = runSkill(ctx, {
      name: 'pineapple pattern',
      body: 'how we do it',
      scope: 'public',
    });
    if (!task.ok || !decision.ok || !skill.ok) throw new Error('setup refused');
    const observation = runObserve(ctx, {
      about: task.id,
      topic: 'fruit',
      text: 'the pineapple again',
      scope: 'public',
    });
    if (!observation.ok) throw new Error('setup refused');

    const found = runSearch(ctx, { term: 'pineapple' });
    if (!found.ok) throw new Error('search refused');

    expect(found.result.hits.map((hit) => hit.kind).sort()).toEqual([
      'decision',
      'memory',
      'observation',
      'skill',
      'task',
    ]);
  });

  it('lists the most recent records when there is no term', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const ctx = { cwd: repo, env };
    capture(ctx, 'the older note', 'public');
    const newer = capture(ctx, 'the newer note', 'public');

    const listed = runSearch(ctx, {});
    if (!listed.ok) throw new Error('search refused');

    expect(listed.result.hits[0]?.id).toBe(newer);
    expect(listed.result.total).toBe(2);
  });

  it('serves an index line, never the body', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const ctx = { cwd: repo, env };
    const long = `the beginning of it ${'filler '.repeat(80)} the end of it`;
    capture(ctx, long, 'public');

    const found = runSearch(ctx, { term: 'beginning' });
    if (!found.ok) throw new Error('search refused');

    const [hit] = found.result.hits;
    expect(hit?.derived).toBe(true);
    expect(JSON.stringify(found.result)).not.toContain('the end of it');
  });

  it('narrows by kind, state, scope and a time window', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const ctx = { cwd: repo, env };
    capture(ctx, 'a shared word in a memory', 'public');
    const task = runTask(ctx, { title: 'a shared word in a task', scope: 'public' });
    if (!task.ok) throw new Error('setup refused');

    const byKind = runSearch(ctx, { term: 'shared', kind: 'task' });
    if (!byKind.ok) throw new Error('search refused');
    expect(byKind.result.hits.map((h) => h.id)).toEqual([task.id]);

    // A task is born in DRAFT; a memory has no state at all, so a state filter
    // can never include one.
    const byState = runSearch(ctx, { state: 'DRAFT' });
    if (!byState.ok) throw new Error('search refused');
    expect(byState.result.hits.map((h) => h.id)).toEqual([task.id]);

    const byScope = runSearch(ctx, { term: 'shared', scope: 'global' });
    if (!byScope.ok) throw new Error('search refused');
    expect(byScope.result.hits).toEqual([]);

    const future = runSearch(ctx, { from: '2999-01-01T00:00:00.000Z' });
    if (!future.ok) throw new Error('search refused');
    expect(future.result.hits).toEqual([]);
  });

  it('reports the state the entity is in NOW, not the one it was born in', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const ctx = { cwd: repo, env };
    const task = runTask(ctx, { title: 'a moving task', scope: 'public' });
    if (!task.ok) throw new Error('setup refused');
    const moved = runTaskTransition(ctx, { id: task.id, action: 'submit' });
    if (!moved.ok) throw new Error('setup: submit refused');

    const found = runSearch(ctx, { term: 'moving' });
    if (!found.ok) throw new Error('search refused');
    expect(found.result.hits[0]?.state).toBe(moved.to);
  });

  it('refuses a kind that is not a kind, rather than matching nothing', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const refused = runSearch({ cwd: repo, env }, { kind: 'memories' as never });

    expect(refused).toEqual({ ok: false, reason: 'UNKNOWN_KIND', kind: 'memories' });
  });

  it('refuses a scope whose tree is not here', () => {
    const { repo, env } = setup();
    // No init: outside a project only the global tree exists.
    const refused = runSearch({ cwd: repo, env }, { term: 'anything', scope: 'public' });

    expect(refused).toEqual({ ok: false, reason: 'SCOPE_UNAVAILABLE', scope: 'public' });
  });

  it('searches the global tree outside a project instead of refusing', () => {
    const { env } = setup();
    const outside = join(sandbox, 'elsewhere');
    mkdirSync(outside, { recursive: true });
    // A memory captured with no project at all lands in the global tree.
    capture({ cwd: outside, env }, 'a personal note with no project', 'global');

    const found = runSearch({ cwd: outside, env }, { term: 'personal' });
    if (!found.ok) throw new Error('search refused');

    expect(found.result.hits.map((h) => h.scope)).toEqual(['global']);
  });

  it('answers a term nothing matches with an empty index, not a failure', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    capture({ cwd: repo, env }, 'a thing', 'public');

    const found = runSearch({ cwd: repo, env }, { term: 'zebra' });

    expect(found).toEqual({ ok: true, result: { hits: [], total: 0 } });
  });

  it('writes nothing — not an event, not a byte', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    capture({ cwd: repo, env }, 'a thing worth finding', 'public');

    const before = digest(sandbox);
    runSearch({ cwd: repo, env }, { term: 'thing' });
    runSearch({ cwd: repo, env }, {});
    runSearch({ cwd: repo, env }, { term: 'nothing here' });

    expect(digest(sandbox)).toBe(before);
  });
});

describe('mnema show (one whole record)', () => {
  it('serves the body the index only pointed at', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const content = `the beginning ${'filler '.repeat(80)} the very end`;
    const id = capture({ cwd: repo, env }, content, 'public');

    const shown = runShow({ cwd: repo, env }, { id });
    if (!shown.ok) throw new Error('show refused');

    expect(shown.record.kind).toBe('memory');
    expect(shown.record.scope).toBe('public');
    expect(shown.record.kind === 'memory' && shown.record.record.content).toBe(content);
  });

  it('finds the record in whichever tree holds it', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const global = capture({ cwd: repo, env }, 'a personal note', 'global');
    const priv = capture({ cwd: repo, env }, 'a machine note', 'private');

    expect(runShow({ cwd: repo, env }, { id: global }).ok).toBe(true);
    expect(
      (runShow({ cwd: repo, env }, { id: priv }) as { record: { scope: string } }).record.scope,
    ).toBe('private');
  });

  it('serves a skill body — the person on this surface is curating patterns', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const skill = runSkill(
      { cwd: repo, env },
      { name: 'One slice per PR', body: 'the pattern itself', scope: 'public' },
    );
    if (!skill.ok) throw new Error('setup refused');

    const shown = runShow({ cwd: repo, env }, { id: skill.id });
    if (!shown.ok) throw new Error('show refused');

    // A skill fresh out of `mnema skill` is PROPOSED, not adopted — and the
    // curator reading it to review it must see the text they are judging.
    expect(shown.record.kind === 'skill' && shown.record.record.body).toBe('the pattern itself');
    expect(shown.record.kind === 'skill' && shown.record.record.state).toBe('proposed');
  });

  it('refuses an id nothing here holds', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    expect(runShow({ cwd: repo, env }, { id: 'no-such-id' })).toEqual({
      ok: false,
      reason: 'UNKNOWN_RECORD',
    });
  });

  it('writes nothing — not an event, not a byte', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const id = capture({ cwd: repo, env }, 'a thing', 'public');

    const before = digest(sandbox);
    runShow({ cwd: repo, env }, { id });
    runShow({ cwd: repo, env }, { id: 'missing' });

    expect(digest(sandbox)).toBe(before);
  });
});
