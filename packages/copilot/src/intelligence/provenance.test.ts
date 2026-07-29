import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, birthSkill, makeBench, moveSkill } from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { patternProvenance } from './provenance.js';

describe('patternProvenance — where a pattern came from', () => {
  let benches: Bench[] = [];
  let open: ScopedCache[] = [];
  afterEach(() => {
    for (const source of open) source.cache.close();
    for (const b of benches) rmSync(b.root, { recursive: true, force: true });
    open = [];
    benches = [];
  });

  /** A bench whose cleanup this suite owns. */
  function bench(): Bench {
    const b = makeBench();
    benches.push(b);
    return b;
  }

  /** A scoped cache over `b`, closed on teardown. */
  function source(b: Bench, scope: ScopedCache['scope'] = 'public'): ScopedCache {
    const s: ScopedCache = { scope, chainRoot: b.root, cache: b.cache() };
    open.push(s);
    return s;
  }

  /** Proposes, reviews and adopts one skill, each act by the named agent. */
  function adoptedBy(
    b: Bench,
    id: string,
    name: string,
    proposer?: string,
    adopter?: string,
  ): string {
    birthSkill(b, id, name, 'proposed', proposer);
    moveSkill(b, id, 'proposed', 'reviewed', 'review', adopter);
    moveSkill(b, id, 'reviewed', 'adopted', 'adopt', adopter);
    return id;
  }

  it('reports both ends and marks the two as ONE agent', () => {
    const b = bench();
    adoptedBy(b, 'sk-1', 'Small PRs', 'agent-A', 'agent-A');

    expect(patternProvenance([source(b)])).toEqual([
      {
        id: 'sk-1',
        name: 'Small PRs',
        state: 'adopted',
        scope: 'public',
        proposedBy: 'agent-A',
        adoption: { at: expect.any(String), by: 'agent-A' },
        selfAdopted: true,
      },
    ]);
  });

  it('distinguishes one agent proposing and ANOTHER adopting', () => {
    const b = bench();
    adoptedBy(b, 'sk-1', 'Small PRs', 'agent-A', 'agent-B');

    const [entry] = patternProvenance([source(b)]);
    expect(entry?.proposedBy).toBe('agent-A');
    expect(entry?.adoption?.by).toBe('agent-B');
    expect(entry?.selfAdopted).toBe(false);
  });

  it('shows a person as an absence, and never calls two absences the same actor', () => {
    const b = bench();
    adoptedBy(b, 'sk-1', 'By hand');

    const [entry] = patternProvenance([source(b)]);
    expect(entry).not.toHaveProperty('proposedBy');
    expect(entry?.adoption).toEqual({ at: expect.any(String) });
    // Two absences prove nothing about one actor: a tree can hold more than one
    // person's facts, so `selfAdopted` stays false.
    expect(entry?.selfAdopted).toBe(false);
  });

  it('reports a pattern nobody adopted, with no adoption at all', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Only proposed', 'proposed', 'agent-A');

    const [entry] = patternProvenance([source(b)]);
    expect(entry?.state).toBe('proposed');
    expect(entry).not.toHaveProperty('adoption');
    expect(entry?.selfAdopted).toBe(false);
  });

  it('covers every state — the curation backlog is part of the provenance', () => {
    const b = bench();
    birthSkill(b, 'sk-p', 'Proposed', 'proposed');
    birthSkill(b, 'sk-r', 'Rejected', 'rejected');
    birthSkill(b, 'sk-d', 'Deprecated', 'deprecated');
    adoptedBy(b, 'sk-a', 'Adopted', 'agent-A', 'agent-A');

    expect(patternProvenance([source(b)]).map((p) => [p.name, p.state])).toEqual([
      ['Adopted', 'adopted'],
      ['Deprecated', 'deprecated'],
      ['Proposed', 'proposed'],
      ['Rejected', 'rejected'],
    ]);
  });

  it('keeps the adoption of a pattern later deprecated — it WAS live, and by whom', () => {
    const b = bench();
    adoptedBy(b, 'sk-1', 'Retired', 'agent-A', 'agent-A');
    moveSkill(b, 'sk-1', 'adopted', 'deprecated', 'deprecate');

    const [entry] = patternProvenance([source(b)]);
    expect(entry?.state).toBe('deprecated');
    expect(entry?.adoption?.by).toBe('agent-A');
    expect(entry?.selfAdopted).toBe(true);
  });

  it('carries the tree each pattern lives in, and orders by NAME across them', () => {
    const team = bench();
    const mine = bench();
    adoptedBy(team, 'sk-team', 'Zebra', 'agent-A', 'agent-A');
    adoptedBy(mine, 'sk-mine', 'Alpha', 'agent-A', 'agent-A');
    const a = source(team, 'public');
    const b = source(mine, 'private');

    const forwards = patternProvenance([a, b]);
    const backwards = patternProvenance([b, a]);
    expect(forwards.map((p) => [p.name, p.scope])).toEqual([
      ['Alpha', 'private'],
      ['Zebra', 'public'],
    ]);
    // The stable-output rule: the order is the content's, not the caller's.
    expect(backwards).toEqual(forwards);
  });

  it('is empty — never an error — when the record holds no pattern', () => {
    const b = bench();
    expect(patternProvenance([source(b)])).toEqual([]);
    expect(patternProvenance([])).toEqual([]);
  });

  it('never carries a body: this read is about provenance, not the pattern', () => {
    const b = bench();
    adoptedBy(b, 'sk-1', 'Small PRs', 'agent-A', 'agent-A');

    expect(JSON.stringify(patternProvenance([source(b)]))).not.toContain('body of');
  });
});
