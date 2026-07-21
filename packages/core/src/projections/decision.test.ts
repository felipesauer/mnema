import { type CatalogEvent, decisionRecorded, decisionTransitioned } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { adrCollisions, type DecisionProjection, projectDecisions } from './decision.js';

const at = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
const env = (subject: string, n: number) => ({ at: at(n), who: 'felipe', subject });

/** The birth pair of a decision, as ordered events. */
function birth(id: string, adr: string, n = 0): CatalogEvent[] {
  return [
    decisionRecorded(env(id, n), { title: `title ${id}`, rationale: `why ${id}`, adr }),
    decisionTransitioned(env(id, n), { from: null, to: 'proposed', action: 'create' }),
  ];
}

describe('projectDecisions — the fold', () => {
  it('projects a recorded decision in its initial state', () => {
    const d = projectDecisions(birth('d-1', 'ADR-1'));
    expect(d.get('d-1')).toEqual({
      id: 'd-1',
      adr: 'ADR-1',
      title: 'title d-1',
      rationale: 'why d-1',
      state: 'proposed',
      createdAt: at(0),
      updatedAt: at(0),
    });
  });

  it('reads state from the last transition (accept)', () => {
    const events = [
      ...birth('d-1', 'ADR-1'),
      decisionTransitioned(env('d-1', 1), {
        from: 'proposed',
        to: 'accepted',
        action: 'accept',
        fields: { note: 'agreed' },
      }),
    ];
    const d = projectDecisions(events).get('d-1');
    expect(d?.state).toBe('accepted');
    expect(d?.updatedAt).toBe(at(1));
  });

  it('drops a subject with transitions but no record (truncated tail)', () => {
    // A transition with no `decision.recorded` is not a complete decision.
    const events = [
      decisionTransitioned(env('d-1', 0), { from: null, to: 'proposed', action: 'create' }),
    ];
    expect(projectDecisions(events).has('d-1')).toBe(false);
  });
});

describe('projectDecisions — supersede updates both sides', () => {
  it('marks the subject superseded and links both directions', () => {
    const events = [
      ...birth('d-1', 'ADR-1', 0),
      ...birth('d-2', 'ADR-2', 1),
      // d-2 supersedes d-1: the event's subject is d-1 (the superseded one).
      decisionTransitioned(env('d-1', 2), {
        from: 'proposed',
        to: 'superseded',
        action: 'supersede',
        by: 'd-2',
        fields: { reason: 'replaced by d-2' },
      }),
    ];
    const projected = projectDecisions(events);
    const superseded = projected.get('d-1');
    const successor = projected.get('d-2');
    expect(superseded?.state).toBe('superseded');
    expect(superseded?.supersededBy).toBe('d-2');
    // The successor gains the inverse link and keeps its own state.
    expect(successor?.supersedes).toBe('d-1');
    expect(successor?.state).toBe('proposed');
    expect(successor?.supersededBy).toBeUndefined();
  });

  it('does not fabricate a successor that has no record of its own', () => {
    // A supersede naming a `by` with no decision.recorded (only possible from a
    // truncated tail; the writer refuses a dangling by) must not materialize an
    // incomplete successor row.
    const events = [
      ...birth('d-1', 'ADR-1'),
      decisionTransitioned(env('d-1', 2), {
        from: 'proposed',
        to: 'superseded',
        action: 'supersede',
        by: 'd-ghost',
        fields: { reason: 'r' },
      }),
    ];
    const projected = projectDecisions(events);
    expect(projected.get('d-1')?.supersededBy).toBe('d-ghost');
    expect(projected.has('d-ghost')).toBe(false); // no record → not projected
  });
});

describe('adrCollisions — the label collision detector', () => {
  const mk = (id: string, adr: string): DecisionProjection => ({
    id,
    adr,
    title: 't',
    rationale: 'r',
    state: 'proposed',
    createdAt: at(0),
    updatedAt: at(0),
  });

  it('reports nothing when every label is unique', () => {
    expect(adrCollisions([mk('d-1', 'ADR-1'), mk('d-2', 'ADR-2')])).toEqual([]);
  });

  it('reports a label held by two decisions, with sorted ids', () => {
    const collisions = adrCollisions([mk('d-2', 'ADR-7'), mk('d-1', 'ADR-7')]);
    expect(collisions).toEqual([{ adr: 'ADR-7', ids: ['d-1', 'd-2'] }]);
  });

  it('reports multiple distinct collisions in a stable label order', () => {
    const collisions = adrCollisions([
      mk('d-1', 'ADR-3'),
      mk('d-2', 'ADR-3'),
      mk('d-3', 'ADR-1'),
      mk('d-4', 'ADR-1'),
      mk('d-5', 'ADR-9'), // unique, not reported
    ]);
    expect(collisions).toEqual([
      { adr: 'ADR-1', ids: ['d-3', 'd-4'] },
      { adr: 'ADR-3', ids: ['d-1', 'd-2'] },
    ]);
  });
});
