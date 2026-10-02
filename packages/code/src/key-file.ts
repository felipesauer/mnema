/**
 * Where this machine keeps a key file, said with the setting that put it there.
 *
 * WHY THE SETTING IS SAID. The key root lives in the data directory, which is `$MNEMA_HOME` when
 * it is set and `~/.mnema` when it is not (`core/src/topology/resolve.ts`), so the same key file
 * sits under two different directories depending on one variable. Four places print the path — `key revoke` when it
 * retires this machine's own key, `init` and every other write when the checkout's identity no
 * longer counts the key, and the agent's server for the same refusal — and none said which of
 * the two it was. A person told to `mnema key restore "<the key file>"`, or holding a key under a
 * root this process was not started with, could not tell from the words that the answer is the
 * variable: a key kept under another root signs when `MNEMA_HOME` names it.
 *
 * ONE FUNCTION, FOUR CALLERS, so the sentence cannot be worded two ways; `key-file.test.ts`
 * holds the two readings, and the callers are found by the phrase.
 *
 * THE AGENT'S SERVER IS THE FIFTH READER AND IT GETS ANOTHER SENTENCE ({@link
 * keyFileLineForAModel}). The sentence above is for somebody who is going to type
 * `mnema key restore "<the key file>"`, and it carries the absolute path of a file in a home
 * directory — which, in a reply to an agent, is a path that leaves the machine for a provider.
 * A model cannot restore a key and has no use for where it lives; what it can do is tell the
 * person which file to look for, and a name and a variable say that.
 */

import { oneLine } from './one-line.js';

/**
 * The line: `this machine keeps the key file at <path>`, then the root it is under and why.
 *
 * `mnemaHome` is `$MNEMA_HOME` as the process has it; empty is unset, as the resolver reads it.
 */
export function keyFileLine(keyFile: string, mnemaHome: string | undefined): string {
  const where =
    mnemaHome !== undefined && mnemaHome !== ''
      ? `under ${oneLine(mnemaHome)}, the directory MNEMA_HOME names`
      : 'under ~/.mnema, since MNEMA_HOME is not set — a key kept under another directory ' +
        'signs when MNEMA_HOME names that directory';
  return `this machine keeps the key file at ${oneLine(keyFile)}, ${where}`;
}

/**
 * The same fact for a reader that is a MODEL: which key file, and under what — no absolute path.
 *
 * `fingerprint` is the file's name without its extension and `mnemaHome` is read as above. The
 * path of a key file names the person's home directory and the layout of their machine, and
 * nothing a model does with this sentence needs either: the person it relays this to has the
 * variable, or the default, and the fingerprint is how they find the file. `the-checkout-a-key-
 * left.test.ts` holds that the reply names the file and carries no path.
 */
export function keyFileLineForAModel(fingerprint: string, mnemaHome: string | undefined): string {
  const where =
    mnemaHome !== undefined && mnemaHome !== ''
      ? 'under the directory MNEMA_HOME names'
      : 'under ~/.mnema, since MNEMA_HOME is not set';
  return `this machine keeps the key file ${oneLine(fingerprint)}.key in identity/keys ${where}`;
}
