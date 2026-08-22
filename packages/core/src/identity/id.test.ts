import { describe, expect, it } from 'vitest';
import { deriveAlias } from './alias.js';
import { canonicalId, mintedIdsIn, mintId, nextMintPosition } from './id.js';

/**
 * Whether a value is written the way an id is — asked of the PRODUCT's recognizer.
 *
 * THIS FILE WROTE ITS OWN PATTERN FOR IT, and that was one reading of the form too
 * many. A regex beside a generator is a fixture that can go wrong in both directions —
 * accept a value nothing here can produce, or refuse one just produced — and it says
 * nothing about whichever of the two the product itself uses. There is one shape in this
 * module now ({@link mintedIdsIn}), and the case below is what closes the loop: it feeds
 * the recognizer what the generator makes.
 */
const shapedLikeAnId = (value: string): boolean =>
  mintedIdsIn(value).some((found) => found.id === value && found.at === 0);

describe('mintId', () => {
  it('produces a well-formed UUID v7 (version and variant bits set)', () => {
    expect(shapedLikeAnId(mintId())).toBe(true);
    // Over many draws rather than one, because the two nibbles the generator FIXES are
    // the two a single draw is least likely to tell you anything about: it is the
    // random tail that varies, and the version and variant have to survive all of it.
    for (let drawn = 0; drawn < 500; drawn += 1) {
      const id = mintId();
      expect(shapedLikeAnId(id), id).toBe(true);
    }
  });

  it('mints a distinct id on every call — the property that closes false-merge', () => {
    // Two clones minting offline must never collide. Many draws in a tight loop
    // land in the same millisecond, so this exercises what is BESIDE the timestamp:
    // all distinct means the clock is not what separates them. Twelve of those bits
    // are now a counter rather than randomness (see `mintId`), which is why the
    // property is stated as distinctness and not as entropy — the 62 bits of
    // `rand_b` are what close false-merge between clones, and they are untouched.
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) ids.add(mintId());
    expect(ids.size).toBe(1000);
  });

  it('begins with a timestamp, so ids sort by creation order (alias.ts contract)', () => {
    // The high 48 bits are the Unix millisecond, so a later mint is >= an
    // earlier one lexicographically on the leading run. Compare two draws made
    // in order; the second cannot sort before the first.
    //
    // This is HALF the contract, and the weaker half: two draws in a tight loop are
    // almost always in the same millisecond, so `>=` is what it can honestly assert
    // and the case below is the one that asserts the ordering inside one.
    const first = mintId();
    const second = mintId();
    expect(second.slice(0, 8) >= first.slice(0, 8)).toBe(true);
  });

  it('a burst inside ONE millisecond is strictly increasing, not a coin flip', () => {
    // The case the trunk went red on, at the level where it is decided. `at` and
    // the id prefix both have millisecond resolution, and an agent writing several
    // records in a row puts nearly all of them in one millisecond — measured, 99.4%
    // of 1999 consecutive pairs. Whatever separates two ids inside that millisecond
    // IS the order every "newest first" reading falls back on, so it has to be the
    // order they were minted in, for every pair and not for half of them.
    const ids: string[] = [];
    for (let i = 0; i < 2000; i += 1) ids.push(mintId());

    const sameMillisecond = (a: string, b: string): boolean => a.slice(0, 13) === b.slice(0, 13);
    const pairs = ids.slice(1).map((id, i) => [ids[i] as string, id] as const);
    const inside = pairs.filter(([a, b]) => sameMillisecond(a, b));
    // Not an assumption about the machine: if a run were somehow slow enough to put
    // every mint in its own millisecond, the case below would pass without having
    // exercised anything, so the burst has to be a burst.
    expect(inside.length).toBeGreaterThan(pairs.length / 2);

    const swapped = inside.filter(([a, b]) => a >= b);
    // Counted rather than listed: the failure this replaces printed a thousand pairs
    // and the RATE is the whole finding — half of them, not a rare one.
    expect(
      swapped.length,
      `${swapped.length} of ${inside.length} pairs minted inside one millisecond came back out of order`,
    ).toBe(0);
  });
});

describe('nextMintPosition — the monotonicity rule, including where its headroom ends', () => {
  it('restarts the counter on a new millisecond', () => {
    expect(nextMintPosition(1000, { ms: 999, counter: 57 })).toEqual({ ms: 1000, counter: 0 });
  });

  it('advances the counter inside one millisecond — the order the clock cannot carry', () => {
    expect(nextMintPosition(1000, { ms: 1000, counter: 0 })).toEqual({ ms: 1000, counter: 1 });
  });

  it('keeps going forward when the clock steps BACKWARDS', () => {
    // An NTP correction, or a suspended laptop. The position is what the sequence is
    // read off, so a backwards clock must not be able to re-issue a millisecond that
    // ids have already been minted in — it would put a new id before an older one.
    expect(nextMintPosition(500, { ms: 1000, counter: 3 })).toEqual({ ms: 1000, counter: 4 });
  });

  it('borrows the next millisecond when the 4096 run out, rather than repeating one', () => {
    // The branch the burst case cannot reach: 4096 ids inside one millisecond is 26×
    // the rate measured on this machine, so it is driven here directly. What must NOT
    // happen is a repeat — a wrapped counter would put the 4097th id at the same
    // position as the first, and the whole order would fold at that point.
    expect(nextMintPosition(1000, { ms: 1000, counter: 0xfff })).toEqual({
      ms: 1001,
      counter: 0,
    });
    // And it keeps borrowing: a second overflow lands one further on, never back.
    expect(nextMintPosition(1000, { ms: 1001, counter: 0xfff })).toEqual({
      ms: 1002,
      counter: 0,
    });
  });

  it('is strictly increasing over the whole span it can be driven through', () => {
    // The property the three branches exist to produce, asserted over a run that
    // crosses an overflow: every position is greater than the one before it, whatever
    // the clock does. Read as (ms, counter) lexicographically, which is the order the
    // bytes of the id are laid out in.
    const before = (a: { ms: number; counter: number }, b: { ms: number; counter: number }) =>
      a.ms < b.ms || (a.ms === b.ms && a.counter < b.counter);
    let position = { ms: 1000, counter: 0xff0 };
    // A clock that ticks once, then stalls, then jumps backwards.
    const clock = [1000, 1001, ...Array.from({ length: 30 }, () => 1001), 900, 900, 900];
    for (const now of clock) {
      const next = nextMintPosition(now, position);
      expect(before(position, next), `${JSON.stringify(position)} → ${JSON.stringify(next)}`).toBe(
        true,
      );
      position = next;
    }
  });

  it('is already canonical — canonicalId leaves it unchanged', () => {
    const id = mintId();
    expect(canonicalId(id)).toBe(id);
  });

  it('an alias derives cleanly from a minted id', () => {
    // The alias contract is sha256(id) prefixed by kind; it works over any id,
    // and a minted id must be no exception.
    const id = mintId();
    const alias = deriveAlias('task', id);
    expect(alias.startsWith('t-')).toBe(true);
    // Two distinct minted ids sharing a leading timestamp run still get
    // distinct aliases (the hash spreads them), which is why the alias hashes
    // the id rather than slicing its prefix.
    const other = mintId();
    expect(deriveAlias('task', other)).not.toBe(alias);
  });
});

describe('mintedIdsIn — the form, read off the generator rather than beside it', () => {
  it('refuses everything the generator cannot produce', () => {
    const id = mintId();
    // ONE CHARACTER OFF IN EVERY DIRECTION, and each of them is a value some other part
    // of this product really writes: a UUID of another version, an id shortened by one,
    // one lengthened by one, an upper-cased one, one whose dashes fell elsewhere.
    const version = `${id.slice(0, 14)}4${id.slice(15)}`;
    const variant = `${id.slice(0, 19)}c${id.slice(20)}`;
    expect(shapedLikeAnId(version), version).toBe(false);
    expect(shapedLikeAnId(variant), variant).toBe(false);
    expect(shapedLikeAnId(id.slice(0, -1))).toBe(false);
    expect(shapedLikeAnId(`${id}f`)).toBe(false);
    expect(shapedLikeAnId(id.toUpperCase())).toBe(false);
    expect(shapedLikeAnId(id.replace(/-/g, ''))).toBe(false);
    // NOT VACUOUS: the two mutants differ from the id in one character each, and the id
    // itself is accepted.
    expect(version).toHaveLength(id.length);
    expect(variant).toHaveLength(id.length);
    expect(shapedLikeAnId(id)).toBe(true);
  });

  it('finds ids WHERE THEY SIT, and never a piece of a longer word', () => {
    const one = mintId();
    const other = mintId();
    const line = `  ${one}  public  and ${other}.`;
    expect(mintedIdsIn(line).map((found) => found.id)).toEqual([one, other]);
    // WHERE, exactly — the caller slices around it, so an index that is off by one is a
    // caller that cuts a character off the value or leaves one behind.
    for (const found of mintedIdsIn(line)) {
      expect(line.slice(found.at, found.at + found.id.length)).toBe(found.id);
    }
    // AND NOT INSIDE A LONGER RUN of the same alphabet, which is what a value with a
    // suffix is: `<id>-draft` is a different string, not an id with something after it.
    expect(mintedIdsIn(`${one}-draft`)).toEqual([]);
    expect(mintedIdsIn(`x${one}`)).toEqual([]);
    // Nothing in a text that holds none, including the near misses this product writes.
    expect(mintedIdsIn('created 2026-08-08T16:30:33.100Z · t-3a9f · mnid:4f2a9c1b')).toEqual([]);
    expect(mintedIdsIn('')).toEqual([]);
  });

  it('answers the same way twice, so no caller resumes another’s position', () => {
    // The pattern is global and therefore stateful. A walk that started where the last
    // one stopped would answer differently on the second call over the same text, and
    // the caller — a console reading every line it lands — makes exactly that call.
    const line = `${mintId()} and ${mintId()}`;
    expect(mintedIdsIn(line)).toEqual(mintedIdsIn(line));
    expect(mintedIdsIn(line)).toHaveLength(2);
  });
});

describe('canonicalId — the form of a reference to an already-minted id', () => {
  it('returns a plain reference unchanged', () => {
    expect(canonicalId('t-abc')).toBe('t-abc');
  });

  it('NFC-normalizes so a decomposed spelling matches the stored (NFC) subject', () => {
    // The chain stores every string NFC; a reference in a different composition
    // must collapse to the same key, or a lookup would false-miss. Build the
    // decomposed form at runtime so the source encoding cannot pre-compose it.
    const nfd = `d-cafe${String.fromCharCode(0x0301)}`; // "cafe" + combining acute
    const nfc = nfd.normalize('NFC');
    expect(nfc).not.toBe(nfd); // the two spellings really differ in bytes
    expect(canonicalId(nfd)).toBe(nfc);
    expect(canonicalId(nfc)).toBe(nfc);
    // Both spellings canonicalize to the identical string — no composition split.
    expect(canonicalId(nfd)).toBe(canonicalId(nfc));
  });

  it('does NOT trim — an id is taken verbatim (unlike an identity)', () => {
    // canonicalIdentity trims; canonicalId must not, so a reference stays
    // byte-aligned with the subject the chain stored.
    expect(canonicalId('  x  ')).toBe('  x  ');
  });

  it('rejects a non-string, empty, or unrepresentable reference', () => {
    expect(canonicalId(undefined)).toBeUndefined();
    expect(canonicalId(42)).toBeUndefined();
    expect(canonicalId('')).toBeUndefined();
    // A lone surrogate cannot be canonicalized deterministically.
    expect(canonicalId('\ud800bad')).toBeUndefined();
  });
});
