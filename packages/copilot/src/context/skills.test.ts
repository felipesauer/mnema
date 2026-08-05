import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthSkill,
  deprecateSkill,
  makeBench,
  moveSkill,
} from '../../tests/support/chain.js';
import { adoptedSkills, lookupAdoptedSkill, skillsAwaitingJudgement } from './skills.js';

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

describe('adoptedSkills — the body comes with the agent that adopted it', () => {
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

  it('names the agent that adopted the pattern', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Small PRs', 'proposed', 'agent-A');
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review', 'agent-A');
    moveSkill(b, 'sk-1', 'reviewed', 'adopted', 'adopt', 'agent-A');
    const cache = b.cache();
    try {
      expect(adoptedSkills([cache])).toEqual([
        { id: 'sk-1', name: 'Small PRs', body: 'body of Small PRs', adoptedBy: 'agent-A' },
      ]);
    } finally {
      cache.close();
    }
  });

  it('carries NO agent when a person adopted it — nothing is invented', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Small PRs', 'proposed', 'agent-A');
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review');
    moveSkill(b, 'sk-1', 'reviewed', 'adopted', 'adopt');
    const cache = b.cache();
    try {
      const [served] = adoptedSkills([cache]);
      expect(served).not.toHaveProperty('adoptedBy');
      // And who PROPOSED it does not travel with the body — that is the audit's.
      expect(served).not.toHaveProperty('proposedBy');
    } finally {
      cache.close();
    }
  });

  it('reports the ADOPTER, not the proposer, when they are different agents', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Small PRs', 'proposed', 'agent-A');
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review', 'agent-A');
    moveSkill(b, 'sk-1', 'reviewed', 'adopted', 'adopt', 'agent-B');
    const cache = b.cache();
    try {
      expect(adoptedSkills([cache])[0]?.adoptedBy).toBe('agent-B');
      expect(lookupAdoptedSkill([cache], 'sk-1')).toMatchObject({
        outcome: 'adopted',
        skill: { adoptedBy: 'agent-B' },
      });
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

/**
 * Every fixture in this suite reaches its state through the move the workflow
 * defines, from the state a skill is actually born in (`proposed`,
 * `INITIAL_SKILL_STATE`). The suites above ask a birth for its state directly,
 * which is harmless where the case is about ids or bodies; it would not be here,
 * because a skill born straight into `reviewed` is indistinguishable from one a
 * reviewer moved there, and this list is ABOUT which move is still owed.
 */
describe('skillsAwaitingJudgement — the patterns somebody still owes a ruling on', () => {
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

  /** Births a pattern and takes it all the way to adopted, by its own moves. */
  function adopt(b: Bench, id: string, name: string): string {
    birthSkill(b, id, name);
    moveSkill(b, id, 'proposed', 'reviewed', 'review');
    moveSkill(b, id, 'reviewed', 'adopted', 'adopt');
    return id;
  }

  it('serves BOTH waiting states, each saying which ruling is missing', () => {
    // The reason the state travels with the item: a proposal waits for someone to
    // look, a reviewed pattern waits for the adoption call. Without the state the
    // two are the same line and the reader cannot tell which move to ask for.
    const b = bench();
    birthSkill(b, 'sk-new', 'Nobody has looked');
    birthSkill(b, 'sk-seen', 'Looked at, not adopted');
    moveSkill(b, 'sk-seen', 'proposed', 'reviewed', 'review');
    const cache = b.cache();
    try {
      expect(
        skillsAwaitingJudgement([cache])
          .map((s) => ({ id: s.id, state: s.state }))
          .sort((x, y) => (x.id < y.id ? -1 : 1)),
      ).toEqual([
        { id: 'sk-new', state: 'proposed' },
        { id: 'sk-seen', state: 'reviewed' },
      ]);
    } finally {
      cache.close();
    }
  });

  it('an ADOPTED pattern is not awaiting anything, though `deprecate` is legal from it forever', () => {
    // THE TEST THAT PROVES THE CRITERION DID NOT HITCH A RIDE, on this machine.
    // `SKILL_TRANSITIONS` carries `{from: 'adopted', action: 'deprecate'}` with
    // nothing to ever make it happen, so the work list's rule ("has a legal move")
    // would keep every adopted pattern on a pendency list for good.
    const b = bench();
    adopt(b, 'sk-live', 'A live pattern');
    const cache = b.cache();
    try {
      expect(skillsAwaitingJudgement([cache])).toEqual([]);
      // And the same record IS served by the other list, so the absence above is
      // the criterion and not an empty projection.
      expect(adoptedSkills([cache]).map((s) => s.id)).toEqual(['sk-live']);
    } finally {
      cache.close();
    }
  });

  it('serves ONLY proposed and reviewed — adopted, rejected and deprecated are absent', () => {
    // All five states of the machine, each reached by its own move, and both halves
    // of the criterion in one assertion.
    const b = bench();
    birthSkill(b, 'sk-proposed', 'On the table');
    birthSkill(b, 'sk-reviewed', 'Looked at');
    moveSkill(b, 'sk-reviewed', 'proposed', 'reviewed', 'review');
    adopt(b, 'sk-adopted', 'In use');
    birthSkill(b, 'sk-rejected', 'Turned down');
    moveSkill(b, 'sk-rejected', 'proposed', 'rejected', 'reject');
    adopt(b, 'sk-deprecated', 'Retired');
    deprecateSkill(b, 'sk-deprecated');
    const cache = b.cache();
    try {
      expect(
        skillsAwaitingJudgement([cache])
          .map((s) => s.id)
          .sort(),
      ).toEqual(['sk-proposed', 'sk-reviewed']);
    } finally {
      cache.close();
    }
  });

  it('a pattern that gets adopted LEAVES the list — the waiting clears', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'On the table');
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review');
    const before = b.cache();
    try {
      expect(skillsAwaitingJudgement([before]).map((s) => s.state)).toEqual(['reviewed']);
    } finally {
      before.close();
    }
    moveSkill(b, 'sk-1', 'reviewed', 'adopted', 'adopt');
    const after = b.cache();
    try {
      expect(skillsAwaitingJudgement([after])).toEqual([]);
    } finally {
      after.close();
    }
  });

  it('never carries the BODY — a pattern under review is not one to work by', () => {
    // The distinction that keeps this list from contradicting the one above it: a
    // name invites a ruling, a body is an instruction to work by the pattern. Nor
    // the provenance of an adoption that has not happened.
    const b = bench();
    birthSkill(b, 'sk-1', 'Not yet a pattern', 'proposed', 'agent-A');
    const cache = b.cache();
    try {
      const [served] = skillsAwaitingJudgement([cache]);
      if (served === undefined) throw new Error('the pending pattern is missing');
      expect(Object.keys(served).sort()).toEqual(['id', 'kind', 'name', 'state', 'updatedAt']);
      expect(JSON.stringify(served)).not.toContain('body of Not yet a pattern');
      expect(served).not.toHaveProperty('adoptedBy');
    } finally {
      cache.close();
    }
  });

  it('gathers across every cache it is given (a pending pattern waits wherever it lives)', () => {
    const team = bench();
    const mine = bench();
    birthSkill(team, 'sk-team', 'The team has not ruled');
    birthSkill(mine, 'sk-mine', 'This machine has not ruled');
    const a = team.cache();
    const c = mine.cache();
    try {
      expect(
        skillsAwaitingJudgement([a, c])
          .map((s) => s.id)
          .sort(),
      ).toEqual(['sk-mine', 'sk-team']);
    } finally {
      a.close();
      c.close();
    }
  });

  it('is empty — never an error — when every pattern has been ruled on', () => {
    const b = bench();
    adopt(b, 'sk-1', 'Settled');
    const cache = b.cache();
    try {
      expect(skillsAwaitingJudgement([cache])).toEqual([]);
      expect(skillsAwaitingJudgement([])).toEqual([]);
    } finally {
      cache.close();
    }
  });
});
