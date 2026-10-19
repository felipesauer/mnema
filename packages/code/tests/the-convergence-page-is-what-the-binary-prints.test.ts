/**
 * THE TWO MACHINES THE CONVERGENCE PAGE SHOWS ARE TWO MACHINES THE BINARY RUNS — every command of
 * the example, in order, and every line it printed.
 *
 * WHAT WOULD GO UNREAD WITHOUT IT. The page says what `show`, `brief` and `verify` print when two
 * machines moved one decision apart. Those are sentences about the product's output, and the
 * product's output moves: `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts` reads the
 * page's verbs and flags and drops every `#>` line, and the first-record case holds one block of
 * one other page. A divergence line reworded, or `verify` starting to call the disagreement a
 * break, would leave this page saying what the binary no longer does.
 *
 * WHAT IS CHECKED. The page's blocks under {@link SECTION} run in a sandbox of their own, as the
 * shell reads them: `mkdir`, `cd`, `git` and `export MNEMA_HOME="$PWD/…"` are carried out, and each
 * `mnema` command runs through the built binary with its own `HOME` and the `MNEMA_HOME` the page
 * last exported. The `#>` lines under a command are held to what it printed, standard output and
 * standard error together, in the order a terminal shows them — the divergence line `show` writes
 * ahead of the record is on the error stream. A mark of a cut and what a run mints are read by the
 * one reading every such case shares (`support/a-page-held-to-a-run.ts`). And after the page's last
 * line, the second machine is asked the three questions the first was, and its answers are held
 * equal to the first machine's, byte for byte: two machines that hold both tails read the same.
 *
 * WHAT IT DOES NOT CHECK:
 *   - the prose around the blocks, and the sentence that Ana's clock running ahead would end the
 *     page in `rejected`: the order across tails is held by `many-tails.properties.test.ts`;
 *   - a move the workflow does not allow. The product's commands cannot write one, so the page
 *     describes it and links the cases that do (`the-census-names-a-move-the-workflow-does-not-allow`).
 */

import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountsFor, asMinted } from './support/a-page-held-to-a-run.js';
import { read } from './support/published-examples.js';
import { argvOf } from './support/reading-a-shell-line.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const PAGE = 'docs/convergence.md';
const SECTION = '## Two machines, one decision';

/** One line of a block the page publishes, as the shell would meet it. */
type Line =
  | {
      readonly kind: 'mnema';
      readonly at: number;
      readonly argv: readonly string[];
      shown: string[];
    }
  | { readonly kind: 'git'; readonly at: number; readonly argv: readonly string[] }
  | { readonly kind: 'cd'; readonly at: number; readonly to: string }
  | { readonly kind: 'mkdir'; readonly at: number; readonly dir: string }
  | { readonly kind: 'export'; readonly at: number; readonly name: string; readonly rel: string };

/** Every fenced line under {@link SECTION}, up to the next `##`, read into what the shell does with it. */
function theBlocks(): readonly Line[] {
  const lines = read(PAGE).split('\n');
  const from = lines.indexOf(SECTION);
  if (from < 0) throw new Error(`${PAGE} no longer carries "${SECTION}"`);
  const found: Line[] = [];
  let fenced = false;
  for (let at = from + 1; at < lines.length; at += 1) {
    const source = lines[at] as string;
    if (source.startsWith('## ')) break;
    if (source.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (!fenced || !source.trim()) continue;
    const here = at + 1;
    if (source.startsWith('#>')) {
      const last = found.at(-1);
      if (last?.kind !== 'mnema')
        throw new Error(`${PAGE}:${here} shows output under no mnema command`);
      last.shown.push(source.replace(/^#> ?/, ''));
    } else if (source.startsWith('#')) {
    } else if (source.startsWith('mnema ')) {
      found.push({ kind: 'mnema', at: here, argv: argvOf(source), shown: [] });
    } else if (source.startsWith('git ')) {
      found.push({ kind: 'git', at: here, argv: argvOf(source) });
    } else if (source.startsWith('cd ')) {
      found.push({ kind: 'cd', at: here, to: source.slice(3).trim() });
    } else if (source.startsWith('mkdir ')) {
      found.push({ kind: 'mkdir', at: here, dir: source.slice(6).trim() });
    } else {
      const exported = /^export (\w+)="\$PWD\/(.+)"$/.exec(source);
      if (exported === null)
        throw new Error(`${PAGE}:${here} is a line this case does not read: ${source}`);
      found.push({
        kind: 'export',
        at: here,
        name: exported[1] as string,
        rel: exported[2] as string,
      });
    }
  }
  return found;
}

let sandbox: string;
let home: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-convergence-'));
  home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The environment of a command: nothing of the real one but `PATH`, and a `HOME` of the sandbox's. */
function envOf(keyRoot: string | undefined): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Ana',
    GIT_AUTHOR_EMAIL: 'ana@example.com',
    GIT_COMMITTER_NAME: 'Ana',
    GIT_COMMITTER_EMAIL: 'ana@example.com',
    ...(keyRoot === undefined ? {} : { MNEMA_HOME: keyRoot }),
  };
}

/** What a command printed on both streams, in the order they were written. */
function printedBy(argv: readonly string[], cwd: string, keyRoot: string | undefined) {
  const out = join(sandbox, 'printed.txt');
  const fd = openSync(out, 'w');
  const ran = spawnSync(process.execPath, [CLI, ...argv.slice(1)], {
    cwd,
    env: envOf(keyRoot),
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  return { status: ran.status, text: readFileSync(out, 'utf-8') };
}

/** A line as a shape: what the machine minted replaced by what it is, the sandbox's path by the page's. */
function asShape(line: string): string {
  return asMinted(line.split(sandbox).join('/two-machines'));
}

let cwd: string;
let keyRoot: string | undefined;
let ana: string;
let bob: string;
let ranTheOnes: number;

describe('the two machines the convergence page shows', () => {
  it('print what the page says, line for line, cut only where the page says so', () => {
    cwd = sandbox;
    ranTheOnes = 0;
    for (const line of theBlocks()) {
      const where = `${PAGE}:${line.at}`;
      if (line.kind === 'mkdir') {
        mkdirSync(resolve(cwd, line.dir), { recursive: true });
      } else if (line.kind === 'cd') {
        cwd = resolve(cwd, line.to);
      } else if (line.kind === 'export') {
        keyRoot = resolve(cwd, line.rel);
        mkdirSync(keyRoot, { recursive: true });
      } else if (line.kind === 'git') {
        const ran = spawnSync('git', line.argv.slice(1), {
          cwd,
          env: envOf(undefined),
          encoding: 'utf-8',
        });
        expect(ran.status, `${where} ${line.argv.join(' ')}: ${ran.stderr}`).toBe(0);
      } else {
        const ran = printedBy(line.argv, cwd, keyRoot);
        expect(ran.status, `${where} ${line.argv.join(' ')} failed:\n${ran.text}`).toBe(0);
        const printed = ran.text.replace(/\n$/, '').split('\n').map(asShape);
        const expected = line.shown.map(asShape);
        expect(
          accountsFor(expected, printed),
          `${where} ${line.argv.join(' ')}\n--- the page shows:\n${expected.join('\n')}\n--- the binary printed:\n${printed.join('\n')}`,
        ).toBe(true);
        ranTheOnes += 1;
      }
    }
    ana = join(sandbox, 'two-machines', 'ana');
    bob = join(sandbox, 'two-machines', 'bob');
  });

  it('shows the second machine what the first was shown', () => {
    // The page ends on the first machine. The second pulled the first before it did, and holds
    // both tails: it is asked what the first was, and answers the same.
    const ask = (dir: string, key: string) =>
      (['show ADR-1', 'brief', 'verify'] as const).map(
        (verb) => printedBy(['mnema', ...verb.split(' ')], dir, key).text,
      );
    const first = ask(ana, join(sandbox, 'two-machines', 'ana-home'));
    const second = ask(bob, join(sandbox, 'two-machines', 'bob-home'));
    expect(first[0]).toContain('left proposed more than once: to rejected, then accepted');
    expect(second).toEqual(first);
  });

  it('reads a move time the page cut the same on any day the binary prints it', () => {
    // The page shows the day it was written; the binary prints the day it runs. The reading must
    // not tell them apart, and must still tell a timestamp from another shape.
    const shown = ['reject · 2026-10-16T…'].map(asMinted);
    expect(accountsFor(shown, ['reject · 2031-01-02T03:04:05.678Z'].map(asMinted))).toBe(true);
    expect(accountsFor(shown, ['reject · 02/01/2031 03:04'].map(asMinted))).toBe(false);
  });

  it('read the block it holds the page to', () => {
    // NON-VACUITY. A page whose blocks stopped being found would make the case above hold over
    // no command at all.
    const commands = theBlocks().flatMap((line) =>
      line.kind === 'mnema' ? [line.argv.slice(1, 4).join(' ')] : [],
    );
    expect(commands).toEqual([
      'init',
      'decision record Use SQLite for the cache',
      'init',
      'decision move reject',
      'decision move accept',
      'show ADR-1',
      'brief',
      'verify',
    ]);
    expect(ranTheOnes).toBe(commands.length);
  });
});
