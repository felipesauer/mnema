/**
 * The reference graph as an entity and the edges around it: what points INTO it
 * (`←`) and what it points AT (`→`), each with the relation as written and the
 * tree the assertion lives in.
 *
 * The entity's OWN edges come first, whatever their instant, and the edges further
 * out follow. `--json` emits the read's single instant-ordered list; this grouping
 * is the terminal's judgement that a reader looking at one thing wants that
 * thing's own connections at the top. Beyond one hop the nodes are then listed by
 * distance, because at that point the edge list stops reading as a shape and the
 * distances are what the reader came for.
 *
 * An unresolved far end is marked, never dropped: the reference is a fact even
 * when the thing it names is not visible from here. And when the depth cut the
 * answer the last line says so — a bounded answer that does not say it was
 * bounded reads as everything there is.
 *
 * It is the one reading that nests: an edge between two OTHER entities is a
 * sub-item of the entity's own edges, and it is indented one level further to say
 * so. That is what makes this reading two lists rather than one, and it is the
 * only caller that asks {@link itemLine} for a second level.
 */

import type { ReferenceGraph } from '@mnema/copilot';
import { fact, subjectLine } from './detail.js';
import { itemLine } from './items.js';

/** The lines a reference graph prints for a person. */
export function referenceReport(graph: ReferenceGraph): string[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const origin = nodes.get(graph.id);
  const known = origin?.resolved === true ? (origin.kind ?? 'entity') : 'unresolved';
  const lines = [subjectLine(graph.id, known)];
  if (graph.links.length === 0) {
    lines.push(fact('nothing references it, and it references nothing.'));
    return lines;
  }
  const label = (id: string) => {
    const node = nodes.get(id);
    if (node === undefined) return id;
    if (!node.resolved) return `${id} (unresolved)`;
    return node.kind !== undefined ? `${id} (${node.kind})` : id;
  };
  const touchesOrigin = (link: ReferenceGraph['links'][number]) =>
    link.from === graph.id || link.to === graph.id;
  for (const link of [
    ...graph.links.filter(touchesOrigin),
    ...graph.links.filter((l) => !touchesOrigin(l)),
  ]) {
    const rel = link.rel !== undefined ? `${link.role}:${link.rel}` : link.role;
    const tree = `[${link.scope}]`;
    if (link.from === graph.id) lines.push(itemLine([`→ ${rel}`, label(link.to), tree]));
    else if (link.to === graph.id) lines.push(itemLine([`← ${rel}`, label(link.from), tree]));
    else lines.push(itemLine([`${label(link.from)} → ${rel} → ${label(link.to)}`, tree], 2));
  }
  if (graph.depth > 1) {
    lines.push('');
    for (const node of graph.nodes) {
      if (node.depth === 0) continue;
      lines.push(itemLine([`${node.depth} hop(s)`, label(node.id)]));
    }
  }
  if (graph.truncated) {
    lines.push('');
    lines.push(fact(`cut at ${graph.depth} hop(s) — more lies beyond. Raise --depth to see it.`));
  }
  return lines;
}
