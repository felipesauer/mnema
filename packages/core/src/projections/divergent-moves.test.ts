/**
 * `divergentMoves`: a subject moved out of one state on two machines that did not see each
 * other is SAID, and only that is said.
 *
 * The two-machine record is made the way two clones make it: one tree is copied, each copy
 * moves the same `proposed` decision with its own key, and one copy's tail is merged into the
 * other. Every event in it is one the product's own operations appended — no state, key or
 * order in it that the product could not have written.
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CatalogEvent, catalogUpcasters, openChainForWriting, verify } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acceptDecision,
  type DecisionWriteContext,
  recordDecision,
  rejectDecision,
} from '../workflow/decision-operations.js';
import { DECISION_TRANSITIONS } from '../workflow/decision-transitions.js';
import { SKILL_TRANSITIONS } from '../workflow/skill-transitions.js';
import { TRANSITIONS } from '../workflow/transitions.js';
import { projectDecisions } from './decision.js';
import { divergentMoves } from './divergent-moves.js';
import { orderedEvents } from './order.js';

const upcasters = catalogUpcasters();
let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
});

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function machine(tree: string, keyRoot: string): DecisionWriteContext {
  return {
    writer: openChainForWriting(tree, { keyRoot }),
    layout: { root: tree },
    upcasters,
    clock: () => '2026-10-01T00:00:00.000Z',
  };
}

/** Accepted on machine A and rejected on machine B, from one `proposed`, then merged into A. */
function twoMachinesMovedOneDecision(): { tree: string; id: string } {
  const treeA = tmp('mnema-divergent-a-');
  const a = machine(treeA, tmp('mnema-divergent-key-a-'));
  const recorded = recordDecision(a, { title: 'Use SQLite', rationale: 'Relational load.' });
  if (!recorded.ok) throw new Error(recorded.message);
  a.writer.checkpoint();

  // B clones A's tree as it is now, and works offline from there.
  const treeB = tmp('mnema-divergent-b-');
  cpSync(treeA, treeB, { recursive: true });
  const b = machine(treeB, tmp('mnema-divergent-key-b-'));

  const accepted = acceptDecision(a, { id: recorded.id, fields: { note: 'agreed' } });
  const rejected = rejectDecision(b, { id: recorded.id, fields: { note: 'too small' } });
  if (!accepted.ok || !rejected.ok) throw new Error('setup: a move was refused');
  a.writer.checkpoint();
  b.writer.checkpoint();

  // The merge: B's tail and B's key arrive in A's tree. A's own tail is not touched — B's
  // copy of it is the older prefix.
  cpSync(join(treeB, 'tails', b.writer.tail), join(treeA, 'tails', b.writer.tail), {
    recursive: true,
  });
  cpSync(join(treeB, 'keys'), join(treeA, 'keys'), { recursive: true });
  return { tree: treeA, id: recorded.id };
}

function eventsOf(tree: string): CatalogEvent[] {
  return orderedEvents({ root: tree }, upcasters);
}

describe('divergentMoves', () => {
  it('says the decision two machines moved out of `proposed`, with both moves as evidence', () => {
    const { tree, id } = twoMachinesMovedOneDecision();
    const found = divergentMoves(eventsOf(tree));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'decision', entityId: id, from: 'proposed' });
    const tos = found[0]?.evidence.map((e) =>
      e.kind === 'decision.transitioned' ? e.payload.to : '',
    );
    expect([...(tos ?? [])].sort()).toEqual(['accepted', 'rejected']);
    // The record itself is unchanged by being read: it verifies, and the projection still
    // keeps one state — the reading says there were two moves, it does not pick one.
    expect(verify(tree, upcasters)).toMatchObject({ ok: true });
    expect(['accepted', 'rejected']).toContain(projectDecisions(eventsOf(tree)).get(id)?.state);
  });

  it('says nothing about a record whose subjects each left a state once', () => {
    const tree = tmp('mnema-divergent-one-');
    const a = machine(tree, tmp('mnema-divergent-key-'));
    const recorded = recordDecision(a, { title: 'Use SQLite', rationale: 'r' });
    if (!recorded.ok) throw new Error(recorded.message);
    const accepted = acceptDecision(a, { id: recorded.id, fields: { note: 'agreed' } });
    if (!accepted.ok) throw new Error(accepted.message);
    expect(divergentMoves(eventsOf(tree))).toEqual([]);
    expect(divergentMoves([])).toEqual([]);
  });
});

describe('the rule holds only where the machine has no cycle', () => {
  /** Whether a state can be left twice by honest, sequential moves: some cycle reaches it. */
  function hasCycle(table: readonly { from: string; to: string }[]): boolean {
    const next = new Map<string, string[]>();
    for (const t of table) next.set(t.from, [...(next.get(t.from) ?? []), t.to]);
    const reaches = (from: string, target: string, seen: Set<string>): boolean =>
      (next.get(from) ?? []).some(
        (to) => to === target || (!seen.has(to) && reaches(to, target, seen.add(to))),
      );
    return table.some((t) => reaches(t.from, t.from, new Set()));
  }

  it('the decision and skill tables, which it reads, have none', () => {
    expect(hasCycle(DECISION_TRANSITIONS)).toBe(false);
    expect(hasCycle(SKILL_TRANSITIONS)).toBe(false);
  });

  it('the task table, which it does not read, has one — a reopened task leaves a state again', () => {
    expect(hasCycle(TRANSITIONS)).toBe(true);
  });
});
