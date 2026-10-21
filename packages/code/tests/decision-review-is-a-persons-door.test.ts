/**
 * `mnema decision review` ON THE BUILT BINARY: a person goes through what awaits a judgement
 * without copying an id, and every verdict is the move `decision move` makes.
 *
 * The terminal is a pseudo-terminal made by `script`, and the answers are typed one prompt at a
 * time (a driver that wrote them all at once would be read by the first question alone). What is
 * asserted is read back from the record with `show` and `verify`, never from what the review
 * printed about itself.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let home: string;
let project: string;

const env = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? '',
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
  ...extra,
});

/** Standard input, output and error are pipes: no terminal. */
function mnema(...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: project,
    encoding: 'utf-8',
    env: env(),
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

const quoted = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

/**
 * The binary under a pseudo-terminal, answering the prompt number `n` (from zero) with
 * `answers[n]` as soon as it has been drawn. Gives back everything the terminal showed.
 */
function atATerminal(
  answers: readonly string[],
  argv: readonly string[],
  extra: Record<string, string> = {},
): Promise<{ status: number | null; shown: string }> {
  const command = [process.execPath, CLI, ...argv].map(quoted).join(' ');
  const child = spawn('script', ['-qec', command, '/dev/null'], {
    cwd: project,
    env: env(extra),
  });
  let shown = '';
  let answered = 0;
  child.stdout.on('data', (chunk: Buffer) => {
    shown += chunk.toString('utf-8');
    const asked = (
      shown.match(/(Note for the verdicts of this review|\(q\)uit; a note may follow)/g) ?? []
    ).length;
    while (answered < asked && answered < answers.length) {
      child.stdin.write(`${answers[answered]}\n`);
      answered += 1;
    }
  });
  return new Promise((resolve) => {
    child.on('close', (status) => resolve({ status, shown }));
  });
}

const stateOf = (id: string): string =>
  /ADR-\d+: .* \((\w+)\)/.exec(mnema('show', id).out)?.[1] ?? '';

function recordThree(): string[] {
  return ['first call', 'second call', 'third call'].map((title) => {
    const recorded = mnema(
      'decision',
      'record',
      title,
      `why ${title}`,
      '--alternatives',
      'the other way',
    );
    expect(recorded.status).toBe(0);
    return /\(([0-9a-f-]{36})\)/.exec(recorded.out)?.[1] ?? '';
  });
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-review-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(home);
  mkdirSync(project);
  expect(mnema('init').status).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema decision review, on the built binary', () => {
  it('accepts, rejects and skips, and leaves a record that verifies', {
    timeout: 60_000,
  }, async () => {
    const [first, second, third] = recordThree() as [string, string, string];
    // Newest first: the third is asked first, then the second, then the first.
    const done = await atATerminal(
      ['', 'a', 'r because it was dropped', 's'],
      ['decision', 'review'],
    );
    expect(done.status).toBe(0);
    expect(done.shown).toContain('third call');
    expect(done.shown).toContain('Why: why third call');
    expect(done.shown).toContain('Turned down: the other way');
    expect(done.shown).toContain('Reviewed: 1 accepted, 1 rejected, 1 skipped.');
    expect(stateOf(third)).toBe('accepted');
    expect(stateOf(second)).toBe('rejected');
    expect(stateOf(first)).toBe('proposed');
    expect(mnema('show', third).out).toContain('reviewed with mnema decision review');
    expect(mnema('show', second).out).toContain('because it was dropped');
    expect(mnema('verify').status).toBe(0);
  });

  it('says what it wrote nothing of when the person quits', { timeout: 60_000 }, async () => {
    const ids = recordThree();
    const done = await atATerminal(['', 'q'], ['decision', 'review']);
    expect(done.shown).toContain('Reviewed: 0 accepted, 0 rejected, 3 skipped.');
    for (const id of ids) expect(stateOf(id)).toBe('proposed');
  });

  it('refuses without a terminal, names the code and the equivalent line, and writes nothing', {
    timeout: 60_000,
  }, () => {
    const ids = recordThree();
    const before = readdirSync(project, { recursive: true }).length;
    const refused = mnema('decision', 'review');
    expect(refused.status).toBe(1);
    expect(refused.err).toContain('DECISION_REVIEW_NEEDS_A_PERSON');
    for (const id of ids) expect(refused.err).toContain(id);
    expect(refused.err).toContain('mnema decision move accept');
    for (const id of ids) expect(stateOf(id)).toBe('proposed');
    expect(readdirSync(project, { recursive: true }).length).toBe(before);
  });

  it('says so in one line when nothing awaits, and exits 0', { timeout: 60_000 }, () => {
    const none = mnema('decision', 'review');
    expect(none.status).toBe(0);
    expect(none.out.trim()).toBe('Nothing awaiting a judgement.');
  });

  it('is a person’s: --which is refused, and an agent key in the environment is said not to be used', {
    timeout: 60_000,
  }, async () => {
    const [, , only] = recordThree() as [string, string, string];
    const refused = mnema('decision', 'review', '--which', 'ci');
    expect(refused.status).toBe(1);
    expect(refused.err).toContain('--which');
    expect(stateOf(only)).toBe('proposed');

    const done = await atATerminal(['', 'a', 'q'], ['decision', 'review'], {
      MNEMA_AGENT_KEY: 'ci',
    });
    expect(done.shown).toContain('MNEMA_AGENT_KEY is set and is not used here');
    expect(stateOf(only)).toBe('accepted');
    expect(mnema('show', only).out).not.toMatch(/accepted by .*ci/i);
    expect(existsSync(join(home, '.mnema'))).toBe(true);
  });
});
