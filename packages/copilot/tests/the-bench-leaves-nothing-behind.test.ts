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
 * filesystem whether it is still there. That needs two tests, because a test cannot watch its
 * own cleanup: `onTestFinished` fires after the test body has returned and before the next test
 * starts, so the first case below records what appeared and the second reads whether it went.
 * The order matters and is not incidental — if these are ever reordered or run in isolation, the
 * second becomes an assertion about nothing, which is why it refuses to run without the first.
 */

import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBench } from './support/chain.js';

/** The prefix `makeBench` builds under, restated here so a rename of it turns this case red. */
const A_BENCH_SANDBOX = 'mnema-copilot-';

const sandboxesNow = (): readonly string[] =>
  readdirSync(tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(A_BENCH_SANDBOX))
    .map((entry) => entry.name);

/** What the first case saw appear. `null` until it has run — see the header on ordering. */
let appeared: string | null = null;

describe('the bench leaves nothing behind', () => {
  it('makes a directory under the machine’s temp, and this case can name it', () => {
    const before = new Set(sandboxesNow());
    const bench = makeBench();

    const fresh = sandboxesNow().filter((name) => !before.has(name));
    // NOT VACUOUS: if `makeBench` stopped using tmpdir, or used a different prefix, the case
    // below would be asking whether a directory that never existed still exists — and would
    // pass. Naming exactly one new directory is what earns the right to ask.
    expect(fresh, 'makeBench did not create exactly one new sandbox under tmpdir()').toHaveLength(
      1,
    );
    appeared = join(tmpdir(), fresh[0] as string);

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
