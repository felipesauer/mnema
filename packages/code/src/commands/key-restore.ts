/**
 * `mnema key restore <file>` — bring this identity back onto a machine from a
 * copy of a key's private half.
 *
 * The command a person runs after the one loss mnema cannot undo: the signing key
 * is gone, and what they still have is the cold copy `mnema init` told them to
 * move off the machine. There is no service to ask — an entity able to hand an
 * identity back could forge one — so recovery is local and offline: one file they
 * kept, plus the committed record, which carries the proof that the key is a
 * member.
 *
 * A thin adapter, like every other: it resolves the project from the cwd, turns
 * the path the person typed into an absolute one, and calls ONE core operation.
 * Every judgement — is this a private key, is another key already installed, does
 * this record prove membership — belongs to the core and reaches the person as the
 * core worded it.
 *
 * Scope is the project's PUBLIC tree, and only it. That is where the proof of
 * membership lives (a committed tree survives the disk that died), and it is the
 * only tree an enrollment reaches — the private and global trees are born knowing
 * one key, so there is nothing there for a restored key to be a member of.
 */

import { resolve } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { type RestoredMembership, restoreKey } from '@mnema/core/write';

/** What the restore needs — injected so it is testable. */
export interface KeyRestoreContext {
  /** The working directory: the project it resolves, and what a relative path is relative to. */
  readonly cwd: string;
  /** The discovery environment (XDG/home), for the key root and the tree paths. */
  readonly env: DiscoveryEnv;
}

/** The key was installed and now speaks for the identity this project proves. */
export interface KeyRestored {
  readonly ok: true;
  /** The restored key's fingerprint, re-derived from the private half. */
  readonly fingerprint: string;
  /** The anchor this machine now signs as in this project. */
  readonly anchor: string;
  /** How this project proves the key belongs to that anchor. */
  readonly membership: RestoredMembership;
  /** Where the private half was installed — a copy; the file given is untouched. */
  readonly installedAt: string;
  /** The project tree that proved the membership and adopted the key. */
  readonly root: string;
}

/** The restore was refused; nothing was written. */
export type KeyRestoreRefused =
  /** There is no project here — the proof of membership lives in one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core refused: unreadable key, a key already present, no membership. */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Restores a key into the current project. With no project found from the cwd it
 * refuses `NO_PROJECT`: the anchor is read from a project's committed record, and
 * the case this exists for is a fresh clone of the team's repo with the vault copy
 * in hand — outside a project there is nothing to prove membership against and
 * nothing to adopt.
 *
 * The path is resolved against the injected cwd, so a relative path means what the
 * person typed it to mean without the core ever depending on the process's own
 * working directory.
 */
export function runKeyRestore(
  ctx: KeyRestoreContext,
  input: { privateKeyPath: string },
): KeyRestored | KeyRestoreRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const restored = restoreKey({
    privateKeyPath: resolve(ctx.cwd, input.privateKeyPath),
    keyRoot: trees.keyRoot,
    tree: trees.projectPublic,
    upcasters: catalogUpcasters(),
  });
  if (!restored.ok) {
    return { ok: false, reason: 'REFUSED', code: restored.code, message: restored.message };
  }

  return {
    ok: true,
    fingerprint: restored.fingerprint,
    anchor: restored.anchor,
    membership: restored.membership,
    installedAt: restored.installedAt,
    root: trees.projectPublic,
  };
}
