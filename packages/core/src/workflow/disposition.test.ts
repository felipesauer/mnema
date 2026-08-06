/**
 * The classification agrees with the machine — every row recomputed from the table of
 * moves, never read back from the table under test.
 *
 * A disposition is a claim ABOUT the transition table ("this state has one exit and it
 * undoes the state"), so the only assertion worth making is the claim recomputed from
 * the rows. Comparing the table to a literal copy of itself would pin the letters and
 * prove nothing: the failure this file exists for is a state whose exits changed —
 * `unblock` given a `reason`, a second way out of `DONE` — while the classification kept
 * saying what used to be true.
 *
 * THE DERIVATION IS THE FIVE DISCRIMINANTS, in order, and each one is a property of the
 * rows that leave a state. The order matters and the tests below pin why: the count of
 * exits is asked before the proof they require, because "one exit" and "every exit
 * requires proof" would both be true of a single guarded move and they mean opposite
 * things.
 *
 * The vacuous form of the whole file is a bucket nobody lands in — a derivation that
 * classified everything as one thing would agree with a table that did too — so the
 * counts per bucket are asserted, and every one of the five is non-empty.
 */

import { describe, expect, it } from 'vitest';
import { TASK_DISPOSITION, type TaskDisposition } from './disposition.js';
import { TASK_STATES, type TaskState } from './states.js';
import { TRANSITIONS, type Transition } from './transitions.js';

/** The rows that LEAVE a state — the whole of what a position's disposition is about. */
function exits(state: TaskState): readonly Transition[] {
  return TRANSITIONS.filter((row) => row.from === state);
}

/** The rows that REACH a state — how "the only way out undoes the position" is checked. */
function entries(state: TaskState): readonly Transition[] {
  return TRANSITIONS.filter((row) => row.to === state);
}

/**
 * What the table SAYS a state's disposition is, computed from its rows alone.
 *
 * This is the same reading the module doc writes as prose, as code, so the two cannot
 * drift: if this function and the table disagree, one of them is wrong about the
 * machine and the case below says which state.
 */
function derived(state: TaskState): TaskDisposition {
  const out = exits(state);
  if (out.length === 0) return 'closed';
  if (out.length === 1) {
    // A single exit is a position that can only be undone. What separates the two is
    // the price of undoing it: free, or an explanation.
    return (out[0] as Transition).requires.length === 0 ? 'stalled' : 'settled';
  }
  if (out.every((row) => row.requires.length > 0)) return 'awaiting-judgement';
  return 'advancing';
}

describe('every state of the machine has a disposition', () => {
  it('classifies all seven, enumerated from the workflow’s own tuple', () => {
    // From `TASK_STATES` and not from the table's keys: the set being classified is the
    // product's published vocabulary, so a state added to the machine shows up here as a
    // missing meaning rather than as a key nobody looked for.
    for (const state of TASK_STATES) {
      expect(TASK_DISPOSITION[state], state).toBeDefined();
    }
    expect(Object.keys(TASK_DISPOSITION).sort()).toEqual([...TASK_STATES].sort());
  });

  it('agrees with the transition table, state by state', () => {
    // The rule. Recomputed from the rows, so the classification is a claim that can be
    // false — and it is false the day a state's exits change and this table does not.
    const fromTheTable = Object.fromEntries(TASK_STATES.map((state) => [state, derived(state)]));
    expect(TASK_DISPOSITION).toEqual(fromTheTable);
  });

  it('lands something in every bucket, so no name is decoration', () => {
    // Non-vacuity, per bucket. A disposition nothing reaches is a value a reader will
    // one day branch on and never meet, and the derivation above would agree with a
    // table that had collapsed two buckets into one.
    const counted = new Map<TaskDisposition, number>();
    for (const state of TASK_STATES) {
      const disposition = TASK_DISPOSITION[state];
      counted.set(disposition, (counted.get(disposition) ?? 0) + 1);
    }
    expect(Object.fromEntries([...counted].sort())).toEqual({
      advancing: 3,
      'awaiting-judgement': 1,
      closed: 1,
      settled: 1,
      stalled: 1,
    });
  });
});

describe('and each discriminant is the property it claims to be', () => {
  /** The states the table gives one disposition, read from the classification. */
  const states = (wanted: TaskDisposition): readonly TaskState[] =>
    TASK_STATES.filter((state) => TASK_DISPOSITION[state] === wanted);

  it('the closed one is the state NOTHING leaves', () => {
    for (const state of states('closed')) expect(exits(state), state).toEqual([]);
    // And it is the only one: every other state has a way out, which is what makes
    // "no exit" a discriminant rather than a coincidence.
    for (const state of TASK_STATES) {
      if (TASK_DISPOSITION[state] === 'closed') continue;
      expect(exits(state).length, state).toBeGreaterThan(0);
    }
  });

  it('the stalled one has ONE exit, it undoes the state, and it is free', () => {
    for (const state of states('stalled')) {
      const out = exits(state);
      expect(out.length, state).toBe(1);
      const only = out[0] as Transition;
      expect(only.requires, `${state} ${only.action}`).toEqual([]);
      // The exit leads back to a state that reaches this one, which is the whole of
      // "the only move undoes the position": there is no progress to make from here.
      expect(
        entries(state).map((row) => row.from),
        `${state} is not reached from ${only.to}`,
      ).toContain(only.to);
    }
  });

  it('the settled one also has ONE exit that undoes it — and undoing COSTS', () => {
    // The pair the count of exits cannot tell apart, which is why the derivation asks
    // the price second. Both positions can only be undone; only one of them is free.
    for (const state of states('settled')) {
      const out = exits(state);
      expect(out.length, state).toBe(1);
      const only = out[0] as Transition;
      expect(only.requires.length, `${state} ${only.action}`).toBeGreaterThan(0);
      expect(
        entries(state).map((row) => row.from),
        `${state} is not reached from ${only.to}`,
      ).toContain(only.to);
    }
    // Said as the difference itself, so the case cannot pass by both buckets being
    // empty: the two single-exit states exist, and their exits differ in exactly this.
    const single = TASK_STATES.filter((state) => exits(state).length === 1);
    expect(single.length).toBe(2);
    expect(single.map((state) => TASK_DISPOSITION[state]).sort()).toEqual(['settled', 'stalled']);
  });

  it('the awaiting one has SEVERAL exits and every one of them demands proof', () => {
    for (const state of states('awaiting-judgement')) {
      const out = exits(state);
      expect(out.length, state).toBeGreaterThan(1);
      for (const row of out) {
        expect(row.requires.length, `${state} ${row.action}`).toBeGreaterThan(0);
      }
    }
  });

  it('the advancing ones have a way FORWARD that asks for nothing', () => {
    for (const state of states('advancing')) {
      const free = exits(state).filter((row) => row.requires.length === 0);
      expect(free.length, `${state} has no free exit`).toBeGreaterThan(0);
      // And more than one way out, which is what separates an advancing position from
      // the stalled one — whose single free exit only undoes it.
      expect(exits(state).length, state).toBeGreaterThan(1);
    }
  });

  it('reads a table with rows in it, so none of the above is filtering nothing', () => {
    // The enumeration's own floor: every case here is a filter over `TRANSITIONS`, and
    // a table that stopped being found would pass all of them in silence.
    expect(TRANSITIONS.length).toBeGreaterThanOrEqual(12);
    expect(TASK_STATES.length).toBe(7);
  });
});
