import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, birthSkill, deprecateSkill, makeBench } from '../../tests/support/chain.js';
import { adoptedSkills, lookupAdoptedSkill } from './skills.js';

describe('adoptedSkills — the patterns an agent may work by', () => {
  let benches: Bench[] = [];
  afterEach(() => {
    for (const b of benches) rmSync(b.root, { recursive: true, force: true });
    benches = [];
  });

  /** A bench whose cleanup this suite owns. */
  function bench(): Bench {
    const b = makeBench();
    benches.push(b);
    return b;
  }

  it('serves an adopted skill WITH its body', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Small PRs', 'adopted');
    const cache = b.cache();
    try {
      expect(adoptedSkills([cache])).toEqual([
        { id: 'sk-1', name: 'Small PRs', body: 'body of Small PRs' },
      ]);
    } finally {
      cache.close();
    }
  });

  it('serves ONLY the adopted: proposed, reviewed, rejected and deprecated are absent', () => {
    const b = bench();
    birthSkill(b, 'sk-adopted', 'Adopted', 'adopted');
    birthSkill(b, 'sk-proposed', 'Proposed', 'proposed');
    birthSkill(b, 'sk-reviewed', 'Reviewed', 'reviewed');
    birthSkill(b, 'sk-rejected', 'Rejected', 'rejected');
    birthSkill(b, 'sk-deprecated', 'Deprecated', 'deprecated');
    const cache = b.cache();
    try {
      expect(adoptedSkills([cache]).map((s) => s.id)).toEqual(['sk-adopted']);
    } finally {
      cache.close();
    }
  });

  it('a skill deprecated AFTER adoption stops being served', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Retired', 'adopted');
    const before = b.cache();
    try {
      expect(adoptedSkills([before]).map((s) => s.id)).toEqual(['sk-1']);
    } finally {
      before.close();
    }
    // The same skill, moved out of adoption: the body must stop coming back.
    deprecateSkill(b, 'sk-1');
    const after = b.cache();
    try {
      expect(adoptedSkills([after])).toEqual([]);
      expect(lookupAdoptedSkill([after], 'sk-1')).toEqual({
        outcome: 'not-adopted',
        state: 'deprecated',
      });
    } finally {
      after.close();
    }
  });

  it('gathers across every cache it is given (a capability is not scoped to a tree)', () => {
    const team = bench();
    const mine = bench();
    birthSkill(team, 'sk-team', 'Team pattern', 'adopted');
    birthSkill(mine, 'sk-mine', 'My pattern', 'adopted');
    const a = team.cache();
    const c = mine.cache();
    try {
      expect(
        adoptedSkills([a, c])
          .map((s) => s.id)
          .sort(),
      ).toEqual(['sk-mine', 'sk-team']);
      // And a lookup finds one that lives in a tree that is not the first.
      expect(lookupAdoptedSkill([a, c], 'sk-mine')).toMatchObject({ outcome: 'adopted' });
    } finally {
      a.close();
      c.close();
    }
  });

  it('orders by NAME, so the order does not depend on which tree is read first', () => {
    const one = bench();
    const two = bench();
    birthSkill(one, 'sk-z', 'Zebra', 'adopted');
    birthSkill(two, 'sk-a', 'Alpha', 'adopted');
    const a = one.cache();
    const b = two.cache();
    try {
      const forwards = adoptedSkills([a, b]).map((s) => s.name);
      const backwards = adoptedSkills([b, a]).map((s) => s.name);
      expect(forwards).toEqual(['Alpha', 'Zebra']);
      // The stable-output rule: same content, same bytes, whatever the caller does.
      expect(backwards).toEqual(forwards);
    } finally {
      a.close();
      b.close();
    }
  });

  it('is empty — never an error — when nothing has been adopted', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Only proposed', 'proposed');
    const cache = b.cache();
    try {
      expect(adoptedSkills([cache])).toEqual([]);
      expect(adoptedSkills([])).toEqual([]);
    } finally {
      cache.close();
    }
  });
});

describe('lookupAdoptedSkill — asking for one pattern by id', () => {
  let benches: Bench[] = [];
  afterEach(() => {
    for (const b of benches) rmSync(b.root, { recursive: true, force: true });
    benches = [];
  });

  function bench(): Bench {
    const b = makeBench();
    benches.push(b);
    return b;
  }

  it('serves the body of an adopted skill', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Small PRs', 'adopted');
    const cache = b.cache();
    try {
      expect(lookupAdoptedSkill([cache], 'sk-1')).toEqual({
        outcome: 'adopted',
        skill: { id: 'sk-1', name: 'Small PRs', body: 'body of Small PRs' },
      });
    } finally {
      cache.close();
    }
  });

  it('reports the STATE of a skill that is not adopted, and never its body', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Not yet', 'proposed');
    const cache = b.cache();
    try {
      const found = lookupAdoptedSkill([cache], 'sk-1');
      expect(found).toEqual({ outcome: 'not-adopted', state: 'proposed' });
      expect(JSON.stringify(found)).not.toContain('body of');
    } finally {
      cache.close();
    }
  });

  it('separates "no such skill" from "not adopted"', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Adopted', 'adopted');
    const cache = b.cache();
    try {
      expect(lookupAdoptedSkill([cache], 'sk-nowhere')).toEqual({ outcome: 'unknown' });
    } finally {
      cache.close();
    }
  });
});
