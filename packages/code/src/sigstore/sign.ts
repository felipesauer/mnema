/**
 * Signing a checkpoint with Sigstore — the one part of `mnema witness sigstore` that speaks to
 * somebody else, written here rather than borrowed so that every byte that leaves goes through
 * one `fetch` a test can hand in.
 *
 * WHAT LEAVES, AND TO WHOM. Fulcio (`fulcio.sigstore.dev`) is handed an OpenID token, an
 * ephemeral public key and a signature over the token's subject, and answers with a short-lived
 * certificate naming the identity the token carries. Rekor (`rekor.sigstore.dev`) is handed the
 * SHA-256 of a checkpoint's signed message, a signature over that message, and the certificate.
 * The message itself never leaves: a clone recomputes it from `checkpoints.jsonl`. The identity
 * does leave, by design — the e-mail, or the repository and the workflow, goes into a public
 * log that does not forget. Locally the token comes from `oauth2.sigstore.dev` through the
 * browser; in GitHub Actions it is the job's own, asked for with audience `sigstore`.
 *
 * FIXED DESTINATIONS. Every address here is https at one of those hosts (or the token endpoint
 * the Actions runner names), and a redirect is an error: nothing here follows one anywhere.
 *
 * THE KEY DIES WITH THE PROCESS. It is generated per act, held in memory, and never written.
 *
 * A PRIVATE REPOSITORY IS REFUSED. A token whose claims say `repository_visibility: private`
 * would publish that repository's name, and its workflow's, in the log; the act stops before
 * Fulcio is asked.
 */

import { spawn } from 'node:child_process';
import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  sign,
  X509Certificate,
} from 'node:crypto';
import { createServer, type Server } from 'node:http';

/** The public Sigstore instance — the only one this product signs with. */
export const SIGSTORE = {
  fulcio: 'https://fulcio.sigstore.dev',
  rekor: 'https://rekor.sigstore.dev',
  oauth: 'https://oauth2.sigstore.dev/auth',
} as const;

/** How long one request to Sigstore is waited for. */
export const SIGSTORE_TIMEOUT_MS = 30_000;

/** How long the browser sign-in is waited for. */
export const SIGN_IN_TIMEOUT_MS = 300_000;

/** The part of a `fetch` response this module reads. */
export interface HttpAnswer {
  readonly status: number;
  text(): Promise<string>;
}

/** One request, as this module makes it. */
export interface HttpAsk {
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly redirect: 'error';
  readonly signal: AbortSignal;
}

/** How a request is made — `fetch`, handed in so no test goes to the network. */
export type Fetch = (url: string, init: HttpAsk) => Promise<HttpAnswer>;

/** An ephemeral key pair. */
export interface KeyPair {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

/** Everything that reaches outside this process, each one replaceable. */
export interface SigstoreNetwork {
  readonly fetch?: Fetch;
  /** The ephemeral key — ECDSA P-256 by default. */
  readonly generateKey?: () => KeyPair;
  /** The OpenID token; by default the Actions runner's, else a browser sign-in. */
  readonly token?: () => Promise<string>;
  /** The environment the Actions token is read from. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Opens the sign-in address; by default the platform's opener. */
  readonly openBrowser?: (url: string) => void;
  /** Says a line to the person while the act runs (the sign-in address). */
  readonly say?: (line: string) => void;
}

/** One checkpoint to countersign: its digest, and the bytes it is the digest of. */
export interface CheckpointToSign {
  readonly digest: string;
  readonly message: Uint8Array;
}

/** What signing one checkpoint gave. */
export type SignedCheckpoint =
  | { readonly digest: string; readonly ok: true; readonly bundle: SigstoreBundle }
  | { readonly digest: string; readonly ok: false; readonly why: string };

/** What the act got from Sigstore. */
export type SigstoreSigning =
  | {
      readonly ok: true;
      /** The identity the certificate names — the e-mail, or the workflow URI. */
      readonly identity: string;
      /** The OpenID issuer that vouched for it. */
      readonly issuer: string;
      readonly checkpoints: readonly SignedCheckpoint[];
    }
  | { readonly ok: false; readonly code: SigningRefusal; readonly message: string };

/** Why no checkpoint was signed at all. */
export type SigningRefusal = 'PRIVATE_REPOSITORY' | 'NO_TOKEN' | 'NO_CERTIFICATE';

/** A Sigstore bundle, v0.3, as JSON — the file written beside the `.ots`. */
export interface SigstoreBundle {
  readonly mediaType: string;
  readonly verificationMaterial: {
    readonly certificate: { readonly rawBytes: string };
    readonly tlogEntries: readonly unknown[];
  };
  readonly messageSignature: {
    readonly messageDigest: { readonly algorithm: 'SHA2_256'; readonly digest: string };
    readonly signature: string;
  };
}

/** The media type of the bundles this writes. */
export const BUNDLE_MEDIA_TYPE = 'application/vnd.dev.sigstore.bundle.v0.3+json';

const platformFetch: Fetch = (url, init) => globalThis.fetch(url, init);

const ephemeralKey = (): KeyPair => generateKeyPairSync('ec', { namedCurve: 'P-256' });

const hexToBase64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64');

/** The claims of an OpenID token, read without checking it — Fulcio checks it. */
export function tokenClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1] ?? '';
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as unknown;
    return typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * What Fulcio asks the key to sign as proof it is held: the e-mail for the two issuers that
 * vouch for one, the subject for every other.
 */
function challengeOf(claims: Record<string, unknown>): string {
  const issuer = String(claims.iss ?? '');
  if (issuer === 'https://oauth2.sigstore.dev/auth' || issuer === 'https://accounts.google.com') {
    return String(claims.email ?? '');
  }
  return String(claims.sub ?? '');
}

/** One JSON request to a fixed address; the answer, or why there is none. */
async function post(
  fetch: Fetch,
  url: string,
  body: unknown,
): Promise<{ ok: true; json: unknown } | { ok: false; why: string }> {
  try {
    const answer = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(SIGSTORE_TIMEOUT_MS),
    });
    const text = await answer.text();
    if (answer.status !== 200 && answer.status !== 201) {
      return { ok: false, why: `${new URL(url).host} answered ${String(answer.status)}` };
    }
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Countersigns each checkpoint with a Sigstore certificate: one token, one key, one certificate
 * for the act, and one Rekor entry per checkpoint. Never throws over the network: what Sigstore
 * did is the answer.
 */
export async function signWithSigstore(
  checkpoints: readonly CheckpointToSign[],
  network: SigstoreNetwork = {},
): Promise<SigstoreSigning> {
  const fetch = network.fetch ?? platformFetch;
  let token: string;
  try {
    token = await (network.token ?? (() => defaultToken(fetch, network)))();
  } catch (error) {
    return {
      ok: false,
      code: 'NO_TOKEN',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const claims = tokenClaims(token);
  if (claims.repository_visibility === 'private') {
    return {
      ok: false,
      code: 'PRIVATE_REPOSITORY',
      message:
        'this workflow runs in a private repository, and a Sigstore certificate would write ' +
        "the repository's name and its workflow's into a public log that does not forget — " +
        'nothing was sent',
    };
  }

  const key = (network.generateKey ?? ephemeralKey)();
  const publicPem = key.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const proof = sign('sha256', Buffer.from(challengeOf(claims)), key.privateKey);
  const issued = await post(fetch, `${SIGSTORE.fulcio}/api/v2/signingCert`, {
    credentials: { oidcIdentityToken: token },
    publicKeyRequest: {
      publicKey: { algorithm: 'ECDSA', content: publicPem },
      proofOfPossession: proof.toString('base64'),
    },
  });
  if (!issued.ok) return { ok: false, code: 'NO_CERTIFICATE', message: issued.why };
  const leafPem = leafOf(issued.json);
  if (leafPem === undefined) {
    return {
      ok: false,
      code: 'NO_CERTIFICATE',
      message: 'Fulcio answered without a certificate that carries its own timestamp',
    };
  }
  const leaf = new X509Certificate(leafPem);

  const signed: SignedCheckpoint[] = [];
  for (const checkpoint of checkpoints) {
    const signature = sign('sha256', checkpoint.message, key.privateKey).toString('base64');
    const logged = await post(fetch, `${SIGSTORE.rekor}/api/v1/log/entries`, {
      apiVersion: '0.0.1',
      kind: 'hashedrekord',
      spec: {
        data: { hash: { algorithm: 'sha256', value: checkpoint.digest } },
        signature: {
          content: signature,
          publicKey: { content: Buffer.from(leafPem).toString('base64') },
        },
      },
    });
    if (!logged.ok) {
      signed.push({ digest: checkpoint.digest, ok: false, why: logged.why });
      continue;
    }
    const entry = tlogEntryOf(logged.json);
    if (entry === undefined) {
      signed.push({
        digest: checkpoint.digest,
        ok: false,
        why: 'Rekor answered without an entry and its proof of inclusion',
      });
      continue;
    }
    signed.push({
      digest: checkpoint.digest,
      ok: true,
      bundle: {
        mediaType: BUNDLE_MEDIA_TYPE,
        verificationMaterial: {
          certificate: { rawBytes: leaf.raw.toString('base64') },
          tlogEntries: [entry],
        },
        messageSignature: {
          messageDigest: { algorithm: 'SHA2_256', digest: hexToBase64(checkpoint.digest) },
          signature,
        },
      },
    });
  }
  return {
    ok: true,
    identity: identityOf(leaf),
    issuer: String(claims.iss ?? ''),
    checkpoints: signed,
  };
}

/** The identity a certificate names: its first e-mail or URI. */
export function identityOf(certificate: X509Certificate): string {
  const names = (certificate.subjectAltName ?? '').split(/,\s*/);
  for (const name of names) {
    const said = /^(?:email|URI):(.*)$/.exec(name);
    if (said?.[1] !== undefined) return said[1];
  }
  return '';
}

/** The leaf certificate of Fulcio's answer, when it carries its timestamp (an embedded SCT). */
function leafOf(answer: unknown): string | undefined {
  const certificates = (
    answer as { signedCertificateEmbeddedSct?: { chain?: { certificates?: unknown } } }
  )?.signedCertificateEmbeddedSct?.chain?.certificates;
  if (!Array.isArray(certificates) || typeof certificates[0] !== 'string') return undefined;
  return certificates[0];
}

/** Rekor's answer, as the bundle's transparency-log entry. */
function tlogEntryOf(answer: unknown): unknown {
  if (typeof answer !== 'object' || answer === null) return undefined;
  const entry = Object.values(answer)[0] as
    | {
        body?: string;
        integratedTime?: number;
        logID?: string;
        logIndex?: number;
        verification?: {
          signedEntryTimestamp?: string;
          inclusionProof?: {
            checkpoint?: string;
            hashes?: string[];
            logIndex?: number;
            rootHash?: string;
            treeSize?: number;
          };
        };
      }
    | undefined;
  const proof = entry?.verification?.inclusionProof;
  if (
    entry?.body === undefined ||
    entry.logID === undefined ||
    entry.logIndex === undefined ||
    entry.integratedTime === undefined ||
    proof?.checkpoint === undefined ||
    proof.rootHash === undefined ||
    proof.treeSize === undefined ||
    proof.logIndex === undefined
  ) {
    return undefined;
  }
  return {
    logIndex: String(entry.logIndex),
    logId: { keyId: hexToBase64(entry.logID) },
    kindVersion: { kind: 'hashedrekord', version: '0.0.1' },
    integratedTime: String(entry.integratedTime),
    ...(entry.verification?.signedEntryTimestamp === undefined
      ? {}
      : { inclusionPromise: { signedEntryTimestamp: entry.verification.signedEntryTimestamp } }),
    inclusionProof: {
      logIndex: String(proof.logIndex),
      rootHash: hexToBase64(proof.rootHash),
      treeSize: String(proof.treeSize),
      hashes: (proof.hashes ?? []).map(hexToBase64),
      checkpoint: { envelope: proof.checkpoint },
    },
    canonicalizedBody: entry.body,
  };
}

/**
 * The token when none is handed in: the Actions runner's when the job may ask for one, a
 * refusal when it is Actions and may not, and a browser sign-in everywhere else.
 */
async function defaultToken(fetch: Fetch, network: SigstoreNetwork): Promise<string> {
  const env = network.env ?? process.env;
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (url !== undefined && bearer !== undefined) return actionsToken(fetch, url, bearer);
  if (env.GITHUB_ACTIONS === 'true') {
    throw new Error(
      'this is GitHub Actions and the job cannot ask for a token: give it `permissions: id-token: write`',
    );
  }
  return browserToken(fetch, network);
}

/** The job's own token, for audience `sigstore`. */
async function actionsToken(fetch: Fetch, url: string, bearer: string): Promise<string> {
  const at = new URL(url);
  if (at.protocol !== 'https:') throw new Error('the Actions token address is not https');
  at.searchParams.set('audience', 'sigstore');
  const answer = await fetch(at.toString(), {
    method: 'GET',
    headers: { Authorization: `bearer ${bearer}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(SIGSTORE_TIMEOUT_MS),
  });
  if (answer.status !== 200) {
    throw new Error(`the Actions token endpoint answered ${String(answer.status)}`);
  }
  const value = (JSON.parse(await answer.text()) as { value?: unknown }).value;
  if (typeof value !== 'string') throw new Error('the Actions token endpoint gave no token');
  return value;
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url');

/**
 * A sign-in at `oauth2.sigstore.dev` through the browser: an authorization code with PKCE,
 * received on `localhost` and exchanged once. The address is said before the browser is asked
 * to open it, so a machine with no browser can still be signed in from another one.
 */
async function browserToken(fetch: Fetch, network: SigstoreNetwork): Promise<string> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));
  const nonce = base64url(randomBytes(16));
  const { server, port } = await listenOnLoopback();
  try {
    const redirect = `http://localhost:${String(port)}/auth/callback`;
    const ask = new URL(`${SIGSTORE.oauth}/auth`);
    for (const [name, value] of Object.entries({
      response_type: 'code',
      client_id: 'sigstore',
      scope: 'openid email',
      redirect_uri: redirect,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })) {
      ask.searchParams.set(name, value);
    }
    const code = waitForCode(server, state);
    network.say?.(`Sign in to Sigstore at: ${ask.toString()}`);
    (network.openBrowser ?? openInBrowser)(ask.toString());
    const answer = await fetch(`${SIGSTORE.oauth}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: await code,
        redirect_uri: redirect,
        client_id: 'sigstore',
        code_verifier: verifier,
      }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(SIGSTORE_TIMEOUT_MS),
    });
    if (answer.status !== 200) {
      throw new Error(`oauth2.sigstore.dev answered ${String(answer.status)}`);
    }
    const token = (JSON.parse(await answer.text()) as { id_token?: unknown }).id_token;
    if (typeof token !== 'string') throw new Error('oauth2.sigstore.dev gave no token');
    if (tokenClaims(token).nonce !== nonce) {
      throw new Error('the token oauth2.sigstore.dev gave is not the one this sign-in asked for');
    }
    return token;
  } finally {
    server.close();
  }
}

/** A server on the loopback, on a port the system picks. */
function listenOnLoopback(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, 'localhost', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('the sign-in could not listen on localhost'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

/** The authorization code the browser brings back, for this sign-in's `state` only. */
function waitForCode(server: Server, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('nobody signed in to Sigstore in time')),
      SIGN_IN_TIMEOUT_MS,
    );
    server.on('request', (request, response) => {
      const at = new URL(request.url ?? '/', 'http://localhost');
      if (at.pathname !== '/auth/callback') {
        response.writeHead(404).end();
        return;
      }
      const code = at.searchParams.get('code');
      const ok = at.searchParams.get('state') === state && code !== null;
      response
        .writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(
          ok ? 'Signed in. You can close this tab.' : 'This is not the sign-in mnema asked for.',
        );
      if (!ok) return;
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Asks the platform to open `url`, and says nothing when it cannot: the address was printed. */
function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // The address is on the screen; opening it is a convenience.
  }
}
