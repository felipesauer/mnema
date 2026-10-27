import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  acceptStamp,
  judgeArgs,
  judgedText,
  judgeLabel,
  LIST_ARGS,
  noteProblem,
  type Proposed,
  proposedTooltip,
  readProposed,
  readStatus,
  STATUS_ARGS,
  wasCut,
  withAdrs,
} from './proposed.js';

/** What the command line built for a sample project: see the fixtures' own names. */
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');

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

  it('asks the CLI for what awaits a judgment with one status', () => {
    expect(STATUS_ARGS).toEqual(['status', '--json']);
  });

  it('reads the decisions status served with their ADR, in its order, and says how many it counted', () => {
    const read = readStatus(fixture('status-2-awaiting'));
    expect(read?.items.map((item) => [item.adr, item.title])).toEqual([
      ['ADR-2', 'Keep the CLI free of a daemon'],
      ['ADR-1', 'Use SQLite for the cache'],
    ]);
    expect(read?.served).toBe(2);
    expect(read?.total).toBe(2);
    expect(read && wasCut(read)).toBe(false);
    for (const item of read?.items ?? []) expect(item).not.toHaveProperty('scope');
  });

  it('knows status cut its list: 25 counted and 20 served', () => {
    const read = readStatus(fixture('status-25-awaiting'));
    expect(read?.items).toHaveLength(20);
    expect(read?.served).toBe(20);
    expect(read?.total).toBe(25);
    expect(read && wasCut(read)).toBe(true);
  });

  it('reads nothing awaiting from an answer that holds none, and nothing from what is not the answer', () => {
    const read = readStatus(fixture('status-nothing-awaits'));
    expect(read).toEqual({ items: [], served: 0, total: 0 });
    expect(readStatus('nope')).toBeUndefined();
    expect(readStatus('{"awaitingJudgement": 1}')).toBeUndefined();
    expect(readStatus('{"awaitingJudgementTotal": 3}')).toBeUndefined();
    expect(readStatus('[]')).toBeUndefined();
  });

  it('keeps only the decisions of what awaits, and counts the others as served', () => {
    const answer = JSON.parse(fixture('status-2-awaiting')) as {
      awaitingJudgement: Record<string, unknown>[];
    };
    answer.awaitingJudgement[1] = { ...answer.awaitingJudgement[1], kind: 'skill' };
    const read = readStatus(JSON.stringify(answer));
    expect(read?.items.map((item) => item.adr)).toEqual(['ADR-2']);
    expect(read?.served).toBe(2);
  });

  it('lists the search hits with the ADR status gave for the ones it served, and none made up for the rest', () => {
    const served = readStatus(fixture('status-25-awaiting')) as NonNullable<
      ReturnType<typeof readStatus>
    >;
    const searched = readProposed(fixture('search-25-proposed')) as NonNullable<
      ReturnType<typeof readProposed>
    >;
    const joined = withAdrs(searched, served.items);
    expect(joined.total).toBe(25);
    expect(joined.items).toHaveLength(25);
    expect(joined.items.slice(0, 20).map((item) => item.adr)).toEqual(
      served.items.map((item) => item.adr),
    );
    for (const item of joined.items.slice(20)) expect(item).not.toHaveProperty('adr');
  });

  it('gives the item a short tooltip: the ADR and the title, or the id when no ADR was said', () => {
    const item = readProposed(JSON.stringify({ hits: [hit('a')] }))?.items[0] as Proposed;
    expect(proposedTooltip({ ...item, adr: 'ADR-1' })).toBe('ADR-1: Use X');
    expect(proposedTooltip(item)).toBe('a: Use X');
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
