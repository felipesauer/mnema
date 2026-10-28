import type { DecisionProjection } from '@mnema/core';
import { describe, expect, it } from 'vitest';
import {
  addressOfferLines,
  decisionsCited,
  decisionsInView,
  MOST_OFFERS_NAMED,
  MOST_PATHS_NAMED,
  readableFrom,
  supersedeOfferLines,
} from './offers-beside-a-recorded-decision.js';
import { tellsWhatToDo } from './record-framing.js';

const OLD = '01a18000-0000-7000-8000-000000000001';
const NEW = '01a18000-0000-7000-8000-000000000002';

function held(id: string, adr: string, state: string, title = `Title of ${adr}`) {
  return {
    id,
    adr,
    title,
    rationale: 'secret rationale',
    state,
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  } as DecisionProjection;
}

const TEXT = { title: 'Refine the store', rationale: 'refines ADR-1' };

describe('decisionsCited', () => {
  it('finds a label and a full id, in the order they are first cited, once each', () => {
    const decisions = [held(OLD, 'ADR-1', 'accepted'), held('x-2', 'ADR-2', 'proposed')];
    const cited = decisionsCited(
      { title: 'ADR-2 again', rationale: `replaces ${OLD} and ADR-1`, alternatives: 'ADR-2' },
      decisions,
      NEW,
    );
    expect(cited.map((c) => c.adr)).toEqual(['ADR-2', 'ADR-1']);
  });

  it('offers a decision only where a supersede is legal, and never the one just recorded', () => {
    const decisions = [
      held('r', 'ADR-1', 'rejected'),
      held('s', 'ADR-2', 'superseded'),
      held('p', 'ADR-3', 'proposed'),
      held(NEW, 'ADR-4', 'proposed'),
    ];
    const cited = decisionsCited(
      { title: 't', rationale: 'ADR-1 ADR-2 ADR-3 ADR-4' },
      decisions,
      NEW,
    );
    expect(cited.map((c) => c.adr)).toEqual(['ADR-3']);
  });

  it('lists every decision a label names, since two trees number their own', () => {
    const cited = decisionsCited(
      TEXT,
      [held('a', 'ADR-1', 'accepted'), held('b', 'ADR-1', 'proposed')],
      NEW,
    );
    expect(cited.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('does not take ADR-10 for ADR-1', () => {
    expect(decisionsCited(TEXT, [held('a', 'ADR-10', 'accepted')], NEW)).toEqual([]);
  });

  it('never carries a rationale', () => {
    const [offer] = decisionsCited(TEXT, [held(OLD, 'ADR-1', 'accepted')], NEW);
    expect(JSON.stringify(offer)).not.toContain('secret');
  });
});

describe('decisionsInView', () => {
  const sources = [
    { scope: 'public' as const, decisions: [held('pub', 'ADR-1', 'accepted')] },
    { scope: 'private' as const, decisions: [held('priv', 'ADR-1', 'accepted', 'Private title')] },
    { scope: 'global' as const, decisions: [held('glob', 'ADR-1', 'accepted')] },
  ];
  const idsFrom = (landing: 'public' | 'private' | 'global') =>
    decisionsInView(sources, landing, (source) => source.decisions).map((d) => d.id);

  it('offers only the tree the decision landed in, which is where a supersede finds its successor', () => {
    expect(idsFrom('public')).toEqual(['pub']);
    expect(idsFrom('private')).toEqual(['priv']);
    expect(idsFrom('global')).toEqual(['glob']);
    expect(readableFrom('public')).toEqual(['public']);
  });
});

describe('supersedeOfferLines', () => {
  const offer = { id: OLD, adr: 'ADR-1', title: 'Use SQLite', state: 'accepted' };
  const recorded = { id: NEW, adr: 'ADR-2' };

  it('names the call of each door and says nothing was moved', () => {
    const mcp = supersedeOfferLines([offer], recorded, 'mcp').join('\n');
    expect(mcp).toContain('Nothing was moved');
    expect(mcp).toContain(
      `decision_transition with id "${OLD}", action "supersede", by "${NEW}", reason "<why>"`,
    );
    const cli = supersedeOfferLines([offer], recorded, 'cli').join('\n');
    expect(cli).toContain(`mnema decision supersede ${OLD} ${NEW} --reason "<why>"`);
  });

  it('says nothing when nothing is cited, and counts what a cap leaves out', () => {
    expect(supersedeOfferLines([], recorded, 'mcp')).toEqual([]);
    const many = Array.from({ length: 30 }, (_, at) => ({ ...offer, id: `id-${at}` }));
    const lines = supersedeOfferLines(many, recorded, 'mcp');
    expect(lines).toHaveLength(1 + MOST_OFFERS_NAMED + 1);
    expect(lines.at(-1)).toBe('  and 25 more cited, not listed.');
  });

  it('says what it saw and not what to do', () => {
    for (const by of ['mcp', 'cli'] as const) {
      expect(tellsWhatToDo(supersedeOfferLines([offer], recorded, by).join('\n'))).toBeUndefined();
    }
  });

  it('keeps a title with a line break on one line', () => {
    const lines = supersedeOfferLines([{ ...offer, title: 'a\nb' }], recorded, 'mcp');
    expect(lines).toHaveLength(2);
  });
});

describe('addressOfferLines', () => {
  const recorded = { id: NEW, adr: 'ADR-2' };

  it('says nothing without a path, and addresses at the latest one', () => {
    expect(addressOfferLines([], recorded, 'public')).toEqual([]);
    const lines = addressOfferLines(['src/b.ts', 'src/a.ts'], recorded, 'public');
    expect(lines.join('\n')).toContain('src/b.ts, src/a.ts');
    expect(lines.join('\n')).toContain('nothing was linked');
    expect(lines[1]).toBe(
      `  link_knowledge with subject "${NEW}", rel "governs", target "src/b.ts"`,
    );
    expect(tellsWhatToDo(lines.join('\n'))).toBeUndefined();
  });

  it('keeps the tree the decision landed in on the call, and caps the list', () => {
    const paths = Array.from({ length: 12 }, (_, at) => `src/f${at}.ts`);
    const lines = addressOfferLines(paths, recorded, 'private');
    expect(lines[0]).toContain(`src/f${MOST_PATHS_NAMED - 1}.ts, and 2 more`);
    expect(lines[0]).not.toContain('src/f10.ts');
    expect(lines[1]).toContain('scope "private"');
  });
});
