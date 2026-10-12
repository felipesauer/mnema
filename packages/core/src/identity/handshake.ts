/**
 * The handshake that brings a second machine into one identity: what the joining
 * machine produces, and how it travels.
 *
 * An identity is one anchor with several keys, and a key joins it by a fact that
 * needs two signatures nobody can make for anybody else. A MEMBER vouches (it
 * signs the `key.enrolled`), and the JOINING key proves it consents — its own
 * signature over `enroll:<anchor>:<fp>`. The two live on different machines, so
 * something has to cross the gap between them. That something is this request.
 *
 * It carries exactly two things:
 *
 *   pub   the joining key's PUBLIC half, in PEM
 *   sig   that key's signature over `enroll:<anchor>:<fp>`, hex
 *
 * The fingerprint does not travel: it is the hash of the public key, so it is
 * re-derived on arrival and cannot disagree with the key it names. The public
 * half MUST travel, because the vouching machine commits it into the tree — a
 * verifier proves the consent signature against the committed key, and a tree
 * that never received the key has no way to check the enrollment it carries.
 *
 * Nothing here is secret. The request is a public key plus a signature over
 * public values, so it can be pasted into a chat, a ticket, or an email without
 * exposing anything: it proves consent to join ONE anchor, and it is worthless to
 * anyone who is not already a member of that anchor (only a member's vouch turns
 * it into a fact). What it is NOT is an authorization — a request nobody vouches
 * for changes nothing at all.
 *
 * The text form is one line, prefixed and base64url-encoded, so it survives a
 * copy-paste through tools that would mangle raw PEM newlines, and so a person can
 * see at a glance what they were handed.
 */

import { readFileSync } from 'node:fs';
import {
  ANCHOR_PREFIX,
  agentEnrollmentMessage,
  CodedError,
  checkerEnrollmentMessage,
  enrollmentMessage,
  fingerprintOf,
  type KeyPair,
  listPrivateKeyFingerprints,
  loadOrCreateKeyPair,
  type PublicHalf,
  publicKeyFromPem,
  publicKeyToPem,
  readPrivateKeyPair,
  sign,
} from '@mnema/chain';
import { oneLine } from '../one-line.js';
import { agentNameRefusal } from './agent-name.js';
import { isAnchorId } from './anchor.js';

/**
 * The text form's prefix and version. Versioned because the request is data a
 * person copies between machines that may not run the same release: a future
 * shape gets a new number, and this one keeps being readable.
 */
const REQUEST_PREFIX = 'mnema-key-request:1:';

/**
 * The prefix of a request to be enrolled as a CHECKER — a key that signs check results and
 * nothing else. A prefix of its own, so a person who enrolls a line can tell from the line
 * which power it asks for, and a door that expects one kind refuses the other.
 */
export const CHECKER_REQUEST_PREFIX = 'mnema-checker-request:1:';

/**
 * The prefix of a request to be enrolled as an AGENT — a key that speaks for the identity under a
 * name. Its own prefix, so a person enrolling a line can tell from it which power it asks for, and a
 * door that expects one kind refuses the other. The line carries the name, because the key's consent
 * covers it (`agent-enroll:<anchor>:<fp>:<name>`).
 */
export const AGENT_REQUEST_PREFIX = 'mnema-agent-request:1:';

/** An agent key's consent to be enrolled in one anchor under one name. */
export interface AgentRequest extends KeyRequest {
  readonly name: string;
}

/** Renders an agent request as the single line a person copies to the machine that vouches. */
export function encodeAgentRequest(request: AgentRequest): string {
  const body = JSON.stringify({
    pub: publicKeyToPem(request.key.publicKey),
    sig: request.reverseSig,
    name: request.name,
  });
  return AGENT_REQUEST_PREFIX + Buffer.from(body, 'utf-8').toString('base64url');
}

/** Reads an agent request back, or null when the text is not one. */
export function decodeAgentRequest(text: string): AgentRequest | null {
  const key = decodeKeyRequest(text, AGENT_REQUEST_PREFIX);
  if (key === null) return null;
  try {
    const trimmed = text.trim();
    const payload = trimmed.slice(AGENT_REQUEST_PREFIX.length).replace(/\s+/g, '');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      name?: unknown;
    };
    if (typeof parsed.name !== 'string' || parsed.name.length === 0) return null;
    return { ...key, name: parsed.name };
  } catch {
    return null;
  }
}

/** A joining key's consent to become a member of one anchor. */
export interface KeyRequest {
  /** The joining key's public half, bound to its own fingerprint. */
  readonly key: PublicHalf;
  /** The joining key's signature over `enroll:<anchor>:<fp>`, hex. */
  readonly reverseSig: string;
}

/** Renders a request as the single line a person copies between machines. */
export function encodeKeyRequest(request: KeyRequest, prefix = REQUEST_PREFIX): string {
  const body = JSON.stringify({
    pub: publicKeyToPem(request.key.publicKey),
    sig: request.reverseSig,
  });
  return prefix + Buffer.from(body, 'utf-8').toString('base64url');
}

/**
 * Reads a request back, or null when the text is not one.
 *
 * Whitespace inside the payload is dropped before decoding, because a request
 * that travelled through a terminal or a chat window may come back wrapped across
 * lines; base64url has no whitespace of its own, so nothing meaningful is lost.
 * The fingerprint is derived from the public key here — the only place it is ever
 * decided — so the rest of the flow cannot be handed a key under a name that is
 * not its own.
 */
export function decodeKeyRequest(text: string, prefix = REQUEST_PREFIX): KeyRequest | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const payload = trimmed.slice(prefix.length).replace(/\s+/g, '');
  if (payload.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const pub = record.pub;
  const sig = record.sig;
  if (typeof pub !== 'string' || typeof sig !== 'string' || sig.length === 0) return null;

  let publicKey: PublicHalf['publicKey'];
  try {
    publicKey = publicKeyFromPem(pub);
  } catch {
    return null;
  }
  return { key: { publicKey, fingerprint: fingerprintOf(publicKey) }, reverseSig: sig };
}

/** What making a request needs. Paths are absolute — the surface resolves them. */
export interface RequestInput {
  /** The identity to join: the anchor of the machine that will vouch. */
  readonly anchor: string;
  /** The key root this machine signs from. */
  readonly keyRoot: string;
  /**
   * Sign the request with the private key in this file INSTEAD of the machine's
   * own. The file is read, never installed: a second private key at the key root
   * would make WHICH key the machine speaks as depend on directory order.
   */
  readonly privateKeyPath?: string;
  /**
   * Ask to be enrolled as a CHECKER of the identity `anchor` names — to sign check results
   * under this key's own anchor, and nothing else — instead of to join it. The consent is
   * over `check-enroll:<anchor>:<fp>` and the line carries {@link CHECKER_REQUEST_PREFIX}.
   */
  readonly asChecker?: boolean;
}

/** Which key a request speaks for. */
export type RequestSource =
  /** This machine's own signing key, loaded (or minted) at the key root. */
  | 'machine'
  /** A private key read from a file — a copy the person holds, left where it was. */
  | 'file';

/** A request was produced; nothing is a member yet. */
export interface RequestOk {
  readonly ok: true;
  /** The joining key's fingerprint, derived from the key itself. */
  readonly fingerprint: string;
  /** The anchor the request consents to join — and only that one. */
  readonly anchor: string;
  /** The one line to hand to a machine that is already a member. */
  readonly request: string;
  readonly source: RequestSource;
  /** Whether this call created the machine's signing key (its first use). */
  readonly minted: boolean;
}

/** Why no request was produced. */
export type RequestErrorCode =
  /** The anchor is not an identity id, so a request for it could never be used. */
  | 'INVALID_ANCHOR'
  /** The named file is missing, unreadable, or not a private key. */
  | 'UNREADABLE_KEY';

/** The request was refused; nothing was written. */
export interface RequestErr {
  readonly ok: false;
  readonly code: RequestErrorCode;
  /** Plain-language reason, to be reported to the person as-is. */
  readonly message: string;
}

/**
 * Produces this machine's request to join an identity.
 *
 * The anchor is REQUIRED and never guessed. A shared repository holds as many
 * identities as it has contributors, and the machine joins the one belonging to
 * its person — which no local material can tell it. So the person names it, and a
 * value that is not an identity id is refused here rather than becoming a request
 * that could only ever be rejected on arrival.
 *
 * What this writes is at most the machine's own key pair, on first use: with no
 * key at the key root there is nothing to ask with, so one is minted exactly as a
 * first write would mint it. It records NO anchor. A machine that recorded the
 * anchor it merely asked for would start signing as an identity no member has
 * vouched for yet, and every such event would fail verification — membership is
 * granted by the record, not by asking. The machine learns it was accepted by
 * reading the record (see the adoption in the identity operations).
 *
 * With `privateKeyPath` the request speaks for the key in that file instead. That
 * is what makes a request possible when the key root holds the WRONG key — a
 * machine that lost its key, minted another, and now needs to ask on behalf of the
 * cold copy it still has. The file is read and left exactly where it was.
 */
export function requestEnrollment(input: RequestInput): RequestOk | RequestErr {
  if (!isAnchorId(input.anchor)) {
    return {
      ok: false,
      code: 'INVALID_ANCHOR',
      message:
        `"${oneLine(input.anchor)}" is not an identity id — an identity looks like ` +
        `${ANCHOR_PREFIX}<64 hex>, as printed when a project is founded`,
    };
  }

  const keyRoot = { root: input.keyRoot };
  let keyPair: KeyPair;
  let source: RequestSource;
  let minted = false;
  if (input.privateKeyPath !== undefined) {
    const fromFile = readKeyPair(input.privateKeyPath);
    if (fromFile === null) {
      return {
        ok: false,
        code: 'UNREADABLE_KEY',
        message: `${oneLine(input.privateKeyPath)} could not be read as a private key`,
      };
    }
    keyPair = fromFile;
    source = 'file';
  } else {
    const before = listPrivateKeyFingerprints(keyRoot);
    keyPair = loadOrCreateKeyPair(keyRoot);
    minted = !before.includes(keyPair.fingerprint);
    source = 'machine';
  }

  const asChecker = input.asChecker === true;
  const message = asChecker
    ? checkerEnrollmentMessage(input.anchor, keyPair.fingerprint)
    : enrollmentMessage(input.anchor, keyPair.fingerprint);
  const reverseSig = Buffer.from(sign(message, keyPair.privateKey)).toString('hex');

  return {
    ok: true,
    fingerprint: keyPair.fingerprint,
    anchor: input.anchor,
    request: encodeKeyRequest(
      { key: keyPair, reverseSig },
      asChecker ? CHECKER_REQUEST_PREFIX : REQUEST_PREFIX,
    ),
    source,
    minted,
  };
}

/** What making an agent's request needs. Paths are absolute — the surface resolves them. */
export interface AgentRequestInput {
  /** The identity the agent is for: the anchor of the person who will vouch. */
  readonly anchor: string;
  /** The name the agent is enrolled under (see {@link agentNameRefusal}). */
  readonly name: string;
  /** The agent's own key root: `<data directory>/agents/<name>`, never the person's. */
  readonly keyRoot: string;
  /** Speak for the key in this file instead of the one at the agent's key root (read, never installed). */
  readonly privateKeyPath?: string;
}

/** An agent's request was produced; nothing is enrolled yet. */
export interface AgentRequestOk {
  readonly ok: true;
  readonly fingerprint: string;
  readonly anchor: string;
  readonly name: string;
  /** The one line to hand to a member of that identity, who runs `mnema key enroll --agent`. */
  readonly request: string;
  readonly source: RequestSource;
  /** Whether this call created the agent's key (its first use). */
  readonly minted: boolean;
}

/** Why no agent request was produced. */
export type AgentRequestErr =
  | RequestErr
  | { readonly ok: false; readonly code: 'BAD_AGENT_NAME'; readonly message: string };

/**
 * Produces an agent key's request to be enrolled in an identity under a name.
 *
 * The key is made at the agent's own key root, IN THE CLEAR — the agent's host has no terminal to
 * ask a passphrase at, and a key that needs one is a key the host cannot sign with — and is never
 * installed at the person's key root, where a second key would make WHICH key the person speaks as
 * depend on directory order. As for a person's request, the anchor is required and never guessed,
 * and nothing is recorded: the agent signs nothing until a member vouches for it.
 */
export function requestAgentEnrollment(input: AgentRequestInput): AgentRequestOk | AgentRequestErr {
  const unnamed = agentNameRefusal(input.name);
  if (unnamed !== undefined) return { ok: false, code: 'BAD_AGENT_NAME', message: unnamed };
  if (!isAnchorId(input.anchor)) {
    return {
      ok: false,
      code: 'INVALID_ANCHOR',
      message:
        `"${oneLine(input.anchor)}" is not an identity id — an identity looks like ` +
        `${ANCHOR_PREFIX}<64 hex>, as printed when a project is founded`,
    };
  }
  const keyRoot = { root: input.keyRoot };
  let keyPair: KeyPair;
  let source: RequestSource;
  let minted = false;
  if (input.privateKeyPath !== undefined) {
    const fromFile = readKeyPair(input.privateKeyPath);
    if (fromFile === null) {
      return {
        ok: false,
        code: 'UNREADABLE_KEY',
        message: `${oneLine(input.privateKeyPath)} could not be read as a private key`,
      };
    }
    keyPair = fromFile;
    source = 'file';
  } else {
    const before = listPrivateKeyFingerprints(keyRoot);
    keyPair = loadOrCreateKeyPair(keyRoot);
    minted = !before.includes(keyPair.fingerprint);
    source = 'machine';
  }
  const reverseSig = Buffer.from(
    sign(agentEnrollmentMessage(input.anchor, keyPair.fingerprint, input.name), keyPair.privateKey),
  ).toString('hex');
  return {
    ok: true,
    fingerprint: keyPair.fingerprint,
    anchor: input.anchor,
    name: input.name,
    request: encodeAgentRequest({ key: keyPair, reverseSig, name: input.name }),
    source,
    minted,
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
    // A key that is protected and cannot be opened is a REFUSAL with its own words, not "not a
    // private key": the file is one, and the way on is the passphrase.
    if (error instanceof CodedError) throw error;
    return null;
  }
}
