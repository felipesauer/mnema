// @reads-the-tree
/**
 * THE CACHE IS NOT SAID TO CHANGE NO ANSWER.
 *
 * Deleting `locks/projection.db` costs a rebuild, and it does change one kind of answer: an edit
 * in place, to the same size, of a line before the last of a live segment is a thing only a full
 * replay (or `verify`) sees. A sentence that says deleting the cache "changes no answer" is
 * therefore false, and it came back in four comments and a changelog before this read for it.
 *
 * This reads every file git carries outside the tests, joins comment lines, and fails on that
 * sentence unless the exception follows it. The last case plants the sentence to show the scan
 * can see it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const SOURCES: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter(
    (where) =>
      where !== '' && /\.(?:ts|md|mjs)$/.test(where) && !/(^|\/)tests?\/|\.test\.ts$/.test(where),
  );

/** Deleting it / the file / the cache ... "changes no answer", with no exception right after. */
const FALSE_PROMISE =
  /delet\w+ (?:it|the file|the cache|that file)\b[^.]{0,60}\bchanges? no answer(?! (?:but|bar|except|only|unless))/i;

function flat(text: string): string {
  return text.replace(/\s*\n\s*(?:\*|\/\/|#|>)?\s*/g, ' ');
}

describe('the cache is not said to change no answer', () => {
  it('has no sentence that deleting it changes no answer, outside the tests', () => {
    const found = SOURCES.filter((where) =>
      FALSE_PROMISE.test(flat(readFileSync(join(ROOT, where), 'utf-8'))),
    );
    expect(found, 'a file that promises deleting the cache changes no answer').toEqual([]);
  });

  it('sees the sentence when it is planted, wrapped in a comment', () => {
    const planted =
      ' * the record: deleting it costs a rebuild and\n * changes no answer, and a clone';
    expect(FALSE_PROMISE.test(flat(planted))).toBe(true);
    expect(SOURCES).toContain('packages/core/src/projections/cache.ts');
  });
});
