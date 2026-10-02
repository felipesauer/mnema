/**
 * THE BENCH LEAVES NOTHING BEHIND — watched under the real `/tmp`, by path.
 *
 * WHY THIS EXISTS BESIDE THE STRUCTURAL CASE. `every-sandbox-is-removed-where-it-was-made.test.ts`
 * reads every file in the workspace and asks whether a file that makes a sandbox under `tmpdir()`
 * also removes one. That question is answerable by reading, and it is the question that would
 * have gone red on this defect. The defect had a second half: fifteen caller files removed
 * `bench.root`, the chain root several levels inside the sandbox, and every one of them satisfied
 * a rule about removal. The sandbox itself outlived all of them: 296 per suite run, 47.237 in
 * `/tmp` when an audit finally counted.
 *
 * THIS PARAGRAPH USED TO SAY THAT QUESTION WAS ANSWERED *"by the FILE, not by the PATH"*, and that
 * is no longer what the structural case does. It now follows the created NAME to the removal that
 * reaches it — through a loop, a collection, or the field a helper returns it as — so the shape
 * this file's second half describes (`rmSync(join(sandbox, 'chain'))`, aimed inside rather than at)
 * is caught by reading, in one file, and has a case of its own there. What survives of the old
 * division of labour is narrower and worth naming: the structural case reads ONE file at a time,
 * so a sandbox made in one file and removed in another is still beyond it, and that is exactly
 * `makeBench` and its callers.
 *
 * SO THIS ONE FOLLOWS THE PATH ACROSS FILES. It names the directory `makeBench` created, and then
 * asks the filesystem whether it is still there. It does that for ONE of the 187 prefixes this
 * workspace builds under — the one whose helper hands back a root the sandbox can be derived from.
 * The other 186 are swept by `.github/what-the-suite-left-behind/`, from outside the suite, for
 * the reason the paragraph below gives.
 *
 * IT USED TO NAME IT BY A DIFF OF `tmpdir()`, AND THAT WAS A RACE. The first case listed the
 * sandboxes before and after the call and required exactly ONE new one — but vitest runs several
 * files at once and every one of them makes a sandbox under this same prefix, so a second worker's
 * directory appearing inside that window was attributed to this call and the length assertion
 * reddened. Measured on the trunk it shipped on: six of six runs of this package alone, and two
 * of three full-suite runs. The sandbox was then derived from the bench's OWN root, which belongs
 * to this call and to nothing else, and a before-set was kept to prove the directory NEW.
 *
 * AND THE BEFORE-SET WAS A LISTING OF THE WHOLE OF `/tmp`, which is the second thing this case
 * had to stop doing. `readdirSync(tmpdir())` reads every entry of a directory nobody here owns:
 * 58,522 of them on the machine this was rewritten on, where one listing took 6.7 s cold and
 * 77–85 ms warm. Inside a busy suite the case ran 7.4–10.7 s against 0.6–0.7 s on its own, and
 * went red at the five-second ceiling in two verifications of one week — a red about the
 * machine's `/tmp`, not about the bench. So while `makeBench` runs, `tmpdir()` answers with a
 * directory this file made for itself under the real one ({@link withTmpdir}); `makeBench` asks
 * `tmpdir()` at the moment it is called, so it is the same code on the same path. What proves the
 * sandbox NEW is now stronger than the diff was: this file's directory is empty until the call,
 * and the call has to leave exactly one thing in it.
 *
 * That needs two tests, because a test cannot watch its own cleanup: `onTestFinished` fires after
 * the test body has returned and before the next test starts, so the first case below records
 * what appeared and the second reads whether it went. The order matters and is not incidental —
 * if these are ever reordered or run in isolation, the second becomes an assertion about nothing,
 * which is why it refuses to run without the first.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeBench } from './support/chain.js';

/** The prefix `makeBench` builds under, restated here so a rename of it turns this case red. */
const A_BENCH_SANDBOX = 'mnema-context-';

/**
 * The directory `tmpdir()` answers with while the bench is made: this file's own, under the
 * machine's temp. It carries the bench's prefix so the sweep of `/tmp` counts it in the family it
 * already watches, rather than as a prefix of its own.
 */
let own: string;

beforeAll(() => {
  own = mkdtempSync(join(tmpdir(), A_BENCH_SANDBOX));
});

afterAll(() => {
  rmSync(own, { recursive: true, force: true });
});

/**
 * Runs `make` with `tmpdir()` pointed at `dir`, and puts the environment back whatever happens.
 * `tmpdir()` reads `TMPDIR` on every call, so this redirects exactly the calls made inside.
 */
function withTmpdir<T>(dir: string, make: () => T): T {
  const before = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    return make();
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
}

/**
 * The sandbox a chain root lives in: the first segment under `dir`, when it is one of ours.
 * `null` when the root is not under a sandbox of this prefix at all, which is the case that
 * must fail rather than pass quietly.
 */
function sandboxOf(root: string, dir: string): string | null {
  const inside = relative(dir, root);
  const first = inside.split(sep)[0];
  if (first === undefined || first === '' || first === '..' || !first.startsWith(A_BENCH_SANDBOX)) {
    return null;
  }
  return first;
}

/** What the first case saw appear. `null` until it has run — see the header on ordering. */
let appeared: string | null = null;

describe('the bench leaves nothing behind', () => {
  it('makes a directory under the machine’s temp, and this case can name it', () => {
    // Nothing is in this file's directory before the call, so whatever is there after it is
    // what the call made — the NEW this case has to prove, without reading anybody else's.
    expect(readdirSync(own), `${own} was not empty before makeBench ran`).toEqual([]);
    const bench = withTmpdir(own, () => makeBench());

    // NOT VACUOUS, in the two ways it has to be: if `makeBench` stopped using tmpdir, or
    // used a different prefix, the root is under no sandbox of ours and this is null — and
    // the case below would otherwise be asking whether a directory that never existed still
    // exists, and would pass.
    const sandbox = sandboxOf(bench.root, own);
    expect(
      sandbox,
      `the chain root ${bench.root} is under no ${A_BENCH_SANDBOX} sandbox in ${own}`,
    ).not.toBeNull();
    // And it is the ONE thing the call left, so it is a sandbox this call made and its removal
    // is this bench's business and nobody else's.
    expect(readdirSync(own), `makeBench left more than its sandbox in ${own}`).toEqual([sandbox]);
    appeared = join(own, sandbox as string);

    // The bench is real and usable, and the directory just named is the one it is built in —
    // otherwise this measures the cleanup of something other than the sandbox under test.
    expect(existsSync(bench.root), 'the chain root the bench reports does not exist').toBe(true);
    expect(
      bench.root.startsWith(appeared),
      `the chain root ${bench.root} is not inside the sandbox ${appeared}`,
    ).toBe(true);
    // And the environment is the suite's again: a `TMPDIR` left pointing here would move every
    // sandbox made after this case into a directory `afterAll` removes.
    expect(tmpdir()).not.toBe(own);
  });

  it('removes it when the test that made it finishes', () => {
    expect(
      appeared,
      'the case that names the sandbox did not run — this one cannot speak without it',
    ).not.toBeNull();
    expect(
      existsSync(appeared as string),
      `the sandbox ${appeared} outlived the test that made it — every run of the suite leaves one behind`,
    ).toBe(false);
  });
});
