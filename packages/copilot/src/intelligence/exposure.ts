/**
 * exposure: which records hold something shaped like a credential — and never
 * what it is.
 *
 * The content door defends what ARRIVES. It cannot defend what is already there,
 * and every record written before it existed was written with no defense at all.
 * In a public tree that past is what decides the damage, because it is committed
 * and it clones, so the question "what is already in here?" has to be answerable
 * without opening every record by hand.
 *
 * IT REPORTS WHERE, NEVER WHAT. Each finding carries the record's id, its kind,
 * the tree it lives in, when it was written and the CLASS of credential found —
 * and no part of the value, not truncated and not partly masked. A report that
 * listed credentials would turn the remedy into a second disclosure: into a CI
 * log, a terminal scrollback, a screenshot, a pasted bug report. That is enforced
 * by the shape rather than by discipline — the detector this calls returns classes
 * and nothing else (see `detectSecrets`), so there is no value here to print even
 * by accident, in the human summary or in the JSON.
 *
 * IT SCANS THE WHOLE EVENT GENERICALLY. Every string anywhere in an event —
 * envelope and payload alike — goes through the detector, rather than a per-kind
 * list of the fields that hold text. Two reasons, and the second is the one that
 * matters: a transition's proof lives in a nested `fields` object that no
 * projection exposes whole, so a field-by-field reader would miss exactly the
 * notes and reasons a person types fastest; and a new kind of event is covered the
 * day it is added, with nobody having to remember this file exists.
 *
 * THE ENVELOPE IS IN THE SWEEP, and leaving it out was a hole rather than a
 * saving. `which` — the executing agent — is the envelope's one free-text field,
 * and a payload-only scan answered "nothing recognizable" about a record whose
 * envelope held a credential on disk. That is the exact failure the audit exists
 * to prevent, one level up: not a record written unprotected, but the report
 * declaring it clean. The other envelope fields cost nothing to include — an
 * anchor, a fingerprint, a v7 id and an ISO instant match no known-prefix pattern,
 * which the known-prefix rule is precisely what makes safe (an entropy rule would
 * have flagged all of them, which is why there is none).
 *
 * WHAT IT FINDS AND WHAT IT DOES NOT are the detector's, exactly: recognized
 * formats, and nothing else. A password in prose or a proprietary token is not
 * here, and an empty report means "nothing recognizable", never "nothing".
 *
 * It reads the raw event stream rather than the projections, for the reason the
 * other intelligence reads do: the question is about the FACTS as written, and a
 * projection keeps the current state rather than the text of every event.
 */

import { detectSecrets, type Scope, type SecretClass } from '@mnema/core';
import type { CatalogEvent } from './events.js';

/** One tree's events, and which tree they are — the scope every finding carries. */
export interface ScopedEvents {
  /** The tree these events were read from. */
  readonly scope: Scope;
  /** The tree's events, in the order the chain proves. */
  readonly events: readonly CatalogEvent[];
}

/** One record that holds something shaped like a credential. */
export interface ExposedRecord {
  /** The event's subject — the entity to look up, or the fact's own id. */
  readonly id: string;
  /** What kind of event it is (`memory.captured`, `task.transitioned`, …). */
  readonly kind: string;
  /** The tree it lives in — a public one is committed and clones. */
  readonly scope: Scope;
  /** When it was written. */
  readonly at: string;
  /**
   * The classes found in it, distinct and sorted. NOT the values, and there is no
   * field here that could carry one.
   */
  readonly classes: readonly SecretClass[];
}

/** What the record holds, as a report a person can act on. */
export interface Exposure {
  /** The records that hold something, oldest first. Empty when none do. */
  readonly findings: readonly ExposedRecord[];
  /** How many events were read to answer — the denominator of the report. */
  readonly scanned: number;
}

/**
 * Scans every event of every tree handed in and reports the records that hold a
 * recognized credential format.
 *
 * The order is oldest first, then by id: the oldest exposure is the one that has
 * had the longest to travel, so it is the one to rotate first. Pure — it folds the
 * streams it is given and reads nothing else.
 */
export function exposure(sources: readonly ScopedEvents[]): Exposure {
  const findings: ExposedRecord[] = [];
  let scanned = 0;

  for (const source of sources) {
    for (const event of source.events) {
      scanned += 1;
      const classes = classesIn(event);
      if (classes.length === 0) continue;
      findings.push({
        id: event.subject,
        kind: event.kind,
        scope: source.scope,
        at: event.at,
        classes,
      });
    }
  }

  findings.sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : compare(a.id, b.id)));
  return { findings, scanned };
}

/**
 * The distinct classes found anywhere in an event, sorted. Walks strings, arrays
 * and nested objects alike, so a proof field inside `fields` is reached without
 * this function knowing that `fields` exists — and so is the envelope's `which`,
 * without this function knowing there is an envelope.
 */
function classesIn(event: unknown): SecretClass[] {
  const found = new Set<SecretClass>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const secret of detectSecrets(value)) found.add(secret);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(event);
  return [...found].sort(compare);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
