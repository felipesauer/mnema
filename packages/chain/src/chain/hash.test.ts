import { describe, expect, it } from 'vitest';

import { taskCreated } from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import { contentRoot, entryHash, eventBytes } from './hash.js';

const env = (subject: string) => ({
  at: '2026-07-21T00:00:00.000Z',
  who: 'mnid:aa',
  signerFp: 'fp-1',
  subject,
});
const ev = (title: string): CatalogEvent => taskCreated(env('t-1'), { title });

describe('contentRoot — framing rules out concatenation collisions', () => {
  it('is deterministic for the same events', () => {
    const events = [ev('a'), ev('b')];
    expect(contentRoot(events)).toBe(contentRoot([ev('a'), ev('b')]));
  });

  it('changes if any event content changes', () => {
    expect(contentRoot([ev('a'), ev('b')])).not.toBe(contentRoot([ev('a'), ev('B')]));
  });

  it('is order-sensitive', () => {
    expect(contentRoot([ev('a'), ev('b')])).not.toBe(contentRoot([ev('b'), ev('a')]));
  });

  it('an empty range has a fixed root distinct from any single-event root', () => {
    const empty = contentRoot([]);
    expect(empty).toBe(contentRoot([]));
    expect(empty).not.toBe(contentRoot([ev('a')]));
  });

  it('a two-event root never equals a one-event root over the concatenation', () => {
    // Without length-framing, H(H(bytesA) ++ bytesB) could be reachable another
    // way; framing makes the split unambiguous. Distinct shapes → distinct roots.
    const two = contentRoot([ev('a'), ev('b')]);
    const one = contentRoot([ev('ab')]);
    expect(two).not.toBe(one);
  });
});

describe('entryHash — binds content, position, and predecessor', () => {
  const base = { event: ev('x'), tail: 't', seq: 1, prev: 'deadbeef' as string | null };

  it('is deterministic', () => {
    expect(entryHash(base)).toBe(entryHash({ ...base }));
  });

  it('changes with content, tail, seq, or prev', () => {
    const h = entryHash(base);
    expect(entryHash({ ...base, event: ev('y') })).not.toBe(h);
    expect(entryHash({ ...base, tail: 'u' })).not.toBe(h);
    expect(entryHash({ ...base, seq: 2 })).not.toBe(h);
    expect(entryHash({ ...base, prev: 'cafe' })).not.toBe(h);
  });

  it('distinguishes a genesis entry (prev=null) from a prev of empty string', () => {
    const genesis = entryHash({ ...base, prev: null });
    const emptyPrev = entryHash({ ...base, prev: '' });
    // '' is not a valid stored prev, but the framing must still not collide the
    // two conceptually-different states.
    expect(genesis).not.toBe(emptyPrev);
  });
});

describe('eventBytes', () => {
  it('is the canonical bytes of the event', () => {
    const event = ev('x');
    expect(new TextDecoder().decode(eventBytes(event))).toContain('"title":"x"');
  });
});
