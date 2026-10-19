/**
 * What the Action quotes when the record it was handed holds no tail: the refusal by name.
 *
 * The comment cuts what `verify` said at the most it quotes, and `verify` names every committed
 * key in its census (on stdout) before it names the refusal (on stderr). So the more keys a record
 * has, the further the refusal sat from the start of `said`, until it fell outside the quotation.
 * These run the real binary over a record whose tails are deleted in one commit, with 2, 4 and 6
 * keys, and ask the comment, not `said`, whether the refusal is in it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../../code/tests/support/git-without-maintenance.js';
import { renderComment } from './comment.js';
import { theMnemaBinary, worldAt } from './world.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-action-world-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(sandbox, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
  });
};

/** `mnema <argv>` as the machine whose HOME is `home`. */
function mnemaAs(home: string, cwd: string, ...argv: string[]): string {
  const ran = spawnSync(process.execPath, [theMnemaBinary(), ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  expect(ran.status, `${argv.join(' ')}: ${ran.stderr}`).toBe(0);
  return ran.stdout;
}

/** A repository with `keys` committed keys, and a second commit that deletes every tail. */
function aRecordWhoseTailsWereCut(keys: number): string {
  const repo = join(sandbox, `repo-${keys}`);
  const home = join(sandbox, `home-${keys}`);
  mkdirSync(repo, { recursive: true });
  mkdirSync(home);
  git(repo, 'init', '-q');
  const anchor = /identity: (mnid:[0-9a-f]{64})/.exec(mnemaAs(home, repo, 'init'))?.[1] as string;
  mnemaAs(home, repo, 'decision', 'record', 'Use the standard library', 'Because it is there');
  for (let i = 2; i < keys; i++) {
    const other = join(sandbox, `other-${keys}-${i}`);
    mkdirSync(other);
    const asked = mnemaAs(other, sandbox, 'key', 'request', '--anchor', anchor);
    const request = asked.split('\n').find((line) => line.startsWith('mnema-key-request:'));
    mnemaAs(home, repo, 'key', 'enroll', request as string);
  }
  git(repo, 'add', '.mnema');
  git(repo, 'commit', '-q', '-m', 'the record');
  git(repo, 'rm', '-rq', '.mnema/tails');
  git(repo, 'commit', '-q', '-m', 'cut the tails');
  vi.stubEnv('HOME', home);
  return repo;
}

describe('the comment over a record whose tails were all deleted', () => {
  it.each([2, 4, 6])('quotes the refusal by name with %i keys without a tail', (keys) => {
    const repo = aRecordWhoseTailsWereCut(keys);
    const world = worldAt(repo, {} as never, { info() {}, warning() {} }, {});
    const verification = world.mnema.verify('HEAD~1');
    expect(verification.passed).toBe(false);
    const census = verification.said.match(/census \[key-without-tail\]/g) ?? [];
    expect(census, verification.said).toHaveLength(keys);

    const comment = renderComment({
      verification,
      record: { total: 0, byKind: [], decisions: [] },
      governed: [],
      notAsked: 0,
      approval: undefined,
    });
    expect(comment.indexOf('NO TAIL')).toBeGreaterThan(-1);
  });
});
