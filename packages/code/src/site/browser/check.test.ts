/**
 * THE CHECK OF THE LISTS, ON ITS OWN (`check.ts`).
 *
 * `the-lists-are-checked-in-the-browser.test.ts` runs the whole script over real records in a vm.
 * Here `checkLists` is handed a page (the HTML `renderPage` writes, parsed by the fake DOM) and the
 * lists the events derive, so each way a difference is named, and each way it is not, is held where
 * it is made: the item it names, the field, the text outside every field, the ids on one side only,
 * the order, the counts. And `showListsCheck` says `unchecked`, never `match`, over a record that did
 * not verify or whose events cannot be derived.
 */

import { describe, expect, it } from 'vitest';
import { FakePage } from '../../../tests/support/a-page-in-a-vm.js';
import type { PageDecision, PageModel } from '../model.js';
import { renderPage } from '../page.js';
import { checkLists, showListsCheck } from './check.js';

const decision = (over: Partial<PageDecision>): PageDecision => ({
  id: 'd-1',
  adr: 'ADR-1',
  adrIsUnique: true,
  title: 'Keep money in cents',
  rationale: 'floats lose a cent',
  state: 'accepted',
  inForce: true,
  createdAt: '2026-01-05T10:00:00.000Z',
  recordedBy: { who: 'mnid:alice' },
  moves: [],
  notes: [],
  addresses: [],
  linkedTo: [],
  ...over,
});

const derived = (
  decisions: PageDecision[],
): { model: PageModel; tails: { id: string; events: number }[] } => ({
  model: {
    decisions,
    otherNotes: [],
    timeline: [],
    counts: { decisions: decisions.length, inForce: decisions.length, notes: 0, timeline: 0 },
  },
  tails: [{ id: 'tail-a', events: 3 }],
});

const pageOf = (d: ReturnType<typeof derived>): FakePage =>
  new FakePage(renderPage({ ...d.model, tails: d.tails, files: {} }, '/*v*/'));

const TWO = derived([
  decision({}),
  decision({ id: 'd-2', adr: 'ADR-2', title: 'Dates in UTC', state: 'proposed', inForce: false }),
]);

describe('the lists a page writes, held against the events they come from', () => {
  it('have no difference when the page is what the events give', () => {
    expect(checkLists(pageOf(TWO), TWO)).toEqual([]);
  });

  it('name an item whose text is another, with what the page says and what the events say', () => {
    const lied = derived([
      decision({}),
      decision({ id: 'd-2', adr: 'ADR-2', title: 'Dates in UTC', state: 'accepted' }),
    ]);
    const said = checkLists(pageOf(lied), TWO);
    expect(said).toContain('ADR-2 (state): the page says "accepted"; the events say "proposed"');
    expect(
      said.some((line) => line.startsWith('ADR-2: its attribute data-state says "accepted"')),
    ).toBe(true);
  });

  it('name a decision on one side only, and the order when both sides have both', () => {
    const fewer = derived([decision({})]);
    expect(checkLists(pageOf(fewer), TWO)).toContain(
      'ADR-2 is in the events and not on the page (decisions)',
    );
    expect(checkLists(pageOf(TWO), fewer)).toContain(
      'ADR-2 is on the page and not in the events (decisions)',
    );
    const reversed = derived([...(TWO.model.decisions as PageDecision[])].reverse());
    expect(checkLists(pageOf(reversed), TWO)).toContain(
      'the decisions are in another order on the page than the events give',
    );
  });

  it('name a tail that holds another number of lines, and the counts line', () => {
    const more = { ...TWO, tails: [{ id: 'tail-a', events: 4 }] };
    const said = checkLists(pageOf(more), TWO);
    expect(said).toContain('tail tail-a (tail-events): the page says "4"; the events say "3"');
    expect(said.some((line) => line.startsWith('the counts line: '))).toBe(true);
  });

  it('say what is written outside every field only when no field differs', () => {
    const html = renderPage({ ...TWO.model, tails: TWO.tails, files: {} }, '/*v*/').replace(
      '</article>',
      '<p>Agreed in a hallway.</p></article>',
    );
    const said = checkLists(new FakePage(html), TWO);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(
      /^ADR-1: the page says something the events do not give, outside its fields: the page says ".*Agreed in a hallway/,
    );
  });

  it('shorten what a card that is something else altogether would say, and count the rest', () => {
    const html = renderPage({ ...TWO.model, tails: TWO.tails, files: {} }, '/*v*/').replaceAll(
      'data-field=',
      'data-fieldx=',
    );
    const said = checkLists(new FakePage(html), TWO).filter((line) => line.startsWith('ADR-1'));
    expect(said).toHaveLength(5);
    expect(said.at(-1)).toMatch(/^ADR-1: and \d+ more differences$/);
  });
});

describe('the answer a page keeps', () => {
  const answer = (): { page: FakePage; read: () => [string | null, string | null] } => {
    const page = pageOf(TWO);
    return {
      page,
      read: () => [
        page.getElementById('lists-status')?.getAttribute('data-state') ?? null,
        page.getElementById('lists-summary')?.textContent ?? null,
      ],
    };
  };

  it('is `unchecked` and never `match` over a record that did not verify', () => {
    const { page, read } = answer();
    showListsCheck(page, {}, false);
    expect(read()).toEqual([
      'unchecked',
      'The record did not verify, so the lists on this page were not checked against it.',
    ]);
  });

  it('is `unchecked`, saying why, when the events cannot be derived from the files', () => {
    const { page, read } = answer();
    showListsCheck(page, { 'tails/x/000001.jsonl': '*** not base64 ***' }, true);
    const [state, summary] = read();
    expect(state).toBe('unchecked');
    expect(summary).toMatch(
      /^The lists on this page were not checked: the events could not be derived/,
    );
  });
});
