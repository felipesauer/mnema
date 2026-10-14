import { ADDRESS_RELATIONS } from '@mnema/core';
import { describe, expect, it } from 'vitest';
import type { ScopedCache } from '../sources.js';
import type { CatalogEvent } from './events.js';
import { isAnAddressLink, isTheTreeThatReduced } from './recorded-as.js';

/** The one field each predicate reads of an event, with the rest of the envelope left out. */
const event = (kind: string, rel: string): CatalogEvent =>
  ({ kind, subject: 's', payload: { target: 't', rel } }) as unknown as CatalogEvent;

describe('the edges the other spelling of a target may answer for', () => {
  it.each(ADDRESS_RELATIONS)('answers for a %s link', (rel) => {
    expect(isAnAddressLink(event('knowledge.linked', rel))).toBe(true);
  });

  it('does not answer for a relation that carries no address', () => {
    expect(isAnAddressLink(event('knowledge.linked', 'derived-from'))).toBe(false);
    expect(isAnAddressLink(event('knowledge.linked', 'relates-to'))).toBe(false);
  });

  it('does not answer for a fact that is not a link, whatever it carries', () => {
    expect(isAnAddressLink(event('observation.recorded', ADDRESS_RELATIONS[0]))).toBe(false);
  });
});

describe('the tree that reduced a target', () => {
  const tree = (chainRoot: string) => ({ chainRoot }) as unknown as ScopedCache;
  const asked = { target: 'src', chainRoot: '/work/repo/.mnema' };

  it('is the one whose chain root it names, and no other', () => {
    expect(isTheTreeThatReduced(tree('/work/repo/.mnema'), asked)).toBe(true);
    expect(isTheTreeThatReduced(tree('/work/repo/.mnema-private'), asked)).toBe(false);
    expect(isTheTreeThatReduced(tree('/work/other/.mnema'), asked)).toBe(false);
  });
});
