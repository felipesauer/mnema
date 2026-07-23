import { type CatalogEvent, skillCreated, skillTransitioned } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { projectSkills } from './skill.js';

const at = (n: number) => `2026-07-23T00:00:0${n}.000Z`;
const env = (subject: string, n: number) => ({
  at: at(n),
  who: 'felipe',
  signerFp: 'fp-1',
  subject,
});

/** The birth pair of a skill, as ordered events. */
function birth(id: string, n = 0): CatalogEvent[] {
  return [
    skillCreated(env(id, n), { name: `name ${id}`, body: `body ${id}` }),
    skillTransitioned(env(id, n), { from: null, to: 'proposed', action: 'create' }),
  ];
}

describe('projectSkills — the fold', () => {
  it('projects a created skill in its initial state', () => {
    const s = projectSkills(birth('sk-1'));
    expect(s.get('sk-1')).toEqual({
      id: 'sk-1',
      name: 'name sk-1',
      body: 'body sk-1',
      state: 'proposed',
      createdAt: at(0),
      updatedAt: at(0),
    });
  });

  it('reads state from the last transition (adopt)', () => {
    const events = [
      ...birth('sk-1'),
      skillTransitioned(env('sk-1', 1), {
        from: 'proposed',
        to: 'reviewed',
        action: 'review',
        fields: { note: 'looked' },
      }),
      skillTransitioned(env('sk-1', 2), {
        from: 'reviewed',
        to: 'adopted',
        action: 'adopt',
        fields: { note: 'use it' },
      }),
    ];
    const s = projectSkills(events).get('sk-1');
    expect(s?.state).toBe('adopted');
    expect(s?.updatedAt).toBe(at(2));
  });

  it('drops a subject with transitions but no record (truncated tail)', () => {
    const events = [
      skillTransitioned(env('sk-1', 0), { from: null, to: 'proposed', action: 'create' }),
    ];
    expect(projectSkills(events).has('sk-1')).toBe(false);
  });

  it('drops a subject with a record but no transition (torn birth)', () => {
    const events = [skillCreated(env('sk-1', 0), { name: 'n', body: 'b' })];
    expect(projectSkills(events).has('sk-1')).toBe(false);
  });

  it('is NOT relational — no supersededBy/supersedes field exists on the projection', () => {
    const s = projectSkills(birth('sk-1')).get('sk-1');
    expect(s).not.toHaveProperty('supersededBy');
    expect(s).not.toHaveProperty('supersedes');
  });
});

describe('projectSkills — state is the literal `to`, never re-derived from a workflow', () => {
  it('replays a state this build has never seen (the E3 lesson)', () => {
    // A future workflow might add a state the fold does not know; the projection
    // must still report the literal `to`, because state is read from the fact,
    // not judged against today's table.
    const events = [
      ...birth('sk-1'),
      skillTransitioned(env('sk-1', 1), { from: 'proposed', to: 'archived', action: 'archive' }),
    ];
    expect(projectSkills(events).get('sk-1')?.state).toBe('archived');
  });
});
