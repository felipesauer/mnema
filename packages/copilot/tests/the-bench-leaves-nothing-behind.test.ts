/**
 * THE BENCH LEAVES NOTHING BEHIND — watched on the real `/tmp`, by path.
 *
 * WHY THIS EXISTS BESIDE THE STRUCTURAL CASE. `every-sandbox-is-removed-where-it-was-made.test.ts`
 * reads every file in the workspace and asks whether a file that makes a sandbox under `tmpdir()`
 * also removes one. That question is answerable by reading, and it is the question that would
 * have gone red on this defect — but it is answered by the FILE, not by the PATH, and the defect
 * had a second half the file cannot see: fifteen caller files removed `bench.root`, the chain
 * root several levels inside the sandbox, and every one of them satisfied a rule about removal.
 * The sandbox itself outlived all of them: 296 per suite run, 47.237 in `/tmp` when an audit
 * finally counted.
 *
 * SO THIS ONE FOLLOWS THE PATH. It names the directory `makeBench` created, and then asks the
 * filesystem whether it is still there.
 *
 * IT USED TO NAME IT BY A DIFF OF `tmpdir()`, AND THAT WAS A RACE. The first case listed the
 * sandboxes before and after the call and required exactly ONE new one — but vitest runs several
 * files at once and every one of them makes a sandbox under this same prefix, so a second worker's
 * directory appearing inside that window was attributed to this call and the length assertion
 * reddened. Measured on the trunk it shipped on: six of six runs of this package alone, and two
 * of three full-suite runs. The sandbox is now derived from the bench's OWN root, which belongs to
 * this call and to nothing else; the before-set is kept, because it is what still proves the
 * directory is NEW rather than one somebody else owns. That needs two tests, because a test cannot watch its
 * own cleanup: `onTestFinished` fires after the test body has returned and before the next test
 * starts, so the first case below records what appeared and the second reads whether it went.
 * The order matters and is not incidental — if these are ever reordered or run in isolation, the
 * second becomes an assertion about nothing, which is why it refuses to run without the first.
 */

import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBench } from './support/chain.js';

/** The prefix `makeBench` builds under, restated here so a rename of it turns this case red. */
const A_BENCH_SANDBOX = 'mnema-copilot-';

const sandboxesNow = (): readonly string[] =>
  readdirSync(tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(A_BENCH_SANDBOX))
    .map((entry) => entry.name);

/**
 * The sandbox a chain root lives in: the first segment under `tmpdir()`, when it is one
 * of ours. `null` when the root is not under a sandbox of this prefix at all, which is
 * the case that must fail rather than pass quietly.
 */
function sandboxOf(root: string): string | null {
  const inside = relative(tmpdir(), root);
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
    const before = new Set(sandboxesNow());
    const bench = makeBench();

    // NOT VACUOUS, in the two ways it has to be: if `makeBench` stopped using tmpdir, or
    // used a different prefix, the root is under no sandbox of ours and this is null — and
    // the case below would otherwise be asking whether a directory that never existed still
    // exists, and would pass.
    const sandbox = sandboxOf(bench.root);
    expect(
      sandbox,
      `the chain root ${bench.root} is under no ${A_BENCH_SANDBOX} sandbox in ${tmpdir()}`,
    ).not.toBeNull();
    // And it has to be NEW. A root inside a directory that was already there would be a
    // sandbox this call did not make, so its removal would be somebody else's business.
    expect(before.has(sandbox as string), `${sandbox} was already there before makeBench ran`).toBe(
      false,
    );
    expect(sandboxesNow(), `${sandbox} is not under ${tmpdir()}`).toContain(sandbox);
    appeared = join(tmpdir(), sandbox as string);

    // The bench is real and usable, and the directory just named is the one it is built in —
    // otherwise this measures the cleanup of something other than the sandbox under test.
    expect(existsSync(bench.root), 'the chain root the bench reports does not exist').toBe(true);
    expect(
      bench.root.startsWith(appeared),
      `the chain root ${bench.root} is not inside the sandbox ${appeared}`,
    ).toBe(true);
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
