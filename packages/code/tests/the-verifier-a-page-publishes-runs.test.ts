/**
 * THE VERIFIER THE ROOT PAGE PUBLISHES IS A VERIFIER THAT RUNS — and prints what the page
 * says it prints.
 *
 * WHAT WAS UNCHECKED, AND WHAT IT COST. `README.md` sells the second reader in its opening
 * sentence and publishes two lines to reach it: a `git clone`, and a `python3` invocation
 * whose last argument was `path/to/a/repo/.mnema`. A reader who copied both got
 * `THE VERIFIER BROKE: there is no record at …` and exit 3 — because the path is a
 * PLACEHOLDER and a fresh clone carries no record to aim it at. The output the page
 * publishes under those lines is real; the lines were not runnable as published.
 *
 * WHY NO EXISTING GUARD REACHED IT, which is the shape worth keeping.
 * `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts` resolves every `mnema <verb>`
 * on every tracked page against the real command tree, and says in as many words that
 * "nothing is executed to find out" — it answers *does the verb exist?*. These two lines
 * are `git` and `python3`, somebody else's programs, so that guard correctly passes over
 * them. `the-converter-a-page-publishes-runs.test.ts` runs a published block, but only the
 * one on `packages/code/README.md` bounded by its markers. The one command this product
 * offers a stranger who does not want to install it was the one nothing ran.
 *
 * THE BROAD GUARD WAS CONSIDERED AND REFUSED, with its reason. The wide form — sweep every
 * published block for placeholder shapes (`path/to/`, `your-`, `<…>`) and accuse them — is
 * born with an exception: `README.md` publishes `cd your-repository` twelve lines above
 * this block, deliberately and correctly, because there the placeholder IS the
 * instruction. A guard that must be taught which placeholders are allowed is a list of
 * this page's lines wearing a rule's clothes, and a new instrument in this workspace has
 * already gone wrong by accusing. So the narrow form: RUN the published line, and let the
 * page's own expected output be the assertion.
 *
 * WHAT IS SUBSTITUTED, AND WHAT IS NOT. Exactly the two things a reader substitutes: the
 * clone's directory (this workspace IS the clone) and the placeholder path (a record this
 * test founds). Everything else — the script's location inside the tree, the `record`
 * subcommand, the argument order — runs as published. The expected lines are LIFTED from
 * the page rather than restated here, so a page that changes its promised output and a
 * verifier that changes its actual one cannot drift apart quietly.
 *
 * THE RECORD IT IS AIMED AT IS THE ONE THE PAGE TEACHES, and that is not a detail: the
 * published `checks: 11 ok … 4 note` is true of a record founded by `mnema init` AND
 * carrying one decision, which is exactly the sequence the section above it publishes.
 * Measured on 21/09/2026: `init` alone verifies at `9 ok, 4 note`. So this case founds the
 * page's own first record, and a page whose two halves stopped agreeing goes red here.
 *
 * WHAT IT DOES NOT CHECK. The `git clone` line: it reaches the network, and a guard that
 * cloned would go red because GitHub was slow. What it stands on instead is that the path
 * under test is the same relative path inside the tree that a clone produces. Nor does it
 * check the verifier's own correctness — four cases under `packages/chain/src/chain/`
 * (`second-reader-agrees-on-the-record` and its siblings) own that. This one checks that
 * the PAGE and the verifier say the same thing.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from '../src/commands/decision.js';
import { runInit } from '../src/commands/init.js';
import { ROOT, read } from './support/published-examples.js';

/** The page that sells the second reader, and the heading the block lives under. */
const PAGE = 'README.md';
const SECTION = '## Checking a record without installing this';

/** The placeholder the page publishes, which is the one thing a reader must replace. */
const PLACEHOLDER = '/path/to/a/repo/.mnema';

/** The directory a `git clone` of this repository leaves behind. */
const CLONE_DIR = 'mnema/';

/**
 * The published block: the command line, and the output the page promises under it.
 *
 * It throws rather than returning empty when the section or the fence is gone, because a
 * guard that silently ran nothing would be a guard reporting that a command it never
 * executed works.
 */
function publishedVerifierBlock(): { command: string; expected: string[] } {
  const page = read(PAGE);
  const from = page.indexOf(SECTION);
  if (from < 0) throw new Error(`${PAGE} no longer carries "${SECTION}"`);
  const fence = /```sh\n([\s\S]*?)```/.exec(page.slice(from));
  if (fence === null) throw new Error(`${PAGE} carries "${SECTION}" but publishes no sh block`);
  const lines = (fence[1] as string).split('\n');
  const command = lines.find((one) => one.startsWith('python3 '));
  if (command === undefined)
    throw new Error(`${PAGE} publishes no python3 line under "${SECTION}"`);
  const expected = lines.filter((one) => one.startsWith('#> ')).map((one) => one.slice(3));
  if (expected.length === 0)
    throw new Error(`${PAGE} publishes the command with no expected output`);
  return { command, expected };
}

/** Runs the published line, with the reader's two substitutions made and nothing else. */
function runPublished(recordPath: string): { out: string; status: number } {
  const { command } = publishedVerifierBlock();
  const argv = command
    .slice('python3 '.length)
    .replace(CLONE_DIR, `${ROOT}/`)
    .replace(PLACEHOLDER, recordPath)
    .split(' ');
  try {
    return { out: execFileSync('python3', argv, { encoding: 'utf8' }), status: 0 };
  } catch (thrown) {
    const failure = thrown as { stdout?: string; status?: number };
    return { out: failure.stdout ?? '', status: failure.status ?? -1 };
  }
}

describe('the verifier the root page publishes', () => {
  let sandbox: string;

  beforeEach(() => {
    // A6: its own directory, destroyed after. Nothing is written to the working tree.
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-published-verifier-'));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  /** The page's own first record: `mnema init`, then one decision. */
  function theFirstRecord(): string {
    const repo = join(sandbox, 'repo');
    const home = join(sandbox, 'home');
    mkdirSync(repo, { recursive: true });
    mkdirSync(home, { recursive: true });
    const ctx = { cwd: repo, env: { home, xdgData: join(home, '.local', 'share') } };
    runInit(ctx);
    const said = runDecision(ctx, {
      title: 'Use SQLite for the projection cache',
      rationale: 'It is embedded, it is fast enough at our sizes, and it needs no service.',
    });
    expect(said.ok, 'the page’s own first record would not be written').toBe(true);
    return join(repo, '.mnema');
  }

  it('runs as published, and prints the lines the page promises under it', () => {
    const { out, status } = runPublished(theFirstRecord());
    for (const line of publishedVerifierBlock().expected) {
      expect(out, `the page promises "${line}" and the verifier did not print it`).toContain(line);
    }
    expect(status).toBe(0);
  });

  it('is right to break on the placeholder, which is what the page now says it does', () => {
    // The other half, and the reason the prose beside the block was rewritten: copied with
    // the placeholder still in it, the command is not silently wrong — it names the path it
    // could not find and exits 3. A page that went back to promising success here would
    // leave this red.
    const { out, status } = runPublished(join(sandbox, 'nothing-was-ever-here', '.mnema'));
    expect(out).toContain('THE VERIFIER BROKE: there is no record at');
    expect(out).toContain('VERDICT: BROKEN');
    expect(status).toBe(3);
  });
});
