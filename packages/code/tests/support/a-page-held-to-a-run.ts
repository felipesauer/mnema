/**
 * A PAGE HELD TO A RUN — the two readings every case shares that holds what a page or a
 * recording shows to a run of the binary today.
 *
 * WHY THIS FILE EXISTS AS A FILE. Both were written inside
 * `the-first-record-a-page-shows-is-the-one-printed.test.ts`, the first case that held a page's
 * `#>` lines to the binary. The front page then grew more of the same: the opening document it
 * quotes and the two recordings it plays (`the-recordings-are-what-the-binary-draws.test.ts`).
 * Two spellings of what counts as minted, or of what a cut may leave out, is how one of the
 * cases comes to let a stale line through — so the two readings live here, unchanged, and every
 * such case asks them. A third joined them when the manual's session was held to a run
 * (`the-session-the-manual-shows-is-the-one-printed.test.ts`): which lines of a page's block are
 * the commands and which the output ({@link blockUnder}), read the same way for both pages.
 *
 * WHAT THE MACHINE MINTS. A run makes up an id per write, prints the day it ran and makes its
 * keys on the spot, so no second run prints them again. Both sides are read with each replaced
 * by what it is ({@link asMinted}) — and through the same function, so neither side can be made
 * to agree by a replacement the other did not get. The order is part of the reading: an id is
 * read before a run of hex, or the hex would take the id apart and leave its dashes behind; and
 * an id the page cut after its first group (`0198f3c1-…`) is read as the id it stands for, which
 * is the only way a page's shortened id and a printed whole one can be told to be the same thing.
 * A task's alias is minted with its id and read as one.
 *
 * THE ONE MARK OF A CUT. `…` inside a line stands for what the page shortened, and a line that is
 * `…` alone for one or more whole lines left out ({@link accountsFor}). Anything else a page
 * leaves out, or adds, is a line that does not account for what was printed.
 */

import { ALIAS_PREFIXES, SHORT_ALIAS_HEX } from '@mnema/core';
import { read } from './published-examples.js';
import { argvOf, linesOf } from './reading-a-shell-line.js';

/** A record's id, as every write prints it. */
const AN_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** An id a page cut after its first group — `0198f3c1-…` — which is still an id. */
const AN_ID_CUT = /[0-9a-f]{8}-(?=…)/g;

/**
 * The alias a task's id is shown under, `t-4f2a`: derived from the id, so minted with it. Read
 * off the core's own prefix table and length rather than spelt here.
 */
const AN_ALIAS = new RegExp(
  `\\b(${Object.values(ALIAS_PREFIXES).join('|')})-[0-9a-f]{${SHORT_ALIAS_HEX}}\\b`,
  'g',
);

/** The day a run happened, as the record prints it. */
const A_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** A key's fingerprint, an identity, a digest — any run of lower-case hex eight long or longer. */
const HEX = /[0-9a-f]{8,}/g;

/** Some text with what the machine minted replaced by what it is: `<uuid>`, `<date>`, `<hex>`. */
export function asMinted(text: string): string {
  return text
    .replace(AN_ID, '<uuid>')
    .replace(AN_ID_CUT, '<uuid>')
    .replace(AN_ALIAS, '$1-<alias>')
    .replace(A_DATE, '<date>')
    .replace(HEX, '<hex>');
}

/** The mark of a cut: inside a line, what was shortened; alone on a line, lines left out. */
export const CUT = '…';

/** A shown line as a pattern over one printed line: literal, except where it marks a cut. */
function patternOf(shown: string): RegExp {
  const literal = shown.split(CUT).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${literal.join('.*?')}$`);
}

/**
 * Whether the lines a page shows account for every line printed, in order, with {@link CUT}
 * the only way to leave anything out. A line that is the mark alone stands for ONE OR MORE
 * lines: a mark where nothing was cut would say something the page did not do.
 */
export function accountsFor(shown: readonly string[], printed: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  const from = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let answer: boolean;
    if (i === shown.length) {
      answer = j === printed.length;
    } else if (shown[i]?.trim() === CUT) {
      answer = false;
      for (let k = j + 1; k <= printed.length && !answer; k += 1) answer = from(i + 1, k);
    } else {
      answer =
        j < printed.length &&
        patternOf(shown[i] as string).test(printed[j] as string) &&
        from(i + 1, j + 1);
    }
    memo.set(key, answer);
    return answer;
  };
  return from(0, 0);
}

/** One step of a block a page publishes: a command with what it printed, or a shell variable. */
export type Step =
  | {
      readonly kind: 'command';
      readonly at: number;
      readonly argv: readonly string[];
      readonly shown: readonly string[];
    }
  | {
      readonly kind: 'assignment';
      readonly at: number;
      readonly name: string;
      readonly value: string;
    };

/**
 * The first fenced block under `section` on `page`, as the steps a reader types: each `mnema`
 * command with the `#>` lines under it, and each `NAME=value` a reader sets from what an earlier
 * command printed.
 *
 * A command may run over several lines with a trailing `\`, as a shell reads it. Everything else
 * — a comment, `cd` into the reader's own repository — is the reader's and not the binary's, and
 * is not a step. Throws when the section or its block is gone, because a guard that silently read
 * nothing would be a guard reporting that output it never compared agrees.
 */
export function blockUnder(page: string, section: string): readonly Step[] {
  const text = read(page);
  const heading = text.split('\n').indexOf(section) + 1;
  if (heading === 0) throw new Error(`${page} no longer carries "${section}"`);
  const lines = linesOf(text);
  const start = lines.findIndex((line) => line.at > heading && line.fence !== null);
  if (start < 0) throw new Error(`${page} carries "${section}" and no block under it`);
  // The block is the run of fenced lines with no line between them: the next fence on the
  // page is another block, and its first line does not follow this one's last.
  const fenced: typeof lines = [];
  for (const line of lines.slice(start)) {
    const previous = fenced.at(-1);
    if (line.fence === null || (previous !== undefined && line.at !== previous.at + 1)) break;
    fenced.push(line);
  }
  const steps: Step[] = [];
  let pending: { at: number; text: string } | undefined;
  for (const { at, source } of fenced) {
    if (pending !== undefined) {
      pending.text += ` ${source.trim()}`;
    } else if (source.startsWith('mnema ')) {
      pending = { at, text: source };
    } else if (source.startsWith('#>')) {
      const current = steps.at(-1);
      if (current?.kind !== 'command')
        throw new Error(`${page}:${at} shows output under no command`);
      (current.shown as string[]).push(source.replace(/^#> ?/, ''));
      continue;
    } else {
      const assigned = /^([A-Z_][A-Z0-9_]*)=(\S+)/.exec(source);
      if (assigned !== null) {
        steps.push({
          kind: 'assignment',
          at,
          name: assigned[1] as string,
          value: assigned[2] as string,
        });
      }
      continue;
    }
    if (pending.text.endsWith(' \\')) {
      pending.text = pending.text.slice(0, -2);
      continue;
    }
    steps.push({ kind: 'command', at: pending.at, argv: argvOf(pending.text), shown: [] });
    pending = undefined;
  }
  return steps;
}
