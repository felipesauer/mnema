import { describe, expect, it } from 'vitest';
import {
  detailText,
  judgeArgs,
  LIST_ARGS,
  newlyProposed,
  noteProblem,
  type Proposed,
  readDetail,
  readProposed,
} from './proposed.js';

const hit = (id: string, title = 'Use X') => ({
  id,
  kind: 'decision',
  scope: 'public',
  at: '2026-10-04T04:03:41.208Z',
  title,
  state: 'proposed',
});

describe('the decisions waiting for a judgment', () => {
  it('asks the CLI for the proposed decisions, as JSON', () => {
    expect(LIST_ARGS).toEqual([
      'search',
      '--kind',
      'decision',
      '--state',
      'proposed',
      '--limit',
      '200',
      '--json',
    ]);
  });

  it('reads the hits and the total, and drops what is not a decision', () => {
    const json = JSON.stringify({ hits: [hit('a'), { ...hit('b'), kind: 'memory' }], total: 7 });
    expect(readProposed(json)).toEqual({
      items: [{ id: 'a', title: 'Use X', scope: 'public', at: '2026-10-04T04:03:41.208Z' }],
      total: 7,
    });
  });

  it('reads nothing out of what is not the answer', () => {
    expect(readProposed('nope')).toEqual({ items: [], total: 0 });
    expect(readProposed('{"hits": 1}')).toEqual({ items: [], total: 0 });
  });

  it('reads the justification and the alternatives, and leaves an absent one absent', () => {
    const json = JSON.stringify({
      record: { adr: 'ADR-1', title: 'Use X', rationale: 'because Y', alternatives: 'Z, too slow' },
    });
    expect(readDetail(json)).toEqual({
      adr: 'ADR-1',
      rationale: 'because Y',
      alternatives: 'Z, too slow',
    });
    expect(readDetail('{"record": {"rationale": ""}}')).toEqual({
      adr: undefined,
      rationale: undefined,
      alternatives: undefined,
    });
  });

  it('shows a person the title, why and what was turned down', () => {
    const item = readProposed(JSON.stringify({ hits: [hit('a')] })).items[0] as Proposed;
    expect(detailText(item, { adr: 'ADR-1', rationale: 'because Y', alternatives: 'Z' })).toBe(
      'ADR-1: Use X\nscope: public\n\nWhy:\nbecause Y\n\nAlternatives:\nZ',
    );
    expect(detailText(item, undefined)).toBe('a: Use X\nscope: public');
  });

  it('announces what is new since the last reading, and nothing on the first', () => {
    const a = readProposed(JSON.stringify({ hits: [hit('a')] })).items;
    const ab = readProposed(JSON.stringify({ hits: [hit('a'), hit('b')] })).items;
    expect(newlyProposed(undefined, ab)).toEqual([]);
    expect(newlyProposed(new Set(['a']), ab).map((i) => i.id)).toEqual(['b']);
    expect(newlyProposed(new Set(['a', 'b']), a)).toEqual([]);
  });
});

describe('a judgment is the verb of the command line, with the note', () => {
  it('builds `decision move <verdict> <id> --note <note>` as an array', () => {
    expect(judgeArgs('accept', 'id-1', 'ok; rm -rf /')).toEqual([
      'decision',
      'move',
      'accept',
      'id-1',
      '--note',
      'ok; rm -rf /',
    ]);
    expect(judgeArgs('reject', 'id-1', 'no')[2]).toBe('reject');
  });

  it('refuses an empty note, and one of only spaces', () => {
    expect(noteProblem('')).toBe('A note is required: say why.');
    expect(noteProblem('  \n ')).toBe('A note is required: say why.');
    expect(noteProblem('because')).toBeUndefined();
  });
});
