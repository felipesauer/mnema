import { rmSync } from 'node:fs';
import { SKILL_STATES, type SkillState } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthSkill,
  deprecateSkill,
  makeBench,
  moveSkill,
} from '../../tests/support/chain.js';
import { statesMeaning } from './disposition.js';
import {
  adoptedSkills,
  lookupServedSkill,
  type ServedSkill,
  SKILL_DISPOSITION,
  skillCatalogue,
  skillDisposition,
  skillsAwaitingJudgement,
} from './skills.js';

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
        { id: 'sk-1', name: 'Small PRs', body: 'body of Small PRs', state: 'adopted' },
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
      expect(lookupServedSkill([after], 'sk-1')).toEqual({
        outcome: 'not-served',
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
      expect(lookupServedSkill([a, c], 'sk-mine')).toMatchObject({ outcome: 'served' });
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
        {
          id: 'sk-1',
          name: 'Small PRs',
          body: 'body of Small PRs',
          state: 'adopted',
          adoptedBy: 'agent-A',
        },
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
      expect(lookupServedSkill([cache], 'sk-1')).toMatchObject({
        outcome: 'served',
        skill: { adoptedBy: 'agent-B' },
      });
    } finally {
      cache.close();
    }
  });
});

describe('lookupServedSkill — asking for one pattern by id', () => {
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
      expect(lookupServedSkill([cache], 'sk-1')).toEqual({
        outcome: 'served',
        skill: { id: 'sk-1', name: 'Small PRs', body: 'body of Small PRs', state: 'adopted' },
      });
    } finally {
      cache.close();
    }
  });

  it('serves the body of a pattern AWAITING a judgement, in both waiting states', () => {
    // The inversion this delivery makes: a body that used to be refused. Nobody can
    // rule on a pattern without reading it, and the state comes back with the body so
    // the reader knows it is ruling and not being instructed.
    const b = bench();
    birthSkill(b, 'sk-new', 'Nobody has looked');
    birthSkill(b, 'sk-seen', 'Looked at');
    moveSkill(b, 'sk-seen', 'proposed', 'reviewed', 'review');
    const cache = b.cache();
    try {
      expect(lookupServedSkill([cache], 'sk-new')).toEqual({
        outcome: 'served',
        skill: {
          id: 'sk-new',
          name: 'Nobody has looked',
          body: 'body of Nobody has looked',
          state: 'proposed',
        },
      });
      expect(lookupServedSkill([cache], 'sk-seen')).toEqual({
        outcome: 'served',
        skill: {
          id: 'sk-seen',
          name: 'Looked at',
          body: 'body of Looked at',
          state: 'reviewed',
        },
      });
    } finally {
      cache.close();
    }
  });

  it('a served candidate carries NO adopter — nothing invents one', () => {
    // The field is absent for a pattern a person adopted AND for one nothing has
    // adopted; the `state` is what tells those apart, and a consumer that prints
    // "adopted by a person" without reading it says something false.
    const b = bench();
    birthSkill(b, 'sk-1', 'On the table', 'proposed', 'agent-A');
    const cache = b.cache();
    try {
      const found = lookupServedSkill([cache], 'sk-1');
      if (found.outcome !== 'served') throw new Error('the candidate was not served');
      expect(found.skill).not.toHaveProperty('adoptedBy');
      expect(found.skill.state).toBe('proposed');
    } finally {
      cache.close();
    }
  });

  it('refuses a CLOSED pattern, saying the state and never the body', () => {
    // Both closed states, each reached by its own move — the argument that used to
    // justify refusing four states, now written where it holds.
    const b = bench();
    birthSkill(b, 'sk-no', 'Turned down');
    moveSkill(b, 'sk-no', 'proposed', 'rejected', 'reject');
    birthSkill(b, 'sk-old', 'Retired');
    moveSkill(b, 'sk-old', 'proposed', 'reviewed', 'review');
    moveSkill(b, 'sk-old', 'reviewed', 'adopted', 'adopt');
    deprecateSkill(b, 'sk-old');
    const cache = b.cache();
    try {
      for (const [id, state] of [
        ['sk-no', 'rejected'],
        ['sk-old', 'deprecated'],
      ] as const) {
        const found = lookupServedSkill([cache], id);
        expect(found, id).toEqual({ outcome: 'not-served', state });
        expect(JSON.stringify(found), id).not.toContain('body of');
      }
    } finally {
      cache.close();
    }
  });

  /**
   * THE RULE IS THE TABLE, and this is the test that says so at the point the rule is
   * applied. It enumerates `SKILL_STATES` — the workflow's own tuple, not a list kept
   * here — reaches each state by the moves that produce it, and asserts the lookup's
   * answer against `SKILL_DISPOSITION`. A sixth state added to the machine arrives in
   * this loop with no edit, and fails until `stateReachedBy` knows how to reach it;
   * a state whose disposition CHANGES flips the expectation with it.
   *
   * The complement of the guard in `src`: `BODY_SERVED` is a `Record<Disposition, …>`,
   * so a fourth disposition does not compile. What the compiler cannot check is that
   * the SITE applying the table is the one this file exercises, which is what the loop
   * below pins.
   */
  const stateReachedBy: Readonly<Record<SkillState, (b: Bench, id: string) => void>> = {
    proposed: (b, id) => birthSkill(b, id, `pattern ${id}`),
    reviewed: (b, id) => {
      birthSkill(b, id, `pattern ${id}`);
      moveSkill(b, id, 'proposed', 'reviewed', 'review');
    },
    adopted: (b, id) => {
      stateReachedBy.reviewed(b, id);
      moveSkill(b, id, 'reviewed', 'adopted', 'adopt');
    },
    rejected: (b, id) => {
      birthSkill(b, id, `pattern ${id}`);
      moveSkill(b, id, 'proposed', 'rejected', 'reject');
    },
    deprecated: (b, id) => {
      stateReachedBy.adopted(b, id);
      deprecateSkill(b, id);
    },
  };

  it('answers by DISPOSITION for every state the workflow has, not by a list', () => {
    const b = bench();
    for (const state of SKILL_STATES) stateReachedBy[state](b, `sk-${state}`);
    const cache = b.cache();
    try {
      const answered = SKILL_STATES.map((state) => {
        const found = lookupServedSkill([cache], `sk-${state}`);
        return [state, found.outcome] as const;
      });
      expect(answered).toEqual(
        SKILL_STATES.map((state) => [
          state,
          SKILL_DISPOSITION[state] === 'closed' ? 'not-served' : 'served',
        ]),
      );
      // And the loop is not vacuous about either half: the table has states on both
      // sides of the rule, so a mutation that made every answer the same would fail.
      expect(new Set(answered.map(([, outcome]) => outcome))).toEqual(
        new Set(['served', 'not-served']),
      );
      // The state that comes back with a served body is the state it was READ in.
      for (const state of statesMeaning(SKILL_STATES, skillDisposition, 'closed')) {
        expect(lookupServedSkill([cache], `sk-${state}`)).toEqual({
          outcome: 'not-served',
          state,
        });
      }
      for (const disposition of ['in-force', 'awaiting-judgement'] as const) {
        for (const state of statesMeaning(SKILL_STATES, skillDisposition, disposition)) {
          expect(lookupServedSkill([cache], `sk-${state}`)).toMatchObject({
            outcome: 'served',
            skill: { state },
          });
        }
      }
    } finally {
      cache.close();
    }
  });

  it('skillDisposition is the table, asked rather than restated', () => {
    // The one classification a consumer outside this module gets. It exists because a
    // surface has to frame a body it served, and re-deriving "is this in force" out
    // there would be this table copied where nobody could see it drift.
    for (const state of SKILL_STATES) {
      expect(skillDisposition(state), state).toBe(SKILL_DISPOSITION[state]);
    }
  });

  it('separates "no such skill" from "not served"', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Adopted', 'adopted');
    const cache = b.cache();
    try {
      expect(lookupServedSkill([cache], 'sk-nowhere')).toEqual({ outcome: 'unknown' });
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
    // nothing to ever make it happen, so a rule reading "has a legal move" would keep
    // every adopted pattern on a pendency list for good. That rule used to be the work
    // list's, and it was wrong there too — see `tasks.ts`; both lists ask the
    // disposition now, so there is no ride left to hitch.
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

describe('skillCatalogue — everything, or every name', () => {
  /**
   * An adopted pattern with a body of exactly `bytes` ASCII characters — the shape
   * `adoptedSkills` answers, since that answer is this function's only input.
   */
  const of = (id: string, bytes: number): ServedSkill => ({
    id,
    name: `pattern ${id}`,
    body: 'x'.repeat(bytes),
    state: 'adopted',
  });

  it('serves the bodies when they fit in one read', () => {
    const skills = [of('sk-1', 3427), of('sk-2', 3427)];
    expect(skillCatalogue(skills)).toEqual({ served: 'bodies', skills });
  });

  it('serves the NAMES when they do not, and no body travels with them', () => {
    // Six patterns of the market's median size (3,427 B) — the sixth is what puts
    // the answer over one read's budget.
    const skills = Array.from({ length: 6 }, (_, i) => of(`sk-${i}`, 3427));

    const catalogue = skillCatalogue(skills);

    expect(catalogue.served).toBe('names');
    expect(catalogue.skills).toEqual(skills.map(({ id, name }) => ({ id, name })));
    // THE ABSENCE, not just the presence of the names: a body reaching this arm is
    // the whole defect this closes, and an assertion on `id` and `name` alone would
    // pass with every body still riding along.
    expect(JSON.stringify(catalogue)).not.toContain('xxx');
    for (const served of catalogue.skills) {
      expect(Object.keys(served).sort()).toEqual(['id', 'name']);
    }
  });

  it('says how many bytes it weighed, so the reason is checkable', () => {
    const catalogue = skillCatalogue(Array.from({ length: 6 }, (_, i) => of(`sk-${i}`, 3427)));
    expect(catalogue.served === 'names' && catalogue.withheldBytes).toBe(6 * 3427);
  });

  it('is ALL or NAMES — never the ones that would have fit', () => {
    // A tiny pattern beside a huge one. Serving "the K that fit" would hand over the
    // small body and leave the caller unable to see what was dropped; the rule is
    // that the whole answer changes layer, not that it is trimmed.
    const catalogue = skillCatalogue([of('sk-small', 10), of('sk-huge', 30_000)]);
    expect(catalogue.served).toBe('names');
    expect(catalogue.skills.map((s) => s.id)).toEqual(['sk-small', 'sk-huge']);
    expect(JSON.stringify(catalogue)).not.toContain('xxx');
  });

  it('draws the line at the budget itself: 20 KiB serves, one byte more does not', () => {
    // The number is 20 KiB and it is written in ONE place; this case is where a
    // change to it becomes visible, which is why it names the size rather than
    // importing it — a test computing the boundary from the constant would pass for
    // any constant at all.
    expect(skillCatalogue([of('sk-1', 20 * 1024)]).served).toBe('bodies');
    expect(skillCatalogue([of('sk-1', 20 * 1024 + 1)]).served).toBe('names');
  });

  it('weighs BYTES, not characters — a body of multi-byte text is bigger than it looks', () => {
    // 12,000 characters, well under the budget as a count of characters; three bytes
    // each in UTF-8, which is 36,000 bytes and over it. The content door measures the
    // way in with the same ruler.
    const wide: ServedSkill = {
      id: 'sk-1',
      name: 'wide',
      body: '想'.repeat(12_000),
      state: 'adopted',
    };
    expect(wide.body.length).toBeLessThan(20 * 1024);
    const catalogue = skillCatalogue([wide]);
    expect(catalogue.served).toBe('names');
    expect(catalogue.served === 'names' && catalogue.withheldBytes).toBe(36_000);
  });

  it('an empty record is served as bodies — there is nothing to weigh', () => {
    expect(skillCatalogue([])).toEqual({ served: 'bodies', skills: [] });
  });
});
