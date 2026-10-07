/**
 * `samePattern`: which rules of the record are, word for word, the same rule in more than
 * one project — and the ONE function the listing and the write both ask.
 *
 * Every case goes through the bench that writes a real, signed chain. The two things this
 * reading must never do are held here by name: it never counts an instance that is not in
 * force, and it never counts a tree that does not travel with the repository.
 */

import { describe, expect, it } from 'vitest';
import {
  type Bench,
  birthDecision,
  birthSkill,
  makeBench,
  moveDecision,
  moveSkill,
} from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { judgePromotion, samePattern } from './promotion.js';

function tree(
  b: Bench,
  project: string | undefined,
  scope: ScopedCache['scope'] = 'public',
): ScopedCache {
  return {
    scope,
    chainRoot: b.root,
    cache: b.cache(),
    ...(project !== undefined ? { project } : {}),
  };
}

function adopted(b: Bench, id: string, name: string, body?: string): void {
  birthSkill(b, id, name, 'proposed', undefined, body);
  moveSkill(b, id, 'proposed', 'reviewed', 'review');
  moveSkill(b, id, 'reviewed', 'adopted', 'adopt');
}

const SAME = 'Run the suite before every push.';

describe('samePattern — the same rule, in force, in the committed trees of two projects', () => {
  it('names a skill whose name and body are equal in two projects, with where it is', () => {
    const a = makeBench();
    const c = makeBench();
    adopted(a, 'sk-a', 'Small PRs', SAME);
    adopted(c, 'sk-c', 'Small PRs', SAME);

    const found = samePattern([tree(a, '/work/a'), tree(c, '/work/c')]);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('skill');
    expect(found[0]?.title).toBe('Small PRs');
    expect(found[0]?.instances).toEqual([
      { project: '/work/a', id: 'sk-a' },
      { project: '/work/c', id: 'sk-c' },
    ]);
  });

  it('the same title over a different body is a name, not a practice', () => {
    const a = makeBench();
    const c = makeBench();
    adopted(a, 'sk-a', 'Testing', 'Test first.');
    adopted(c, 'sk-c', 'Testing', 'Never test; ship.');
    expect(samePattern([tree(a, '/work/a'), tree(c, '/work/c')])).toEqual([]);
  });

  it('one project is not recurrence', () => {
    const a = makeBench();
    adopted(a, 'sk-1', 'Small PRs', SAME);
    adopted(a, 'sk-2', 'Small PRs', SAME);
    expect(samePattern([tree(a, '/work/a')])).toEqual([]);
  });

  it('an instance that is only proposed does not count', () => {
    const a = makeBench();
    const c = makeBench();
    adopted(a, 'sk-a', 'Small PRs', SAME);
    birthSkill(c, 'sk-c', 'Small PRs', 'proposed', undefined, SAME);
    expect(samePattern([tree(a, '/work/a'), tree(c, '/work/c')])).toEqual([]);
  });

  it('an instance in a PRIVATE tree does not count, and is not named', () => {
    const a = makeBench();
    const c = makeBench();
    adopted(a, 'sk-private', 'Small PRs', SAME);
    adopted(c, 'sk-c', 'Small PRs', SAME);
    expect(samePattern([tree(a, '/work/a', 'private'), tree(c, '/work/c')])).toEqual([]);
  });

  it('compares after NFC, trim and collapsed spaces, and not after that', () => {
    const a = makeBench();
    const c = makeBench();
    const e = makeBench();
    adopted(a, 'sk-a', 'Café rule', 'Keep   it\n small. ');
    adopted(c, 'sk-c', ' Café rule', 'Keep it small.');
    adopted(e, 'sk-e', 'café rule', 'Keep it small.');
    const found = samePattern([tree(a, '/work/a'), tree(c, '/work/c'), tree(e, '/work/e')]);
    expect(found).toHaveLength(1);
    expect(found[0]?.instances.map((i) => i.id)).toEqual(['sk-a', 'sk-c']);
  });

  it('is not offered again once the machine-global tree holds the same content', () => {
    const a = makeBench();
    const c = makeBench();
    const g = makeBench();
    adopted(a, 'sk-a', 'Small PRs', SAME);
    adopted(c, 'sk-c', 'Small PRs', SAME);
    birthSkill(g, 'sk-g', 'Small PRs', 'proposed', undefined, SAME);
    const sources = [tree(a, '/work/a'), tree(c, '/work/c'), tree(g, undefined, 'global')];
    expect(samePattern(sources)).toEqual([]);
  });

  it('a decision is the same one when its title and rationale are, and it is accepted', () => {
    const a = makeBench();
    const c = makeBench();
    for (const [b, id] of [
      [a, 'd-a'],
      [c, 'd-c'],
    ] as const) {
      birthDecision(b, id, 'Use pnpm', 'proposed', undefined, 'One lockfile.');
      moveDecision(b, id, 'proposed', 'accepted', 'accept');
    }
    const found = samePattern([tree(a, '/work/a'), tree(c, '/work/c')]);
    expect(found.map((f) => f.kind)).toEqual(['decision']);
    expect(found[0]?.body).toBe('One lockfile.');
  });
});

describe('judgePromotion — the same reading, asked about the ids a person cites', () => {
  const BOTH = [
    { project: '/work/a', id: 'sk-a' },
    { project: '/work/c', id: 'sk-c' },
  ];

  function two() {
    const a = makeBench();
    const c = makeBench();
    adopted(a, 'sk-a', 'Small PRs', SAME);
    adopted(c, 'sk-c', 'Small PRs', SAME);
    return { a, c };
  }

  it('accepts exactly what samePattern lists', () => {
    const { a, c } = two();
    const sources = [tree(a, '/work/a'), tree(c, '/work/c')];
    expect(samePattern(sources)).toHaveLength(1);
    expect(judgePromotion(sources, BOTH).ok).toBe(true);
  });

  it('refuses a single project, an unknown id and a different content, each by name', () => {
    const { a, c } = two();
    adopted(a, 'sk-other', 'Small PRs', 'Something else entirely.');
    const sources = [tree(a, '/work/a'), tree(c, '/work/c')];
    const reason = (cited: { project: string; id: string }[]) => {
      const judged = judgePromotion(sources, cited);
      return judged.ok ? 'ok' : judged.reason;
    };
    expect(reason([{ project: '/work/a', id: 'sk-a' }])).toBe('ONE_PROJECT');
    expect(
      reason([
        { project: '/work/a', id: 'sk-a' },
        { project: '/work/c', id: 'nope' },
      ]),
    ).toBe('UNKNOWN_INSTANCE');
    expect(
      reason([
        { project: '/work/a', id: 'sk-other' },
        { project: '/work/c', id: 'sk-c' },
      ]),
    ).toBe('NOT_THE_SAME');
  });

  it('refuses what the global tree already holds', () => {
    const { a, c } = two();
    const g = makeBench();
    birthSkill(g, 'sk-g', 'Small PRs', 'proposed', undefined, SAME);
    const judged = judgePromotion(
      [tree(a, '/work/a'), tree(c, '/work/c'), tree(g, undefined, 'global')],
      BOTH,
    );
    expect(judged.ok ? 'ok' : judged.reason).toBe('ALREADY_GLOBAL');
  });
});
