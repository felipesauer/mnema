/**
 * THE SIGNED MESSAGES, PUBLISHED (FORMAT.md, "The published vectors"; sections 6, 6.1 and 6.10).
 *
 * The 39 event vectors let an outside implementation check the bytes it hashes; these let it
 * check the bytes it SIGNS and verifies: a checkpoint and a tail proof under each scheme, each
 * with the stored line, the message the signature is over and its SHA-256 (what the next
 * checkpoint's `prev` holds), plus the record's name derived from a genesis tail. The key is RFC
 * 8032 section 7.1's first test key, whose secret is published, and Ed25519 is deterministic, so
 * the signatures are the same every time this runs.
 *
 * `canonical-vectors.json` declares them under `signedMessages`, and the test beside this file
 * builds them again from the code and requires the two to be equal: a change to a signed
 * message reddens the file instead of leaving it describing bytes nobody signs any more.
 */

import { createHash, createPrivateKey } from 'node:crypto';

import { canonicalStringify } from '../events/canonical.js';
import { canonicalVectors } from '../events/vectors.js';
import {
  type Checkpoint,
  checkpointHash,
  checkpointMessage,
  serializeCheckpoint,
  signCheckpoint,
} from './checkpoint.js';
import { writtenAsBuilt } from './hash.js';
import { keyPairFromPrivatePem, publicKeyToPem } from './keys.js';
import { RECORD_DOMAIN, recordName } from './record-name.js';
import { serializeTailProof, signTailProof, type TailProof } from './tailproof.js';

/** RFC 8032 section 7.1, TEST 1: a secret key the RFC publishes, so anyone can sign as it. */
export const VECTOR_SECRET = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';

/** The PKCS #8 prefix of an Ed25519 private key whose 32-byte seed follows (RFC 8410). */
const PKCS8_ED25519_PREFIX = '302e020100300506032b657004220420';

/** One signed artifact: its stored line as an object, the message signed and its SHA-256. */
export interface SignedMessageVector {
  readonly name: string;
  readonly scheme: string;
  readonly stored: Record<string, unknown>;
  readonly message: string;
  readonly sha256: string;
}

/** What `canonical-vectors.json` holds under `signedMessages`. */
export interface SignedMessageVectors {
  readonly key: {
    readonly secret: string;
    readonly publicKey: string;
    readonly fingerprint: string;
  };
  readonly record: { readonly domain: string; readonly genesisTail: string; readonly name: string };
  readonly vectors: readonly SignedMessageVector[];
}

function messageVector(name: string, artifact: Checkpoint | TailProof, line: string) {
  const stored = JSON.parse(line) as Record<string, unknown>;
  const { sig: _sig, ...signed } = stored;
  const message = canonicalStringify(signed as Parameters<typeof canonicalStringify>[0]);
  return {
    name,
    scheme: artifact.scheme,
    stored,
    message,
    sha256: createHash('sha256').update(message, 'utf-8').digest('hex'),
  };
}

/** The vectors, built from the code that signs and reads them. */
export function signedMessageVectors(): SignedMessageVectors {
  const privateKey = createPrivateKey({
    key: Buffer.from(PKCS8_ED25519_PREFIX + VECTOR_SECRET, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
  const keyPair = keyPairFromPrivatePem(
    privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  );
  const tail = `${keyPair.fingerprint}-${'ab'.repeat(16)}`;
  const record = recordName(tail);
  const [first, second] = canonicalVectors();
  if (first === undefined || second === undefined) throw new Error('the vectors are empty');
  const events = (from: number) => [writtenAsBuilt(from === 0 ? first.event : second.event)];

  const before = signCheckpoint({ tail, fromSeq: 0, events: events(0), prev: null, keyPair });
  const after = signCheckpoint({
    tail,
    fromSeq: 1,
    events: events(1),
    prev: checkpointHash(before),
    keyPair,
    record,
  });
  const born = signCheckpoint({ tail, fromSeq: 0, events: events(0), prev: null, keyPair, record });
  const proofBefore = signTailProof(tail, keyPair);
  const proofBorn = signTailProof(tail, keyPair, record);

  const vectors = [
    messageVector(
      'checkpoint, first scheme, the first of its tail',
      before,
      serializeCheckpoint(before),
    ),
    messageVector(
      'checkpoint, second scheme, after one of the first: prev is the hash of its message',
      after,
      serializeCheckpoint(after),
    ),
    messageVector(
      'checkpoint, second scheme, the first of its tail',
      born,
      serializeCheckpoint(born),
    ),
    messageVector('tail proof, first scheme', proofBefore, serializeTailProof(proofBefore)),
    messageVector('tail proof, second scheme', proofBorn, serializeTailProof(proofBorn)),
  ];
  // The message published is the one the code signs, and not a reconstruction of it.
  for (const [vector, checkpoint] of [
    [vectors[0], before],
    [vectors[1], after],
    [vectors[2], born],
  ] as const) {
    if (vector?.message !== Buffer.from(checkpointMessage(checkpoint)).toString('utf-8')) {
      throw new Error(`the message of ${vector?.name} is not the one signed`);
    }
  }
  return {
    key: {
      secret: VECTOR_SECRET,
      publicKey: publicKeyToPem(keyPair.publicKey),
      fingerprint: keyPair.fingerprint,
    },
    record: { domain: RECORD_DOMAIN, genesisTail: tail, name: record },
    vectors,
  };
}
