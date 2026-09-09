import { rmSync } from 'node:fs';
import { SEARCH_KINDS } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asking,
  type Bench,
  birthDecision,
  birthSkill,
  birthTask,
  capture,
  handoff,
  link,
  makeBench,
  moveTask,
  observe,
} from '../../tests/support/chain.js';
import { bootstrap } from './bootstrap.js';
import { unreadKinds } from './unread.js';

describe('unread — what the opening read does not look at', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('counts the kinds it does not look at, over a record whose content is entirely outside its lists', () => {
    bench = makeBench();
    // The reproduction the slice was written from, on the derivation: three memories
    // and nothing a list here is about.
    capture(bench, 'mem-1', 'the deploy needs the token in the env');
    capture(bench, 'mem-2', 'staging mirrors prod since july');
    capture(bench, 'mem-3', 'the retry budget is three');
    const cache = bench.cache();
    try {
      expect(unreadKinds([cache])).toEqual([{ kind: 'memory', held: 3 }]);
    } finally {
      cache.close();
    }
  });

  it('says nothing about a record that holds nothing', () => {
    bench = makeBench();
    // THE CONTRAST, without which the case above passes over any record at all: an
    // empty record must still read as empty, which is what an ABSENT declaration is
    // for. A zero here would be this read asserting something about a kind it never
    // looked at.
    const cache = bench.cache();
    try {
      expect(unreadKinds([cache])).toEqual([]);
    } finally {
      cache.close();
    }
  });

  it('says nothing about a record made ENTIRELY of what it does look at', () => {
    bench = makeBench();
    // The second contrast, and the one that separates "declares when there is
    // something outside" from "declares whenever the record is non-empty". A record
    // full of tasks, decisions and patterns has nothing unread in it, however much of
    // it there is.
    const t = birthTask(bench, 'task-1', 'Parse tokens');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    birthDecision(bench, 'dec-1', 'Use one clock');
    birthSkill(bench, 'skill-1', 'Write the test first');
    const cache = bench.cache();
    try {
      expect(unreadKinds([cache])).toEqual([]);
    } finally {
      cache.close();
    }
  });

  it('names both knowledge kinds, in the catalog’s order and never the bodies', () => {
    bench = makeBench();
    capture(bench, 'mem-1', 'the deploy needs the token in the env');
    observe(bench, 'obs-1', 'task-1', 'the parser drops the last token');
    observe(bench, 'obs-2', 'task-1', 'it drops it only on empty input');
    const cache = bench.cache();
    try {
      const unread = unreadKinds([cache]);
      // Ordered by SEARCH_KINDS, which puts memory before observation — a property of
      // the vocabulary, so two records with the same kinds declare them alike.
      expect(unread).toEqual([
        { kind: 'memory', held: 1 },
        { kind: 'observation', held: 2 },
      ]);
      // A kind and a number. Not a name, not an excerpt, and above all not a body:
      // whether the knowledge kinds get a list of their own here is an open decision,
      // and a count does not take it.
      expect(JSON.stringify(unread)).not.toMatch(/deploy|token|parser|empty input/);
    } finally {
      cache.close();
    }
  });

  it('sums the trees the caller can see, because a memory lands in one of them', () => {
    bench = makeBench();
    const other = makeBench();
    capture(bench, 'mem-1', 'in the tree that travels');
    capture(other, 'mem-2', 'in the machine’s own');
    capture(other, 'mem-3', 'and another beside it');
    const a = bench.cache();
    const b = other.cache();
    try {
      // Summing per-tree totals is exact: an id is minted once and lives in one tree,
      // so no record is counted twice. Reading one tree alone would report a third of
      // what the caller can see, which is the shape the opening read has already been
      // wrong in once (see `bootstrap.ts`, ONE WORLD NOW).
      expect(unreadKinds([a, b])).toEqual([{ kind: 'memory', held: 3 }]);
      expect(unreadKinds([a])).toEqual([{ kind: 'memory', held: 1 }]);
    } finally {
      a.close();
      b.close();
      rmSync(other.root, { recursive: true, force: true });
    }
  });

  it('accounts for EVERY searchable kind — each one is listed by the opening read, or declared unread', () => {
    // THE TOTALITY, asserted over the vocabulary rather than over a list kept here by
    // hand. `SERVED_BY_THE_OPENING` is total in the compiler, which forces a sixth kind
    // to be classified; this is the other half — that the classification is ACTED on,
    // so a kind marked `listed` really does reach a list and one marked `unread` really
    // does reach this declaration. A sixth kind that reached neither would arrive here
    // as a failure, which is this slice's own defect arriving a second time.
    bench = makeBench();
    const t = birthTask(bench, 'task-1', 'Parse tokens');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    birthDecision(bench, 'dec-1', 'Use one clock');
    birthSkill(bench, 'skill-1', 'Write the test first');
    capture(bench, 'mem-1', 'a fact worth keeping');
    observe(bench, 'obs-1', 'task-1', 'noted');
    const cache = bench.cache();
    try {
      const b = bootstrap([cache], asking(bench.who));
      const listed = new Set<string>([
        ...b.work.map(() => 'task'),
        ...b.decisions.map(() => 'decision'),
        ...b.skills.map(() => 'skill'),
        ...b.awaitingJudgement.map((item) => item.kind),
      ]);
      const declared = new Set((b.unread ?? []).map((item) => item.kind));
      // The record holds one of every searchable kind, so every kind has to turn up on
      // one side or the other — and on exactly one.
      for (const kind of SEARCH_KINDS) {
        expect(listed.has(kind) || declared.has(kind), `${kind} reaches neither`).toBe(true);
        expect(listed.has(kind) && declared.has(kind), `${kind} reaches both`).toBe(false);
      }
      // And the split is the one the table states, so the loop above is not passing on
      // an empty pair of sets.
      expect([...declared].sort()).toEqual(['memory', 'observation']);
      expect([...listed].sort()).toEqual(['decision', 'skill', 'task']);
    } finally {
      cache.close();
    }
  });

  it('does not reach the kinds that have no record to read — the limit it declares in its own doc', () => {
    bench = makeBench();
    // A handoff and a knowledge link are facts of the record that no list here shows
    // AND that this declaration does not count, because they are not in the index:
    // there is no `search --kind handoff` for a reader to go and run. The doc says so;
    // this is the case that keeps the doc honest rather than aspirational.
    const t = birthTask(bench, 'task-1', 'Parse tokens');
    moveTask(bench, t, 'DRAFT', 'READY', 'submit');
    handoff(bench, t, 'claude', 'felipe');
    link(bench, t, 'dec-1');
    const cache = bench.cache();
    try {
      expect(unreadKinds([cache])).toEqual([]);
    } finally {
      cache.close();
    }
  });
});
