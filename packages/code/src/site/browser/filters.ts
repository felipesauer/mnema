/**
 * The filters of the decision list: state, who, agent or person, date, text and path.
 *
 * THE CARDS ARE THE SOURCE. The page is written with every decision visible, and each card carries
 * what a filter needs as attributes (`data-state`, `data-force`, `data-date`, `data-who`, `data-by`)
 * and, for the path, in the nodes that show it (`.target` inside the card's addresses). The options
 * of a select are the values the cards carry, never a list written here, so a state the record
 * adds is a state the filter offers.
 *
 * HIDING IS THE `hidden` PROPERTY, nothing else, and nothing is kept: no storage, no cookie, no
 * address. A reload shows the decisions in force, which is where the filter opens. What a filter
 * hides is said by the line "Showing X of Y", so a decision that governs is never left out
 * without the page saying that some are.
 */

import type { Doc, El } from './dom.js';

/** What the filters read off one card. */
export interface CardFacts {
  readonly state: string;
  /** `in-force` or `not-in-force`, from the record's own reading of the state. */
  readonly force: string;
  /** `yyyy-mm-dd` of the day it was recorded. */
  readonly date: string;
  readonly who: readonly string[];
  readonly by: readonly string[];
  /** The visible text of the card, in lower case. */
  readonly text: string;
  /** The paths the card is addressed at, as written. */
  readonly targets: readonly string[];
}

/** What a person chose: an empty string is "not filtered". */
export interface Criteria {
  /** `in-force`, a state, or empty for all. */
  readonly state: string;
  readonly who: string;
  readonly by: string;
  readonly from: string;
  readonly to: string;
  readonly text: string;
  readonly path: string;
}

/** A path as its segments: empty and `.` segments are not segments. */
function segmentsOf(path: string): string[] {
  return path.split('/').filter((part) => part !== '' && part !== '.');
}

/**
 * Whether a typed path and an address cover one another, by SEGMENT and in both directions: the
 * address `packages/code/src/x.ts` is what `packages/code` is about, and the address `packages`
 * covers `packages/code`; `packages/codex` is neither.
 */
export function pathMatches(typed: string, target: string): boolean {
  const [a, b] = [segmentsOf(typed), segmentsOf(target)];
  if (a.length === 0 || b.length === 0) return false;
  const common = Math.min(a.length, b.length);
  return a.slice(0, common).every((part, i) => part === b[i]);
}

/** Whether a card is shown under what was chosen. */
export function cardShown(card: CardFacts, criteria: Criteria): boolean {
  if (criteria.state === 'in-force' && card.force !== 'in-force') return false;
  if (criteria.state !== '' && criteria.state !== 'in-force' && card.state !== criteria.state) {
    return false;
  }
  if (criteria.who !== '' && !card.who.includes(criteria.who)) return false;
  if (criteria.by !== '' && !card.by.includes(criteria.by)) return false;
  if (criteria.from !== '' && (card.date === '' || card.date < criteria.from)) return false;
  if (criteria.to !== '' && (card.date === '' || card.date > criteria.to)) return false;
  const text = criteria.text.trim().toLowerCase();
  if (text !== '' && !card.text.includes(text)) return false;
  if (criteria.path.trim() !== '' && !card.targets.some((t) => pathMatches(criteria.path, t))) {
    return false;
  }
  return true;
}

/** A list of strings the page wrote as JSON in an attribute; anything else is no list. */
function listOf(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function factsOf(card: El): CardFacts {
  return {
    state: card.getAttribute('data-state') ?? '',
    force: card.getAttribute('data-force') ?? '',
    date: card.getAttribute('data-date') ?? '',
    who: listOf(card.getAttribute('data-who')),
    by: listOf(card.getAttribute('data-by')),
    text: (card.textContent ?? '').toLowerCase(),
    targets: Array.from(card.querySelectorAll('.target'), (node) => node.textContent ?? ''),
  };
}

/** Puts `entries` (value, label) in a select as options, made by `createElement` and text. */
function fill(page: Doc, select: El, entries: readonly (readonly [string, string])[]): void {
  for (const [value, label] of entries) {
    const option = page.createElement('option');
    option.setAttribute('value', value);
    option.textContent = label;
    select.appendChild(option);
  }
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** Wires the filters over the cards of the page; a page without them is left as it is. */
export function wireFilters(page: Doc): void {
  const list = page.getElementById('decision-list');
  const controls = page.getElementById('filters');
  const showing = page.getElementById('showing');
  const control = (id: string): El | null => page.getElementById(id);
  const [state, who, by, from, to, text, path, clear] = [
    'f-state',
    'f-who',
    'f-by',
    'f-from',
    'f-to',
    'f-text',
    'f-path',
    'f-clear',
  ].map(control);
  if (
    list === null ||
    controls === null ||
    showing === null ||
    state == null ||
    who == null ||
    by == null ||
    from == null ||
    to == null ||
    text == null ||
    path == null ||
    clear == null
  ) {
    return;
  }
  const cards = Array.from(list.querySelectorAll('.decision'), (el) => ({
    el,
    facts: factsOf(el),
  }));
  fill(page, state, [
    ['in-force', 'In force'],
    ['', 'All states'],
    ...sorted(cards.map((c) => c.facts.state)).map((s): [string, string] => [s, s]),
  ]);
  fill(page, who, [
    ['', 'Anyone'],
    ...sorted(cards.flatMap((c) => c.facts.who)).map((w): [string, string] => [w, w]),
  ]);
  fill(page, by, [
    ['', 'Anyone'],
    ...sorted(cards.flatMap((c) => c.facts.by)).map((b): [string, string] => [b, b]),
  ]);

  const read = (): Criteria => ({
    state: state.value ?? '',
    who: who.value ?? '',
    by: by.value ?? '',
    from: from.value ?? '',
    to: to.value ?? '',
    text: text.value ?? '',
    path: path.value ?? '',
  });
  const apply = (): void => {
    const criteria = read();
    let count = 0;
    for (const card of cards) {
      const shown = cardShown(card.facts, criteria);
      card.el.hidden = !shown;
      if (shown) count++;
    }
    showing.textContent = `Showing ${count} of ${cards.length} decision(s)`;
  };
  for (const input of [state, who, by, from, to, text, path]) {
    input.addEventListener('input', apply);
    input.addEventListener('change', apply);
  }
  clear.addEventListener('click', () => {
    state.value = '';
    for (const input of [who, by, from, to, text, path]) input.value = '';
    apply();
  });
  state.value = 'in-force';
  apply();
  controls.hidden = false;
  showing.hidden = false;
}
