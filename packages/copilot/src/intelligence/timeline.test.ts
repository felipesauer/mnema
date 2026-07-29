import { rmSync } from 'node:fs';
import { catalogUpcasters } from '@mnema/chain';
import {
  type CatalogEvent,
  orderedEventsAcross,
  type ProjectionCache,
  type Scope,
} from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthDecision,
  birthTask,
  capture,
  link,
  makeBench,
  moveTask,
  observe,
  supersedeDecision,
} from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { timeline } from './timeline.js';

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

/** A tree, labelled with the scope it stands for, rebuilt as it stands now. */
function tree(b: Bench, scope: Scope = 'public'): ScopedCache {
  const cache = b.cache();
  caches.push(cache);
  return { scope, chainRoot: b.root, cache };
}

describe('timeline — the history of one entity', () => {
  it('gathers every axis — subject, about, target — in stream order', () => {
    const b = bench();
    // A task is created and moved (it is the SUBJECT of these).
    birthTask(b, 'task-1', 'ship the thing'); // created + birth transition
    moveTask(b, 'task-1', 'DRAFT', 'READY', 'submit');
    // Someone observes something ABOUT the task (subject is the observation's id).
    observe(b, 'obs-1', 'task-1', 'looks risky');
    // A decision links TO the task as its target (subject is the decision).
    birthDecision(b, 'dec-1', 'a decision');
    link(b, 'dec-1', 'task-1', 'relates-to');

    const story = timeline([tree(b)], 'task-1');
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

  it('carries who/which/subject, the tree, and the raw event through', () => {
    const b = bench();
    birthTask(b, 'task-2', 'a task');
    const first = timeline([tree(b, 'private')], 'task-2')[0];
    expect(first?.who).toBe(b.who);
    expect(first?.subject).toBe('task-2');
    expect(first?.scope).toBe('private');
    expect(first?.event.kind).toBe('task.created');
  });

  it('is empty for an entity no event touches, and for a blank id', () => {
    const b = bench();
    birthTask(b, 'task-3', 'unrelated');
    const sources = [tree(b)];
    expect(timeline(sources, 'task-nope')).toEqual([]);
    expect(timeline(sources, '   ')).toEqual([]);
  });

  it('follows the referred entity, not the referring one', () => {
    // An observation ABOUT task-a has its OWN subject (obs id). Querying the
    // observation's own id finds it as `subject`; querying task-a finds it as
    // `about`. The two views never bleed into each other.
    const b = bench();
    birthTask(b, 'task-a', 'a');
    observe(b, 'obs-x', 'task-a', 'note');
    const sources = [tree(b)];
    expect(timeline(sources, 'obs-x').map((e) => e.role)).toEqual(['subject']);
    expect(
      timeline(sources, 'task-a')
        .filter((e) => e.kind === 'observation.recorded')
        .map((e) => e.role),
    ).toEqual(['about']);
  });
});

describe('timeline — the supersede is visible from BOTH sides', () => {
  it('shows the successor that it superseded something, and the superseded that it was', () => {
    // The fourth role, and the bug it closes. The fact lives on the SUPERSEDED
    // decision's event (`subject: dec-old`, `payload.by: dec-new`), so a reader
    // scanning for events whose subject is dec-new never found it: the successor's
    // history said nothing about having replaced anything.
    const b = bench();
    birthDecision(b, 'dec-old', 'the first call');
    birthDecision(b, 'dec-new', 'the second call');
    supersedeDecision(b, 'dec-old', 'dec-new', 'PROPOSED');
    const sources = [tree(b)];

    const successor = timeline(sources, 'dec-new').filter(
      (e) => e.kind === 'decision.transitioned' && e.subject === 'dec-old',
    );
    expect(successor.map((e) => e.role)).toEqual(['by']);
    expect(successor[0]?.subject).toBe('dec-old');

    const superseded = timeline(sources, 'dec-old').filter(
      (e) => e.kind === 'decision.transitioned' && e.event.kind === 'decision.transitioned',
    );
    // Its own side was never broken, and stays as it was: the protagonist.
    expect(superseded.at(-1)?.role).toBe('subject');
  });

  it('carries the successor id in the payload the entry hands back', () => {
    const b = bench();
    birthDecision(b, 'd1', 'first');
    supersedeDecision(b, 'd1', 'd2', 'PROPOSED');
    const entry = timeline([tree(b)], 'd2')[0];
    expect(entry?.event.kind === 'decision.transitioned' && entry.event.payload.by).toBe('d2');
  });
});

describe('timeline — across the trees', () => {
  it('merges the trees and marks each entry with the tree it lives in', () => {
    const team = bench();
    const mine = bench();
    birthTask(team, 'task-1', 'the work'); // public
    observe(mine, 'obs-1', 'task-1', 'my private note'); // global

    const story = timeline([tree(team, 'public'), tree(mine, 'global')], 'task-1');
    expect(story.map((e) => [e.kind, e.role, e.scope])).toEqual([
      ['task.created', 'subject', 'public'],
      ['task.transitioned', 'subject', 'public'],
      ['observation.recorded', 'about', 'global'],
    ]);
  });

  it('lands exactly where the chain’s own union lands', () => {
    // The guard against the merge drifting from `orderedEventsAcross`: the index
    // is read per tree and merged here, so the merge has to reproduce the union's
    // order rather than approximate it. Both benches tick from the same instant,
    // so their events interleave on equal `at` — the tie-break case.
    const team = bench();
    const mine = bench();
    birthTask(team, 'task-1', 'the work');
    capture(mine, 'mem-1', 'a note');
    observe(mine, 'obs-1', 'task-1', 'note about the work');
    moveTask(team, 'task-1', 'DRAFT', 'READY', 'submit');
    link(mine, 'mem-1', 'task-1', 'relates-to');

    const fromIndex = timeline([tree(team, 'public'), tree(mine, 'global')], 'task-1');
    const fromStream = referenceTimeline(
      orderedEventsAcross([{ root: team.root }, { root: mine.root }], catalogUpcasters()),
      'task-1',
    );
    expect(fromIndex.map((e) => [e.at, e.kind, e.role])).toEqual(fromStream);
    // …and the events come back byte-for-byte as written, not a reshaped copy.
    expect(fromIndex.map((e) => e.event)).toEqual(
      orderedEventsAcross([{ root: team.root }, { root: mine.root }], catalogUpcasters()).filter(
        (event) => roleOf(event, 'task-1') !== undefined,
      ),
    );
  });
});

/**
 * The pre-index reading of a history, kept here as the reference the indexed one
 * is held to: a linear scan of the union, matching the same axes.
 */
function referenceTimeline(
  events: readonly CatalogEvent[],
  entityId: string,
): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const event of events) {
    const role = roleOf(event, entityId);
    if (role !== undefined) out.push([event.at, event.kind, role]);
  }
  return out;
}

function roleOf(event: CatalogEvent, entityId: string): string | undefined {
  if (event.subject === entityId) return 'subject';
  if (event.kind === 'observation.recorded' && event.payload.about === entityId) return 'about';
  if (event.kind === 'knowledge.linked' && event.payload.target === entityId) return 'target';
  if (event.kind === 'decision.transitioned' && event.payload.by === entityId) return 'by';
  return undefined;
}
