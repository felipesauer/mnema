import { rmSync } from 'node:fs';
import type { ProjectionCache } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthTask,
  handoff,
  makeBench,
  moveTask,
  observe,
} from '../../tests/support/chain.js';
import { NOTES_SHOWN, taskStanding, taskStory } from './task-story.js';

let benches: Bench[] = [];
let caches: ProjectionCache[] = [];

afterEach(() => {
  for (const c of caches) c.close();
  for (const b of benches) rmSync(b.root, { recursive: true, force: true });
  caches = [];
  benches = [];
});

function bench(): Bench {
  const b = makeBench();
  benches.push(b);
  return b;
}

function open(b: Bench): ProjectionCache[] {
  const cache = b.cache();
  caches.push(cache);
  return [cache];
}

describe('taskStory', () => {
  it('has nothing to say about a task nobody wrote beside', () => {
    const b = bench();
    birthTask(b, 't-1', 'Plain');
    expect(taskStory(open(b), 't-1')).toBeUndefined();
  });

  it('serves the description whole, and the latest one when it was restated', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it');
    observe(b, 'o-1', 't-1', 'the first idea', 'description');
    observe(b, 'o-2', 't-1', 'the idea, restated\nover two lines', 'description');
    const story = taskStory(open(b), 't-1');
    expect(story?.description).toMatchObject({
      id: 'o-2',
      text: 'the idea, restated\nover two lines',
    });
    // The earlier one is still a note about the task; the chosen one is not repeated.
    expect(story?.notes.items.map((n) => n.id)).toEqual(['o-1']);
  });

  it('serves the last handoff with the brief written in the same call, not an older one', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it');
    handoff(b, 't-1', 'alice', 'bob');
    observe(b, 'o-old', 't-1', 'read this first', 'brief');
    handoff(b, 't-1', 'bob', 'carol');
    observe(b, 'o-new', 't-1', 'the schema is done, the API is not', 'brief');
    const story = taskStory(open(b), 't-1');
    expect(story?.handoff).toMatchObject({
      from: 'bob',
      to: 'carol',
      brief: { id: 'o-new', text: 'the schema is done, the API is not' },
    });
    expect(story?.notes.items.map((n) => n.id)).toEqual(['o-old']);
  });

  it('serves a handoff with no brief as just the two agents', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it');
    handoff(b, 't-1', 'alice', 'bob');
    const story = taskStory(open(b), 't-1');
    expect(story?.handoff?.to).toBe('bob');
    expect(story?.handoff?.brief).toBeUndefined();
  });

  it('lists the other notes newest first, one line each, and says how many it cut', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it');
    for (let n = 1; n <= NOTES_SHOWN + 3; n++) {
      observe(b, `o-${n}`, 't-1', `note number ${n}\nwith a second line`, 'finding');
    }
    const story = taskStory(open(b), 't-1');
    expect(story?.notes.total).toBe(NOTES_SHOWN + 3);
    expect(story?.notes.items).toHaveLength(NOTES_SHOWN);
    expect(story?.notes.items[0]).toMatchObject({
      id: `o-${NOTES_SHOWN + 3}`,
      topic: 'finding',
      line: `note number ${NOTES_SHOWN + 3} with a second line`,
    });
  });
});

describe('taskStanding', () => {
  it('names the agent the task was last handed to as its owner', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it', 'IN_PROGRESS');
    handoff(b, 't-1', 'alice', 'bob');
    expect(taskStanding(open(b), 't-1').owner).toEqual({ name: 'bob', via: 'handoff' });
  });

  it('names whoever started the task when it was never handed over', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it', 'READY');
    moveTask(b, 't-1', 'READY', 'IN_PROGRESS', 'start', undefined, 'alice');
    expect(taskStanding(open(b), 't-1').owner).toEqual({ name: 'alice', via: 'start' });
  });

  it('names the identity that started it when no agent did', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it', 'READY');
    moveTask(b, 't-1', 'READY', 'IN_PROGRESS', 'start');
    expect(taskStanding(open(b), 't-1').owner).toEqual({ name: b.who, via: 'start' });
  });

  it('has no owner for a task nobody started or was handed', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it', 'READY');
    expect(taskStanding(open(b), 't-1').owner).toBeUndefined();
  });

  it('says the last thing that happened: a move with what it said', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it', 'IN_PROGRESS');
    moveTask(b, 't-1', 'IN_PROGRESS', 'BLOCKED', 'block', { reason: 'waiting on the vendor' });
    expect(taskStanding(open(b), 't-1').lastFact?.line).toBe(
      'block → BLOCKED: reason: waiting on the vendor',
    );
  });

  it('says a note over an older move, and a move over an older note', () => {
    const b = bench();
    birthTask(b, 't-1', 'Ship it', 'IN_PROGRESS');
    observe(b, 'o-1', 't-1', 'the API is flaky\nsecond line', 'finding');
    expect(taskStanding(open(b), 't-1').lastFact?.line).toBe(
      'finding: the API is flaky second line',
    );
    moveTask(b, 't-1', 'IN_PROGRESS', 'IN_REVIEW', 'submit_review');
    expect(taskStanding(open(b), 't-1').lastFact?.line).toBe('submit_review → IN_REVIEW');
  });
});
