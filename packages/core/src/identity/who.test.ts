import { describe, expect, it } from 'vitest';
import { canonicalIdentity } from './who.js';

describe('canonicalIdentity', () => {
  it('trims surrounding whitespace', () => {
    expect(canonicalIdentity('  felipe  ')).toBe('felipe');
    expect(canonicalIdentity('\tfelipe\n')).toBe('felipe');
  });

  it('is idempotent: canonicalizing a canonical value changes nothing', () => {
    const once = canonicalIdentity('  felipe ');
    expect(canonicalIdentity(once)).toBe(once);
  });

  it('leaves an already-clean identity untouched', () => {
    expect(canonicalIdentity('felipe')).toBe('felipe');
  });

  it('rejects a value that is empty once trimmed', () => {
    expect(canonicalIdentity('')).toBeUndefined();
    expect(canonicalIdentity('   ')).toBeUndefined();
    expect(canonicalIdentity('\t\n ')).toBeUndefined();
  });

  it('rejects a non-string (junk from an untrusted surface) without throwing', () => {
    expect(canonicalIdentity(5)).toBeUndefined();
    expect(canonicalIdentity(null)).toBeUndefined();
    expect(canonicalIdentity(undefined)).toBeUndefined();
    expect(canonicalIdentity({})).toBeUndefined();
    expect(canonicalIdentity(['felipe'])).toBeUndefined();
  });

  it('does NOT case-fold — distinct spellings stay distinct (reconcilable later)', () => {
    // A false MERGE in an immutable log is irreversible; case folding is
    // deferred to a real identity model. Only whitespace is normalized.
    expect(canonicalIdentity('Felipe')).toBe('Felipe');
    expect(canonicalIdentity('felipe')).toBe('felipe');
    expect(canonicalIdentity('Felipe')).not.toBe(canonicalIdentity('felipe'));
  });

  it('preserves internal whitespace (only the ends are trimmed)', () => {
    expect(canonicalIdentity('  Felipe Sauer  ')).toBe('Felipe Sauer');
  });

  it('normalizes composition to NFC so equal text is one identity', () => {
    // "José" pre-composed (U+00E9) vs decomposed ("e" + U+0301). They render
    // identically and are the same person; the chain stores NFC, so this must
    // too, or the gate would see two distinct strings for one identity.
    const nfc = 'José';
    const nfd = 'José';
    expect(nfc).not.toBe(nfd); // byte-distinct before normalization
    expect(canonicalIdentity(nfc)).toBe(canonicalIdentity(nfd));
    // and the returned form is the NFC one
    expect(canonicalIdentity(nfd)).toBe(nfc);
  });

  it('rejects a string the chain cannot canonicalize (a lone surrogate)', () => {
    // A lone (unpaired) high surrogate is not valid Unicode text; the chain
    // refuses it at seal time, so accepting it here would mean the gate
    // authorizes a move the writer then throws on. Refuse it up front.
    expect(canonicalIdentity('\ud800alice')).toBeUndefined();
    expect(canonicalIdentity('alice\udfff')).toBeUndefined();
  });
});
