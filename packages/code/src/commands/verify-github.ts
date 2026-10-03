/**
 * `mnema verify --against-github` — whether the keys that signed this record are keys the
 * GitHub accounts its identities name publish today.
 *
 * WHAT IT ADDS. A signature proves which key made it, and the enrolment fold proves the key
 * was a member of the identity it spoke for. Neither says who the identity IS: a record founded
 * again with a new key verifies like an honest one. This reading ties an identity to an account
 * somebody can look up. The identity names its account in a signed fact (`account.linked`,
 * written by `mnema key github <name>`); the account publishes its SSH keys at
 * `https://github.com/<name>.keys`; and where the key that signed is among them, both sides
 * said the same thing — the key's holder said "I am this account", and the account said "this
 * key is mine".
 *
 * WHAT IT DOES NOT PROVE, said wherever the answer is printed: that the key was the account's
 * WHEN it signed — the keys are read today, and an account can add or drop a key at any time —
 * and anything at all without taking github.com's word for which keys an account has.
 *
 * IT CHANGES NOTHING ABOUT THE VERDICT. It runs only when asked, after the verification, over
 * the trees that verified; its answer is a set of notes and never moves the level or the exit.
 * An author with no account, an account with no Ed25519 key, a key the account does not
 * publish, and a github.com that could not be reached are each said by name, as NOT COVERED —
 * the posture the external witness already takes.
 *
 * WHAT IS READ, AND WHY ONLY THE SIGNED PART. An author is the identity (`who`) of an event a
 * verified checkpoint covers, and its keys are the keys (`signerFp`) that signed those events.
 * A link counts only when its `who` is its `subject` (an identity names only its own account)
 * and it is covered too: above the last checkpoint an event rests on the hash chain alone, and
 * a party holding no key could append a link there naming an account of their own, on which
 * they had published this identity's public key — the one forgery this reading could be made
 * to say yes to. A later covered link for the same identity replaces an earlier one, in the
 * order the record is merged in (`at`, then the tail, then `seq`).
 *
 * THE COMPARISON IS BY THE RAW 32-BYTE KEY. A committed key is a PEM `spki`; a published one is
 * an OpenSSH line, `ssh-ed25519 <base64 of the wire blob> [comment]`. Each is decoded to the 32
 * bytes of the Ed25519 point and those are compared — never a fingerprint of one format against
 * the other. Other key types, and security-key `sk-ssh-ed25519` lines (a different key, held in
 * a device), are not a key this record can be signed with and are skipped.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { catalogUpcasters, publicKeyFromPem, publicKeyPath, readTailEntries } from '@mnema/chain';
import { GITHUB_SERVICE, githubLoginRefusal, type Scope } from '@mnema/core';
import type { TreeReport } from './verify.js';

/** How long one account's keys are waited for before github.com is called unreachable. */
export const GITHUB_KEYS_TIMEOUT_MS = 5_000;

/** The part of a `fetch` response this reading uses. */
export interface KeysResponse {
  readonly status: number;
  text(): Promise<string>;
}

/** How an account's keys are fetched — `fetch`, handed in so no test goes to the network. */
export type FetchKeys = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<KeysResponse>;

/** What was found for one author. */
export type GithubFinding =
  /** The record holds no covered link from this identity to a GitHub account. */
  | { readonly kind: 'no-account' }
  /** The linked name is not one GitHub issues, so no address was built from it. */
  | { readonly kind: 'not-an-account'; readonly account: string }
  /** github.com answered that there is no such account. */
  | { readonly kind: 'no-such-account'; readonly account: string }
  /** The account publishes no Ed25519 key, so there is nothing to compare with. */
  | { readonly kind: 'no-ed25519-key'; readonly account: string }
  /** github.com did not answer, or answered something other than the keys. */
  | { readonly kind: 'unreachable'; readonly account: string; readonly detail: string }
  /**
   * The keys were compared: which of the author's keys the account publishes and which it
   * does not. Covered only when `unpublished` is empty.
   */
  | {
      readonly kind: 'compared';
      readonly account: string;
      readonly published: readonly string[];
      readonly unpublished: readonly string[];
    };

/** One identity that signed this record, and what github.com said about it. */
export interface GithubAuthor {
  /** The identity (`mnid:…`). */
  readonly anchor: string;
  /** The fingerprints of the keys it signed this record with, sorted. */
  readonly keys: readonly string[];
  readonly finding: GithubFinding;
}

/** The comparison, over every tree that verified. */
export interface GithubReading {
  readonly authors: readonly GithubAuthor[];
  /** The trees left out because their verdict was a break: who signed them is not settled. */
  readonly notCompared: readonly Scope[];
}

/**
 * The raw 32-byte Ed25519 keys an account's `.keys` text publishes, as lower-case hex.
 *
 * Every line that is not exactly an `ssh-ed25519` wire blob — the type string, then a 32-byte
 * key, and nothing after — is skipped rather than guessed at.
 */
export function ed25519KeysIn(published: string): string[] {
  const keys: string[] = [];
  for (const line of published.split(/\r?\n/)) {
    const [type, blob] = line.trim().split(/\s+/);
    if (type !== 'ssh-ed25519' || blob === undefined) continue;
    const raw = sshEd25519Blob(Buffer.from(blob, 'base64'));
    if (raw !== undefined) keys.push(raw);
  }
  return keys;
}

/** The 32-byte key inside an OpenSSH `ssh-ed25519` wire blob, as hex — or undefined. */
function sshEd25519Blob(wire: Buffer): string | undefined {
  const type = 'ssh-ed25519';
  if (wire.length !== 4 + type.length + 4 + 32) return undefined;
  if (wire.readUInt32BE(0) !== type.length) return undefined;
  if (wire.toString('latin1', 4, 4 + type.length) !== type) return undefined;
  const at = 4 + type.length;
  if (wire.readUInt32BE(at) !== 32) return undefined;
  return wire.subarray(at + 4).toString('hex');
}

/**
 * The raw 32-byte Ed25519 key a committed PEM holds, as hex — undefined when it is not one, or
 * when its fingerprint is not the one it was asked for (a file that does not hold the key it is
 * named after compares as nothing).
 */
export function rawEd25519Of(pem: string, fingerprint?: string): string | undefined {
  try {
    const key = publicKeyFromPem(pem);
    if (key.asymmetricKeyType !== 'ed25519') return undefined;
    const der = key.export({ type: 'spki', format: 'der' });
    if (
      fingerprint !== undefined &&
      createHash('sha256').update(der).digest('hex') !== fingerprint
    ) {
      return undefined;
    }
    const { x } = key.export({ format: 'jwk' });
    if (typeof x !== 'string') return undefined;
    return Buffer.from(x, 'base64url').toString('hex');
  } catch {
    return undefined;
  }
}

/** The `fetch` this reading uses when none is handed in: the platform's, asked at call time. */
const platformFetch: FetchKeys = (url, init) => globalThis.fetch(url, init);

/** A link from the record, with where it sits in the merged order. */
interface Link {
  readonly anchor: string;
  readonly account: string;
  readonly at: string;
  readonly tail: string;
  readonly seq: number;
}

/**
 * Compares the keys that signed each verified tree with the keys the GitHub accounts its
 * identities name publish. Never throws over the network: what github.com did is a finding.
 */
export async function compareWithGithub(
  trees: readonly TreeReport[],
  options: { readonly fetch?: FetchKeys; readonly timeoutMs?: number } = {},
): Promise<GithubReading> {
  const fetchKeys = options.fetch ?? platformFetch;
  const timeoutMs = options.timeoutMs ?? GITHUB_KEYS_TIMEOUT_MS;
  const upcasters = catalogUpcasters();
  /** Each author's keys: fingerprint → raw hex (undefined when the committed file holds none). */
  const authors = new Map<string, Map<string, string | undefined>>();
  const links: Link[] = [];
  const notCompared: Scope[] = [];

  for (const tree of trees) {
    if (tree.kind !== 'verdict') continue;
    if (!tree.result.ok) {
      notCompared.push(tree.scope);
      continue;
    }
    const layout = { root: tree.root };
    for (const tail of tree.result.tails) {
      for (const entry of readTailEntries(layout, tail.tail, upcasters)) {
        if (entry.link.seq > tail.checkpointedThrough) break;
        const event = entry.event;
        let keys = authors.get(event.who);
        if (keys === undefined) {
          keys = new Map();
          authors.set(event.who, keys);
        }
        if (!keys.has(event.signerFp)) {
          keys.set(event.signerFp, committedRaw(layout, event.signerFp));
        }
        if (
          event.kind === 'account.linked' &&
          event.who === event.subject &&
          event.payload.service === GITHUB_SERVICE
        ) {
          links.push({
            anchor: event.who,
            account: event.payload.account,
            at: event.at,
            tail: tail.tail,
            seq: entry.link.seq,
          });
        }
      }
    }
  }

  links.sort(byMergedOrder);
  const accountOf = new Map<string, string>();
  for (const link of links) accountOf.set(link.anchor, link.account);

  const asked = new Map<string, Promise<Published>>();
  const ask = (account: string): Promise<Published> => {
    let answer = asked.get(account);
    if (answer === undefined) {
      answer = publishedKeys(fetchKeys, account, timeoutMs);
      asked.set(account, answer);
    }
    return answer;
  };

  const read = [...authors.entries()]
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(async ([anchor, keys]): Promise<GithubAuthor> => {
      const fingerprints = [...keys.keys()].sort(byCodeUnit);
      const account = accountOf.get(anchor);
      return {
        anchor,
        keys: fingerprints,
        finding: await findingFor(account, keys, fingerprints, ask),
      };
    });
  return { authors: await Promise.all(read), notCompared };
}

/** What github.com answered for one account. */
type Published =
  | { readonly kind: 'keys'; readonly raw: ReadonlySet<string> }
  | { readonly kind: 'no-such-account' }
  | { readonly kind: 'unreachable'; readonly detail: string };

async function findingFor(
  account: string | undefined,
  keys: ReadonlyMap<string, string | undefined>,
  fingerprints: readonly string[],
  ask: (account: string) => Promise<Published>,
): Promise<GithubFinding> {
  if (account === undefined) return { kind: 'no-account' };
  if (githubLoginRefusal(account) !== undefined) return { kind: 'not-an-account', account };
  const answer = await ask(account);
  if (answer.kind === 'no-such-account') return { kind: 'no-such-account', account };
  if (answer.kind === 'unreachable') return { kind: 'unreachable', account, detail: answer.detail };
  if (answer.raw.size === 0) return { kind: 'no-ed25519-key', account };
  const published: string[] = [];
  const unpublished: string[] = [];
  for (const fingerprint of fingerprints) {
    const raw = keys.get(fingerprint);
    if (raw !== undefined && answer.raw.has(raw)) published.push(fingerprint);
    else unpublished.push(fingerprint);
  }
  return { kind: 'compared', account, published, unpublished };
}

/** One account's published Ed25519 keys, or why there are none to compare with. */
async function publishedKeys(
  fetchKeys: FetchKeys,
  account: string,
  timeoutMs: number,
): Promise<Published> {
  try {
    const response = await fetchKeys(`https://github.com/${account}.keys`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 404) return { kind: 'no-such-account' };
    if (response.status !== 200) {
      return { kind: 'unreachable', detail: `github.com answered ${String(response.status)}` };
    }
    return { kind: 'keys', raw: new Set(ed25519KeysIn(await response.text())) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'unreachable', detail };
  }
}

/** The raw key a tree commits for `fingerprint`, or undefined when it commits none. */
function committedRaw(layout: { readonly root: string }, fingerprint: string): string | undefined {
  try {
    return rawEd25519Of(readFileSync(publicKeyPath(layout, fingerprint), 'utf-8'), fingerprint);
  } catch {
    return undefined;
  }
}

/** Two strings by code unit — the order ids and fingerprints are listed in. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The order the record is merged in across tails, OLDEST first: the instant, then the tail id,
 * then `seq` — so the last link of an identity is the one that stands.
 */
function byMergedOrder(a: Link, b: Link): number {
  return byCodeUnit(a.at, b.at) || byCodeUnit(a.tail, b.tail) || a.seq - b.seq;
}
