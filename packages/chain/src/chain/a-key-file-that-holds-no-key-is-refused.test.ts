/**
 * A FILE UNDER `keys/` THAT HOLDS NO KEY IS REFUSED BY NAME, IN BOTH READERS, AND NEITHER ONE CRASHES.
 *
 * FORMAT.md section 6 has a reader recompute the name of `keys/<fingerprint>.pub` from the key
 * material in it. A `.pub` with no material in it has a name that stands for no key: it is never
 * written by the product, and appears only by mistake or tampering, as the misnamed file does.
 * The product read such a file as no key and said it as a committed key with no tail, a note, and
 * the record verified; the second reader stopped with a traceback (a `README.pub`, a directory
 * named `<fingerprint>.pub`) or refused it (bytes that are not UTF-8). Now both refuse each of
 * them, in the same words and for the same reason, and the key file written by the product, or
 * the same key with Windows line ends and a note after its armour, is still a key.
 */

import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded } from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';
import { generateKeyPair, publicKeyToPem } from './keys.js';
import { keysDir } from './layout.js';
import { HOLDS_NO_KEY } from './verify.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));

interface Finding {
  readonly level: string;
  readonly section: string;
  readonly what: string;
  readonly where: string;
}

/** The second reader's verdict. It has to give one: a traceback is no verdict. */
function secondReading(record: string): { verdict: string; findings: readonly Finding[] } {
  const run = spawnSync('python3', [VERIFIER, '--json', 'record', record], { encoding: 'utf-8' });
  if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
  if (run.stdout === '') throw new Error(`the second reader gave no verdict: ${run.stderr}`);
  return JSON.parse(run.stdout) as { verdict: string; findings: readonly Finding[] };
}

let sandbox: string;
let root: string;
let keys: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-key-file-without-a-key-'));
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
  keys = keysDir({ root });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const NAME = 'c'.repeat(64);

/** Each file that holds no key, and the reason both readers give. */
const CASES = [
  {
    file: 'README.pub',
    why: 'no PEM public key in it',
    write: () => writeFileSync(join(keys, 'README.pub'), 'The public keys of this record.\n'),
  },
  {
    file: `${NAME}.pub`,
    why: 'it is not a file',
    write: () => mkdirSync(join(keys, `${NAME}.pub`)),
  },
  {
    file: `${NAME}.pub`,
    why: 'not UTF-8 at byte 114',
    write: () => {
      const pem = Buffer.from(publicKeyToPem(generateKeyPair().publicKey));
      expect(pem.length).toBe(113);
      writeFileSync(join(keys, `${NAME}.pub`), Buffer.concat([pem, Buffer.from([0x61, 0xff])]));
    },
  },
  {
    file: `${NAME}.pub`,
    why: 'the PEM body is not base64',
    write: () =>
      writeFileSync(
        join(keys, `${NAME}.pub`),
        '-----BEGIN PUBLIC KEY-----\nnot base64!\n-----END PUBLIC KEY-----\n',
      ),
  },
  {
    file: `${NAME}.pub`,
    why: 'not an Ed25519 SubjectPublicKeyInfo',
    write: () => {
      const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      writeFileSync(
        join(keys, `${NAME}.pub`),
        publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      );
    },
  },
] as const;

describe.each(CASES)('a key file that holds no key: $why', ({ file, why, write }) => {
  it('is refused by the product by name, and not said as a key with no tail', () => {
    write();
    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.level).toBe('broken');
    expect(result.issues).toEqual([
      {
        layer: 'T2/T4',
        detail: `KEY FILE WITHOUT A KEY: the key file keys/${file} ${HOLDS_NO_KEY}: ${why}`,
      },
    ]);
    expect(result.census.filter((note) => note.kind === 'key-without-tail')).toEqual([]);
  });

  it('is refused by the second reader in the same words, and it gives a verdict', () => {
    write();
    const there = secondReading(root);
    expect(there.verdict).toBe('REFUSED');
    expect(there.findings.filter((f) => f.level === 'FAIL')).toEqual([
      expect.objectContaining({
        section: '6',
        what: `the key file keys/${file} ${HOLDS_NO_KEY}: ${why}`,
        where: `keys/${file}`,
      }),
    ]);
  });
});

describe('a key file that holds a key', () => {
  it('verifies in both readers with Windows line ends and a note after its armour', () => {
    const key = generateKeyPair();
    const pem = publicKeyToPem(key.publicKey).replaceAll('\n', '\r\n');
    writeFileSync(join(keys, `${key.fingerprint}.pub`), `${pem}a note after the key\n`);
    expect(readFileSync(join(keys, `${key.fingerprint}.pub`), 'utf-8')).toContain('\r\n');

    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(
      result.census.filter((note) => note.kind === 'key-without-tail').map((n) => n.fingerprint),
    ).toEqual([key.fingerprint]);
    expect(secondReading(root).verdict).toBe('VERIFIED');
  });
});
