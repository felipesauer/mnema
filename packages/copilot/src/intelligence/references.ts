/**
 * references: what an entity reaches, and what reaches it.
 *
 * The other reading of the same index a history is answered from. A history asks
 * "which EVENTS touch this entity"; this asks "which ENTITIES does it connect
 * to" — and both are the same rows, read from opposite ends. An edge is nothing
 * but two rows of one event: the subject row is where it starts, a referring row
 * (`about`, `target`, `by`) is where it ends.
 *
 * Two shapes come out of one walk. At one hop in both directions it is a
 * NEIGHBOURHOOD — what a reader wants after a search hit ("what is this
 * connected to?"). Directed and deeper it is a LINEAGE — the supersede chain of
 * a decision, everything derived from a memory, everything an observation was
 * ever about.
 *
 * ## What the walk promises
 *
 * - **It crosses trees.** An edge lives in the tree its asserting event was
 *   written to, and the far end may live in another — a private memory linking a
 *   public task is the ordinary case, not the exotic one. Each tree indexes only
 *   its own events, so the walk alternates: it asks every tree, learns nodes,
 *   and asks again with what the others found, until nothing new appears. A path
 *   that changes tree at every hop is found at its true depth.
 * - **EVERY tree, one at a time.** A tree is named by its chain root, never by
 *   its scope: a read that spans projects holds several trees in the same role,
 *   and one asked in the other's place is a tree nothing ever walked. What such
 *   an answer loses it loses in silence — the edges that would have proved it
 *   short are the missing ones.
 * - **Every edge says whose record asserts it.** The scope alone cannot: across
 *   projects, two edges into one entity can both be `private` and be two different
 *   codebases. It is the answer to the question the walk is most often asked — which
 *   of my projects has already normalized this — so it travels on the edge rather
 *   than being derivable from where the caller thinks the walk went.
 * - **It is cycle-safe.** `A → B → A` terminates. Each node is reported once,
 *   at the fewest hops it was reached in, and the edge that closes the cycle is
 *   still reported — a cycle is a fact about the record, not an error to hide.
 * - **It says when it was cut.** The walk goes one hop past the depth asked for
 *   purely to tell a leaf from a cut, and reports `truncated` accordingly. A
 *   bounded answer that does not say it was bounded reads as "this is all there
 *   is".
 * - **Dangling is honest.** A `target` may name an entity no visible tree ever
 *   authored — the catalog permits it on purpose, because the writer sees only
 *   its own tree. Such a node is reported with `resolved: false`, never dropped
 *   and never an error. Dropping it would turn "we cannot see the far end" into
 *   "there is no far end", which is a different and false claim.
 *
 * ## What it refuses to invent
 *
 * A link's `rel` is an open string the catalog never closes. It travels out
 * VERBATIM and nothing here reads meaning into it: no grouping by label, no
 * inferred inverse, no notion that one relation implies another. Only the
 * DIRECTION of an edge is a fact — someone wrote a subject and named a target —
 * and direction is all the walk follows.
 *
 * Nor does it decide anything about the WORK graph (which task blocks which).
 * There is no such edge in the catalog; the four roles here are the whole graph
 * the record proves.
 */

import type {
  ReferenceDirection,
  ReferenceEdgeRow,
  ReferringRole,
  Scope,
  SearchKind,
} from '@mnema/core';
import { readRecord } from '../context/search.js';
import type { ScopedCache } from '../sources.js';
import type { EventKind } from './events.js';

/** How far a walk goes when it does not say: the neighbourhood. */
export const REFERENCE_DEFAULT_DEPTH = 1;

/**
 * The most hops one walk will follow. A reference graph is a few hundred nodes,
 * so this is not a performance guard — it is the promise that an answer is
 * bounded and says so, rather than quietly walking a whole component.
 */
export const REFERENCE_MAX_DEPTH = 10;

/** What to walk: from which entity, which way, and how far. */
export interface ReferenceQuery {
  /** The entity to start from. */
  readonly id: string;
  /** Which way to follow edges. Defaults to `both` — the neighbourhood reading. */
  readonly direction?: ReferenceDirection;
  /** How many hops. Defaults to {@link REFERENCE_DEFAULT_DEPTH}, capped at {@link REFERENCE_MAX_DEPTH}. */
  readonly depth?: number;
}

/** An entity the walk reached, and what the record knows about it. */
export interface ReferenceNode {
  /** The entity's id. */
  readonly id: string;
  /** How many hops from the origin it was reached in (0 for the origin itself). */
  readonly depth: number;
  /**
   * True when some visible tree holds a fact whose SUBJECT is this id — the test
   * of whether the record authored the thing, as opposed to merely pointing at
   * it. False is the honest dangling case: the reference exists and the far end
   * does not, here.
   */
  readonly resolved: boolean;
  /** What kind of record it is, when the projections name one. */
  readonly kind?: SearchKind;
  /** The tree that holds it, when it resolves to a record. */
  readonly scope?: Scope;
  /**
   * The PROJECT whose record holds it, when it resolves to a record in one — the
   * answer to "where would I go to read this". Absent both when nothing holds it and
   * when the holder is the machine-global tree, which the `scope` beside it separates.
   */
  readonly project?: string;
}

/** One edge, as the event that asserts it wrote it. */
export interface ReferenceLink {
  /** Where the edge starts: the asserting event's subject. */
  readonly from: string;
  /** Where it ends: the entity the event names. */
  readonly to: string;
  /** Which field carries it: `about`, `target` or `by`. */
  readonly role: ReferringRole;
  /**
   * A link's relation label, verbatim, when the edge is a `target`. An OPEN
   * string: nothing here reads meaning into it.
   */
  readonly rel?: string;
  /** ISO-8601 instant of the assertion. */
  readonly at: string;
  /** The kind of event that asserts it. */
  readonly kind: EventKind;
  /** The human who authorized the assertion. */
  readonly who: string;
  /** The agent that executed it, when one did. */
  readonly which?: string;
  /** The tree the ASSERTION lives in — which may not be either end's tree. */
  readonly scope: Scope;
  /**
   * The project whose record ASSERTS the edge, absent when the machine-global tree
   * does.
   *
   * The most load-bearing label of the three, because it is the answer to the
   * question the walk is usually asked: *"which of my projects has normalized
   * this?"* is answered by the projects of the incoming edges, and without it two
   * edges into one entity are two facts that cannot be told apart.
   */
  readonly project?: string;
}

/** What an entity reaches and what reaches it, within the depth asked for. */
export interface ReferenceGraph {
  /** The entity the walk started from. */
  readonly id: string;
  /** The direction followed. */
  readonly direction: ReferenceDirection;
  /** The depth cap actually applied, after clamping. */
  readonly depth: number;
  /**
   * Every entity reached, the origin first (depth 0), ordered by depth then id.
   * An origin nothing has ever authored is still listed, with `resolved: false`.
   */
  readonly nodes: readonly ReferenceNode[];
  /** Every edge traversed, ordered by instant then by its ends. */
  readonly links: readonly ReferenceLink[];
  /**
   * True when the cap cut the answer: at least one entity lies one hop beyond it.
   * False means the walk reached the end of what is connected.
   */
  readonly truncated: boolean;
}

/**
 * How many hops a walk actually follows: what it asked for, floored at one and
 * capped at {@link REFERENCE_MAX_DEPTH}. A depth of zero would be a walk that
 * follows nothing, which is not a question anyone means to ask.
 */
export function effectiveDepth(depth?: number): number {
  return Math.min(Math.max(depth ?? REFERENCE_DEFAULT_DEPTH, 1), REFERENCE_MAX_DEPTH);
}

/**
 * Walks the reference graph from `query.id` across every tree in `sources`.
 *
 * The walk alternates trees until nothing new appears, because an edge lives in
 * the tree its event was written to while its far end may live in another. Each
 * round asks every tree to expand the nodes it has not already expanded at that
 * depth or shallower; the depths are then recomputed over ALL edges learned so
 * far, so a path that only exists by changing tree is measured at its true
 * length rather than at whichever tree happened to find part of it first.
 */
export function references(sources: readonly ScopedCache[], query: ReferenceQuery): ReferenceGraph {
  const depth = effectiveDepth(query.depth);
  const direction = query.direction ?? 'both';
  // One hop past the cap, and for one reason only: an entity found at cap + 1 is
  // the proof that the answer was CUT, as opposed to having reached the end of
  // what is connected. Nothing beyond the cap is reported.
  const probe = depth + 1;

  const links = new Map<string, ReferenceLink>();
  // Per tree, the shallowest depth each node has already been expanded from.
  // Re-expanding a node at the same depth can only find what it found before.
  //
  // Keyed by the chain root, because that is what names ONE tree: two trees in
  // the same scope are two projects, and a memo keyed by the scope would let the
  // first of them mark the frontier as expanded and the rest leave the loop
  // without ever being asked.
  const expanded = new Map<string, Map<string, number>>();
  let depths = new Map<string, number>([[query.id, 0]]);

  // A path that changes tree at every hop needs one round per hop to be
  // discovered, plus one round to confirm nothing further appears — so `probe`
  // hops need at most `probe + 1` rounds. The loop also stops the moment a round
  // issues no seed, which is the usual case after the second.
  for (let round = 0; round <= probe; round += 1) {
    let seeded = false;
    for (const source of sources) {
      const already = expanded.get(source.chainRoot) ?? new Map<string, number>();
      expanded.set(source.chainRoot, already);
      const seeds: Array<{ entity: string; depth: number }> = [];
      for (const [entity, at] of depths) {
        if (at >= probe) continue;
        const previous = already.get(entity);
        if (previous !== undefined && previous <= at) continue;
        already.set(entity, at);
        seeds.push({ entity, depth: at });
      }
      if (seeds.length === 0) continue;
      seeded = true;
      for (const edge of source.cache.walk(seeds, direction, probe)) {
        const link = toLink(edge, source);
        // Tree, position in that tree's stream, role — the three together name
        // one assertion and no other. An `ord` is a position in ONE tree's
        // stream, so it takes the tree to make it an identity, and the tree is
        // the chain root: keyed by the scope, the first event of one project
        // and the first of the next are the same key, and the later read wins.
        // NUL separates because no path, scope or role can hold one — written
        // as an escape and not as a raw byte, so that an editor shows it.
        links.set(`${source.chainRoot}\0${edge.ord}\0${edge.role}`, link);
      }
    }
    if (!seeded) break;
    depths = shortestHops(links.values(), query.id, direction, probe);
  }

  const truncated = [...depths.values()].some((hops) => hops > depth);
  const reached = [...depths.entries()].filter(([, hops]) => hops <= depth);
  const nodes = reached
    .map(([id, hops]) => resolveNode(sources, id, hops))
    .sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : compare(a.id, b.id)));

  const within = new Set(reached.map(([id]) => id));
  const reported = [...links.values()]
    .filter((link) => within.has(link.from) && within.has(link.to))
    .sort(byInstantThenEnds);

  return { id: query.id, direction, depth, nodes, links: reported, truncated };
}

/**
 * The fewest hops from `origin` to every entity reachable over `links`, up to
 * `cap`. A breadth-first walk, so the first time a node is seen is by its
 * shortest path; a node already seen is never re-queued, which is what makes a
 * cycle cost nothing.
 */
function shortestHops(
  links: Iterable<ReferenceLink>,
  origin: string,
  direction: ReferenceDirection,
  cap: number,
): Map<string, number> {
  const next = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const existing = next.get(from);
    if (existing === undefined) next.set(from, [to]);
    else existing.push(to);
  };
  for (const link of links) {
    if (direction !== 'in') add(link.from, link.to);
    if (direction !== 'out') add(link.to, link.from);
  }

  const hops = new Map<string, number>([[origin, 0]]);
  const queue: string[] = [origin];
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head] as string;
    const depth = hops.get(node) as number;
    if (depth >= cap) continue;
    for (const neighbour of next.get(node) ?? []) {
      if (hops.has(neighbour)) continue;
      hops.set(neighbour, depth + 1);
      queue.push(neighbour);
    }
  }
  return hops;
}

/**
 * What the record knows about one reached entity. `resolved` asks the index
 * whether any tree AUTHORED it (a fact with it as subject); the kind, the tree and
 * the project come from the projections, which know only the kinds that have a
 * record of their own. So an entity can be resolved without a kind — a run, an
 * anchor — and that is reported as it is rather than rounded either way.
 *
 * The three travel together or not at all: they are one answer ("this id is that
 * kind of record, held there"), and the early return is what keeps a node from
 * carrying half of it.
 */
function resolveNode(sources: readonly ScopedCache[], id: string, depth: number): ReferenceNode {
  const resolved = sources.some((source) => source.cache.knows(id));
  const record = readRecord(sources, id);
  if (record === null) return { id, depth, resolved };
  return {
    id,
    depth,
    resolved,
    kind: record.kind,
    scope: record.scope,
    ...(record.project !== undefined ? { project: record.project } : {}),
  };
}

function toLink(edge: ReferenceEdgeRow, asserted: ScopedCache): ReferenceLink {
  // The relation label is read off the asserting event, not off the role: only a
  // knowledge link has one, and it travels verbatim.
  const rel = edge.event.kind === 'knowledge.linked' ? edge.event.payload.rel : undefined;
  return {
    from: edge.from,
    to: edge.to,
    role: edge.role,
    ...(rel !== undefined ? { rel } : {}),
    at: edge.at,
    kind: edge.kind,
    who: edge.who,
    ...(edge.which !== undefined ? { which: edge.which } : {}),
    scope: asserted.scope,
    ...(asserted.project !== undefined ? { project: asserted.project } : {}),
  };
}

/** A total order over edges: by instant, then by their ends and role. */
function byInstantThenEnds(a: ReferenceLink, b: ReferenceLink): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.from !== b.from) return compare(a.from, b.from);
  if (a.to !== b.to) return compare(a.to, b.to);
  return compare(a.role, b.role);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
