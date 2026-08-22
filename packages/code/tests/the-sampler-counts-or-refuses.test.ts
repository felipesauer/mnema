/**
 * THE SAMPLER COUNTS, OR IT SAYS IT BROKE. Never zero.
 *
 * WHERE THIS COMES FROM. `.github/flake-sampler/summarize.mjs` runs the suite N times against one
 * commit and publishes, per case, how many of those N runs it failed in. The number it produces
 * has one failure mode that matters more than every other: reading nothing and printing zero.
 * This bench has been bitten by that shape twice, in two different instruments — a mutation
 * matrix whose runner died on a flag it did not have and reported no survivors, and a parser that
 * read "0 failures" off a report that had never been written. Both were only caught because a
 * mutation that HAD to redden came back green.
 *
 * So the sampler is written refusal-first, and so is this. The counting cases below are the
 * smaller half of the file.
 *
 * THE REPORTS ARE REAL, not shapes invented from the documentation. Three captures sit beside
 * this file, produced by running this workspace's own vitest with the same reporter flags the
 * sampler's workflow uses:
 *
 *   - `all-passed.json` — five cases of `packages/chain/src/one-line.test.ts`, green;
 *   - `one-failed.json` — the same file with `116` mutated to expect the wrong export path, so
 *     one assertion fails, `numFailedTests` is 1 and the FILE's own status is `failed` too;
 *   - `no-test-files.json` — a run whose filter matched nothing. This is the dangerous one and it
 *     is a genuine capture: vitest writes the report file anyway, with `numTotalTests: 0`,
 *     `testResults: []` and `success: false`. Nothing about a suite that never ran is visible to
 *     a parser checking only that the file is there.
 *
 * The one thing edited in the captures is the absolute path prefix, rewritten from the machine
 * that produced them to `/home/runner/work/mnema/mnema` — which is the prefix the runner
 * genuinely writes, and which keeps a workstation path out of a public repository.
 *
 * WHAT THIS DOES NOT COVER, said out loud rather than left to be discovered. It does not run the
 * workflow: whether the six sampling jobs actually write files under the names the parser demands
 * is answered by the workflow running, and the first night is what answered it. It does not cover
 * the rendering of a page GitHub will accept as markdown, only that the two pages differ in the
 * one way that matters. And it says nothing about whether a rate the sampler prints is the rate
 * of a flake rather than of a case broken at that commit — that reading belongs to whoever opens
 * the page, and the sampler's own header says so.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EXIT,
  exitCodeOf,
  render,
  THE_FILE_ITSELF,
  THE_RUN_ITSELF,
  tally,
} from '../../../.github/flake-sampler/summarize.mjs';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The prefix the captures carry, which is what a runner writes. */
const RUNNER_ROOT = '/home/runner/work/mnema/mnema';

/** Where the three captures live. */
const HERE = fileURLToPath(new URL('.', import.meta.url));
const CAPTURE = {
  passed: join(HERE, 'the-sampler-counts-or-refuses.all-passed.json'),
  failed: join(HERE, 'the-sampler-counts-or-refuses.one-failed.json'),
  empty: join(HERE, 'the-sampler-counts-or-refuses.no-test-files.json'),
};

const sandboxes: string[] = [];

/** A sandbox this file makes and this file removes (A6). */
function sandbox(): string {
  const made = mkdtempSync(join(tmpdir(), 'mnema-sampler-'));
  sandboxes.push(made);
  return made;
}

afterEach(() => {
  while (sandboxes.length > 0) rmSync(sandboxes.pop() as string, { recursive: true, force: true });
});

/**
 * A night on disk: `plan` says which capture each run of each label got. Written under the names
 * the sampler demands, because the naming is half of what it refuses on.
 */
function night(plan: Record<string, ReadonlyArray<keyof typeof CAPTURE>>): string {
  const dir = join(sandbox(), 'reports');
  mkdirSync(dir);
  for (const [label, runs] of Object.entries(plan)) {
    runs.forEach((which, index) => {
      cpSync(
        CAPTURE[which],
        join(dir, `run--${label}--${String(index + 1).padStart(2, '0')}.json`),
      );
    });
  }
  return dir;
}

/** `n` copies of one capture, for a label whose runs are all alike. */
function all(which: keyof typeof CAPTURE, n: number): ReadonlyArray<keyof typeof CAPTURE> {
  return Array.from({ length: n }, () => which);
}

describe('the sampler counts what vitest wrote', () => {
  it('finds nothing in a night where every run passed, and says how many runs that was', () => {
    const dir = night({ node22: all('passed', 5), node24: all('passed', 5) });

    const result = tally({ dir, root: RUNNER_ROOT, expect: 10, perLabel: 5 });

    expect(result.verdict).toBe('CLEAN');
    expect(result.rows).toEqual([]);
    expect(result.read).toBe(10);
    expect(result.cases).toEqual({ least: 5, most: 5 });
    expect(exitCodeOf(result)).toBe(EXIT.CLEAN);
  });

  it('names the case, its file and its rate when it failed in some of the runs', () => {
    const dir = night({
      node22: ['failed', 'passed', 'passed', 'passed', 'failed'],
      node24: all('passed', 5),
    });

    const result = tally({ dir, root: RUNNER_ROOT, expect: 10, perLabel: 5 });

    expect(result.verdict).toBe('FLAKY');
    expect(result.rows).toHaveLength(1);
    const [row] = result.rows;
    expect(row.file).toBe('packages/chain/src/one-line.test.ts');
    expect(row.name).toBe(
      'the rule of the line needs nothing > is published on its own, so reaching it is not reaching the package',
    );
    expect(row.runs).toEqual(['node22#01', 'node22#05']);
    expect(render(result)).toContain('| 2 | 10 | 20.0% | node22#01, node22#05 |');
    expect(exitCodeOf(result)).toBe(EXIT.FLAKY);
  });

  /**
   * THE RATE IS OVER RUNS, and the difference is only visible when the two numbers disagree. A
   * count of assertions would read 2 here where the answer is 1, so both are asserted.
   */
  it('counts a run once even when one report names the same case failing twice', () => {
    const dir = night({ node22: all('passed', 3) });
    const twice = {
      numTotalTests: 2,
      success: false,
      testResults: [
        {
          name: `${RUNNER_ROOT}/packages/chain/src/one-line.test.ts`,
          status: 'failed',
          assertionResults: [
            {
              ancestorTitles: ['a group'],
              title: 'a case',
              status: 'failed',
              failureMessages: ['x'],
            },
            {
              ancestorTitles: ['a group'],
              title: 'a case',
              status: 'failed',
              failureMessages: ['x'],
            },
          ],
        },
      ],
    };
    writeFileSync(join(dir, 'run--node22--04.json'), JSON.stringify(twice));

    const result = tally({ dir, root: RUNNER_ROOT, expect: 4, perLabel: 4 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].runs).toEqual(['node22#04']);
  });

  /**
   * A FILE THAT NEVER GOT TO ITS CASES HAS NO CASE TO BLAME. Vitest reports it as a failed file
   * with an empty `assertionResults`, and a table keyed on cases alone prints a green night.
   */
  it('gives a file that failed with no case under it a row of its own', () => {
    const dir = night({ node22: all('passed', 2) });
    const collapsed = {
      numTotalTests: 3,
      success: false,
      testResults: [
        {
          name: `${RUNNER_ROOT}/packages/core/src/thing.test.ts`,
          status: 'failed',
          message: 'Error: Cannot find module',
          assertionResults: [],
        },
      ],
    };
    writeFileSync(join(dir, 'run--node22--03.json'), JSON.stringify(collapsed));

    const result = tally({ dir, root: RUNNER_ROOT, expect: 3, perLabel: 3 });

    expect(result.verdict).toBe('FLAKY');
    expect(result.rows).toEqual([
      { file: 'packages/core/src/thing.test.ts', name: THE_FILE_ITSELF, runs: ['node22#03'] },
    ]);
  });

  it('gives a run that failed while naming nothing a row of its own', () => {
    const dir = night({ node22: all('passed', 2) });
    const unattributed = { numTotalTests: 7, success: false, testResults: [] };
    writeFileSync(join(dir, 'run--node22--03.json'), JSON.stringify(unattributed));

    const result = tally({ dir, root: RUNNER_ROOT, expect: 3, perLabel: 3 });

    expect(result.verdict).toBe('FLAKY');
    expect(result.rows).toEqual([{ file: '(no file)', name: THE_RUN_ITSELF, runs: ['node22#03'] }]);
  });

  it('leaves a path outside the root it was given exactly as the report wrote it', () => {
    const dir = night({ node22: ['failed'] });

    const result = tally({ dir, root: join(ROOT, 'somewhere', 'else'), expect: 1, perLabel: 1 });

    expect(result.rows[0].file).toBe(`${RUNNER_ROOT}/packages/chain/src/one-line.test.ts`);
  });

  it('reports how many runs each label carried, so two labels can be compared', () => {
    const dir = night({
      node22: ['failed', 'passed', 'failed'],
      node24: all('passed', 3),
    });

    const page = render(tally({ dir, root: RUNNER_ROOT, expect: 6, perLabel: 3 }));

    expect(page).toContain('| `node22` | 3 | 2 |');
    expect(page).toContain('| `node24` | 3 | 0 |');
  });
});

describe('the sampler refuses rather than returning zero', () => {
  /**
   * THE MUTATION THE HANDOFF NAMED: point the parser at a report directory that is not there. A
   * zero here rather than a refusal is the finding, not the success.
   */
  it('refuses when the reports directory does not exist', () => {
    const dir = join(sandbox(), 'not-there');

    const result = tally({ dir, root: RUNNER_ROOT, expect: 30, perLabel: 10 });

    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.read).toBe(0);
    expect(result.rows).toEqual([]);
    expect(exitCodeOf(result)).toBe(EXIT.BROKEN);
    expect(result.broken.join('\n')).toContain('the reports directory could not be read');
  });

  it('refuses a report that ran no case at all, which is what vitest writes when it matches no file', () => {
    const dir = night({ node22: ['passed', 'empty', 'passed'] });

    const result = tally({ dir, root: RUNNER_ROOT, expect: 3, perLabel: 3 });

    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join('\n')).toContain('ran NO case at all');
    expect(result.broken.join('\n')).toContain('run--node22--02.json');
  });

  it('refuses when it read fewer runs than it was asked for', () => {
    const dir = night({ node22: all('passed', 9) });

    const result = tally({ dir, root: RUNNER_ROOT, expect: 10, perLabel: 10 });

    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken).toContain('asked for 10 runs and could read 9');
  });

  /**
   * THE IMBALANCE THE TOTAL HIDES. Twelve and eight add up to the twenty that was asked for, and
   * a sampler that only checks the total publishes a rate over a machine that ran two thirds of
   * the sample.
   */
  it('refuses when one label carries a different number of runs, even though the total is right', () => {
    const dir = night({ node22: all('passed', 12), node24: all('passed', 8) });

    const result = tally({ dir, root: RUNNER_ROOT, expect: 20, perLabel: 10 });

    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken).toContain('label "node22" carries 12 runs, not the 10 asked for');
    expect(result.broken).toContain('label "node24" carries 8 runs, not the 10 asked for');
  });

  it('refuses a report whose name carries no label and no sequence', () => {
    const dir = night({ node22: all('passed', 2) });
    cpSync(CAPTURE.passed, join(dir, 'vitest-report.json'));

    const result = tally({ dir, root: RUNNER_ROOT, expect: 3, perLabel: 3 });

    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join('\n')).toContain('does not carry a label and a sequence');
    expect(result.broken.join('\n')).toContain('vitest-report.json');
  });

  it('refuses the same label and sequence twice, which would count one run as two', () => {
    const dir = night({ node22: all('passed', 2) });
    mkdirSync(join(dir, 'nested'));
    cpSync(CAPTURE.passed, join(dir, 'nested', 'run--node22--01.json'));

    const result = tally({ dir, root: RUNNER_ROOT, expect: 2, perLabel: 2 });

    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join('\n')).toContain(
      'two reports claim the label and sequence "node22--01"',
    );
  });

  it('refuses a report that is not parseable JSON', () => {
    const dir = night({ node22: all('passed', 2) });
    writeFileSync(join(dir, 'run--node22--03.json'), '{ this is not json');

    const result = tally({ dir, root: RUNNER_ROOT, expect: 3, perLabel: 3 });

    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join('\n')).toContain('is not parseable JSON');
  });

  it('refuses a report missing the fields it counts', () => {
    const dir = night({ node22: all('passed', 2) });
    writeFileSync(join(dir, 'run--node22--03.json'), JSON.stringify({ ok: true }));

    const result = tally({ dir, root: RUNNER_ROOT, expect: 3, perLabel: 3 });

    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join('\n')).toContain('missing the fields this counts');
  });

  it.each([
    [
      'expect',
      { expect: 0, perLabel: 10 },
      '--expect must be a whole number of at least 1, and it was 0',
    ],
    [
      'per-label',
      { expect: 10, perLabel: Number.NaN },
      '--per-label must be a whole number of at least 1, and it was NaN',
    ],
  ])('refuses a --%s that is not a whole number of at least one', (_which, asked, said) => {
    const dir = night({ node22: all('passed', 10) });

    const result = tally({ dir, root: RUNNER_ROOT, ...asked });

    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken).toContain(said);
  });

  /**
   * THE REFUSAL HAS TO BE ABLE TO GO AWAY. A guard that is on for every input is not a guard, so
   * the same directory is counted twice: once with the wrong numbers and once with the right ones.
   */
  it('comes back clean over the very reports it refused, once the numbers asked for are right', () => {
    const dir = night({ node22: all('passed', 5), node24: all('passed', 5) });

    const wrong = tally({ dir, root: RUNNER_ROOT, expect: 12, perLabel: 6 });
    const right = tally({ dir, root: RUNNER_ROOT, expect: 10, perLabel: 5 });

    expect(wrong.verdict).toBe('RULER BROKEN');
    expect(right.verdict).toBe('CLEAN');
  });
});

describe('the page a broken ruler prints is not the page a clean night prints', () => {
  it('says RULER BROKEN, publishes no rate table, and names what it could and could not read', () => {
    const clean = render(
      tally({
        dir: night({ node22: all('passed', 3) }),
        root: RUNNER_ROOT,
        expect: 3,
        perLabel: 3,
      }),
    );
    const broken = render(
      tally({ dir: join(sandbox(), 'not-there'), root: RUNNER_ROOT, expect: 3, perLabel: 3 }),
    );

    expect(broken).not.toBe(clean);
    expect(broken).toContain('## RULER BROKEN');
    expect(broken).toContain('Reports counted: **0** of the **3** asked for.');
    expect(broken).not.toContain('| case | file | failed | of | rate |');
    expect(clean).not.toContain('RULER BROKEN');
    expect(clean).toContain('## No case failed in any run');
  });

  /**
   * A GREEN NIGHT IS NOT A GREEN SUITE, and the page that says nothing failed has to carry that
   * sentence or it will be quoted as if it were.
   */
  it('says on the clean page that one green night is not evidence of no flake', () => {
    const page = render(
      tally({
        dir: night({ node22: all('passed', 3) }),
        root: RUNNER_ROOT,
        expect: 3,
        perLabel: 3,
      }),
    );

    expect(page).toContain('not** evidence that there is no flake');
  });

  it('keeps the three verdicts on three different exit codes', () => {
    expect(new Set([EXIT.CLEAN, EXIT.FLAKY, EXIT.BROKEN]).size).toBe(3);
    expect(EXIT.CLEAN).toBe(0);
  });
});
