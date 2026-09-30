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
import { accountsFor, asMinted, blockUnder } from './support/a-page-held-to-a-run.js';
import { read } from './support/published-examples.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The page, and the heading the block lives under. */
const PAGE = 'README.md';
const SECTION = '## Your first record';

/** One command of the block, and the lines the page shows under it. */
interface Shown {
  readonly at: number;
  readonly argv: readonly string[];
  readonly shown: readonly string[];
}

/**
 * The block under {@link SECTION}: its commands, each with the `#>` lines under it, read by the
 * one reading every case that holds a page's block to a run shares (`blockUnder`). This block
 * sets no shell variable, so every step is a command.
 */
function theBlock(): readonly Shown[] {
  return blockUnder(PAGE, SECTION).flatMap((step) => (step.kind === 'command' ? [step] : []));
}

/**
 * A line as a SHAPE: what belongs to the machine replaced by what it is. Both sides are read
 * through this one function, so neither can be made to agree by a replacement the other did
 * not get. What counts as minted is read in one place for every case that holds this page to a
 * run (`support/a-page-held-to-a-run.ts`); the repository's path is this block's own.
 */
function asShape(line: string, repo: string): string {
  return asMinted(line.split(repo).join('/path/to/repo'));
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

  it('says how long the id it shortens runs, and it runs that long', () => {
    // THE ONE NUMBER THE BLOCK STATES OF ITSELF, held to the binary: the page's own comment says
    // what its `…` shortens, and a comment that said the wrong length would be the one line of the
    // block nothing read.
    const said = /an id that runs to (\d+) hex characters/.exec(read(PAGE));
    expect(said, `${PAGE} no longer says how long the id it shortens runs`).not.toBeNull();
    const ran = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: repo,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: home },
    });
    expect(ran.status, ran.stderr).toBe(0);
    const identity = /identity: mnid:([0-9a-f]+)/.exec(ran.stdout);
    expect(identity?.[1]).toHaveLength(Number(said?.[1]));
  });

  it('reads the four commands the page publishes, each with what it printed', () => {
    // NON-VACUITY. A block the reader stopped finding would make the case above hold over no
    // command at all.
    const block = theBlock();
    expect(block.map((one) => one.argv[1])).toEqual(['init', 'decision', 'search', 'verify']);
    expect(block.every((one) => one.shown.length > 0)).toBe(true);
    // The continuation was read as the shell reads it: the rationale is one word.
    expect(block[1]?.argv).toHaveLength(5);
    expect(block[1]?.argv[2]).toBe('record');
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
