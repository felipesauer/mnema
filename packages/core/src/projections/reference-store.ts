/**
 * The reference index: every way an entity appears in a fact, and the traversal
 * that turns those appearances into a graph.
 *
 * ## The four roles are the graph
 *
 * A reference is a row `(event, entity, role)`. There are exactly four roles,
 * and each one is a field the catalog already proves:
 *
 *   - `subject` — the envelope's own subject. Every event has one, so every
 *     event contributes exactly one subject row. This is what makes the index
 *     able to answer a history at all.
 *   - `about` — the entity an `observation.recorded` is about.
 *   - `target` — the entity a `knowledge.linked` points at.
 *   - `by` — the SUCCESSOR a `decision.transitioned {action: "supersede"}`
 *     names.
 *
 * The fourth is why this exists. `about` and `target` were already reachable by
 * scanning events, and the links table already held one of them — but `by` lives
 * in a transition payload, on the SUPERSEDED decision's event. A reader looking
 * at the successor could not see that it had superseded anything: the fact names
 * it, and nothing indexed the name. Making the successor's appearance a ROW
 * rather than a special case fixes it from both ends at once — the successor's
 * history shows the supersede, and the graph carries the edge.
 *
 * ## Two readings from one shape
 *
 * Ask by entity and the rows are that entity's HISTORY. Ask by `ord` and the
 * rows of one event are an EDGE: the subject row is where the edge starts, a
 * referring row is where it ends. Nothing else is needed — no separate edge
 * table that could come to disagree with the history, and no role that means
 * something here and something else there.
 *
 * ## What is deliberately absent
 *
 * No semantics of relation. A link's `rel` is an open string the catalog never
 * closes, so this layer stores the event and lets a reader read the label; it
 * never groups, infers, or reverses meaning from it. Only the DIRECTION of an
 * edge is trustworthy, because only the direction is a fact: someone wrote a
 * subject and named a target.
 *
 * No resolution of the far end, either. A `target` may name an entity that lives
 * in a tree this cache cannot see — that is legitimate by design, not corruption
 * — so the index records the reference as written and a reader reports the far
 * end as unresolved. Refusing or hiding it would turn an honest partial view
 * into a silent one.
 */

import type { CatalogEvent, EventKind } from '@mnema/chain';
import type { SqliteDatabase } from '../db/sqlite.js';

/** The ways an entity can appear in a fact. */
export const REFERENCE_ROLES = ['subject', 'about', 'target', 'by'] as const;

/** How an entity appears in an event — the third column of a reference. */
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

/**
 * A role that REFERS to an entity other than the event's own subject. These are
 * the roles that make an edge; `subject` is where every edge starts.
 */
export type ReferringRole = Exclude<ReferenceRole, 'subject'>;

/**
 * The precedence used when one event names the same entity twice (a link whose
 * target is its own subject, say). The entity's history reports one entry per
 * event, and this decides which role that entry carries: the protagonist reading
 * wins over any referring one.
 */
const ROLE_PRECEDENCE: { readonly [R in ReferenceRole]: number } = {
  subject: 0,
  about: 1,
  target: 2,
  by: 3,
};

/** One appearance of one entity in one event — a row of the index. */
export interface ReferenceRow {
  /** The event's position in this tree's ordered stream. */
  readonly ord: number;
  /** The entity this row is about. */
  readonly entity: string;
  /** How it appears. */
  readonly role: ReferenceRole;
  /** ISO-8601 instant of the fact, from the envelope. */
  readonly at: string;
  /** The event's kind. */
  readonly kind: EventKind;
  /** The human who authorized it. */
  readonly who: string;
  /** The agent that executed it, when one did. */
  readonly which?: string;
  /** The event's OWN subject — not necessarily {@link entity}. */
  readonly subject: string;
  /** The event as written. */
  readonly event: CatalogEvent;
}

/** One edge of the reference graph, as one event asserts it. */
export interface ReferenceEdgeRow {
  /** Where the edge starts: the asserting event's subject. */
  readonly from: string;
  /** Where it ends: the entity the event refers to. */
  readonly to: string;
  /** Which referring field carries it. */
  readonly role: ReferringRole;
  /** The asserting event's position in this tree's ordered stream. */
  readonly ord: number;
  /** ISO-8601 instant of the assertion. */
  readonly at: string;
  /** The asserting event's kind. */
  readonly kind: EventKind;
  /** The human who authorized the assertion. */
  readonly who: string;
  /** The agent that executed it, when one did. */
  readonly which?: string;
  /** The asserting event as written — where a link's `rel` is read from. */
  readonly event: CatalogEvent;
}

/** Which way a walk follows edges. */
export type ReferenceDirection =
  /** Away from the entity: what it points at. */
  | 'out'
  /** Into the entity: what points at it. */
  | 'in'
  /** Either way — the neighbourhood reading, where an edge is a connection. */
  | 'both';

/** A node a walk starts from, and how many hops were already spent reaching it. */
export interface ReferenceSeed {
  readonly entity: string;
  /** Hops already spent. A fresh walk seeds one entity at depth 0. */
  readonly depth: number;
}

/** How the authorship tally may be narrowed before it is grouped. */
export interface AuthorshipFilter {
  /** Count only facts at or after this ISO-8601 instant (inclusive). */
  readonly from?: string;
  /** Count only facts at or before this ISO-8601 instant (inclusive). */
  readonly to?: string;
  /** Count only facts authorized by this anchor id. */
  readonly who?: string;
  /** Count only facts executed by this agent. */
  readonly which?: string;
}

/**
 * One cell of the authorship tally: how many facts one author, of one kind,
 * executed by one agent (or by none). Summing the cells by author gives the
 * per-author total; summing by kind or by agent gives either breakdown, so both
 * are derived from ONE grouping and cannot disagree.
 */
export interface AuthorshipTally {
  readonly who: string;
  readonly kind: EventKind;
  /** The executing agent, or null when the human acted directly. */
  readonly which: string | null;
  readonly count: number;
}

/** The `refs` row shape as SQLite hands it back. */
interface RefRow {
  readonly ord: number;
  readonly entity: string;
  readonly role: string;
  readonly at: string;
  readonly kind: string;
  readonly who: string;
  readonly which: string | null;
  readonly subject: string;
  readonly event: string;
}

/** The edge row shape as the traversal hands it back. */
interface EdgeRow {
  readonly src: string;
  readonly dst: string;
  readonly role: string;
  readonly ord: number;
  readonly at: string;
  readonly kind: string;
  readonly who: string;
  readonly which: string | null;
  readonly event: string;
}

/** The bound-parameter shape for one index insert. */
interface RefParams {
  readonly ord: number;
  readonly entity: string;
  readonly role: ReferenceRole;
  readonly at: string;
  readonly kind: string;
  readonly who: string;
  readonly which: string | null;
  readonly subject: string;
  readonly event: string;
}

/**
 * Fills the reference index from the ordered event stream. Called during a
 * rebuild after the table has been recreated empty; the caller owns the
 * transaction.
 *
 * It reads the SAME stream every projection folds — one read of the chain, one
 * order, several materializations — so the index cannot come to disagree with
 * the tables about what the chain says, or about the order it says it in.
 *
 * A reference whose entity id is blank is skipped. A blank is not a dangling
 * reference (which is honest and kept); it is the absence of an id, and indexing
 * it would put a node in the graph that no one can ask about.
 *
 * `from` is where in the stream these events sit — 0 for the whole order, and the
 * count already indexed when the caller holds only what arrived after it. That is the
 * ONE materialization here that can be brought forward by appending rather than by
 * being replaced, and the reason is `ord`: a row's position is the event's position
 * in the order, so a suffix of the order indexes to a suffix of the rows. It is the
 * same function over the same events either way, which is what makes the appended
 * rows identical to the ones a full replay would have written (`advance.test.ts`).
 *
 * A WRONG `from` IS NOT CAUGHT HERE. That sentence replaces one claiming the primary
 * key would collide, and the claim is false: the key is (entity, role, ord), so only
 * re-indexing the SAME entity at a position it holds throws — a different event at
 * that position writes a row claiming it, quietly. So the base is the caller's to
 * establish, and {@link chainArrivals} is what establishes it by proving the slice is
 * a suffix of the order the index was built from. The limit is pinned rather than
 * described (`reference-store.test.ts`, "a wrong position is NOT caught here").
 */
export function materializeReferences(
  db: SqliteDatabase,
  events: readonly CatalogEvent[],
  from = 0,
): void {
  const insert = db.prepare(
    `INSERT INTO refs (ord, entity, role, at, kind, who, which, subject, event)
     VALUES (@ord, @entity, @role, @at, @kind, @who, @which, @subject, @event)`,
  );
  events.forEach((event, index) => {
    const ord = from + index;
    // Encoded once per event, not once per row: a fact referred to twice is the
    // same fact both times.
    const encoded = JSON.stringify(event);
    for (const [entity, role] of appearancesOf(event)) {
      if (entity.trim() === '') continue;
      insert.run(refParams(ord, entity, role, event, encoded));
    }
  });
}

/**
 * Every (entity, role) pair one event contributes — its subject, plus whichever
 * referring field its kind carries. This function IS the graph's definition: a
 * role that is not listed here does not exist, and adding an edge to the product
 * means adding a line to it.
 */
function appearancesOf(event: CatalogEvent): Array<[string, ReferenceRole]> {
  const appearances: Array<[string, ReferenceRole]> = [[event.subject, 'subject']];
  if (event.kind === 'observation.recorded') {
    appearances.push([event.payload.about, 'about']);
  } else if (event.kind === 'knowledge.linked') {
    appearances.push([event.payload.target, 'target']);
  } else if (event.kind === 'decision.transitioned' && event.payload.by !== undefined) {
    // The successor of a supersede. Present only on that action, and the one
    // relation the catalog carries in a transition rather than in a link.
    appearances.push([event.payload.by, 'by']);
  }
  return appearances;
}

/**
 * Every event that touches `entityId`, in this tree's own order, one entry per
 * event. An entity no event touches yields an empty list — an answer, not an
 * error — and a blank id matches nothing (a whitespace id is never a minted id).
 *
 * An event that names the entity twice (a link whose target is its own subject)
 * yields ONE row, carrying the strongest role by {@link ROLE_PRECEDENCE}: being
 * the protagonist of a fact outranks being referred to by it.
 */
export function listReferences(db: SqliteDatabase, entityId: string): ReferenceRow[] {
  if (entityId.trim() === '') return [];
  const rows = db
    .prepare(
      `SELECT ord, entity, role, at, kind, who, which, subject, event
         FROM refs
        WHERE entity = @entity
        ORDER BY ord, ${precedenceExpression('role')}`,
    )
    .all({ entity: entityId }) as RefRow[];

  const out: ReferenceRow[] = [];
  let lastOrd = -1;
  for (const row of rows) {
    // The ORDER BY put the strongest role first within an `ord`, so the first
    // row of each event is the one to keep.
    if (row.ord === lastOrd) continue;
    lastOrd = row.ord;
    out.push(toReferenceRow(row));
  }
  return out;
}

/**
 * True when some event in this tree has `entityId` as its SUBJECT — the honest
 * test of "does the record know this thing". Being referred to is not enough: a
 * dangling target is exactly an id that is pointed at and never authored.
 */
export function isKnownEntity(db: SqliteDatabase, entityId: string): boolean {
  if (entityId.trim() === '') return false;
  const row = db
    .prepare(`SELECT 1 AS found FROM refs WHERE entity = @entity AND role = 'subject' LIMIT 1`)
    .get({ entity: entityId }) as { found: number } | undefined;
  return row !== undefined;
}

/**
 * The authorship tally over this tree, grouped by author, kind and executing
 * agent, narrowed by the optional filter.
 *
 * It counts SUBJECT rows only, and that is what makes it a count of events:
 * every event has exactly one subject row, so one row per event, no matter how
 * many entities the event refers to. The window is compared on the ISO strings
 * directly — ISO-8601 UTC stamps sort lexically, the same order the chain merges
 * on.
 */
export function tallyAuthorship(
  db: SqliteDatabase,
  filter: AuthorshipFilter = {},
): AuthorshipTally[] {
  const conditions = [`role = 'subject'`];
  const params: Record<string, string> = {};
  if (filter.from !== undefined) {
    conditions.push('at >= @from');
    params.from = filter.from;
  }
  if (filter.to !== undefined) {
    conditions.push('at <= @to');
    params.to = filter.to;
  }
  if (filter.who !== undefined) {
    conditions.push('who = @who');
    params.who = filter.who;
  }
  if (filter.which !== undefined) {
    // `which = @which` never matches a NULL, so filtering by an agent excludes
    // the facts a human authored with none — the same narrowing a caller means.
    conditions.push('which = @which');
    params.which = filter.which;
  }
  const rows = db
    .prepare(
      `SELECT who, kind, which, COUNT(*) AS count
         FROM refs
        WHERE ${conditions.join(' AND ')}
        GROUP BY who, kind, which`,
    )
    .all(params) as Array<{
    who: string;
    kind: string;
    which: string | null;
    count: number;
  }>;
  return rows.map((row) => ({
    who: row.who,
    kind: row.kind as EventKind,
    which: row.which,
    count: row.count,
  }));
}

/**
 * Every identity that authorized a fact in this tree, once each, sorted.
 *
 * The cheapest honest answer to "who does this record know". It reads the same
 * subject rows {@link tallyAuthorship} counts — one per event — so an author with
 * a single fact is in the list exactly as one with a thousand: this is a question
 * about presence, not about volume.
 */
export function listAuthors(db: SqliteDatabase): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT who FROM refs WHERE role = 'subject' ORDER BY who`)
    .all() as Array<{ who: string }>;
  return rows.map((row) => row.who);
}

/** One event of a kind, reduced to what it is about and the run it happened in. */
export interface SubjectRun {
  /** The event's subject — what the fact is about. */
  readonly entity: string;
  /** The run it belongs to, or null when it belongs to none. */
  readonly run: string | null;
}

/**
 * Every event of `kind` in this tree, as its subject and the run it happened in.
 *
 * One row per EVENT, not per run: what counts as one occurrence is the caller's
 * question, and a caller merging several trees has to see the run ids to answer it
 * (the same run may record the same fact in two trees, and summing per-tree counts
 * would report one session as two).
 *
 * The run comes out of the stored event through SQLite's own JSON reader rather
 * than by parsing every row in JavaScript — the envelope is already in the column,
 * and pulling one field out of it is what `json_extract` is for.
 */
export function listSubjectRuns(db: SqliteDatabase, kind: EventKind): SubjectRun[] {
  const rows = db
    .prepare(
      `SELECT entity, json_extract(event, '$.run') AS run
         FROM refs
        WHERE role = 'subject' AND kind = @kind`,
    )
    .all({ kind }) as Array<{ entity: string; run: string | null }>;
  return rows.map((row) => ({ entity: row.entity, run: row.run }));
}

/**
 * Walks the reference graph of THIS tree from `seeds`, following edges in
 * `direction`, and returns every edge it traversed — not the nodes, because the
 * caller merges several trees and recomputes depth over the union anyway.
 *
 * The walk is a `WITH RECURSIVE` query: SQLite does the traversal, so a graph of
 * a few hundred nodes needs no graph database and the record stays local-first
 * (which is what lets an anonymous clone verify it at all).
 *
 * Two properties are structural, not conventions:
 *   - **Cycle-safe.** `A → B → A` terminates, because each hop increments a
 *     depth that is capped, and the `UNION` collapses a node revisited at the
 *     same depth. A cycle costs at most the cap, never a loop.
 *   - **Capped.** Nothing is followed past `maxDepth` hops. A caller that wants
 *     to know whether the cap cut anything walks one hop further and looks.
 *
 * `seeds` carry the hops already spent, so a caller resuming a walk in another
 * tree (an edge may cross trees, and each tree indexes only its own events)
 * spends the remaining budget rather than the whole of it again.
 *
 * Every hop is TWO indexed equality joins over `refs` and nothing else: from the
 * frontier node to a row that names it (the primary key), then to the other row
 * of the same event (`idx_refs_ord`). The obvious formulation — materialize the
 * edge set once, then join the frontier against it with `src = n OR dst = n` —
 * measured four times slower for the commonest query of all (one hop, either
 * way), because an `OR` across two columns is not a lookup and every hop scanned
 * the whole edge set. There is no edge set here; there are two lookups.
 */
export function walkReferences(
  db: SqliteDatabase,
  seeds: readonly ReferenceSeed[],
  direction: ReferenceDirection,
  maxDepth: number,
): ReferenceEdgeRow[] {
  if (seeds.length === 0 || maxDepth < 1) return [];

  // The seeds go in as bound parameters, one pair each — never interpolated.
  const params: Record<string, string | number> = { max: maxDepth };
  const seedRows = seeds.map((seed, index) => {
    params[`e${index}`] = seed.entity;
    params[`d${index}`] = seed.depth;
    return `SELECT @e${index} AS entity, @d${index} AS depth`;
  });
  const step = stepOf(direction);
  // The envelope is denormalized onto both rows of an event, so `near` carries it
  // whichever end of the edge it happens to be.
  //
  // CROSS JOIN, and not for a cross product: it is SQLite's one lever for FIXING
  // a join order. The planner cannot estimate how many rows a recursive CTE holds,
  // so left to itself it drives the outer loop from `refs` and probes the frontier
  // — a full scan of the index on every call. Driving from the frontier (a handful
  // of rows) and looking each node up is the same answer through two lookups.
  const hop = `CROSS JOIN refs near ON near.entity = w.node ${step.near}
               JOIN refs far ON far.ord = near.ord ${step.far}`;

  const rows = db
    .prepare(
      `WITH RECURSIVE
         seed(entity, depth) AS (${seedRows.join(' UNION ALL ')}),
         walk(node, depth) AS (
           SELECT entity, depth FROM seed
           UNION
           SELECT far.entity, w.depth + 1
             FROM walk w ${hop}
            WHERE w.depth < @max
         )
       SELECT DISTINCT ${step.src} AS src, ${step.dst} AS dst, ${step.role} AS role,
              near.ord AS ord, near.at AS at, near.kind AS kind,
              near.who AS who, near.which AS which, near.event AS event
         FROM walk w ${hop}
        WHERE w.depth < @max`,
    )
    .all(params) as EdgeRow[];

  return rows.map(toEdgeRow);
}

/**
 * The SQL of one hop, given the direction. `near` is the row that names the
 * frontier node; `far` is the other row of the same event, and its entity is the
 * next frontier node.
 *
 * Following an edge OUT means starting from the node's subject row and landing on
 * a referring one; following it IN is the mirror. Either way — the neighbourhood
 * reading — means starting from any row that names the node and landing on the
 * other role of that event, which is what keeps a self-reference (an event whose
 * subject and referred entity are the same id) visible instead of joining a row
 * to itself.
 */
function stepOf(direction: ReferenceDirection): {
  readonly near: string;
  readonly far: string;
  readonly src: string;
  readonly dst: string;
  readonly role: string;
} {
  if (direction === 'out') {
    return {
      near: `AND near.role = 'subject'`,
      far: `AND far.role <> 'subject'`,
      src: 'near.entity',
      dst: 'far.entity',
      role: 'far.role',
    };
  }
  if (direction === 'in') {
    return {
      near: `AND near.role <> 'subject'`,
      far: `AND far.role = 'subject'`,
      src: 'far.entity',
      dst: 'near.entity',
      role: 'near.role',
    };
  }
  return {
    near: '',
    far: 'AND far.role <> near.role',
    src: `CASE WHEN near.role = 'subject' THEN near.entity ELSE far.entity END`,
    dst: `CASE WHEN near.role = 'subject' THEN far.entity ELSE near.entity END`,
    role: `CASE WHEN near.role = 'subject' THEN far.role ELSE near.role END`,
  };
}

/** The SQL that orders roles by {@link ROLE_PRECEDENCE}. */
function precedenceExpression(column: string): string {
  const cases = REFERENCE_ROLES.map((role) => `WHEN '${role}' THEN ${ROLE_PRECEDENCE[role]}`);
  return `CASE ${column} ${cases.join(' ')} END`;
}

function refParams(
  ord: number,
  entity: string,
  role: ReferenceRole,
  event: CatalogEvent,
  encoded: string,
): RefParams {
  return {
    ord,
    entity,
    role,
    at: event.at,
    kind: event.kind,
    who: event.who,
    which: event.which ?? null,
    subject: event.subject,
    event: encoded,
  };
}

function toReferenceRow(row: RefRow): ReferenceRow {
  return {
    ord: row.ord,
    entity: row.entity,
    role: row.role as ReferenceRole,
    at: row.at,
    kind: row.kind as EventKind,
    who: row.who,
    ...(row.which !== null ? { which: row.which } : {}),
    subject: row.subject,
    event: JSON.parse(row.event) as CatalogEvent,
  };
}

function toEdgeRow(row: EdgeRow): ReferenceEdgeRow {
  return {
    from: row.src,
    to: row.dst,
    role: row.role as ReferringRole,
    ord: row.ord,
    at: row.at,
    kind: row.kind as EventKind,
    who: row.who,
    ...(row.which !== null ? { which: row.which } : {}),
    event: JSON.parse(row.event) as CatalogEvent,
  };
}
