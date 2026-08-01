import type { CatalogEvent } from '@mnema/chain';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema.js';
import type { SqliteDatabase } from '../db/sqlite.js';
import {
  isKnownEntity,
  listAuthors,
  listReferences,
  listSubjectRuns,
  materializeReferences,
  type ReferenceDirection,
  type ReferenceSeed,
  tallyAuthorship,
  walkReferences,
} from './reference-store.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = new Database(':memory:');
  ensureSchema(db);
});

afterEach(() => {
  db.close();
});

const at = (minute: number) => `2026-07-01T00:${String(minute).padStart(2, '0')}:00.000Z`;

/** The envelope fields every fixture event shares. */
function envelope(subject: string, minute: number, which?: string) {
  return {
    v: 1 as const,
    at: at(minute),
    who: 'mnid:author',
    signerFp: 'fp',
    subject,
    ...(which !== undefined ? { which } : {}),
  };
}

/** A `skill.consulted` — the one kind whose RUN the reading derivation needs. */
function skillConsulted(
  id: string,
  minute: number,
  run?: string,
  who = 'mnid:author',
): CatalogEvent {
  return {
    ...envelope(id, minute),
    who,
    kind: 'skill.consulted',
    payload: {},
    ...(run !== undefined ? { run } : {}),
  };
}

function taskCreated(id: string, minute: number, which?: string): CatalogEvent {
  return { ...envelope(id, minute, which), kind: 'task.created', payload: { title: id } };
}

function memoryCaptured(id: string, minute: number): CatalogEvent {
  return { ...envelope(id, minute), kind: 'memory.captured', payload: { content: id } };
}

function observationRecorded(id: string, about: string, minute: number): CatalogEvent {
  return {
    ...envelope(id, minute),
    kind: 'observation.recorded',
    payload: { about, topic: 'topic', text: 'text' },
  };
}

function knowledgeLinked(
  subject: string,
  target: string,
  rel: string,
  minute: number,
): CatalogEvent {
  return { ...envelope(subject, minute), kind: 'knowledge.linked', payload: { target, rel } };
}

function superseded(subject: string, by: string, minute: number): CatalogEvent {
  return {
    ...envelope(subject, minute),
    kind: 'decision.transitioned',
    payload: { from: 'accepted', to: 'superseded', action: 'supersede', by },
  };
}

function walk(
  seeds: readonly ReferenceSeed[],
  direction: ReferenceDirection,
  maxDepth: number,
): Array<[string, string, string]> {
  return walkReferences(db, seeds, direction, maxDepth)
    .map((edge) => [edge.from, edge.to, edge.role] as [string, string, string])
    .sort((a, b) => a.join().localeCompare(b.join()));
}

describe('materializeReferences — the four roles', () => {
  it('gives every event a subject row', () => {
    materializeReferences(db, [taskCreated('t1', 1), memoryCaptured('m1', 2)]);
    expect(listReferences(db, 't1').map((r) => r.role)).toEqual(['subject']);
    expect(listReferences(db, 'm1').map((r) => r.role)).toEqual(['subject']);
  });

  it('indexes an observation under both its own id and the entity it is about', () => {
    materializeReferences(db, [taskCreated('t1', 1), observationRecorded('o1', 't1', 2)]);
    expect(listReferences(db, 'o1').map((r) => r.role)).toEqual(['subject']);
    // The task's history now holds the observation, by the role it appears in.
    expect(listReferences(db, 't1').map((r) => r.role)).toEqual(['subject', 'about']);
  });

  it('indexes a link under its subject and its target', () => {
    materializeReferences(db, [knowledgeLinked('m1', 'd1', 'relates-to', 1)]);
    expect(listReferences(db, 'm1').map((r) => r.role)).toEqual(['subject']);
    expect(listReferences(db, 'd1').map((r) => r.role)).toEqual(['target']);
  });

  it('indexes a supersede under the superseded decision AND the successor', () => {
    materializeReferences(db, [superseded('d1', 'd2', 1)]);
    expect(listReferences(db, 'd1').map((r) => r.role)).toEqual(['subject']);
    // The bug this index exists to close: before it, the successor's history
    // held nothing at all about the supersede that named it.
    expect(listReferences(db, 'd2').map((r) => r.role)).toEqual(['by']);
  });

  it('carries every role the catalog defines and no other', () => {
    materializeReferences(db, [
      observationRecorded('o1', 't1', 1),
      knowledgeLinked('m1', 't1', 'relates-to', 2),
      superseded('d1', 'd2', 3),
    ]);
    const roles = db.prepare('SELECT DISTINCT role FROM refs ORDER BY role').all() as Array<{
      role: string;
    }>;
    expect(roles.map((r) => r.role)).toEqual(['about', 'by', 'subject', 'target']);
  });

  it('skips a blank reference: an absent id is not a dangling one', () => {
    materializeReferences(db, [observationRecorded('o1', '   ', 1)]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM refs').get()).toEqual({ n: 1 });
  });

  it('keeps the event as written, so a history can be read from the index alone', () => {
    const event = superseded('d1', 'd2', 1);
    materializeReferences(db, [event]);
    expect(listReferences(db, 'd2')[0]?.event).toEqual(event);
  });
});

describe('listReferences — one entry per event, in the tree order', () => {
  it('returns the events in the stream order, not by instant', () => {
    // A clock that steps back must not reorder the tree's proven order.
    materializeReferences(db, [taskCreated('t1', 9), observationRecorded('o1', 't1', 2)]);
    expect(listReferences(db, 't1').map((r) => r.ord)).toEqual([0, 1]);
  });

  it('yields one entry when an event names the same entity twice, subject winning', () => {
    materializeReferences(db, [knowledgeLinked('x1', 'x1', 'relates-to', 1)]);
    expect(listReferences(db, 'x1').map((r) => r.role)).toEqual(['subject']);
  });

  it('answers an untouched id with an empty history, and a blank id with nothing', () => {
    materializeReferences(db, [taskCreated('t1', 1)]);
    expect(listReferences(db, 'nobody')).toEqual([]);
    expect(listReferences(db, '   ')).toEqual([]);
  });
});

describe('isKnownEntity — authored, not merely pointed at', () => {
  it('knows an entity some event has as its subject', () => {
    materializeReferences(db, [taskCreated('t1', 1)]);
    expect(isKnownEntity(db, 't1')).toBe(true);
  });

  it('does not know a target nothing ever authored — the dangling case', () => {
    materializeReferences(db, [knowledgeLinked('m1', 'gone', 'relates-to', 1)]);
    expect(isKnownEntity(db, 'gone')).toBe(false);
    // …and the reference is still there. Dangling is reported, never hidden.
    expect(listReferences(db, 'gone').map((r) => r.role)).toEqual(['target']);
  });
});

describe('tallyAuthorship — one count per event', () => {
  it('counts each event once however many entities it refers to', () => {
    materializeReferences(db, [
      taskCreated('t1', 1),
      observationRecorded('o1', 't1', 2),
      knowledgeLinked('m1', 't1', 'relates-to', 3),
    ]);
    const total = tallyAuthorship(db).reduce((sum, cell) => sum + cell.count, 0);
    expect(total).toBe(3);
  });

  it('groups by author, kind and executing agent', () => {
    materializeReferences(db, [
      taskCreated('t1', 1, 'claude'),
      taskCreated('t2', 2, 'claude'),
      taskCreated('t3', 3),
    ]);
    expect(tallyAuthorship(db).sort((a, b) => b.count - a.count)).toEqual([
      { who: 'mnid:author', kind: 'task.created', which: 'claude', count: 2 },
      { who: 'mnid:author', kind: 'task.created', which: null, count: 1 },
    ]);
  });

  it('narrows by window and by agent', () => {
    materializeReferences(db, [taskCreated('t1', 1, 'claude'), taskCreated('t2', 5)]);
    expect(tallyAuthorship(db, { from: at(3) }).map((c) => c.count)).toEqual([1]);
    expect(tallyAuthorship(db, { to: at(3) }).map((c) => c.count)).toEqual([1]);
    // Filtering by an agent excludes the facts a human authored with none.
    expect(tallyAuthorship(db, { which: 'claude' })).toEqual([
      { who: 'mnid:author', kind: 'task.created', which: 'claude', count: 1 },
    ]);
  });
});

describe('listAuthors — who this tree knows', () => {
  it('names each author once, however much they wrote', () => {
    materializeReferences(db, [
      taskCreated('t1', 1),
      taskCreated('t2', 2),
      skillConsulted('s1', 3, 'run-a', 'mnid:other'),
    ]);
    expect(listAuthors(db)).toEqual(['mnid:author', 'mnid:other']);
  });

  it('is empty over a tree with no events', () => {
    expect(listAuthors(db)).toEqual([]);
  });
});

describe('listSubjectRuns — one row per event of a kind, with its run', () => {
  it('reads the run off the stored envelope, and null when there is none', () => {
    materializeReferences(db, [
      skillConsulted('s1', 1, 'run-a'),
      skillConsulted('s1', 2, 'run-a'),
      skillConsulted('s2', 3),
      taskCreated('t1', 4),
    ]);
    // One row per EVENT — the caller decides what counts as one occurrence, which
    // is why this does not collapse the two rows of `run-a` itself.
    expect(listSubjectRuns(db, 'skill.consulted')).toEqual([
      { entity: 's1', run: 'run-a' },
      { entity: 's1', run: 'run-a' },
      { entity: 's2', run: null },
    ]);
  });

  it('sees only the kind it was asked for', () => {
    materializeReferences(db, [taskCreated('t1', 1), skillConsulted('s1', 2, 'run-a')]);
    expect(listSubjectRuns(db, 'task.created')).toEqual([{ entity: 't1', run: null }]);
  });
});

describe('walkReferences — the traversal', () => {
  it('finds the neighbourhood in both directions at one hop', () => {
    materializeReferences(db, [
      observationRecorded('o1', 't1', 1),
      knowledgeLinked('t1', 'd1', 'relates-to', 2),
    ]);
    expect(walk([{ entity: 't1', depth: 0 }], 'both', 1)).toEqual([
      ['o1', 't1', 'about'],
      ['t1', 'd1', 'target'],
    ]);
  });

  it('follows one direction only when asked', () => {
    materializeReferences(db, [
      observationRecorded('o1', 't1', 1),
      knowledgeLinked('t1', 'd1', 'relates-to', 2),
    ]);
    expect(walk([{ entity: 't1', depth: 0 }], 'out', 1)).toEqual([['t1', 'd1', 'target']]);
    expect(walk([{ entity: 't1', depth: 0 }], 'in', 1)).toEqual([['o1', 't1', 'about']]);
  });

  it('reaches N hops and stops at the cap', () => {
    materializeReferences(db, [
      knowledgeLinked('a', 'b', 'relates-to', 1),
      knowledgeLinked('b', 'c', 'relates-to', 2),
      knowledgeLinked('c', 'd', 'relates-to', 3),
    ]);
    expect(walk([{ entity: 'a', depth: 0 }], 'out', 1)).toEqual([['a', 'b', 'target']]);
    expect(walk([{ entity: 'a', depth: 0 }], 'out', 2)).toEqual([
      ['a', 'b', 'target'],
      ['b', 'c', 'target'],
    ]);
    expect(walk([{ entity: 'a', depth: 0 }], 'out', 3)).toHaveLength(3);
  });

  it('spends the remaining budget when a seed arrives with hops already spent', () => {
    materializeReferences(db, [
      knowledgeLinked('a', 'b', 'relates-to', 1),
      knowledgeLinked('b', 'c', 'relates-to', 2),
    ]);
    // Seeded at depth 1 of a 2-hop budget: one hop left, so `b → c` only.
    expect(walk([{ entity: 'b', depth: 1 }], 'out', 2)).toEqual([['b', 'c', 'target']]);
    expect(walk([{ entity: 'b', depth: 2 }], 'out', 2)).toEqual([]);
  });

  it('terminates on a cycle', () => {
    materializeReferences(db, [
      knowledgeLinked('a', 'b', 'relates-to', 1),
      knowledgeLinked('b', 'a', 'relates-to', 2),
    ]);
    expect(walk([{ entity: 'a', depth: 0 }], 'out', 10)).toEqual([
      ['a', 'b', 'target'],
      ['b', 'a', 'target'],
    ]);
    expect(walk([{ entity: 'a', depth: 0 }], 'both', 10)).toHaveLength(2);
  });

  it('terminates on a self-edge', () => {
    materializeReferences(db, [knowledgeLinked('a', 'a', 'relates-to', 1)]);
    expect(walk([{ entity: 'a', depth: 0 }], 'both', 5)).toEqual([['a', 'a', 'target']]);
  });

  it('reaches a dangling target and reports it as the far end', () => {
    materializeReferences(db, [knowledgeLinked('a', 'gone', 'relates-to', 1)]);
    expect(walk([{ entity: 'a', depth: 0 }], 'out', 2)).toEqual([['a', 'gone', 'target']]);
  });

  it('walks the supersede chain, which the links table never held', () => {
    materializeReferences(db, [superseded('d1', 'd2', 1), superseded('d2', 'd3', 2)]);
    expect(walk([{ entity: 'd1', depth: 0 }], 'out', 5)).toEqual([
      ['d1', 'd2', 'by'],
      ['d2', 'd3', 'by'],
    ]);
    // …and backwards from the last successor, which is the reading that was
    // invisible before this index existed.
    expect(walk([{ entity: 'd3', depth: 0 }], 'in', 5)).toEqual([
      ['d1', 'd2', 'by'],
      ['d2', 'd3', 'by'],
    ]);
  });

  it('answers an empty walk with nothing, never an error', () => {
    materializeReferences(db, [taskCreated('t1', 1)]);
    expect(walkReferences(db, [], 'both', 3)).toEqual([]);
    expect(walkReferences(db, [{ entity: 't1', depth: 0 }], 'both', 0)).toEqual([]);
    expect(walkReferences(db, [{ entity: 'nobody', depth: 0 }], 'both', 3)).toEqual([]);
  });
});
