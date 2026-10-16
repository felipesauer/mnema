/**
 * A PUBLIC KEY SWAPPED FOR ANOTHER IS NAMED AT THE SIGNATURE LAYER, by the issue that says it
 * was swapped.
 *
 * The file is named by a fingerprint, and a forger can overwrite it with a key of their own.
 * The reader re-derives the loaded key's fingerprint and refuses when it is not the one the
 * checkpoint names. Other issues may follow from the same swap, so it is not enough that SOME
 * issue of the record sits at that layer: the one that names the swap must, and `layer` is
 * what a consumer filters the issues on.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded } from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';
import { generateKeyPair, publicKeyToPem } from './keys.js';
import { publicKeyPath } from './layout.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-swapped-key-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a public key swapped for another', () => {
  it('is named by an issue of the signature layer that says the key was swapped', () => {
    const writer = openChainForWriting(root, { keyRoot: root });
    writer.append(
      identityFounded(
        {
          at: '2026-10-15T00:00:00.000Z',
          who: writer.anchor,
          signerFp: writer.signerFingerprint,
          subject: writer.anchor,
        },
        { foundingFp: writer.signerFingerprint },
      ),
    );
    writer.checkpoint();
    expect(verify(root).ok).toBe(true);

    const forger = generateKeyPair();
    writeFileSync(
      publicKeyPath({ root }, writer.signerFingerprint),
      publicKeyToPem(forger.publicKey),
      'utf-8',
    );

    const result = verify(root);
    expect(result.ok).toBe(false);
    const swapped = result.issues.filter((issue) => issue.detail.includes('key was swapped'));
    expect(swapped).toHaveLength(1);
    expect(swapped[0]?.layer).toBe('T2/T4');
    expect(swapped[0]?.detail).toContain(writer.signerFingerprint);
  });
});
