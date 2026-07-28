import { type CatalogEvent, skillCreated, skillTransitioned } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { projectSkills } from './skill.js';

const at = (n: number) => `2026-07-23T00:00:0${n}.000Z`;
const env = (subject: string, n: number, which?: string) => ({
  at: at(n),
  who: 'felipe',
  signerFp: 'fp-1',
  subject,
  ...(which !== undefined ? { which } : {}),
});

/** The birth pair of a skill, as ordered events. */
function birth(id: string, n = 0, which?: string): CatalogEvent[] {
  return [
    skillCreated(env(id, n, which), { name: `name ${id}`, body: `body ${id}` }),
    skillTransitioned(env(id, n, which), { from: null, to: 'proposed', action: 'create' }),
  ];
}

/** A transition into `adopted`, optionally executed by an agent. */
function adopt(id: string, n: number, which?: string): CatalogEvent {
  return skillTransitioned(env(id, n, which), {
    from: 'reviewed',
    to: 'adopted',
    action: 'adopt',
    fields: { note: 'use it' },
  });
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

describe('projectSkills — provenance: who proposed the pattern and who adopted it', () => {
  it('folds the agent that proposed it and the agent that adopted it', () => {
    const events = [...birth('sk-1', 0, 'agent-A'), adopt('sk-1', 2, 'agent-A')];
    expect(projectSkills(events).get('sk-1')).toMatchObject({
      proposedBy: 'agent-A',
      adoption: { at: at(2), by: 'agent-A' },
    });
  });

  it('an ABSENT `which` is a person acting directly, never a fabricated name', () => {
    const events = [...birth('sk-1'), adopt('sk-1', 2)];
    const skill = projectSkills(events).get('sk-1');
    // The adoption HAPPENED (the object is there) and no agent made it.
    expect(skill?.adoption).toEqual({ at: at(2) });
    expect(skill).not.toHaveProperty('proposedBy');
    expect(skill?.adoption).not.toHaveProperty('by');
  });

  it('distinguishes a pattern nobody adopted from one a PERSON adopted', () => {
    const proposed = projectSkills(birth('sk-1')).get('sk-1');
    const adopted = projectSkills([...birth('sk-2'), adopt('sk-2', 2)]).get('sk-2');
    // The difference the flat pair could not express: no adoption at all versus
    // an adoption with no agent behind it.
    expect(proposed).not.toHaveProperty('adoption');
    expect(adopted?.adoption).toEqual({ at: at(2) });
  });

  it('keeps the two ends apart when one agent proposed and another adopted', () => {
    const events = [...birth('sk-1', 0, 'agent-A'), adopt('sk-1', 2, 'agent-B')];
    expect(projectSkills(events).get('sk-1')).toMatchObject({
      proposedBy: 'agent-A',
      adoption: { at: at(2), by: 'agent-B' },
    });
  });

  it('a review does not count as an adoption (only the literal `to` does)', () => {
    const events = [
      ...birth('sk-1', 0, 'agent-A'),
      skillTransitioned(env('sk-1', 1, 'agent-B'), {
        from: 'proposed',
        to: 'reviewed',
        action: 'review',
        fields: { note: 'looked' },
      }),
    ];
    expect(projectSkills(events).get('sk-1')).not.toHaveProperty('adoption');
  });

  it('keeps the adoption after the pattern is deprecated — it WAS live, and by whom', () => {
    const events = [
      ...birth('sk-1', 0, 'agent-A'),
      adopt('sk-1', 2, 'agent-A'),
      skillTransitioned(env('sk-1', 3), {
        from: 'adopted',
        to: 'deprecated',
        action: 'deprecate',
        fields: { reason: 'unused' },
      }),
    ];
    const skill = projectSkills(events).get('sk-1');
    expect(skill?.state).toBe('deprecated');
    expect(skill?.adoption).toEqual({ at: at(2), by: 'agent-A' });
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
