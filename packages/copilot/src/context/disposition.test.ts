/**
 * The three disposition tables, checked against the workflows they claim to read.
 *
 * A classification is a second statement about a machine whose first statement is
 * the transition table, and nothing but a test keeps the two agreeing. Every case
 * here enumerates from the product's own vocabulary (`DECISION_STATES`,
 * `SKILL_STATES`, `TASK_STATES`) and its own tables (`DECISION_TRANSITIONS`,
 * `SKILL_TRANSITIONS`, `TRANSITIONS`) — never from a list typed in this file — so a
 * state or a move added tomorrow is covered without this file being edited.
 *
 * IT COVERED TWO MACHINES, and the third arrived with the slice that made the opening
 * read ask the classification for tasks as well. The properties this file proves are
 * about the WAITING LIST, and that list reaches all three now: "nothing can wait
 * forever" said `checked` was three, and a task `IN_REVIEW` was the fourth waiting
 * state in the product with nothing here reading its exits.
 *
 * The task machine's table is `core`'s and stays there — it is derived from
 * `TRANSITIONS` and cross-checked against it in that package — so what this file gets
 * of it is `taskDisposition`, the accessor, which is the whole of what crosses the
 * boundary. Its five words are NOT this layer's three, and nothing here unifies them:
 * the two cases that need to speak of both name the word each vocabulary uses.
 */

import {
  DECISION_STATES,
  DECISION_TRANSITIONS,
  SKILL_STATES,
  SKILL_TRANSITIONS,
  TASK_STATES,
  type TaskDisposition,
  TRANSITIONS,
  taskDisposition,
} from '@mnema/core';
import { describe, expect, it } from 'vitest';
import { DECISION_DISPOSITION } from './decisions.js';
import type { Disposition } from './disposition.js';
import { SKILL_DISPOSITION } from './skills.js';

/** One machine: its states, its legal moves, and what a state means to a reader. */
interface Machine {
  readonly name: string;
  readonly states: readonly string[];
  readonly moves: readonly { readonly from: string; readonly to: string }[];
  readonly disposition: Readonly<Record<string, Disposition | TaskDisposition>>;
}

/**
 * The task machine's classification, as a table, built by ASKING the accessor for
 * every state the workflow publishes.
 *
 * `TASK_DISPOSITION` itself is deliberately off `@mnema/core`'s surface — a consumer
 * gets the question and never the table — so this is how a reader outside that package
 * holds the whole of it, and it is a projection of the real one rather than a copy: a
 * state added to the machine appears here without this file being edited, and a row
 * changed there changes here.
 */
const TASK_MEANING: Readonly<Record<string, TaskDisposition>> = Object.fromEntries(
  TASK_STATES.map((state) => [state, taskDisposition(state)]),
);

const MACHINES: readonly Machine[] = [
  { name: 'task', states: TASK_STATES, moves: TRANSITIONS, disposition: TASK_MEANING },
  {
    name: 'decision',
    states: DECISION_STATES,
    moves: DECISION_TRANSITIONS,
    disposition: DECISION_DISPOSITION,
  },
  { name: 'skill', states: SKILL_STATES, moves: SKILL_TRANSITIONS, disposition: SKILL_DISPOSITION },
];

/** The states of one machine classified as any of `wanted`. */
function classified(machine: Machine, ...wanted: (Disposition | TaskDisposition)[]): string[] {
  return machine.states.filter((state) => {
    const meaning = machine.disposition[state];
    return meaning !== undefined && wanted.includes(meaning);
  });
}

/** Every state one move reaches from `from`. */
function movesFrom(machine: Machine, from: string): string[] {
  return machine.moves.filter((move) => move.from === from).map((move) => move.to);
}

describe('the disposition tables agree with the workflow', () => {
  it('classifies every state of all three machines, and invents none', () => {
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
    // Seven task states, four decision, five skill. The count is asserted so a
    // machine dropping out of the list above empties every case below in silence.
    expect(MACHINES.flatMap((m) => m.states)).toHaveLength(16);
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
    // Four: a task `IN_REVIEW`, a decision `proposed`, a skill `proposed`, a skill
    // `reviewed` — and the count is asserted so the loop cannot silently stop covering
    // the machines. It said three until the task machine joined the waiting list.
    expect(checked).toBe(4);
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
    // waiting start; a decision `proposed`, a skill `reviewed` and a task `IN_REVIEW`
    // all lead straight out.
    // Counted per traversal, so an edge reachable from two waiting starts would count
    // twice. Drop that edge from `SKILL_TRANSITIONS` and this case would otherwise
    // pass having compared nothing.
    expect(edges).toBe(1);
  });

  it('a state that ARRIVED keeps a legal move forever — which is why "has a move" is the wrong rule', () => {
    // The evidence for the decision this file's slice was built on, held as a test so
    // it cannot quietly stop being true — and now over all three machines, which is
    // where it stopped being hypothetical. `supersede` is legal from `accepted`,
    // `deprecate` from `adopted` and `reopen` from `DONE`, with nothing to make any of
    // them happen, so a rule reading "has at least one legal move" would report every
    // settled call, every adopted pattern AND every completed task as a pendency that
    // never clears. The third of those was not a hypothesis: it was the opening read's
    // work list, and it is what this slice removed.
    //
    // TWO WORDS, NOT ONE. `in-force` is what the decision and skill machines call the
    // position that arrived and `settled` is the task machine's; naming both here is
    // reading two vocabularies, not merging them — whether three machines should ever
    // speak one is a question this file does not answer.
    let arrived = 0;
    for (const machine of MACHINES) {
      const holding = classified(machine, 'in-force', 'settled');
      expect(holding.length, machine.name).toBeGreaterThan(0);
      for (const state of holding) {
        expect(movesFrom(machine, state), `${machine.name}.${state} is terminal`).not.toEqual([]);
        expect(machine.disposition[state]).not.toBe('awaiting-judgement');
        arrived += 1;
      }
    }
    // `DONE`, `accepted`, `adopted` — one per machine, and the count is what stops the
    // loop above passing over a machine whose arrived states stopped being classified.
    expect(arrived).toBe(3);
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
    // `CANCELED` for tasks, `rejected` and `superseded` for decisions, `rejected` and
    // `deprecated` for skills. `DONE` is NOT here: the task machine calls it `settled`
    // precisely because a move does leave it, which the case above reads.
    expect(closed).toBe(5);
  });
});
