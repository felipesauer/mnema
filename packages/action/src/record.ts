/**
 * What a pull request does to the record, read off the record's own files.
 *
 * The record is append-only JSONL under `.mnema/tails/`, one event per line, each carrying the
 * hash that links it to the one before. A pull request can therefore only ADD lines, and what
 * it added is the set of hashes the head holds and the base did not. Nothing here verifies
 * anything: that is `mnema verify`'s, and the Action asks it separately. This module counts and
 * names; it believes the bytes it is handed exactly as far as it reads them.
 */

/** One event of the record, reduced to what the report reads. */
export interface RecordedEvent {
  /** The link hash — what makes two lines the same event. */
  readonly hash: string;
  readonly kind: string;
  readonly subject: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The events of one JSONL file. A line that is not an event — a checkpoint, a blank line, text
 * that does not parse — is not one, and is left out rather than guessed at.
 */
export function readEvents(jsonl: string): RecordedEvent[] {
  const events: RecordedEvent[] = [];
  for (const line of jsonl.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const event = asEvent(parsed);
    if (event !== undefined) events.push(event);
  }
  return events;
}

function asEvent(parsed: unknown): RecordedEvent | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { event, link } = parsed as { event?: unknown; link?: unknown };
  if (typeof event !== 'object' || event === null) return undefined;
  if (typeof link !== 'object' || link === null) return undefined;
  const { kind, subject, payload } = event as Record<string, unknown>;
  const { hash } = link as Record<string, unknown>;
  if (typeof kind !== 'string' || typeof subject !== 'string' || typeof hash !== 'string') {
    return undefined;
  }
  const body =
    typeof payload === 'object' && payload !== null
      ? (payload as Readonly<Record<string, unknown>>)
      : {};
  return { hash, kind, subject, payload: body };
}

/** The events the head holds and the base did not, in the head's order. */
export function eventsAdded(
  base: readonly RecordedEvent[],
  head: readonly RecordedEvent[],
): RecordedEvent[] {
  const had = new Set(base.map((event) => event.hash));
  return head.filter((event) => !had.has(event.hash));
}

/** One decision the pull request moved, and the states it moved it to. */
export interface DecisionMoved {
  readonly id: string;
  /** The citable `ADR-<n>`, when the record holds the decision's birth. */
  readonly adr: string | undefined;
  readonly title: string | undefined;
  /** The states the pull request's own events put it in, in order, each once. */
  readonly to: readonly string[];
}

/** What the pull request does to the record. */
export interface WhatItDoes {
  readonly total: number;
  /** New events per kind, most numerous first, ties by name. */
  readonly byKind: readonly (readonly [string, number])[];
  readonly decisions: readonly DecisionMoved[];
}

/**
 * Counts the added events by kind and names the decisions they touch. `all` is the head's whole
 * record: a decision moved in this pull request was born in an earlier one, and its title and
 * `ADR-<n>` live there.
 */
export function whatItDoes(
  added: readonly RecordedEvent[],
  all: readonly RecordedEvent[],
): WhatItDoes {
  const counts = new Map<string, number>();
  for (const event of added) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  const byKind = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const births = new Map<string, { adr: string | undefined; title: string | undefined }>();
  for (const event of all) {
    if (event.kind !== 'decision.recorded') continue;
    const { adr, title } = event.payload;
    births.set(event.subject, {
      adr: typeof adr === 'string' ? adr : undefined,
      title: typeof title === 'string' ? title : undefined,
    });
  }

  const moved = new Map<string, string[]>();
  for (const event of added) {
    if (event.kind !== 'decision.transitioned') continue;
    const { to } = event.payload;
    if (typeof to !== 'string') continue;
    const states = moved.get(event.subject) ?? [];
    if (!states.includes(to)) states.push(to);
    moved.set(event.subject, states);
  }

  const decisions = [...moved].map(([id, to]) => ({
    id,
    adr: births.get(id)?.adr,
    title: births.get(id)?.title,
    to,
  }));
  return { total: added.length, byKind, decisions };
}
