/**
 * Sigstore, end to end and without the network: `sigstore/sign.ts` against a Fulcio and a Rekor
 * that are Sigstore's own test doubles (`@sigstore/mock`), `sigstore/read.ts` judging the bundle
 * with Sigstore's own verifier against a trust root built from the doubles' keys, and the act
 * (`runWitnessSigstore`), the claim (`runKeySigstore`) and the reading (`readSigstoreReceipts`)
 * over a real record.
 *
 * THE PROPERTY THE ACT PROMISES IS WHAT LEAVES, so the bodies of the POSTs are asserted whole:
 * every field, with the two signatures checked as signatures (ECDSA is not deterministic) and
 * then set aside, and the checkpoint's message searched for in every spelling it could travel in.
 */

import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  verify as verifySignature,
  X509Certificate,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  accountLinked,
  checkpointHash,
  readTailCheckpoints,
  sealEntry,
  serializeEntry,
  witnessSigstorePath,
} from '@mnema/chain';
import type { DiscoveryEnv } from '@mnema/core';
import { fulcioHandler, initializeCA, initializeCTLog } from '@sigstore/mock/dist/fulcio/index.js';
import { initializeTLog, rekorHandler } from '@sigstore/mock/dist/rekor/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../commands/init.js';
import { runKeySigstore } from '../commands/key-sigstore.js';
import { runMemory } from '../commands/memory.js';
import { runVerify } from '../commands/verify.js';
import { readSigstoreReceipts } from '../commands/verify-sigstore.js';
import { runWitnessSigstore } from '../commands/witness.js';
import { type CliIo, run } from '../program.js';
import { readSigstoreBundle } from './read.js';
import {
  type Fetch,
  type HttpAnswer,
  identityOf,
  type KeyPair,
  signWithSigstore,
  tokenClaims,
} from './sign.js';
import { PUBLIC_GOOD_TRUSTED_ROOT } from './trusted-root.js';

const P256 = (): KeyPair => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const b64 = (bytes: ArrayBufferView | ArrayBuffer): string => {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Buffer.from(view).toString('base64');
};

const FULCIO = 'https://fulcio.sigstore.dev/api/v2/signingCert';
const REKOR = 'https://rekor.sigstore.dev/api/v1/log/entries';
const OAUTH_TOKEN = 'https://oauth2.sigstore.dev/auth/token';
const EMAIL = 'felipe@example.com';

/** An OpenID token with these claims — unsigned, which is all a double reads. */
function aToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.c2ln`;
}

const LOCAL_CLAIMS = { iss: 'https://oauth2.sigstore.dev/auth', email: EMAIL, sub: 'CgYxMjM0NTY' };

interface Asked {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** A Fulcio, a Rekor and a trust root that reaches them, all made here. */
async function aSigstore(subjectClaim = 'email') {
  const ctlog = await initializeCTLog(P256());
  const ca = await initializeCA(P256(), ctlog);
  const tlog = await initializeTLog('https://rekor.sigstore.dev', P256());
  const fulcio = fulcioHandler(ca, { subjectClaim });
  const rekor = rekorHandler(tlog);
  const asked: Asked[] = [];
  const answers = new Map<string, (body: string) => Promise<{ status: number; text: string }>>();
  const fetch: Fetch = async (url, init) => {
    asked.push({
      url,
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    const handler = url === FULCIO ? fulcio : url === REKOR ? rekor : undefined;
    if (handler !== undefined) {
      const answer = await handler.fn(init.body ?? '');
      const text =
        typeof answer.response === 'string'
          ? answer.response
          : Buffer.from(answer.response.buffer).toString('utf-8');
      return { status: answer.statusCode, text: async () => text };
    }
    const other = [...answers.entries()].find(([prefix]) => url.startsWith(prefix))?.[1];
    if (other === undefined) return { status: 404, text: async () => '' };
    const answer = await other(init.body ?? '');
    return { status: answer.status, text: async () => answer.text };
  };
  const validFor = { start: '2000-01-01T00:00:00.000Z' };
  const trustedRoot = {
    mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
    tlogs: [
      {
        baseUrl: 'https://rekor.sigstore.dev',
        hashAlgorithm: 'SHA2_256',
        publicKey: {
          rawBytes: b64(tlog.publicKey),
          keyDetails: 'PKIX_ECDSA_P256_SHA_256',
          validFor,
        },
        logId: { keyId: createHash('sha256').update(tlog.publicKey).digest('base64') },
      },
    ],
    certificateAuthorities: [
      {
        subject: { organization: 'test', commonName: 'test' },
        uri: 'https://fulcio.sigstore.dev',
        certChain: { certificates: [{ rawBytes: b64(ca.rootCertificate) }] },
        validFor,
      },
    ],
    ctlogs: [
      {
        baseUrl: 'https://ctfe.sigstore.dev/test',
        hashAlgorithm: 'SHA2_256',
        publicKey: {
          rawBytes: b64(ctlog.publicKey),
          keyDetails: 'PKIX_ECDSA_P256_SHA_256',
          validFor,
        },
        logId: { keyId: b64(ctlog.logID) },
      },
    ],
    timestampAuthorities: [],
  };
  return { fetch, asked, trustedRoot, answers };
}

/** A checkpoint's signed message, as `checkpoints.jsonl` would give it. */
const MESSAGE = Buffer.from(
  '{"contentRoot":"aa","fromSeq":0,"prev":null,"scheme":"mnema-checkpoint/1","signerFp":"bb","tail":"bb-cc","toSeq":3}',
);
const DIGEST = createHash('sha256').update(MESSAGE).digest('hex');

/** The certificate a Rekor body names, read back from its base64 PEM. */
const certificateIn = (content: string): X509Certificate =>
  new X509Certificate(Buffer.from(content, 'base64').toString('utf-8'));

describe('what leaves the machine', () => {
  it('sends Fulcio the token, the key and its proof, and Rekor the digest — never the message', async () => {
    const sigstore = await aSigstore();
    const key = P256();
    const token = aToken(LOCAL_CLAIMS);
    const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
      fetch: sigstore.fetch,
      generateKey: () => key,
      token: async () => token,
    });
    expect(signed.ok).toBe(true);

    expect(sigstore.asked.map((a) => `${a.method} ${a.url}`)).toEqual([
      `POST ${FULCIO}`,
      `POST ${REKOR}`,
    ]);
    const [toFulcio, toRekor] = sigstore.asked.map((a) => JSON.parse(a.body ?? '') as unknown) as [
      { publicKeyRequest: { proofOfPossession: string } },
      { spec: { signature: { content: string; publicKey: { content: string } } } },
    ];

    // The proof of possession is a signature over the e-mail the token carries, by this key.
    const proof = Buffer.from(toFulcio.publicKeyRequest.proofOfPossession, 'base64');
    expect(verifySignature('sha256', Buffer.from(EMAIL), key.publicKey, proof)).toBe(true);
    toFulcio.publicKeyRequest.proofOfPossession = '<proof>';
    expect(toFulcio).toEqual({
      credentials: { oidcIdentityToken: token },
      publicKeyRequest: {
        publicKey: {
          algorithm: 'ECDSA',
          content: key.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        },
        proofOfPossession: '<proof>',
      },
    });

    // The signature is over the message, by the key the certificate Fulcio issued names.
    const certificate = certificateIn(toRekor.spec.signature.publicKey.content);
    expect(certificate.publicKey.equals(key.publicKey as KeyObject)).toBe(true);
    const signature = Buffer.from(toRekor.spec.signature.content, 'base64');
    expect(verifySignature('sha256', MESSAGE, key.publicKey, signature)).toBe(true);
    toRekor.spec.signature = { content: '<signature>', publicKey: { content: '<certificate>' } };
    expect(toRekor).toEqual({
      apiVersion: '0.0.1',
      kind: 'hashedrekord',
      spec: {
        data: { hash: { algorithm: 'sha256', value: DIGEST } },
        signature: { content: '<signature>', publicKey: { content: '<certificate>' } },
      },
    });

    // And the message is in no body, in any spelling it could travel in.
    for (const ask of sigstore.asked) {
      for (const spelling of [
        MESSAGE.toString('utf-8'),
        MESSAGE.toString('base64'),
        MESSAGE.toString('hex'),
        '"contentRoot"',
      ]) {
        expect(ask.body ?? '', ask.url).not.toContain(spelling);
      }
    }
  });

  it('refuses a token from a private repository before anything is sent', async () => {
    const sigstore = await aSigstore();
    const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
      fetch: sigstore.fetch,
      token: async () =>
        aToken({
          iss: 'https://token.actions.githubusercontent.com',
          sub: 'repo:o/r:ref:refs/heads/main',
          repository_visibility: 'private',
        }),
    });
    expect(signed).toMatchObject({ ok: false, code: 'PRIVATE_REPOSITORY' });
    expect(signed.ok ? '' : signed.message).toMatch(/public log that does not forget/);
    expect(sigstore.asked).toEqual([]);
  });

  it("asks the Actions runner for the job's own token, for audience sigstore", async () => {
    const sigstore = await aSigstore('sub');
    const workflow = 'https://github.com/o/r/.github/workflows/witness.yml@refs/heads/main';
    sigstore.answers.set('https://runner.example/token', async () => ({
      status: 200,
      text: JSON.stringify({
        value: aToken({
          iss: 'https://token.actions.githubusercontent.com',
          sub: workflow,
          repository_visibility: 'public',
        }),
      }),
    }));
    const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
      fetch: sigstore.fetch,
      env: {
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://runner.example/token?api-version=2.0',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-secret',
      },
    });
    expect(signed).toMatchObject({ ok: true, identity: workflow });
    const first = sigstore.asked[0] as Asked;
    expect(first.method).toBe('GET');
    expect(new URL(first.url).searchParams.get('audience')).toBe('sigstore');
    expect(first.headers.Authorization).toBe('bearer runner-secret');
  });

  it('says what an Actions job without `id-token: write` lacks, and sends nothing', async () => {
    const sigstore = await aSigstore();
    const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
      fetch: sigstore.fetch,
      env: { GITHUB_ACTIONS: 'true' },
    });
    expect(signed).toMatchObject({ ok: false, code: 'NO_TOKEN' });
    expect(signed.ok ? '' : signed.message).toMatch(/id-token: write/);
    expect(sigstore.asked).toEqual([]);
  });

  it('signs in through the browser with PKCE, and takes only the code its own state brought', async () => {
    const sigstore = await aSigstore();
    let nonce = '';
    let verifierSent = '';
    sigstore.answers.set(OAUTH_TOKEN, async (body) => {
      const form = new URLSearchParams(body);
      verifierSent = form.get('code_verifier') ?? '';
      expect(form.get('code')).toBe('the-code');
      return {
        status: 200,
        text: JSON.stringify({ id_token: aToken({ ...LOCAL_CLAIMS, nonce }) }),
      };
    });
    let challenge = '';
    const said: string[] = [];
    const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
      fetch: sigstore.fetch,
      env: {},
      say: (line) => said.push(line),
      openBrowser: (url) => {
        const ask = new URL(url);
        expect(ask.origin + ask.pathname).toBe('https://oauth2.sigstore.dev/auth/auth');
        nonce = ask.searchParams.get('nonce') ?? '';
        challenge = ask.searchParams.get('code_challenge') ?? '';
        const back = new URL(ask.searchParams.get('redirect_uri') ?? '');
        // A stray callback with another state is turned away; the real one is taken.
        void globalThis
          .fetch(`${back.toString()}?code=forged&state=other`)
          .then(() =>
            globalThis.fetch(
              `${back.toString()}?code=the-code&state=${ask.searchParams.get('state') ?? ''}`,
            ),
          );
      },
    });
    expect(signed).toMatchObject({ ok: true, identity: EMAIL });
    expect(said[0]).toMatch(
      /^Sign in to Sigstore at: https:\/\/oauth2\.sigstore\.dev\/auth\/auth\?/,
    );
    expect(createHash('sha256').update(verifierSent).digest('base64url')).toBe(challenge);
  });
});

/** An answer as `fetch` gives it. */
const reply = (status: number, text: string): HttpAnswer => ({ status, text: async () => text });

/**
 * The double with the answer to one address replaced: `answer` gets the body sent and a way to
 * ask the double itself, and says what comes back instead.
 */
function replacing(
  fetch: Fetch,
  url: string,
  answer: (body: string, real: () => Promise<HttpAnswer>) => Promise<HttpAnswer>,
): Fetch {
  return async (at, init) =>
    at === url ? answer(init.body ?? '', () => fetch(at, init)) : fetch(at, init);
}

/** The digest and message of a checkpoint whose message ends on `toSeq`. */
function aCheckpoint(toSeq: number): { digest: string; message: Buffer } {
  const message = Buffer.from(MESSAGE.toString('utf-8').replace('"toSeq":3', `"toSeq":${toSeq}`));
  return { digest: createHash('sha256').update(message).digest('hex'), message };
}

describe('when Sigstore answers badly, or not at all', () => {
  it('says why Fulcio issued no certificate, and sends Rekor nothing', async () => {
    const cases: readonly [
      string,
      (real: () => Promise<HttpAnswer>) => Promise<HttpAnswer>,
      RegExp,
    ][] = [
      ['a refusal', async () => reply(500, 'no'), /^fulcio\.sigstore\.dev answered 500$/],
      [
        'a network that failed',
        async () => {
          throw new Error('getaddrinfo ENOTFOUND fulcio.sigstore.dev');
        },
        /^getaddrinfo ENOTFOUND fulcio\.sigstore\.dev$/,
      ],
      [
        'a failure that is not an Error',
        async () => {
          throw 'socket hang up';
        },
        /^socket hang up$/,
      ],
      ['an answer that is not JSON', async () => reply(200, '<html>'), /JSON/],
      [
        'a chain without its timestamp',
        async () => reply(201, '{"signedCertificateChain":{"certificates":["x"]}}'),
        /without a certificate that carries its own timestamp/,
      ],
      [
        'a chain whose leaf is not a certificate',
        async () => reply(201, '{"signedCertificateEmbeddedSct":{"chain":{"certificates":[42]}}}'),
        /without a certificate that carries its own timestamp/,
      ],
    ];
    for (const [what, answer, said] of cases) {
      const sigstore = await aSigstore();
      const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
        fetch: replacing(sigstore.fetch, FULCIO, (_, real) => answer(real)),
        token: async () => aToken(LOCAL_CLAIMS),
      });
      expect(signed, what).toMatchObject({ ok: false, code: 'NO_CERTIFICATE' });
      expect(signed.ok ? '' : signed.message, what).toMatch(said);
      expect(
        sigstore.asked.filter((a) => a.url === REKOR),
        what,
      ).toEqual([]);
    }
  });

  it('names each checkpoint Rekor would not log, and still signs the others', async () => {
    const sigstore = await aSigstore();
    let call = 0;
    const fetch = replacing(sigstore.fetch, REKOR, async (_, real) => {
      call += 1;
      if (call === 1) return reply(500, 'no');
      if (call === 2) return reply(201, 'null');
      const answer = JSON.parse(await (await real()).text()) as Record<
        string,
        { verification: { signedEntryTimestamp?: string; inclusionProof: Record<string, unknown> } }
      >;
      const entry = Object.values(answer)[0];
      if (entry === undefined) throw new Error('setup: Rekor logged nothing');
      if (call === 3) {
        delete (entry.verification as { inclusionProof?: unknown }).inclusionProof;
      } else {
        delete entry.verification.signedEntryTimestamp;
        delete entry.verification.inclusionProof.hashes;
      }
      return reply(201, JSON.stringify(answer));
    });
    const four = [aCheckpoint(3), aCheckpoint(4), aCheckpoint(5), aCheckpoint(6)];
    const signed = await signWithSigstore(four, {
      fetch,
      token: async () => aToken(LOCAL_CLAIMS),
    });
    if (!signed.ok) throw new Error(`expected a signing, got ${signed.message}`);
    expect(signed.identity).toBe(EMAIL);
    expect(signed.checkpoints.map((c) => [c.digest, c.ok ? 'signed' : c.why])).toEqual([
      [four[0]?.digest, 'rekor.sigstore.dev answered 500'],
      [four[1]?.digest, 'Rekor answered without an entry and its proof of inclusion'],
      [four[2]?.digest, 'Rekor answered without an entry and its proof of inclusion'],
      [four[3]?.digest, 'signed'],
    ]);
    // An entry without the promise or the hashes is filed as Rekor gave it: no promise, no hash.
    const last = signed.checkpoints[3];
    const entry = (last?.ok ? last.bundle.verificationMaterial.tlogEntries[0] : undefined) as {
      inclusionPromise?: unknown;
      inclusionProof: { hashes: unknown[] };
    };
    expect(entry.inclusionPromise).toBeUndefined();
    expect(entry.inclusionProof.hashes).toEqual([]);
  });

  it('proves the key over the e-mail for the issuers that vouch for one, the subject for any other', async () => {
    const google = { iss: 'https://accounts.google.com', email: 'g@example.com', sub: '1' };
    const other = { iss: 'https://gitlab.example', sub: 'project_path:o/r' };
    for (const [claims, challenge] of [
      [google, 'g@example.com'],
      [other, 'project_path:o/r'],
      [{ iss: 'https://gitlab.example' }, ''],
      [{ sub: 'no-issuer' }, 'no-issuer'],
    ] as const) {
      const sigstore = await aSigstore();
      const key = P256();
      let sent = '';
      await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
        fetch: replacing(sigstore.fetch, FULCIO, async (body) => {
          sent = body;
          return reply(500, 'no');
        }),
        generateKey: () => key,
        token: async () => aToken(claims),
      });
      const proof = (JSON.parse(sent) as { publicKeyRequest: { proofOfPossession: string } })
        .publicKeyRequest.proofOfPossession;
      expect(
        verifySignature(
          'sha256',
          Buffer.from(challenge),
          key.publicKey,
          Buffer.from(proof, 'base64'),
        ),
        JSON.stringify(claims),
      ).toBe(true);
    }
  });

  it('reads a token’s claims without checking them, and an unreadable token as none', () => {
    expect(tokenClaims(aToken({ iss: 'x', n: 1 }))).toEqual({ iss: 'x', n: 1 });
    expect(tokenClaims('opaque')).toEqual({});
    expect(tokenClaims(`a.${Buffer.from('5').toString('base64url')}.c`)).toEqual({});
    expect(tokenClaims(`a.${Buffer.from('null').toString('base64url')}.c`)).toEqual({});
  });

  it('names a certificate with no e-mail and no URI as nobody', () => {
    const named = (subjectAltName: string | undefined) =>
      identityOf({ subjectAltName } as unknown as X509Certificate);
    expect(named(undefined)).toBe('');
    expect(named('DNS:example.com, IP Address:127.0.0.1')).toBe('');
    expect(named('DNS:example.com, URI:https://github.com/o/r')).toBe('https://github.com/o/r');
  });

  it('says why the Actions runner gave no token, and sends Sigstore nothing', async () => {
    const cases: readonly [string, string, HttpAnswer | undefined, RegExp][] = [
      ['an address that is not https', 'http://runner.example/token', undefined, /not https/],
      ['a refusal', 'https://runner.example/token', reply(403, ''), /answered 403/],
      ['no value', 'https://runner.example/token', reply(200, '{"value":7}'), /gave no token/],
    ];
    for (const [what, url, answer, said] of cases) {
      const sigstore = await aSigstore();
      if (answer !== undefined)
        sigstore.answers.set(url, async () => ({
          status: answer.status,
          text: await answer.text(),
        }));
      const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
        fetch: sigstore.fetch,
        env: { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'secret' },
      });
      expect(signed, what).toMatchObject({ ok: false, code: 'NO_TOKEN' });
      expect(signed.ok ? '' : signed.message, what).toMatch(said);
      expect(
        sigstore.asked.filter((a) => a.url === FULCIO || a.url === REKOR),
        what,
      ).toEqual([]);
    }
  });

  it('says a token that could not be had, even when what failed is not an Error', async () => {
    const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
      fetch: async () => reply(500, ''),
      token: () => Promise.reject('cancelled'),
    });
    expect(signed).toEqual({ ok: false, code: 'NO_TOKEN', message: 'cancelled' });
  });

  it('refuses a browser sign-in whose token is missing, refused or not the one it asked for', async () => {
    const cases: readonly [string, (nonce: string) => HttpAnswer, RegExp][] = [
      ['a refusal', () => reply(400, ''), /^oauth2\.sigstore\.dev answered 400$/],
      ['no token', () => reply(200, '{}'), /^oauth2\.sigstore\.dev gave no token$/],
      [
        'the token of another sign-in',
        (nonce) =>
          reply(200, JSON.stringify({ id_token: aToken({ ...LOCAL_CLAIMS, nonce: `${nonce}x` }) })),
        /not the one this sign-in asked for/,
      ],
    ];
    for (const [what, answer, said] of cases) {
      const sigstore = await aSigstore();
      let nonce = '';
      sigstore.answers.set(OAUTH_TOKEN, async () => {
        const given = answer(nonce);
        return { status: given.status, text: await given.text() };
      });
      let elsewhere = 0;
      const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
        fetch: sigstore.fetch,
        env: {},
        openBrowser: (url) => {
          const ask = new URL(url);
          nonce = ask.searchParams.get('nonce') ?? '';
          const back = new URL(ask.searchParams.get('redirect_uri') ?? '');
          // Any other path on the loopback is not the callback, and is answered 404.
          void globalThis
            .fetch(`${back.origin}/favicon.ico`)
            .then((r) => {
              elsewhere = r.status;
            })
            .then(() =>
              globalThis.fetch(
                `${back.toString()}?code=c&state=${ask.searchParams.get('state') ?? ''}`,
              ),
            );
        },
      });
      expect(signed, what).toMatchObject({ ok: false, code: 'NO_TOKEN' });
      expect(signed.ok ? '' : signed.message, what).toMatch(said);
      expect(elsewhere, what).toBe(404);
      expect(
        sigstore.asked.filter((a) => a.url === FULCIO),
        what,
      ).toEqual([]);
    }
  });
});

describe('reading a bundle, offline', () => {
  async function aBundle() {
    const sigstore = await aSigstore();
    const signed = await signWithSigstore([{ digest: DIGEST, message: MESSAGE }], {
      fetch: sigstore.fetch,
      token: async () => aToken(LOCAL_CLAIMS),
    });
    if (!signed.ok || !signed.checkpoints[0]?.ok) throw new Error('setup: not signed');
    return { text: JSON.stringify(signed.checkpoints[0].bundle), root: sigstore.trustedRoot };
  }

  it('reads who signed and when Rekor logged it, by Sigstore’s own checks', async () => {
    const { text, root } = await aBundle();
    const reading = readSigstoreBundle(text, { digest: DIGEST, message: MESSAGE }, root);
    expect(reading).toMatchObject({
      kind: 'signed',
      identity: EMAIL,
      issuer: 'https://oauth2.sigstore.dev/auth',
    });
  });

  it('refuses the bundle over any other message, recomputed rather than taken from it', async () => {
    const { text, root } = await aBundle();
    const other = Buffer.from(MESSAGE.toString('utf-8').replace('"toSeq":3', '"toSeq":4'));
    expect(readSigstoreBundle(text, { digest: DIGEST, message: other }, root)).toMatchObject({
      kind: 'not-covered',
    });
    const otherDigest = createHash('sha256').update(other).digest('hex');
    expect(readSigstoreBundle(text, { digest: otherDigest, message: other }, root)).toMatchObject({
      kind: 'not-covered',
      why: /another digest/,
    });
  });

  it('refuses a bundle that signs an envelope, or names no digest, before any check', async () => {
    const { text, root } = await aBundle();
    const bundle = JSON.parse(text) as Record<string, unknown>;
    const { messageSignature, ...rest } = bundle as { messageSignature: { signature: string } };
    const envelope = {
      ...rest,
      dsseEnvelope: {
        payload: MESSAGE.toString('base64'),
        payloadType: 'application/vnd.in-toto+json',
        signatures: [{ sig: messageSignature.signature, keyid: '' }],
      },
    };
    expect(
      readSigstoreBundle(JSON.stringify(envelope), { digest: DIGEST, message: MESSAGE }, root),
    ).toEqual({ kind: 'not-covered', why: 'the bundle signs an envelope, not a checkpoint' });
    // A message signature with no digest is no v0.3 bundle: the parser refuses it first.
    const noDigest = { ...rest, messageSignature: { signature: messageSignature.signature } };
    expect(
      readSigstoreBundle(JSON.stringify(noDigest), { digest: DIGEST, message: MESSAGE }, root),
    ).toEqual({ kind: 'not-covered', why: 'not a Sigstore bundle: invalid bundle' });
  });

  it('carries the public instance’s root: Fulcio and Rekor at sigstore.dev, nothing else', () => {
    const root = PUBLIC_GOOD_TRUSTED_ROOT as {
      certificateAuthorities: { uri: string }[];
      tlogs: { baseUrl: string }[];
    };
    expect(new Set(root.certificateAuthorities.map((ca) => ca.uri))).toEqual(
      new Set(['https://fulcio.sigstore.dev']),
    );
    expect(root.tlogs.map((log) => new URL(log.baseUrl).hostname)).toEqual([
      'rekor.sigstore.dev',
      'log2025-1.rekor.sigstore.dev',
    ]);
  });

  it('reads a bundle the carried root does not reach as not covered, never as signed', async () => {
    const { text } = await aBundle();
    expect(readSigstoreBundle(text, { digest: DIGEST, message: MESSAGE })).toMatchObject({
      kind: 'not-covered',
    });
    expect(readSigstoreBundle('not json', { digest: DIGEST, message: MESSAGE })).toMatchObject({
      kind: 'not-covered',
      why: /not a Sigstore bundle/,
    });
  });
});

describe('the act, the claim and the reading, over a record', () => {
  let sandbox: string;
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-sigstore-'));
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function aProject(): { cwd: string; env: DiscoveryEnv; global: boolean } {
    const repo = join(sandbox, 'repo');
    mkdirSync(repo, { recursive: true });
    const here = { cwd: repo, env: { home: join(sandbox, 'home') } };
    runInit(here);
    runMemory(here, { content: 'a fact worth keeping' });
    return { ...here, global: false };
  }

  const verdict = (ctx: { cwd: string; env: DiscoveryEnv }) => {
    const done = runVerify({ ...ctx, requirement: 'witnessed', global: false });
    if (!done.ok) throw new Error('setup: no project');
    return done;
  };

  it('files the bundle under the head, names the identity, and moves no level', async () => {
    const ctx = aProject();
    const claimed = runKeySigstore(ctx, { identity: EMAIL });
    expect(claimed).toMatchObject({ ok: true, identity: EMAIL });
    expect(claimed.ok && claimed.recorded).toMatch(/^sha256:[0-9a-f]{64}$/);
    const before = verdict(ctx);

    const sigstore = await aSigstore();
    const act = await runWitnessSigstore(ctx, {
      fetch: sigstore.fetch,
      token: async () => aToken(LOCAL_CLAIMS),
    });
    if (!act.ok) throw new Error(act.message);
    expect(act.signer).toEqual({
      identity: EMAIL,
      issuer: 'https://oauth2.sigstore.dev/auth',
      named: true,
    });
    const signed = act.outcomes.filter((o) => o.did === 'signed');
    expect(signed).toHaveLength(1);

    const after = verdict(ctx);
    expect(after.record).toEqual(before.record);
    expect(after.requirementMet).toBe(false);

    const receipts = readSigstoreReceipts(after.trees, { trustedRoot: sigstore.trustedRoot });
    expect(receipts.findings).toHaveLength(1);
    const [finding] = receipts.findings;
    expect(finding?.reading).toMatchObject({ kind: 'signed', identity: EMAIL });
    expect(finding?.namedBy).toBe(claimed.ok ? claimed.anchor : '');

    // The file is the head's, under its digest; asking again sends nothing.
    const root = join(ctx.cwd, '.mnema');
    const tail = finding?.tail ?? '';
    const head = readTailCheckpoints({ root }, tail).at(-1);
    expect(finding?.checkpoint).toBe(head === undefined ? 'no head' : checkpointHash(head));
    expect(existsSync(witnessSigstorePath({ root }, tail, finding?.checkpoint ?? ''))).toBe(true);
    const asked = sigstore.asked.length;
    const again = await runWitnessSigstore(ctx, { fetch: sigstore.fetch, token: async () => '' });
    expect(again.ok && again.outcomes.every((o) => o.did === 'skipped')).toBe(true);
    expect(sigstore.asked.length).toBe(asked);
  });

  it('keeps the hash of the e-mail address in the record, and the address nowhere in it', () => {
    const ctx = aProject();
    const claimed = runKeySigstore(ctx, { identity: ` ${EMAIL.toUpperCase()} ` });
    if (!claimed.ok) throw new Error('setup: the claim was refused');
    // `printf '%s' felipe@example.com | sha256sum`, computed outside this code.
    const HASHED = 'sha256:12d216f5096c445e7248035ac7d85e586c647ce185aca31774ab10088f7ae51f';
    expect(claimed.recorded).toBe(HASHED);

    const root = join(ctx.cwd, '.mnema');
    const files = (readdirSync(root, { recursive: true }) as string[])
      .map((name) => join(root, name))
      .filter((path) => statSync(path).isFile());
    const lines = files
      .filter((path) => path.endsWith('.jsonl'))
      .flatMap((path) => readFileSync(path, 'utf-8').split('\n'))
      .filter((line) => line.includes('"account.linked"'));
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? '{}') as { event?: { payload?: unknown } };
    expect(line.event?.payload).toEqual({ service: 'sigstore', account: HASHED });
    // Every field of the event, and every byte the claim left in the tree.
    expect(lines[0]?.toLowerCase()).not.toContain(EMAIL);
    const holding = files.filter((path) =>
      readFileSync(path).toString('latin1').toLowerCase().includes(EMAIL),
    );
    expect(holding).toEqual([]);
  });

  it('keeps a workflow in the record as it is: a workflow is not a person', () => {
    const ctx = aProject();
    const workflow =
      'https://github.com/felipesauer/mnema/.github/workflows/witness.yml@refs/heads/main';
    const claimed = runKeySigstore(ctx, { identity: workflow });
    expect(claimed).toMatchObject({ ok: true, identity: workflow, recorded: workflow });
  });

  it('says a bundle no identity of the record names speaks for nobody', async () => {
    const ctx = aProject();
    const sigstore = await aSigstore();
    const act = await runWitnessSigstore(ctx, {
      fetch: sigstore.fetch,
      token: async () => aToken(LOCAL_CLAIMS),
    });
    expect(act.ok && act.signer?.named).toBe(false);
    const receipts = readSigstoreReceipts(verdict(ctx).trees, {
      trustedRoot: sigstore.trustedRoot,
    });
    expect(receipts.findings[0]?.reading.kind).toBe('signed');
    expect(receipts.findings[0]?.namedBy).toBeUndefined();
  });

  it('reads a bundle filed under a checkpoint the tail does not prove as not covered', async () => {
    const ctx = aProject();
    const root = join(ctx.cwd, '.mnema');
    const tail = verdict(ctx).trees.flatMap((t) =>
      t.kind === 'verdict' && t.result.ok ? t.result.tails.map((x) => x.tail) : [],
    )[0] as string;
    const stray = witnessSigstorePath({ root }, tail, 'f'.repeat(64));
    mkdirSync(join(stray, '..'), { recursive: true });
    writeFileSync(stray, '{}');
    const receipts = readSigstoreReceipts(verdict(ctx).trees);
    expect(receipts.findings).toEqual([
      {
        scope: 'public',
        tail,
        checkpoint: 'f'.repeat(64),
        reading: {
          kind: 'not-covered',
          why: 'it is filed under a checkpoint this tail does not prove',
        },
      },
    ]);
    expect(readFileSync(stray, 'utf-8')).toBe('{}');
  });

  /** The tail of a project's public tree, and where its files are. */
  function theTail(ctx: { cwd: string }): { root: string; tail: string; dir: string } {
    const root = join(ctx.cwd, '.mnema');
    const tail = readdirSync(join(root, 'tails'))[0] as string;
    return { root, tail, dir: join(root, 'tails', tail) };
  }

  /** Appends one valid `account.linked` without a key after the last line of the tail in `dir`. */
  function appendKeyless(
    dir: string,
    payload: { service: string; account: string } = { service: 'github', account: 'hubot' },
  ): void {
    const segment = join(dir, readdirSync(dir).find((name) => /^\d+\.jsonl$/.test(name)) ?? '');
    const lines = readFileSync(segment, 'utf-8')
      .split('\n')
      .filter((line) => line !== '');
    const last = JSON.parse(lines.at(-1) ?? '{}') as {
      event: { at: string; who: string; signerFp: string };
      link: { tail: string; seq: number; hash: string };
    };
    const { at, who, signerFp } = last.event;
    const later = accountLinked({ at, who, signerFp, subject: who }, payload);
    const entry = sealEntry({
      event: later,
      tail: last.link.tail,
      seq: last.link.seq + 1,
      prev: last.link.hash,
    });
    writeFileSync(segment, `${lines.join('\n')}\n${serializeEntry(entry)}\n`);
  }

  it('reads only the bundles beside a checkpoint, and only the claims a checkpoint covers', async () => {
    const ctx = aProject();
    const sigstore = await aSigstore();
    const act = await runWitnessSigstore(ctx, {
      fetch: sigstore.fetch,
      token: async () => aToken(LOCAL_CLAIMS),
    });
    if (!act.ok) throw new Error(act.message);
    const { dir } = theTail(ctx);
    // Another witness's file in the same directory is not a bundle, and is not read as one.
    writeFileSync(join(dir, 'witness', `${'e'.repeat(64)}.ots`), 'not a bundle');
    // A claim of the signer's address appended after the last checkpoint, keylessly, is no claim
    // of the record: no checkpoint covers it, so the bundle still speaks for nobody.
    appendKeyless(dir, {
      service: 'sigstore',
      account: 'sha256:12d216f5096c445e7248035ac7d85e586c647ce185aca31774ab10088f7ae51f',
    });
    const receipts = readSigstoreReceipts(verdict(ctx).trees, {
      trustedRoot: sigstore.trustedRoot,
    });
    expect(receipts.findings.map((f) => [f.checkpoint.length, f.reading.kind])).toEqual([
      [64, 'signed'],
    ]);
    expect(receipts.findings[0]?.namedBy).toBeUndefined();
    expect(receipts.notRead).toEqual([]);
  });

  it('skips a tail with no checkpoint, and a tree that is not fully signed, and asks nobody', async () => {
    const unsigned = aProject();
    // One event more, appended without a key after the last checkpoint: the tree is honest and
    // no longer fully signed.
    appendKeyless(theTail(unsigned).dir);

    sandbox = join(sandbox, 'second');
    mkdirSync(sandbox);
    const unsealed = aProject();
    rmSync(join(theTail(unsealed).dir, 'checkpoints.jsonl'));

    const sigstore = await aSigstore();
    const network = { fetch: sigstore.fetch, token: async () => aToken(LOCAL_CLAIMS) };
    const first = await runWitnessSigstore(unsigned, network);
    expect(first.ok && first.outcomes.map((o) => [o.did, o.detail])).toEqual([
      [
        'skipped',
        expect.stringMatching(
          /^the tree is [a-z-]+, and a witness is only filed under a checkpoint the verifier proves/,
        ),
      ],
    ]);
    expect(first.ok && first.signer).toBeUndefined();
    const second = await runWitnessSigstore(unsealed, network);
    expect(second.ok && second.outcomes.map((o) => [o.did, o.detail])).toEqual([
      ['skipped', 'the tail has no checkpoint to witness'],
    ]);
    expect(sigstore.asked).toEqual([]);
    expect(existsSync(join(theTail(unsigned).dir, 'witness'))).toBe(false);
  });

  it('files no bundle for a checkpoint Rekor would not log, and says why', async () => {
    const ctx = aProject();
    const sigstore = await aSigstore();
    const act = await runWitnessSigstore(ctx, {
      fetch: replacing(sigstore.fetch, REKOR, async () => reply(503, 'busy')),
      token: async () => aToken(LOCAL_CLAIMS),
    });
    if (!act.ok) throw new Error(act.message);
    const { root, tail, dir } = theTail(ctx);
    const head = readTailCheckpoints({ root }, tail).at(-1);
    const digest = head === undefined ? 'no head' : checkpointHash(head);
    expect(act.outcomes.map((o) => [o.did, o.detail])).toEqual([
      ['failed', `checkpoint ${digest} was not logged: rekor.sigstore.dev answered 503`],
    ]);
    expect(act.signer?.identity).toBe(EMAIL);
    expect(existsSync(join(dir, 'witness'))).toBe(false);
  });

  it('answers with the refusal when Fulcio issues no certificate, and files nothing', async () => {
    const ctx = aProject();
    const sigstore = await aSigstore();
    const act = await runWitnessSigstore(ctx, {
      fetch: replacing(sigstore.fetch, FULCIO, async () => reply(401, 'no')),
      token: async () => aToken(LOCAL_CLAIMS),
    });
    expect(act).toEqual({
      ok: false,
      reason: 'NO_CERTIFICATE',
      message: 'fulcio.sigstore.dev answered 401',
    });
    expect(existsSync(join(theTail(ctx).dir, 'witness'))).toBe(false);
  });

  it('refuses a record with nothing in it, and a claim that is not an identity', () => {
    const repo = join(sandbox, 'empty');
    mkdirSync(repo, { recursive: true });
    const env = { home: join(sandbox, 'home') };
    expect(runKeySigstore({ cwd: repo, env }, { identity: EMAIL })).toEqual({
      ok: false,
      reason: 'NO_PROJECT',
    });
    const ctx = aProject();
    expect(runKeySigstore(ctx, { identity: 'felipesauer' })).toMatchObject({
      ok: false,
      code: 'NOT_A_SIGSTORE_IDENTITY',
    });
  });
});

/**
 * THE VERBS AS A PERSON TYPES THEM: `witness sigstore`, `key sigstore` and
 * `verify --against-sigstore` through the program, in GitHub Actions, where the token is the
 * job's own. Nothing reaches the network: the platform's `fetch` is the doubles of Fulcio and
 * Rekor and a runner that hands out a token, and nothing else answers.
 */
describe('the verbs, as typed', () => {
  const WORKFLOW = 'https://github.com/o/r/.github/workflows/witness.yml@refs/heads/main';
  const RUNNER = 'https://runner.example/token';
  const KEYS = [
    'HOME',
    'GITHUB_ACTIONS',
    'ACTIONS_ID_TOKEN_REQUEST_URL',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  ] as const;
  let sandbox: string;
  let repo: string;
  let cwd: string;
  let saved: Partial<Record<(typeof KEYS)[number], string>>;
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-sigstore-cli-'));
    repo = join(sandbox, 'repo');
    mkdirSync(repo);
    cwd = process.cwd();
    saved = {};
    for (const key of KEYS) {
      const value = process.env[key];
      if (value !== undefined) saved[key] = value;
      delete process.env[key];
    }
    process.env.HOME = join(sandbox, 'home');
    process.chdir(repo);
  });
  afterEach(() => {
    process.chdir(cwd);
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    rmSync(sandbox, { recursive: true, force: true });
  });

  async function typed(...argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    let failed = false;
    const io: CliIo = {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    };
    await run(argv, io);
    return { out: out.join('\n'), err: err.join('\n'), failed };
  }

  /** The doubles as the platform's `fetch`, with a runner that hands out the workflow's token. */
  async function inActions() {
    const sigstore = await aSigstore('sub');
    sigstore.answers.set(RUNNER, async () => ({
      status: 200,
      text: JSON.stringify({
        value: aToken({
          iss: 'https://token.actions.githubusercontent.com',
          sub: WORKFLOW,
          repository_visibility: 'public',
        }),
      }),
    }));
    vi.stubGlobal('fetch', (url: string, init: Parameters<Fetch>[1]) => sigstore.fetch(url, init));
    process.env.GITHUB_ACTIONS = 'true';
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = RUNNER;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'runner-secret';
    return sigstore;
  }

  it('countersigns, says who is now in the public log, and that nobody of the record names it', async () => {
    expect((await typed('init')).failed).toBe(false);
    const sigstore = await inActions();
    const act = await typed('witness', 'sigstore');
    expect(act.failed).toBe(false);
    const tail = readdirSync(join(repo, '.mnema', 'tails'))[0] as string;
    expect(act.out).toMatch(
      new RegExp(
        `^${tail} \\(public\\): signed — countersigned checkpoint [0-9a-f]{64} — Rekor entry \\d+$`,
        'm',
      ),
    );
    expect(act.out).toContain(
      `The certificate names ${WORKFLOW}, vouched for by https://token.actions.githubusercontent.com.`,
    );
    expect(act.out).toContain(`${WORKFLOW} is now in Sigstore's public log, which does not forget`);
    expect(act.out).toContain(`\`mnema key sigstore ${WORKFLOW}\` names it.`);
    expect(act.out).toContain('Commit the bundle with the record');

    // Asked again, the checkpoint is skipped, nobody is asked and no signer is spoken of.
    const asked = sigstore.asked.length;
    const again = await typed('witness', 'sigstore');
    expect(again.out).toMatch(/: skipped — checkpoint [0-9a-f]{64} is already countersigned$/m);
    expect(again.out).not.toContain('The certificate names');
    expect(sigstore.asked.length).toBe(asked);

    // A workflow is recorded as it is, so there is no hash to speak of.
    const claimed = await typed('key', 'sigstore', WORKFLOW);
    expect(claimed.out).toMatch(
      new RegExp(
        `^Linked mnid:[0-9a-f]+ to the Sigstore identity ${WORKFLOW.replace(/[.]/g, '\\.')}$`,
        'm',
      ),
    );
    expect(claimed.out).not.toContain('recorded as its hash');
    expect(claimed.out).not.toContain('The record keeps the SHA-256');

    // The binary reads against the public root it carries, which the doubles are not under.
    const read = await typed('verify', '--against-sigstore');
    expect(read.out).toMatch(
      new RegExp(
        `^ *sigstore: ${tail} checkpoint [0-9a-f]{12} — not covered: Sigstore's checks refused it: `,
        'm',
      ),
    );
    expect(read.out).toContain('it is no witness level');

    // As JSON, the same reading under `sigstore`; and never beside `--workspace`.
    const json = await typed('verify', '--against-sigstore', '--json');
    const parsed = JSON.parse(json.out) as {
      sigstore: { findings: { tail: string; reading: { kind: string } }[]; notRead: string[] };
    };
    expect(parsed.sigstore.findings.map((f) => [f.tail, f.reading.kind])).toEqual([
      [tail, 'not-covered'],
    ]);
    expect(parsed.sigstore.notRead).toEqual([]);
    const both = await typed('verify', '--against-sigstore', '--workspace', repo);
    expect(both.failed).toBe(true);
    expect(both.err).toContain(
      '`--against-sigstore` rules on the project you stand in, and `--workspace` names others',
    );
  });

  it('refuses in Actions without a token to ask for, and sends nothing', async () => {
    expect((await typed('init')).failed).toBe(false);
    const sigstore = await inActions();
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const act = await typed('witness', 'sigstore');
    expect(act.failed).toBe(true);
    expect(act.err).toContain('id-token: write');
    expect(sigstore.asked).toEqual([]);
    expect(existsSync(join(repo, '.mnema', 'tails'))).toBe(true);
  });

  it('says the record keeps the hash of an e-mail, and refuses outside a project', async () => {
    const outside = await typed('key', 'sigstore', EMAIL);
    expect(outside.failed).toBe(true);
    expect(outside.err).toContain('Run `mnema key sigstore` inside the project to record it.');
    expect((await typed('init')).failed).toBe(false);
    const claimed = await typed('key', 'sigstore', EMAIL);
    expect(claimed.out).toContain(
      'recorded as its hash sha256:12d216f5096c445e7248035ac7d85e586c647ce185aca31774ab10088f7ae51f',
    );
    expect(claimed.out).toContain('The record keeps the SHA-256 of the address, not the address');
  });

  it('says a tree it could not read was not read, rather than reading its bundles', async () => {
    expect((await typed('init')).failed).toBe(false);
    const tails = join(repo, '.mnema', 'tails');
    const tail = readdirSync(tails)[0] as string;
    const segment = join(tails, tail, '000001.jsonl');
    writeFileSync(
      segment,
      readFileSync(segment, 'utf-8').replace(/"at":"[^"]+"/, '"at":"1999-01-01T00:00:00.000Z"'),
    );
    const read = await typed('verify', '--against-sigstore');
    expect(read.failed).toBe(true);
    expect(read.out).toContain(
      'sigstore: the public tree was not read — its verdict is a break, so which checkpoint a bundle is over is not settled',
    );
  });
});
