/**
 * `mnema key request --anchor <id>` — ask to bring this machine into an identity.
 *
 * The first of the three steps that put a second machine on one identity, and the
 * only one that runs on the machine JOINING. It produces the line the person
 * carries to a machine that is already a member: this key's public half, and its
 * signature consenting to join that one identity.
 *
 * The anchor is named by the person because nothing local can name it for them. A
 * shared repository holds one identity per contributor, and this machine joins the
 * one belonging to ITS person — a choice made on their behalf would be a guess
 * about whose record this is. They already see the value they need: it is what
 * founding a project prints, and what `mnema audit accountability` lists.
 *
 * It may be named whole or by a prefix of an identity the record here knows, and
 * the request is always SIGNED over the whole value — a consent to join half an
 * identity is not a thing. A prefix is resolvable only where there is a record to
 * resolve it against, which on a joining machine there may not be; that is exactly
 * why the whole value goes on working with no record at all.
 *
 * It needs no project. Nothing about a request is per-tree — it is a key and a
 * signature over fixed values — so it works from a fresh clone, an empty
 * directory, or a machine that has never run `mnema init`. What it may touch is
 * the key root, and only to mint this machine's key on first use.
 *
 * A thin adapter: it resolves the key root, turns a path the person typed into an
 * absolute one, and calls ONE core operation. For an AGENT's key ({@link runAgentRequest}) the key
 * root is the agent's own folder under the data directory, never the person's.
 */

import type { KeyObject } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { privateKeyPath } from '@mnema/chain';
import {
  agentKeyRoot,
  agentNameRefusal,
  agentRetiredIn,
  type DiscoveryEnv,
  type ResolvedTrees,
  resolveTrees,
  withAgentKey,
} from '@mnema/core';
import {
  decodeAgentRequest,
  type RequestSource,
  requestAgentEnrollment,
  requestEnrollment,
} from '@mnema/core/write';
import { resolveAnchorInRecord } from '../anchors.js';

/** What the request needs — injected so it is testable. */
export interface KeyRequestContext {
  /** The working directory: what a relative `--key` path is relative to. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`), for the key root. */
  readonly env: DiscoveryEnv;
}

/** The request was produced; this machine is not a member yet. */
export interface KeyRequestMade {
  readonly ok: true;
  /** The joining key's fingerprint, derived from the key itself. */
  readonly fingerprint: string;
  /** The identity the request consents to join — and only that one. */
  readonly anchor: string;
  /** The one line to hand to a machine that is already a member. */
  readonly request: string;
  /** Whether it speaks for this machine's key or for one read from a file. */
  readonly source: RequestSource;
  /** Whether this call created this machine's signing key (its first use). */
  readonly minted: boolean;
}

/** The request was refused; nothing was written. */
export interface KeyRequestRefused {
  readonly ok: false;
  readonly reason: 'REFUSED';
  readonly code: string;
  readonly message: string;
}

/**
 * Produces this machine's request to join `anchor`. With `privateKeyPath` the
 * request speaks for the key in that file instead of this machine's own — the path
 * out of a machine that lost its key, minted another, and still holds a cold copy
 * of a key the identity already accepted. The file is read, never installed.
 */
export function runKeyRequest(
  ctx: KeyRequestContext,
  input: { anchor: string; privateKeyPath?: string; asChecker?: boolean },
): KeyRequestMade | KeyRequestRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  // Resolved BEFORE the key root is touched: a value that names no identity must
  // not mint this machine's key on the way to being refused.
  const anchor = resolveAnchorInRecord(trees, input.anchor);
  if (!anchor.ok) {
    return { ok: false, reason: 'REFUSED', code: anchor.code, message: anchor.message };
  }
  // A key file kept in the agents' folder is an agent's: where it lives is all that can be told
  // without opening it, and a copy kept elsewhere is not recognised.
  if (input.privateKeyPath !== undefined) {
    const file = resolve(ctx.cwd, input.privateKeyPath);
    const agents = dirname(agentKeyRoot(ctx.env, 'x'));
    if (file.startsWith(`${agents}${sep}`)) {
      return {
        ok: false,
        reason: 'REFUSED',
        code: 'AN_AGENT_KEY',
        message: `the key file ${file} lives in the folder of the agents' keys, ${agents}: an agent's key signs for its host under a name and is not a key of a person to enrol. This checks where the file lives, not what it holds`,
      };
    }
  }
  const made = requestEnrollment({
    anchor: anchor.anchor,
    keyRoot: trees.keyRoot,
    ...(input.asChecker === true ? { asChecker: true } : {}),
    ...(input.privateKeyPath !== undefined
      ? { privateKeyPath: resolve(ctx.cwd, input.privateKeyPath) }
      : {}),
  });
  if (!made.ok) {
    return { ok: false, reason: 'REFUSED', code: made.code, message: made.message };
  }
  return {
    ok: true,
    fingerprint: made.fingerprint,
    anchor: made.anchor,
    request: made.request,
    source: made.source,
    minted: made.minted,
  };
}

/** An agent's request was produced; nothing is enrolled yet. */
export interface AgentRequestMade extends KeyRequestMade {
  /** The name the agent will be enrolled under. */
  readonly name: string;
  /** The agent's own key root: `<data directory>/agents/<name>`. */
  readonly keyRoot: string;
  /** The file the key is kept in once it is at the agent's key root: `<keyRoot>/keys/<fingerprint>.key`. */
  readonly keyFile: string;
  /**
   * The key the record retired that this request put aside, in `<key root>/retired/`, to make the
   * agent a new one: its fingerprint, and where it went. Absent when nothing was retired.
   */
  readonly rotated?: { readonly retired: string; readonly keptIn: string };
}

/**
 * Produces an agent key's request to be enrolled in `anchor` under `name`: the key is made at the
 * agent's own key root — `<data directory>/agents/<name>`, in the clear, never beside the person's
 * key — and the line carries its public half and its consent to that one name in that one
 * identity. With `privateKeyPath` it speaks for the key in that file instead (read, never
 * installed).
 */
export function runAgentRequest(
  ctx: KeyRequestContext,
  input: { anchor: string; name: string; privateKeyPath?: string },
): AgentRequestMade | KeyRequestRefused {
  const unnamed = agentNameRefusal(input.name);
  if (unnamed !== undefined) {
    return { ok: false, reason: 'REFUSED', code: 'BAD_AGENT_NAME', message: unnamed };
  }
  const trees = resolveTrees(ctx.cwd, ctx.env);
  // Resolved BEFORE the agent's key root is touched, as the person's is: a value that names no
  // identity must not mint a key on the way to being refused.
  const anchor = resolveAnchorInRecord(trees, input.anchor);
  if (!anchor.ok) {
    return { ok: false, reason: 'REFUSED', code: anchor.code, message: anchor.message };
  }
  const keyRoot = agentKeyRoot(ctx.env, input.name);
  // A key the record retired is never enrolled again, so asking for the agent's key again is asking
  // for a new one: the retired key is put aside, not deleted — a key somebody may still hold is
  // evidence — and the folder keeps one live key, which is the one every reader of it adopts.
  const rotated =
    input.privateKeyPath === undefined
      ? setAsideTheRetiredKey(withAgentKey(trees, ctx.env, input.name), keyRoot)
      : undefined;
  const made = requestAgentEnrollment({
    anchor: anchor.anchor,
    name: input.name,
    keyRoot,
    ...(input.privateKeyPath !== undefined
      ? { privateKeyPath: resolve(ctx.cwd, input.privateKeyPath) }
      : {}),
  });
  if (!made.ok) {
    return { ok: false, reason: 'REFUSED', code: made.code, message: made.message };
  }
  // A key read from a file is whatever the file holds, and only an Ed25519 key's consent is one the
  // record proves: said here, before a line that cannot be enrolled is handed to anybody.
  const decoded = decodeAgentRequest(made.request);
  const notAnAgentKey = decoded === null ? undefined : agentKeyAlgorithmRefusal(decoded.key);
  if (notAnAgentKey !== undefined) {
    return { ok: false, reason: 'REFUSED', code: 'UNREADABLE_KEY', message: notAnAgentKey };
  }
  return {
    ok: true,
    fingerprint: made.fingerprint,
    anchor: made.anchor,
    request: made.request,
    source: made.source,
    minted: made.minted,
    name: made.name,
    keyRoot,
    keyFile: privateKeyPath({ root: keyRoot }, made.fingerprint),
    ...(rotated !== undefined ? { rotated } : {}),
  };
}

/** The key types Node names whose name is said starting on a vowel sound: ec, ar-ess-ay, ed, ex. */
const BEGINS_WITH_A_VOWEL_SOUND: ReadonlySet<string> = new Set([
  'ec',
  'rsa',
  'rsa-pss',
  'ed448',
  'x25519',
  'x448',
]);

/**
 * What is wrong with a key that is to be an agent's, or undefined when nothing is: the consent that
 * enrols an agent is proved for an Ed25519 key and no other, so a P-256 or an RSA key would make a
 * line that is printed and then refused.
 */
export function agentKeyAlgorithmRefusal(key: {
  readonly fingerprint: string;
  readonly publicKey: KeyObject;
}): string | undefined {
  const kind = key.publicKey.asymmetricKeyType;
  return kind === 'ed25519'
    ? undefined
    : `the key ${key.fingerprint} is ${kind === undefined ? 'of a kind this does not know' : `${BEGINS_WITH_A_VOWEL_SOUND.has(kind) ? 'an' : 'a'} ${kind === 'ec' || kind === 'rsa' ? kind.toUpperCase() : kind} key`}, and an agent's key is an Ed25519 one — the consent that enrols it is proved for no other kind; \`mnema key request --agent <name> --anchor <your identity>\` without --key makes one`;
}

/**
 * Moves the key the configured agent holds on this machine out of `keys/` into `retired/`, when a
 * tree this process reaches retired it, and says where it went.
 */
function setAsideTheRetiredKey(
  trees: ResolvedTrees,
  keyRoot: string,
): { readonly retired: string; readonly keptIn: string } | undefined {
  const retired = agentRetiredIn(trees);
  if (retired === undefined) return undefined;
  const from = dirname(privateKeyPath({ root: keyRoot }, retired.fingerprint));
  const keptIn = join(keyRoot, 'retired');
  mkdirSync(keptIn, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.startsWith(`${retired.fingerprint}.`))
      renameSync(join(from, name), join(keptIn, name));
  }
  return { retired: retired.fingerprint, keptIn };
}
