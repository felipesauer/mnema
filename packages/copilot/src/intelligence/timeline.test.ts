import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthDecision,
  birthTask,
  link,
  makeBench,
  moveTask,
  observe,
} from '../../tests/support/chain.js';
import { timeline } from './timeline.js';

describe('timeline — the history of one entity', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('gathers the three axes — subject, about, target — in stream order', () => {
    bench = makeBench();
    // A task is created and moved (it is the SUBJECT of these).
    birthTask(bench, 'task-1', 'ship the thing'); // created + birth transition
    moveTask(bench, 'task-1', 'DRAFT', 'READY', 'submit');
    // Someone observes something ABOUT the task (subject is the observation's id).
    observe(bench, 'obs-1', 'task-1', 'looks risky');
    // A decision links TO the task as its target (subject is the decision).
    birthDecision(bench, 'dec-1', 'a decision');
    link(bench, 'dec-1', 'task-1', 'relates-to');

    const story = timeline(bench.events(), 'task-1');
    // Two subject events (created, transitioned), then submit, then about, then target.
    expect(story.map((e) => [e.kind, e.role])).toEqual([
      ['task.created', 'subject'],
      ['task.transitioned', 'subject'],
      ['task.transitioned', 'subject'],
      ['observation.recorded', 'about'],
      ['knowledge.linked', 'target'],
    ]);
    // The order is the stream's own (ascending `at` here) — not re-sorted.
    const stamps = story.map((e) => e.at);
    expect([...stamps]).toEqual([...stamps].sort());
  });

  it('carries who/which/subject and the raw event through', () => {
    bench = makeBench();
    birthTask(bench, 'task-2', 'a task');
    const story = timeline(bench.events(), 'task-2');
    const first = story[0];
    expect(first?.who).toBe(bench.who);
    expect(first?.subject).toBe('task-2');
    expect(first?.event.kind).toBe('task.created');
  });

  it('is empty for an entity no event touches, and for a blank id', () => {
    bench = makeBench();
    birthTask(bench, 'task-3', 'unrelated');
    expect(timeline(bench.events(), 'task-nope')).toEqual([]);
    expect(timeline(bench.events(), '   ')).toEqual([]);
  });

  it('follows the referred entity, not the referring one', () => {
    // An observation ABOUT task-a has its OWN subject (obs id). Querying the
    // observation's own id finds it as `subject`; querying task-a finds it as
    // `about`. The two views never bleed into each other.
    bench = makeBench();
    birthTask(bench, 'task-a', 'a');
    observe(bench, 'obs-x', 'task-a', 'note');
    expect(timeline(bench.events(), 'obs-x').map((e) => e.role)).toEqual(['subject']);
    expect(
      timeline(bench.events(), 'task-a')
        .filter((e) => e.kind === 'observation.recorded')
        .map((e) => e.role),
    ).toEqual(['about']);
  });
});
