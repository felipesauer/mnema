/**
 * THE SWEEP OF `/tmp` ANSWERS, OR SAYS IT CANNOT.
 *
 * `every-sandbox-is-removed-where-it-was-made` follows the created name to its removal by
 * reading source, and `the-bench-leaves-nothing-behind` asks the filesystem about ONE of the
 * 187 prefixes this workspace builds under. `.github/what-the-suite-left-behind/sweep.mjs` is
 * what covers the other 186, and it can only do that from outside the suite: a before/after
 * listing of `tmpdir()` taken while workers are alive attributes one worker's sandbox to
 * another's call, measured red in six of six runs of the copilot package.
 *
 * SO THE PROPERTY THAT MATTERS HERE IS THE REFUSAL. The sweep is right exactly when it speaks
 * only with the suite stopped, and the cases below pin both halves of that: it refuses when a
 * run is alive, and it does not refuse when none is — because a refusal that never lifts is a
 * sweep that reports nothing while looking like it works. Its own command line is the shape it
 * would mistake itself for, so that has a case of its own.
 *
 * AND THE ORDER IN CI IS PART OF THE MECHANISM, not a detail of the workflow. If the report ran
 * before the last invocation of vitest it would be reading a `/tmp` the suite is still writing,
 * which is the race this instrument exists to avoid; the last case reads `ci.yml` and asserts
 * the record comes before every run of the suite and the report after all of them.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  asProse,
  commandLinesFromProc,
  liveSuites,
  main,
  sandboxesUnder,
  sweep,
  THE_FAMILY,
} from '../../../.github/what-the-suite-left-behind/sweep.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** A temp directory of this case's own, so nothing here reads or writes the machine's (A6). */
let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-sweep-case-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A machine with the suite stopped: the seam every case that exercises reporting needs. */
const STOPPED = (): string[] => [];

/** A directory of the family, planted under this case's own temp directory. */
function plant(name: string): void {
  mkdirSync(join(sandbox, name), { recursive: true });
}

describe('the sweep speaks only with the suite stopped', () => {
  it('refuses while a run of the suite is alive, and names it', () => {
    const result = sweep({ now: ['mnema-a'], alive: ['4242 node vitest run'], baseline: [] });
    expect(result.verdict).toBe('ruler-broken');
    expect(result.code).toBe(2);
    expect(result.leftBehind, 'it accused something it had just said it could not tell').toEqual(
      [],
    );
    expect(asProse(result, '/tmp')).toContain('4242 node vitest run');
  });

  it('speaks when none is', () => {
    // BOTH DIRECTIONS. A refusal that never lifts is a sweep that reports nothing and looks
    // like it works, so the same input with the process list empty has to accuse.
    const result = sweep({ now: ['mnema-a'], alive: [], baseline: [] });
    expect(result.verdict).toBe('left-behind');
    expect(result.code).toBe(1);
    expect(result.leftBehind).toEqual(['mnema-a']);
  });

  it('refuses when nothing recorded what was there before, rather than sweeping clean', () => {
    // The dangerous silence: with no baseline every directory is either everybody's fault or
    // nobody's, and reporting the second is how an instrument goes quiet for months.
    const result = sweep({ now: ['mnema-a'], alive: [], baseline: null });
    expect(result.verdict).toBe('ruler-broken');
    expect(result.code).toBe(2);
    expect(asProse(result, '/tmp')).toContain('--record');
  });

  it('reads the runner on disk and not the word, and never itself', () => {
    // ITS OWN CASE, AND THE TWO MISTAKES IT HAS ALREADY MADE. Excluding by NAME filtered out a
    // real vitest whose command line named this test file — the `pkill -f` mistake. Matching
    // the bare WORD then refused on any process that merely mentioned it, including the probe
    // this delivery read the process list with, which is an instrument that only ever refuses.
    // The three runner rows are the shapes measured off a live run of this suite.
    const shim = 'node /repo/node_modules/.bin/vitest run --reporter=default';
    const runner = 'node /repo/node_modules/.bin/../vitest/vitest.mjs run --reporter=default';
    const worker = 'node --require /repo/node_modules/vitest/dist/workers/forks.js';
    const machine = [
      { pid: process.pid, line: 'node .github/what-the-suite-left-behind/sweep.mjs' },
      { pid: 9001, line: 'npm exec what-the-suite-left-behind -- --record' },
      { pid: 9002, line: shim },
      { pid: 9003, line: runner },
      { pid: 9004, line: worker },
      // MENTIONS, NOT RUNNERS. Both of these carry the word and neither is a run.
      { pid: 9005, line: 'grep -rn vitest packages/' },
      { pid: 9006, line: 'node /tmp/scratch/probe.mjs vitest' },
    ];
    expect(liveSuites(machine)).toEqual([`9002 ${shim}`, `9003 ${runner}`, `9004 ${worker}`]);
  });

  it('refuses to speak from inside the suite, on this very machine', () => {
    // THE PROPERTY, END TO END, WITH NO SEAM. This case is itself a run of the suite, so the
    // real detector must find one and `main` must refuse — and it must refuse for THAT reason,
    // which is why the baseline it is handed is a good one. The seam every other case below
    // uses exists only because this one is right.
    plant(`${THE_FAMILY}whatever`);
    const baselineAt = join(sandbox, 'baseline.json');
    main(['--tmp', sandbox, '--baseline', baselineAt, '--record'], STOPPED);
    expect(main(['--tmp', sandbox, '--baseline', baselineAt])).toBe(2);
  });

  it('reads the machine it is running on at all', () => {
    // NOT VACUOUS: `liveSuites` over a list that never has anything in it is a filter nobody
    // has ever run. This case IS a run of the suite, so the real process list must hold one.
    expect(
      liveSuites(commandLinesFromProc()).length,
      'the process list has no vitest in it while vitest is running this case',
    ).toBeGreaterThan(0);
  });
});

describe('the sweep names what appeared and nothing else', () => {
  it('names a sandbox that appeared and leaves a pre-existing one alone', () => {
    plant(`${THE_FAMILY}was-already-here`);
    const baseline = sandboxesUnder(sandbox);
    plant(`${THE_FAMILY}appeared`);
    const result = sweep({ now: sandboxesUnder(sandbox), alive: [], baseline });
    expect(result.leftBehind).toEqual([`${THE_FAMILY}appeared`]);
    expect(result.code).toBe(1);
  });

  it('says nothing left behind when the run cleaned up after itself', () => {
    plant(`${THE_FAMILY}was-already-here`);
    const baseline = sandboxesUnder(sandbox);
    plant(`${THE_FAMILY}transient`);
    rmSync(join(sandbox, `${THE_FAMILY}transient`), { recursive: true, force: true });
    const result = sweep({ now: sandboxesUnder(sandbox), alive: [], baseline });
    expect(result).toMatchObject({ verdict: 'nothing-left-behind', code: 0, leftBehind: [] });
  });

  it('reads only the family, and covers every prefix in it', () => {
    // The 187 prefixes are one family. A sweep keyed on any single one of them would be the
    // copilot case again with a different name, and one that read everything would report the
    // 72.920 entries this machine's /tmp holds for other projects.
    plant(`${THE_FAMILY}core-fixture`);
    plant(`${THE_FAMILY}copilot-abc`);
    plant('some-other-project-xyz');
    expect(sandboxesUnder(sandbox)).toEqual([
      `${THE_FAMILY}copilot-abc`,
      `${THE_FAMILY}core-fixture`,
    ]);
  });

  it('records a baseline and reads it back, end to end', () => {
    plant(`${THE_FAMILY}before`);
    const baselineAt = join(sandbox, 'baseline.json');
    expect(main(['--tmp', sandbox, '--baseline', baselineAt, '--record'], STOPPED)).toBe(0);
    expect(main(['--tmp', sandbox, '--baseline', baselineAt], STOPPED)).toBe(0);
    plant(`${THE_FAMILY}after`);
    expect(main(['--tmp', sandbox, '--baseline', baselineAt], STOPPED)).toBe(1);
    const verdictAt = join(sandbox, 'verdict.json');
    main(['--tmp', sandbox, '--baseline', baselineAt, '--json', verdictAt], STOPPED);
    expect(JSON.parse(readFileSync(verdictAt, 'utf-8')).leftBehind).toEqual([`${THE_FAMILY}after`]);
  });

  it('refuses over a temp directory it cannot read', () => {
    expect(
      main(
        ['--tmp', join(sandbox, 'no-such-place'), '--baseline', join(sandbox, 'b.json')],
        STOPPED,
      ),
    ).toBe(2);
  });
});

describe('the sweep is wired where it can be right', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');

  it('is a script of this repository', () => {
    expect(manifest.scripts['what-the-suite-left-behind']).toContain(
      '.github/what-the-suite-left-behind/sweep.mjs',
    );
  });

  it('does not commit the baseline it writes', () => {
    // It is a fact about one machine at one instant. Committed, it would be somebody else's
    // /tmp, and every sweep after the first would read a stranger's before-listing.
    const tracked = execFileSync('git', ['ls-files', 'what-the-suite-left-behind.json'], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    expect(tracked.trim()).toBe('');
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf-8')).toContain(
      'what-the-suite-left-behind.json',
    );
  });

  it('records before every run of the suite and reports after all of them', () => {
    // THE ORDER IS THE MECHANISM. A report placed before the last vitest step would read a
    // /tmp the suite is still writing — the race this instrument exists to avoid — and the
    // workflow would look correct while measuring nothing.
    const steps = workflow.split(/^ {6}- /m).slice(1);
    const at = (holds: (step: string) => boolean): number[] =>
      steps.flatMap((step, index) => (holds(step) ? [index] : []));
    // Keyed on what the step RUNS, not on what it mentions: the artifact upload names the
    // sweep too, and reading mentions counted it as a second report.
    const invokes = /run: pnpm what-the-suite-left-behind/;
    const records = at((step) => invokes.test(step) && step.includes('--record'));
    const reports = at((step) => invokes.test(step) && !step.includes('--record'));
    const suiteRuns = at((step) => /run: pnpm test/.test(step));

    expect(records, 'ci.yml records no baseline').toHaveLength(1);
    expect(reports, 'ci.yml never reads the baseline back').toHaveLength(1);
    expect(
      suiteRuns.length,
      'ci.yml runs the suite nowhere — this case reads nothing',
    ).toBeGreaterThan(0);
    expect(
      Math.max(...records),
      'the baseline is recorded after the suite has already run',
    ).toBeLessThan(Math.min(...suiteRuns));
    expect(
      Math.min(...reports),
      'the sweep reports while a run of the suite is still ahead of it',
    ).toBeGreaterThan(Math.max(...suiteRuns));
  });
});
