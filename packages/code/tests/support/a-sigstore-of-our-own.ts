/**
 * A Sigstore of the test's own: a Fulcio, a Rekor and a CT log that are Sigstore's test doubles
 * (`@sigstore/mock`), reached by the product's own signer (`sigstore/sign.ts`) through a fetch
 * that never leaves the process, and the trust root that reaches them. No account, no OpenID
 * provider, no network: the token is unsigned, which is all a double reads.
 *
 * Every call makes new keys, so a bundle of one Sigstore is a bundle of an unknown root to
 * another — which is how a case gets a signature this binary's root does not reach.
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import { fulcioHandler, initializeCA, initializeCTLog } from '@sigstore/mock/dist/fulcio/index.js';
import { initializeTLog, rekorHandler } from '@sigstore/mock/dist/rekor/index.js';
import { type Fetch, type SigstoreBundle, signWithSigstore } from '../../src/sigstore/sign.js';

/** The identity a stack's author signs as, in a GitHub Actions workflow. */
export const AUTHOR_WORKFLOW =
  'https://github.com/example/hello-stack/.github/workflows/sign.yml@refs/heads/main';
export const ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';

const FULCIO = 'https://fulcio.sigstore.dev/api/v2/signingCert';
const REKOR = 'https://rekor.sigstore.dev/api/v1/log/entries';

const P256 = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const b64 = (bytes: ArrayBufferView | ArrayBuffer): string => {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Buffer.from(view).toString('base64');
};

/** An OpenID token with these claims, unsigned. */
function aToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.c2ln`;
}

export interface TestSigstore {
  /** The trust root that reaches this Sigstore's doubles, as `trusted_root.json` holds one. */
  readonly trustedRoot: unknown;
  /** A v0.3 bundle over `message`, whose SHA-256 is `digest`, signed as `identity`. */
  sign(message: Uint8Array, digest: string, identity?: string): Promise<SigstoreBundle>;
}

export async function aSigstoreOfOurOwn(): Promise<TestSigstore> {
  const ctlog = await initializeCTLog(P256());
  const ca = await initializeCA(P256(), ctlog);
  const tlog = await initializeTLog('https://rekor.sigstore.dev', P256());
  const fulcio = fulcioHandler(ca, { subjectClaim: 'sub' });
  const rekor = rekorHandler(tlog);
  const fetch: Fetch = async (url, init) => {
    const handler = url === FULCIO ? fulcio : url === REKOR ? rekor : undefined;
    if (handler === undefined) return { status: 404, text: async () => '' };
    const answer = await handler.fn(init.body ?? '');
    const text =
      typeof answer.response === 'string'
        ? answer.response
        : Buffer.from(answer.response.buffer).toString('utf8');
    return { status: answer.statusCode, text: async () => text };
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
  return {
    trustedRoot,
    async sign(message, digest, identity = AUTHOR_WORKFLOW) {
      const signed = await signWithSigstore([{ digest, message }], {
        fetch,
        token: async () =>
          aToken({ iss: ACTIONS_ISSUER, sub: identity, repository_visibility: 'public' }),
      });
      const first = signed.ok ? signed.checkpoints[0] : undefined;
      if (first === undefined || !first.ok) throw new Error('the test Sigstore did not sign');
      return first.bundle;
    },
  };
}
