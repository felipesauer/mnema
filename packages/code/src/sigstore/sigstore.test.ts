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
import { checkpointHash, readTailCheckpoints, witnessSigstorePath } from '@mnema/chain';
import type { DiscoveryEnv } from '@mnema/core';
import { fulcioHandler, initializeCA, initializeCTLog } from '@sigstore/mock/dist/fulcio/index.js';
import { initializeTLog, rekorHandler } from '@sigstore/mock/dist/rekor/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../commands/init.js';
import { runKeySigstore } from '../commands/key-sigstore.js';
import { runMemory } from '../commands/memory.js';
import { runVerify } from '../commands/verify.js';
import { readSigstoreReceipts } from '../commands/verify-sigstore.js';
import { runWitnessSigstore } from '../commands/witness.js';
import { readSigstoreBundle } from './read.js';
import { type Fetch, type KeyPair, signWithSigstore } from './sign.js';
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
