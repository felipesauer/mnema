import { describe, expect, it } from 'vitest';
import { deriveAlias } from './alias.js';
import { canonicalId, mintId } from './id.js';

/** A UUID v7: version nibble 7, variant 8/9/a/b, lowercase hex + dashes. */
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('mintId', () => {
  it('produces a well-formed UUID v7 (version and variant bits set)', () => {
    expect(mintId()).toMatch(V7);
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
