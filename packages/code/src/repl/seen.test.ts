/**
 * WHAT THE SESSION REMEMBERS HAVING NAMED, on lines this product really wrote.
 *
 * The mechanism, on input this file owns. Every row below is bytes copied out of a real
 * `search` and a real `show` over a real project rather than a shape invented here, which
 * is what keeps the gloss from being asserted against a table nobody prints; the elo over
 * the whole surface — the ids of a record, read off a screen and completed back into the
 * row being typed — is `tests/the-record-you-can-see.test.ts`, on a pseudo-terminal.
 *
 * WHAT THE CASES ARE SHAPED AROUND is the one property that makes this affordable: it
 * knows nothing except what it was told, so what it can offer is bounded by what has
 * landed. A memory that could answer with a record nobody showed would be the menu of the
 * record `complete.ts` refused, arriving through the back.
 */

import { describe, expect, it } from 'vitest';
import { whatTheSessionShowed } from './seen.js';

/**
 * Two rows of one `search`, byte for byte, and the id each of them names.
 *
 * The ids are the record's own — minted by this product, not written here — and the two
 * share a long prefix on purpose: an id begins with the millisecond it was minted, so the
 * records of one session are nearly identical at the front. That is the common case this
 * whole affordance is shaped around, not an edge one.
 */
const FIRST = '019fe236-3c8b-795a-a517-f5e55bae80de';
const SECOND = '019fe236-3d00-73e3-9776-10dca56a5d17';
const SEARCHED = [
  `  ${SECOND}  public  2026-08-08  the second task (DRAFT)`,
  `  ${FIRST}  public  2026-08-08  the first task (DRAFT)`,
];

/** The first row of a `show` over the same record — the id, again, saying less about it. */
const SHOWN = `task ${FIRST}  ·  public`;

/**
 * Faint, and what closes it: the escapes the styled renderer wraps a dim part in.
 *
 * Spelled by their code point, like every unusual byte in this repository — a control
 * character typed into a source file is invisible in review and survives an edit made
 * around it.
 */
const DIM = '\u001b[2m';
const NORMAL = '\u001b[22m';

/** A memory that has been shown `lines`, in that order. */
function after(...lines: readonly string[]) {
  const seen = whatTheSessionShowed();
  for (const line of lines) seen.saw(line);
  return seen;
}

describe('it remembers the records a line named, and what the line said about them', () => {
  it('names every id on a row, with the rest of the row beside it', () => {
    const offers = after(...SEARCHED).matching('');
    expect(offers.map((offer) => offer.word)).toEqual([SECOND, FIRST]);
    // THE GLOSS IS THE REST OF THE ROW: everything the row said except the id itself,
    // which is what makes two ids that begin alike tellable apart.
    const [second, first] = offers;
    expect(second?.description).toBe('public 2026-08-08 the second task (DRAFT)');
    expect(first?.description).toBe('public 2026-08-08 the first task (DRAFT)');
    // And the id is not in its own gloss, which would be the row repeated at every width.
    for (const offer of offers) expect(offer.description).not.toContain(offer.word);
  });

  it('collapses the padding of the row, because a table is not a description', () => {
    // The row is a table: the columns are padded and the item is indented under a
    // heading. Kept verbatim, that is a description with holes in it — so the words
    // survive, in their order, and the spacing does not.
    const [offer] = after(SEARCHED[0] as string).matching('');
    expect(offer?.description).not.toContain('  ');
    expect(offer?.description.trim()).toBe(offer?.description);
    // Nothing was dropped, only the spacing: every word of the row is still there.
    for (const word of (SEARCHED[0] as string).split(/\s+/).filter((it) => it !== SECOND)) {
      if (word.length > 0) expect(offer?.description, word).toContain(word);
    }
  });

  it('keeps the line a record was FIRST named on, however often it is named again', () => {
    // A search says the kind, the date and the title; the show that follows says less
    // about the record in more rows. One entry per RECORD rather than per mention, and
    // the entry keeps the richer line rather than the latest one.
    const offers = after(...SEARCHED, SHOWN).matching(FIRST);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.description).toBe('public 2026-08-08 the first task (DRAFT)');
    // And the other way round, so the case is about FIRST and not about which line is
    // longer: shown first, the show's own line is what names it.
    expect(after(SHOWN, ...SEARCHED).matching(FIRST)[0]?.description).toBe('task · public');
  });

  it('offers nothing it was never shown, which is the whole of what it is', () => {
    // THE GUARD. This is not a menu of the record: a record that exists and has not been
    // named on the page is a record this cannot answer with, because there is nothing
    // here that could go and find it.
    const seen = after(...SEARCHED);
    expect(seen.matching(SECOND.slice(0, 13))).toHaveLength(1);
    // A neighbouring id of the same record, never shown: refused.
    expect(seen.matching('019fe236-3e')).toEqual([]);
    expect(whatTheSessionShowed().matching('')).toEqual([]);
  });

  it('narrows to the prefix, and answers all three ways a prefix can go', () => {
    const seen = after(...SEARCHED);
    // MANY: the shared timestamp, which is what a caller has typed after reading two ids.
    expect(seen.matching('019fe236-3').map((offer) => offer.word)).toEqual([SECOND, FIRST]);
    // ONE: one character further, where the two part.
    expect(seen.matching('019fe236-3d').map((offer) => offer.word)).toEqual([SECOND]);
    // NONE, and a whole id that is not one of these is none as well.
    expect(seen.matching('019fe236-3f')).toEqual([]);
    expect(seen.matching(`${SECOND}x`)).toEqual([]);
  });

  it('reads the id a screen shows, not the bytes a stream carried', () => {
    // Inside a terminal the renderer PAINTS, so the row that lands is the row plus
    // escapes — and the id sits between two of them. What is scanned is what a reader
    // sees, so the id is found and the gloss holds no escape bytes.
    const painted = `  ${DIM}${SECOND}${NORMAL}  ${DIM}public${NORMAL}  the second task`;
    const [offer] = after(painted).matching('');
    expect(offer?.word).toBe(SECOND);
    expect(offer?.description).toBe('public the second task');
  });

  it('is not fooled by a value that only looks like one', () => {
    // A PREFIX IS NOT AN ID, which is the whole reason this exists: `show 019fe236-3d00`
    // is the dead end, and the refusal that names it is not itself a record.
    const seen = after(
      `No record ${SECOND.slice(0, 13)} here.`,
      // Nor is a timestamp, an alias, or an identity — the three other values this
      // product writes that hold hex and dashes.
      '  created 2026-08-08T16:30:33.100Z · updated 2026-08-08T16:30:33.100Z',
      '  t-3a9f  ·  mnid:4f2a9c1b',
      // Nor an id with one digit too many, or one with the version of a UUID this
      // product does not mint.
      `  ${SECOND}f`,
      '  019fe236-3d00-43e3-9776-10dca56a5d17',
    );
    expect(seen.matching('')).toEqual([]);
    // Not vacuous: the same scan over the same row WITH a whole id finds it.
    expect(after(`No record ${SECOND} here.`).matching('')).toHaveLength(1);
  });
});
