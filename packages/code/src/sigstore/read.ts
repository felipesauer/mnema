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
 * It is loaded only when `verify --against-sigstore` is given: without the flag no byte of the
 * library is read.
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
    }
  | { readonly kind: 'not-covered'; readonly why: string };

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
    return {
      kind: 'signed',
      identity: signer.identity?.subjectAlternativeName ?? '',
      issuer: signer.identity?.extensions?.issuer ?? '',
      loggedAt: new Date(Number(entry?.integratedTime ?? 0) * 1000).toISOString(),
      logIndex: entry?.logIndex ?? '',
    };
  } catch (error) {
    return { kind: 'not-covered', why: `Sigstore's checks refused it: ${reason(error)}` };
  }
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));
