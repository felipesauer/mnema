import { type CatalogEvent, memoryCaptured, taskBirth } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { projectKnowledge } from './knowledge.js';
import { projectTasks } from './task.js';

const at = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
const env = (subject: string, n: number, who = 'mnid:aa') => ({
  at: at(n),
  who,
  signerFp: 'fp-1',
  subject,
});

describe('projectKnowledge — the existence-only rule', () => {
  it('projects a memory from its SINGLE event — existence is the whole of it', () => {
    const events = [memoryCaptured(env('m-1', 0), { content: 'the dist must be fresh' })];
    const memories = projectKnowledge(events);
    expect(memories.get('m-1')).toEqual({
      id: 'm-1',
      content: 'the dist must be fresh',
      who: 'mnid:aa',
      capturedAt: at(0),
    });
  });

  it('CONTRASTS with the task gate: one event that a task projection would DROP is a whole memory', () => {
    // A lone `task.created` is a truncated tail and the task projection drops it
    // (state without a transition is not a task). A memory is a point-in-time
    // fact: the lone event IS the fact. The very shape the task rule rejects, the
    // memory rule accepts — that difference is the point of a separate projection.
    const lone = memoryCaptured(env('m-1', 0), { content: 'a lone fact' });
    expect(projectKnowledge([lone]).has('m-1')).toBe(true);
  });

  it('attributes each memory to its capturing `who`', () => {
    const events = [
      memoryCaptured(env('m-ana', 0, 'mnid:ana'), { content: 'ana knows this' }),
      memoryCaptured(env('m-bru', 1, 'mnid:bru'), { content: 'bruno knows that' }),
    ];
    const memories = projectKnowledge(events);
    expect(memories.get('m-ana')?.who).toBe('mnid:ana');
    expect(memories.get('m-bru')?.who).toBe('mnid:bru');
  });

  it('keeps ONLY knowledge kinds — a task in the same stream is another domain', () => {
    // Memories and tasks share one tail; the projection separates them by kind.
    // A task event must not leak into the knowledge view.
    const events: CatalogEvent[] = [
      ...taskBirth(env('t-1', 0), { title: 'work', initial: 'draft' }),
      memoryCaptured(env('m-1', 1), { content: 'knowledge' }),
    ];
    const memories = projectKnowledge(events);
    expect(memories.size).toBe(1);
    expect(memories.has('m-1')).toBe(true);
    expect(memories.has('t-1')).toBe(false);
    // And the task projection is symmetric: it does not see the memory.
    expect(projectTasks(events).has('m-1')).toBe(false);
  });

  it('is idempotent: the same ordered events always fold to the same result', () => {
    const events = [
      memoryCaptured(env('m-1', 0), { content: 'one' }),
      memoryCaptured(env('m-2', 1), { content: 'two' }),
    ];
    expect(projectKnowledge(events)).toEqual(projectKnowledge(events));
  });

  it('projects independent memories independently', () => {
    const events = [
      memoryCaptured(env('m-1', 0), { content: 'first' }),
      memoryCaptured(env('m-2', 1), { content: 'second' }),
    ];
    const memories = projectKnowledge(events);
    expect(memories.size).toBe(2);
    expect(memories.get('m-1')?.content).toBe('first');
    expect(memories.get('m-2')?.content).toBe('second');
  });
});
