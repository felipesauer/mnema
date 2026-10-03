/**
 * The shape every entity fold has — and the property it exists for: stepping the arrivals over a
 * stored accumulator is the same as folding the whole stream.
 *
 * `advance.test.ts` proves it for one event of every kind, over every table. This is the property
 * on its own, over the four folds and a stream the one-event cases cannot make: an entity whose
 * transition arrives BEFORE its birth (two tails, one entity), which is the case where the
 * accumulator is not yet a projection and has to be kept.
 */

import type { CatalogEvent } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { accumulate, jsonEncoding } from './accumulate.js';
import { decisionFold } from './decision.js';
import { runFold } from './run.js';
import { skillFold } from './skill.js';
import { taskFold } from './task.js';

const env = (subject: string, at: string) => ({
  at,
  who: 'mnid:abc',
  signerFp: 'f'.repeat(64),
  subject,
});

const created = (id: string, at: string): CatalogEvent =>
  ({
    kind: 'task.created',
    version: 1,
    ...env(id, at),
    payload: { title: `task ${id}` },
  }) as CatalogEvent;

const moved = (id: string, at: string, to: string): CatalogEvent =>
  ({
    kind: 'task.transitioned',
    version: 1,
    ...env(id, at),
    payload: { from: null, to, action: 'birth' },
  }) as CatalogEvent;

describe('an entity fold', () => {
  it('does not project an entity until it has what it needs, and keeps what it has', () => {
    const { accumulators, projections } = accumulate(taskFold, [
      moved('a', '2026-01-01T00:00:01.000Z', 'DRAFT'),
    ]);
    expect(projections.size, 'a transition with no birth is not a task').toBe(0);
    expect(accumulators.get('a')).toEqual({
      state: 'DRAFT',
      updatedAt: '2026-01-01T00:00:01.000Z',
    });
  });

  it('stepping the arrivals over a stored accumulator is folding the whole stream', () => {
    // The transition comes FIRST in the order, the birth after it — an entity two tails wrote.
    const all = [
      moved('a', '2026-01-01T00:00:01.000Z', 'DRAFT'),
      created('a', '2026-01-01T00:00:02.000Z'),
      moved('a', '2026-01-01T00:00:03.000Z', 'READY'),
    ];
    const whole = accumulate(taskFold, all);

    const before = accumulate(taskFold, all.slice(0, 1));
    const stored = taskFold.encode(before.accumulators.get('a') ?? taskFold.create());
    const acc = taskFold.decode(stored);
    for (const event of all.slice(1)) taskFold.step(() => acc, event);

    expect(acc).toEqual(whole.accumulators.get('a'));
    expect(taskFold.finish('a', acc)).toEqual(whole.projections.get('a'));
    expect(whole.projections.get('a')?.state).toBe('READY');
  });
});

describe('what an accumulator is stored as', () => {
  it('round-trips as JSON for the folds whose accumulator is plain data', () => {
    for (const fold of [taskFold, decisionFold, skillFold]) {
      const acc = fold.create();
      expect(fold.decode(fold.encode(acc))).toEqual(acc);
    }
    const encoding = jsonEncoding<{ n: number }>();
    expect(encoding.decode(encoding.encode({ n: 3 }))).toEqual({ n: 3 });
  });

  it('keeps a run’s tally in the order it was counted, which JSON does not carry for a Map', () => {
    const acc = runFold.create();
    acc.agent = 'an-agent';
    acc.wrote.set('task.created', 2);
    acc.wrote.set('memory.captured', 1);
    const back = runFold.decode(runFold.encode(acc));
    expect([...back.wrote]).toEqual([
      ['task.created', 2],
      ['memory.captured', 1],
    ]);
    expect(back.agent).toBe('an-agent');
  });
});
