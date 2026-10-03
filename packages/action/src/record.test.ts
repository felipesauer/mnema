import { describe, expect, it } from 'vitest';
import { eventsAdded, readEvents, whatItDoes } from './record.js';

/** One line of a tail, the shape the chain writes: the event and the link that chains it. */
const line = (
  hash: string,
  kind: string,
  subject: string,
  payload: Record<string, unknown> = {},
): string => JSON.stringify({ event: { kind, subject, payload }, link: { hash, seq: 0 } });

describe('readEvents', () => {
  it('reads events and leaves out what is not one', () => {
    const text = [
      line('h1', 'decision.recorded', 'd1', { title: 'T' }),
      '',
      'not json',
      JSON.stringify({ seq: 3, through: 'h1' }),
      JSON.stringify({ event: { kind: 'x', subject: 's' }, link: {} }),
      line('h2', 'knowledge.linked', 'ADR-1'),
    ].join('\n');
    expect(readEvents(text).map((e) => [e.hash, e.kind])).toEqual([
      ['h1', 'decision.recorded'],
      ['h2', 'knowledge.linked'],
    ]);
  });
});

describe('eventsAdded', () => {
  it('is what the head holds and the base did not', () => {
    const base = readEvents([line('a', 'k', 's'), line('b', 'k', 's')].join('\n'));
    const head = readEvents(
      [line('a', 'k', 's'), line('b', 'k', 's'), line('c', 'k', 's')].join('\n'),
    );
    expect(eventsAdded(base, head).map((e) => e.hash)).toEqual(['c']);
    expect(eventsAdded(head, head)).toEqual([]);
  });
});

describe('whatItDoes', () => {
  const born = readEvents(
    [
      line('1', 'decision.recorded', 'd1', { adr: 'ADR-1', title: 'Keep money as integer cents' }),
      line('2', 'decision.transitioned', 'd1', { from: null, to: 'proposed', action: 'create' }),
    ].join('\n'),
  );
  const thisPr = readEvents(
    [
      line('3', 'decision.transitioned', 'd1', {
        from: 'proposed',
        to: 'accepted',
        action: 'accept',
      }),
      line('4', 'decision.recorded', 'd2', { adr: 'ADR-2', title: 'Second' }),
      line('5', 'decision.transitioned', 'd2', { from: null, to: 'proposed', action: 'create' }),
      line('6', 'knowledge.linked', 'd1', { rel: 'governs', target: 'src' }),
    ].join('\n'),
  );
  const report = whatItDoes(thisPr, [...born, ...thisPr]);

  it('counts the new events per kind, most numerous first', () => {
    expect(report.total).toBe(4);
    expect(report.byKind).toEqual([
      ['decision.transitioned', 2],
      ['decision.recorded', 1],
      ['knowledge.linked', 1],
    ]);
  });

  it('names a decision moved here by the title and ADR label of its earlier birth', () => {
    expect(report.decisions).toEqual([
      { id: 'd1', adr: 'ADR-1', title: 'Keep money as integer cents', to: ['accepted'] },
      { id: 'd2', adr: 'ADR-2', title: 'Second', to: ['proposed'] },
    ]);
  });

  it('says nothing about a pull request that adds nothing', () => {
    expect(whatItDoes([], born)).toEqual({ total: 0, byKind: [], decisions: [] });
  });
});
