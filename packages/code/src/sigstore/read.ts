/**
 * Reading a Sigstore bundle — offline, against the trust root this binary carries.
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
      /** The identity the certificate names — an e-mail, or a workflow URI. */
      readonly identity: string;
      /** The OpenID issuer that vouched for it. */
      readonly issuer: string;
      /** When Rekor logged the signature, on Rekor's clock. */
      readonly loggedAt: string;
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
  /** Source Repository URI — `1.3.6.1.4.1.57264.1.12`. */
  readonly repository?: string;
  /** Build Signer URI, the workflow that signed — `1.3.6.1.4.1.57264.1.9`. */
  readonly workflow?: string;
  /** Source Repository Digest, the commit the run was based on — `1.3.6.1.4.1.57264.1.13`. */
  readonly commit?: string;
  /** Run Invocation URI, the one execution — `1.3.6.1.4.1.57264.1.21`. */
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

/** The run a verified signer's certificate names — undefined when it names none of the four. */
function runOf(
  oids: readonly {
    readonly oid?: { readonly id: readonly number[] };
    readonly value?: Uint8Array;
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
    const signer = verifier.verify(toSignedEntity(bundle, Buffer.from(checkpoint.message)));
    const entry = bundle.verificationMaterial.tlogEntries[0];
    const ran = runOf(signer.identity?.oids ?? []);
    return {
      kind: 'signed',
      identity: signer.identity?.subjectAlternativeName ?? '',
      issuer: signer.identity?.extensions?.issuer ?? '',
      loggedAt: new Date(Number(entry?.integratedTime ?? 0) * 1000).toISOString(),
      logIndex: entry?.logIndex ?? '',
      ...(ran === undefined ? {} : { ran }),
    };
  } catch (error) {
    return { kind: 'not-covered', why: `Sigstore's checks refused it: ${reason(error)}` };
  }
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));
