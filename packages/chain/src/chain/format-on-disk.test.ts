/**
 * The bytes on disk, as `FORMAT.md` describes them.
 *
 * WHY IT EXISTS. `FORMAT.md` states the format for a reader who did not write
 * this code, and every claim in it has to name the test that holds it. Two of its
 * claims had none: that re-serializing an entry read back from a line reproduces
 * that line, and that a checkpoint reader refuses a scheme it does not know.
 * `serializeEntry` was referred to by no test in the repository, `parseCheckpoint`
 * by none either, and `entry.ts` had no test file at all — both were exercised only
 * through the writer-and-verify round trips in `chain.test.ts`, which is why
 * coverage never said anything was missing. Coverage answers "was the line run",
 * and a format needs "is this property true".
 *
 * The cases here are the format's own properties, at the level of the stored
 * bytes, and nothing else: no writer, no verifier, no disk.
 */

import { describe, expect, it } from 'vitest';
import { taskCreated } from '../events/build.js';
import { canonicalStringify } from '../events/canonical.js';
import { catalogUpcasters } from '../events/registry.js';
import {
  CheckpointParseError,
  parseCheckpoint,
  SCHEME,
  serializeCheckpoint,
  signCheckpoint,
} from './checkpoint.js';
import { parseEntry, sealEntry, serializeEntry } from './entry.js';
import { writtenAsBuilt } from './hash.js';
import { generateKeyPair } from './keys.js';

const TAIL = 'ff'.repeat(32);
const upcasters = catalogUpcasters();

const anEvent = () =>
  taskCreated(
    {
      at: '2026-07-21T00:00:00.000Z',
      who: 'mnid:1111111111111111111111111111111111111111111111111111111111111111',
      signerFp: '2222222222222222222222222222222222222222222222222222222222222222',
      which: 'claude',
      subject: '019f81f8-e400-7003-8000-000000000003',
    },
    { title: 'Ship the parser' },
  );

describe('the stored line', () => {
  it('reproduces itself when an entry read back from it is re-serialized', () => {
    const line = serializeEntry(sealEntry({ event: anEvent(), tail: TAIL, seq: 0, prev: null }));
    // The claim is byte identity, not equality of the parsed objects: a reader that
    // re-serialized a LIFTED event would produce a different line the first time a
    // kind gains a v2, and the entry hash and the signature over it would stop
    // matching. Comparing strings is the only form of the claim that says that.
    expect(serializeEntry(parseEntry(line, upcasters))).toBe(line);
  });

  it('is canonical: two keys at the top, sorted, and the link’s four sorted too', () => {
    const line = serializeEntry(
      sealEntry({ event: anEvent(), tail: TAIL, seq: 1, prev: 'ab'.repeat(32) }),
    );
    const parsed = JSON.parse(line) as { event: unknown; link: unknown };
    expect(Object.keys(parsed)).toEqual(['event', 'link']);
    expect(Object.keys(parsed.link as object)).toEqual(['hash', 'prev', 'seq', 'tail']);
    // No insignificant whitespace: the canonical form is what the document shows.
    expect(line).not.toContain(', ');
    expect(line).not.toContain(': ');
  });

  it('frames a genesis link as a null prev, never as an empty string', () => {
    const line = serializeEntry(sealEntry({ event: anEvent(), tail: TAIL, seq: 0, prev: null }));
    expect(line).toContain('"prev":null');
    expect(parseEntry(line, upcasters).link.prev).toBeNull();
  });
});

describe('the stored checkpoint', () => {
  const keyPair = generateKeyPair();
  const signed = () =>
    signCheckpoint({
      tail: TAIL,
      fromSeq: 0,
      events: [writtenAsBuilt(anEvent())],
      prev: null,
      keyPair,
    });

  it('declares the scheme the code defines, and round-trips through its line', () => {
    const checkpoint = signed();
    expect(checkpoint.scheme).toBe(SCHEME);
    expect(parseCheckpoint(serializeCheckpoint(checkpoint))).toEqual(checkpoint);
  });

  it('refuses a scheme it does not know rather than guessing at the fields', () => {
    // The mutation this case IS: the same line, one character of the scheme moved.
    // A reader that shrugged at it would read a future format's fields under
    // today's meaning, which is the one thing a version tag exists to prevent.
    const line = serializeCheckpoint({ ...signed(), scheme: 'mnema-checkpoint/2' });
    expect(() => parseCheckpoint(line)).toThrow(CheckpointParseError);
    expect(() => parseCheckpoint(line)).toThrow(/unknown checkpoint scheme/);
  });

  it('signs everything but the signature, hex-encoded', () => {
    const checkpoint = signed();
    // Ed25519 signatures are 64 bytes: 128 hex digits, lower case.
    expect(checkpoint.sig).toMatch(/^[0-9a-f]{128}$/);
    // The signed message is the canonical bytes of the fields WITHOUT `sig` — which
    // the document shows as an object of seven keys. Signing over a value that
    // contained the signature would be impossible; showing the seven is what tells a
    // stranger which bytes to reconstruct.
    const { sig: _sig, ...fields } = checkpoint;
    expect(Object.keys(JSON.parse(canonicalStringify(fields)) as object)).toEqual([
      'contentRoot',
      'fromSeq',
      'prev',
      'scheme',
      'signerFp',
      'tail',
      'toSeq',
    ]);
  });
});
