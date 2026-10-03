/**
 * NO FILE UNDER `measurements/` NAMES A PERSON'S HOME DIRECTORY.
 *
 * A result is committed to be read by a stranger, and a path such as `/home/<name>/…` is the
 * name of whoever ran it. The rule is read off every file git tracks or would track under
 * `measurements/`: a home directory of the three common shapes, and the `HOME` of whoever
 * runs this check. Where a result has to say where it ran, it says `<projects>` or `<home>`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const FILES: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'measurements'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => where !== '');

/** A home directory of somebody: Linux, macOS, Windows (as written or escaped in JSON). */
const A_HOME = /\/home\/[A-Za-z0-9_.-]+|\/Users\/[A-Za-z0-9_.-]+|[A-Za-z]:\\{1,2}Users\\{1,2}/;

/** The lines of `text` that name a home, or the `HOME` of whoever runs this. */
const namesAHome = (text: string, homes: readonly string[]): number[] =>
  text
    .split('\n')
    .flatMap((line, i) =>
      A_HOME.test(line) || homes.some((home) => line.includes(home)) ? [i + 1] : [],
    );

/** A runner's own home, when it is a real one: `/` or a one-segment path would match everything. */
const RUNNER_HOMES: readonly string[] = [process.env.HOME, userInfo().homedir].filter(
  (home): home is string => typeof home === 'string' && home.split('/').length > 2,
);

describe('a measurement carries no one’s home directory', () => {
  it('reads the files under measurements/, so that the sweep below is not over nothing', () => {
    expect(FILES.length).toBeGreaterThan(400);
  });

  it('finds none in any of them', () => {
    const found = FILES.flatMap((where) => {
      const lines = namesAHome(readFileSync(join(ROOT, where), 'utf-8'), RUNNER_HOMES);
      return lines.length === 0 ? [] : [`${where}: line ${lines.slice(0, 3).join(', ')}`];
    });
    expect(found).toEqual([]);
  });

  it('recognises each shape, and the HOME of the runner', () => {
    expect(namesAHome('"repository": "/home/ana/work/mnema"', [])).toEqual([1]);
    expect(namesAHome('ok\n/Users/Ana/work', [])).toEqual([2]);
    expect(namesAHome('C:\\Users\\Ana\\work', [])).toEqual([1]);
    expect(namesAHome('{"p":"C:\\\\Users\\\\Ana"}', [])).toEqual([1]);
    expect(namesAHome('under /srv/ci/work', ['/srv/ci'])).toEqual([1]);
    expect(namesAHome('<projects>/mnema, <home>/…', [])).toEqual([]);
  });
});
