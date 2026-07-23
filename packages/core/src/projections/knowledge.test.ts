import {
  type CatalogEvent,
  handoffRecorded,
  knowledgeLinked,
  memoryCaptured,
  observationRecorded,
  taskBirth,
} from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import {
  projectHandoffs,
  projectKnowledge,
  projectLinks,
  projectObservations,
} from './knowledge.js';
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

describe('projectObservations — a note about an entity, keyed by its OWN id', () => {
  it('projects an observation from its single event', () => {
    const events = [
      observationRecorded(env('o-1', 0, 'mnid:ana'), {
        about: 't-1',
        topic: 'flakiness',
        text: 'this test retries on CI',
      }),
    ];
    expect(projectObservations(events).get('o-1')).toEqual({
      id: 'o-1',
      about: 't-1',
      topic: 'flakiness',
      text: 'this test retries on CI',
      who: 'mnid:ana',
      recordedAt: at(0),
    });
  });

  it('two observations about the SAME entity do not collide — distinct own ids', () => {
    // The whole reason an observation mints its own id: were the subject the
    // observed entity, these two would fold onto one key and the first would be
    // lost. Keyed by their own ids, both survive; the shared entity is in `about`.
    const events = [
      observationRecorded(env('o-1', 0), { about: 't-1', topic: 'a', text: 'first note' }),
      observationRecorded(env('o-2', 1), { about: 't-1', topic: 'b', text: 'second note' }),
    ];
    const obs = projectObservations(events);
    expect(obs.size).toBe(2);
    expect(obs.get('o-1')?.text).toBe('first note');
    expect(obs.get('o-2')?.text).toBe('second note');
    // Both point at the same observed entity.
    expect([...obs.values()].every((o) => o.about === 't-1')).toBe(true);
  });

  it('keeps ONLY observation events — memories and tasks are other domains', () => {
    const events: CatalogEvent[] = [
      memoryCaptured(env('m-1', 0), { content: 'a memory' }),
      observationRecorded(env('o-1', 1), { about: 'm-1', topic: 't', text: 'about the memory' }),
    ];
    expect(projectObservations(events).size).toBe(1);
    expect(projectKnowledge(events).has('o-1')).toBe(false);
  });
});

describe('projectHandoffs — a list per task, never last-write', () => {
  it('accumulates multiple handoffs on one task in order', () => {
    const events = [
      handoffRecorded(env('t-1', 0), { fromAgent: 'claude', toAgent: 'felipe' }),
      handoffRecorded(env('t-1', 1), { fromAgent: 'felipe', toAgent: 'claude' }),
    ];
    const list = projectHandoffs(events).get('t-1');
    expect(list).toHaveLength(2);
    expect(list?.[0]?.fromAgent).toBe('claude');
    expect(list?.[1]?.fromAgent).toBe('felipe');
  });

  it('a chat restart (fromAgent == toAgent) is a legitimate handoff', () => {
    const events = [handoffRecorded(env('t-1', 0), { fromAgent: 'claude', toAgent: 'claude' })];
    const list = projectHandoffs(events).get('t-1');
    expect(list).toHaveLength(1);
    expect(list?.[0]?.fromAgent).toBe(list?.[0]?.toAgent);
  });

  it('keeps handoffs on different tasks separate', () => {
    const events = [
      handoffRecorded(env('t-1', 0), { fromAgent: 'a', toAgent: 'b' }),
      handoffRecorded(env('t-2', 1), { fromAgent: 'c', toAgent: 'd' }),
    ];
    const handoffs = projectHandoffs(events);
    expect(handoffs.get('t-1')).toHaveLength(1);
    expect(handoffs.get('t-2')).toHaveLength(1);
  });
});

describe('projectLinks — the N:N relational edge set, both directions', () => {
  it('projects a link as a directed edge answerable from either side', () => {
    const events = [
      knowledgeLinked(env('m-1', 0, 'mnid:ana'), { target: 't-1', rel: 'relates-to' }),
    ];
    const edges = projectLinks(events);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({
      subject: 'm-1',
      target: 't-1',
      rel: 'relates-to',
      who: 'mnid:ana',
      linkedAt: at(0),
    });
    // Reachable from the subject side (links out) and the target side (links in).
    expect(edges.filter((e) => e.subject === 'm-1')).toHaveLength(1);
    expect(edges.filter((e) => e.target === 't-1')).toHaveLength(1);
  });

  it('an UNKNOWN relation label does not break the fold', () => {
    // `rel` is open: a label outside the recommended set is kept verbatim.
    const events = [knowledgeLinked(env('m-1', 0), { target: 'd-1', rel: 'inspired-by' })];
    expect(projectLinks(events)[0]?.rel).toBe('inspired-by');
  });

  it('collapses a duplicate edge — the relation is idempotent', () => {
    // The same (subject, target, rel) asserted twice (e.g. two offline clones)
    // folds to ONE edge, keeping the first-seen envelope, so the union never
    // double-counts it.
    const events = [
      knowledgeLinked(env('m-1', 0, 'mnid:ana'), { target: 't-1', rel: 'relates-to' }),
      knowledgeLinked(env('m-1', 1, 'mnid:bru'), { target: 't-1', rel: 'relates-to' }),
    ];
    const edges = projectLinks(events);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.who).toBe('mnid:ana'); // first-seen origin.
  });

  it('keeps distinct edges: same pair, different relation', () => {
    const events = [
      knowledgeLinked(env('m-1', 0), { target: 't-1', rel: 'relates-to' }),
      knowledgeLinked(env('m-1', 1), { target: 't-1', rel: 'derived-from' }),
    ];
    expect(projectLinks(events)).toHaveLength(2);
  });

  it('keeps a dangling edge verbatim — the target need not be present', () => {
    // No entity for `t-absent` is in this stream, yet the edge stands: a
    // cross-tree link is an asserted fact resolved on read, never dropped here.
    const events = [knowledgeLinked(env('m-1', 0), { target: 't-absent', rel: 'relates-to' })];
    expect(projectLinks(events)[0]?.target).toBe('t-absent');
  });

  it('multiple links from ONE subject all project', () => {
    const events = [
      knowledgeLinked(env('m-1', 0), { target: 't-1', rel: 'relates-to' }),
      knowledgeLinked(env('m-1', 1), { target: 't-2', rel: 'relates-to' }),
      knowledgeLinked(env('m-1', 2), { target: 'd-1', rel: 'derived-from' }),
    ];
    expect(projectLinks(events).filter((e) => e.subject === 'm-1')).toHaveLength(3);
  });
});
