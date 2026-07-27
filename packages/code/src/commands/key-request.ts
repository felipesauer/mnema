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
 * founding a project prints, and what `mnema accountability` lists.
 *
 * It needs no project. Nothing about a request is per-tree — it is a key and a
 * signature over fixed values — so it works from a fresh clone, an empty
 * directory, or a machine that has never run `mnema init`. What it may touch is
 * the key root, and only to mint this machine's key on first use.
 *
 * A thin adapter: it resolves the key root, turns a path the person typed into an
 * absolute one, and calls ONE core operation.
 */

import { resolve } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { type RequestSource, requestEnrollment } from '@mnema/core/write';

/** What the request needs — injected so it is testable. */
export interface KeyRequestContext {
  /** The working directory: what a relative `--key` path is relative to. */
  readonly cwd: string;
  /** The discovery environment (XDG/home), for the key root. */
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
  input: { anchor: string; privateKeyPath?: string },
): KeyRequestMade | KeyRequestRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const made = requestEnrollment({
    anchor: input.anchor,
    keyRoot: trees.keyRoot,
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
