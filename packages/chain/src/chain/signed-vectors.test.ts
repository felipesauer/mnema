import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { VECTORS_FILE } from '../events/vectors.js';
import { NAMED_SCHEME, SCHEME } from './checkpoint.js';
import { RECORD_DOMAIN } from './record-name.js';
import {
  type SignedMessageVectors,
  signedMessageVectors,
  VECTOR_SECRET,
} from './signed-vectors.js';
import { NAMED_TAILPROOF_SCHEME, TAILPROOF_SCHEME } from './tailproof.js';

const published = (
  JSON.parse(readFileSync(VECTORS_FILE, 'utf-8')) as {
    signedMessages: SignedMessageVectors;
  }
).signedMessages;

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** Section 2's framing, written here by hand rather than through the code under test. */
function framed(domain: string, ...fields: string[]): string {
  const h = createHash('sha256');
  for (const field of [domain, ...fields]) {
    const bytes = Buffer.from(field, 'utf-8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    h.update(length).update(bytes);
  }
  return h.digest('hex');
}

describe('the published signed messages', () => {
  it('are exactly what the code signs today', () => {
    // A change to a signed message, a scheme or a name reddens here: regenerate the artifact
    // from `signedMessageVectors()` and the diff is the change.
    expect(published).toEqual(signedMessageVectors());
  });

  it('are five: a checkpoint and a tail proof under each scheme, and a /2 checkpoint after a /1', () => {
    expect(published.vectors.map((v) => v.scheme)).toEqual([
      SCHEME,
      NAMED_SCHEME,
      NAMED_SCHEME,
      TAILPROOF_SCHEME,
      NAMED_TAILPROOF_SCHEME,
    ]);
  });

  it('are signed by the key RFC 8032 publishes, and each verifies over its message', () => {
    expect(VECTOR_SECRET).toBe('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
    const key = createPublicKey(published.key.publicKey);
    // RFC 8032 section 7.1 TEST 1's public key, after the twelve-byte SPKI prefix.
    expect(key.export({ format: 'der', type: 'spki' }).toString('hex').slice(24)).toBe(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    );
    expect(sha256(key.export({ format: 'der', type: 'spki' }))).toBe(published.key.fingerprint);
    for (const vector of published.vectors) {
      const { sig, ...signed } = vector.stored;
      // The message is the canonical bytes of the stored object without `sig`: its keys sorted.
      expect(Object.keys(JSON.parse(vector.message))).toEqual(Object.keys(signed).sort());
      expect(JSON.parse(vector.message)).toEqual(signed);
      expect(sha256(vector.message)).toBe(vector.sha256);
      expect(
        verify(null, Buffer.from(vector.message), key, Buffer.from(String(sig), 'hex')),
        vector.name,
      ).toBe(true);
    }
  });

  it('link a /2 checkpoint to a /1 one by the hash of the earlier message, under its scheme', () => {
    const [before, after] = published.vectors;
    expect(after?.stored.prev).toBe(before?.sha256);
  });

  it('name the record from its genesis tail, and every /2 artifact names it', () => {
    expect(published.record.domain).toBe(RECORD_DOMAIN);
    expect(published.record.name).toBe(framed('mnema.record.v1', published.record.genesisTail));
    const named = published.vectors.filter((v) => 'record' in v.stored);
    expect(named).toHaveLength(3);
    for (const vector of named) expect(vector.stored.record).toBe(published.record.name);
  });
});
