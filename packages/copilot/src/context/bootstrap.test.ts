import { rmSync } from 'node:fs';
import { SEARCH_DEFAULT_LIMIT } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asking,
  type Bench,
  birthSkill,
  birthTask,
  makeBench,
  moveTask,
  moveTaskAt,
  startRun,
} from '../../tests/support/chain.js';
import { bootstrap } from './bootstrap.js';
import { nextActionsForTask } from './next-action.js';

describe('bootstrap — the opening context, focused on the actor', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('composes the actor’s resume and the actionable work, NAMED', () => {
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude', goal: 'in flight' });
    const t = birthTask(bench, 'task-1', 'Parse tokens');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    moveTask(bench, t, 'READY', 'IN_PROGRESS', 'start');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      // Resume: the actor's open run is the anchor.
      expect(b.resume.lastRun?.id).toBe('run-1');
      expect(b.resume.focus.openRuns.map((r) => r.id)).toEqual(['run-1']);
      // Work: the live task, as a NAME — the four fields and nothing more.
      expect(b.work).toEqual([
        {
          id: 'task-1',
          title: 'Parse tokens',
          state: 'IN_PROGRESS',
          updatedAt: expect.any(String),
        },
      ]);
    } finally {
      cache.close();
    }
  });

  it('carries no moves on a work item — the ABSENCE of the key, not an empty one', () => {
    bench = makeBench();
    const t = birthTask(bench, 'task-1', 'Parse tokens');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      const item = b.work[0];
      if (item === undefined) throw new Error('the actionable task is missing');
      // Absence, because a present-but-empty `actions` would be a second claim:
      // that this task allows nothing, which is the opposite of why it is here.
      expect(item).not.toHaveProperty('actions');
      expect(Object.keys(item).sort()).toEqual(['id', 'state', 'title', 'updatedAt']);
      // And no count of them took their place: being in this list IS the claim
      // that a move exists.
      expect(JSON.stringify(item)).not.toMatch(/action|move|count/i);
    } finally {
      cache.close();
    }
  });

  it('cuts the work list at the convention’s limit and says how many there were', () => {
    bench = makeBench();
    // One more than the limit, so the cut is what separates the two numbers.
    const wanted = SEARCH_DEFAULT_LIMIT + 7;
    for (let i = 0; i < wanted; i += 1) {
      // Zero-padded, so the ids sort the way the loop wrote them.
      moveTask(
        bench,
        birthTask(bench, `task-${String(i).padStart(3, '0')}`, `T${i}`),
        'DRAFT',
        'READY',
        'submit',
      );
    }
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      // The number is the search's, not a second convention invented here.
      expect(SEARCH_DEFAULT_LIMIT).toBe(20);
      // Both halves of the criterion, in one assertion: the list is cut AND the
      // answer says how many there were. A cut that does not declare itself reads
      // as "this is everything".
      expect({ served: b.work.length, workTotal: b.workTotal }).toEqual({
        served: SEARCH_DEFAULT_LIMIT,
        workTotal: wanted,
      });
      // The cut falls on the STALEST: the freshest-first order decides what is
      // kept, so the last task written is in and the first is out.
      expect(b.work[0]?.id).toBe(`task-${String(wanted - 1).padStart(3, '0')}`);
      expect(b.work.map((w) => w.id)).not.toContain('task-000');
    } finally {
      cache.close();
    }
  });

  it('decides a TIE at the cut by content, not by the order the record was folded', () => {
    // The tie-break was cosmetic before there was a cut — it decided what a reader
    // saw first. It now decides what is left OUT, so which rule breaks the tie is
    // the difference between a stable answer and one that changes when a tree is
    // added to the call.
    //
    // Two things make this discriminate. Every task moves at the SAME instant, so
    // `updatedAt` settles nothing; and the ids are written in DESCENDING order across
    // two trees, so the FOLD order disagrees with the id order. On a fixture where
    // the two agree, a sort with no tie-break at all passes (`Array.sort` is stable),
    // which is exactly the assertion that looks like a test and is not one.
    bench = makeBench();
    const other = makeBench();
    const at = bench.now();
    const wanted = SEARCH_DEFAULT_LIMIT + 4;
    const idOf = (i: number) => `task-${String(i).padStart(3, '0')}`;
    for (let i = wanted - 1; i >= 0; i -= 1) {
      const home = i % 2 === 0 ? bench : other;
      birthTask(home, idOf(i), `T${i}`);
      moveTaskAt(home, idOf(i), at, 'DRAFT', 'READY', 'submit');
    }
    const mine = bench.cache();
    const theirs = other.cache();
    try {
      const first = bootstrap([mine, theirs], asking(bench.who));
      const flipped = bootstrap([theirs, mine], asking(bench.who));
      expect(first.work.map((w) => w.updatedAt)).toEqual(Array(SEARCH_DEFAULT_LIMIT).fill(at));
      // The lowest ids win the tie, whichever tree they came from and whichever
      // order the trees were passed in.
      const kept = Array.from({ length: SEARCH_DEFAULT_LIMIT }, (_, i) => idOf(i));
      expect(first.work.map((w) => w.id)).toEqual(kept);
      expect(flipped.work.map((w) => w.id)).toEqual(kept);
      // And the answer still declares the cut, over the union of both trees.
      expect(first.workTotal).toBe(wanted);
    } finally {
      mine.close();
      theirs.close();
      rmSync(other.root, { recursive: true, force: true });
    }
  });

  it('serves every item, and no new field, below the limit', () => {
    bench = makeBench();
    const wanted = SEARCH_DEFAULT_LIMIT - 1;
    for (let i = 0; i < wanted; i += 1) {
      moveTask(
        bench,
        birthTask(bench, `task-${String(i).padStart(3, '0')}`, `T${i}`),
        'DRAFT',
        'READY',
        'submit',
      );
    }
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      // Non-regression proved BY THE LIST: every task is there, and `workTotal`
      // agrees with it — nothing was hidden and nothing says it was.
      expect(b.work).toHaveLength(wanted);
      expect(b.workTotal).toBe(wanted);
      expect(b.work.every((w) => Object.keys(w).length === 4)).toBe(true);
      // The whole answer's shape, so a field added to any half fails here.
      expect(Object.keys(b).sort()).toEqual(['resume', 'skills', 'work', 'workTotal']);
    } finally {
      cache.close();
    }
  });

  it('answers what left the work list through the other door, with the proof fields', () => {
    bench = makeBench();
    const t = birthTask(bench, 'task-1', 'Parse tokens');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    moveTask(bench, t, 'READY', 'IN_PROGRESS', 'start');
    const cache = bench.cache();
    try {
      const named = bootstrap([cache], asking(bench.who)).work[0];
      if (named === undefined) throw new Error('the actionable task is missing');
      expect(named.id).toBe('task-1');
      // The information MOVED doors; it did not disappear. Asked per task, the
      // moves come back whole — every action, and the proof each one demands.
      const moves = nextActionsForTask(cache, named.id);
      expect(new Set(moves?.map((a) => a.action))).toEqual(
        new Set(['block', 'submit_review', 'complete', 'cancel']),
      );
      expect(moves?.find((a) => a.action === 'complete')).toEqual({
        action: 'complete',
        to: 'DONE',
        requires: ['note'],
      });
    } finally {
      cache.close();
    }
  });

  it('omits a terminal task (CANCELED has no next move) from the work list', () => {
    bench = makeBench();
    const live = birthTask(bench, 'task-live', 'Still going');
    moveTask(bench, live, 'DRAFT', 'READY', 'submit');
    const dead = birthTask(bench, 'task-dead', 'Abandoned');
    moveTask(bench, dead, 'DRAFT', 'CANCELED', 'cancel', { reason: 'dropped' });
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.work.map((w) => w.id)).toEqual(['task-live']);
    } finally {
      cache.close();
    }
  });

  it('keeps a DONE task in the work list, because it can still be reopened', () => {
    bench = makeBench();
    const t = birthTask(bench, 'task-done', 'Shipped');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    moveTask(bench, t, 'READY', 'IN_PROGRESS', 'start');
    moveTask(bench, t, 'IN_PROGRESS', 'DONE', 'complete', { note: 'done' });
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      // This test used to read the item's `reopen` action to prove DONE is not
      // terminal. The moves left the item, so the substitute is MEMBERSHIP plus
      // the state it was admitted in — the list's own definition (a legal move
      // exists) is what being here means now.
      expect(b.work.map((w) => ({ id: w.id, state: w.state }))).toEqual([
        { id: 'task-done', state: 'DONE' },
      ]);
    } finally {
      cache.close();
    }
  });

  it('orders the work most recently touched first', () => {
    bench = makeBench();
    const a = birthTask(bench, 'task-a', 'A');
    const b = birthTask(bench, 'task-b', 'B');
    // Touch A last, so it is the freshest.
    moveTask(bench, b, 'DRAFT', 'READY', 'submit');
    moveTask(bench, a, 'DRAFT', 'READY', 'submit');
    const cache = bench.cache();
    try {
      const boot = bootstrap([cache], asking(bench.who));
      expect(boot.work.map((w) => w.id)).toEqual(['task-a', 'task-b']);
    } finally {
      cache.close();
    }
  });

  it('stays lean on the actor’s side: another actor’s run never enters the resume', () => {
    bench = makeBench();
    startRun(bench, 'run-mine', { agent: 'claude', who: 'alice' });
    startRun(bench, 'run-theirs', { agent: 'claude', who: 'bob' });
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking('alice'));
      expect(b.resume.focus.openRuns.map((r) => r.id)).toEqual(['run-mine']);
      expect(b.resume.lastRun?.id).toBe('run-mine');
    } finally {
      cache.close();
    }
  });

  it('announces the adopted skills by NAME and id — never the body', () => {
    bench = makeBench();
    birthSkill(bench, 'sk-1', 'Small PRs', 'adopted');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.skills).toEqual([{ id: 'sk-1', name: 'Small PRs' }]);
      // The pattern itself never enters the opening context.
      expect(JSON.stringify(b)).not.toContain('body of Small PRs');
    } finally {
      cache.close();
    }
  });

  it('announces only the ADOPTED patterns (a proposal is not a way of working)', () => {
    bench = makeBench();
    birthSkill(bench, 'sk-live', 'Adopted', 'adopted');
    birthSkill(bench, 'sk-idea', 'Proposed', 'proposed');
    birthSkill(bench, 'sk-old', 'Deprecated', 'deprecated');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.skills.map((s) => s.id)).toEqual(['sk-live']);
    } finally {
      cache.close();
    }
  });

  it('takes the skills from the caches it is given, not from the actor’s tree alone', () => {
    bench = makeBench();
    const team = makeBench();
    try {
      birthSkill(bench, 'sk-mine', 'Mine', 'adopted');
      birthSkill(team, 'sk-team', 'Team', 'adopted');
      const mineCache = bench.cache();
      const teamCache = team.cache();
      try {
        // The actor's world is one tree; the patterns come from both.
        const b = bootstrap([mineCache, teamCache], asking(bench.who));
        expect(b.skills.map((s) => s.name)).toEqual(['Mine', 'Team']);
      } finally {
        mineCache.close();
        teamCache.close();
      }
    } finally {
      rmSync(team.root, { recursive: true, force: true });
    }
  });

  it('gives an actor with no runs an empty resume but the shared work list', () => {
    bench = makeBench();
    startRun(bench, 'run-other', { agent: 'claude', who: 'someone' });
    const t = birthTask(bench, 'task-1', 'Work exists');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking('newcomer'));
      expect(b.resume.lastRun).toBeNull();
      expect(b.resume.focus.openRuns).toEqual([]);
      // The work list is workspace-wide, so it is still there.
      expect(b.work.map((w) => w.id)).toEqual(['task-1']);
    } finally {
      cache.close();
    }
  });
});
