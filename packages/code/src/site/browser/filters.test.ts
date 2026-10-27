/**
 * THE FILTERS SHOW AND HIDE THE CARDS THE PAGE WAS WRITTEN WITH.
 *
 * The page's own script is run over the page `renderPage` writes, in a context shaped like a plain
 * page (`tests/support/a-page-in-a-vm.ts`): the options of the selects are what the cards carry, the
 * filter opens on the decisions in force, each control shows and hides the ids it should, clearing
 * shows everything, and the line "Showing X of Y" says what is left out. The path filter's own
 * rule (a segment, in both directions) is held on its own as well.
 */

import { describe, expect, it } from 'vitest';
import {
  type FakeElement,
  FakePage,
  type PageRun,
  runInAVm,
} from '../../../tests/support/a-page-in-a-vm.js';
import type { PageDecision, PageNote } from '../model.js';
import { renderPage } from '../page.js';
import { theSiteVerifier } from '../verifier-bundle.js';
import { type CardFacts, type Criteria, cardShown, pathMatches, wireFilters } from './filters.js';

const NONE: Criteria = { state: '', who: '', by: '', from: '', to: '', text: '', path: '' };

describe('a typed path and an address', () => {
  it('cover one another by segment, in both directions', () => {
    expect(pathMatches('packages/code', 'packages/code/src/x.ts')).toBe(true);
    expect(pathMatches('packages/code/src/x.ts', 'packages/code')).toBe(true);
    expect(pathMatches('packages', 'packages/code')).toBe(true);
    expect(pathMatches('packages/code', 'packages/code')).toBe(true);
    expect(pathMatches('./packages//code/', 'packages/code')).toBe(true);
  });

  it('do not cover one another by a string prefix, and an empty one covers nothing', () => {
    expect(pathMatches('packages/code', 'packages/codex')).toBe(false);
    expect(pathMatches('packages/codex', 'packages/code')).toBe(false);
    expect(pathMatches('pack', 'packages/code')).toBe(false);
    expect(pathMatches('', 'packages/code')).toBe(false);
    expect(pathMatches('packages/code', '')).toBe(false);
  });
});

describe('a card under what was chosen', () => {
  const card: CardFacts = {
    state: 'accepted',
    force: 'in-force',
    date: '2026-02-10',
    who: ['mnid:a'],
    by: ['agent claude-code'],
    text: 'keep money in cents',
    targets: ['packages/code/src/x.ts'],
  };

  it('is shown when nothing is chosen, and each choice can hide it', () => {
    expect(cardShown(card, NONE)).toBe(true);
    expect(cardShown(card, { ...NONE, state: 'in-force' })).toBe(true);
    expect(cardShown({ ...card, force: 'not-in-force' }, { ...NONE, state: 'in-force' })).toBe(
      false,
    );
    expect(cardShown(card, { ...NONE, state: 'rejected' })).toBe(false);
    expect(cardShown(card, { ...NONE, who: 'mnid:b' })).toBe(false);
    expect(cardShown(card, { ...NONE, by: 'a person' })).toBe(false);
    expect(cardShown(card, { ...NONE, from: '2026-02-11' })).toBe(false);
    expect(cardShown(card, { ...NONE, to: '2026-02-09' })).toBe(false);
    expect(cardShown(card, { ...NONE, from: '2026-02-10', to: '2026-02-10' })).toBe(true);
    expect(cardShown(card, { ...NONE, text: 'DOLLARS' })).toBe(false);
    expect(cardShown(card, { ...NONE, text: 'MONEY' })).toBe(true);
    expect(cardShown(card, { ...NONE, path: 'packages/codex' })).toBe(false);
  });
});

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

const aNote: PageNote = {
  id: 'n-1',
  kind: 'memory',
  text: 'the ledger rounds half to even',
  at: '2026-01-06T00:00:00.000Z',
  who: 'mnid:alice',
};

const DECISIONS = [
  decision({
    acceptedBy: { who: 'mnid:alice', which: 'claude-code' },
    addresses: [{ rel: 'governs', target: 'packages/code/src/x.ts' }],
    notes: [aNote],
  }),
  decision({
    id: 'd-2',
    adr: 'ADR-2',
    title: 'Dates in UTC',
    rationale: 'time zones move',
    state: 'rejected',
    inForce: false,
    createdAt: '2026-02-10T10:00:00.000Z',
    recordedBy: { who: 'mnid:bob' },
    addresses: [{ rel: 'governs', target: 'packages/codex' }],
  }),
  decision({
    id: 'd-3',
    adr: 'ADR-3',
    title: 'One lockfile',
    rationale: 'drift',
    state: 'proposed',
    inForce: false,
    createdAt: '2026-03-15T10:00:00.000Z',
    recordedBy: { who: 'mnid:alice' },
    addresses: [{ rel: 'asks-for-a-person', target: 'packages' }],
  }),
  decision({
    id: 'd-4',
    adr: 'ADR-4',
    title: 'Cents again',
    rationale: 'second thoughts',
    state: 'superseded',
    inForce: false,
    createdAt: '2026-01-20T10:00:00.000Z',
    recordedBy: { who: 'mnid:bob', which: 'codex' },
  }),
];

/** The page the writer makes for the fixture, with its script run and the first paint over. */
function aPage(): PageRun {
  const html = renderPage(
    {
      decisions: DECISIONS,
      otherNotes: [],
      timeline: [],
      counts: { decisions: 4, inForce: 1, notes: 1, timeline: 0 },
      tails: [],
      files: {},
    },
    theSiteVerifier(),
  );
  const run = runInAVm(html, theSiteVerifier());
  run.timers.drain();
  return run;
}

const idOf = (card: FakeElement): string => card.getAttribute('id') as string;
const shown = (run: PageRun): string[] =>
  run.page
    .querySelectorAll('.decision')
    .filter((card) => !card.hidden)
    .map(idOf);
const control = (run: PageRun, id: string): FakeElement =>
  run.page.getElementById(id) as FakeElement;
function choose(run: PageRun, id: string, value: string): void {
  const el = control(run, id);
  el.value = value;
  el.dispatch(el.tag === 'select' ? 'change' : 'input');
}
const options = (run: PageRun, id: string): [string, string][] =>
  control(run, id)
    .querySelectorAll('option')
    .map((option) => [option.getAttribute('value') as string, option.textContent]);

describe('the filters of the page', () => {
  it('open on the decisions in force, show the controls, and say how many of how many', () => {
    const run = aPage();
    expect(shown(run)).toEqual(['d-1']);
    expect(control(run, 'filters').hidden).toBe(false);
    expect(control(run, 'showing').hidden).toBe(false);
    expect(control(run, 'showing').textContent).toBe('Showing 1 of 4 decision(s)');
    expect(control(run, 'f-state').value).toBe('in-force');
  });

  it('offer the values the cards carry, and no others', () => {
    const run = aPage();
    expect(options(run, 'f-state')).toEqual([
      ['in-force', 'In force'],
      ['', 'All states'],
      ['accepted', 'accepted'],
      ['proposed', 'proposed'],
      ['rejected', 'rejected'],
      ['superseded', 'superseded'],
    ]);
    expect(options(run, 'f-who')).toEqual([
      ['', 'Anyone'],
      ['mnid:alice', 'mnid:alice'],
      ['mnid:bob', 'mnid:bob'],
    ]);
    expect(options(run, 'f-by')).toEqual([
      ['', 'Anyone'],
      ['a person', 'a person'],
      ['agent claude-code', 'agent claude-code'],
      ['agent codex', 'agent codex'],
    ]);
  });

  it('show everything when the state is all, and one state when one is chosen', () => {
    const run = aPage();
    choose(run, 'f-state', '');
    expect(shown(run)).toEqual(['d-1', 'd-2', 'd-3', 'd-4']);
    expect(control(run, 'showing').textContent).toBe('Showing 4 of 4 decision(s)');
    choose(run, 'f-state', 'rejected');
    expect(shown(run)).toEqual(['d-2']);
    expect(control(run, 'showing').textContent).toBe('Showing 1 of 4 decision(s)');
  });

  it('filter by who, by agent or person, by the day it was recorded, and by text, notes included', () => {
    const run = aPage();
    choose(run, 'f-state', '');
    choose(run, 'f-who', 'mnid:bob');
    expect(shown(run)).toEqual(['d-2', 'd-4']);
    choose(run, 'f-who', '');
    choose(run, 'f-by', 'agent codex');
    expect(shown(run)).toEqual(['d-4']);
    choose(run, 'f-by', 'agent claude-code');
    expect(shown(run)).toEqual(['d-1']);
    choose(run, 'f-by', '');
    choose(run, 'f-from', '2026-01-20');
    choose(run, 'f-to', '2026-02-10');
    expect(shown(run)).toEqual(['d-2', 'd-4']);
    choose(run, 'f-from', '');
    choose(run, 'f-to', '');
    choose(run, 'f-text', 'HALF TO EVEN');
    expect(shown(run)).toEqual(['d-1']);
  });

  it('filter by path, by segment and in both directions', () => {
    const run = aPage();
    choose(run, 'f-state', '');
    choose(run, 'f-path', 'packages/code');
    // d-1 is at a file under it, d-3 at `packages`, which covers it; `packages/codex` is neither.
    expect(shown(run)).toEqual(['d-1', 'd-3']);
    choose(run, 'f-path', 'packages/codex');
    expect(shown(run)).toEqual(['d-2', 'd-3']);
  });

  it('clear shows every decision, and does not keep what was typed', () => {
    const run = aPage();
    choose(run, 'f-text', 'cents');
    choose(run, 'f-who', 'mnid:bob');
    control(run, 'f-clear').dispatch('click');
    expect(shown(run)).toEqual(['d-1', 'd-2', 'd-3', 'd-4']);
    expect(control(run, 'f-text').value).toBe('');
    expect(control(run, 'f-who').value).toBe('');
  });

  it('are wired before the verification, which waits for the first paint', () => {
    const html = renderPage(
      {
        decisions: DECISIONS,
        otherNotes: [],
        timeline: [],
        counts: { decisions: 4, inForce: 1, notes: 1, timeline: 0 },
        tails: [],
        files: {},
      },
      theSiteVerifier(),
    );
    const { page, timers } = runInAVm(html, theSiteVerifier());
    expect(timers.pending).toBe(1);
    expect(control({ page, timers }, 'showing').textContent).toBe('Showing 1 of 4 decision(s)');
    expect(page.getElementById('verdict-status')?.getAttribute('data-state')).toBe('pending');
    timers.drain();
    expect(page.getElementById('verdict-status')?.getAttribute('data-state')).toBe('unverified');
  });
});

describe('the filters, run from the module', () => {
  const html = (): string =>
    renderPage(
      {
        decisions: DECISIONS,
        otherNotes: [],
        timeline: [],
        counts: { decisions: 4, inForce: 1, notes: 1, timeline: 0 },
        tails: [],
        files: {},
      },
      '/*v*/',
    );

  it('open on the decisions in force and narrow by text, and clear', () => {
    const page = new FakePage(html());
    wireFilters(page);
    const cards = page.querySelectorAll('.decision');
    expect(cards.filter((card) => !card.hidden).map((card) => card.getAttribute('id'))).toEqual([
      'd-1',
    ]);
    const text = page.getElementById('f-text') as FakeElement;
    const state = page.getElementById('f-state') as FakeElement;
    state.value = '';
    text.value = 'CENTS';
    text.dispatch('input');
    expect(cards.filter((card) => !card.hidden).map((card) => card.getAttribute('id'))).toEqual([
      'd-1',
      'd-4',
    ]);
    (page.getElementById('f-clear') as FakeElement).dispatch('click');
    expect(cards.every((card) => !card.hidden)).toBe(true);
  });

  it('read a card whose attributes are not what the writer wrote as no one and nothing, and leave a page without controls alone', () => {
    const page = new FakePage(
      html()
        .replaceAll('data-who="[&quot;mnid:bob&quot;]"', 'data-who="not json"')
        .replaceAll('data-by="[&quot;agent codex&quot;]"', 'data-by="{&quot;a&quot;:1}"'),
    );
    wireFilters(page);
    const who = (page.getElementById('f-who') as FakeElement)
      .querySelectorAll('option')
      .map((option) => option.getAttribute('value'));
    expect(who).toEqual(['', 'mnid:alice']);
    const by = (page.getElementById('f-by') as FakeElement)
      .querySelectorAll('option')
      .map((option) => option.getAttribute('value'));
    expect(by).not.toContain('agent codex');
    const bare = new FakePage('<div id="decision-list"></div>');
    wireFilters(bare);
    expect(bare.writes).toEqual([]);
  });
});
