import { rmSync } from 'node:fs';
import { isDecisionState, isSkillState, SEARCH_DEFAULT_LIMIT } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asking,
  type Bench,
  birthDecision,
  birthSkill,
  birthTask,
  capture,
  deprecateSkill,
  makeBench,
  moveDecision,
  moveDecisionAt,
  moveSkill,
  supersedeDecision,
} from '../../tests/support/chain.js';
import { bootstrap } from './bootstrap.js';
import { brief } from './brief.js';

/**
 * Every fixture reaches its state through the move the workflow defines, from the
 * state the entity is actually born in. Writing a state straight into a birth would
 * test this composition against a record the product cannot produce — the mistake
 * that once put `ACCEPTED` in this bench, a value `isDecisionState` rejects and no
 * state-keyed read can ever match.
 */
describe('brief — everything that governs the work here', () => {
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

  /** Births a decision and accepts it — the two moves that put one in force. */
  function accept(b: Bench, id: string, title: string): string {
    birthDecision(b, id, title);
    moveDecision(b, id, 'proposed', 'accepted', 'accept');
    return id;
  }

  /** Births a pattern and adopts it — the three moves that make one served. */
  function adopt(b: Bench, id: string, name: string): string {
    birthSkill(b, id, name);
    moveSkill(b, id, 'proposed', 'reviewed', 'review');
    moveSkill(b, id, 'reviewed', 'adopted', 'adopt');
    return id;
  }

  it('carries the calls in force and the patterns adopted, each by NAME', () => {
    const b = bench();
    accept(b, 'dec-1', 'Hand-rolled big-integer arithmetic');
    adopt(b, 'sk-1', 'One slice per PR');
    const cache = b.cache();
    try {
      expect(brief([cache])).toEqual({
        decisions: [{ id: 'dec-1', adr: 'ADR-dec-1', title: 'Hand-rolled big-integer arithmetic' }],
        skills: [{ id: 'sk-1', name: 'One slice per PR' }],
      });
    } finally {
      cache.close();
    }
  });

  it('serves ONLY the accepted — proposed, rejected and superseded are all absent', () => {
    // The four states of the decision machine, each reached by its own move, and both
    // halves of the criterion in ONE assertion: who is in, and who is not. Split in
    // two, a filter that let everything through would still pass the half that lists
    // what is in.
    const b = bench();
    accept(b, 'dec-accepted', 'In force');
    birthDecision(b, 'dec-proposed', 'Still on the table');
    birthDecision(b, 'dec-rejected', 'Refused');
    moveDecision(b, 'dec-rejected', 'proposed', 'rejected', 'reject');
    accept(b, 'dec-superseded', 'Replaced');
    accept(b, 'dec-successor', 'The replacement');
    supersedeDecision(b, 'dec-superseded', 'dec-successor');
    const cache = b.cache();
    try {
      expect(new Set(brief([cache]).decisions.map((d) => d.id))).toEqual(
        new Set(['dec-accepted', 'dec-successor']),
      );
      // And the fixture really did reach all four, in the product's own vocabulary:
      // without this the assertion above could pass over a record where three of the
      // states were never written at all.
      const states = ['dec-proposed', 'dec-accepted', 'dec-rejected', 'dec-superseded'].map(
        (id) => cache.getDecision(id)?.state ?? '(not projected)',
      );
      expect(states).toEqual(['proposed', 'accepted', 'rejected', 'superseded']);
      expect(states.filter((s) => !isDecisionState(s))).toEqual([]);
    } finally {
      cache.close();
    }
  });

  it('serves ONLY the adopted patterns — the other four states are absent', () => {
    const b = bench();
    adopt(b, 'sk-adopted', 'Adopted');
    birthSkill(b, 'sk-proposed', 'Proposed');
    birthSkill(b, 'sk-reviewed', 'Reviewed');
    moveSkill(b, 'sk-reviewed', 'proposed', 'reviewed', 'review');
    birthSkill(b, 'sk-rejected', 'Rejected');
    moveSkill(b, 'sk-rejected', 'proposed', 'rejected', 'reject');
    adopt(b, 'sk-deprecated', 'Deprecated');
    deprecateSkill(b, 'sk-deprecated');
    const cache = b.cache();
    try {
      expect(brief([cache]).skills.map((s) => s.id)).toEqual(['sk-adopted']);
      const states = [
        'sk-proposed',
        'sk-reviewed',
        'sk-adopted',
        'sk-rejected',
        'sk-deprecated',
      ].map((id) => cache.getSkill(id)?.state ?? '(not projected)');
      expect(states).toEqual(['proposed', 'reviewed', 'adopted', 'rejected', 'deprecated']);
      expect(states.filter((s) => !isSkillState(s))).toEqual([]);
    } finally {
      cache.close();
    }
  });

  it('carries NO work list — a queue would be wrong between two regenerations', () => {
    // Asserted as ABSENCE, over a record whose work is actionable: three tasks with a
    // legal move out, which is exactly what the opening context DOES serve. A brief
    // that grew a work list would be a file, regenerated by hand, telling an agent to
    // pick up work that was finished an hour earlier.
    const b = bench();
    birthTask(b, 'task-ready', 'Write the deploy runbook');
    birthTask(b, 'task-draft', 'Rotate the credentials');
    birthTask(b, 'task-third', 'Read the release notes');
    accept(b, 'dec-1', 'The one call there is');
    const cache = b.cache();
    try {
      const composed = brief([cache]);
      // No field for it, and no text of it anywhere in the answer.
      expect(Object.keys(composed).sort()).toEqual(['decisions', 'skills']);
      expect(JSON.stringify(composed)).not.toContain('Write the deploy runbook');
      expect(JSON.stringify(composed)).not.toContain('task-ready');
      // And the record really did hold actionable work: without this the absence
      // above would hold over a record with no tasks in it at all.
      expect(
        bootstrap([cache], asking(b.who))
          .work.map((w) => w.id)
          .sort(),
      ).toEqual(['task-draft', 'task-ready', 'task-third']);
    } finally {
      cache.close();
    }
  });

  it('carries no BODY and no RATIONALE — the keys are absent, not empty', () => {
    // Absence, not an empty string: a present-but-blank body would say the pattern is
    // a way of working with no content, which is the opposite of what is true. Both
    // are what a second read serves, asked about the one item that turned out to
    // matter — and both would be paid for on every prompt if they were here.
    const b = bench();
    accept(b, 'dec-1', 'A call with a long argument behind it');
    adopt(b, 'sk-1', 'A pattern with a body');
    capture(b, 'mem-1', 'a memory that is not governance');
    const cache = b.cache();
    try {
      const composed = brief([cache]);
      expect(Object.keys(composed.decisions[0] ?? {}).sort()).toEqual(['adr', 'id', 'title']);
      expect(Object.keys(composed.skills[0] ?? {}).sort()).toEqual(['id', 'name']);
      // The fixture's own text, not the field names: the bench writes `why <title>`
      // for a rationale and `body of <name>` for a body.
      const emitted = JSON.stringify(composed);
      expect(emitted).not.toContain('why A call with a long argument');
      expect(emitted).not.toContain('body of A pattern with a body');
      // Nor anything else the record holds: governance is the whole of this answer.
      expect(emitted).not.toContain('a memory that is not governance');
    } finally {
      cache.close();
    }
  });

  it('orders by CONTENT, so the order the trees come in cannot reshuffle it', () => {
    // Two things make this discriminate. Every decision is accepted at the SAME
    // instant, so `updatedAt` settles nothing; and the ids are written in DESCENDING
    // order across two trees, so the fold order disagrees with the id order. On a
    // fixture where the two agree, a sort with no tie-break passes (`Array.sort` is
    // stable) — the assertion that looks like a test and is not one.
    //
    // It is the property the whole file rests on: a document whose order followed the
    // trees would differ from itself between two runs, and `mnema brief | diff -
    // AGENTS.md` would report a difference in nothing.
    const one = bench();
    const two = bench();
    const ids = ['dec-d', 'dec-c', 'dec-b', 'dec-a'];
    const home = (i: number): Bench => (i % 2 === 0 ? one : two);
    for (const [i, id] of ids.entries()) birthDecision(home(i), id, `T${id}`);
    const at = one.now();
    for (const [i, id] of ids.entries()) {
      moveDecisionAt(home(i), id, at, 'proposed', 'accepted', 'accept');
    }
    // Patterns whose names sort against the order they are written in, and against
    // the trees: the second tree holds the name that must come first.
    adopt(two, 'sk-1', 'Alpha');
    adopt(one, 'sk-2', 'Beta');
    const a = one.cache();
    const c = two.cache();
    try {
      const forwards = brief([a, c]);
      const backwards = brief([c, a]);
      expect(forwards.decisions.map((d) => d.id)).toEqual(['dec-a', 'dec-b', 'dec-c', 'dec-d']);
      expect(forwards.skills.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
      // Same content, same answer, whatever order the caller passes the trees in.
      expect(backwards).toEqual(forwards);
    } finally {
      a.close();
      c.close();
    }
  });

  it('CUTS NOTHING, where the opening context cuts — and the two agree on what governs', () => {
    // The deliberate asymmetry, asserted on one record: past the limit the opening
    // context serves a page and says how many there were, and this serves every rule.
    // A decision left out of a queue waits for a second read; a decision left out of
    // this file is a rule the agent does not follow.
    //
    // It is also the guard on the rule being written ONCE: the brief and the opening
    // read compose the same derivation, so the page bootstrap serves has to be the
    // head of what this serves. If either grew a "in force" rule of its own, these
    // two lists would drift and only one of the readers would obey the new set.
    const b = bench();
    const total = SEARCH_DEFAULT_LIMIT + 7;
    for (let i = 0; i < total; i += 1) {
      accept(b, `dec-${String(i).padStart(3, '0')}`, `A call numbered ${i}`);
    }
    const cache = b.cache();
    try {
      const composed = brief([cache]);
      const opening = bootstrap([cache], asking(b.who));
      expect(composed.decisions).toHaveLength(total);
      expect(opening.decisions).toHaveLength(SEARCH_DEFAULT_LIMIT);
      expect(opening.decisionsTotal).toBe(total);
      expect(composed.decisions.slice(0, SEARCH_DEFAULT_LIMIT)).toEqual(opening.decisions);
    } finally {
      cache.close();
    }
  });

  it('gathers across every cache it is given — a rule governs wherever it lives', () => {
    // The team's calls are committed to the public tree, this machine's stay in the
    // private one, and a personal convention lives in the global one. All three govern
    // whatever is being done here, so all three belong in the file.
    const team = bench();
    const mine = bench();
    accept(team, 'dec-team', 'What the team settled');
    adopt(mine, 'sk-mine', 'How this machine works');
    const a = team.cache();
    const c = mine.cache();
    try {
      const composed = brief([a, c]);
      expect(composed.decisions.map((d) => d.id)).toEqual(['dec-team']);
      expect(composed.skills.map((s) => s.id)).toEqual(['sk-mine']);
    } finally {
      a.close();
      c.close();
    }
  });

  it('answers an empty record with two empty lists, never with an error', () => {
    // The honest empty: the composition has nothing to say and says nothing, and it is
    // the DOCUMENT that has to spell out which kind of empty this is (see
    // `presentation/brief.test.ts`). A refusal here would make "nobody has decided
    // yet" indistinguishable from "the record could not be read".
    const b = bench();
    const cache = b.cache();
    try {
      expect(brief([cache])).toEqual({ decisions: [], skills: [] });
      expect(brief([])).toEqual({ decisions: [], skills: [] });
    } finally {
      cache.close();
    }
  });
});
