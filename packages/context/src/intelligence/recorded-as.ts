/**
 * The other spelling a link's target may have been recorded as.
 *
 * The public tree records an absolute path under the project root RELATIVE to it, so the text a
 * person types to ask about a target and the text the record holds can differ. The caller names the
 * one other spelling (it owns the reduction); this module owns which edges that spelling may answer
 * for: a link of a relation that carries an ADDRESS, whose TARGET it is, in the one tree that did the
 * reducing. Any other fact that happens to name the same text is about something else.
 */

import { ADDRESS_RELATIONS } from '@mnema/core';
import type { ScopedCache } from '../sources.js';
import type { CatalogEvent } from './events.js';

/** The text an asked target was recorded as, and the tree that recorded it so. */
export interface RecordedAs {
  /** The target as that tree holds it. */
  readonly target: string;
  /** The chain root of the tree: no other tree reduced anything. */
  readonly chainRoot: string;
}

/** Whether this tree is the one `recordedAs` speaks for. */
export function isTheTreeThatReduced(source: ScopedCache, recordedAs: RecordedAs): boolean {
  return source.chainRoot === recordedAs.chainRoot;
}

/** Whether an event is a link of an address relation: the only kind the other spelling answers for. */
export function isAnAddressLink(event: CatalogEvent): boolean {
  return (
    event.kind === 'knowledge.linked' &&
    (ADDRESS_RELATIONS as readonly string[]).includes(event.payload.rel)
  );
}
