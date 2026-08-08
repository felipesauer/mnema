import { describe, expect, it } from 'vitest';
import { deriveAlias } from './alias.js';
import { canonicalId, mintedIdsIn, mintId } from './id.js';

/**
 * Whether a value is written the way an id is — asked of the PRODUCT's recognizer.
 *
 * ⚠️ THIS FILE WROTE ITS OWN PATTERN FOR IT, and that was one reading of the form too
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
    // land in the same millisecond, so this exercises the random tail, not the
    // timestamp: all distinct means the entropy, not the clock, separates them.
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) ids.add(mintId());
    expect(ids.size).toBe(1000);
  });

  it('begins with a timestamp, so ids sort by creation order (alias.ts contract)', () => {
    // The high 48 bits are the Unix millisecond, so a later mint is >= an
    // earlier one lexicographically on the leading run. Compare two draws made
    // in order; the second cannot sort before the first.
    const first = mintId();
    const second = mintId();
    expect(second.slice(0, 8) >= first.slice(0, 8)).toBe(true);
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
