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
});
