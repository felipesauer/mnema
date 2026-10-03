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
import { environmentWithoutMnema, runOne } from '../src/commands/check.js';

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

  it('does not hand the program any MNEMA_* variable, and keeps the rest', () => {
    const saved = { ...process.env };
    process.env.MNEMA_HOME = '/somewhere';
    process.env.MNEMA_KEY_PASSPHRASE = 'secret';
    try {
      const outcome = runOne(
        declared('-e', 'process.stdout.write(JSON.stringify(process.env))'),
        cwd,
        10_000,
      );
      expect(outcome.passed).toBe(true);
      const seen = Object.keys(JSON.parse(outcome.output));
      expect(seen.filter((key) => key.startsWith('MNEMA_'))).toEqual([]);
      expect(seen).toContain('PATH');
    } finally {
      process.env = saved;
    }
  });

  it('drops exactly the keys that start with MNEMA_', () => {
    expect(
      environmentWithoutMnema({ MNEMA_A: '1', PATH: 'p', XMNEMA_B: '2', mnema_c: '3' }),
    ).toEqual({ PATH: 'p', XMNEMA_B: '2', mnema_c: '3' });
  });
});
