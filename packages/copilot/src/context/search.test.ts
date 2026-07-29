import { rmSync } from 'node:fs';
import type { ProjectionCache, Scope } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthDecision,
  birthSkill,
  birthTask,
  capture,
  handoff,
  link,
  makeBench,
  observe,
  startRun,
} from '../../tests/support/chain.js';
import { readRecord, type ScopedCache, searchRecords } from './search.js';

let benches: Bench[] = [];
let caches: ProjectionCache[] = [];

afterEach(() => {
  for (const c of caches) c.close();
  for (const b of benches) rmSync(b.root, { recursive: true, force: true });
  caches = [];
  benches = [];
});

/** A bench whose cleanup this suite owns. */
function bench(): Bench {
  const b = makeBench();
  benches.push(b);
  return b;
}

/**
 * A tree, labelled with the scope it stands for. Each bench is its own sandbox
 * — its own chain root, which is what makes it a tree; the scope is only the
 * role it stands in, and two benches may stand in the same one.
 */
function tree(b: Bench, scope: Scope): ScopedCache {
  const cache = b.cache();
  caches.push(cache);
  return { scope, chainRoot: b.root, cache };
}

describe('searchRecords — the record across the trees', () => {
  it('marks every hit with the tree it came from', () => {
    const team = bench();
    const mine = bench();
    capture(team, 'm-team', 'the deploy checklist lives in the runbook');
    capture(mine, 'm-mine', 'my own note about the deploy');

    const found = searchRecords([tree(team, 'public'), tree(mine, 'global')], { term: 'deploy' });

    expect(found.hits.map((h) => [h.id, h.scope])).toEqual(
      expect.arrayContaining([
        ['m-team', 'public'],
        ['m-mine', 'global'],
      ]),
    );
    expect(found.total).toBe(2);
  });

  it('narrows to one tree when the query names a scope', () => {
    const team = bench();
    const mine = bench();
    capture(team, 'm-team', 'the deploy checklist');
    capture(mine, 'm-mine', 'my own deploy note');

    const sources = [tree(team, 'public'), tree(mine, 'global')];

    expect(
      searchRecords(sources, { term: 'deploy', scope: 'global' }).hits.map((h) => h.id),
    ).toEqual(['m-mine']);
    expect(searchRecords(sources, { term: 'deploy', scope: 'public' }).total).toBe(1);
  });

  it('orders the merge by the same rule one tree would have used', () => {
    const team = bench();
    const mine = bench();
    // A title match in one tree against a body mention in the other: the title
    // must win wherever it lives, or the answer would depend on the split.
    birthDecision(team, 'd-1', 'On caching');
    capture(mine, 'm-1', 'a passing mention of caching inside a long paragraph of prose');

    const forward = searchRecords([tree(team, 'public'), tree(mine, 'global')], {
      term: 'caching',
    });

    expect(forward.hits.map((h) => h.id)).toEqual(['d-1', 'm-1']);
  });

  it('lists the most recent across the trees when there is no term', () => {
    const team = bench();
    const mine = bench();
    // The benches stamp their own clocks, so the ids alone say which is newer.
    capture(team, 'm-old', 'first');
    capture(mine, 'm-new', 'second');
    const sources = [tree(team, 'public'), tree(mine, 'global')];

    const listed = searchRecords(sources, {});

    expect(listed.hits).toHaveLength(2);
    expect(listed.hits[0]?.at >= (listed.hits[1]?.at ?? '')).toBe(true);
  });

  it('cuts the merged list to the limit and still reports the true total', () => {
    const team = bench();
    const mine = bench();
    for (let i = 0; i < 5; i += 1) capture(team, `t-${i}`, 'a shared word');
    for (let i = 0; i < 5; i += 1) capture(mine, `g-${i}`, 'a shared word');

    const found = searchRecords([tree(team, 'public'), tree(mine, 'global')], {
      term: 'shared',
      limit: 3,
    });

    expect(found.hits).toHaveLength(3);
    // Not 3, and not 5: what the trees matched in all.
    expect(found.total).toBe(10);
  });

  it('serves an index, never a body — and never the relevance score', () => {
    const b = bench();
    birthSkill(b, 's-1', 'Small PRs', 'adopted');
    capture(b, 'm-1', 'a memory whose whole content is this sentence and no more');

    const found = searchRecords([tree(b, 'public')], { term: 'sentence' });

    expect(found.hits).toEqual([
      {
        id: 'm-1',
        kind: 'memory',
        scope: 'public',
        at: expect.any(String),
        title: 'a memory whose whole content is this sentence and no more',
        derived: true,
      },
    ]);
    // The skill's body is in the index; asking for a word from it must not
    // return the body itself.
    const bodies = searchRecords([tree(b, 'public')], { term: 'body' });
    expect(JSON.stringify(bodies)).not.toContain('body of Small PRs');
  });

  it('returns the same bytes for the same query', () => {
    const team = bench();
    const mine = bench();
    capture(team, 'm-1', 'a shared word');
    capture(mine, 'm-2', 'a shared word');
    const sources = [tree(team, 'public'), tree(mine, 'global')];

    expect(JSON.stringify(searchRecords(sources, { term: 'shared' }))).toBe(
      JSON.stringify(searchRecords(sources, { term: 'shared' })),
    );
  });

  it('answers a term nothing matches with an empty index, not an error', () => {
    const b = bench();
    capture(b, 'm-1', 'a thing');

    expect(searchRecords([tree(b, 'public')], { term: 'zebra' })).toEqual({ hits: [], total: 0 });
  });

  it('answers with nothing when there are no trees to search', () => {
    expect(searchRecords([], { term: 'anything' })).toEqual({ hits: [], total: 0 });
  });
});

describe('readRecord — one whole record by id', () => {
  it('reads each indexed kind back whole, with the tree it lives in', () => {
    const b = bench();
    capture(b, 'm-1', 'the content in full');
    birthTask(b, 't-1', 'a task');
    birthDecision(b, 'd-1', 'a decision');
    birthSkill(b, 's-1', 'a skill', 'adopted');
    observe(b, 'o-1', 't-1', 'the observation text');
    const sources = [tree(b, 'public')];

    expect(readRecord(sources, 'm-1')).toEqual({
      kind: 'memory',
      id: 'm-1',
      scope: 'public',
      record: expect.objectContaining({ content: 'the content in full' }),
    });
    expect(readRecord(sources, 't-1')?.kind).toBe('task');
    expect(readRecord(sources, 'd-1')?.kind).toBe('decision');
    expect(readRecord(sources, 's-1')?.kind).toBe('skill');
    expect(readRecord(sources, 'o-1')?.kind).toBe('observation');
  });

  it('finds the record in whichever tree holds it', () => {
    const team = bench();
    const mine = bench();
    birthDecision(team, 'd-1', 'the team decision');
    capture(mine, 'm-1', 'my own note');
    const sources = [tree(team, 'public'), tree(mine, 'global')];

    expect(readRecord(sources, 'd-1')?.scope).toBe('public');
    expect(readRecord(sources, 'm-1')?.scope).toBe('global');
  });

  it('serves the body the index only pointed at', () => {
    const b = bench();
    capture(b, 'm-1', `the long content ${'x '.repeat(200)}end`);
    const sources = [tree(b, 'public')];

    const hit = searchRecords(sources, { term: 'long' }).hits[0];
    const body = readRecord(sources, hit?.id ?? '');

    // The index line was cut; the record read by id is not.
    expect(hit?.title.length).toBeLessThan(200);
    expect(body?.kind === 'memory' && body.record.content.endsWith('end')).toBe(true);
  });

  it('is null for an id nothing here holds', () => {
    const b = bench();
    capture(b, 'm-1', 'a thing');

    expect(readRecord([tree(b, 'public')], 'nope')).toBeNull();
  });

  it('is null for a run, a handoff or a link — they are not records to read', () => {
    const b = bench();
    birthTask(b, 't-1', 'a task');
    startRun(b, 'r-1', { agent: 'claude', goal: 'ship' });
    handoff(b, 't-1', 'claude', 'felipe');
    link(b, 't-1', 'd-1', 'informs');
    const sources = [tree(b, 'public')];

    expect(readRecord(sources, 'r-1')).toBeNull();
    // The handoff and the link are ON the task, so the task itself still reads —
    // what has no record of its own is the fact, not its subject.
    expect(readRecord(sources, 't-1')?.kind).toBe('task');
  });
});
