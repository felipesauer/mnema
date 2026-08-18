/**
 * Searching and listing the record: the full-text index over one tree.
 *
 * Everything the record holds was, until now, write-only. The projections could
 * answer "this id" and "this state", never "where did we write about X" — so a
 * memory captured six months ago was, in practice, gone. This is the read that
 * gives the record back, and it is ONE read: the term is OPTIONAL, because with
 * an inverted index a listing is the same query without the match. "The ten most
 * recent things" and "the ten best matches for `cache`" differ by one clause.
 *
 * ## What is indexed, and what is only a filter
 *
 * Indexed: the text a PERSON wrote — a memory's content, an observation's topic
 * and text, a decision's title, rationale AND alternatives, a task's title, a
 * skill's name and body. Filters: kind, state, the instant, and (above this
 * module) the tree.
 *
 * Two indexed columns hold all of it, and the mapping is by ROLE rather than by
 * field name: the column `title` takes the one short line that NAMES a record (an
 * observation's topic, a skill's name), and `body` takes the prose, however many
 * fields of it a kind has. A decision has two — the argument for the call and what
 * it turned down — and both go in the body, because a word is looked for by what it
 * MEANS and not by which field of a record happens to hold it. A searcher asking
 * "did we already reject this?" does not know, and must not have to know, that the
 * answer was typed into a second field. (`search-store.test.ts`, "finds a decision
 * by a word that exists only in its alternatives".)
 * Structure is deliberately not searchable. Matching an anchor id or a state
 * name as prose would swamp the words someone actually looked for, and every
 * structural question already has a reader that answers it exactly. A second,
 * worse door onto those answers is not worth building.
 *
 * ## What comes back
 *
 * An INDEX, never the bodies. Each hit is an id, its kind, when it was recorded,
 * and one line to recognize it by — the entity's own title, or, for a memory (the
 * one kind that has none), an excerpt derived from the content. The full body is
 * a second call, by id, against the projection that already holds it. That is not
 * frugality for its own sake: the record this was measured against holds 43
 * memories averaging 1.6 KB, so serving them whole is ~17 500 tokens of an
 * agent's context, nearly all of it about something else. The index of the same
 * 43 is under 1 600.
 *
 * The order is relevance when there is a term and recency when there is not —
 * without a term there is no relevance to speak of. Both are total orders (ties
 * broken by instant, then id), so the same query returns the same bytes: what a
 * read returns lands in the prefix of an agent's prompt, and an unstable order
 * invalidates its cache for no change in content.
 */

import type { SqliteDatabase } from '../db/sqlite.js';
import { oneLine } from '../one-line.js';
import type { DecisionProjection } from './decision.js';
import type { MemoryProjection, ObservationProjection } from './knowledge.js';
import type { SkillProjection } from './skill.js';
import type { TaskProjection } from './task.js';

/** The entity kinds the index holds — the ones that carry text a person wrote. */
export const SEARCH_KINDS = ['memory', 'observation', 'decision', 'task', 'skill'] as const;

/**
 * A searchable kind. Handoffs and links are absent on purpose: both are pure
 * relations (who handed what to whom, what points at what) with no prose of
 * their own, so there is nothing in them to match. Runs are absent for the same
 * reason plus one more — a run is session bookkeeping, and `focus`/`resume`
 * already serve it.
 */
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Whether `value` is one of the searchable kinds — the surfaces' guard. */
export function isSearchKind(value: string): value is SearchKind {
  return (SEARCH_KINDS as readonly string[]).includes(value);
}

/** What to look for: an optional term, plus filters that narrow it. */
export interface SearchQuery {
  /**
   * The words to look for. ABSENT (or blank) means "no term": the query becomes
   * a listing of the most recent records. Present but containing no searchable
   * character (`***`) is an intent to search that matches nothing — an empty
   * result, not a listing of everything.
   */
  readonly term?: string;
  /** Only this kind of record. */
  readonly kind?: SearchKind;
  /**
   * Only records in this state. Kinds that have no state (memory, observation)
   * never carry one, so filtering by state excludes them by construction.
   */
  readonly state?: string;
  /** Only records made at or after this ISO-8601 instant. */
  readonly from?: string;
  /** Only records made at or before this ISO-8601 instant. */
  readonly to?: string;
  /** How many hits to return. Defaults to {@link SEARCH_DEFAULT_LIMIT}, capped at {@link SEARCH_MAX_LIMIT}. */
  readonly limit?: number;
}

/** One record, named but not spelled out — what an index is made of. */
export interface SearchHit {
  /** The record's id — the key that asks for the whole thing. */
  readonly id: string;
  /** Which kind of record it is. */
  readonly kind: SearchKind;
  /**
   * When it was RECORDED (created/captured), never when it last moved. Uniform
   * across kinds, and the only instant a memory or an observation has — a mixed
   * key would make "the most recent" mean two different things in one list.
   */
  readonly at: string;
  /** The one line to recognize it by: its own title, or an excerpt (see {@link derived}). */
  readonly title: string;
  /**
   * True when {@link title} is an EXCERPT of the content rather than a title
   * someone wrote. Only a memory has no title of its own, so only a memory
   * carries this — and a reader must not present the excerpt as if it were a
   * name the person chose.
   */
  readonly derived: boolean;
  /** The record's current state, for the kinds that have one. */
  readonly state?: string;
  /**
   * The bm25 relevance, present only when the query carried a term. SQLite's
   * convention: MORE NEGATIVE is a better match. It is the mechanism of the
   * order, not something to show a reader.
   */
  readonly score?: number;
}

/** The hits, and how many records matched before the limit was applied. */
export interface SearchResult {
  /** The matches, best first (or newest first without a term). */
  readonly hits: readonly SearchHit[];
  /**
   * How many records matched in total. A count larger than `hits.length` is the
   * honest signal that the limit truncated the answer — a capped list that does
   * not say it was capped reads as "this is everything".
   */
  readonly total: number;
}

/** The projections an index is built from — the same folds the tables get. */
export interface SearchSources {
  readonly tasks: Iterable<TaskProjection>;
  readonly decisions: Iterable<DecisionProjection>;
  readonly memories: Iterable<MemoryProjection>;
  readonly observations: Iterable<ObservationProjection>;
  readonly skills: Iterable<SkillProjection>;
}

/** How many hits a query returns when it does not say. */
export const SEARCH_DEFAULT_LIMIT = 20;

/** The most hits one query can return, whatever it asks for. */
export const SEARCH_MAX_LIMIT = 200;

/**
 * How many hits a query actually returns: what it asked for, floored at zero and
 * capped at the maximum. Exported because a caller that MERGES several trees has
 * to cut the merged list to the same number this cut each tree to — computing it
 * twice by two rules is how a two-tree answer starts disagreeing with a one-tree
 * one.
 */
export function effectiveLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? SEARCH_DEFAULT_LIMIT, 0), SEARCH_MAX_LIMIT);
}

/**
 * How much of a memory's content stands in for a title in a LISTING. Roughly the
 * width of the excerpt a match produces, so the two read as the same kind of
 * line rather than one being a paragraph and the other a phrase.
 */
const EXCERPT_CHARS = 140;

/** How many tokens of context a MATCH excerpt carries around the hit. */
const EXCERPT_TOKENS = 16;

/**
 * The shortest token that gets a prefix `*`. Below it a prefix query matches so
 * much that the ranking stops meaning anything (`a*` is every row).
 */
const PREFIX_MIN_LENGTH = 3;

/**
 * How much more a hit in the title is worth than one in the body. A term in the
 * name of a thing identifies it; the same term inside a paragraph mentions it.
 */
const TITLE_WEIGHT = 5.0;

/** The `record_search` row shape as stored, plus the two computed columns. */
interface SearchRow {
  readonly id: string;
  readonly kind: string;
  readonly state: string;
  readonly at: string;
  readonly title: string;
  /** The excerpt: a snippet around the match, or the head of the body. */
  readonly excerpt: string;
  /** bm25, or null in a listing (no term, so no relevance). */
  readonly score: number | null;
}

/** The bound-parameter shape for an index insert. */
interface SearchParams {
  readonly title: string;
  readonly body: string;
  readonly id: string;
  readonly kind: SearchKind;
  readonly state: string;
  readonly at: string;
}

/**
 * Fills the full-text index from the projections. Called during a rebuild after
 * the virtual table has been recreated empty; the caller owns the transaction.
 *
 * It is fed by the SAME folds that fill the relational tables — not by a second
 * pass over the chain. That is what makes the index unable to disagree with the
 * rows it points at: one read of the chain, one fold, two materializations.
 */
export function materializeSearch(db: SqliteDatabase, sources: SearchSources): void {
  const insert = db.prepare(
    `INSERT INTO record_search (title, body, id, kind, state, at)
     VALUES (@title, @body, @id, @kind, @state, @at)`,
  );
  for (const memory of sources.memories) {
    // The only kind with no title: the content IS the record, so it is the body
    // and the index line is derived from it on the way out.
    insert.run(row('', memory.content, memory.id, 'memory', '', memory.capturedAt));
  }
  for (const observation of sources.observations) {
    insert.run(
      row(
        observation.topic,
        observation.text,
        observation.id,
        'observation',
        '',
        observation.recordedAt,
      ),
    );
  }
  for (const decision of sources.decisions) {
    // The reasoning — the WHY it was chosen and the why-not of what it turned
    // down — is the body: it is where the words a later reader searches for
    // actually live. Both halves, because the half that is only in `alternatives`
    // is the one that answers "did we already turn this down?", and a field the
    // index skipped would be write-only.
    insert.run(
      row(
        decision.title,
        decisionBody(decision),
        decision.id,
        'decision',
        decision.state,
        decision.createdAt,
      ),
    );
  }
  for (const task of sources.tasks) {
    // A task is a title and a state; there is no prose under it to index.
    insert.run(row(task.title, '', task.id, 'task', task.state, task.createdAt));
  }
  for (const skill of sources.skills) {
    insert.run(row(skill.name, skill.body, skill.id, 'skill', skill.state, skill.createdAt));
  }
}

/**
 * Searches (or lists) this tree's record. With a term the hits are the best
 * matches, best first; without one they are the most recent records. The filters
 * narrow either. `total` reports how many matched before the limit, so a caller
 * can tell a complete answer from a truncated one.
 *
 * A term nothing matches yields an empty list and a total of zero — an answer,
 * never an error. So does a term with no searchable character in it.
 */
export function searchRecord(db: SqliteDatabase, query: SearchQuery): SearchResult {
  const term = query.term?.trim();
  const match = term === undefined || term === '' ? undefined : toMatchExpression(term);
  // A non-blank term made of nothing searchable (`***`, `--`) is an intent to
  // search that matches nothing. Answering it with a listing would silently turn
  // "find this" into "here is everything", which is the wrong answer twice over.
  if (match === null) return { hits: [], total: 0 };

  const limit = effectiveLimit(query.limit);
  const where = whereClause(query, match);
  const excerpt =
    match === undefined
      ? // No match to centre on: take the head of the body. Bounded in SQL so a
        // 5 KB memory does not cross into JS just to be cut down to one line.
        `substr(body, 1, ${EXCERPT_CHARS * 3})`
      : `snippet(record_search, 1, '', '', '…', ${EXCERPT_TOKENS})`;
  const score = match === undefined ? 'NULL' : `bm25(record_search, ${TITLE_WEIGHT}, 1.0)`;
  // ORDER BY mirrors compareSearchHits exactly — the same rule, once in SQL
  // (because LIMIT needs it) and once in JS (because merging trees needs it).
  const order = match === undefined ? 'at DESC, id' : 'score, at DESC, id';

  const rows = db
    .prepare(
      `SELECT id, kind, state, at, title, ${excerpt} AS excerpt, ${score} AS score
       FROM record_search ${where.sql}
       ORDER BY ${order}
       LIMIT @limit`,
    )
    .all({ ...where.params, limit }) as SearchRow[];
  const counted = db
    .prepare(`SELECT COUNT(*) AS total FROM record_search ${where.sql}`)
    .get(where.params) as { total: number };

  return { hits: rows.map(toHit), total: counted.total };
}

/**
 * The order two hits are served in: relevance first when the query had a term,
 * then newest first, then by id. Exported because the union across trees has to
 * re-order what it merged, and doing that by a different rule than the SQL above
 * would make a two-tree answer disagree with a one-tree answer for no reason.
 *
 * Hits from one query either all carry a score or none do (a term is present or
 * it is not), so the mixed case cannot arise inside a single tree's result; when
 * merging, every tree ran the same query, so it cannot arise across them either.
 */
export function compareSearchHits(a: SearchHit, b: SearchHit): number {
  if (a.score !== undefined && b.score !== undefined && a.score !== b.score) {
    return a.score - b.score;
  }
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Turns what a person typed into an FTS5 match expression, or null when there is
 * nothing searchable in it.
 *
 * The term is TEXT, never a query language. Raw input reaches FTS5's parser as
 * syntax — `AND`, a stray `"`, a bare `*` — and a search for `"the" quote` would
 * come back as a SQL error rather than an answer. So the input is reduced to its
 * word characters, each word is quoted as a phrase, and the phrases are joined by
 * whitespace (FTS5 reads that as AND: every word must appear).
 *
 * Words of {@link PREFIX_MIN_LENGTH} characters or more get a trailing `*`. There
 * is no stemmer — one language's suffix rules applied to a record written in
 * another do more harm than good — and a prefix is the honest substitute: it
 * reaches the plural and the conjugation without pretending to know the grammar.
 */
function toMatchExpression(term: string): string | null {
  const words = term.match(/[\p{L}\p{N}_]+/gu);
  if (words === null || words.length === 0) return null;
  // Each word is letters, digits and underscores only, so nothing inside the
  // quotes can end the phrase early — the quoting cannot be escaped through.
  return words.map((word) => `"${word}"${word.length >= PREFIX_MIN_LENGTH ? '*' : ''}`).join(' ');
}

/** A WHERE clause and the parameters it binds. */
interface WhereClause {
  readonly sql: string;
  readonly params: Record<string, string>;
}

/** Builds the WHERE shared by the row query and the count — one rule, two uses. */
function whereClause(query: SearchQuery, match: string | undefined): WhereClause {
  const conditions: string[] = [];
  const params: Record<string, string> = {};
  if (match !== undefined) {
    conditions.push('record_search MATCH @match');
    params.match = match;
  }
  if (query.kind !== undefined) {
    conditions.push('kind = @kind');
    params.kind = query.kind;
  }
  if (query.state !== undefined) {
    conditions.push('state = @state');
    params.state = query.state;
  }
  if (query.from !== undefined) {
    conditions.push('at >= @from');
    params.from = query.from;
  }
  if (query.to !== undefined) {
    conditions.push('at <= @to');
    params.to = query.to;
  }
  return {
    sql: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

/**
 * The prose of one decision as the index holds it: the rationale, then what was
 * turned down when the record says so.
 *
 * Concatenated into ONE column rather than indexed as a third. The cost of that
 * choice is ZERO, measured: fts5 normalizes bm25 by the tokens of the whole ROW,
 * so the same corpus indexed with `alternatives` as a third column produces the
 * identical score to the digit (-1.0471626704752035 -> -0.7484883353347788 either
 * way). What one column buys is that the two bm25 weights and the `snippet` column
 * argument below stay untouched — a third column changes the arity of both, and
 * getting either wrong shifts the ranking of every kind, not just this one.
 *
 * The cost that IS real belongs to indexing the field at all, and it is not small:
 * a decision that records what it turned down is a longer document, so a term from
 * its rationale alone scores 28.5% less negative on the corpus measured in
 * `search-store.test.ts` ("costs a rationale-only term relevance, and does not move
 * the rank"). The rank did not move there, and the test asserts the rank rather
 * than the number — but on a record where a decision and a memory are close, this
 * is enough to swap them. It is the price of the field being findable, paid only by
 * decisions that carry one: a decision with no alternatives indexes byte-identically
 * to before.
 *
 * The separator is a blank line, and no phrase can straddle it: {@link
 * toMatchExpression} quotes each WORD as its own phrase and ANDs them, so the index
 * is never asked for a phrase that would have to span the boundary. If a multi-word
 * phrase query is ever added, this is the line that has to change with it.
 */
function decisionBody(decision: DecisionProjection): string {
  return decision.alternatives === undefined
    ? decision.rationale
    : `${decision.rationale}\n\n${decision.alternatives}`;
}

function row(
  title: string,
  body: string,
  id: string,
  kind: SearchKind,
  state: string,
  at: string,
): SearchParams {
  return { title, body, id, kind, state, at };
}

function toHit(row: SearchRow): SearchHit {
  // An empty title means the kind has none (only a memory), so the line to
  // recognize the record by is derived from its content and says so.
  const derived = row.title === '';
  return {
    id: row.id,
    kind: row.kind as SearchKind,
    at: row.at,
    title: derived ? excerptOf(row.excerpt) : row.title,
    derived,
    ...(row.state !== '' ? { state: row.state } : {}),
    ...(row.score !== null ? { score: row.score } : {}),
  };
}

/**
 * Cuts an excerpt down to one line, at a word boundary. A match excerpt arrives
 * already windowed by FTS5 (which cuts on tokens, never inside a word) and passes
 * through untouched; the head of a body is cut here, and backing up to the last
 * space is what keeps a truncated line from ending mid-word.
 */
function excerptOf(text: string): string {
  // The collapse is the rule of the line's, not this module's — one place decides what
  // "one line" means, and an excerpt that disagreed with it would be a second answer.
  const collapsed = oneLine(text);
  if (collapsed.length <= EXCERPT_CHARS) return collapsed;
  const cut = collapsed.slice(0, EXCERPT_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  // A single word longer than the whole budget has no boundary to back up to;
  // cutting it hard is better than serving the paragraph it belongs to.
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}
