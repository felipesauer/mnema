/**
 * A COMMITTED KEY FILE WHOSE NAME IS NOT ITS KEY IS REFUSED, WHETHER OR NOT ANYTHING USES IT.
 *
 * `keys/<fingerprint>.pub` is the one place a record ties a name to key material, and FORMAT.md
 * section 6 has a reader recompute the name from the material rather than trust it. The product
 * recomputed it only when a signature asked for the key (a checkpoint's, a tail proof's, an
 * enrolment's), so a file nothing used, filed under a name its material does not hash to, was
 * read as a committed key with no tail, a note, and the record verified. The second reader
 * refused the same bytes. Now both refuse it by the same words, and a key whose name is its
 * fingerprint and that nothing uses is still the note it always was.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded } from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';
import { generateKeyPair, publicKeyToPem } from './keys.js';
import { keysDir } from './layout.js';

let sandbox: string;
let root: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-misnamed-key-'));
  root = join(sandbox, 'tree');
  mkdirSync(root, { recursive: true });
  const writer = openChainForWriting(root, { keyRoot: join(sandbox, 'key-root') });
  writer.append(
    identityFounded(
      {
        at: '2026-10-21T00:00:00.000Z',
        who: writer.anchor,
        signerFp: writer.signerFingerprint,
        subject: writer.anchor,
      },
      { foundingFp: writer.signerFingerprint },
    ),
  );
  writer.checkpoint();
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Commits a key nothing uses, under `name`, and returns the fingerprint its material has. */
function commitAnUnusedKey(name?: string): { name: string; fingerprint: string } {
  const key = generateKeyPair();
  const filed = name ?? key.fingerprint;
  writeFileSync(join(keysDir({ root }), `${filed}.pub`), publicKeyToPem(key.publicKey));
  return { name: filed, fingerprint: key.fingerprint };
}

describe('a committed key nothing uses', () => {
  it('verifies, and is said as a key with no tail, when its name is its fingerprint', () => {
    const unused = commitAnUnusedKey();
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(
      result.census.filter((note) => note.kind === 'key-without-tail').map((n) => n.fingerprint),
    ).toEqual([unused.fingerprint]);
  });

  it('is refused by name when its name is not the fingerprint of the key it holds', () => {
    const name = 'b'.repeat(64);
    const unused = commitAnUnusedKey(name);
    expect(unused.fingerprint).not.toBe(name);

    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.level).toBe('broken');
    expect(result.issues).toEqual([
      {
        layer: 'T2/T4',
        detail:
          `MISNAMED KEY: the key file keys/${name}.pub is named for a fingerprint its own ` +
          `material does not hash to (it hashes to ${unused.fingerprint}), so a signature ` +
          'could be re-pointed at another key by renaming a file',
      },
    ]);
  });
});
