import { rmSync } from 'node:fs';
import { isDecisionState } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthDecision,
  makeBench,
  moveDecision,
  moveDecisionAt,
  supersedeDecision,
} from '../../tests/support/chain.js';
import { decisionsInForce } from './decisions.js';

/**
 * Every fixture here reaches its state through the move the workflow defines, from
 * the state a decision is actually born in (`proposed`). Asking the birth for a
 * state no birth writes would test the filter against a record the product cannot
 * produce — which is how the previous version of this bench came to write
 * `ACCEPTED`, a value `isDecisionState` rejects and no state-keyed read can match.
 */
describe('decisionsInForce — the calls that govern', () => {
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

  it('serves a decision in force by TITLE, ADR label and id', () => {
    const b = bench();
    accept(b, 'dec-1', 'Hand-rolled big-integer arithmetic');
    const cache = b.cache();
    try {
      expect(decisionsInForce([cache])).toEqual([
        { id: 'dec-1', adr: 'ADR-dec-1', title: 'Hand-rolled big-integer arithmetic' },
      ]);
    } finally {
      cache.close();
    }
  });

  it('serves ONLY the accepted — proposed, rejected and superseded are all absent', () => {
    // The four states of the machine, each reached by its own move, and BOTH halves
    // of the criterion in one assertion: who is in, and who is not. Split in two, a
    // filter that let everything through would still pass the half that lists what
    // is in.
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
      const served = new Set(decisionsInForce([cache]).map((d) => d.id));
      expect(served).toEqual(new Set(['dec-accepted', 'dec-successor']));
    } finally {
      cache.close();
    }
  });

  it('drops a decision the moment a successor supersedes it', () => {
    // The case that gives "in force" its meaning, and it is the TRANSITION that
    // proves it — not a state written by hand. The same decision is served before
    // the supersede and gone after it, so what changed is the record.
    const b = bench();
    accept(b, 'dec-old', 'The first call');
    accept(b, 'dec-new', 'The call that replaced it');
    const before = b.cache();
    try {
      expect(decisionsInForce([before]).map((d) => d.id)).toEqual(['dec-new', 'dec-old']);
    } finally {
      before.close();
    }
    supersedeDecision(b, 'dec-old', 'dec-new');
    const after = b.cache();
    try {
      expect(decisionsInForce([after]).map((d) => d.id)).toEqual(['dec-new']);
    } finally {
      after.close();
    }
  });

  it('never carries the RATIONALE — the key is absent, not empty', () => {
    // Absence, not an empty string: a present-but-blank `rationale` would say the
    // decision was argued with nothing, which is the opposite of what is true. The
    // argument is the longest body in the record and it comes from `readRecord`.
    const b = bench();
    accept(b, 'dec-1', 'A call with a long argument behind it');
    const cache = b.cache();
    try {
      const [served] = decisionsInForce([cache]);
      if (served === undefined) throw new Error('the decision in force is missing');
      expect(served).not.toHaveProperty('rationale');
      expect(Object.keys(served).sort()).toEqual(['adr', 'id', 'title']);
      // The fixture's rationale is `why <title>` and its alternatives
      // `turned down for <title>`, so these are the actual texts of this record's
      // two body fields, not spellings of the field names. BOTH halves are checked:
      // the argument for the call, and what the call turned down.
      expect(JSON.stringify(served)).not.toContain('why A call with a long argument');
      expect(served).not.toHaveProperty('alternatives');
      expect(JSON.stringify(served)).not.toContain('turned down for A call with a long');
      // Nor the links the projection carries: a supersede is the audit's reading.
      expect(served).not.toHaveProperty('supersedes');
      expect(served).not.toHaveProperty('supersededBy');
    } finally {
      cache.close();
    }
  });

  it('gathers across every cache it is given (a decision governs wherever it lives)', () => {
    const team = bench();
    const mine = bench();
    accept(team, 'dec-team', 'What the team settled');
    accept(mine, 'dec-mine', 'What this machine settled');
    const a = team.cache();
    const c = mine.cache();
    try {
      expect(
        decisionsInForce([a, c])
          .map((d) => d.id)
          .sort(),
      ).toEqual(['dec-mine', 'dec-team']);
    } finally {
      a.close();
      c.close();
    }
  });

  it('orders most recently settled first, ties by id, whatever order the trees come in', () => {
    // Two things make this discriminate. Every decision is accepted at the SAME
    // instant, so `updatedAt` settles nothing; and the ids are written in DESCENDING
    // order across two trees, so the fold order disagrees with the id order. On a
    // fixture where the two agree, a sort with no tie-break at all passes
    // (`Array.sort` is stable) — the assertion that looks like a test and is not one.
    const one = bench();
    const two = bench();
    const ids = ['dec-d', 'dec-c', 'dec-b', 'dec-a'];
    const home = (i: number): Bench => (i % 2 === 0 ? one : two);
    for (const [i, id] of ids.entries()) birthDecision(home(i), id, `T${id}`);
    // Accepted after every birth, all at the same instant: the tie is real and the
    // move never predates the record it moves.
    const at = one.now();
    for (const [i, id] of ids.entries()) {
      moveDecisionAt(home(i), id, at, 'proposed', 'accepted', 'accept');
    }
    // And one settled LATER than all of them, in the tree that is passed second.
    accept(two, 'dec-z', 'The freshest call');
    const a = one.cache();
    const c = two.cache();
    try {
      const forwards = decisionsInForce([a, c]).map((d) => d.id);
      const backwards = decisionsInForce([c, a]).map((d) => d.id);
      // The freshest leads; the tie behind it is broken by id, ascending.
      expect(forwards).toEqual(['dec-z', 'dec-a', 'dec-b', 'dec-c', 'dec-d']);
      // Same content, same bytes, whatever order the caller passes the trees in —
      // an unstable order invalidates the host's cache of a prompt that did not change.
      expect(backwards).toEqual(forwards);
    } finally {
      a.close();
      c.close();
    }
  });

  it('the fixture writes states the PRODUCT can produce — the guard the bench lacked', () => {
    // The point of the rule nothing was checking, and a mutation is what found it:
    // putting the bench back to `PROPOSED`/`ACCEPTED`/`SUPERSEDED` left the whole
    // suite green. Every test keyed on ids, roles and counts, so a decision written in
    // a case the gate rejects — and that `WHERE state = ?` can never match, SQLite
    // comparing text bitwise — looked exactly like a decision. The filter this module
    // IS would have been testable only against a record the product cannot produce.
    const b = bench();
    birthDecision(b, 'dec-born', 'Born');
    const successor = accept(b, 'dec-accepted', 'Accepted');
    birthDecision(b, 'dec-rejected', 'Rejected');
    moveDecision(b, 'dec-rejected', 'proposed', 'rejected', 'reject');
    accept(b, 'dec-replaced', 'Replaced');
    supersedeDecision(b, 'dec-replaced', successor);
    const cache = b.cache();
    try {
      const states = ['dec-born', 'dec-accepted', 'dec-rejected', 'dec-replaced'].map(
        (id) => cache.getDecision(id)?.state ?? '(not projected)',
      );
      expect(states).toEqual(['proposed', 'accepted', 'rejected', 'superseded']);
      // Asked of the product's own vocabulary and not only of four literals typed
      // here: if the workflow ever renames a state, the list above is what goes
      // stale, and this line is what stays true.
      expect(states.filter((s) => !isDecisionState(s))).toEqual([]);
    } finally {
      cache.close();
    }
  });

  it('is empty — never an error — when nothing has been settled', () => {
    const b = bench();
    birthDecision(b, 'dec-1', 'Only proposed');
    const cache = b.cache();
    try {
      expect(decisionsInForce([cache])).toEqual([]);
      expect(decisionsInForce([])).toEqual([]);
    } finally {
      cache.close();
    }
  });
});
