/**
 * A PATTERN THAT REMEMBERS WHERE IT STOPPED MAY NOT BE ASKED A YES-OR-NO QUESTION.
 *
 * `RegExp.prototype.test` on a pattern carrying `g` or `y` advances `lastIndex` and
 * resumes from there on the next call, so the SAME pattern asked the SAME question about
 * the SAME string answers `true`, then `false`, then `true`. Nothing changed between the
 * calls; the pattern did.
 *
 * WHERE IT CAME FROM. `the-broken-link-reaches-every-reader.test.ts` carried one, inside a
 * loop, asking whether the MCP server declares the reading — the first of a pair, where
 * the second is what actually catches a missing tool. So it never moved a verdict, and
 * that is exactly the reason it is worth a guard rather than a fix: an assertion that
 * passes for a reason unrelated to what it asks is one that will keep passing when the
 * thing it asks about breaks, and nothing about the day it was written says which pair it
 * lands in next time.
 *
 * WHAT IS SWEPT. Every `.ts` of every package, tests INCLUDED — a test asserting shape is
 * where this shape lives, and the one occurrence there was is the proof of that. Prose is
 * excluded by the line, not by a blanker: a doc-comment explaining the rule has to be able
 * to write the rule down, and a line whose first non-space is `*`, `//` or `/*` is not
 * code in this repository.
 *
 * ## What it does not answer
 *
 * A pattern built elsewhere and handed in — `someRegexArgument.test(x)` — and a flag
 * assembled at runtime. Both are reachable and neither is written here; what is swept is
 * the two forms the sweep that found this one covered, so the guard and the sweep say the
 * same thing rather than two.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES = join(import.meta.dirname, '..', '..');

/**
 * Every `.ts` under a directory, TESTS INCLUDED — which is why `sourceFiles` from
 * `support/reading-source.ts` is not what walks here, and the difference is the whole
 * guard rather than a detail. That helper drops `.test.ts`, because the guards it serves
 * ask about what SHIPS; this one asks about a shape that lives in assertions, and the one
 * occurrence in this repository was in a `.test.ts`. Written on the shared walker, this
 * file would have been born blind to the defect that motivated it — measured: 320 files
 * swept instead of 578, and zero of the guilty among them.
 */
function everyTypeScriptFile(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...everyTypeScriptFile(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

/** Every `.ts` of every package, tests included, by repo-relative path. */
function everySource(): string[] {
  return ['chain', 'code', 'copilot', 'core']
    .flatMap((pkg) => [join(PACKAGES, pkg, 'src'), join(PACKAGES, pkg, 'tests')])
    .flatMap((root) => {
      try {
        return everyTypeScriptFile(root);
      } catch {
        return [];
      }
    })
    .map((path) =>
      path
        .slice(PACKAGES.length + 1)
        .split(sep)
        .join('/'),
    )
    .sort();
}

/** The source minus its prose: every line whose first non-space opens a comment. */
function codeLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const first = line.trimStart();
      return !(first.startsWith('*') || first.startsWith('//') || first.startsWith('/*'));
    })
    .join('\n');
}

/** One regex literal's body, as a fragment — escapes and character classes intact. */
const BODY = String.raw`(?:\\.|\[[^\]]*\]|[^/\n\\])+`;

/** A literal that remembers, asked a yes-or-no question: `/…/g` immediately `.test(`. */
const A_LITERAL_THAT_REMEMBERS = new RegExp(`/${BODY}/[a-z]*[gy][a-z]*\\s*\\.\\s*test\\(`);

/** The same thing given a name: `const X = /…/g` somewhere, and `X.test(` somewhere else. */
function namedThatRemember(source: string): string[] {
  const declared = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]*)?=\\s*/${BODY}/([a-z]*)`,
    'g',
  );
  const guilty: string[] = [];
  for (const found of source.matchAll(declared)) {
    const name = found[1] as string;
    const flags = found[2] as string;
    if (!/[gy]/.test(flags)) continue;
    if (new RegExp(`\\b${name}\\s*\\.\\s*test\\(`).test(source)) guilty.push(name);
  }
  return guilty;
}

/** Every sticky yes-or-no question in one file, by the form it takes. */
function sticky(source: string): string[] {
  const code = codeLines(source);
  return [
    ...(A_LITERAL_THAT_REMEMBERS.test(code) ? ['a literal'] : []),
    ...namedThatRemember(code).map((name) => `the pattern named ${name}`),
  ];
}

describe('no pattern that remembers is asked a yes-or-no question', () => {
  const swept = everySource();

  it('read the workspace it claims to have read', () => {
    // The vacuous form: a sweep whose roots stopped resolving finds nothing and passes.
    expect(swept.length).toBeGreaterThan(400);
    expect(swept).toContain('code/tests/the-broken-link-reaches-every-reader.test.ts');
    expect(swept).toContain('core/src/projections/cache.ts');
  });

  it('finds none in any package, tests included', () => {
    const guilty = swept.flatMap((path) =>
      sticky(readFileSync(join(PACKAGES, path), 'utf-8')).map((how) => `${path}: ${how}`),
    );
    expect(guilty).toEqual([]);
  });

  it('would accuse both forms — on the text the repository held', () => {
    // THE TEETH, and the probes are ASSEMBLED rather than written out: a file that spelled
    // the forbidden form would accuse itself, and an exception for this one file is where
    // the next hole goes. The first is the line that was really here, to the character.
    const g = 'g';
    const wasHere = `expect(/(reads|mutates)TheRecord\\('([a-z_]+)'\\)/${g}.test(server), tool).toBe(true);`;
    expect(sticky(wasHere)).toEqual(['a literal']);
    expect(sticky(`const SEEN = /a(b)c/${g};\nif (SEEN.test(line)) return;`)).toEqual([
      'the pattern named SEEN',
    ]);
    expect(sticky(`const SEEN = /a/${'y'};\nif (SEEN.test(line)) return;`)).toEqual([
      'the pattern named SEEN',
    ]);
    // AND IT IS NOT A CONSTANT. A pattern with no `g` asked the question, a pattern with
    // `g` asked something else (`match`, `replace`, `matchAll` reset or ignore it), and
    // the rule written down in prose are all sound.
    expect(sticky('if (/a/.test(line)) return;')).toEqual([]);
    expect(sticky(`const SEEN = /a/${g};\nconst all = line.match(SEEN);`)).toEqual([]);
    expect(sticky(`const SEEN = /a/${g};\nline.replace(SEEN, '');`)).toEqual([]);
    expect(sticky(` * never write /x/${g}.test(source) — it remembers.`)).toEqual([]);
    expect(sticky(`  // /x/${g}.test(source) is banned here.`)).toEqual([]);
  });
});
