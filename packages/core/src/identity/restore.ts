/**
 * Restoring a signing key from a copy of its private half — the only recovery
 * mnema has, and the reason a cold backup key is made at all.
 *
 * mnema refuses central recovery by design: an entity able to restore an identity
 * is an entity able to FORGE one. So recovery is not a service that hands an
 * identity back — it is a key the person already holds, proven a member of that
 * identity while the first key still existed, brought back onto a machine. This
 * module is that last step, and it is deliberately small: it installs key material
 * locally and records WHICH anchor the key serves. It appends nothing, signs
 * nothing, and asks no one's permission — the permission was granted, on the
 * chain, by the enrollment that made the key a member.
 *
 * Two files decide whether a key speaks for an identity or for a stranger:
 *
 *   <keyRoot>/keys/<fp>.key     the private half — installed here, this machine
 *                               now signs with it
 *   <tree>/keys/<fp>.anchor     WHICH anchor it authorizes as, in THIS tree
 *
 * The second is the one that matters, and it is per TREE, not per machine: the
 * writer reads the anchor from the chain it is writing to (see the chain's writer)
 * and, finding none, derives the key's OWN anchor and founds a new identity. A
 * private key installed without that file is therefore not a recovered identity —
 * it is a SPLIT, a second identity wearing the same person's key, appended
 * irreversibly to a tree the team shares. Which is why this refuses far more
 * readily than it writes:
 *
 *   - a private key of ANOTHER fingerprint already at the key root — the machine
 *     adopts the first one it finds, so a second would make its identity depend on
 *     directory order (restoring the SAME key again is allowed: it adds no second
 *     key, and adopting the anchor is per-tree work that a second project needs);
 *   - a key this tree never accepted — the chain must PROVE membership, with the
 *     key's own signature, before the key writes as that anchor;
 *   - a key this tree retired — a revoked member that writes again turns the whole
 *     tree red, and the event cannot be taken back.
 *
 * A refusal costs nothing while it is still a refusal. An event does not have that
 * property.
 */

import { readFileSync } from 'node:fs';
import {
  deriveAnchor,
  enrollmentMessage,
  type KeyPair,
  keyPairFromPrivatePem,
  listPrivateKeyFingerprints,
  persistKeyPair,
  type UpcasterRegistry,
  verifySignature,
  writeAnchor,
} from '@mnema/chain';
import { orderedEvents } from '../projections/order.js';

/** What restoring a key needs. Paths are absolute — the surface resolves them. */
export interface RestoreInput {
  /** The PEM file holding the private half: the person's copy, READ and never moved. */
  readonly privateKeyPath: string;
  /** The key root the private half is installed into. */
  readonly keyRoot: string;
  /** The tree whose chain must prove membership, and which adopts the key. */
  readonly tree: string;
  readonly upcasters: UpcasterRegistry;
}

/** How the tree proves the key belongs to the anchor it adopted. */
export type RestoredMembership =
  /** The key founded this anchor — it is the identity's first key. */
  | 'founded'
  /** A member vouched for the key, and the key's own signature proves it consented. */
  | 'enrolled';

/** The key was installed and now speaks for the anchor the tree proves it joined. */
export interface RestoreOk {
  readonly ok: true;
  /** The restored key's full fingerprint, re-derived from the private half. */
  readonly fingerprint: string;
  /** The anchor this key now authorizes as in that tree. */
  readonly anchor: string;
  /** How the tree proves the membership. */
  readonly membership: RestoredMembership;
  /**
   * Where the private half was installed — a COPY. The file the caller named is
   * read and left exactly where it was; it is still the only copy off-machine.
   */
  readonly installedAt: string;
}

/** Why a key was not restored. */
export type RestoreErrorCode =
  /** The file is missing, unreadable, or not a private key. */
  | 'UNREADABLE_KEY'
  /** A private key of another fingerprint is already installed at the key root. */
  | 'KEY_PRESENT'
  /** Nothing in that tree proves this key belongs to any identity. */
  | 'NOT_A_MEMBER'
  /** The tree proves the key belonged to an identity and was retired from it. */
  | 'REVOKED_KEY'
  /** The tree proves membership in more than one identity — which one is the person's call. */
  | 'AMBIGUOUS_MEMBERSHIP';

/** The restore was refused; nothing was written. */
export interface RestoreErr {
  readonly ok: false;
  readonly code: RestoreErrorCode;
  /** Plain-language reason, to be reported to the person as-is. */
  readonly message: string;
}

/**
 * Restores a key onto this machine for one tree: installs the private half at the
 * key root and records, in that tree, the anchor the key authorizes as.
 *
 * The anchor comes from the CHAIN, never from the caller and never from the key
 * itself. The tree is scanned for the fact that decided this key's membership — a
 * founding it signed, or an enrollment carrying its own consent signature — and
 * the anchor that fact names is the one adopted. This is what makes recovery
 * possible offline and from nothing but a git clone plus one file: the proof of
 * membership travels in the committed record, so the machine that lost everything
 * finds it there.
 *
 * The membership check re-verifies the enrollment's consent signature against the
 * key it just derived. Without that, any tree could hand a restored key an anchor
 * by merely NAMING its fingerprint, and the key would sign as an identity it never
 * joined. With it, only a signature the key itself produced can point the key at
 * an anchor. Whether the rest of that tree's identity fold is sound is `verify`'s
 * question, not this one — but the part only the key's holder can produce is
 * checked here, before the first write.
 *
 * The writes are ordered anchor FIRST, key material second, because only one order
 * has a harmless failure: a crash after the anchor leaves a local file naming an
 * anchor for a key that cannot sign here (inert, and the next run completes it),
 * while a crash after the key material would leave a machine holding a key with no
 * recorded anchor — which founds a new identity on its very next write.
 */
export function restoreKey(input: RestoreInput): RestoreOk | RestoreErr {
  const keyPair = readKeyPair(input.privateKeyPath);
  if (keyPair === null) {
    return {
      ok: false,
      code: 'UNREADABLE_KEY',
      message: `${input.privateKeyPath} could not be read as a private key`,
    };
  }

  const keyRoot = { root: input.keyRoot };
  const other = listPrivateKeyFingerprints(keyRoot).filter((fp) => fp !== keyPair.fingerprint);
  if (other.length > 0) {
    return {
      ok: false,
      code: 'KEY_PRESENT',
      message:
        `this machine already holds the private key ${other[0]} — ` +
        'restoring another would leave two, and which one the machine signs as ' +
        'would depend on the order the directory lists them. Restore is for a key ' +
        'that is gone; bringing a second key into an identity is an enrollment',
    };
  }

  const found = membershipIn(input, keyPair);
  if (!found.ok) return found;

  writeAnchor({ root: input.tree }, keyPair.fingerprint, found.anchor);
  const installedAt = persistKeyPair(keyRoot, keyPair);

  return {
    ok: true,
    fingerprint: keyPair.fingerprint,
    anchor: found.anchor,
    membership: found.membership,
    installedAt,
  };
}

/** The key pair a PEM file holds, or null when it is not a readable private key. */
function readKeyPair(path: string): KeyPair | null {
  try {
    return keyPairFromPrivatePem(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * The identity a tree proves this key currently belongs to.
 *
 * The facts are folded in the chain's own order, so a key enrolled, revoked, and
 * enrolled again ends a member — the order of the record decides, exactly as it
 * does for the verifier. A revocation is honored whether or not it is
 * signature-covered, which is deliberately stricter than the verifier: the
 * verifier ignores a residual revoke so a keyless party cannot deny an honest
 * chain, but here the worst a wrongly-honored revoke can do is refuse a restore
 * the person can retry, while the worst a wrongly-IGNORED one can do is append
 * events under a retired key — permanently red, and unappendable-back.
 */
function membershipIn(
  input: RestoreInput,
  keyPair: KeyPair,
): { ok: true; anchor: string; membership: RestoredMembership } | RestoreErr {
  const fingerprint = keyPair.fingerprint;
  /** Anchors this key currently belongs to, and how each is proven. */
  const member = new Map<string, RestoredMembership>();
  /** Anchors that retired this key and did not take it back. */
  const retired = new Set<string>();

  for (const event of orderedEvents({ root: input.tree }, input.upcasters)) {
    const anchor = event.subject;
    switch (event.kind) {
      case 'identity.founded': {
        if (event.payload.foundingFp !== fingerprint) break;
        // The same two bindings the verifier requires of a founding: the founding
        // key signed it, and the anchor derives from that key. A founding failing
        // either is not this key's identity — it is a broken event.
        if (event.signerFp !== fingerprint) break;
        if (anchor !== deriveAnchor(fingerprint)) break;
        member.set(anchor, 'founded');
        retired.delete(anchor);
        break;
      }
      case 'key.enrolled': {
        if (event.payload.newFp !== fingerprint) break;
        if (event.who !== anchor) break;
        // The part only this key's holder could have produced. Everything else an
        // enrollment asserts, a stranger's tree could assert too.
        if (!consented(keyPair, anchor, event.payload.reverseSig)) break;
        // A founding is the stronger fact about the same anchor; keep it.
        if (!member.has(anchor)) member.set(anchor, 'enrolled');
        retired.delete(anchor);
        break;
      }
      case 'key.revoked': {
        if (event.payload.revokedFp !== fingerprint) break;
        if (event.who !== anchor) break;
        member.delete(anchor);
        retired.add(anchor);
        break;
      }
      default:
        break;
    }
  }

  const anchors = [...member.keys()];
  if (anchors.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS_MEMBERSHIP',
      message:
        `this key belongs to more than one identity in that tree (${anchors.join(', ')}) — ` +
        'which one it should speak for here is not a choice to make on its behalf',
    };
  }
  const anchor = anchors[0];
  if (anchor === undefined) {
    const [retiredFrom] = [...retired];
    if (retiredFrom !== undefined) {
      return {
        ok: false,
        code: 'REVOKED_KEY',
        message:
          `this key was revoked from ${retiredFrom} — a retired key that writes again ` +
          'leaves the whole record failing verification, so it is not installed',
      };
    }
    return {
      ok: false,
      code: 'NOT_A_MEMBER',
      message:
        `nothing in that record proves the key ${fingerprint} belongs to an identity — ` +
        'a key is restored where it was proven a member, while the first key still existed',
    };
  }
  return { ok: true, anchor, membership: member.get(anchor) as RestoredMembership };
}

/** Whether `reverseSig` is this key's own signature over `enroll:<anchor>:<fp>`. */
function consented(keyPair: KeyPair, anchor: string, reverseSig: string): boolean {
  try {
    return verifySignature(
      enrollmentMessage(anchor, keyPair.fingerprint),
      Buffer.from(reverseSig, 'hex'),
      keyPair.publicKey,
    );
  } catch {
    return false;
  }
}
