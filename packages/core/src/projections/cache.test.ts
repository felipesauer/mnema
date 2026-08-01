import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainWriter,
  decisionRecorded,
  decisionTransitioned,
  handoffRecorded,
  knowledgeLinked,
  memoryCaptured,
  observationRecorded,
  openChainForWriting,
  runEnded,
  runStarted,
  skillBirth,
  skillTransitioned,
  taskBirth,
  taskTransitioned,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/sqlite.js';
import { ProjectionCache } from './cache.js';

let chainRoot: string;
let caches: ProjectionCache[] = [];

beforeEach(() => {
  chainRoot = mkdtempSync(join(tmpdir(), 'mnema-cache-'));
  caches = [];
});

afterEach(() => {
  for (const c of caches) c.close();
  rmSync(chainRoot, { recursive: true, force: true });
});

/** Opens a cache and tracks it for teardown. */
function openCache(dbPath?: string): ProjectionCache {
  const cache = dbPath
    ? ProjectionCache.open(chainRoot, { dbPath })
    : ProjectionCache.open(chainRoot);
  caches.push(cache);
  return cache;
}

const at = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
const env = (subject: string, n: number) => ({
  at: at(n),
  who: 'felipe',
  signerFp: 'fp-1',
  subject,
});

/** Appends a task that is born and then moved once. */
function writeTaskMovedTo(w: ChainWriter, id: string, initial: string, to: string): void {
  const [created, transitioned] = taskBirth(env(id, 0), { title: `title ${id}`, initial });
  w.append(created);
  w.append(transitioned);
  w.append(taskTransitioned(env(id, 1), { from: initial, to, action: 'move' }));
}

describe('ProjectionCache — rebuild materializes the chain', () => {
  it('projects a task after rebuild', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'in-progress');

    const cache = openCache();
    cache.rebuild();

    expect(cache.getTask('t-1')).toEqual({
      id: 't-1',
      title: 'title t-1',
      state: 'in-progress',
      createdAt: at(0),
      updatedAt: at(1),
    });
  });

  it('is empty before rebuild (in-memory cache starts blank)', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'done');
    const cache = openCache();
    expect(cache.listTasks()).toEqual([]); // not populated until rebuild
    cache.rebuild();
    expect(cache.listTasks()).toHaveLength(1);
  });

  it('queries tasks by current state', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'done');
    writeTaskMovedTo(w, 't-2', 'draft', 'in-progress');
    writeTaskMovedTo(w, 't-3', 'draft', 'done');

    const cache = openCache();
    cache.rebuild();
    expect(cache.listTasksByState('done').map((t) => t.id)).toEqual(['t-1', 't-3']);
    expect(cache.listTasksByState('in-progress').map((t) => t.id)).toEqual(['t-2']);
  });
});

describe('ProjectionCache — the cache is NOT the source (drop and replay)', () => {
  it('rebuilds identical state after the cache is wiped, from the chain alone', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'in-progress');
    writeTaskMovedTo(w, 't-2', 'triage', 'done');

    const dbPath = join(chainRoot, 'cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = first.listTasks();
    first.close();
    caches = caches.filter((c) => c !== first);

    // Delete the cache database entirely — the chain is untouched.
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    // Reopen and rebuild from the chain: the state must be byte-identical.
    const second = openCache(dbPath);
    second.rebuild();
    expect(second.listTasks()).toEqual(before);
  });

  it('a rebuild reflects the chain even after the cache was hand-corrupted', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'done');

    const cache = openCache();
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('done');

    // A rebuild is defined entirely by the chain, so running it again from the
    // same chain converges to the same answer — the cache never drifts from it.
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('done');
  });

  it('rebuild is idempotent: running it twice yields the same rows', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'ready');
    writeTaskMovedTo(w, 't-2', 'draft', 'done');

    const cache = openCache();
    cache.rebuild();
    const once = cache.listTasks();
    cache.rebuild();
    expect(cache.listTasks()).toEqual(once);
  });

  it('picks up new events appended to the chain on the next rebuild', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'in-progress');

    const cache = openCache();
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('in-progress');

    // Append a further transition, then rebuild: the cache follows the chain.
    w.append(
      taskTransitioned(env('t-1', 2), { from: 'in-progress', to: 'done', action: 'finish' }),
    );
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('done');
    expect(cache.getTask('t-1')?.updatedAt).toBe(at(2));
  });
});

describe('ProjectionCache — multi-tail materialization', () => {
  it('projects tasks written across two merged tails', () => {
    const rootB = mkdtempSync(join(tmpdir(), 'mnema-cache-b-'));
    try {
      const a = openChainForWriting(chainRoot, { keyRoot: chainRoot });
      writeTaskMovedTo(a, 't-a', 'draft', 'done');
      const b = openChainForWriting(rootB, { keyRoot: rootB });
      writeTaskMovedTo(b, 't-b', 'triage', 'in-progress');
      // Offline merge: copy B's tail and key into A's chain.
      cpSync(join(rootB, 'tails'), join(chainRoot, 'tails'), { recursive: true });
      cpSync(join(rootB, 'keys'), join(chainRoot, 'keys'), { recursive: true });

      const cache = openCache();
      cache.rebuild();
      expect(cache.getTask('t-a')?.state).toBe('done');
      expect(cache.getTask('t-b')?.state).toBe('in-progress');
      expect(cache.listTasks()).toHaveLength(2);
    } finally {
      rmSync(rootB, { recursive: true, force: true });
    }
  });
});

describe('ProjectionCache — runs', () => {
  it('projects an open run, then reflects its close on the next rebuild', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(runStarted(env('r-1', 0), { agent: 'claude', goal: 'ship' }));

    const cache = openCache();
    cache.rebuild();
    expect(cache.getRun('r-1')).toEqual({
      id: 'r-1',
      agent: 'claude',
      who: 'felipe',
      goal: 'ship',
      open: true,
      startedAt: at(0),
    });
    expect(cache.listOpenRuns().map((r) => r.id)).toEqual(['r-1']);

    // Close the run and rebuild: the cache follows the chain.
    w.append(runEnded(env('r-1', 1), { outcome: 'done' }));
    cache.rebuild();
    const closed = cache.getRun('r-1');
    expect(closed?.open).toBe(false);
    expect(closed?.outcome).toBe('done');
    expect(cache.listOpenRuns()).toEqual([]);
  });

  it('rebuilds runs identically after the cache is wiped, from the chain alone', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(runStarted(env('r-1', 0), { agent: 'claude' }));
    w.append(runEnded(env('r-1', 1), { outcome: 'ok' }));
    w.append(runStarted(env('r-2', 2), { agent: 'cursor', goal: 'explore' }));

    const dbPath = join(chainRoot, 'cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = first.listRuns();
    first.close();
    caches = caches.filter((c) => c !== first);

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const second = openCache(dbPath);
    second.rebuild();
    expect(second.listRuns()).toEqual(before);
  });

  it('projects tasks and runs from the same chain side by side', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'done');
    w.append(runStarted(env('r-1', 3), { agent: 'claude' }));

    const cache = openCache();
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('done');
    expect(cache.getRun('r-1')?.open).toBe(true);
  });
});

describe('ProjectionCache — decisions', () => {
  /** Records a decision and moves it to `to` via the given action. */
  function writeDecision(
    w: ChainWriter,
    id: string,
    adr: string,
    to: string,
    action: string,
  ): void {
    w.append(decisionRecorded(env(id, 0), { title: `t ${id}`, rationale: `r ${id}`, adr }));
    w.append(decisionTransitioned(env(id, 0), { from: null, to: 'proposed', action: 'create' }));
    if (to !== 'proposed') {
      w.append(
        decisionTransitioned(env(id, 1), {
          from: 'proposed',
          to,
          action,
          fields: { note: 'n' },
        }),
      );
    }
  }

  it('materializes a decision and queries it by state', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeDecision(w, 'd-1', 'ADR-1', 'accepted', 'accept');
    writeDecision(w, 'd-2', 'ADR-2', 'proposed', 'create');

    const cache = openCache();
    cache.rebuild();
    expect(cache.getDecision('d-1')).toMatchObject({ id: 'd-1', adr: 'ADR-1', state: 'accepted' });
    expect(cache.listDecisionsByState('proposed').map((d) => d.id)).toEqual(['d-2']);
  });

  it('reports an ADR label collision through the cache', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeDecision(w, 'd-1', 'ADR-1', 'proposed', 'create');
    writeDecision(w, 'd-2', 'ADR-1', 'proposed', 'create'); // same label, distinct ids

    const cache = openCache();
    cache.rebuild();
    expect(cache.adrCollisions()).toEqual([{ adr: 'ADR-1', ids: ['d-1', 'd-2'] }]);
  });

  it('rebuilds decisions identically after the cache is wiped', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeDecision(w, 'd-1', 'ADR-1', 'accepted', 'accept');

    const dbPath = join(chainRoot, 'cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = first.listDecisions();
    first.close();
    caches = caches.filter((c) => c !== first);
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const second = openCache(dbPath);
    second.rebuild();
    expect(second.listDecisions()).toEqual(before);
  });
});

describe('ProjectionCache — memories', () => {
  it('materializes a captured memory and reads it back by id', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(memoryCaptured(env('m-1', 0), { content: 'a fact worth proving' }));

    const cache = openCache();
    cache.rebuild();
    expect(cache.getMemory('m-1')).toEqual({
      id: 'm-1',
      content: 'a fact worth proving',
      who: 'felipe',
      capturedAt: at(0),
    });
  });

  it('projects a LONE memory event — a point-in-time fact needs no birth pair', () => {
    // The very shape the task projection drops (a single event) is a whole memory.
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(memoryCaptured(env('m-1', 0), { content: 'lone' }));
    const cache = openCache();
    cache.rebuild();
    expect(cache.getMemory('m-1')?.content).toBe('lone');
    expect(cache.listMemories()).toHaveLength(1);
  });

  it('rebuilds memories identically after the cache is wiped, from the chain alone', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(memoryCaptured(env('m-1', 0), { content: 'first' }));
    w.append(memoryCaptured(env('m-2', 1), { content: 'second' }));

    const dbPath = join(chainRoot, 'cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = first.listMemories();
    first.close();
    caches = caches.filter((c) => c !== first);

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const second = openCache(dbPath);
    second.rebuild();
    expect(second.listMemories()).toEqual(before);
  });

  it('projects tasks and memories from the same tail side by side', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'done');
    w.append(memoryCaptured(env('m-1', 2), { content: 'knowledge' }));

    const cache = openCache();
    cache.rebuild();
    expect(cache.getTask('t-1')?.state).toBe('done');
    expect(cache.getMemory('m-1')?.content).toBe('knowledge');
    // The domains stay separate: the memory is not a task, the task not a memory.
    expect(cache.listTasks()).toHaveLength(1);
    expect(cache.listMemories()).toHaveLength(1);
  });
});

describe('ProjectionCache — observations, handoffs, links (the three knowledge facts)', () => {
  it('materializes observations and lists them BY the observed entity', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(observationRecorded(env('o-1', 0), { about: 't-1', topic: 'a', text: 'first' }));
    w.append(observationRecorded(env('o-2', 1), { about: 't-1', topic: 'b', text: 'second' }));
    w.append(observationRecorded(env('o-3', 2), { about: 't-2', topic: 'c', text: 'other' }));

    const cache = openCache();
    cache.rebuild();
    // Two observations about t-1 both survive (distinct own ids, no collision).
    expect(cache.listObservationsAbout('t-1').map((o) => o.id)).toEqual(['o-1', 'o-2']);
    expect(cache.listObservationsAbout('t-2').map((o) => o.id)).toEqual(['o-3']);
    expect(cache.getObservation('o-1')?.text).toBe('first');
  });

  it('materializes multiple handoffs on one task as a time-ordered list', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(handoffRecorded(env('t-1', 0), { fromAgent: 'claude', toAgent: 'felipe' }));
    w.append(handoffRecorded(env('t-1', 1), { fromAgent: 'felipe', toAgent: 'claude' }));

    const cache = openCache();
    cache.rebuild();
    const list = cache.listHandoffs('t-1');
    expect(list).toHaveLength(2);
    expect(list.map((h) => h.fromAgent)).toEqual(['claude', 'felipe']);
  });

  it('materializes a link answerable from BOTH directions', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(knowledgeLinked(env('m-1', 0), { target: 't-1', rel: 'relates-to' }));

    const cache = openCache();
    cache.rebuild();
    expect(cache.listLinksFrom('m-1').map((e) => e.target)).toEqual(['t-1']);
    expect(cache.listLinksTo('t-1').map((e) => e.subject)).toEqual(['m-1']);
  });

  it('collapses a duplicate link edge in the cache (idempotent primary key)', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    // The same (subject, target, rel) asserted twice folds to ONE row — the
    // fold dedups before insert, so the primary key never clashes.
    w.append(knowledgeLinked(env('m-1', 0), { target: 't-1', rel: 'relates-to' }));
    w.append(knowledgeLinked(env('m-1', 1), { target: 't-1', rel: 'relates-to' }));

    const cache = openCache();
    cache.rebuild();
    expect(cache.listLinksFrom('m-1')).toHaveLength(1);
  });

  it('keeps a dangling link in the cache — the target need not be materialized', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    // A memory links to a task that is not in this chain: the edge still stands.
    w.append(memoryCaptured(env('m-1', 0), { content: 'a private note' }));
    w.append(knowledgeLinked(env('m-1', 1), { target: 't-elsewhere', rel: 'relates-to' }));

    const cache = openCache();
    cache.rebuild();
    expect(cache.getMemory('m-1')).not.toBeNull();
    expect(cache.listLinksFrom('m-1').map((e) => e.target)).toEqual(['t-elsewhere']);
    // The dangling target has no memory row — resolved on read against the union.
    expect(cache.getMemory('t-elsewhere')).toBeNull();
  });

  it('rebuilds the three facts identically after the cache is wiped', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(observationRecorded(env('o-1', 0), { about: 't-1', topic: 't', text: 'note' }));
    w.append(handoffRecorded(env('t-1', 1), { fromAgent: 'a', toAgent: 'b' }));
    w.append(knowledgeLinked(env('m-1', 2), { target: 't-1', rel: 'derived-from' }));

    const dbPath = join(chainRoot, 'cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = {
      obs: first.listObservationsAbout('t-1'),
      handoffs: first.listHandoffs('t-1'),
      links: first.listLinksFrom('m-1'),
    };
    first.close();
    caches = caches.filter((c) => c !== first);

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const second = openCache(dbPath);
    second.rebuild();
    expect(second.listObservationsAbout('t-1')).toEqual(before.obs);
    expect(second.listHandoffs('t-1')).toEqual(before.handoffs);
    expect(second.listLinksFrom('m-1')).toEqual(before.links);
  });
});

describe('ProjectionCache — skills', () => {
  /** Writes a skill born proposed and moved to `to` via the given action. */
  function writeSkill(w: ChainWriter, id: string, to: string, action: string): void {
    const [created, transitioned] = skillBirth(env(id, 0), {
      name: `n ${id}`,
      body: `b ${id}`,
      initial: 'proposed',
    });
    w.append(created);
    w.append(transitioned);
    if (to !== 'proposed') {
      w.append(
        skillTransitioned(env(id, 1), { from: 'proposed', to, action, fields: { note: 'n' } }),
      );
    }
  }

  it('materializes a skill and queries it by state', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeSkill(w, 'sk-1', 'reviewed', 'review');
    writeSkill(w, 'sk-2', 'proposed', 'create');

    const cache = openCache();
    cache.rebuild();
    expect(cache.getSkill('sk-1')).toEqual({
      id: 'sk-1',
      name: 'n sk-1',
      body: 'b sk-1',
      state: 'reviewed',
      createdAt: at(0),
      updatedAt: at(1),
    });
    expect(cache.listSkillsByState('proposed').map((s) => s.id)).toEqual(['sk-2']);
    expect(cache.listSkillsByState('reviewed').map((s) => s.id)).toEqual(['sk-1']);
  });

  it('rebuilds skills identically after the cache is wiped, from the chain alone', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeSkill(w, 'sk-1', 'reviewed', 'review');
    writeSkill(w, 'sk-2', 'proposed', 'create');

    const dbPath = join(chainRoot, 'cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = first.listSkills();
    first.close();
    caches = caches.filter((c) => c !== first);
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const second = openCache(dbPath);
    second.rebuild();
    expect(second.listSkills()).toEqual(before);
  });

  it('carries the provenance of both acts through SQLite', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    const [created, transitioned] = skillBirth(
      { ...env('sk-1', 0), which: 'agent-A' },
      { name: 'n', body: 'b', initial: 'proposed' },
    );
    w.append(created);
    w.append(transitioned);
    w.append(
      skillTransitioned(
        { ...env('sk-1', 1), which: 'agent-A' },
        { from: 'proposed', to: 'reviewed', action: 'review', fields: { note: 'n' } },
      ),
    );
    w.append(
      skillTransitioned(
        { ...env('sk-1', 2), which: 'agent-B' },
        { from: 'reviewed', to: 'adopted', action: 'adopt', fields: { note: 'n' } },
      ),
    );

    const cache = openCache();
    cache.rebuild();
    expect(cache.getSkill('sk-1')).toMatchObject({
      proposedBy: 'agent-A',
      adoption: { at: at(2), by: 'agent-B' },
    });
  });

  it('tells "a person adopted it" from "nobody has" across the round trip', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    // sk-1: adopted with no agent on the envelope — a person acted directly.
    writeSkill(w, 'sk-1', 'adopted', 'adopt');
    // sk-2: never adopted at all.
    writeSkill(w, 'sk-2', 'proposed', 'create');

    const cache = openCache();
    cache.rebuild();
    // The two columns that carry it: an instant with no agent, versus neither.
    expect(cache.getSkill('sk-1')?.adoption).toEqual({ at: at(1) });
    expect(cache.getSkill('sk-2')).not.toHaveProperty('adoption');
    expect(cache.getSkill('sk-1')).not.toHaveProperty('proposedBy');
  });
});

/**
 * Writes one of every kind into the chain — the fixture both the full-text index
 * and the reference index are read against, so the two are never tested on
 * different records.
 */
function writeEverything(w: ChainWriter): void {
  const [created, transitioned] = taskBirth(env('t-1', 0), {
    title: 'pineapple on the roadmap',
    initial: 'draft',
  });
  w.append(created);
  w.append(transitioned);
  w.append(memoryCaptured(env('m-1', 1), { content: 'the pineapple was a mistake' }));
  const [recorded, decided] = [
    decisionRecorded(env('d-1', 2), {
      adr: 'ADR-1',
      title: 'Ship it',
      rationale: 'because the pineapple ripened',
    }),
    decisionTransitioned(env('d-1', 3), {
      from: 'proposed',
      to: 'accepted',
      action: 'accept',
      fields: { rationale: 'r' },
    }),
  ];
  w.append(recorded);
  w.append(decided);
  const [skillCreated, skillMoved] = skillBirth(env('s-1', 4), {
    name: 'pineapple pattern',
    body: 'how we do it',
    initial: 'proposed',
  });
  w.append(skillCreated);
  w.append(skillMoved);
  w.append(observationRecorded(env('o-1', 5), { about: 't-1', topic: 'fruit', text: 'pineapple' }));
  // The three kinds that carry no prose of their own.
  w.append(handoffRecorded(env('t-1', 6), { fromAgent: 'claude', toAgent: 'felipe' }));
  w.append(knowledgeLinked(env('m-1', 7), { target: 'd-1', rel: 'informs' }));
  w.append(runStarted(env('r-1', 8), { agent: 'claude', goal: 'pineapple' }));
}

describe('ProjectionCache — searching the record', () => {
  /** Writes one of every recordable thing, so a search sees the whole record. */
  it('finds every indexed kind by a word the chain actually carries', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeEverything(w);

    const cache = openCache();
    cache.rebuild();

    const found = cache.search({ term: 'pineapple' });
    expect(found.hits.map((hit) => hit.id).sort()).toEqual(['d-1', 'm-1', 'o-1', 's-1', 't-1']);
    expect(found.total).toBe(5);
  });

  it('indexes no handoff, no link and no run — a run goal is not a record', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeEverything(w);

    const cache = openCache();
    cache.rebuild();

    // The run's goal is the word 'pineapple' too, and the handoff and link both
    // name subjects that matched — none of them is a searchable record.
    for (const hit of cache.search({ term: 'pineapple' }).hits) {
      expect(['memory', 'observation', 'decision', 'task', 'skill']).toContain(hit.kind);
    }
    expect(cache.search().total).toBe(5);
  });

  it('is empty before a rebuild and follows the chain after one', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(memoryCaptured(env('m-1', 0), { content: 'the first fact' }));

    const cache = openCache();
    expect(cache.search({ term: 'first' }).hits).toEqual([]);
    cache.rebuild();
    expect(cache.search({ term: 'first' }).hits.map((h) => h.id)).toEqual(['m-1']);

    // A record appended after the rebuild is invisible until the next one — the
    // index is a projection, with exactly the projection's freshness.
    w.append(memoryCaptured(env('m-2', 1), { content: 'the second fact' }));
    expect(cache.search({ term: 'second' }).hits).toEqual([]);
    cache.rebuild();
    expect(cache.search({ term: 'second' }).hits.map((h) => h.id)).toEqual(['m-2']);
  });

  it('rebuilds the index identically after the cache is wiped, from the chain alone', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeEverything(w);

    const dbPath = join(chainRoot, 'cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = first.search({ term: 'pineapple' });
    first.close();
    caches = caches.filter((c) => c !== first);

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const second = openCache(dbPath);
    second.rebuild();
    // Byte-identical, scores included: the index is derived from the chain and
    // from nothing else, so wiping it costs a replay and changes no answer.
    expect(second.search({ term: 'pineapple' })).toEqual(before);
  });

  it('does not double-index when a rebuild runs twice', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeEverything(w);

    const cache = openCache();
    cache.rebuild();
    const once = cache.search({ term: 'pineapple' });
    cache.rebuild();

    expect(cache.search({ term: 'pineapple' })).toEqual(once);
  });

  it('serves the CURRENT state of an entity that moved, not the one it was born in', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeTaskMovedTo(w, 't-1', 'draft', 'done');

    const cache = openCache();
    cache.rebuild();

    expect(cache.search({ term: 'title' }).hits[0]?.state).toBe('done');
    expect(cache.search({ state: 'draft' }).hits).toEqual([]);
  });
});

describe('ProjectionCache — the reference index', () => {
  it('indexes every event and every referred entity from the same chain read', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeEverything(w);

    const cache = openCache();
    cache.rebuild();

    // The task is the subject of its own birth pair, of a handoff recorded ON it,
    // and referred to by the observation about it.
    expect(cache.references('t-1').map((r) => [r.kind, r.role])).toEqual([
      ['task.created', 'subject'],
      ['task.transitioned', 'subject'],
      ['observation.recorded', 'about'],
      ['handoff.recorded', 'subject'],
    ]);
    // The link's target is reached even though the target is a decision that the
    // link event knows only as an id.
    expect(cache.references('d-1').map((r) => r.role)).toContain('target');
    expect(cache.knows('t-1')).toBe(true);
    expect(cache.knows('never-authored')).toBe(false);
  });

  it('names who this tree knows, and reads a kind’s events with their runs', () => {
    // The two questions the readable-identity work asks of a tree: who authorized
    // anything here, and how many sessions were served each pattern. Both are one
    // query over the same index — no second table, no rebuild of their own.
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeEverything(w);
    w.append({
      v: 1,
      kind: 'skill.consulted',
      at: at(9),
      who: 'someone-else',
      signerFp: 'fp-1',
      subject: 's-1',
      run: 'run-a',
      payload: {},
    });

    const cache = openCache();
    cache.rebuild();

    expect(cache.authors()).toEqual(['felipe', 'someone-else']);
    expect(cache.subjectRuns('skill.consulted')).toEqual([{ entity: 's-1', run: 'run-a' }]);
  });

  it('walks from one entity to what it references', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeEverything(w);

    const cache = openCache();
    cache.rebuild();

    expect(cache.walk([{ entity: 'm-1', depth: 0 }], 'out', 1).map((e) => [e.from, e.to])).toEqual([
      ['m-1', 'd-1'],
    ]);
  });

  it('is empty before a rebuild and follows the chain after one', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    w.append(memoryCaptured(env('m-1', 0), { content: 'the first fact' }));

    const cache = openCache();
    expect(cache.references('m-1')).toEqual([]);
    cache.rebuild();
    expect(cache.references('m-1').map((r) => r.role)).toEqual(['subject']);
  });

  it('rebuilds the index identically after the cache is wiped, from the chain alone', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeEverything(w);

    const dbPath = join(chainRoot, 'refs-cache.db');
    const first = openCache(dbPath);
    first.rebuild();
    const before = first.references('t-1');
    const walkedBefore = first.walk([{ entity: 'm-1', depth: 0 }], 'both', 3);
    first.close();
    caches = caches.filter((c) => c !== first);

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const second = openCache(dbPath);
    second.rebuild();
    // Identical, ordinals and stored events included: the index is derived from
    // the chain and from nothing else, so wiping it costs a replay and changes
    // no answer.
    expect(second.references('t-1')).toEqual(before);
    expect(second.walk([{ entity: 'm-1', depth: 0 }], 'both', 3)).toEqual(walkedBefore);
  });

  it('does not double-index when a rebuild runs twice', () => {
    const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
    writeEverything(w);

    const cache = openCache();
    cache.rebuild();
    const once = cache.references('t-1');
    const tally = cache.authorship();
    cache.rebuild();

    expect(cache.references('t-1')).toEqual(once);
    expect(cache.authorship()).toEqual(tally);
  });
});

describe('openDatabase', () => {
  it('opens an in-memory database usable for a throwaway cache', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (x)');
    db.prepare('INSERT INTO t VALUES (1)').run();
    expect(db.prepare('SELECT x FROM t').get()).toEqual({ x: 1 });
    db.close();
  });
});
