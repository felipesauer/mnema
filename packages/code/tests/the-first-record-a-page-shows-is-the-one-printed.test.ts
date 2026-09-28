/**
 * THE FIRST RECORD THE ROOT PAGE SHOWS IS THE ONE THE BINARY PRINTS — every line of it, and a
 * cut only where the page marks one.
 *
 * WHAT WAS UNCHECKED, AND WHAT IT HID. The block under "Your first record" showed four of the
 * ten lines `init` prints and two of the three `verify` prints, with nothing to say lines were
 * gone. The `verify` line it left out was the census note about the reader's own backup key —
 * the one line a new user would have had to ask about. Nothing read that block's output:
 * `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts` reads its verbs and flags and
 * drops every `#>` line (`THE_OUTPUT_IS_A_SECOND_RULE`), and
 * `the-verifier-a-page-publishes-runs.test.ts` holds the NEXT block on the same page.
 *
 * WHAT IS CHECKED. The block's commands run in order, through the built binary, in a sandbox
 * of their own — its own `HOME`, its own repository — and each command's output is held to the
 * `#>` lines under it:
 *   - every line it printed is shown, in order, and every line shown was printed;
 *   - `…` is the page's one mark of a cut: inside a line it stands for what the page
 *     shortened, and a line that is `…` alone for one or more whole lines left out;
 *   - an id, a fingerprint, a date and the sandbox's own path are the machine's and not the
 *     page's, so both sides are read with each replaced by what it is ({@link asShape}) — which
 *     is what lets the page print an id that looks like one;
 *   - and nothing is printed on the other stream, which the page does not show at all.
 *
 * WHAT IT DOES NOT CHECK:
 *   - the page's prose around the block, and every other block on every other page — this is
 *     one block, the one a new user copies first;
 *   - a `…` that shortens a line to nothing useful: the mark is honest by construction, and
 *     whether it cut too much is a judgement for whoever reads the page.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { read } from './support/published-examples.js';
import { argvOf, linesOf } from './support/reading-a-shell-line.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The page, and the heading the block lives under. */
const PAGE = 'README.md';
const SECTION = '## Your first record';

/** The mark of a cut: inside a line, what was shortened; alone on a line, lines left out. */
const CUT = '…';

/** One command of the block, and the lines the page shows under it. */
interface Shown {
  readonly at: number;
  readonly argv: readonly string[];
  readonly shown: readonly string[];
}

/**
 * The block under {@link SECTION}: its commands, each with the `#>` lines under it.
 *
 * A command may run over several lines with a trailing `\`, as a shell reads it. `cd` is the
 * reader's own step, into their repository, and the sandbox is already there. Throws when the
 * section or its block is gone, because a guard that silently read nothing would be a guard
 * reporting that output it never compared agrees.
 */
function theBlock(): readonly Shown[] {
  const page = read(PAGE);
  const heading = page.split('\n').indexOf(SECTION) + 1;
  if (heading === 0) throw new Error(`${PAGE} no longer carries "${SECTION}"`);
  const lines = linesOf(page);
  const start = lines.findIndex((line) => line.at > heading && line.fence !== null);
  if (start < 0) throw new Error(`${PAGE} carries "${SECTION}" and no block under it`);
  // The block is the run of fenced lines with no line between them: the next fence on the
  // page is another block, and its first line does not follow this one's last.
  const fenced: typeof lines = [];
  for (const line of lines.slice(start)) {
    const previous = fenced.at(-1);
    if (line.fence === null || (previous !== undefined && line.at !== previous.at + 1)) break;
    fenced.push(line);
  }
  const block: { at: number; argv: readonly string[]; shown: string[] }[] = [];
  let pending: { at: number; text: string } | undefined;
  for (const { at, source } of fenced) {
    if (pending !== undefined) {
      pending.text += ` ${source.trim()}`;
    } else if (source.startsWith('mnema ')) {
      pending = { at, text: source };
    } else if (source.startsWith('#>')) {
      const current = block.at(-1);
      if (current === undefined) throw new Error(`${PAGE}:${at} shows output under no command`);
      current.shown.push(source.replace(/^#> ?/, ''));
      continue;
    } else {
      continue;
    }
    if (pending.text.endsWith(' \\')) {
      pending.text = pending.text.slice(0, -2);
      continue;
    }
    block.push({ at: pending.at, argv: argvOf(pending.text), shown: [] });
    pending = undefined;
  }
  return block;
}

/**
 * A line as a SHAPE: what belongs to the machine replaced by what it is. Both sides are read
 * through this one function, so neither can be made to agree by a replacement the other did
 * not get.
 */
function asShape(line: string, repo: string): string {
  return line
    .split(repo)
    .join('/path/to/repo')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
    .replace(/[0-9a-f]{8,}/g, '<hex>');
}

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
function accountsFor(shown: readonly string[], printed: readonly string[]): boolean {
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

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-first-record-'));
  repo = join(sandbox, 'your-repository');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the first record the root page shows', () => {
  it('is what the binary prints, line for line, cut only where the page says so', () => {
    const block = theBlock();
    for (const { at, argv, shown } of block) {
      const ran = spawnSync(process.execPath, [CLI, ...argv.slice(1)], {
        cwd: repo,
        encoding: 'utf-8',
        env: { PATH: process.env.PATH ?? '', HOME: home },
      });
      const where = `${PAGE}:${at} ${argv.join(' ')}`;
      expect(ran.status, `${where} failed: ${ran.stderr}`).toBe(0);
      expect(ran.stderr, `${where} printed on the stream the page does not show`).toBe('');
      // The repository by both of its spellings: the one it was made at, and the one a
      // resolved path would print, which differ wherever the temp directory is a link.
      const printed = ran.stdout
        .replace(/\n$/, '')
        .split('\n')
        .map((line) => asShape(asShape(line, realpathSync(repo)), repo));
      const expected = shown.map((line) => asShape(line, '/path/to/repo'));
      expect(
        accountsFor(expected, printed),
        `${where}\n--- the page shows:\n${expected.join('\n')}\n--- the binary printed:\n${printed.join('\n')}`,
      ).toBe(true);
    }
  });

  it('reads the four commands the page publishes, each with what it printed', () => {
    // NON-VACUITY. A block the reader stopped finding would make the case above hold over no
    // command at all.
    const block = theBlock();
    expect(block.map((one) => one.argv[1])).toEqual(['init', 'decision', 'search', 'verify']);
    expect(block.every((one) => one.shown.length > 0)).toBe(true);
    // The continuation was read as the shell reads it: the rationale is one word.
    expect(block[1]?.argv).toHaveLength(4);
  });
});

describe('what the comparison allows, on lines of its own', () => {
  const printed = ['one', 'two: 3 things', 'three'];

  it('takes the whole output shown', () => {
    expect(accountsFor(['one', 'two: 3 things', 'three'], printed)).toBe(true);
  });

  it('refuses a line left out without a mark, and a line shown that was not printed', () => {
    expect(accountsFor(['one', 'three'], printed)).toBe(false);
    expect(accountsFor(['one', 'two: 3 things', 'three', 'four'], printed)).toBe(false);
    expect(accountsFor(['three', 'one', 'two: 3 things'], printed)).toBe(false);
  });

  it('takes a cut the page marks, inside a line or as whole lines', () => {
    expect(accountsFor(['one', 'two: …', 'three'], printed)).toBe(true);
    expect(accountsFor(['one', '…'], printed)).toBe(true);
    expect(accountsFor(['…', 'three'], printed)).toBe(true);
  });

  it('refuses a mark where nothing was cut, and a shortened line that says other words', () => {
    expect(accountsFor(['one', '…', 'two: 3 things', 'three'], printed)).toBe(false);
    expect(accountsFor(['one', 'two: 4…', 'three'], printed)).toBe(false);
  });

  it('reads an id, a date and a path as what they are, on both sides alike', () => {
    const line =
      'Recorded 01a0af84-7eab-7000-8888-79c0dd5690e2 on 2026-09-17 by 9dd8d3df18299a40 in /tmp/x/your-repository/.mnema';
    expect(asShape(line, '/tmp/x/your-repository')).toBe(
      'Recorded <uuid> on <date> by <hex> in /path/to/repo/.mnema',
    );
  });
});
