/**
 * `mnema key github <name>` — record that this machine's identity is that GitHub account.
 *
 * It writes one signed claim (`account.linked`) and asks nothing of github.com: whether the
 * account agrees is the question `mnema verify --against-github` asks, at the time it is asked,
 * against the keys the account publishes then. Writing the claim needs no network and proves
 * no more than that a member key of this identity made it.
 *
 * Scope is the project's PUBLIC tree, for the reason an enrolment's is: the claim has to be
 * where the other machines and a stranger verifying the record read it.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  githubLoginRefusal,
  resolveTrees,
} from '@mnema/core';
import { linkAccount, openTreeForWriting } from '@mnema/core/write';
import { forwardReplacement, type Replacement } from '../recorded-content.js';

/** What the link needs — injected so it is testable. */
export interface KeyGithubContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`), for the key root and the tree paths. */
  readonly env: DiscoveryEnv;
}

/** The claim was recorded. */
export interface KeyGithubLinked extends Replacement {
  readonly ok: true;
  /** The identity that named the account. */
  readonly anchor: string;
  /** The account, as recorded. */
  readonly account: string;
}

/** The claim was refused; nothing was written. */
export type KeyGithubRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/** Records that this machine's identity is the GitHub account `account`. */
export function runKeyGithub(
  ctx: KeyGithubContext,
  input: { account: string },
): KeyGithubLinked | KeyGithubRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  // Asked before the writer opens, because opening one touches the tree: a refused name
  // leaves it as it was. The operation asks again, and is its own door.
  const notAName = githubLoginRefusal(input.account);
  if (notAName !== undefined) {
    return { ok: false, reason: 'REFUSED', code: 'NOT_A_GITHUB_ACCOUNT', message: notAName };
  }
  const writer = openTreeForWriting(trees, 'public');
  const linked = writer.exclusively(() => {
    const written = linkAccount(
      {
        writer,
        layout: { root: chainRootForScope(trees, 'public') as string },
        upcasters: catalogUpcasters(),
      },
      { account: input.account },
    );
    // The claim signs its own checkpoint, so this only covers a founding the operation made.
    if (written.ok) writer.checkpoint();
    return written;
  });
  if (!linked.ok) {
    return { ok: false, reason: 'REFUSED', code: linked.code, message: linked.message };
  }
  return {
    ok: true,
    anchor: linked.anchor,
    account: linked.account,
    ...forwardReplacement(linked),
  };
}
