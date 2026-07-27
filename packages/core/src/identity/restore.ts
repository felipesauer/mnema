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
  type KeyPair,
  keyPairFromPrivatePem,
  listPrivateKeyFingerprints,
  persistKeyPair,
  type UpcasterRegistry,
  writeAnchor,
} from '@mnema/chain';
import { type Membership, type MembershipRefusalCode, membershipIn } from './membership.js';

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

/**
 * How the tree proves the key belongs to the anchor it adopted — the same
 * verdict the shared membership reading produces, because a restore and a first
 * write must never disagree about who a key is.
 */
export type RestoredMembership = Membership;

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
  /** The tree does not prove exactly one identity for this key (see the reading). */
  | MembershipRefusalCode;

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

  const found = membershipIn({ tree: input.tree, upcasters: input.upcasters }, keyPair);
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
