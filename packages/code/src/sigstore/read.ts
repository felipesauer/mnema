/**
 * Reading a Sigstore bundle: offline, against the trust root this binary carries.
 *
 * THE CHECKS ARE SIGSTORE'S OWN. `@sigstore/verify` (the library npm uses for provenance) checks
 * the certificate up to Fulcio's root, the certificate-transparency timestamp it carries, Rekor's
 * signed promise and its proof of inclusion, and the signature over the message. That is where a
 * reading written by hand goes wrong, and it is a second hand judging the signer in `sign.ts`.
 *
 * THE MESSAGE IS RECOMPUTED, NEVER TAKEN FROM THE BUNDLE. The caller hands in the bytes of the
 * checkpoint as `checkpoints.jsonl` holds it, and the bundle is checked as a signature over THOSE
 * bytes and filed under THEIR digest. A bundle over any other message reads `not covered`.
 *
 * It is loaded only when `verify --against-sigstore` is given, or when a stack being installed
 * carries a `stack.sigstore.json`: otherwise no byte of the library is read.
 */

import { bundleFromJSON } from '@sigstore/bundle';
import { TrustedRoot } from '@sigstore/protobuf-specs';
import { toSignedEntity, toTrustMaterial, Verifier } from '@sigstore/verify';
import { PUBLIC_GOOD_TRUSTED_ROOT } from './trusted-root.js';

/** What one bundle says, once read. */
export type SigstoreReading =
  | {
      readonly kind: 'signed';
      /** The identity the certificate names: an e-mail, or a workflow URI. */
      readonly identity: string;
      /** The OpenID issuer that vouched for it. */
      readonly issuer: string;
      /**
       * When the signature was logged, and only a time the library verified: Rekor's clock when its
       * signed promise carries one, else the timestamp authority's (a Rekor v2 entry carries no
       * time of its own). Absent when the bundle carries none: never a date made up.
       */
      readonly loggedAt?: string;
      /** Whose clock `loggedAt` is; absent when `loggedAt` is. */
      readonly loggedAtBy?: 'rekor' | 'timestamp-authority';
      readonly logIndex: string;
      /**
       * The run the certificate names, when it names any: the repository, the workflow, the commit
       * and the run (Fulcio's extensions 12, 9, 13 and 21). Each is only what Fulcio wrote into a
       * certificate Sigstore's own checks accepted; none is the agent inside the run.
       */
      readonly ran?: SigstoreRun;
    }
  | { readonly kind: 'not-covered'; readonly why: string };

/** What a certificate says about the CI run that asked for it; a name is absent when not carried. */
export interface SigstoreRun {
  /** Source Repository URI: `1.3.6.1.4.1.57264.1.12`. */
  readonly repository?: string;
  /** Build Signer URI, the workflow that signed: `1.3.6.1.4.1.57264.1.9`. */
  readonly workflow?: string;
  /** Source Repository Digest, the commit the run was based on: `1.3.6.1.4.1.57264.1.13`. */
  readonly commit?: string;
  /** Run Invocation URI, the one execution: `1.3.6.1.4.1.57264.1.21`. */
  readonly run?: string;
}

/** The Fulcio extensions the run is read from (`github.com/sigstore/fulcio`, `docs/oid-info.md`). */
const FULCIO_EXTENSIONS: Readonly<Record<keyof SigstoreRun, string>> = {
  workflow: '1.3.6.1.4.1.57264.1.9',
  repository: '1.3.6.1.4.1.57264.1.12',
  commit: '1.3.6.1.4.1.57264.1.13',
  run: '1.3.6.1.4.1.57264.1.21',
};

/** The UTF8String (tag 0x0C) a Fulcio v2 extension holds, or undefined when it is anything else. */
function utf8StringOf(der: Uint8Array): string | undefined {
  if (der[0] !== 0x0c || der.length < 2) return undefined;
  let length = der[1] ?? 0;
  let at = 2;
  if (length > 0x7f) {
    const bytes = length & 0x7f;
    if (bytes === 0 || bytes > 4 || der.length < 2 + bytes) return undefined;
    length = 0;
    for (let i = 0; i < bytes; i++) length = length * 256 + (der[2 + i] ?? 0);
    at = 2 + bytes;
  }
  if (at + length !== der.length) return undefined;
  return Buffer.from(der.subarray(at)).toString('utf8');
}

/** The run a verified signer's certificate names: undefined when it names none of the four. */
function runOf(
  oids: readonly {
    readonly oid?: { readonly id: readonly number[] } | undefined;
    readonly value?: Uint8Array | undefined;
  }[],
): SigstoreRun | undefined {
  const found: { -readonly [K in keyof SigstoreRun]?: string } = {};
  for (const [name, id] of Object.entries(FULCIO_EXTENSIONS) as [keyof SigstoreRun, string][]) {
    const one = oids.find((extension) => extension.oid?.id.join('.') === id);
    const text = one?.value === undefined ? undefined : utf8StringOf(one.value);
    if (text !== undefined && text !== '') found[name] = text;
  }
  return Object.keys(found).length === 0 ? undefined : found;
}

/** The time the library verified for this entity: Rekor's promised one, else the timestamp authority's. */
function verifiedTime(
  entity: ReturnType<typeof toSignedEntity>,
  entry:
    | ReturnType<typeof bundleFromJSON>['verificationMaterial']['tlogEntries'][number]
    | undefined,
): { readonly loggedAt: string; readonly loggedAtBy: 'rekor' | 'timestamp-authority' } | undefined {
  if (
    entry?.inclusionPromise !== undefined &&
    entry.integratedTime &&
    entry.integratedTime !== '0'
  ) {
    return {
      loggedAt: new Date(Number(entry.integratedTime) * 1000).toISOString(),
      loggedAtBy: 'rekor',
    };
  }
  for (const stamp of entity.timestamps) {
    if (stamp.$case === 'timestamp-authority') {
      return {
        loggedAt: stamp.timestamp.signingTime.toISOString(),
        loggedAtBy: 'timestamp-authority',
      };
    }
  }
  return undefined;
}

/**
 * Reads the bundle `text` as a Sigstore signature over `message`, whose SHA-256 is `digest`.
 * Never throws: a bundle that does not hold is a reading.
 */
export function readSigstoreBundle(
  text: string,
  checkpoint: { readonly digest: string; readonly message: Uint8Array },
  trustedRoot: unknown = PUBLIC_GOOD_TRUSTED_ROOT,
): SigstoreReading {
  let bundle: ReturnType<typeof bundleFromJSON>;
  try {
    bundle = bundleFromJSON(JSON.parse(text) as unknown);
  } catch (error) {
    return { kind: 'not-covered', why: `not a Sigstore bundle: ${reason(error)}` };
  }
  if (bundle.content.$case !== 'messageSignature') {
    return { kind: 'not-covered', why: 'the bundle signs an envelope, not a checkpoint' };
  }
  const digest = Buffer.from(bundle.content.messageSignature.messageDigest?.digest ?? []);
  if (digest.toString('hex') !== checkpoint.digest) {
    return { kind: 'not-covered', why: 'the bundle is over another digest than its file name' };
  }
  try {
    const verifier = new Verifier(toTrustMaterial(TrustedRoot.fromJSON(trustedRoot)), {
      tlogThreshold: 1,
      ctlogThreshold: 1,
      timestampThreshold: 1,
    });
    const entity = toSignedEntity(bundle, Buffer.from(checkpoint.message));
    const signer = verifier.verify(entity);
    const entry = bundle.verificationMaterial.tlogEntries[0];
    const ran = runOf(signer.identity?.oids ?? []);
    return {
      kind: 'signed',
      identity: signer.identity?.subjectAlternativeName ?? '',
      issuer: signer.identity?.extensions?.issuer ?? '',
      ...verifiedTime(entity, entry),
      logIndex: entry?.logIndex ?? '',
      ...(ran === undefined ? {} : { ran }),
    };
  } catch (error) {
    return { kind: 'not-covered', why: `Sigstore's checks refused it: ${reason(error)}` };
  }
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));
