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
  CodedError,
  isProtected,
  type KeyPair,
  listPrivateKeyFingerprints,
  passphraseFromEnvironment,
  persistKeyPair,
  readPrivateKeyPair,
  type UpcasterRegistry,
  writeAnchor,
} from '@mnema/chain';
import { oneLine } from '../one-line.js';
import { agentNameRefusal } from './agent-name.js';
import { nameOfAKeyKind } from './key-kind.js';
import {
  type Membership,
  type MembershipRefusalCode,
  membershipIn,
  rosterByRole,
} from './membership.js';

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
  /** The tree proves the key an agent's: it is no key of a person to restore (see {@link restoreKey}). */
  | 'AN_AGENT_KEY'
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
      message: `${oneLine(input.privateKeyPath)} could not be read as a private key`,
    };
  }

  const keyRoot = { root: input.keyRoot };
  const [other] = listPrivateKeyFingerprints(keyRoot).filter((fp) => fp !== keyPair.fingerprint);
  if (other !== undefined) {
    return {
      ok: false,
      code: 'KEY_PRESENT',
      message:
        `this machine already holds the private key ${oneLine(other)} — ` +
        'restoring another would leave two, and which one the machine signs as ' +
        'would depend on the order the directory lists them. Restore is for a key ' +
        'that is gone; bringing a second key into an identity is an enrollment',
    };
  }

  const query = { tree: input.tree, upcasters: input.upcasters };
  const found = membershipIn(query, keyPair);
  if (!found.ok) return found;
  // An agent's key restored here would be installed at the person's key root, where the next
  // write signs with it as the person: facts the verifier then reads as a break, because they are
  // signed by an agent key and name no agent. Before the anchor is written, as before anything.
  if (found.membership === 'agent') {
    const name = rosterByRole(query, found.anchor).agents.get(keyPair.fingerprint) ?? '<name>';
    return {
      ok: false,
      code: 'AN_AGENT_KEY',
      message:
        `the key ${oneLine(keyPair.fingerprint)} is an agent key of ${oneLine(found.anchor)} — it signs ` +
        "for its host from its own agent's folder and is not a key of a person to restore; " +
        `\`mnema key restore --agent ${oneLine(name)} <file>\` installs it there. Nothing was written`,
    };
  }

  writeAnchor({ root: input.tree }, keyPair.fingerprint, found.anchor);
  // A copy that was protected is installed protected, with the passphrase it was just opened by:
  // restoring a key must not be the way a protected one ends up in the clear.
  const passphrase = isProtectedCopy(input.privateKeyPath)
    ? passphraseFromEnvironment()
    : undefined;
  const installedAt = persistKeyPair(
    keyRoot,
    keyPair,
    passphrase === undefined ? {} : { passphrase },
  );

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
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  try {
    return readPrivateKeyPair(path, text);
  } catch (error) {
    // A protected key that cannot be opened is a refusal with its own words — the copy IS a
    // private key, and the way on is the passphrase — and not "could not be read as one".
    if (error instanceof CodedError) throw error;
    return null;
  }
}

/** Whether the copy at `path` is a protected key, so the restored one is installed the same way. */
function isProtectedCopy(path: string): boolean {
  try {
    return isProtected(readFileSync(path, 'utf-8'));
  } catch {
    return false;
  }
}

/** What restoring an agent's key needs. Paths are absolute — the surface resolves them. */
export interface RestoreAgentInput {
  /** The PEM file holding the private half: READ and never moved. */
  readonly privateKeyPath: string;
  /** The name the record enrols the key under, which is also its folder. */
  readonly name: string;
  /** The agent's own key root (`agentKeyRoot`): the folder the host reads the key from. */
  readonly agentKeyRoot: string;
  /** The tree whose chain must prove the key an agent's. */
  readonly tree: string;
  readonly upcasters: UpcasterRegistry;
}

/** The key of an agent was installed in its folder. */
export interface RestoreAgentOk {
  readonly ok: true;
  readonly fingerprint: string;
  /** The identity the agent signs for. */
  readonly anchor: string;
  /** The name the record enrols the key under. */
  readonly name: string;
  /** Where the private half was installed — a COPY; the file named is untouched. */
  readonly installedAt: string;
}

/** Why the key of an agent was not restored. */
export type RestoreAgentErrorCode =
  | RestoreErrorCode
  /** The name is no agent name — it is a folder, so one that could name another place is refused. */
  | 'BAD_AGENT_NAME'
  /** The key is protected by a passphrase, and an agent's host has no terminal to ask it at. */
  | 'PROTECTED_AGENT_KEY'
  /** The tree proves the key a member of the identity itself: it is a person's to restore. */
  | 'NOT_AN_AGENT_KEY'
  /** The tree enrols the key as an agent under another name. */
  | 'AGENT_UNDER_ANOTHER_NAME';

/** The restore was refused; nothing was written. */
export interface RestoreAgentErr {
  readonly ok: false;
  readonly code: RestoreAgentErrorCode;
  readonly message: string;
}

/**
 * Installs the key of an agent into the agent's own folder, for the machine it will sign from: a
 * runner that begins every job with nothing on it takes the key from where the team keeps it and
 * puts it where the agent's host looks.
 *
 * It decides what {@link restoreKey} decides for a person, with the answers turned round: the
 * record must prove the key an AGENT of an identity, under exactly `name` (a key keeps the name it
 * was enrolled under, and the host that reads the folder stamps that name on what it signs), not
 * retired, and the folder may hold no other live key. A copy that is protected is refused, where a
 * person's is kept protected: the agent's host cannot ask for the passphrase.
 *
 * It appends nothing and records NO anchor. The key is read from the record on every write (the
 * record enrols it, and the person's anchor file is exactly the shortcut that would let a key
 * speak for an identity the record does not name), so installing the file is all there is to do.
 */
export function restoreAgentKey(input: RestoreAgentInput): RestoreAgentOk | RestoreAgentErr {
  const unnamed = agentNameRefusal(input.name);
  if (unnamed !== undefined) return { ok: false, code: 'BAD_AGENT_NAME', message: unnamed };

  if (isProtectedCopy(input.privateKeyPath)) {
    return {
      ok: false,
      code: 'PROTECTED_AGENT_KEY',
      message:
        `${oneLine(input.privateKeyPath)} is protected by a passphrase, and an agent's host has no terminal to ask it at — ` +
        '`mnema key request --agent <name> --anchor <your identity>` makes the agent a key that is not protected',
    };
  }
  const keyPair = readKeyPair(input.privateKeyPath);
  if (keyPair === null) {
    return {
      ok: false,
      code: 'UNREADABLE_KEY',
      message: `${oneLine(input.privateKeyPath)} could not be read as a private key`,
    };
  }
  const kind = keyPair.publicKey.asymmetricKeyType;
  if (kind !== 'ed25519') {
    return {
      ok: false,
      code: 'UNREADABLE_KEY',
      message:
        `the key ${oneLine(keyPair.fingerprint)} is ${kind === undefined ? 'of a kind this does not know' : nameOfAKeyKind(kind)}, ` +
        "and an agent's key is an Ed25519 one — the consent that enrols it is proved for no other kind",
    };
  }

  const query = { tree: input.tree, upcasters: input.upcasters };
  const found = membershipIn(query, keyPair);
  if (!found.ok) return found;
  if (found.membership !== 'agent') {
    return {
      ok: false,
      code: 'NOT_AN_AGENT_KEY',
      message:
        `the key ${oneLine(keyPair.fingerprint)} is a key of ${oneLine(found.anchor)} itself, not an agent's — ` +
        "`mnema key restore <file>` brings it back as the person's. Nothing was written",
    };
  }
  const enrolledAs = rosterByRole(query, found.anchor).agents.get(keyPair.fingerprint) ?? '';
  if (enrolledAs !== input.name) {
    return {
      ok: false,
      code: 'AGENT_UNDER_ANOTHER_NAME',
      message:
        `the record enrols the key ${oneLine(keyPair.fingerprint)} as the agent "${oneLine(enrolledAs)}" of ` +
        `${oneLine(found.anchor)}, not as "${oneLine(input.name)}" — a key keeps the name it was enrolled under, ` +
        `so restore it with --agent ${oneLine(enrolledAs)}`,
    };
  }

  const keyRoot = { root: input.agentKeyRoot };
  const [other] = listPrivateKeyFingerprints(keyRoot).filter((fp) => fp !== keyPair.fingerprint);
  if (other !== undefined) {
    return {
      ok: false,
      code: 'KEY_PRESENT',
      message:
        `the folder of the agent "${oneLine(input.name)}" already holds the private key ${oneLine(other)} — ` +
        'a second would make the key the agent signs with depend on the order the directory lists them',
    };
  }

  const installedAt = persistKeyPair(keyRoot, keyPair);
  return {
    ok: true,
    fingerprint: keyPair.fingerprint,
    anchor: found.anchor,
    name: input.name,
    installedAt,
  };
}
