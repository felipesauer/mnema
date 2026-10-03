/**
 * `mnema rules-file --host <host>` — the committed rules that have an address, printed in the file
 * format another host reads its own rules from, for the addresses that become a glob exactly.
 *
 * It prints and writes nothing: the file is the person's, and `>` is how it gets written — with
 * the `>` replacing the whole of the file it names, which the command says. What translated goes
 * to stdout; what did not, and why, goes to the second stream in the same run, so a redirect keeps
 * the file clean and the person still reads what was left out. The translation is
 * `host-rules-file.ts`; the reading is the push's own (`governsInForceEverywhere`), so a rule in
 * the file is a rule the per-edit push would hand over at a file under its address.
 *
 * A read in the strict sense: caches brought forward from the ones the trees keep
 * (`CacheOptions.persist`), one `stat` per address, no writer.
 */

import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { readGovernsInForceEverywhere } from '../governed-tree.js';
import type { RulesFileHost } from '../host-names.js';
import { type AddressedForAFile, globFor, type OnDisk, rulesFileText } from '../host-rules-file.js';
import {
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';

/** What the command needs — injected so it is testable. */
export interface RulesFileContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** One rule the file does not carry, and why — the address as the record compared it. */
export interface LeftOut {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly why: string;
}

/** The file's text, or nothing when no address translated, and every address left out. */
export interface RulesFileDone {
  readonly ok: true;
  readonly text?: string;
  readonly carried: number;
  readonly leftOut: readonly LeftOut[];
  /**
   * The tails among those read that do not chain — empty for a sound record. What the file
   * carries came off a record whose proof this is the state of, and the wiring says so on the
   * second stream, where a redirect leaves the file clean.
   */
  readonly linkBreaks: readonly ScopedLinkBreak[];
}

/** The command was refused before it read anything. */
export type RulesFileRefused = { readonly ok: false; readonly reason: 'NO_PROJECT' };

/** What the working tree holds at a project-relative address. */
function onDisk(root: string, address: string): OnDisk {
  try {
    return statSync(join(root, address)).isDirectory() ? 'directory' : 'file';
  } catch {
    return 'absent';
  }
}

/** Composes the file for `host` out of this project's addressed rules. */
export function runRulesFile(
  ctx: RulesFileContext,
  input: { readonly host: RulesFileHost },
): RulesFileDone | RulesFileRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const root = dirname(trees.projectPublic);
  const { addressed, linkBreaks } = withScopedCaches(trees, (sources) => ({
    linkBreaks: linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE),
    addressed: readGovernsInForceEverywhere(sources, root).map(
      (one): AddressedForAFile => ({
        ...one,
        onDisk: one.inProject ? onDisk(root, one.rule.address) : 'absent',
      }),
    ),
  }));
  const translated: { readonly rule: AddressedForAFile['rule']; readonly glob: string }[] = [];
  const leftOut: LeftOut[] = [];
  for (const one of addressed) {
    const glob = globFor(one);
    if ('glob' in glob) {
      translated.push({ rule: one.rule, glob: glob.glob });
      continue;
    }
    leftOut.push({
      id: one.rule.id,
      name: one.rule.name,
      address: one.rule.address,
      why: glob.why,
    });
  }
  const text = rulesFileText(input.host, translated);
  return {
    ok: true,
    ...(text !== undefined ? { text } : {}),
    carried: translated.length,
    leftOut,
    linkBreaks,
  };
}
