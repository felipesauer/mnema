/**
 * Which projection tables each event kind FEEDS — the table that lets a cache
 * bring itself forward over an arrival without redoing the work the arrival
 * cannot have changed.
 *
 * A projection is a function of the events of the kinds it reads, and of nothing
 * else. So a table no arrival feeds is IDENTICAL whether it is folded from the
 * order before the arrival or the order after it — that is the whole theorem this
 * table stands on, and it is what keeps the invariant next door intact
 * (`rebuild.ts`: every projection folds the same ordered stream once). Nothing
 * here computes a projection a second way; it decides which materializations a
 * given arrival makes necessary.
 *
 * TWO ENTRIES ARE IN EVERY ROW, and both were measured rather than assumed:
 *
 *   - `refs` reads EVERY kind. The reference index is one row per appearance and
 *     every event has a subject, so there is no kind it does not index
 *     (`reference-store.ts`, `appearancesOf`). The premise this table was built to
 *     confirm — that the two facts a channel writes about itself feed nothing —
 *     is FALSE, and this is where it is false: `channel.asked` and
 *     `channel.served` are read by `audit_accountability`, `audit_refs` and
 *     `audit_timeline` through this index.
 *   - `runs` reads EVERY kind too, and by one field rather than by a `kind` test:
 *     `lastFactAt` is the latest `at` of any event whose envelope PINS it to the
 *     run (`run.ts`). A fold that reads the envelope reads every kind, whatever
 *     its `kind` switch says.
 *
 * So no kind feeds nothing, and a design that had skipped work for one would have
 * served a stale index and a stale idleness. What is left is still worth the
 * table: the two universal entries are the two cheapest materializations there
 * are, and the expensive ones — the full-text index, and every entity table — are
 * fed by their own kinds alone.
 *
 * IT IS NOT ON THE PACKAGE'S PUBLIC SURFACE, and that is checked rather than
 * declared: `code/tests/no-classification-table-reaches-the-surface.test.ts` finds this
 * module by the sentence above and walks every entry point's runtime exports. A
 * consumer able to import the table would be a consumer able to keep a second opinion
 * about which tables a kind feeds, and two opinions about that is a cache nobody
 * invalidates.
 *
 * TOTAL BY TYPE, IN `src`. A kind added to the catalog does not compile until it
 * is classified here, and a value that is not a projection table cannot be
 * spelled ({@link ProjectionTable} comes from the schema's own list). That is the
 * half a compiler can prove. The other half — that a row names every table the
 * folds ACTUALLY read — no type can prove, and a row that goes quietly wrong
 * hands a reader a stale table rather than a slow one. What holds it is
 * `advance.test.ts`, which drives one event of EVERY kind into a record and
 * asserts that bringing the cache forward leaves every table byte-identical to a
 * full rebuild: a row that under-claims goes red on the table it forgot.
 */

import type { EventKind } from '@mnema/chain';
import type { ProjectionTable } from '../db/schema.js';

/**
 * The tables every kind feeds, whatever it is. Named once and spread into every
 * row, so the two universal readers are visible in the table rather than
 * remembered by whoever edits it.
 */
const EVERY_KIND_FEEDS = ['refs', 'runs'] as const satisfies readonly ProjectionTable[];

/**
 * The tables the searchable entities feed: their own, plus the full-text index,
 * which is materialized from those five folds and not from the stream
 * (`search-store.ts`).
 */
const SEARCHED = 'record_search' satisfies ProjectionTable;

/** What each kind feeds, beyond {@link EVERY_KIND_FEEDS}, which every row carries. */
export const FED_BY_KIND: { readonly [K in EventKind]: readonly ProjectionTable[] } = {
  // A run's own two facts feed the run table, which every kind already feeds.
  'run.started': [...EVERY_KIND_FEEDS],
  'run.ended': [...EVERY_KIND_FEEDS],
  'task.created': [...EVERY_KIND_FEEDS, 'tasks', SEARCHED],
  'task.transitioned': [...EVERY_KIND_FEEDS, 'tasks', SEARCHED],
  'decision.recorded': [...EVERY_KIND_FEEDS, 'decisions', SEARCHED],
  'decision.transitioned': [...EVERY_KIND_FEEDS, 'decisions', SEARCHED],
  // Identity and the roster are projected by nothing: they are read from the tree's
  // own identity files and its roster, never from this cache. The reference index
  // still holds them, which is how an audit accounts for who enrolled whom.
  'identity.founded': [...EVERY_KIND_FEEDS],
  'key.enrolled': [...EVERY_KIND_FEEDS],
  'key.revoked': [...EVERY_KIND_FEEDS],
  'memory.captured': [...EVERY_KIND_FEEDS, 'memories', SEARCHED],
  'observation.recorded': [...EVERY_KIND_FEEDS, 'observations', SEARCHED],
  'handoff.recorded': [...EVERY_KIND_FEEDS, 'handoffs'],
  'knowledge.linked': [...EVERY_KIND_FEEDS, 'links'],
  'skill.created': [...EVERY_KIND_FEEDS, 'skills', SEARCHED],
  'skill.transitioned': [...EVERY_KIND_FEEDS, 'skills', SEARCHED],
  // A consultation is a skill fact that the skill projection does not read: it moves
  // no state and changes no row. What holds it is the reference index, which is
  // where "this pattern was used by that run" is answered from.
  'skill.consulted': [...EVERY_KIND_FEEDS],
  // The waiver a cut is authorized by. The census that reads it reads the CHAIN, not
  // this cache.
  'tail.pruned': [...EVERY_KIND_FEEDS],
  'channel.switched': [...EVERY_KIND_FEEDS, 'channel_switches'],
  // The two facts a channel records about itself. They move no entity's state, and
  // the reads that ask what a channel did ask the reference index.
  'channel.served': [...EVERY_KIND_FEEDS],
  'channel.asked': [...EVERY_KIND_FEEDS],
};

/**
 * Every table the given kinds feed, together. The union, because an arrival is a
 * run of events and the work it makes necessary is the work any one of them makes
 * necessary.
 */
export function tablesFedBy(kinds: Iterable<EventKind>): Set<ProjectionTable> {
  const tables = new Set<ProjectionTable>();
  for (const kind of kinds) {
    for (const table of FED_BY_KIND[kind]) tables.add(table);
  }
  return tables;
}
