/**
 * `mnema record merge-tail`: the merge driver git calls for a tail's files, and the one rule it
 * and `mnema record pull` share.
 *
 * A TAIL ONLY GROWS. Its segments and its `checkpoints.jsonl` are appended to and never rewritten
 * (FORMAT.md section 4), so two copies of one tail file that came from one writer are one the start
 * of the other, byte for byte, and the longer one holds everything the shorter one does. A merge of
 * the two is then the longer one, as it is: {@link joinGrownTail} answers that side, and the driver
 * writes its bytes and nothing else (`record-merge-tail.test.ts`, "keeps the longer side").
 *
 * TWO COPIES THAT EACH HOLD A LINE THE OTHER LACKS ARE A FORK: one tail written from one head in
 * two places. Both readers refuse a file that holds both sides (FORMAT.md section 3, "a merge that
 * kept both sides"), and they would refuse the conflict markers git's text merge writes too. So the
 * driver never joins them: it leaves our side as it was, byte for byte, which still verifies as it
 * did, exits 1 so git marks the file conflicted, and says it is a fork and the line where the two
 * sides part (`record-merge-tail.test.ts`, "a divergence is a fork").
 *
 * THE ANCESTOR IS NOT READ. Git hands it (`%O`), and the rule does not need it: which side is the
 * start of the other is a property of the two sides alone, and is the same whichever of them git
 * calls ours (a rebase swaps them).
 *
 * Git finds the driver through the `merge=mnema-tail` attribute the record's own `.gitattributes`
 * carries (`ensureTree`, `@mnema/chain`) and the `merge.mnema-tail.driver` setting, which mnema
 * writes only when a person asks (`mnema doctor --fix merge-driver`) and otherwise hands to one git
 * command at a time (`mnema record pull`). Where the setting is absent git merges the file as text.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { TAIL_MERGE_DRIVER } from '@mnema/chain';
import { oneLine } from '../one-line.js';

/** The name of the driver, in the attribute (`merge=mnema-tail`) and in git's configuration. */
export const MERGE_DRIVER = TAIL_MERGE_DRIVER;

/** How two copies of one tail file stand to each other. */
export type Joined =
  | { readonly kind: 'same' }
  /** One is the start of the other: `side` is the longer, whose bytes are the merge. */
  | { readonly kind: 'longer'; readonly side: 'ours' | 'theirs' }
  /**
   * Each holds bytes the other lacks. `line` is the 1-based line, the same in both, where they
   * first differ.
   */
  | { readonly kind: 'fork'; readonly line: number };

/** The one rule: which of two copies of a tail file is the merge of both, if either is. */
export function joinGrownTail(ours: Uint8Array, theirs: Uint8Array): Joined {
  const shorter = Math.min(ours.length, theirs.length);
  let at = 0;
  while (at < shorter && ours[at] === theirs[at]) at++;
  if (at === shorter) {
    if (ours.length === theirs.length) return { kind: 'same' };
    return { kind: 'longer', side: ours.length > theirs.length ? 'ours' : 'theirs' };
  }
  let line = 1;
  for (let i = 0; i < at; i++) if (ours[i] === 0x0a) line++;
  return { kind: 'fork', line };
}

/** What the driver did with the file git handed it as ours. */
export type MergeTailDone =
  | { readonly ok: true; readonly kept: 'ours' | 'theirs' }
  | { readonly ok: false; readonly reason: 'FORK'; readonly line: number };

/**
 * The driver: `ours` is the file git reads the merge from, `theirs` the other side. Writes the
 * longer side into `ours` when that is theirs; on a fork writes nothing.
 */
export function mergeTailFiles(paths: {
  readonly ours: string;
  readonly theirs: string;
}): MergeTailDone {
  const ours = readFileSync(paths.ours);
  const theirs = readFileSync(paths.theirs);
  const joined = joinGrownTail(ours, theirs);
  if (joined.kind === 'fork') return { ok: false, reason: 'FORK', line: joined.line };
  if (joined.kind === 'longer' && joined.side === 'theirs') {
    writeFileSync(paths.ours, theirs);
    return { ok: true, kept: 'theirs' };
  }
  return { ok: true, kept: 'ours' };
}

/** The sentence a fork is said in, by the driver and by `record pull` alike. */
export function forkSentence(path: string, line: number): string {
  return `${oneLine(path)}: the two sides part at line ${line}, and each holds lines the other lacks: that is a fork of one tail, which both readers refuse when one file holds both sides, so it is not joined; our side is left as it was.`;
}
