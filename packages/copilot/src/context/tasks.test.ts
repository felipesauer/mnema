/**
 * The task machine's two halves of the opening context, checked against the
 * classification they claim to read.
 *
 * The cases fall into three groups, and the split is deliberate:
 *
 *   - THE STATES THAT MOVED, named one by one. `DONE` and `CANCELED` left the work
 *     list and `IN_REVIEW` left it for the other one; those three are asserted
 *     literally, so a change to `TASK_DISPOSITION` alone turns this file red rather
 *     than sliding both sides of a derived comparison at once.
 *   - THE WHOLE MACHINE, derived. Every state of `TASK_STATES` is REACHED through the
 *     workflow's own moves and the list it lands in is compared against
 *     `taskDisposition` — never against a list typed in this file — so a state added
 *     tomorrow is covered without this file being edited.
 *   - AND THE SOURCE ITSELF, because the two above pass equally well over a module
 *     that copied the classification into a set of its own and happens to agree with
 *     it today. That copy is the failure this slice exists to remove, so it is banned
 *     structurally.
 */

import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TASK_STATES, type TaskState, TRANSITIONS, taskDisposition } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, birthTask, makeBench, moveTask } from '../../tests/support/chain.js';
import { liveWork, tasksAwaitingJudgement } from './tasks.js';

let bench: Bench;
afterEach(() => {
  if (bench) rmSync(bench.root, { recursive: true, force: true });
});

/**
 * The moves that reach each state from a task's birth — the workflow's own rows, with
 * the proof each one demands.
 *
 * Written out per state rather than searched for, so the fixture is readable as the
 * sequence a person would perform; that it stays a real path is checked below against
 * `TRANSITIONS`, which is what stops it drifting into a state the machine cannot
 * reach. Total in the compiler: an eighth state does not build until it has a path.
 */
const REACHED_BY: Readonly<
  Record<TaskState, readonly (readonly [string, string, string, Record<string, string>?])[]>
> = {
  DRAFT: [],
  READY: [['DRAFT', 'READY', 'submit']],
  IN_PROGRESS: [
    ['DRAFT', 'READY', 'submit'],
    ['READY', 'IN_PROGRESS', 'start'],
  ],
  BLOCKED: [
    ['DRAFT', 'READY', 'submit'],
    ['READY', 'IN_PROGRESS', 'start'],
    ['IN_PROGRESS', 'BLOCKED', 'block', { reason: 'the API is down' }],
  ],
  IN_REVIEW: [
    ['DRAFT', 'READY', 'submit'],
    ['READY', 'IN_PROGRESS', 'start'],
    ['IN_PROGRESS', 'IN_REVIEW', 'submit_review'],
  ],
  DONE: [
    ['DRAFT', 'READY', 'submit'],
    ['READY', 'IN_PROGRESS', 'start'],
    ['IN_PROGRESS', 'DONE', 'complete', { note: 'it is written' }],
  ],
  CANCELED: [['DRAFT', 'CANCELED', 'cancel', { reason: 'it was the wrong idea' }]],
};

/** Writes one task into `bench`, moved into `state` by the path above. */
function taskIn(state: TaskState, id: string): string {
  birthTask(bench, id, `a task in ${state}`);
  for (const [from, to, action, fields] of REACHED_BY[state]) {
    moveTask(bench, id, from, to, action, fields);
  }
  return id;
}

/** Which of the two lists a task with `id` is on, over the record as it stands. */
function listsHolding(id: string): string[] {
  const cache = bench.cache();
  try {
    const on: string[] = [];
    if (liveWork([cache]).some((item) => item.id === id)) on.push('work');
    if (tasksAwaitingJudgement([cache]).some((item) => item.id === id)) on.push('awaiting');
    return on;
  } finally {
    cache.close();
  }
}

describe('liveWork — the tasks there is still something to do about', () => {
  it('a DONE task is not live work, though `reopen` stays legal from it forever', () => {
    // THE DEFECT, from the report that opened this slice: a person ran the opening
    // read on a terminal and one of the "actionable" tasks said `(DONE)`. The old
    // rule was "has at least one legal next move", `reopen` leaves `DONE` and nothing
    // makes it happen, so a completed task was live work for good.
    bench = makeBench();
    const shipped = taskIn('DONE', 'task-done');
    const going = taskIn('READY', 'task-live');
    // The premise is REAL and not assumed: the move this task's membership used to
    // rest on is still in the workflow, and this reads it from the table.
    expect(TRANSITIONS.filter((t) => t.from === 'DONE').map((t) => t.action)).toEqual(['reopen']);
    expect(listsHolding(shipped)).toEqual([]);
    // And the record REACHES the other side, or the absence above is about an empty
    // list rather than about the filter.
    expect(listsHolding(going)).toEqual(['work']);
  });

  it('a CANCELED task is not live work either — the other terminal position', () => {
    bench = makeBench();
    const dropped = taskIn('CANCELED', 'task-canceled');
    const going = taskIn('DRAFT', 'task-live');
    expect(listsHolding(dropped)).toEqual([]);
    expect(listsHolding(going)).toEqual(['work']);
  });

  it('a BLOCKED task IS live work — stalled is exactly what somebody has to see', () => {
    // The half a filter written as "what is not finished" would get wrong in the
    // other direction. `BLOCKED` has ONE exit and it undoes the position, so nothing
    // can be progressed from it — which is the reason it belongs on the list, not a
    // reason to drop it.
    bench = makeBench();
    const stuck = taskIn('BLOCKED', 'task-blocked');
    expect(taskDisposition('BLOCKED')).toBe('stalled');
    expect(listsHolding(stuck)).toEqual(['work']);
  });

  it('names the task and nothing else — the moves are a second read', () => {
    bench = makeBench();
    const id = taskIn('IN_PROGRESS', 'task-1');
    const cache = bench.cache();
    try {
      const [item] = liveWork([cache]);
      expect(item).toEqual({
        id,
        title: 'a task in IN_PROGRESS',
        state: 'IN_PROGRESS',
        updatedAt: expect.any(String),
      });
    } finally {
      cache.close();
    }
  });

  it('reads across the trees the caller can see, not one of them', () => {
    bench = makeBench();
    const other = makeBench();
    try {
      taskIn('READY', 'task-mine');
      const home = bench;
      bench = other;
      taskIn('READY', 'task-theirs');
      bench = home;
      const mine = bench.cache();
      const theirs = other.cache();
      try {
        expect(
          liveWork([mine, theirs])
            .map((item) => item.id)
            .sort(),
        ).toEqual(['task-mine', 'task-theirs']);
      } finally {
        mine.close();
        theirs.close();
      }
    } finally {
      rmSync(other.root, { recursive: true, force: true });
    }
  });
});

describe('tasksAwaitingJudgement — the work somebody owes a verdict on', () => {
  it('a task IN_REVIEW awaits a judgement, and is not live work', () => {
    // The second half of the same defect, from the other side: `core` classified
    // `IN_REVIEW` as `awaiting-judgement` and the waiting list asked two machines out
    // of three, so a task submitted for review was one more job to pick up and on
    // nobody's list of what they owed a ruling on.
    bench = makeBench();
    const submitted = taskIn('IN_REVIEW', 'task-review');
    expect(taskDisposition('IN_REVIEW')).toBe('awaiting-judgement');
    expect(listsHolding(submitted)).toEqual(['awaiting']);
  });

  it('carries the `kind` that says which second read serves the rest', () => {
    bench = makeBench();
    const id = taskIn('IN_REVIEW', 'task-review');
    const cache = bench.cache();
    try {
      expect(tasksAwaitingJudgement([cache])).toEqual([
        {
          kind: 'task',
          id,
          title: 'a task in IN_REVIEW',
          state: 'IN_REVIEW',
          updatedAt: expect.any(String),
        },
      ]);
    } finally {
      cache.close();
    }
  });

  it('empties: every way out of IN_REVIEW leaves the waiting side', () => {
    // The trap the waiting list exists to avoid, read off the transition table rather
    // than from intent — the same property `disposition.test.ts` proves for the other
    // two machines. A state classified as waiting whose every exit was also waiting
    // would grow a list nobody could clear.
    const out = TRANSITIONS.filter((t) => t.from === 'IN_REVIEW');
    expect(out.map((t) => t.action).sort()).toEqual(['approve', 'request_changes']);
    for (const move of out) expect(taskDisposition(move.to)).not.toBe('awaiting-judgement');
  });
});

describe('one rule for both lists: the classification decides, and nothing else', () => {
  it('puts every state of the machine where `taskDisposition` says, and on ONE list', () => {
    // The whole machine, over a record that REACHES each of its states through the
    // workflow's own moves — a fixture that could not produce a state would make the
    // measurement of its absence meaningless. What each state is compared against is
    // computed from the classification, never from a list typed here.
    bench = makeBench();
    const ids = new Map(TASK_STATES.map((state) => [state, taskIn(state, `task-${state}`)]));
    const landed: Record<string, string[]> = {};
    for (const [state, id] of ids) landed[state] = listsHolding(id);
    const expected = Object.fromEntries(
      TASK_STATES.map((state) => {
        const meaning = taskDisposition(state);
        if (meaning === 'advancing' || meaning === 'stalled') return [state, ['work']];
        if (meaning === 'awaiting-judgement') return [state, ['awaiting']];
        return [state, []];
      }),
    );
    expect(landed).toEqual(expected);
    // NON-VACUITY, in the one shape that can go wrong here: the fixture reaches every
    // state, and the answer is not the same for all of them. Both lists have items and
    // some state is on neither, so an implementation that answered one way for
    // everything could not pass.
    expect(Object.keys(landed).sort()).toEqual([...TASK_STATES].sort());
    expect(new Set(Object.values(landed).map((on) => on.join('+')))).toEqual(
      new Set(['work', 'awaiting', '']),
    );
  });

  it('walks the workflow to reach them — no fixture writes a move the machine lacks', () => {
    // A13, on the table above: every step of every path is a row of `TRANSITIONS`, so
    // the record under the case is one the product can actually produce. The bench's
    // writer does not gate, which is exactly why this is asserted rather than assumed.
    for (const [state, path] of Object.entries(REACHED_BY)) {
      for (const [from, to, action] of path) {
        const row = TRANSITIONS.find((t) => t.from === from && t.action === action);
        expect(row, `${state}: ${from} --${action}-->`).toBeDefined();
        expect(row?.to, `${state}: ${from} --${action}--> ${to}`).toBe(to);
      }
    }
    // And each path really arrives where it says: the last step's `to`, or the birth
    // state when there is no step.
    for (const state of TASK_STATES) {
      const path = REACHED_BY[state];
      expect(path[path.length - 1]?.[1] ?? 'DRAFT', state).toBe(state);
    }
  });

  it('keeps no set of states of its own — the module names none', () => {
    // The guard the two cases above cannot be: a module that copied the
    // classification into its own set would agree with them exactly, until somebody
    // amended one copy. This bans the copy instead of comparing against it.
    const source = codeOf('./tasks.ts');
    const found = TASK_STATES.filter((state) => source.includes(state));
    expect(found, 'a task state is written into the code of tasks.ts').toEqual([]);
    // What the module DOES name is the classification's own words, or it is asking
    // nothing and this ban is satisfied by a module that does not work.
    expect(source).toContain('taskDisposition');
    for (const word of ['advancing', 'stalled', 'awaiting-judgement']) {
      expect(source, `tasks.ts asks for ${word}`).toContain(word);
    }
  });

  it('accuses a copied set — the scan above on input of its own', () => {
    // The instrument's teeth, and the comment stripper's. With the tree honest the
    // case above says only "nothing was found", which is what a broken scan says too.
    expect(withoutComments("const LIVE = ['DRAFT', 'READY'];")).toContain('DRAFT');
    // Prose naming a state is not a set, which is the whole reason the comments go:
    // the module doc reads the machine state by state and must be able to.
    expect(withoutComments('/** DRAFT is advancing. */ const A = 1;')).not.toContain('DRAFT');
    expect(withoutComments('// DONE is settled\nconst B = 2;')).not.toContain('DONE');
  });
});

/** A module's source with its comments blanked, read from this directory. */
function codeOf(relative: string): string {
  return withoutComments(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8'));
}

/**
 * The source with block and line comments removed.
 *
 * Regex-simple on purpose, and safe for what it is asked about: the modules scanned
 * here hold no string containing a comment opener. It is exercised on input of its own
 * above, because a stripper that removed everything would make the ban above pass over
 * an empty file.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}
