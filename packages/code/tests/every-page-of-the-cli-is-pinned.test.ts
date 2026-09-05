/**
 * EVERY PAGE OF `--help` THIS PROGRAM HAS IS PINNED, and this is the case that names the
 * one that is not.
 *
 * `cli.golden.test.ts` holds the bytes: it drives every page and compares the transcript
 * to `src/cli.help.golden.txt`. That file is what would go red if a page arrived unpinned
 * — the transcript would carry a section the committed file has not got — so a second
 * mechanism is not what this adds. What it adds is the NAME. A golden's answer to a page
 * nobody pinned is a diff of the whole transcript; this one says `switch off`, in a second,
 * without founding a fixture.
 *
 * IT IS THE FAILURE THAT WAS ACTUALLY HAD. The list of pages in the golden was written by
 * hand — one array of verbs, one of `[verb, sub]` pairs — and it held 45 of the 52 pages
 * the program answers on. Nothing in it was stale: it was SHORT. Three of the seven missing
 * were one feature, `switch`, whose group and both acts shipped with nothing asserting a
 * byte of what they tell a person BEFORE they act — what `--scope` decides, and what a
 * switch recorded privately costs. (What the act answers back was pinned all along, in the
 * writes transcript; it is the instructions that nothing held.) Every delivery between that
 * one and this one was green over it. That is what a hand-kept list of what a file
 * registers does: it rots on the one occasion it matters, silently, because a list nobody
 * writes to is never red.
 *
 * BOTH DIRECTIONS, because each is a different defect. A page in the program and not in
 * the golden is a page nothing pins. A page in the golden and not in the program is a
 * verb that was removed while its bytes stayed committed, which reads to the next person
 * as a surface that still has it.
 *
 * AND THE PAGES COME OFF THE PROGRAM, never off a list here. `everyCommandOf` is the same
 * walk the parser's refusals and the completion tree use, and `pathOf` is the same reading
 * of what a caller types — one site each, in `wiring/misuse.ts`. A list in this file would
 * be the defect it was written to catch.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { everyCommandOf, pathOf } from '../src/wiring/misuse.js';

/** A silent port: nothing here runs a verb, it only reads what they declare. */
const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * The committed transcript of every page, as `cli.golden.test.ts` writes it.
 *
 * Read at module load, which under `vitest -u` can be one version behind the file the
 * golden is rewriting in the same run. The failure that buys is a red that clears on the
 * next run — a stale read can only report a page as unpinned that has just been pinned,
 * never the reverse — so it is named here rather than locked against.
 */
const GOLDEN = readFileSync(join(HERE, '../src/cli.help.golden.txt'), 'utf8');

/**
 * The pages a program answers `--help` on, by the words a caller types to reach one.
 *
 * The root is dropped: `mnema --help` is in the golden under a label of its own, because
 * the program's own page is not a verb's.
 */
function pagesOf(program: Command): readonly string[] {
  return everyCommandOf(program)
    .map((command) => pathOf(command).join(' '))
    .filter((page) => page !== '');
}

/**
 * The pages a transcript pins, read off the labels it writes for them.
 *
 * A LABEL AND NOT AN INVOCATION LINE. The golden holds both — `### mnema switch off --help`
 * and the `$ mnema switch off --help` under it — and the label is the one that says the
 * page has a SECTION rather than that some line somewhere ran the command.
 */
function pagesPinnedIn(transcript: string): readonly string[] {
  const found: string[] = [];
  for (const line of transcript.split('\n')) {
    const label = /^### mnema (.+) --help$/.exec(line);
    if (label?.[1] !== undefined) found.push(label[1]);
  }
  return found;
}

/** What each side has that the other has not — the whole of the rule, in one place. */
function reconcile(
  pages: readonly string[],
  pinned: readonly string[],
): { readonly unpinned: readonly string[]; readonly orphaned: readonly string[] } {
  return {
    unpinned: pages.filter((page) => !pinned.includes(page)),
    orphaned: pinned.filter((page) => !pages.includes(page)),
  };
}

/** The program the binary builds, fresh — every call to `buildProgram` returns its own. */
function declared(): Command {
  return buildProgram(silent).program;
}

describe('every page of the CLI is pinned', () => {
  it('pins every page the program has, and no page it has not', () => {
    const { unpinned, orphaned } = reconcile(pagesOf(declared()), pagesPinnedIn(GOLDEN));
    expect(
      unpinned,
      'these pages answer `--help` and no byte of what they say is pinned — add them to ' +
        'the golden by regenerating it, AFTER reading what each one tells a person',
    ).toEqual([]);
    expect(
      orphaned,
      'the golden pins these pages and the program no longer has them — a reader of the ' +
        'committed transcript would believe this surface still answers them',
    ).toEqual([]);
  });

  it('reads the golden it is given, rather than finding nothing in it', () => {
    // THE INSTRUMENT, ASKED WHETHER IT WORKS. Every assertion above is over what this
    // parser returned, so a regex that matched nothing would report the golden as pinning
    // no page at all — which the case above WOULD catch (52 unpinned) but would report as
    // a surface-wide defect rather than as a broken ruler. Asked here directly, over a
    // transcript written for it, so the two failures cannot be confused.
    expect(
      pagesPinnedIn(
        ['### the program', '$ mnema --help', '### mnema switch off --help', '| Usage:'].join('\n'),
      ),
    ).toEqual(['switch off']);
    // And over the committed one it finds pages, so the case above is asserting over a
    // list that exists.
    expect(pagesPinnedIn(GOLDEN).length).toBeGreaterThan(0);
  });

  it('names a page the program grew and the golden has not — over a program that grew one', () => {
    // NOT VACUOUS, and the way it is not is the point: the extra page is hung on a REAL
    // program, by the door a verb is added through, and it reaches the assertion through
    // the same walk the case above uses. An expectation that only ever saw the healthy
    // list would be asserting nothing at all.
    const grown = declared();
    grown.command('probe').description('a verb this test invented');
    const { unpinned, orphaned } = reconcile(pagesOf(grown), pagesPinnedIn(GOLDEN));
    expect(unpinned).toEqual(['probe']);
    expect(orphaned).toEqual([]);
  });

  it('names a page the golden pins and the program has not', () => {
    const { unpinned, orphaned } = reconcile(pagesOf(declared()), [
      ...pagesPinnedIn(GOLDEN),
      'ghost',
    ]);
    expect(orphaned).toEqual(['ghost']);
    expect(unpinned).toEqual([]);
  });
});
