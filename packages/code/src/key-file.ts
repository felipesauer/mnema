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
