/**
 * The reference report's shape: three named lists, and one depth for every item.
 *
 * The property worth pinning is the one the module was reshaped for. This reading
 * used to tell an entity's own edges from the graph beyond them by indenting the
 * second sort one level deeper, which put the meaning in whitespace: a reader had
 * to work out what two extra spaces said, and it was the only list in the product
 * that nested. Naming the groups moves the meaning into words — so the test asserts
 * BOTH halves, because either alone is satisfiable by the bug: headings with the
 * nesting still there, or the nesting gone with nothing saying which list is which.
 */

import type { ReferenceGraph } from '@mnema/copilot';
import { describe, expect, it } from 'vitest';
import { renderPlain } from './plain.js';
import { referenceReport } from './references.js';

/** An origin, one edge of its own, and one edge between two other entities. */
function graph(overrides: Partial<ReferenceGraph> = {}): ReferenceGraph {
  return {
    id: 'origin',
    direction: 'both',
    depth: 2,
    nodes: [
      { id: 'origin', depth: 0, resolved: true, kind: 'task', scope: 'public' },
      { id: 'near', depth: 1, resolved: true, kind: 'decision', scope: 'public' },
      { id: 'far', depth: 2, resolved: false },
    ],
    links: [
      {
        from: 'origin',
        to: 'near',
        role: 'target',
        rel: 'relates-to',
        at: '2026-07-01T00:00:00.000Z',
        kind: 'knowledge.linked',
        who: 'mnid:aa',
        scope: 'public',
      },
      {
        from: 'near',
        to: 'far',
        role: 'target',
        rel: 'derived-from',
        at: '2026-07-02T00:00:00.000Z',
        kind: 'knowledge.linked',
        who: 'mnid:aa',
        scope: 'public',
      },
    ],
    truncated: false,
    ...overrides,
  };
}

/** Every line that is an item — indented — with its indentation measured. */
function indents(lines: readonly string[]): number[] {
  return lines
    .filter((line) => line.startsWith(' '))
    .map((line) => (line.match(/^ +/) as RegExpMatchArray)[0].length);
}

describe('the reference report', () => {
  it('names each list and says how much is in it', () => {
    const lines = referenceReport(renderPlain, graph());
    expect(lines).toContain('its own edges (1)');
    expect(lines).toContain('edges further out (1)');
    expect(lines).toContain('reached, by distance (2)');
  });

  it('puts every item at one depth — the label carries the meaning, not the indent', () => {
    // The edge between two OTHER entities used to be indented twice to say it was
    // not the origin's own. It is in its own named list now, at the same depth as
    // every other item in the product.
    expect(new Set(indents(referenceReport(renderPlain, graph())))).toEqual(new Set([2]));
  });

  it('prints no list it has nothing for', () => {
    // A heading reading `(0)` states an absence nobody asked about. What is shown
    // says what was found, and one hop of a graph often has no edges further out.
    const lines = referenceReport(
      renderPlain,
      graph({
        depth: 1,
        nodes: [{ id: 'origin', depth: 0, resolved: true, kind: 'task', scope: 'public' }],
        links: [graph().links[0] as ReferenceGraph['links'][number]],
      }),
    );
    expect(lines.some((line) => line.startsWith('edges further out'))).toBe(false);
    expect(lines.some((line) => line.startsWith('reached, by distance'))).toBe(false);
    expect(lines).toContain('its own edges (1)');
  });

  it('still says when the depth cut the answer', () => {
    const lines = referenceReport(renderPlain, graph({ truncated: true }));
    expect(lines.at(-1)).toContain('cut at 2 hop(s)');
  });
});
