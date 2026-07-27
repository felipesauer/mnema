/**
 * The handshake: the line a joining machine produces, and what reading it back
 * must never accept.
 *
 * The request is data that crosses machines through a chat window, a ticket, or an
 * email, so the two properties worth pinning are that a healthy one survives the
 * trip (including being wrapped across lines), and that a damaged or hand-edited
 * one is refused as a whole rather than half-read. A fingerprint is never carried,
 * only derived, so there is no way for the text to name a key it does not hold.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveAnchor,
  enrollmentMessage,
  generateKeyPair,
  listPrivateKeyFingerprints,
  publicKeyToPem,
  verifySignature,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeKeyRequest, encodeKeyRequest, requestEnrollment } from './handshake.js';

let keyRoot: string;
let vault: string;
let scratch: string[] = [];

const ANCHOR = deriveAnchor('a'.repeat(64));

beforeEach(() => {
  scratch = [];
  keyRoot = tmp('mnema-handshake-keyroot-');
  vault = tmp('mnema-handshake-vault-');
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

describe('the request text — a round trip, and what it refuses', () => {
  it('carries the public key and the signature, and derives the fingerprint on arrival', () => {
    const key = generateKeyPair();
    const line = encodeKeyRequest({ key, reverseSig: 'ab12' });

    // One line, prefixed and version-tagged, with no whitespace of its own — so it
    // survives a copy-paste that would mangle raw PEM newlines.
    expect(line.startsWith('mnema-key-request:1:')).toBe(true);
    expect(line).not.toMatch(/\s/);

    const read = decodeKeyRequest(line);
    expect(read?.reverseSig).toBe('ab12');
    // The fingerprint was NOT in the text: it is the hash of the key that was.
    expect(read?.key.fingerprint).toBe(key.fingerprint);
    expect(publicKeyToPem(read?.key.publicKey as never)).toBe(publicKeyToPem(key.publicKey));
  });

  it('survives being wrapped across lines by whatever it travelled through', () => {
    const key = generateKeyPair();
    const line = encodeKeyRequest({ key, reverseSig: 'cd34' });
    const wrapped = `${line.slice(0, 40)}\n  ${line.slice(40)}\n`;

    expect(decodeKeyRequest(wrapped)?.key.fingerprint).toBe(key.fingerprint);
  });

  it('refuses anything that is not a whole, undamaged request', () => {
    const key = generateKeyPair();
    const line = encodeKeyRequest({ key, reverseSig: 'ef56' });

    // Not a request at all; the prefix missing; the payload truncated or edited;
    // a payload that decodes to the wrong shape; a public key that is not one.
    expect(decodeKeyRequest('')).toBeNull();
    expect(decodeKeyRequest('mnema-key-request:1:')).toBeNull();
    expect(
      decodeKeyRequest(line.replace('mnema-key-request:1:', 'mnema-key-request:2:')),
    ).toBeNull();
    expect(decodeKeyRequest('mnema-key-request:1:zzzz')).toBeNull();
    expect(decodeKeyRequest(payload({ sig: 'ab' }))).toBeNull();
    expect(decodeKeyRequest(payload({ pub: publicKeyToPem(key.publicKey) }))).toBeNull();
    expect(decodeKeyRequest(payload({ pub: publicKeyToPem(key.publicKey), sig: '' }))).toBeNull();
    expect(decodeKeyRequest(payload({ pub: 'not a key', sig: 'ab' }))).toBeNull();
    // A half-read request is worse than a refused one: it would become an event.
    expect(
      decodeKeyRequest(`mnema-key-request:1:${Buffer.from('[]').toString('base64url')}`),
    ).toBeNull();
  });
});

/** A request line whose payload is exactly the given object — for the refusals. */
function payload(body: Record<string, unknown>): string {
  return `mnema-key-request:1:${Buffer.from(JSON.stringify(body), 'utf-8').toString('base64url')}`;
}

describe('requestEnrollment — what a joining machine produces', () => {
  it("mints this machine's key on first use, and the signature proves consent", () => {
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([]);

    const made = requestEnrollment({ anchor: ANCHOR, keyRoot });
    expect(made).toMatchObject({ ok: true, source: 'machine', minted: true, anchor: ANCHOR });

    const request = decodeKeyRequest((made as { request: string }).request);
    const fingerprint = (made as { fingerprint: string }).fingerprint;
    expect(request?.key.fingerprint).toBe(fingerprint);
    // The signature is over `enroll:<anchor>:<fp>` and verifies against the very
    // key the request carries — the part only this machine could have produced.
    expect(
      verifySignature(
        enrollmentMessage(ANCHOR, fingerprint),
        Buffer.from(request?.reverseSig as string, 'hex'),
        request?.key.publicKey as never,
      ),
    ).toBe(true);

    // The key was minted and kept; a second call speaks for the same key.
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([fingerprint]);
    expect(requestEnrollment({ anchor: ANCHOR, keyRoot })).toMatchObject({
      fingerprint,
      minted: false,
    });
  });

  it('records NO anchor — asking is not being accepted', () => {
    const made = requestEnrollment({ anchor: ANCHOR, keyRoot });
    const fingerprint = (made as { fingerprint: string }).fingerprint;

    // A machine that recorded the anchor it merely asked for would start signing as
    // an identity no member has vouched for, and every such event would fail
    // verification. Membership is granted by the record, never by asking.
    expect(() => readFileSync(join(keyRoot, 'keys', `${fingerprint}.anchor`), 'utf-8')).toThrow();
  });

  it('speaks for a key read from a FILE without installing it', () => {
    // The way out of a machine whose key root holds the wrong key: ask on behalf of
    // the cold copy. Installing it would leave two private keys at the key root, and
    // which one the machine signs as would depend on directory order.
    const own = requestEnrollment({ anchor: ANCHOR, keyRoot });
    const cold = generateKeyPair();
    const coldFile = join(vault, 'backup.key');
    const coldPem = cold.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    writeFileSync(coldFile, coldPem, { mode: 0o600 });

    const made = requestEnrollment({ anchor: ANCHOR, keyRoot, privateKeyPath: coldFile });

    expect(made).toMatchObject({ ok: true, source: 'file', minted: false });
    expect((made as { fingerprint: string }).fingerprint).toBe(cold.fingerprint);
    // The key root is untouched: still exactly the machine's own key.
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([
      (own as { fingerprint: string }).fingerprint,
    ]);
    expect(readFileSync(coldFile, 'utf-8')).toBe(coldPem);
  });

  it('refuses INVALID_ANCHOR rather than making a request nobody could use', () => {
    for (const anchor of ['', 'nonsense', 'mnid:', 'mnid:abc', `mnid:${'z'.repeat(64)}`]) {
      expect(requestEnrollment({ anchor, keyRoot })).toMatchObject({
        ok: false,
        code: 'INVALID_ANCHOR',
      });
    }
    // And it refuses BEFORE minting: a rejected ask leaves no key behind.
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([]);
  });

  it('refuses UNREADABLE_KEY for a file that is not a private key, or is absent', () => {
    const junk = join(vault, 'not-a-key.txt');
    writeFileSync(junk, 'BEGIN NOTHING\n');

    expect(requestEnrollment({ anchor: ANCHOR, keyRoot, privateKeyPath: junk })).toMatchObject({
      ok: false,
      code: 'UNREADABLE_KEY',
    });
    expect(
      requestEnrollment({ anchor: ANCHOR, keyRoot, privateKeyPath: join(vault, 'absent.key') }),
    ).toMatchObject({ ok: false, code: 'UNREADABLE_KEY' });
    expect(listPrivateKeyFingerprints({ root: keyRoot })).toEqual([]);
  });
});
