import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ANCHOR_PREFIX, deriveAnchor, fingerprintOf, generateKeyPair } from './keys.js';

describe('key material', () => {
  it('derives a full fingerprint that is the SHA-256 of the raw public key', () => {
    const pair = generateKeyPair();
    const raw = pair.publicKey.export({ type: 'spki', format: 'der' });
    const expected = createHash('sha256').update(raw).digest('hex');
    expect(pair.fingerprint).toBe(expected);
    expect(fingerprintOf(pair.publicKey)).toBe(pair.fingerprint);
  });

  describe('deriveAnchor', () => {
    it('is the prefixed SHA-256 of the fingerprint — a value distinct from it', () => {
      const fp = 'a'.repeat(64);
      const anchor = deriveAnchor(fp);
      expect(anchor).toBe(ANCHOR_PREFIX + createHash('sha256').update(fp).digest('hex'));
      // The anchor is a further hash, never the fingerprint itself, so a `who`
      // can never be mistaken for the physical key it was derived from.
      expect(anchor).not.toContain(fp);
    });

    it('is deterministic: the same fingerprint always yields the same anchor', () => {
      const fp = generateKeyPair().fingerprint;
      expect(deriveAnchor(fp)).toBe(deriveAnchor(fp));
    });

    it('gives distinct anchors to distinct keys (unique by construction)', () => {
      const a = deriveAnchor(generateKeyPair().fingerprint);
      const b = deriveAnchor(generateKeyPair().fingerprint);
      expect(a).not.toBe(b);
    });

    it('carries the mnid prefix so an anchor reads as an anchor, not a bare hash', () => {
      expect(deriveAnchor('f'.repeat(64)).startsWith(ANCHOR_PREFIX)).toBe(true);
    });
  });
});
