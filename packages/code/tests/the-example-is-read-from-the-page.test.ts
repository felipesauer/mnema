/**
 * THE EXAMPLE A PACKAGE PUBLISHES IS THE EXAMPLE THAT RUNS — line for line.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT WAS NOT A GUARD. One package had a case called
 * `readme-example.test.ts` whose header said *"If this drifts from the README, fix one or
 * the other — the example must run."* That sentence is an intention, and the file was a
 * parallel TRANSLATION of the page rather than a reading of it. Measured on 11/09/2026
 * against `a41a9ea8`: renaming `bootstrap` to `bootstrapZZZ` INSIDE the README's ```ts
 * block — an edit that makes the published example impossible to run — left the suite
 * green. The other three packages had no such case at all, so copying that shape three
 * more times would have multiplied a guard that does not catch the defect it exists for.
 *
 * AND THE DRIFT WAS ALREADY THERE. Extracting the page's block and the case's body on
 * that same commit, the two disagreed on five lines: three comment rewraps, and two places
 * where the page said more than the code that ran — `// { kind: 'decision', record: … }`
 * against `// { kind: 'decision', … }`, and `// names only — one line each` against
 * `// names only`. Nobody had changed anything wrongly; the two copies simply aged apart,
 * which is what two copies do.
 *
 * WHAT IT FOUND THE DAY IT LANDED, which is the measurement that says the shape is right.
 * Type-checking the three extracted blocks against the built `.d.ts` files turned up TEN
 * errors, and every one of them was in a package that had no guard:
 *   - `@mnema/chain` called `openChainForWriting` with one argument where the signature
 *     takes two, and built an envelope with no `signerFp`. It also said the key pair "is
 *     loaded from the chain root" — contradicted by that function's own doc-comment — and
 *     presented `who: 'alice'` as "the human who authorized the work", where `who` is an
 *     anchor derived from the key and never a typed-in name.
 *   - `@mnema/core` imported `createTask` and `transitionTask` from `@mnema/core`, which
 *     exports neither: they live on `@mnema/core/write`, and that split is the structural
 *     boundary a read-only consumer depends on. It then handed `createTask` an `id` and a
 *     `who`, neither of which it takes.
 *   - Running the corrected chain example revealed one more thing no type-checker sees:
 *     it verified RED, because no event founded the anchor its signer belongs to. The
 *     page taught a sequence that produces a record `verify` refuses.
 * Of the ten, `tsc` could have caught nine at any point in the alpha and never did,
 * because nothing type-checks a fenced code block.
 *
 * THE SHAPE, AND WHY THIS ONE. Three ways were open: compare the page with the body that
 * runs, extract the block and execute it, or generate the page from the case. This file
 * is the first, and the reason is that it is the only one of the three that keeps the
 * README as the page a reader reads while making the code that runs BE that page. The
 * second needs a TypeScript transform at test time and executes text nobody reviewed as
 * code. The third inverts authorship: the page would become output, and prose written to
 * be read would be written to be generated. What the comparison gives up is that the
 * bytes are checked rather than re-executed — and that is given up only in appearance,
 * because the bytes checked are the bytes the case runs.
 *
 * ONE FORMATTER, ONE DIRECTION. Only the test file is formatted (`biome` does not read
 * Markdown), so the page carries the case's body dedented, and the comparison is exact
 * afterwards. If a line the formatter would rewrap is edited on the page first, this case
 * goes red and the fix is to edit the case and dedent again — which is the workflow, not
 * a defect.
 *
 * WHERE THE ROSTER LIVES. The list of pages is not in this file: a second rule now stands
 * over the same roster — the example a package publishes TYPE-CHECKS, in
 * `the-example-is-type-checked.test.ts` — and two copies of a list is the shape that ends
 * with one guard covering a page the other does not. Both read
 * `support/published-examples.ts`.
 *
 * WHAT IS ELIDED, AND WHY IT CANNOT GROW IN SILENCE. Two packages name directories on the
 * page (`.mnema/chain` and a key root); a case that ran those literals would found an
 * identity and write events inside this repository, which amarra A6 forbids. So each
 * entry declares the ELIDED PREFIX as the exact lines it stands for, and a case below
 * holds the page against it: an elision whose lines are no longer on the page is accused
 * as loudly as a page line nobody declared. A prefix given as a count rather than as text
 * would have been a number anyone could raise to swallow a difference.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NO_RUNNABLE_EXAMPLE,
  PUBLISHED_EXAMPLES,
  publishedBlock,
  ROOT,
  read,
} from './support/published-examples.js';

/** The marked region of a case, dedented to the page's margin. */
function runnableBody(source: string): string[] {
  const open = source.indexOf('// ---- README example begins ----');
  const close = source.indexOf('// ---- README example ends ----');
  if (open < 0 || close < 0) throw new Error('the case carries no marked README region');
  const region = source.slice(source.indexOf('\n', open) + 1, source.lastIndexOf('\n', close) + 1);
  const lines = region.replace(/\n$/, '').split('\n');
  const margin = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length),
  );
  return lines.map((line) => (line.trim() ? line.slice(margin) : ''));
}

/**
 * Every `import { … } from '…'` in a block, as specifier → the names it brings in, sorted.
 * A named import written across several lines is one statement, so the scan runs to the
 * `from` clause rather than to the end of a line.
 */
function importedNames(lines: readonly string[]): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const statement of lines
    .join('\n')
    .matchAll(/^import\s*{([\s\S]*?)}\s*from\s*'([^']+)';/gm)) {
    const names = (statement[1] as string)
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .sort();
    found[statement[2] as string] = names;
  }
  return found;
}

/** Everything in a block below its imports and the blank lines under them. */
function belowTheImports(lines: readonly string[]): string[] {
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] as string;
    if (line.startsWith('import ')) {
      while (at < lines.length && !(lines[at] as string).includes(" from '")) at += 1;
      at += 1;
      continue;
    }
    if (!line.trim()) {
      at += 1;
      continue;
    }
    break;
  }
  return [...lines.slice(at)];
}

/**
 * The lines of a page's example that the case is expected to carry: what is below the
 * imports, with the declared elision removed from the front. The elision is removed ONLY
 * where it matches exactly; anything else comes back untouched and the comparison fails,
 * which is what stops a stale elision from swallowing a difference.
 */
function pageBody(block: readonly string[], elided: readonly string[]): string[] {
  const below = belowTheImports(block);
  const head = below.slice(0, elided.length);
  return head.join('\n') === elided.join('\n') ? below.slice(elided.length) : below;
}

/** Where two line arrays first differ, as a readable pair. Empty when they are the same. */
function firstDifference(page: readonly string[], runs: readonly string[]): string[] {
  for (let at = 0; at < Math.max(page.length, runs.length); at += 1) {
    if (page[at] !== runs[at]) {
      return [
        `page[${at}]: ${page[at] ?? '<end of block>'}`,
        `case[${at}]: ${runs[at] ?? '<end of region>'}`,
      ];
    }
  }
  return [];
}

describe('the example a package publishes is the example that runs', () => {
  for (const example of PUBLISHED_EXAMPLES) {
    it(`@mnema/${example.pkg} — the page's block IS the case's body`, () => {
      const page = pageBody(publishedBlock(read(example.readme)), example.elided);
      const runs = runnableBody(read(example.test));
      // Named first so a failure reads as the one line that moved rather than as two
      // fifty-line arrays a reader has to diff by eye.
      expect(firstDifference(page, runs)).toEqual([]);
      expect(page).toEqual(runs);
    });

    it(`@mnema/${example.pkg} — the page imports what the case imports`, () => {
      const onThePage = importedNames(publishedBlock(read(example.readme)));
      const inTheCase = importedNames(read(example.test).split('\n'));
      const declared = Object.keys(example.specifiers).sort();
      // Every specifier the page uses is mapped: an import added to the page with no
      // mapping would otherwise be compared against nothing.
      expect(Object.keys(onThePage).sort()).toEqual(declared);
      for (const [published, inSource] of Object.entries(example.specifiers)) {
        expect({ [published]: inTheCase[inSource] }).toEqual({ [published]: onThePage[published] });
      }
    });

    it(`@mnema/${example.pkg} — every elided line is still on the page`, () => {
      const below = belowTheImports(publishedBlock(read(example.readme)));
      expect(below.slice(0, example.elided.length)).toEqual([...example.elided]);
    });
  }
});

describe('the list of pages is the list on disk', () => {
  it('every package README is in exactly one of the two lists', () => {
    const onDisk = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && existsSync(join(ROOT, 'packages', entry.name, 'README.md')),
      )
      .map((entry) => entry.name)
      .sort();
    const listed = [
      ...PUBLISHED_EXAMPLES.map((example) => example.pkg),
      ...NO_RUNNABLE_EXAMPLE.map((entry) => entry.pkg),
    ].sort();
    expect(listed).toEqual(onDisk);
  });

  it('a README excused from running publishes no TypeScript to run', () => {
    const wrongly = NO_RUNNABLE_EXAMPLE.filter(({ pkg }) =>
      read(`packages/${pkg}/README.md`).includes('\n```ts\n'),
    ).map(({ pkg }) => pkg);
    expect(wrongly).toEqual([]);
  });

  it('the cases named here are the files named `readme-example` in the workspace', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((file) => file.endsWith('readme-example.test.ts'))
      .sort();
    expect(tracked).toEqual(PUBLISHED_EXAMPLES.map((example) => example.test).sort());
  });
});

describe('the comparison FIRES', () => {
  // A comparison that finds nothing is indistinguishable from one that cannot find
  // anything, so each reading is shown working on a corpus written here.
  const page = ['const a = one(2);', '', '// a comment', 'const b = two(a);'];

  it('a renamed identifier on the page is a difference', () => {
    const drifted = page.map((line) => line.replace('one(', 'oneZZZ('));
    expect(firstDifference(drifted, page)).not.toEqual([]);
  });

  it('a rewrapped comment on the page is a difference', () => {
    const drifted = page.map((line) => line.replace('// a comment', '// a  comment'));
    expect(firstDifference(drifted, page)).not.toEqual([]);
  });

  it('a line added to the page is a difference, and so is one removed', () => {
    expect(firstDifference([...page, 'const c = 3;'], page)).not.toEqual([]);
    expect(firstDifference(page.slice(0, -1), page)).not.toEqual([]);
  });

  it('identical bodies are no difference at all — the reading is not stuck on red', () => {
    expect(firstDifference(page, [...page])).toEqual([]);
  });

  it('the imports are read as names, not as text', () => {
    const block = ["import {\n  a,\n  b,\n} from 'x';", "import { c } from 'y';"];
    expect(importedNames(block)).toEqual({ x: ['a', 'b'], y: ['c'] });
  });

  it('an elision is removed only where the page still carries it', () => {
    const block = ["import { a } from 'x';", '', 'const root = 1;', 'a(root);'];
    expect(pageBody(block, ['const root = 1;'])).toEqual(['a(root);']);
    // The stale elision does not match, so nothing is dropped and the body stays whole —
    // a difference the comparison then reports, rather than a line quietly swallowed.
    expect(pageBody(block, ['const root = 2;'])).toEqual(['const root = 1;', 'a(root);']);
  });
});
