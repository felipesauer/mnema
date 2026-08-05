import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema.js';
import type { SqliteDatabase } from '../db/sqlite.js';
import type { DecisionProjection } from './decision.js';
import type { MemoryProjection, ObservationProjection } from './knowledge.js';
import {
  compareSearchHits,
  materializeSearch,
  SEARCH_MAX_LIMIT,
  type SearchHit,
  type SearchQuery,
  type SearchSources,
  searchRecord,
} from './search-store.js';
import type { SkillProjection } from './skill.js';
import type { TaskProjection } from './task.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = new Database(':memory:');
  ensureSchema(db);
});

afterEach(() => {
  db.close();
});

const at = (day: number) => `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;

function memory(id: string, content: string, day: number): MemoryProjection {
  return { id, content, who: 'anchor-1', capturedAt: at(day) };
}

function observation(id: string, topic: string, text: string, day: number): ObservationProjection {
  return { id, about: 'task-1', topic, text, who: 'anchor-1', recordedAt: at(day) };
}

function decision(
  id: string,
  title: string,
  rationale: string,
  day: number,
  state = 'accepted',
  alternatives?: string,
): DecisionProjection {
  return {
    id,
    adr: 'ADR-1',
    title,
    rationale,
    state,
    // Absent unless given, exactly as the projection reads it: a decision that
    // recorded none has no key for it (see `decision.ts`).
    ...(alternatives !== undefined ? { alternatives } : {}),
    createdAt: at(day),
    updatedAt: at(day),
  };
}

function task(id: string, title: string, day: number, state = 'DRAFT'): TaskProjection {
  return { id, title, state, createdAt: at(day), updatedAt: at(day) };
}

function skill(id: string, name: string, body: string, day: number): SkillProjection {
  return { id, name, body, state: 'adopted', createdAt: at(day), updatedAt: at(day) };
}

/** Fills the index with the given projections; anything omitted is empty. */
function index(sources: Partial<SearchSources>): void {
  materializeSearch(db, {
    tasks: sources.tasks ?? [],
    decisions: sources.decisions ?? [],
    memories: sources.memories ?? [],
    observations: sources.observations ?? [],
    skills: sources.skills ?? [],
  });
}

function search(query: SearchQuery = {}) {
  return searchRecord(db, query);
}

function ids(hits: readonly SearchHit[]): string[] {
  return hits.map((hit) => hit.id);
}

describe('searching the record', () => {
  it('lists the most recent records when there is no term', () => {
    index({
      memories: [memory('m1', 'the first thing', 1)],
      tasks: [task('t1', 'a task', 3)],
      decisions: [decision('d1', 'a decision', 'because', 2)],
    });

    const result = search();

    // Newest first, across kinds — a listing is one stream, not one per table.
    expect(ids(result.hits)).toEqual(['t1', 'd1', 'm1']);
    expect(result.total).toBe(3);
  });

  it('finds a record by a word a person wrote in its body', () => {
    index({
      memories: [memory('m1', 'the cache is invalidated by the write, never by a clock', 1)],
      tasks: [task('t1', 'something else entirely', 2)],
    });

    expect(ids(search({ term: 'clock' }).hits)).toEqual(['m1']);
  });

  it('finds records across every indexed kind', () => {
    index({
      memories: [memory('m1', 'a note about pineapple', 1)],
      observations: [observation('o1', 'pineapple', 'topic match', 2)],
      decisions: [decision('d1', 'On pineapple', 'the why', 3)],
      tasks: [task('t1', 'buy pineapple', 4)],
      skills: [skill('s1', 'pineapple pattern', 'the body', 5)],
    });

    expect(ids(search({ term: 'pineapple' }).hits).sort()).toEqual(['d1', 'm1', 'o1', 's1', 't1']);
  });

  it('derives the index line for a memory, and says it is derived', () => {
    index({ memories: [memory('m1', 'the cache is invalidated by the write', 1)] });

    const [hit] = search({ term: 'invalidated' }).hits;

    expect(hit?.derived).toBe(true);
    expect(hit?.title).toContain('invalidated');
    expect(hit?.state).toBeUndefined();
  });

  it('serves the recorded title for the kinds that have one', () => {
    index({ decisions: [decision('d1', 'Keep the cache warm', 'a long rationale about it', 1)] });

    const [hit] = search({ term: 'rationale' }).hits;

    // The match was in the rationale; the line served is still the TITLE, and it
    // is not marked derived — the body comes from the by-id read.
    expect(hit?.title).toBe('Keep the cache warm');
    expect(hit?.derived).toBe(false);
    expect(hit?.state).toBe('accepted');
  });

  it('ranks a title match above a body match', () => {
    index({
      decisions: [decision('d1', 'On caching', 'nothing relevant here', 1)],
      memories: [memory('m1', 'a passing mention of caching in a long paragraph', 2)],
    });

    expect(ids(search({ term: 'caching' }).hits)).toEqual(['d1', 'm1']);
  });

  it('finds a decision by a word that exists only in its alternatives', () => {
    // THE test this field exists for. The value of recording what was turned down
    // is answering "did we already reject this?", and that question IS a search —
    // so a field the index skipped would be write-only, and the whole field
    // pointless. `sqlite` appears in NO other column of this row.
    index({
      decisions: [
        decision(
          'd1',
          'Store the record as JSONL',
          'one append is one line, and a torn write is one bad line',
          1,
          'accepted',
          'a single sqlite file: one corrupt page loses the whole archive',
        ),
      ],
    });

    expect(ids(search({ term: 'sqlite' }).hits)).toEqual(['d1']);
    // And the line served is still the decision's own title, not the excerpt the
    // match fell in — the index names a record, it does not quote it.
    expect(search({ term: 'sqlite' }).hits[0]?.title).toBe('Store the record as JSONL');
    expect(search({ term: 'sqlite' }).hits[0]?.derived).toBe(false);
  });

  it('finds nothing in the alternatives of a decision that recorded none', () => {
    // The other half: absence is absence in the index too. A decision with no
    // alternatives indexes exactly the body it indexed before the field existed.
    index({
      decisions: [
        decision('d1', 'Store the record as JSONL', 'one append is one line', 1),
        decision('d2', 'Name the tails by fingerprint', 'so a fabricated tail has no key', 2),
      ],
    });

    expect(search({ term: 'sqlite' }).hits).toEqual([]);
    expect(search({ term: 'sqlite' }).total).toBe(0);
  });

  it('costs a rationale-only term relevance, and does not move the rank', () => {
    // The price of indexing the field, measured rather than assumed. bm25 divides
    // by document length, so a decision that also records what it turned down is a
    // LONGER document and scores lower on a word from its rationale alone:
    // -1.0472 → -0.7485, 28.5% less negative, on the corpus below.
    //
    // It is the price of the requirement and not of how the field is stored: the
    // same corpus indexed with `alternatives` as a THIRD fts5 column scores
    // -1.0471626704752035 → -0.7484883353347788, the identical pair to the digit,
    // because fts5 normalizes by the tokens of the whole ROW and not of one column.
    // So folding it into the body costs nothing a separate column would have saved,
    // and it keeps the two bm25 weights and the `snippet` column index untouched.
    //
    // What must NOT move is the ORDER, and it does not: `m1` still outranks `d1`
    // both ways. That is the assertion; the numbers above are the reason it is
    // worth asserting.
    const RATIONALE =
      'A tail is append-only and one write is one line, so a torn write damages ' +
      'exactly one record and a reader can skip it. Recovery is a line, never a file.';
    const ALTERNATIVES =
      'A single sqlite file holding the whole archive: one corrupt page takes the ' +
      'archive with it, and repair is a database problem rather than a line problem.';
    // Twenty rows that do NOT carry the term, so bm25's idf is not degenerate: over
    // a handful of documents it collapses to zero and the "score" is floating-point
    // residue rather than a relevance — an instrument that measures nothing.
    const filler = Array.from({ length: 20 }, (_, i) =>
      memory(`f${i}`, `an unrelated note number ${i} about the deploy window`, 5),
    );
    const others = {
      memories: [memory('m1', 'a passing mention of recovery in a long paragraph', 2), ...filler],
      observations: [observation('o1', 'ops', 'the deploy window moved to Tuesday', 3)],
      skills: [skill('s1', 'small slices', 'one reviewable change with its tests', 4)],
    };

    index({ ...others, decisions: [decision('d1', 'Store the record as JSONL', RATIONALE, 1)] });
    const before = search({ term: 'recovery' });
    db.exec('DELETE FROM record_search');
    index({
      ...others,
      decisions: [
        decision('d1', 'Store the record as JSONL', RATIONALE, 1, 'accepted', ALTERNATIVES),
      ],
    });
    const after = search({ term: 'recovery' });

    expect(before.hits.map((hit) => hit.id)).toEqual(['m1', 'd1']);
    expect(after.hits.map((hit) => hit.id)).toEqual(['m1', 'd1']);
    // And the DIRECTION of the cost is pinned, so a change that made the longer
    // document score BETTER would be caught as the anomaly it would be.
    const d1Before = before.hits.find((hit) => hit.id === 'd1')?.score as number;
    const d1After = after.hits.find((hit) => hit.id === 'd1')?.score as number;
    expect(d1After).toBeGreaterThan(d1Before);
  });

  it('does not index structure — an id or a state is not a search term', () => {
    index({ tasks: [task('task-abc123', 'a title with no state word in it', 1, 'IN_REVIEW')] });

    expect(search({ term: 'task-abc123' }).hits).toEqual([]);
    expect(search({ term: 'IN_REVIEW' }).hits).toEqual([]);
    // …but the same values still narrow, as filters.
    expect(ids(search({ state: 'IN_REVIEW' }).hits)).toEqual(['task-abc123']);
  });
});

describe('reading a term as text, never as a query language', () => {
  it('treats FTS5 operators as words to look for', () => {
    index({
      memories: [memory('m1', 'the decision AND the reason it was taken', 1)],
      tasks: [task('t1', 'unrelated', 2)],
    });

    // Raw `AND OR` is a syntax error to FTS5; as text it is two words.
    expect(() => search({ term: 'AND OR' })).not.toThrow();
    expect(ids(search({ term: 'decision AND reason' }).hits)).toEqual(['m1']);
  });

  it('survives an unbalanced quote and a bare wildcard', () => {
    index({ memories: [memory('m1', 'a quoted thing', 1)] });

    expect(() => search({ term: '"unclosed' })).not.toThrow();
    expect(() => search({ term: '*' })).not.toThrow();
    expect(() => search({ term: 'NEAR(a b)' })).not.toThrow();
    expect(ids(search({ term: '"quoted"' }).hits)).toEqual(['m1']);
  });

  it('requires every word (an implicit AND), not any of them', () => {
    index({
      memories: [memory('m1', 'cache invalidation is hard', 1), memory('m2', 'cache only', 2)],
    });

    expect(ids(search({ term: 'cache invalidation' }).hits)).toEqual(['m1']);
  });

  it('folds case and diacritics in both directions', () => {
    index({ memories: [memory('m1', 'anotação sobre a invalidação do cache', 1)] });

    expect(ids(search({ term: 'ANOTACAO' }).hits)).toEqual(['m1']);
    expect(ids(search({ term: 'anotação' }).hits)).toEqual(['m1']);
  });

  it('matches a prefix, so a plural or a conjugation is still found', () => {
    index({ memories: [memory('m1', 'the projections were invalidated', 1)] });

    expect(ids(search({ term: 'projection' }).hits)).toEqual(['m1']);
    expect(ids(search({ term: 'invalidate' }).hits)).toEqual(['m1']);
  });

  it('answers a term nothing matches with an empty list, not an error', () => {
    index({ memories: [memory('m1', 'a thing', 1)] });

    const result = search({ term: 'zebra' });

    expect(result.hits).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('answers a term with nothing searchable in it with an empty list', () => {
    index({ memories: [memory('m1', 'a thing', 1)], tasks: [task('t1', 'another', 2)] });

    // `***` is an intent to SEARCH that matches nothing. Answering it with the
    // listing would turn "find this" into "here is everything".
    expect(search({ term: '***' }).hits).toEqual([]);
    expect(search({ term: '-- ' }).hits).toEqual([]);
  });

  it('treats a blank term as no term at all — a listing', () => {
    index({ memories: [memory('m1', 'a thing', 1)], tasks: [task('t1', 'another', 2)] });

    expect(ids(search({ term: '   ' }).hits)).toEqual(['t1', 'm1']);
    expect(ids(search({ term: '' }).hits)).toEqual(['t1', 'm1']);
  });
});

describe('narrowing by structure', () => {
  beforeEach(() => {
    index({
      memories: [memory('m1', 'shared word here', 1)],
      tasks: [
        task('t1', 'shared word too', 5, 'DONE'),
        task('t2', 'shared word again', 9, 'DRAFT'),
      ],
      decisions: [decision('d1', 'shared word', 'why', 7, 'accepted')],
    });
  });

  it('filters by kind', () => {
    expect(ids(search({ term: 'shared', kind: 'task' }).hits)).toEqual(['t2', 't1']);
    expect(search({ kind: 'task' }).total).toBe(2);
  });

  it('filters by state, which excludes the kinds that have none', () => {
    expect(ids(search({ term: 'shared', state: 'DONE' }).hits)).toEqual(['t1']);
    // A memory has no state, so no state filter can ever include one.
    expect(ids(search({ state: 'accepted' }).hits)).toEqual(['d1']);
  });

  it('filters by a time window, inclusive at both ends', () => {
    expect(ids(search({ from: at(5), to: at(7) }).hits)).toEqual(['d1', 't1']);
    expect(ids(search({ from: at(9) }).hits)).toEqual(['t2']);
    expect(ids(search({ to: at(1) }).hits)).toEqual(['m1']);
  });

  it('combines a term with the filters', () => {
    expect(ids(search({ term: 'shared', kind: 'task', from: at(6) }).hits)).toEqual(['t2']);
  });
});

describe('bounding what comes back', () => {
  it('honours the limit and reports how many matched in all', () => {
    index({ memories: Array.from({ length: 30 }, (_, i) => memory(`m${i}`, 'same word', i + 1)) });

    const result = search({ term: 'same', limit: 5 });

    expect(result.hits).toHaveLength(5);
    // The count is the honest signal that the answer was cut — a capped list
    // that does not say so reads as "this is everything".
    expect(result.total).toBe(30);
  });

  it('defaults to a bounded page rather than the whole record', () => {
    index({ memories: Array.from({ length: 30 }, (_, i) => memory(`m${i}`, 'same word', i + 1)) });

    expect(search().hits).toHaveLength(20);
  });

  it('caps a limit that asks for more than the maximum', () => {
    index({ memories: Array.from({ length: 250 }, (_, i) => memory(`m${i}`, 'same', 1)) });

    expect(search({ limit: 10_000 }).hits).toHaveLength(SEARCH_MAX_LIMIT);
  });

  it('cuts a derived line at a word boundary, never mid-word', () => {
    const content = `${'palavra '.repeat(60)}end`;
    index({ memories: [memory('m1', content, 1)] });

    const [hit] = search().hits;

    expect(hit?.title.endsWith('…')).toBe(true);
    // Every word in the line is a whole word: the cut backed up to a space.
    for (const word of hit?.title.replace('…', '').trim().split(' ') ?? []) {
      expect(word).toBe('palavra');
    }
  });

  it('collapses whitespace so a multi-line memory still reads as one line', () => {
    index({ memories: [memory('m1', 'first line\n\n  second line', 1)] });

    expect(search().hits[0]?.title).toBe('first line second line');
  });
});

describe('the order', () => {
  it('is total: same query, same bytes', () => {
    index({
      memories: [memory('m1', 'same word', 1), memory('m2', 'same word', 1)],
      tasks: [task('t1', 'same word', 1)],
    });

    expect(JSON.stringify(search({ term: 'same' }))).toBe(JSON.stringify(search({ term: 'same' })));
    expect(JSON.stringify(search())).toBe(JSON.stringify(search()));
  });

  it('is the same rule the merge across trees applies', () => {
    // The SQL ORDER BY and compareSearchHits are one rule written twice (LIMIT
    // needs it in SQL, merging needs it in JS). Sorting the SQL answer with the
    // JS comparator must not move a single row, or a two-tree answer would
    // disagree with a one-tree answer for no reason.
    index({
      memories: [memory('m1', 'cache thing', 1), memory('m2', 'cache other', 4)],
      decisions: [decision('d1', 'cache', 'why', 2)],
      tasks: [task('t1', 'cache task', 3)],
    });

    for (const query of [{ term: 'cache' }, {}]) {
      const hits = search(query).hits;
      expect([...hits].sort(compareSearchHits)).toEqual(hits);
    }
  });

  it('breaks a tie in the instant by id, so the pair never swaps', () => {
    index({ memories: [memory('m2', 'same', 1), memory('m1', 'same', 1)] });

    expect(ids(search().hits)).toEqual(['m1', 'm2']);
  });
});
