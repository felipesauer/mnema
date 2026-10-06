/**
 * `mnema key sigstore <identity>` — record that this machine's identity is the one a Sigstore
 * certificate names: an e-mail address, or a GitHub Actions workflow.
 *
 * WHY THE CLAIM IS NEEDED AT ALL. A Sigstore bundle says that whoever could sign in as that
 * e-mail (or run that workflow) countersigned a checkpoint digest — and anybody can compute the
 * digest of any checkpoint of a public repository. So a bundle on its own dates a checkpoint
 * and says nothing about who wrote it. It speaks for a mnema identity only where that identity
 * said, in a signed and covered fact, that the certificate's identity is its own; this writes
 * that fact (`account.linked`, `service: "sigstore"`), and `verify --against-sigstore` reads it.
 *
 * It asks nothing of the network, and it is not a kind of its own: the binary before it reads
 * the fact as it reads a GitHub link, and passes it by.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  resolveTrees,
  SIGSTORE_SERVICE,
  sigstoreIdentityRefusal,
} from '@mnema/core';
import { linkAccount, openTreeForWriting } from '@mnema/core/write';
import { forwardReplacement, type Replacement } from '../recorded-content.js';

/** What the claim needs — injected so it is testable. */
export interface KeySigstoreContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** The claim was recorded. */
export interface KeySigstoreLinked extends Replacement {
  readonly ok: true;
  readonly anchor: string;
  readonly identity: string;
}

/** The claim was refused; nothing was written. */
export type KeySigstoreRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/** Records that this machine's identity is the Sigstore identity `identity`. */
export function runKeySigstore(
  ctx: KeySigstoreContext,
  input: { identity: string },
): KeySigstoreLinked | KeySigstoreRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const notOne = sigstoreIdentityRefusal(input.identity);
  if (notOne !== undefined) {
    return { ok: false, reason: 'REFUSED', code: 'NOT_A_SIGSTORE_IDENTITY', message: notOne };
  }
  const writer = openTreeForWriting(trees, 'public');
  const linked = linkAccount(
    {
      writer,
      layout: { root: chainRootForScope(trees, 'public') as string },
      upcasters: catalogUpcasters(),
    },
    { account: input.identity, service: SIGSTORE_SERVICE },
  );
  if (!linked.ok) {
    return { ok: false, reason: 'REFUSED', code: linked.code, message: linked.message };
  }
  writer.checkpoint();
  return {
    ok: true,
    anchor: linked.anchor,
    identity: linked.account,
    ...forwardReplacement(linked),
  };
}
