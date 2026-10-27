/**
 * The lists of the page, checked against the events the page verified.
 *
 * `mnema site` wrote the lists (decisions, notes, timeline) into the page from the public tree's
 * events. A verdict beside lists nothing checked says nothing about them, so once the verdict is
 * `verified` the script derives the lists AGAIN, in the reader's browser, from the files it
 * verified: the same `orderedEvents` the product reads a record with, the same `pageModel`, the same
 * `listViews`. Then it reads what the page shows (the DOM) and names every difference, each one by
 * the item it is about: `ADR-9 (state): the page says accepted; the events say proposed`.
 *
 * WHAT IS COMPARED, enumerated from the derived trees and not from a list written here:
 *   - every `[data-field]` node of each decision card, note, timeline entry and tail summary: its
 *     name, its text and the attributes that carry a claim (`href`, `aria-label`, `data-state`). A
 *     node whose name the events do not give is a difference, and so is one the page lost;
 *   - the root of each of those items: its `id`, its `class` and the `data-*` the filters read;
 *   - the whole text of each item, with white space collapsed: a sentence put in or taken out of a
 *     card outside any field shows here and nowhere else;
 *   - the ids the page has and the events do not give, and the other way round, their order, the
 *     number of timeline entries, notes and tails, and the counts line.
 *
 * WHAT IT DOES NOT SAY. It does not read a style: a rule of the page that hides a card or recolours
 * a word is not in the lists and is not compared. It does not read the page's own script, which is
 * the script doing the reading: a page served by the party it checks carries the script that checks
 * it, so the check counts for more when the page is made again from a clone. And it is not a second
 * reader: it is this product's TypeScript run twice. The Python reader verifies the chain and does
 * not derive decisions.
 *
 * IT SAYS `match` ONLY OVER A RECORD THAT VERIFIED. Over any other the answer is `unchecked`, with
 * the reason, and never `match`; a derivation that throws is `unchecked` as well. A difference is not
 * a verdict on the chain: that line is the verifier's and stays as it is.
 */

import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents } from '@mnema/core';
import { type PageModel, pageModel } from '../model.js';
import { fieldsOf, type ItemView, listViews, type SiteTail, textOf, type VNode } from '../view.js';
import type { Doc, El } from './filters.js';
import { mountRecord, RECORD_ROOT } from './fs.js';
import { tailsOfFiles } from './tails.js';

/** What the page's lists are derived to be: the model and the tails, from the files. */
export interface Derived {
  readonly model: PageModel;
  readonly tails: readonly SiteTail[];
}

/** The lists derived from the files a page carries, by the code `mnema site` writes them with. */
export function deriveLists(files: Readonly<Record<string, string>>): Derived {
  mountRecord(files, true);
  return {
    model: pageModel(orderedEvents({ root: RECORD_ROOT }, catalogUpcasters())),
    tails: tailsOfFiles(files),
  };
}

const collapse = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** A value as a difference quotes it: short, on one line, and JSON so a control character is seen. */
function show(value: string | null): string {
  if (value === null) return 'nothing';
  const short = collapse(value);
  return JSON.stringify(short.length > 80 ? `${short.slice(0, 77)}...` : short);
}

/** Where two texts first differ, each with a little of what is around it. */
function excerpts(page: string, events: string): { page: string; events: string } {
  let at = 0;
  while (at < page.length && at < events.length && page[at] === events[at]) at++;
  const window = (text: string): string => {
    const from = Math.max(0, at - 12);
    return JSON.stringify(`${from > 0 ? '...' : ''}${text.slice(from, at + 40)}`);
  };
  return { page: window(page), events: window(events) };
}

function compareAttributes(label: string, el: El, node: VNode, out: string[]): void {
  for (const [name, value] of Object.entries(node.attrs)) {
    const got = el.getAttribute(name);
    if (got !== value) {
      out.push(`${label}: its attribute ${name} says ${show(got)}; the events say ${show(value)}`);
    }
  }
}

/** Compares the fields and, when they all agree, the whole text, of `el` against what `node` is. */
function compareContent(label: string, el: El, node: VNode, out: string[]): void {
  const before = out.length;
  const want = fieldsOf(node);
  const have = Array.from(el.querySelectorAll('[data-field]'), (field) => ({
    el: field,
    name: field.getAttribute('data-field') ?? '',
  }));
  let next = 0;
  for (const field of want) {
    const what = field.of === undefined ? field.name : `${field.name} of note ${field.of}`;
    const found = have[next];
    if (found === undefined || found.name !== field.name) {
      out.push(`${label}: the field ${what} is missing from the page`);
      continue;
    }
    next++;
    const text = collapse(found.el.textContent);
    if (text !== collapse(field.text)) {
      out.push(
        `${label} (${what}): the page says ${show(text)}; the events say ${show(field.text)}`,
      );
    }
    for (const [name, value] of Object.entries(field.attrs)) {
      const got = found.el.getAttribute(name);
      if (got !== value) {
        out.push(
          `${label} (${what}): its attribute ${name} says ${show(got)}; the events say ${show(value)}`,
        );
      }
    }
  }
  for (; next < have.length; next++) {
    out.push(
      `${label}: the page has a field named ${show(have[next]?.name ?? '')} that the events do not give`,
    );
  }
  if (out.length > before) return;
  const [page, events] = [collapse(el.textContent), collapse(textOf(node))];
  if (page !== events) {
    const at = excerpts(page, events);
    out.push(
      `${label}: the page says something the events do not give, outside its fields: the page says ${at.page}; the events say ${at.events}`,
    );
  }
}

function compareItem(label: string, el: El, node: VNode, out: string[]): void {
  compareAttributes(label, el, node, out);
  compareContent(label, el, node, out);
}

/**
 * Matches what the page has to what the events give, by id, and says what is on one side only and
 * whether the ones both have come in the same order. Returns the pairs both have.
 */
function matchById(
  kind: string,
  wanted: readonly ItemView[],
  have: readonly El[],
  idOf: (el: El) => string,
  nameOf: (el: El) => string,
  out: string[],
): { item: ItemView; el: El }[] {
  const taken = new Set<El>();
  const pairs: { item: ItemView; el: El }[] = [];
  for (const item of wanted) {
    const el = have.find((candidate) => !taken.has(candidate) && idOf(candidate) === item.id);
    if (el === undefined) {
      out.push(`${item.label} is in the events and not on the page (${kind})`);
      continue;
    }
    taken.add(el);
    pairs.push({ item, el });
  }
  for (const el of have) {
    if (!taken.has(el)) out.push(`${nameOf(el)} is on the page and not in the events (${kind})`);
  }
  const onPage = pairs.map((pair) => have.indexOf(pair.el));
  if (onPage.some((place, i) => i > 0 && place < (onPage[i - 1] as number))) {
    out.push(`the ${kind} are in another order on the page than the events give`);
  }
  return pairs;
}

/** Every difference between what the page shows and what `derived` says it should show. */
export function checkLists(page: Doc, derived: Derived): string[] {
  const views = listViews({ ...derived.model, tails: derived.tails });
  const out: string[] = [];

  const counts = page.getElementById('counts');
  if (counts === null) out.push('the counts line is missing from the page');
  else compareItem('the counts line', counts, views.counts, out);

  const adrOf = (card: El): string =>
    collapse(card.querySelectorAll('[data-field="adr"]')[0]?.textContent ?? null) ||
    `a decision with the id ${show(card.getAttribute('id'))}`;
  for (const { item, el } of matchById(
    'decisions',
    views.decisions,
    Array.from(page.querySelectorAll('.decision')),
    (card) => card.getAttribute('id') ?? '',
    adrOf,
    out,
  )) {
    compareItem(item.label, el, item.node, out);
  }

  const apart = page.getElementById('other-notes');
  const noteName = (el: El): string => `note ${el.getAttribute('data-note') ?? ''}`;
  for (const { item, el } of matchById(
    'notes that belong to no decision',
    views.otherNotes,
    apart === null ? [] : Array.from(apart.querySelectorAll('.note')),
    (note) => note.getAttribute('data-note') ?? '',
    noteName,
    out,
  )) {
    compareItem(item.label, el, item.node, out);
  }

  const entries = Array.from(page.querySelectorAll('.entry'));
  for (let i = 0; i < Math.max(entries.length, views.timeline.length); i++) {
    const [el, node] = [entries[i], views.timeline[i]];
    if (node === undefined)
      out.push(`timeline entry ${i + 1} is on the page and not in the events`);
    else if (el === undefined) {
      out.push(`timeline entry ${i + 1} is in the events and not on the page`);
    } else compareItem(`timeline entry ${i + 1}`, el, node, out);
  }

  for (const { item, el } of matchById(
    'tails',
    views.tails,
    Array.from(page.querySelectorAll('.tail')),
    (tail) => tail.getAttribute('data-tail') ?? '',
    (tail) => `tail ${tail.getAttribute('data-tail') ?? ''}`,
    out,
  )) {
    compareAttributes(item.label, el, item.node, out);
    const summary = Array.from(el.querySelectorAll('summary'))[0];
    const wanted = item.node.kids[0];
    if (summary === undefined) out.push(`${item.label}: its summary is missing from the page`);
    else if (typeof wanted !== 'string' && wanted !== undefined) {
      compareContent(item.label, summary, wanted, out);
    }
  }

  const notes = page.querySelectorAll('.note').length;
  if (out.length === 0 && notes !== views.noteItems) {
    out.push(`the page lists ${notes} note(s), and the events give ${views.noteItems}`);
  }
  return out;
}

/** How many differences the page writes out; the rest are counted. */
const MOST_LINES = 50;

/**
 * Runs the check where the page keeps its answer. `verified` is whether the record verified: over one
 * that did not, nothing is derived and the answer is `unchecked`.
 */
export function showListsCheck(
  page: Doc,
  files: Readonly<Record<string, string>>,
  verified: boolean,
): void {
  const status = page.getElementById('lists-status');
  const summary = page.getElementById('lists-summary');
  const issues = page.getElementById('lists-issues');
  if (status === null || summary === null || issues === null) return;
  const say = (state: 'match' | 'differ' | 'unchecked', word: string, text: string): void => {
    status.setAttribute('data-state', state);
    status.textContent = word;
    summary.textContent = text;
  };
  if (!verified) {
    say(
      'unchecked',
      'not checked',
      'The record did not verify, so the lists on this page were not checked against it.',
    );
    return;
  }
  let differences: string[];
  try {
    differences = checkLists(page, deriveLists(files));
  } catch (error) {
    say(
      'unchecked',
      'not checked',
      `The lists on this page were not checked: the events could not be derived from the verified files (${error instanceof Error ? error.message : String(error)}).`,
    );
    return;
  }
  if (differences.length === 0) {
    say('match', 'match', 'The lists on this page match the events verified above.');
    return;
  }
  say(
    'differ',
    'differ',
    `${differences.length} difference(s) between the lists on this page and the events verified above:`,
  );
  for (const text of differences.slice(0, MOST_LINES)) {
    const item = page.createElement('li');
    item.textContent = text;
    issues.appendChild(item);
  }
  if (differences.length > MOST_LINES) {
    const item = page.createElement('li');
    item.textContent = `and ${differences.length - MOST_LINES} more`;
    issues.appendChild(item);
  }
}
