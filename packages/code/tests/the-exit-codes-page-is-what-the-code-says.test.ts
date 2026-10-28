/**
 * THE TABLE OF EXIT CODES IN `docs/cli-reference.md` IS WHAT THE CODE SETS.
 *
 * A script reads an exit code, so the page that names them is a promise a script keys on. The
 * table lists `0`, `1`, `2`, `70` and `127`, and each number that is not the ordinary `0` and `1`
 * is read here from the place that sets it, never typed a second time: `70` is
 * `INTERNAL_ERROR_EXIT`, `1` is what `processIo.fail()` sets with no code, `2` is the literal the
 * `SubagentStop` hook ends with, and `127` is the launcher's.
 *
 * THE SWEEP IS THE OTHER HALF. A number the code sets that the table does not name is the exit
 * code a script meets and finds nowhere: every literal exit of the product's own source (the
 * command line's, the hooks', the launcher's) must be in the table.
 *
 * NOT HELD: that each row says the right thing about when its code comes. The `1` of a refusal and
 * the `70` of a fault are held where they are produced (`program.test.ts`, `internal-error.test.ts`).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTERNAL_ERROR_EXIT } from '../src/internal-error.js';
import { processIo } from '../src/wiring/io.js';
import { ROOT, read } from './support/published-examples.js';

const PAGE = 'docs/cli-reference.md';
const HEADING = '### The exit codes';

/** The codes the page's table names, by code, each with the cell that says who ends with it. */
function theTable(page: string): Map<number, string> {
  const from = page.indexOf(HEADING);
  if (from < 0) throw new Error(`${PAGE} has no "${HEADING}" section`);
  const next = page.indexOf('\n### ', from + HEADING.length);
  const section = page.slice(from, next < 0 ? undefined : next);
  const rows = new Map<number, string>();
  for (const line of section.split('\n')) {
    const row = /^\| `(\d+)` \| ([^|]*) \|/.exec(line);
    if (row?.[1] !== undefined) rows.set(Number(row[1]), row[2] ?? '');
  }
  if (rows.size === 0) throw new Error(`the "${HEADING}" section has no table of codes`);
  return rows;
}

/** What `fail()` sets as the process's exit code when it is given none, restored after. */
function whatFailSetsWithNoCode(): number | string | undefined {
  const before = process.exitCode;
  try {
    process.exitCode = undefined;
    processIo.fail();
    return process.exitCode;
  } finally {
    process.exitCode = before;
  }
}

/** The files of the product's own source that can end a process, never a test or a captured page. */
function sourcesThatExit(): string[] {
  const roots = [join(ROOT, 'packages/code/src'), join(ROOT, 'plugin')];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'captures' || name === 'dist') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(?:ts|mjs|js)$/.test(name) && !/\.test\.(?:ts|mjs|js)$/.test(name)) {
        files.push(path);
      }
    }
  };
  for (const root of roots) walk(root);
  return files;
}

/** Every literal exit code a source sets: `process.exit(N)`, `process.exitCode = N`, `fail(N)`. */
const LITERAL_EXITS = [
  /process\.exit\((\d+)\)/g,
  /process\.exitCode\s*=\s*(\d+)\b/g,
  /\bfail\((\d+)\)/g,
];

describe('the table of exit codes', () => {
  const table = theTable(read(PAGE));

  it('names 70 as the internal error the code exits with', () => {
    expect(INTERNAL_ERROR_EXIT).toBe(70);
    expect(table.has(INTERNAL_ERROR_EXIT)).toBe(true);
  });

  it('names 1 as what a refusal sets, which is what fail() sets with no code', () => {
    expect(whatFailSetsWithNoCode()).toBe(1);
    expect(table.has(1)).toBe(true);
  });

  it('names 2 as the code the SubagentStop hook ends with, and that hook alone', () => {
    const hook = read('plugin/hooks/subagent-stop.mjs');
    const exits = [...hook.matchAll(/process\.exitCode\s*=\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(exits).toEqual([2]);
    expect(table.get(2)).toContain('subagent-stop.mjs');
  });

  it('names 127 as the launcher could not start mnema', () => {
    const launcher = read('plugin/server/launch.mjs');
    expect([...launcher.matchAll(/process\.exit\((\d+)\)/g)].map((m) => Number(m[1]))).toContain(
      127,
    );
    expect(table.get(127)).toContain('launch.mjs');
  });

  it('names every literal exit code the source sets, and sets only what it names', () => {
    const found = new Map<number, string[]>();
    for (const file of sourcesThatExit()) {
      const text = readFileSync(file, 'utf-8');
      for (const pattern of LITERAL_EXITS) {
        for (const match of text.matchAll(pattern)) {
          const code = Number(match[1]);
          found.set(code, [...(found.get(code) ?? []), relative(ROOT, file)]);
        }
      }
    }
    // NON-VACUITY: the sweep reads the files it exists for.
    expect(found.get(2), 'the sweep never reached the SubagentStop hook').toContain(
      'plugin/hooks/subagent-stop.mjs',
    );
    expect(found.get(127), 'the sweep never reached the launcher').toContain(
      'plugin/server/launch.mjs',
    );
    expect(found.has(1), 'the sweep never reached the floor that exits 1').toBe(true);
    for (const [code, where] of found) {
      expect(
        table.has(code),
        `exit ${code} is set by ${where.join(', ')} and the table omits it`,
      ).toBe(true);
    }
    // And the table names nothing the code never sets, but the two defaults a process has.
    for (const code of table.keys()) {
      const set = found.has(code) || code === 0 || code === INTERNAL_ERROR_EXIT;
      expect(set, `the table names ${code} and nothing sets it`).toBe(true);
    }
  });
});
