/**
 * The two disposition tables, checked against the workflow they claim to read.
 *
 * A classification is a second statement about a machine whose first statement is
 * the transition table, and nothing but a test keeps the two agreeing. Every case
 * here enumerates from the product's own vocabulary (`DECISION_STATES`,
 * `SKILL_STATES`) and its own tables (`DECISION_TRANSITIONS`, `SKILL_TRANSITIONS`)
 * — never from a list typed in this file — so a state or a move added tomorrow is
 * covered without this file being edited.
 */

import {
  DECISION_STATES,
  DECISION_TRANSITIONS,
  SKILL_STATES,
  SKILL_TRANSITIONS,
} from '@mnema/core';
import { describe, expect, it } from 'vitest';
import { DECISION_DISPOSITION } from './decisions.js';
import type { Disposition } from './disposition.js';
import { SKILL_DISPOSITION } from './skills.js';

/** One machine: its states, its legal moves, and what this layer says each state means. */
interface Machine {
  readonly name: string;
  readonly states: readonly string[];
  readonly moves: readonly { readonly from: string; readonly to: string }[];
  readonly disposition: Readonly<Record<string, Disposition>>;
}

const MACHINES: readonly Machine[] = [
  {
    name: 'decision',
    states: DECISION_STATES,
    moves: DECISION_TRANSITIONS,
    disposition: DECISION_DISPOSITION,
  },
  { name: 'skill', states: SKILL_STATES, moves: SKILL_TRANSITIONS, disposition: SKILL_DISPOSITION },
];

/** The states of one machine this layer classifies as `wanted`. */
function classified(machine: Machine, wanted: Disposition): string[] {
  return machine.states.filter((state) => machine.disposition[state] === wanted);
}

/** Every state one move reaches from `from`. */
function movesFrom(machine: Machine, from: string): string[] {
  return machine.moves.filter((move) => move.from === from).map((move) => move.to);
}

describe('the disposition tables agree with the workflow', () => {
  it('classifies every state of both machines, and invents none', () => {
    // The compiler already refuses a `Record<State, Disposition>` with a state
    // missing — that is the guard, and it lives in `src` where it is real. This is
    // the other direction plus the non-vacuity: a table with an EXTRA key (a state
    // that was renamed out of the union, say) type-checks and would leave a bucket
    // nothing can ever land in, and an empty enumeration would make every other
    // case here pass by iterating nothing.
    for (const machine of MACHINES) {
      expect(Object.keys(machine.disposition).sort(), machine.name).toEqual(
        [...machine.states].sort(),
      );
    }
    expect(MACHINES.flatMap((m) => m.states)).toHaveLength(9);
  });

  it('NOTHING CAN WAIT FOREVER: every awaiting state has a way out that does not come back', () => {
    // The trap this criterion exists to avoid, proved from the transition table
    // rather than from intent. "Awaiting a judgement" is only honest if the list
    // empties: a state classified as waiting must have at least one legal move to a
    // state that is NOT waiting, or an item in it would sit there for good.
    let checked = 0;
    for (const machine of MACHINES) {
      for (const state of classified(machine, 'awaiting-judgement')) {
        const out = movesFrom(machine, state);
        const leaves = out.filter((to) => machine.disposition[to] !== 'awaiting-judgement');
        expect(leaves, `${machine.name}.${state} has no way out of waiting`).not.toEqual([]);
        checked += 1;
      }
    }
    // Three: a decision `proposed`, a skill `proposed`, a skill `reviewed` — and the
    // count is asserted so the loop cannot silently stop covering the machines.
    expect(checked).toBe(3);
  });

  it('and no cycle keeps one waiting either — the waiting side is a DAG', () => {
    // A way out is not enough on its own: `proposed → reviewed` is a move WITHIN
    // the waiting side, so a machine whose waiting states pointed at each other in
    // a loop could keep an item legally moving and never leaving. Walked from every
    // waiting state, following only waiting→waiting edges.
    let edges = 0;
    for (const machine of MACHINES) {
      const waiting = new Set(classified(machine, 'awaiting-judgement'));
      for (const start of waiting) {
        const seen = new Set<string>();
        const queue = [start];
        while (queue.length > 0) {
          const here = queue.shift() as string;
          for (const to of movesFrom(machine, here)) {
            if (!waiting.has(to)) continue;
            edges += 1;
            expect(to, `${machine.name}: ${start} can return to itself`).not.toBe(start);
            if (!seen.has(to)) {
              seen.add(to);
              queue.push(to);
            }
          }
        }
      }
    }
    // The count is of EDGES followed, not of states walked from, and that is the
    // whole point of it: what can go vacuous here is the WALK, and the walk
    // disappears when no move leads from one waiting state to another. Counting
    // starting states would report three with zero edges followed — a counter that
    // does not count the thing that can be missing, which is what the other four
    // cases in this file carry a count against.
    //
    // ONE: the skill machine's `review` (`proposed → reviewed`) is the only move
    // inside the waiting side anywhere in the product, and it is reached from one
    // waiting start; a decision `proposed` and a skill `reviewed` lead straight out.
    // Counted per traversal, so an edge reachable from two waiting starts would count
    // twice. Drop that edge from `SKILL_TRANSITIONS` and this case would otherwise
    // pass having compared nothing.
    expect(edges).toBe(1);
  });

  it('an IN-FORCE state keeps a legal move forever — which is why "has a move" is the wrong rule', () => {
    // The evidence for the decision this slice is built on, held as a test so it
    // cannot quietly stop being true. `supersede` is legal from `accepted` and
    // `deprecate` from `adopted`, with nothing to make either happen — so the work
    // list's criterion would put every settled call and every adopted pattern on a
    // pendency list that never empties. They are classified in-force instead.
    for (const machine of MACHINES) {
      const holding = classified(machine, 'in-force');
      expect(holding.length, machine.name).toBeGreaterThan(0);
      for (const state of holding) {
        expect(movesFrom(machine, state), `${machine.name}.${state} is terminal`).not.toEqual([]);
        expect(machine.disposition[state]).not.toBe('awaiting-judgement');
      }
    }
  });

  it('a CLOSED state is terminal — nothing leaves it', () => {
    // The third bucket's own claim, and the cross-check that keeps the
    // classification honest if the workflow grows an edge: a move out of a state
    // called closed would mean something IS pending there, and this fails until the
    // table is reconsidered.
    let closed = 0;
    for (const machine of MACHINES) {
      for (const state of classified(machine, 'closed')) {
        expect(movesFrom(machine, state), `${machine.name}.${state} is not terminal`).toEqual([]);
        closed += 1;
      }
    }
    // `rejected` and `superseded` for decisions, `rejected` and `deprecated` for skills.
    expect(closed).toBe(4);
  });
});
