/**
 * The reference graph as an entity and the edges around it: what points INTO it
 * (`←`) and what it points AT (`→`), each with the relation as written and the
 * tree the assertion lives in.
 *
 * IT IS THREE LISTS, AND IT SAYS SO. The entity's own edges, then the edges
 * further out that the walk passed through, then the nodes it reached and how far
 * away they are. They used to be told apart by indentation — an edge touching
 * neither end of the entity was printed one level deeper — which put the meaning
 * in whitespace and made this the only reading in the product that nested. A
 * heading with a count is the shape every other list here already has, it says
 * what the group IS rather than leaving a reader to work out what the extra two
 * spaces meant, and it puts a number on each part where before there was none.
 *
 * The entity's OWN edges come first, whatever their instant. `--json` emits the
 * read's single instant-ordered list; this grouping is the terminal's judgement
 * that a reader looking at one thing wants that thing's own connections at the
 * top. Beyond one hop the nodes are then listed by distance, because at that point
 * the edge list stops reading as a shape and the distances are what the reader
 * came for.
 *
 * An empty group is not printed. A heading reading `(0)` states an absence nobody
 * asked about, and the groups that ARE there already say what was found — the same
 * rule `search` follows for a kind it has no hit for.
 *
 * An unresolved far end is marked, never dropped: the reference is a fact even
 * when the thing it names is not visible from here. And when the depth cut the
 * answer the last line says so — a bounded answer that does not say it was
 * bounded reads as everything there is.
 */

import type { ReferenceGraph } from '@mnema/copilot';
import { fact, subjectLine } from './detail.js';
import { asScope, itemLine } from './items.js';
import type { Render } from './render.js';

/** The lines a reference graph prints for a person. */
export function referenceReport(render: Render, graph: ReferenceGraph): string[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const origin = nodes.get(graph.id);
  const known = origin?.resolved === true ? (origin.kind ?? 'entity') : 'unresolved';
  const lines = [render(subjectLine(graph.id, known))];
  if (graph.links.length === 0) {
    lines.push(render(fact('nothing references it, and it references nothing.')));
    return lines;
  }
  const label = (id: string) => {
    const node = nodes.get(id);
    if (node === undefined) return id;
    if (!node.resolved) return `${id} (unresolved)`;
    return node.kind !== undefined ? `${id} (${node.kind})` : id;
  };
  /** A heading naming the group and how much is in it, then its items. */
  const group = (heading: string, items: readonly string[]) => {
    if (items.length === 0) return;
    lines.push('');
    lines.push(`${heading} (${items.length})`);
    lines.push(...items);
  };
  const touchesOrigin = (link: ReferenceGraph['links'][number]) =>
    link.from === graph.id || link.to === graph.id;
  const written = (link: ReferenceGraph['links'][number]) => {
    const rel = link.rel !== undefined ? `${link.role}:${link.rel}` : link.role;
    // THE TREE IS THE COLUMN NOBODY READS, on the line of an edge: every edge of a graph
    // resolved from one project answers the same word, and it is the last field of the
    // row (`items.ts`, `asScope`). The brackets are this report's own punctuation and
    // they stay inside the column, exactly as the padding does in a report that pads.
    const tree = asScope(`[${link.scope}]`);
    if (link.from === graph.id) return render(itemLine([`→ ${rel}`, label(link.to), tree]));
    if (link.to === graph.id) return render(itemLine([`← ${rel}`, label(link.from), tree]));
    return render(itemLine([`${label(link.from)} → ${rel} → ${label(link.to)}`, tree]));
  };
  group('its own edges', graph.links.filter(touchesOrigin).map(written));
  group('edges further out', graph.links.filter((l) => !touchesOrigin(l)).map(written));
  if (graph.depth > 1) {
    group(
      'reached, by distance',
      graph.nodes
        .filter((node) => node.depth > 0)
        .map((node) => render(itemLine([`${node.depth} hop(s)`, label(node.id)]))),
    );
  }
  if (graph.truncated) {
    lines.push('');
    lines.push(
      render(fact(`cut at ${graph.depth} hop(s) — more lies beyond. Raise --depth to see it.`)),
    );
  }
  return lines;
}
