/**
 * `mnema key protect` and `mnema key unprotect` — put a passphrase on this machine's private
 * keys at rest, or take it off.
 *
 * WHAT THEY TOUCH is the key files under the key root and nothing else: no event is written, no
 * tree is opened, no project is needed, and the record, the checkpoints and the public halves are
 * as they were. The mechanism and what it does and does not protect are `key-protection.ts`'s in
 * the chain; this file is the two verbs over it.
 *
 * THE PASSPHRASE IS READ FROM THE ENVIRONMENT (`MNEMA_KEY_PASSPHRASE`) AND NOT FROM A FLAG, an
 * argument or a prompt. A flag is in `ps` and in the shell's history; a prompt cannot be answered
 * by the agent's server or a hook, which have to be given the same passphrase to sign at all, and
 * a verb that took it a different way from the signing it enables would be two places that must
 * agree. Both verbs read it where signing reads it.
 */

import {
  CodedError,
  type KeyFileChange,
  NoPassphraseToProtectWithError,
  passphraseToOpen,
  passphraseToProtectWith,
  protectPrivateKeys,
  unprotectPrivateKeys,
} from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';

/** Where the verbs run: only the discovery environment decides the key root. */
export interface KeyProtectContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** The files looked at, and which of them changed. */
export interface KeyFilesChanged {
  readonly ok: true;
  readonly files: readonly KeyFileChange[];
}

/** The verb was refused, with the code and words of the chain's own refusal. */
export interface KeyProtectRefused {
  readonly ok: false;
  readonly reason: 'REFUSED';
  readonly code: string;
  readonly message: string;
}

/** Encrypts every private key file under this machine's key root. */
export function runKeyProtect(ctx: KeyProtectContext): KeyFilesChanged | KeyProtectRefused {
  return refusing(() => {
    const passphrase = passphraseToProtectWith();
    if (passphrase === undefined) throw new NoPassphraseToProtectWithError();
    return protectPrivateKeys({ root: resolveTrees(ctx.cwd, ctx.env).keyRoot }, passphrase);
  });
}

/** Writes every protected private key file under this machine's key root back in the clear. */
export function runKeyUnprotect(ctx: KeyProtectContext): KeyFilesChanged | KeyProtectRefused {
  return refusing(() => {
    const keyRoot = { root: resolveTrees(ctx.cwd, ctx.env).keyRoot };
    // No passphrase is not an error until a file needs one: an unprotected machine is told that
    // nothing changed, which is also what a second `unprotect` is.
    return unprotectPrivateKeys(keyRoot, passphraseToOpen(keyRoot.root) ?? '');
  });
}

function refusing(act: () => readonly KeyFileChange[]): KeyFilesChanged | KeyProtectRefused {
  try {
    return { ok: true, files: act() };
  } catch (error) {
    if (!(error instanceof CodedError)) throw error;
    return { ok: false, reason: 'REFUSED', code: error.code, message: error.message };
  }
}
