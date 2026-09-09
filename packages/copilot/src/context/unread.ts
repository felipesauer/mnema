/**
 * What the opening read does NOT look at — the fourth declaration of a limit, in a
 * read that already makes three.
 *
 * {@link bootstrap} serves five lists, and every one of them is about a task, a
 * decision or a pattern. The record holds more than that: a memory and an
 * observation are facts nobody ever has to rule on, so no state machine carries
 * them, so no list here does either. That is a correct filter and it is not the
 * defect. The defect was that the answer said nothing about it, and four lines of
 * "nothing" over a record holding three memories is an answer a reader takes as a
 * statement about the record.
 *
 * MEASURED, ON THE COMMAND LINE, over a record that held three memories and nothing
 * else: `No live tasks. / No decisions in force. / No adopted patterns. / Nothing
 * awaiting a judgement.` — with the session line directly above it reading `wrote 3
 * memory.captured`. One screen asserting both. The reproduction is in
 * `unread.test.ts` ("counts the kinds it does not look at, over a record whose
 * content is entirely outside its lists") and in
 * `code/tests/where-things-stand.test.ts`, over the CLI that printed it.
 *
 * ## Why a FIELD and not a sentence
 *
 * The rule is not invented here — {@link searchRecords} states it, for the two
 * limits of a merged ranking, and this is the same question asked one read
 * earlier. A limit that is a CONSTANT property of a read (it is true of every
 * answer, no caller can act on it per call) is prose in the doc and the surface
 * description; a limit that is a fact about THIS answer (it varies, and the caller
 * can act on it) is a field, present only when it happened.
 *
 * What the opening read does not look at is the second sort. It varies — zero over
 * a record with no memories, five over one with five — and the caller can act on
 * it, because `search` reaches every kind counted here. So it is a field, and the
 * idiom is `RecordSearch.hidden`'s: absent when there was nothing to declare, which
 * is what keeps an empty record saying it is empty (`unread.test.ts`, "says nothing
 * about a record that holds nothing").
 *
 * The alternative was a sentence in the `bootstrap` tool's description, and the
 * compensation that already existed was exactly that — `search`'s own description
 * says to ask it "BEFORE assuming nothing is recorded". It is advice, in the prose
 * of ANOTHER tool, which the agent may never read; and it cannot distinguish the
 * empty record from the full one, because prose does not count. Both surfaces get
 * the sentence too (see `code/src/mcp/server.ts` and
 * `code/src/presentation/status.ts`), but the sentence is not what carries the
 * fact.
 *
 * ## What this does NOT decide
 *
 * It does not put a memory or an observation IN the opening context. Whether the
 * knowledge kinds get a list of their own, and whether they get one list or two, is
 * an open decision with a study of its own
 * (`.refactor/decisions/estudo-dois-kinds-de-conhecimento.md`). A count is not that
 * list: it names a kind and a number, never a body, and it is the same economy the
 * rest of this read already runs on — NAMES, never bodies, and here not even names.
 *
 * ## What it costs, measured
 *
 * **0.142 ms, which is 35% of the whole opening read** (0.402 ms) over the record that
 * module's own budget paragraph is written against — 30 live tasks, 15 decisions, 25
 * adopted patterns, 20 memories, 10 observations. Both orders, against a control that
 * times the same read twice so no gap under the noise floor is reported as a finding:
 * `measurements/opening-read-cost/`, harness and capture both.
 *
 * THE SHARE IS THAT LARGE AND IT IS WRITTEN HERE RATHER THAN ROUNDED AWAY. A third of a
 * read is not what "two counts" sounds like, and the reason is in the schema: the index
 * this asks declares `kind UNINDEXED` (`core/src/db/schema.ts`), so counting ONE kind
 * scans every searchable record of EVERY kind. The cost is therefore a function of the
 * whole record and not of the memories in it, and the sweep in that bench shows it
 * holding at 39–45% from 75 searchable records to 3,750 (0.126 ms → 0.862 ms).
 *
 * IT IS PAID ANYWAY, and the reason is what this read IS. `bootstrap` runs once when a
 * session opens, not per turn and not per write, so what a session spends on this is
 * under a millisecond at fifty times a modest record — against an answer that was
 * telling agents a full record was empty. A cheaper shape exists and is not taken here:
 * one `GROUP BY kind` in place of two counts would halve the scans, and counting the
 * entity tables instead of the index would drop the scan to the rows of the kind asked
 * for. Both need a new function on `core`'s cache, which is a change with its own
 * reasoning and its own consumer, and neither is worth opening for a read whose measured
 * worst case is 0.9 ms. Named here so the next reader inherits the option rather than
 * the surprise.
 *
 * ## The honest limit of THIS declaration
 *
 * It is total over the SEARCHABLE kinds and over nothing else. The record also
 * holds handoffs, knowledge links, skill consultations and channel facts, and none
 * of those is counted here — for the reason {@link readRecord} already gives about
 * the same set: they have no record of their own to read, so they are not in the
 * index, so there is no `search` call this count could send a reader to make. A
 * number a reader cannot act on is the weight this module's own argument rejects.
 * A kind that becomes searchable is forced through {@link SERVED_BY_THE_OPENING}
 * below and cannot be forgotten; one that never does is a gap that stays open, and
 * is stated here rather than left to be discovered.
 */

import { type ProjectionCache, SEARCH_KINDS, type SearchKind } from '@mnema/core';

/**
 * How the opening read serves one searchable kind.
 *
 * `listed` — it has a list here. What the list leaves out (a task that is over, a
 * decision that never took force, everything past a cut) is declared by the list
 * itself, in the three declarations {@link Bootstrap} already makes.
 *
 * `unread` — it has no list here, of any kind, in any state. Nothing about it
 * reaches an agent from this read except the count this module produces.
 */
type OpeningCoverage = 'listed' | 'unread';

/**
 * Which searchable kinds the opening read has a list for, and which it does not
 * look at at all.
 *
 * TOTAL BY TYPE, IN `src` — the molds are `core`'s `FED_BY_KIND` and
 * `UNROUTED_KINDS`. A sixth searchable kind does not compile until it is classified
 * here, which is the whole reason this is a table over `SearchKind` and not a list
 * of the two kinds that happen to be unread today. The failure it is built against
 * is the one this slice exists to fix, arriving a second time: a kind added to the
 * record, absent from every list, and absent from the declaration that says which
 * lists are absent.
 *
 * It is NOT on the package's public surface, for the reason the two disposition
 * tables and `core`'s classification tables are not: a consumer able to import it
 * would be a consumer able to hold a second opinion about what this read covers,
 * and the point of the table is that there is one. Held off the surface by
 * `code/tests/no-classification-table-reaches-the-surface.test.ts`, which finds this
 * module by the sentence above.
 *
 * Exported from the MODULE and from nothing else, which is the same shape the other
 * six take: the guard resolves this module and compares what it published against
 * what it declared, so a table kept file-private would be one the guard can name but
 * never hold — it would watch an empty list and pass whatever happened. The export is
 * what gives it something to watch, and `unread.test.ts` reads the table through it.
 */
export const SERVED_BY_THE_OPENING: { readonly [K in SearchKind]: OpeningCoverage } = {
  // The work list and the waiting list between them, by disposition.
  task: 'listed',
  // The decisions in force, and the proposals on the waiting list.
  decision: 'listed',
  // The adopted patterns, and the proposed or reviewed ones on the waiting list.
  skill: 'listed',
  // No list. A memory is a fact somebody wanted kept; there is nothing to rule on
  // and nothing to advance, so no machine holds it and no list here shows it.
  memory: 'unread',
  // No list, for the memory's reason. An observation is about an entity, and the
  // read that serves it is asked about THAT entity — never about the session.
  observation: 'unread',
};

/** One kind of record the opening read does not look at, and how much of it there is. */
export interface UnreadKind {
  /** The kind — the same word `search` takes as its `kind` filter. */
  readonly kind: SearchKind;
  /** How many the record holds, across every tree the caller can see. */
  readonly held: number;
}

/**
 * The searchable kinds the opening read does not look at, counted over `caches` —
 * and only those with something in them.
 *
 * A kind holding nothing is left out rather than reported as zero: the field exists
 * to say "there is something here you are not being shown", and a zero says the
 * opposite in the shape of the same sentence. That is what makes the whole field
 * absent over an empty record, which is the property that keeps `No live tasks.`
 * honest when it is the truth.
 *
 * ORDERED BY THE CATALOG (`SEARCH_KINDS`), not by count: the order is a property of
 * the vocabulary rather than of one record, so two records with the same kinds
 * declare them in the same order, and a caller diffing two answers sees a change in
 * the numbers rather than a reshuffle.
 *
 * The count is the index's own `total`, asked with `limit: 0` — the COUNT(*) that
 * `searchRecord` computes beside its hits, with the row query cut to nothing. It
 * is not a second way of counting a kind: it is the same number `search` would
 * report to a caller who ran the query this field is telling them to run.
 *
 * SUMMED ACROSS THE TREES for the reason every other half of this read takes the
 * union: a memory lands in the machine's own tree and a task in the one that
 * travels, so a count from one tree is a count of one part of what the caller can
 * see. Summing per-tree totals is exact here, and it is exact for the reason it is
 * NOT exact in `searchRecords` — an id is minted once and lives in one tree, so no
 * record is counted twice; what that function has to be careful about is ordering a
 * merge, and there is no ordering here.
 */
export function unreadKinds(caches: readonly ProjectionCache[]): UnreadKind[] {
  const unread: UnreadKind[] = [];
  for (const kind of SEARCH_KINDS) {
    if (SERVED_BY_THE_OPENING[kind] !== 'unread') continue;
    let held = 0;
    for (const cache of caches) held += cache.search({ kind, limit: 0 }).total;
    if (held > 0) unread.push({ kind, held });
  }
  return unread;
}
