/**
 * THE LISTS OF THE PAGE ARE TREES, MADE ONCE (`view.ts`).
 *
 * The page writes these trees as markup and the browser builds them again to hold the page against
 * them, so what a tree says is what both read. The cases here hold what a tree carries: the
 * attributes a card holds for the filters, which node is a field and what it is called, the order the
 * fields come in, which note carries the `id` a link goes to, the anchor of a decision, and the text a
 * tree shows.
 */

import { describe, expect, it } from 'vitest';
import { A_PERSON } from '../one-line.js';
import type { PageDecision, PageNote, TimelineEntry } from './model.js';
import { countsView, fieldsOf, listViews, permalinkOf, textOf } from './view.js';

const note: PageNote = {
  id: 'n-1',
  kind: 'observation',
  topic: 'rounding',
  about: 'd-1',
  text: 'half to even',
  at: '2026-01-06T00:00:00.000Z',
  who: 'mnid:alice',
  which: 'claude-code',
};

const decision = (over: Partial<PageDecision> = {}): PageDecision => ({
  id: 'd-1',
  adr: 'ADR-1',
  adrIsUnique: true,
  title: 'Keep money in cents',
  rationale: 'floats lose a cent',
  state: 'accepted',
  inForce: true,
  createdAt: '2026-01-05T10:00:00.000Z',
  recordedBy: { who: 'mnid:alice' },
  acceptedBy: { who: 'mnid:bob', which: 'claude-code' },
  moves: [
    {
      at: '2026-01-05T11:00:00.000Z',
      action: 'accept',
      before: 'proposed',
      to: 'accepted',
      who: 'mnid:bob',
      which: 'claude-code',
    },
  ],
  notes: [note],
  addresses: [{ rel: 'governs', target: 'packages/code' }],
  linkedTo: [],
  ...over,
});

const entry: TimelineEntry = {
  kind: 'decision-moved',
  at: '2026-01-05T11:00:00.000Z',
  who: 'mnid:bob',
  which: 'claude-code',
  subject: 'd-1',
  adr: 'ADR-1',
  action: 'accept',
  to: 'accepted',
};

const model = (decisions: PageDecision[], otherNotes: PageNote[] = []) => ({
  decisions,
  otherNotes,
  timeline: [entry],
  counts: { decisions: decisions.length, inForce: decisions.length, notes: 1, timeline: 1 },
  tails: [{ id: 'tail-a', events: 7 }],
});

describe('a decision card', () => {
  const views = listViews(model([decision()]));
  const card = views.decisions[0]?.node;

  it('holds, as attributes, what the filters read', () => {
    expect(card?.attrs).toEqual({
      class: 'card decision in-force',
      id: 'd-1',
      'data-state': 'accepted',
      'data-force': 'in-force',
      'data-date': '2026-01-05',
      'data-who': '["mnid:alice","mnid:bob"]',
      'data-by': `["${A_PERSON}","agent claude-code"]`,
    });
  });

  it('names every node that shows a field, in the order of the page, and each note field by its note', () => {
    const fields = fieldsOf(card as NonNullable<typeof card>).map((f) =>
      f.of === undefined ? f.name : `${f.name}@${f.of}`,
    );
    expect(fields).toEqual([
      'adr',
      'title',
      'state',
      'permalink',
      'rationale',
      'recorded-who',
      'recorded-by',
      'recorded-at',
      'accepted-who',
      'accepted-by',
      'address-rel',
      'address-target',
      'move-at',
      'move-action',
      'move-from',
      'move-to',
      'move-who',
      'move-by',
      'note-kind@n-1',
      'note-topic@n-1',
      'note-about@n-1',
      'note-who@n-1',
      'note-by@n-1',
      'note-at@n-1',
      'note-text@n-1',
    ]);
  });

  it('words an act with no agent as the product does, and one with an agent by its name', () => {
    const by = fieldsOf(card as NonNullable<typeof card>)
      .filter((f) => f.name.endsWith('-by'))
      .map((f) => [f.name, f.text]);
    expect(by).toEqual([
      ['recorded-by', A_PERSON],
      ['accepted-by', 'agent claude-code'],
      ['move-by', 'agent claude-code'],
      ['note-by', 'agent claude-code'],
    ]);
  });

  it('carries the claims a link and a state make as attributes of their field', () => {
    const claims = fieldsOf(card as NonNullable<typeof card>)
      .filter((f) => Object.keys(f.attrs).length > 0)
      .map((f) => [f.name, f.attrs]);
    expect(claims).toEqual([
      ['state', { 'data-state': 'accepted' }],
      ['permalink', { href: '#ADR-1', 'aria-label': 'Permanent link to ADR-1' }],
    ]);
  });
});

describe('an anchor', () => {
  it('goes by the ADR number when it is unique, and by the id when two decisions carry it', () => {
    expect(permalinkOf(decision())).toBe('ADR-1');
    expect(permalinkOf(decision({ adrIsUnique: false }))).toBe('d-1');
    const [card] = listViews(model([decision({ adrIsUnique: false })])).decisions;
    expect(card?.label).toBe('ADR-1 (d-1)');
    expect(JSON.stringify(card?.node)).not.toContain('"id":"ADR-1"');
  });
});

describe('a note shown under two decisions', () => {
  it('carries the id a link goes to once, under the first, and its own id for the check in both', () => {
    const views = listViews(
      model([decision(), decision({ id: 'd-2', adr: 'ADR-2', notes: [note] })]),
    );
    const idsOf = (i: number): (string | undefined)[] =>
      JSON.stringify(views.decisions[i]?.node)
        .match(/"id":"note-n-1"/g)
        ?.map(() => 'note-n-1') ?? [];
    expect(idsOf(0)).toEqual(['note-n-1']);
    expect(idsOf(1)).toEqual([]);
    expect(views.noteItems).toBe(2);
  });

  it('is told apart from a note that belongs to no decision, which is listed with its id', () => {
    const views = listViews(model([decision({ notes: [] })], [note]));
    expect(views.otherNotes.map((n) => [n.id, n.label, n.node.attrs.id])).toEqual([
      ['n-1', 'note n-1', 'note-n-1'],
    ]);
    expect(views.noteItems).toBe(1);
  });
});

describe('the lists that are not cards', () => {
  const views = listViews(model([decision()]));

  it('say an entry of the timeline with its act, who did it and where it points', () => {
    const [first] = views.timeline;
    expect(textOf(first as NonNullable<typeof first>)).toBe(
      '2026-01-05T11:00:00.000Z ADR-1: accept (to accepted) by mnid:bob agent claude-code open',
    );
    expect(first?.attrs).toEqual({ class: 'entry', 'data-kind': 'decision-moved' });
  });

  it('say how many lines a tail holds, and the counts in one line', () => {
    expect(textOf(views.tails[0]?.node.kids[0] as never)).toBe('tail-a: 7 event(s)');
    expect(textOf(countsView({ decisions: 3, inForce: 1, notes: 2, timeline: 9 }, 40))).toBe(
      '3 decision(s): 1 in force, 2 not in force. 2 note(s), 40 stored event(s).',
    );
    expect(textOf(views.counts)).toBe(
      '1 decision(s): 1 in force, 0 not in force. 1 note(s), 7 stored event(s).',
    );
  });
});
