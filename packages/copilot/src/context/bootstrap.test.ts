import { rmSync } from 'node:fs';
import { SEARCH_DEFAULT_LIMIT } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asking,
  type Bench,
  birthDecision,
  birthSkill,
  birthTask,
  deprecateSkill,
  makeBench,
  moveDecision,
  moveSkill,
  moveTask,
  moveTaskAt,
  startRun,
  supersedeDecision,
} from '../../tests/support/chain.js';
import { bootstrap } from './bootstrap.js';
import { nextActionsForTask } from './next-action.js';

describe('bootstrap — the opening context, focused on the actor', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('composes the actor’s resume and the live work, NAMED', () => {
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
      if (item === undefined) throw new Error('the live task is missing');
      // Absence, because a present-but-empty `actions` would be a second claim:
      // that this task allows nothing, which is the opposite of why it is here.
      expect(item).not.toHaveProperty('actions');
      expect(Object.keys(item).sort()).toEqual(['id', 'state', 'title', 'updatedAt']);
      // And no count of them took their place: the state on the line is what says
      // which moves exist, and `nextActions` is what answers it exactly.
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
    //
    // AND THE DIRECTION IT KEPT WAS THE WRONG ONE. It read the lowest ids as the
    // winners and called that content. The ids here ascend with creation, so on this
    // fixture "lowest id" and "oldest" are the same thing — which is how a
    // newest-first list came to cut the NEWEST items and look reasonable doing it.
    // The rule is `newestFirst` now: highest id wins the tie, and the cut falls on
    // the oldest of the instant.
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
      // The highest ids win the tie, whichever tree they came from and whichever
      // order the trees were passed in.
      const kept = Array.from({ length: SEARCH_DEFAULT_LIMIT }, (_, i) => idOf(wanted - 1 - i));
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
      expect(Object.keys(b).sort()).toEqual([
        'awaitingJudgement',
        'awaitingJudgementTotal',
        'decisions',
        'decisionsTotal',
        'resume',
        'skills',
        'work',
        'workTotal',
      ]);
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
      if (named === undefined) throw new Error('the live task is missing');
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

  it('omits a task that is OVER — canceled and completed are both off the work list', () => {
    // This case used to be about `CANCELED` alone, and its title said why: it "has no
    // next move". That was the old criterion, and `DONE` passed it — `reopen` is legal
    // from there forever — so a completed task sat on the work list for good. Both
    // sides are asserted here now, over a record that reaches both.
    bench = makeBench();
    const live = birthTask(bench, 'task-live', 'Still going');
    moveTask(bench, live, 'DRAFT', 'READY', 'submit');
    const dead = birthTask(bench, 'task-dead', 'Abandoned');
    moveTask(bench, dead, 'DRAFT', 'CANCELED', 'cancel', { reason: 'dropped' });
    const shipped = birthTask(bench, 'task-done', 'Shipped');
    moveTask(bench, shipped, 'DRAFT', 'READY', 'submit');
    moveTask(bench, shipped, 'READY', 'IN_PROGRESS', 'start');
    moveTask(bench, shipped, 'IN_PROGRESS', 'DONE', 'complete', { note: 'done' });
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.work.map((w) => w.id)).toEqual(['task-live']);
      expect(b.workTotal).toBe(1);
      // And neither of them went to the OTHER list on the way out: what is over is on
      // no list at all, which is the sixth cell left deliberately empty.
      expect(b.awaitingJudgement).toEqual([]);
    } finally {
      cache.close();
    }
  });

  it('moves a task IN_REVIEW off the work list and onto what awaits a judgement', () => {
    // The second half of the same rule, and the one that ADDS rather than removes: a
    // task whose every exit is a verdict is not one more job to pick up. It is on
    // exactly one list, and the case asserts both halves so a copy that put it on both
    // would fail here rather than read as thoroughness.
    bench = makeBench();
    const t = birthTask(bench, 'task-review', 'Waiting on a reviewer');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    moveTask(bench, t, 'READY', 'IN_PROGRESS', 'start');
    moveTask(bench, t, 'IN_PROGRESS', 'IN_REVIEW', 'submit_review');
    const going = birthTask(bench, 'task-live', 'Still going');
    moveTask(bench, going, 'DRAFT', 'READY', 'submit');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.work.map((w) => w.id)).toEqual(['task-live']);
      expect(b.awaitingJudgement).toEqual([
        {
          kind: 'task',
          id: 'task-review',
          title: 'Waiting on a reviewer',
          state: 'IN_REVIEW',
          updatedAt: expect.any(String),
        },
      ]);
    } finally {
      cache.close();
    }
  });

  it('keeps a BLOCKED task on the work list — stalled is what somebody has to see', () => {
    bench = makeBench();
    const t = birthTask(bench, 'task-stuck', 'Waiting on the API');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    moveTask(bench, t, 'READY', 'IN_PROGRESS', 'start');
    moveTask(bench, t, 'IN_PROGRESS', 'BLOCKED', 'block', { reason: 'the API is down' });
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.work.map((w) => ({ id: w.id, state: w.state }))).toEqual([
        { id: 'task-stuck', state: 'BLOCKED' },
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

  it('announces the decisions in force by TITLE, ADR and id — never the rationale', () => {
    bench = makeBench();
    birthDecision(bench, 'dec-1', 'Hand-rolled arithmetic');
    moveDecision(bench, 'dec-1', 'proposed', 'accepted', 'accept');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.decisions).toEqual([
        { id: 'dec-1', adr: 'ADR-dec-1', title: 'Hand-rolled arithmetic' },
      ]);
      // Neither half of the body enters the opening context. The fixture writes
      // `why <title>` as the rationale and `turned down for <title>` as the
      // alternatives, so these are that record's actual prose — and the `toEqual`
      // above is total, so a new key would fail it as well.
      expect(JSON.stringify(b)).not.toContain('why Hand-rolled arithmetic');
      expect(JSON.stringify(b)).not.toContain('turned down for Hand-rolled arithmetic');
    } finally {
      cache.close();
    }
  });

  it('announces only the decisions IN FORCE (a proposal does not govern)', () => {
    bench = makeBench();
    birthDecision(bench, 'dec-live', 'In force');
    moveDecision(bench, 'dec-live', 'proposed', 'accepted', 'accept');
    birthDecision(bench, 'dec-idea', 'Still on the table');
    birthDecision(bench, 'dec-old', 'Replaced');
    moveDecision(bench, 'dec-old', 'proposed', 'accepted', 'accept');
    supersedeDecision(bench, 'dec-old', 'dec-live');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.decisions.map((d) => d.id)).toEqual(['dec-live']);
    } finally {
      cache.close();
    }
  });

  it('answers about a record whose ONLY content is decisions', () => {
    // The defect that started this: over a real record holding two ADRs and nothing
    // else, the opening read answered `work: []`, `skills: []` — an empty answer
    // about a full record, which an agent reads as "nothing has been decided here".
    bench = makeBench();
    for (const [id, title] of [
      ['dec-1', 'Hand-rolled arithmetic'],
      ['dec-2', 'Why the rounding is explicit'],
    ] as const) {
      birthDecision(bench, id, title);
      moveDecision(bench, id, 'proposed', 'accepted', 'accept');
    }
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      // The two halves that were the whole answer are still honestly empty…
      expect({ work: b.work, skills: b.skills }).toEqual({ work: [], skills: [] });
      // …and the read no longer reports an empty record as if it were one.
      expect(b.decisions.map((d) => d.adr)).toEqual(['ADR-dec-2', 'ADR-dec-1']);
      expect(b.decisionsTotal).toBe(2);
    } finally {
      cache.close();
    }
  });

  it('cuts the decisions at the same limit and says how many there were', () => {
    bench = makeBench();
    // One more than the limit, so the cut is what separates the two numbers.
    const wanted = SEARCH_DEFAULT_LIMIT + 3;
    for (let i = 0; i < wanted; i += 1) {
      // Zero-padded, so the ids sort the way the loop wrote them.
      const id = `dec-${String(i).padStart(3, '0')}`;
      birthDecision(bench, id, `D${i}`);
      moveDecision(bench, id, 'proposed', 'accepted', 'accept');
    }
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      // The number is the search's, not a second convention invented for this list.
      expect(SEARCH_DEFAULT_LIMIT).toBe(20);
      // Both halves of the criterion in one assertion: the list is cut AND the answer
      // says how many there were.
      expect({ served: b.decisions.length, decisionsTotal: b.decisionsTotal }).toEqual({
        served: SEARCH_DEFAULT_LIMIT,
        decisionsTotal: wanted,
      });
      // The cut falls on the OLDEST: freshest-first decides what is kept.
      expect(b.decisions[0]?.id).toBe(`dec-${String(wanted - 1).padStart(3, '0')}`);
      expect(b.decisions.map((d) => d.id)).not.toContain('dec-000');
    } finally {
      cache.close();
    }
  });

  it('counts each list, and the totals are not each other’s', () => {
    // One cut function serves every list, so what the call site still owns is which
    // total it hands to which list. Different counts on purpose: with equal ones, a
    // crossed pair would pass. All below the limit, so nothing is cut and the
    // totals are the lists themselves — the non-regression proved BY THE LIST.
    bench = makeBench();
    for (const id of ['task-a', 'task-b']) {
      moveTask(bench, birthTask(bench, id, id), 'DRAFT', 'READY', 'submit');
    }
    for (const id of ['dec-a', 'dec-b', 'dec-c']) {
      birthDecision(bench, id, id);
      moveDecision(bench, id, 'proposed', 'accepted', 'accept');
    }
    for (const id of ['dec-p', 'dec-q', 'dec-r', 'dec-s']) birthDecision(bench, id, id);
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect({
        work: b.work.length,
        workTotal: b.workTotal,
        decisions: b.decisions.length,
        decisionsTotal: b.decisionsTotal,
        awaiting: b.awaitingJudgement.length,
        awaitingTotal: b.awaitingJudgementTotal,
      }).toEqual({
        work: 2,
        workTotal: 2,
        decisions: 3,
        decisionsTotal: 3,
        awaiting: 4,
        awaitingTotal: 4,
      });
      // And the lists did not swap either: each carries its own kind's fields.
      expect(Object.keys(b.work[0] ?? {}).sort()).toEqual(['id', 'state', 'title', 'updatedAt']);
      expect(Object.keys(b.decisions[0] ?? {}).sort()).toEqual(['adr', 'id', 'title']);
      expect(Object.keys(b.awaitingJudgement[0] ?? {}).sort()).toEqual([
        'adr',
        'id',
        'kind',
        'state',
        'title',
        'updatedAt',
      ]);
    } finally {
      cache.close();
    }
  });

  it('lists what awaits a judgement across ALL THREE machines, with the state that says which ruling is missing', () => {
    // The record the measurement was taken over held two ADRs — and BOTH were
    // `proposed`, so the list of what governs said nothing about them either. This
    // is the half that answers for them, and for the curation backlog beside it.
    //
    // It used to reach two machines, and the task arm is the third: `IN_REVIEW` was
    // classified `awaiting-judgement` the whole time and this list did not ask.
    bench = makeBench();
    birthDecision(bench, 'dec-1', 'Nobody has ruled');
    birthSkill(bench, 'sk-new', 'Nobody has looked');
    birthSkill(bench, 'sk-seen', 'Looked at, not adopted');
    moveSkill(bench, 'sk-seen', 'proposed', 'reviewed', 'review');
    const t = birthTask(bench, 'task-review', 'Nobody has reviewed');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    moveTask(bench, t, 'READY', 'IN_PROGRESS', 'start');
    moveTask(bench, t, 'IN_PROGRESS', 'IN_REVIEW', 'submit_review');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      // Freshest-moved first, and the `submit_review` was the last event written.
      expect(b.awaitingJudgement).toEqual([
        {
          kind: 'task',
          id: 'task-review',
          title: 'Nobody has reviewed',
          state: 'IN_REVIEW',
          updatedAt: expect.any(String),
        },
        {
          kind: 'skill',
          id: 'sk-seen',
          name: 'Looked at, not adopted',
          state: 'reviewed',
          updatedAt: expect.any(String),
        },
        {
          kind: 'skill',
          id: 'sk-new',
          name: 'Nobody has looked',
          state: 'proposed',
          updatedAt: expect.any(String),
        },
        {
          kind: 'decision',
          id: 'dec-1',
          adr: 'ADR-dec-1',
          title: 'Nobody has ruled',
          state: 'proposed',
          updatedAt: expect.any(String),
        },
      ]);
      expect(b.awaitingJudgementTotal).toBe(4);
      // ONE list and not three: the kinds interleave by content, so a list built
      // machine by machine would fail on the order above rather than on the members.
      expect(b.awaitingJudgement.map((i) => i.kind)).toEqual([
        'task',
        'skill',
        'skill',
        'decision',
      ]);
      // No body travelled: not the argument, not the pattern — and not the moves,
      // which are the task's.
      expect(JSON.stringify(b)).not.toContain('why Nobody has ruled');
      expect(JSON.stringify(b)).not.toContain('body of Nobody has looked');
      expect(JSON.stringify(b)).not.toMatch(/approve|request_changes/);
    } finally {
      cache.close();
    }
  });

  it('does NOT list what is settled, on any of the three machines', () => {
    // The criterion did not hitch a ride from the work list, and the work list no
    // longer has the ride to give. `DECISION_TRANSITIONS` allows `supersede` from
    // `accepted`, `SKILL_TRANSITIONS` allows `deprecate` from `adopted` and
    // `TRANSITIONS` allows `reopen` from `DONE`, for as long as each exists — so "has
    // at least one legal move", which used to be what put a task in `work`, would
    // report all three as pendencies that never clear. The first two are served by the
    // lists that say what GOVERNS and the third by no list at all, so their absence
    // here is the criterion and not an empty record.
    bench = makeBench();
    birthDecision(bench, 'dec-1', 'Settled');
    moveDecision(bench, 'dec-1', 'proposed', 'accepted', 'accept');
    birthSkill(bench, 'sk-1', 'In use');
    moveSkill(bench, 'sk-1', 'proposed', 'reviewed', 'review');
    moveSkill(bench, 'sk-1', 'reviewed', 'adopted', 'adopt');
    const t = birthTask(bench, 'task-1', 'Shipped');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    moveTask(bench, t, 'READY', 'IN_PROGRESS', 'start');
    moveTask(bench, t, 'IN_PROGRESS', 'DONE', 'complete', { note: 'done' });
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect({ awaiting: b.awaitingJudgement, total: b.awaitingJudgementTotal }).toEqual({
        awaiting: [],
        total: 0,
      });
      expect(b.decisions.map((d) => d.id)).toEqual(['dec-1']);
      expect(b.skills.map((s) => s.id)).toEqual(['sk-1']);
      expect({ work: b.work, workTotal: b.workTotal }).toEqual({ work: [], workTotal: 0 });
    } finally {
      cache.close();
    }
  });

  it('does NOT list what is over: rejected, superseded and deprecated are all absent', () => {
    // The third bucket. Each state is reached by the move that reaches it, so what
    // is being filtered is a record the product can actually produce.
    bench = makeBench();
    birthDecision(bench, 'dec-rejected', 'Refused');
    moveDecision(bench, 'dec-rejected', 'proposed', 'rejected', 'reject');
    birthDecision(bench, 'dec-successor', 'The replacement');
    moveDecision(bench, 'dec-successor', 'proposed', 'accepted', 'accept');
    birthDecision(bench, 'dec-superseded', 'Replaced');
    moveDecision(bench, 'dec-superseded', 'proposed', 'accepted', 'accept');
    supersedeDecision(bench, 'dec-superseded', 'dec-successor');
    birthSkill(bench, 'sk-rejected', 'Turned down');
    moveSkill(bench, 'sk-rejected', 'proposed', 'rejected', 'reject');
    birthSkill(bench, 'sk-deprecated', 'Retired');
    moveSkill(bench, 'sk-deprecated', 'proposed', 'reviewed', 'review');
    moveSkill(bench, 'sk-deprecated', 'reviewed', 'adopted', 'adopt');
    deprecateSkill(bench, 'sk-deprecated');
    // One of each waiting kind, so the list is not empty for want of content.
    birthDecision(bench, 'dec-open', 'Still open');
    birthSkill(bench, 'sk-open', 'Still open');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.awaitingJudgement.map((i) => i.id).sort()).toEqual(['dec-open', 'sk-open']);
    } finally {
      cache.close();
    }
  });

  it('cuts what awaits a judgement at the same limit and says how many there were', () => {
    bench = makeBench();
    // One more than the limit, so the cut is what separates the two numbers — and
    // split across the two machines, so the cut is over the composed list.
    const wanted = SEARCH_DEFAULT_LIMIT + 5;
    for (let i = 0; i < wanted; i += 1) {
      // Zero-padded, so the ids sort the way the loop wrote them.
      const n = String(i).padStart(3, '0');
      if (i % 2 === 0) birthDecision(bench, `dec-${n}`, `D${i}`);
      else birthSkill(bench, `sk-${n}`, `S${i}`);
    }
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      // The number is the search's, not a third convention invented for this list.
      expect(SEARCH_DEFAULT_LIMIT).toBe(20);
      expect({
        served: b.awaitingJudgement.length,
        total: b.awaitingJudgementTotal,
      }).toEqual({ served: SEARCH_DEFAULT_LIMIT, total: wanted });
      // The cut falls on the STALEST, and the freshest is the last item written —
      // whichever machine it came from.
      const last = wanted - 1;
      expect(b.awaitingJudgement[0]?.id).toBe(
        `${last % 2 === 0 ? 'dec' : 'sk'}-${String(last).padStart(3, '0')}`,
      );
      expect(b.awaitingJudgement.map((i) => i.id)).not.toContain('dec-000');
    } finally {
      cache.close();
    }
  });

  it('orders the awaiting list ACROSS the kinds, by content, whatever order the trees come in', () => {
    // One list, not decisions-then-skills. Two things make this discriminate: the
    // freshest item is a SKILL and it sits above a decision, so a list built kind by
    // kind fails; and a decision and a skill share an instant, so the tie-break —
    // which for a cut list decides what is left OUT — is exercised across the two
    // machines and across two trees at once.
    //
    // The tie is built by the clocks rather than by a hand-written instant: each
    // bench starts its own at the same epoch and ticks a second per event, so the
    // Nth event of one tree carries the same stamp as the Nth of the other. No
    // fixture here writes a move the workflow does not define.
    bench = makeBench();
    const other = makeBench();
    try {
      birthDecision(bench, 'dec-tie', 'Nobody has ruled');
      birthSkill(other, 'sk-tie', 'Nobody has looked');
      // Later than both, in the tree that is passed SECOND, and a skill.
      birthSkill(other, 'sk-fresh', 'Looked at, not adopted');
      moveSkill(other, 'sk-fresh', 'proposed', 'reviewed', 'review');
      const mine = bench.cache();
      const theirs = other.cache();
      try {
        const forwards = bootstrap([mine, theirs], asking(bench.who)).awaitingJudgement;
        const backwards = bootstrap([theirs, mine], asking(bench.who)).awaitingJudgement;
        // `sk-tie` above `dec-tie` on the shared instant: the tie-break is by id
        // DESCENDING, so it is also the case that a list built kind by kind — which
        // would put the decision first — cannot produce.
        expect(forwards.map((i) => `${i.kind}:${i.id}`)).toEqual([
          'skill:sk-fresh',
          'skill:sk-tie',
          'decision:dec-tie',
        ]);
        // The tie is REAL — without it the two lines above prove only the sort.
        expect(forwards[1]?.updatedAt).toBe(forwards[2]?.updatedAt);
        // Same content, same bytes, whatever order the caller passes the trees in —
        // an unstable order invalidates the host's cache of a prompt that did not change.
        expect(backwards).toEqual(forwards);
      } finally {
        mine.close();
        theirs.close();
      }
    } finally {
      rmSync(other.root, { recursive: true, force: true });
    }
  });

  it('serves EVERY adopted pattern, uncut and uncounted — the list this limit does not reach', () => {
    // The narrowing the module doc now states, held as a test so the doc cannot go
    // back to generalising. Three of the four lists are cut; this one is not, and
    // it carries no total because there is nothing a total would report.
    bench = makeBench();
    const wanted = SEARCH_DEFAULT_LIMIT + 4;
    for (let i = 0; i < wanted; i += 1) {
      const id = `sk-${String(i).padStart(3, '0')}`;
      birthSkill(bench, id, `S${i}`);
      moveSkill(bench, id, 'proposed', 'reviewed', 'review');
      moveSkill(bench, id, 'reviewed', 'adopted', 'adopt');
    }
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(b.skills).toHaveLength(wanted);
      expect(b).not.toHaveProperty('skillsTotal');
    } finally {
      cache.close();
    }
  });

  it('leaves the other three halves exactly as they were', () => {
    // Non-regression by the LIST of fields, not by intention: the half added here
    // must not have changed the shape of the three that were already served.
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude', goal: 'in flight' });
    moveTask(bench, birthTask(bench, 'task-1', 'Parse tokens'), 'DRAFT', 'READY', 'submit');
    birthSkill(bench, 'sk-1', 'Small PRs', 'adopted');
    birthDecision(bench, 'dec-1', 'In force');
    moveDecision(bench, 'dec-1', 'proposed', 'accepted', 'accept');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      expect(Object.keys(b.work[0] ?? {}).sort()).toEqual(['id', 'state', 'title', 'updatedAt']);
      expect(Object.keys(b.skills[0] ?? {}).sort()).toEqual(['id', 'name']);
      expect(Object.keys(b.resume).sort()).toEqual(['actor', 'focus', 'lastRun']);
      expect(b.resume.lastRun?.id).toBe('run-1');
      expect(b.workTotal).toBe(1);
    } finally {
      cache.close();
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
