/**
 * Whether the key this machine's person signs with is a file anyone who can read the home can use.
 *
 * It is what an agent key's separation depends on: the agent's shell reads every file of the same
 * user, so the person's key keeps the agent from signing as the person only when it is encrypted
 * and the passphrase is in no environment the host inherits (`mnema key protect`). A person's key
 * in the clear makes the agent key a label and nothing more, and the verbs and `mnema doctor` say
 * so where it matters.
 */

import { readFileSync } from 'node:fs';
import { isProtected, localKeyFingerprint, privateKeyPath } from '@mnema/chain';

/**
 * `true` when the person's signing key is on disk unencrypted, `false` when it is protected, and
 * `undefined` when this machine holds none — nothing to protect, and nothing to say. Reads the
 * file's first bytes only to tell which, never to open it: no passphrase is asked.
 */
export function personsKeyInTheClear(keyRoot: string): boolean | undefined {
  const layout = { root: keyRoot };
  const fingerprint = localKeyFingerprint(layout);
  if (fingerprint === null) return undefined;
  try {
    return !isProtected(readFileSync(privateKeyPath(layout, fingerprint), 'utf-8'));
  } catch {
    return undefined;
  }
}

/** The sentence both the verb and the doctor say when it is. */
export const THE_AGENT_KEY_SEPARATES_NOTHING =
  'the agent key separates nothing while your own key is in the clear: anything that can read your home can sign as you — run `mnema key protect`, and keep MNEMA_KEY_PASSPHRASE out of the environment the agent host inherits';
