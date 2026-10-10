/**
 * A stack's author signature, read offline: `stack.sigstore.json` at the stack's root, a Sigstore
 * bundle (v0.3, a message signature) over the stack's LISTING — the `path NUL sha256(file) LF`
 * lines whose SHA-256 is the stack's digest. So the digest the bundle names, and the one Rekor
 * logged, is the stack's digest itself, and the listing is recomputed here from the files, never
 * taken from the bundle.
 *
 * The checks are Sigstore's own, through the reader `verify --against-sigstore` uses
 * (`sigstore/read.ts`), against the trust root this binary carries. Nothing is asked of anybody.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. A signature that holds says WHO signed these bytes — the
 * identity Fulcio wrote into the certificate, vouched for by an OpenID issuer, and logged in
 * Rekor. It does not say the stack is SAFE: an author can sign a harmful skill, and nothing here
 * reads what a skill tells an agent to do.
 *
 * A SIGNATURE THAT DOES NOT HOLD IS REFUSED, never read as no signature: a bundle over other bytes,
 * from a root this binary does not carry, or that is not a bundle at all, would otherwise install
 * a stack on the hash alone while the stack said it was signed.
 */

import { SIGNATURE_FILE, type StackFile, stackDigest, stackListing } from '@mnema/stacks';

/** What a stack's signature says. */
export type StackSignature =
  /** There is no `stack.sigstore.json`: only the digest vouches for the bytes. */
  | { readonly kind: 'unsigned' }
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
  /** There is a `stack.sigstore.json`, and it does not hold, for this reason. */
  | { readonly kind: 'refused'; readonly why: string };

/** How `sigstore/read.ts` begins the reason when the certificate chain or the log proofs do not verify. */
const CHECKS_REFUSED = "Sigstore's checks refused it";

/** The digest a bundle says it signs, in hex, when it says one. */
function namedDigest(text: string): string | undefined {
  try {
    const digest = (
      JSON.parse(text) as { messageSignature?: { messageDigest?: { digest?: unknown } } }
    ).messageSignature?.messageDigest?.digest;
    return typeof digest === 'string' ? Buffer.from(digest, 'base64').toString('hex') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the signature among a stack's `files` against `trustedRoot` (by default the public
 * Sigstore root this binary carries). Never throws.
 */
export async function readStackSignature(
  files: readonly StackFile[],
  trustedRoot?: unknown,
): Promise<StackSignature> {
  const signature = files.find((f) => f.path === SIGNATURE_FILE);
  if (signature === undefined) return { kind: 'unsigned' };
  const listing = stackListing(files);
  const digest = stackDigest(files).digest;
  if (listing === undefined || digest === undefined) {
    return { kind: 'refused', why: 'the stack has no digest to hold a signature to' };
  }
  const text = Buffer.from(signature.bytes).toString('utf8');
  const named = namedDigest(text);
  if (named !== undefined && named !== digest) {
    return {
      kind: 'refused',
      why: `it signs the digest ${named}, and these files are ${digest}`,
    };
  }
  // Loaded here, only once there is a signature to read: a stack without one reads no byte of the library.
  const { readSigstoreBundle } = await import('../sigstore/read.js');
  const reading = readSigstoreBundle(
    text,
    { digest, message: listing },
    ...(trustedRoot === undefined ? [] : [trustedRoot]),
  );
  if (reading.kind === 'not-covered') {
    return {
      kind: 'refused',
      why: reading.why.startsWith(CHECKS_REFUSED)
        ? `${reading.why}. The trust root this binary carries may be out of date: update mnema, or ` +
          'remove stack.sigstore.json and install by the digest alone, knowing that then only the ' +
          'hash vouches for the files'
        : reading.why,
    };
  }
  return { ...reading, kind: 'signed' };
}
