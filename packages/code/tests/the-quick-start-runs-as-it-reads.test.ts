// @reads-the-tree
/**
 * THE QUICK START ON THE FRONT PAGE RUNS AS IT IS WRITTEN: every `mnema` line of its first
 * block, in order, through the built binary, in a repository and a home of their own.
 *
 * WHAT WAS UNCHECKED, AND WHAT IT HID. The Quick start was the first thing a stranger types and
 * the one block nothing RAN. `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts` reads
 * its verbs and flags, and `the-command-handed-over-runs-as-handed.test.ts` parses each line,
 * but neither executes one: a block that needed an `<id>` copied from the line before, a rule
 * addressed at a flag that had been renamed, or an `accept` aimed at an id a new record does
 * not mint would all have passed them and failed the person at their third line.
 *
 * WHAT IS CHECKED. The first fenced block under `## Quick start` is read by the one reading
 * every case that holds a page to a run shares (`blockUnder`), and each command runs in order in
 * a sandbox (its own `HOME`, a `git init` repository):
 *   - each exits 0 and prints nothing on stderr;
 *   - `mnema link` says the relation and the path it was given;
 *   - `mnema verify` says `local integrity verified`;
 *   - and the verbs read are exactly `init`, `decision record`, `decision move`, `link` and
 *     `verify`, in that order, so a block the reader stopped finding fails here by name and a
 *     step that went missing cannot pass unnoticed.
 *
 * WHAT IT DOES NOT CHECK:
 *   - the lines that are not `mnema` (`npm i -g`, `cd`): they are the reader's, not the
 *     binary's, and the second block's `claude plugin` lines likewise;
 *   - what the page SAYS about the output: that is the prose around the block.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blockUnder } from './support/a-page-held-to-a-run.js';

/** The built binary: what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const PAGE = 'README.md';
const SECTION = '## Quick start';

/** The verbs the block teaches, in the order it teaches them. */
const VERBS = ['init', 'decision record', 'decision move', 'link', 'verify'];

/** The words after `mnema` that name the verb: the command and, for a group, its subcommand. */
const verbOf = (argv: readonly string[]): string =>
  argv[1] === 'decision' ? `decision ${argv[2]}` : (argv[1] as string);

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-quick-start-'));
  repo = join(sandbox, 'your-repository');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the Quick start on the front page', () => {
  it('runs as it is written: each command exits 0, and the link and the verify say what the page leans on', () => {
    // A ruler that cannot run is not a ruler that passes.
    if (!existsSync(CLI)) {
      throw new Error(`RULER BROKEN: the built binary is not at ${CLI}, so no line was run`);
    }
    const commands = blockUnder(PAGE, SECTION).flatMap((step) =>
      step.kind === 'command' ? [step] : [],
    );
    if (commands.length === 0) {
      throw new Error(`RULER BROKEN: no mnema command was read under "${SECTION}" in ${PAGE}`);
    }
    const out: Record<string, string> = {};
    for (const { at, argv } of commands) {
      const ran = spawnSync(process.execPath, [CLI, ...argv.slice(1)], {
        cwd: repo,
        encoding: 'utf-8',
        env: { PATH: process.env.PATH ?? '', HOME: home },
      });
      const where = `${PAGE}:${at} ${argv.join(' ')}`;
      expect(ran.status, `${where} failed: ${ran.stderr}${ran.stdout}`).toBe(0);
      expect(ran.stderr, `${where} printed on stderr`).toBe('');
      out[verbOf(argv)] = ran.stdout;
    }
    // The page calls the linked decision "a rule in force": the move it teaches has to accept it.
    expect(out['decision move']).toContain('→ accepted');
    expect(out.link).toContain('refuses-a-write');
    expect(out.link).toContain('src/billing');
    expect(out.verify).toContain('local integrity verified');
  });

  it('teaches exactly init, decision record, decision move, link and verify, in that order', () => {
    // NON-VACUITY. A block that stopped being found, or lost a step, would make the case above
    // hold over fewer commands than the page promises.
    const commands = blockUnder(PAGE, SECTION).flatMap((step) =>
      step.kind === 'command' ? [step] : [],
    );
    expect(commands.map((one) => verbOf(one.argv))).toEqual(VERBS);
  });
});
