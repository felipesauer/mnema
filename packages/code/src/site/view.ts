/**
 * What the lists of the record page ARE, as a tree of elements, written once.
 *
 * `listViews` takes the page's model (`model.ts`) and the tails and returns, for every card, note,
 * entry of the timeline and tail the page lists, the element tree that stands for it: its tag, its
 * attributes and its text. Two readers use the SAME tree. `page.ts` writes it into the page, which is
 * the only place the text is escaped (the tree holds the record's text as it is). `browser/check.ts`
 * derives the model again in the reader's browser, from the files the page carries, builds the same
 * trees and holds them against what the page shows. A text that `mnema site` wrote and the browser
 * words differently would be two readings of one rule, and the check would accuse an honest page; a
 * text only the writer words is a text the check never reads. So every word the lists carry is made
 * in this file, and it names no `node:` module: the browser script bundles it.
 *
 * EVERY NODE THAT SHOWS A FIELD OF THE MODEL CARRIES `data-field="<name>"`. The check compares each
 * one it finds in the page, so a node the page gained with a name this file does not make is itself a
 * difference, and so is one it lost. Besides the text, a field node's `href`, `aria-label` and
 * `data-state`, `class` and `id` are compared ({@link FIELD_ATTRIBUTES}): a link the page points
 * elsewhere, an anchor it drops or a class the filters read it changes are lies the text alone does
 * not tell. The attributes the filters read (`data-state`, `data-force`,
 * `data-date`, `data-who`, `data-by` of a card) and the ids the links go to are the root's, and the
 * root's attributes are compared as well.
 *
 * WHAT THIS DOES NOT TELL. A style (a rule that hides a card, a colour) is not in these trees, and
 * the page's own script is not a list: the check does not read either. It reads the text, the field
 * and filter attributes, the ids, their order and the counts of the lists.
 */

import { neutralized, oneLine } from '../one-line.js';
import {
  actWording,
  type PageCounts,
  type PageDecision,
  type PageLink,
  type PageModel,
  type PageNote,
  type TimelineEntry,
} from './model.js';

/** One tail's stored lines: how many there are. The lines themselves are drawn from the files. */
export interface SiteTail {
  readonly id: string;
  readonly events: number;
}

/** An element of what a list shows: a tag, its attributes, and what is inside it (nodes and text). */
export interface VNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly kids: readonly VKid[];
}

export type VKid = VNode | string;

/** What a field node is compared by besides its text. */
export const FIELD_ATTRIBUTES = ['href', 'aria-label', 'data-state', 'class', 'id'] as const;

function h(tag: string, attrs: Record<string, string>, ...kids: (VKid | readonly VKid[])[]): VNode {
  return { tag, attrs, kids: kids.flat() };
}

/** A record's short field as `mnema show` draws it: one line ({@link oneLine}). */
const line = oneLine;

/** A record's long text as `mnema show` prints it ({@link neutralized}). */
const block = neutralized;

/** The identity as the record names it, and what carried the act out: a person or an agent. */
function actor(prefix: string, who: string, which?: string, unannounced?: true): VKid[] {
  return [
    h('code', { 'data-field': `${prefix}-who` }, line(who)),
    ' ',
    h(
      'span',
      { class: 'badge', 'data-field': `${prefix}-by` },
      line(actWording(which, unannounced)),
    ),
  ];
}

/** The people, and the agents, who acted on a decision: what the filters by author read. */
function actorsOf(d: PageDecision): { who: string[]; by: string[] } {
  const acts = [
    ...(d.recordedBy === undefined ? [] : [d.recordedBy]),
    ...(d.acceptedBy === undefined ? [] : [d.acceptedBy]),
    ...d.moves,
  ];
  return {
    who: [...new Set(acts.map((act) => oneLine(act.who)))],
    by: [...new Set(acts.map((act) => oneLine(actWording(act.which, act.unannounced))))],
  };
}

/** The anchor a decision's permanent link goes to: `ADR-<n>` when only it carries the label. */
export function permalinkOf(d: PageDecision): string {
  return d.adrIsUnique ? d.adr : d.id;
}

/** A note, as an item of a list. Only the first one shown of an id carries the `id` a link goes to. */
function noteView(note: PageNote, firstTime: boolean): VNode {
  const what = note.kind === 'memory' ? 'Memory' : 'Observation';
  const retraction =
    note.retracted === undefined
      ? []
      : [
          h(
            'p',
            { class: 'retraction' },
            'Retracted at ',
            h('time', { 'data-field': 'note-retracted-at' }, note.retracted.at),
            ' by ',
            actor('note-retracted', note.retracted.who, note.retracted.which),
            '. Why: ',
            h('span', { 'data-field': 'note-retracted-reason' }, line(note.retracted.reason)),
          ),
        ];
  return h(
    'li',
    {
      class: `note${note.retracted === undefined ? '' : ' retracted'}`,
      ...(firstTime ? { id: `note-${note.id}` } : {}),
      'data-note': note.id,
    },
    h(
      'p',
      { class: 'meta' },
      h('span', { 'data-field': 'note-kind' }, what),
      note.topic === undefined
        ? []
        : [' on ', h('strong', { 'data-field': 'note-topic' }, line(note.topic))],
      note.about === undefined
        ? []
        : [' about ', h('code', { 'data-field': 'note-about' }, line(note.about))],
      ', by ',
      actor('note', note.who, note.which, note.unannounced),
      ' at ',
      h('time', { 'data-field': 'note-at' }, note.at),
    ),
    h('pre', { 'data-field': 'note-text' }, block(note.text)),
    retraction,
  );
}

function linkView(prefix: string, link: PageLink): VKid[] {
  return [
    h('span', { class: 'rel', 'data-field': `${prefix}-rel` }, line(link.rel)),
    h('code', { class: 'target', 'data-field': `${prefix}-target` }, line(link.target)),
  ];
}

function decisionView(
  d: PageDecision,
  known: ReadonlyMap<string, PageDecision>,
  shown: Set<string>,
): VNode {
  const reference = (field: string, id: string): VKid[] => {
    const other = known.get(id);
    return other === undefined
      ? [
          h('code', { 'data-field': field }, line(id)),
          ' ',
          h('span', { 'data-field': `${field}-named` }, '(not in the trees read)'),
        ]
      : [
          h('a', { href: `#${id}`, 'data-field': field }, line(other.adr)),
          h(
            'span',
            { 'data-field': `${field}-named` },
            `: ${line(other.title)} (${line(other.state)})`,
          ),
        ];
  };
  const { who, by } = actorsOf(d);
  return h(
    'article',
    {
      class: `card decision ${d.inForce ? 'in-force' : 'not-in-force'}`,
      id: d.id,
      'data-state': d.state,
      'data-force': d.inForce ? 'in-force' : 'not-in-force',
      'data-date': d.createdAt.slice(0, 10),
      'data-who': JSON.stringify(who),
      'data-by': JSON.stringify(by),
    },
    h(
      'h3',
      {},
      d.adrIsUnique ? h('span', { id: d.adr, 'data-field': 'anchor' }) : [],
      h('span', { 'data-field': 'adr' }, line(d.adr)),
      ' · ',
      h('span', { 'data-field': 'title' }, line(d.title)),
      ' ',
      h('span', { class: 'state', 'data-state': d.state, 'data-field': 'state' }, line(d.state)),
      h(
        'a',
        {
          class: 'permalink',
          href: `#${permalinkOf(d)}`,
          'aria-label': `Permanent link to ${d.adr}`,
          'data-field': 'permalink',
        },
        '#',
      ),
    ),
    h('pre', { 'data-field': 'rationale' }, block(d.rationale)),
    d.alternatives === undefined
      ? []
      : [
          h('p', {}, h('strong', {}, 'Turned down:')),
          h('pre', { 'data-field': 'alternatives' }, block(d.alternatives)),
        ],
    d.recordedBy === undefined
      ? []
      : h(
          'p',
          { class: 'meta' },
          'Recorded by ',
          actor('recorded', d.recordedBy.who, d.recordedBy.which, d.recordedBy.unannounced),
          ' at ',
          h('time', { 'data-field': 'recorded-at' }, d.createdAt),
          '.',
        ),
    d.acceptedBy === undefined
      ? []
      : h(
          'p',
          { class: 'meta' },
          'Accepted by ',
          actor('accepted', d.acceptedBy.who, d.acceptedBy.which, d.acceptedBy.unannounced),
          '.',
        ),
    d.supersedes === undefined
      ? []
      : h('p', { class: 'meta' }, 'Supersedes ', reference('supersedes', d.supersedes), '.'),
    d.supersededBy === undefined
      ? []
      : h(
          'p',
          { class: 'meta' },
          'Superseded by ',
          reference('superseded-by', d.supersededBy),
          '.',
        ),
    d.addresses.length === 0
      ? []
      : [
          h('h4', {}, 'Addressed at'),
          h(
            'ul',
            { class: 'addresses' },
            d.addresses.map((link) => h('li', {}, linkView('address', link))),
          ),
        ],
    d.linkedTo.length === 0
      ? []
      : h(
          'p',
          { class: 'meta' },
          'Linked to: ',
          d.linkedTo.flatMap((link, i) => [i === 0 ? '' : ', ', ...linkView('linked', link)]),
        ),
    d.moves.length === 0
      ? []
      : h(
          'details',
          {},
          h('summary', {}, 'History'),
          h(
            'ol',
            {},
            d.moves.map((move) =>
              h(
                'li',
                {},
                h('time', { 'data-field': 'move-at' }, move.at),
                ' ',
                h('span', { 'data-field': 'move-action' }, line(move.action)),
                ' (',
                h('span', { 'data-field': 'move-from' }, line(move.before ?? 'new')),
                ' → ',
                h('span', { 'data-field': 'move-to' }, line(move.to)),
                ') by ',
                actor('move', move.who, move.which, move.unannounced),
                move.said === undefined
                  ? []
                  : h('pre', { 'data-field': 'move-said' }, block(move.said)),
              ),
            ),
          ),
        ),
    d.notes.length === 0
      ? []
      : [
          h('h4', {}, 'Notes'),
          h(
            'ul',
            { class: 'notes' },
            d.notes.map((note) => {
              const firstTime = !shown.has(note.id);
              shown.add(note.id);
              return noteView(note, firstTime);
            }),
          ),
        ],
  );
}

/** What one entry of the timeline says: the act, who did it, and a link to what it is about. */
function entryView(entry: TimelineEntry): VNode {
  const by = actor('entry', entry.who, entry.which, entry.unannounced);
  const adr = h('span', { 'data-field': 'entry-adr' }, line(entry.adr ?? ''));
  const text: VKid[] = {
    'decision-recorded': [adr, ' recorded by ', by],
    'decision-moved': [
      adr,
      ': ',
      h('span', { 'data-field': 'entry-action' }, line(entry.action ?? '')),
      ' (to ',
      h('span', { 'data-field': 'entry-to' }, line(entry.to ?? '')),
      ') by ',
      by,
    ],
    'note-recorded': [
      'Note recorded',
      entry.topic === undefined
        ? []
        : [' on ', h('span', { 'data-field': 'entry-topic' }, line(entry.topic))],
      ' by ',
      by,
    ].flat(),
    'note-retracted': ['Note retracted by ', by],
  }[entry.kind].flat();
  const target =
    entry.kind === 'decision-recorded' || entry.kind === 'decision-moved'
      ? entry.subject
      : `note-${entry.subject}`;
  return h(
    'li',
    { class: 'entry', 'data-kind': entry.kind },
    h('time', { 'data-field': 'entry-at' }, entry.at),
    ' ',
    text,
    ' ',
    h('a', { href: `#${target}`, 'data-field': 'entry-link' }, 'open'),
  );
}

function tailView(tail: SiteTail): VNode {
  return h(
    'details',
    { class: 'tail', 'data-tail': tail.id },
    h(
      'summary',
      {},
      h('code', { 'data-field': 'tail-id' }, tail.id),
      ': ',
      h('span', { 'data-field': 'tail-events' }, String(tail.events)),
      ' event(s)',
    ),
    h('pre', {}),
  );
}

/** The counts line, in words. `events` is how many stored lines the tails hold. */
export function countsView(counts: PageCounts, events: number): VNode {
  return h(
    'p',
    { id: 'counts' },
    `${counts.decisions} decision(s): ${counts.inForce} in force, ${counts.decisions - counts.inForce} not in force. ${counts.notes} note(s), ${events} stored event(s).`,
  );
}

/** One item of a list, with the name the page's differences call it by. */
export interface ItemView {
  readonly id: string;
  readonly label: string;
  readonly node: VNode;
}

/** Everything the page lists, as trees. */
export interface ListViews {
  readonly counts: VNode;
  readonly decisions: readonly ItemView[];
  readonly otherNotes: readonly ItemView[];
  readonly timeline: readonly VNode[];
  readonly tails: readonly ItemView[];
  /** How many note items the page holds in all: under the decisions, each time, and apart. */
  readonly noteItems: number;
}

/** The trees of the lists, for a model and the tails it came with. */
export function listViews(model: PageModel & { readonly tails: readonly SiteTail[] }): ListViews {
  const known = new Map(model.decisions.map((d) => [d.id, d]));
  const shown = new Set<string>();
  const decisions = model.decisions.map((d) => ({
    id: d.id,
    label: d.adrIsUnique ? line(d.adr) : `${line(d.adr)} (${d.id})`,
    node: decisionView(d, known, shown),
  }));
  const otherNotes = model.otherNotes.map((note) => {
    shown.add(note.id);
    return { id: note.id, label: `note ${note.id}`, node: noteView(note, true) };
  });
  return {
    counts: countsView(
      model.counts,
      model.tails.reduce((n, tail) => n + tail.events, 0),
    ),
    decisions,
    otherNotes,
    timeline: model.timeline.map(entryView),
    tails: model.tails.map((tail) => ({
      id: tail.id,
      label: `tail ${tail.id}`,
      node: tailView(tail),
    })),
    noteItems: model.decisions.reduce((n, d) => n + d.notes.length, 0) + model.otherNotes.length,
  };
}

/** What the decision list says when the record holds no decision. */
export const NO_DECISIONS = 'No decision is recorded in the public tree.';

/** The text a tree shows, in the order of the page. */
export function textOf(kid: VKid): string {
  return typeof kid === 'string' ? kid : kid.kids.map(textOf).join('');
}

/** One field node of a tree: its name, its text and the attributes it is compared by. */
export interface FieldOf {
  readonly name: string;
  readonly text: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** What the field belongs to, when it is a note's: how a difference names it. */
  readonly of: string | undefined;
}

/** The field nodes of a tree in the order of the page, each with the note it sits in, if any. */
export function fieldsOf(node: VNode, note?: string): FieldOf[] {
  const found: FieldOf[] = [];
  const inNote = node.attrs['data-note'] ?? note;
  const name = node.attrs['data-field'];
  if (name !== undefined) {
    const attrs: Record<string, string> = {};
    for (const key of FIELD_ATTRIBUTES) {
      const value = node.attrs[key];
      if (value !== undefined) attrs[key] = value;
    }
    found.push({ name, text: textOf(node), attrs, of: inNote });
  }
  for (const kid of node.kids) {
    if (typeof kid !== 'string') found.push(...fieldsOf(kid, inNote));
  }
  return found;
}
