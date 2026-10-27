import { describe, expect, it } from 'vitest';
import {
  acceptStamp,
  judgeArgs,
  judgeLabel,
  judgedText,
  LIST_ARGS,
  noteProblem,
  type Proposed,
  proposedTooltip,
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
    expect(readProposed('nope')).toBeUndefined();
    expect(readProposed('{"hits": 1}')).toBeUndefined();
    expect(readProposed('{"total": 0}')).toBeUndefined();
    expect(readProposed('{"hits": []}')).toEqual({ items: [], total: 0 });
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

  it('gives the item a short tooltip: the title, the ADR and the start of the justification, and nothing it was not told', () => {
    const item = readProposed(JSON.stringify({ hits: [hit('a')] }))?.items[0] as Proposed;
    expect(proposedTooltip(item, { adr: 'ADR-1', rationale: 'because Y', alternatives: 'Z' })).toBe(
      'ADR-1: Use X\n\nbecause Y',
    );
    expect(proposedTooltip(item, undefined)).toBe('a: Use X');
    const long = 'w'.repeat(500);
    const cut = proposedTooltip(item, { adr: 'ADR-1', rationale: long, alternatives: undefined });
    expect(cut).toBe(`ADR-1: Use X\n\n${'w'.repeat(159)}\u2026`);
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

describe('the note an accept can carry without typing', () => {
  it("is a true stamp of the day, in the person's own calendar, and says no reason was typed", () => {
    expect(acceptStamp(new Date(2026, 9, 27, 23, 59, 59))).toBe(
      '2026-10-27, accepted in the VS Code extension, no reason typed',
    );
    expect(acceptStamp(new Date(2026, 0, 5, 0, 0, 1))).toBe(
      '2026-01-05, accepted in the VS Code extension, no reason typed',
    );
  });

  it('is a note the command line takes, and is never longer than a line', () => {
    expect(noteProblem(acceptStamp(new Date(2026, 9, 27)))).toBeUndefined();
    expect(acceptStamp(new Date(2026, 9, 27))).not.toContain('\n');
  });
});

describe('what is shown when a judgment was recorded', () => {
  it('shortens the line of the command line to the decision and the verdict it said', () => {
    expect(
      judgedText('Decision ADR-2 (01a17ec1-82a8-7000-aa02-882530aee21f) \u2192 accepted\n'),
    ).toBe('ADR-2 accepted.');
    expect(judgedText('Decision ADR-3 (x) \u2192 rejected')).toBe('ADR-3 rejected.');
  });

  it('shows a line it does not recognize as it came, and never writes a verdict the line did not say', () => {
    expect(judgedText('Recorded.\nmore')).toBe('Recorded.');
    expect(judgedText('Decision ADR-2 (x) \u2192 superseded')).toBe(
      'Decision ADR-2 (x) \u2192 superseded',
    );
    expect(judgedText('')).toBe('Recorded.');
  });
});

describe('what a judgment box is titled', () => {
  it('names the decision by its ADR, and by the start of its id when there is none', () => {
    expect(judgeLabel('accept', 'ADR-1', 'abcdef0123')).toBe('Accept ADR-1');
    expect(judgeLabel('reject', undefined, 'abcdef0123')).toBe('Reject abcdef01');
  });
});
