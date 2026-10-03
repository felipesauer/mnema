/**
 * A check runs as it was declared: the program and its arguments, no shell, in the project's
 * root, under a timeout, with what it printed handed back whole.
 *
 * Driven against `node` itself, which every machine that runs this suite has, so no test
 * depends on a program of the machine's own.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runOne } from '../src/commands/check.js';

let sandbox: string;
let cwd: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-run-one-'));
  cwd = realpathSync(sandbox);
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const declared = (...args: string[]) => ({ rule: 'r', command: process.execPath, args });

describe('runOne', () => {
  it('passes on exit 0, and hands back both streams', () => {
    const outcome = runOne(
      declared('-e', 'process.stdout.write("out;"); process.stderr.write("err")'),
      cwd,
      10_000,
    );
    expect(outcome).toEqual({ passed: true, output: 'out;err' });
  });

  it('fails on a non-zero exit, and says the code', () => {
    const outcome = runOne(declared('-e', 'process.exit(3)'), cwd, 10_000);
    expect(outcome).toEqual({ passed: false, failure: 'exited with code 3', output: '' });
  });

  it('hands every argument over as it was recorded: nothing is split, globbed or expanded', () => {
    const outcome = runOne(
      declared(
        '-e',
        'process.stdout.write(process.argv.slice(1).join("|"))',
        'a b',
        '*',
        '$HOME',
        ';',
      ),
      cwd,
      10_000,
    );
    expect(outcome).toEqual({ passed: true, output: 'a b|*|$HOME|;' });
  });

  it('runs in the project root it is handed', () => {
    const outcome = runOne(declared('-e', 'process.stdout.write(process.cwd())'), cwd, 10_000);
    expect(outcome).toEqual({ passed: true, output: cwd });
  });

  it('stops a check that outlives its timeout, and records it as failed', () => {
    const outcome = runOne(declared('-e', 'setInterval(() => {}, 1000)'), cwd, 300);
    expect(outcome.passed).toBe(false);
    expect(outcome.passed ? '' : outcome.failure).toBe('timed out after 0.3 s');
  });

  it('records a program that cannot start as failed, naming why', () => {
    const outcome = runOne(
      { rule: 'r', command: 'a-program-that-is-not-installed', args: [] },
      cwd,
      10_000,
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.passed ? '' : outcome.failure).toBe('could not start: ENOENT');
  });

  it('stops a check that prints without end, instead of holding it all', () => {
    const outcome = runOne(
      declared(
        '-e',
        'const chunk = "x".repeat(1 << 20); for (;;) require("node:fs").writeSync(1, chunk)',
      ),
      cwd,
      30_000,
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.passed ? '' : outcome.failure).toBe('printed more than 16 MiB');
  });
});
