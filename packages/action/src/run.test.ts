/**
 * The Action against a real repository and the real `mnema` binary, with GitHub replaced by a
 * table of answers. Nothing here reaches a network, and every `mnema` process runs under the
 * suite's own HOME.
 */

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../../code/tests/support/git-without-maintenance.js';
import { MARKER } from './comment.js';
import type { Fetch } from './github.js';
import { main, requestFrom } from './run.js';
import { theMnemaBinary, withoutTheInputs } from './world.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');

let sandbox: string;
let repo: string;

const git = (...args: string[]): string =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd: repo,
      encoding: 'utf-8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
    },
  ).trim();

const mnema = (...args: string[]): string =>
  execFileSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf-8' });

/** The id printed on the first line of `decision record`. */
const idOf = (said: string): string => /\(([0-9a-f-]{36})\)/.exec(said)?.[1] ?? '';

/** A repository whose base commit holds one accepted rule over `src/billing`. */
function committedBase(): string {
  git('init', '-q', '-b', 'main');
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  writeFileSync(join(repo, 'src', 'billing', 'invoice.ts'), 'export {};\n');
  mnema('init');
  const id = idOf(mnema('decision', 'record', 'Keep money as integer cents', 'Floats drift.'));
  mnema('decision', 'move', 'accept', id, '--note', 'agreed');
  mnema('link', id, 'src/billing', '--rel', 'governs');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  return git('rev-parse', 'HEAD');
}

/** What the runner would hand the Action for a pull request on top of `baseSha`. */
function environment(
  baseSha: string,
  approval = 'false',
  checkerKey?: string,
): Record<string, string> {
  const event = join(sandbox, 'event.json');
  writeFileSync(
    event,
    JSON.stringify({ pull_request: { number: 7, base: { sha: baseSha }, user: { login: 'bob' } } }),
  );
  return {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: event,
    GITHUB_WORKSPACE: repo,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_API_URL: 'https://api.test',
    'INPUT_GITHUB-TOKEN': 'tok',
    'INPUT_REQUIRE-APPROVAL-FOR-ASKS': approval,
    ...(checkerKey !== undefined ? { 'INPUT_CHECKER-KEY': checkerKey } : {}),
  };
}

/** GitHub as a table: the changed files, the reviews, and a log of what was written. */
function github(files: string[], reviews: unknown[] = []) {
  const written: { method: string; body: string }[] = [];
  const fetchIt: Fetch = async (url, init) => {
    const path = url.replace('https://api.test/repos/o/r', '').split('?')[0];
    const answer = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
    if (init.method === 'GET' && path === '/pulls/7/files') {
      return answer(files.map((filename) => ({ filename })));
    }
    if (init.method === 'GET' && path === '/pulls/7/reviews') return answer(reviews);
    if (init.method === 'GET' && path === '/issues/7/comments') return answer([]);
    written.push({
      method: init.method,
      body: (JSON.parse(init.body ?? '{}') as { body: string }).body,
    });
    return answer({});
  };
  return { fetchIt, written };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-action-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo);
});
afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

/**
 * The cases start the real `mnema` binary, one node process each (≈0.25 s apiece on a free
 * machine, several times that on a loaded runner): `committedBase` and the case's own set-up
 * start seven, and every `main` reads the record with two more (`verify`, then `rules` for each
 * file). Measured alone, the case that asks for a person runs `main` three times and takes 4.3 to
 * 4.5 s, with the other three between 2 and 3 s, against vitest's 5 s default. Nothing in it
 * waits on a network (GitHub is a table) and no spawn is spare, so the time is the cost of
 * asking a real binary, and the limit is given room for a runner several times slower than the
 * one measured, not removed.
 */
const A_REAL_BINARY_PER_CASE = 20_000;

describe('the Action on a real repository', { timeout: A_REAL_BINARY_PER_CASE }, () => {
  it('finds the mnema binary of the package it depends on', () => {
    expect(theMnemaBinary()).toBe(CLI);
  });

  it('comments what the pull request adds to the record and the file a rule governs, and passes', async () => {
    const baseSha = committedBase();
    const second = idOf(mnema('decision', 'record', 'Round half to even', 'Banker rounding.'));
    writeFileSync(join(repo, 'src', 'billing', 'invoice.ts'), 'export const x = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'head');

    const { fetchIt, written } = github(['src/billing/invoice.ts', 'README.md']);
    const said: string[] = [];
    const code = await main(environment(baseSha), fetchIt, (line) => said.push(line));

    expect(said).toEqual(['comment created']);
    expect(code).toBe(0);
    expect(written).toHaveLength(1);
    expect(written[0]?.method).toBe('POST');
    const body = written[0]?.body ?? '';
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('`decision.recorded` | 1');
    expect(body).toContain(`- ADR-2 — Round half to even: proposed`);
    expect(body).toContain('`src/billing/invoice.ts` — governed by Keep money as integer cents');
    expect(body).not.toContain('README.md');
    expect(second).not.toBe('');
  });

  it('fails the check when the record does not verify as signed, and still comments', async () => {
    const baseSha = committedBase();
    mnema('decision', 'record', 'Another', 'Why.');
    const tails = join(repo, '.mnema', 'tails');
    for (const dir of readdirSync(tails)) truncateSync(join(tails, dir, 'checkpoints.jsonl'), 0);
    git('add', '.');
    git('commit', '-q', '-m', 'head');

    const { fetchIt, written } = github([]);
    const said: string[] = [];
    const code = await main(environment(baseSha), fetchIt, (line) => said.push(line));

    expect(code).toBe(1);
    expect(said).toContain(
      '::error::the record does not verify as signed, as the base record grown',
    );
    expect(written[0]?.body).toContain('`verify --require=signed --since <base>`): failed');
  });

  it('fails the check when the record was cut back to an earlier state, honest in every byte', async () => {
    // The newest events cut together with the checkpoint that covered them: what is left is a
    // shorter record that verifies as signed on its own. Only the base remembers it was longer.
    git('init', '-q', '-b', 'main');
    mnema('init');
    mnema('decision', 'record', 'Keep money as integer cents', 'Floats drift.');
    git('add', '.');
    git('commit', '-q', '-m', 'earlier');
    const earlier = git('rev-parse', 'HEAD');
    mnema('decision', 'record', 'Round half to even', 'Banker rounding.');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const baseSha = git('rev-parse', 'HEAD');
    git('rm', '-q', '-r', '.mnema');
    git('checkout', '-q', earlier, '--', '.mnema');
    git('commit', '-q', '-m', 'head');
    // The control: the cut record, read alone, is signed and whole.
    expect(() => mnema('verify', '--require=signed')).not.toThrow();

    const { fetchIt, written } = github([]);
    const said: string[] = [];
    const code = await main(environment(baseSha), fetchIt, (line) => said.push(line));

    expect(code).toBe(1);
    expect(said).toContain(
      '::error::the record does not verify as signed, as the base record grown',
    );
    expect(written[0]?.body).toContain('`verify --require=signed --since <base>`): failed');
  });

  it('fails on a rule that asks for a person only when the check is on and nobody else approved', async () => {
    const baseSha = committedBase();
    const id = idOf(mnema('decision', 'record', 'Review billing', 'A person looks.'));
    mnema('decision', 'move', 'accept', id, '--note', 'agreed');
    mnema('link', id, 'src/billing/invoice.ts', '--rel', 'asks-for-a-person');
    git('add', '.');
    git('commit', '-q', '-m', 'head');

    const files = ['src/billing/invoice.ts'];
    const off = await main(environment(baseSha), github(files).fetchIt, () => {});
    expect(off).toBe(0);

    const said: string[] = [];
    const own = [{ user: { login: 'bob' }, state: 'APPROVED' }];
    const on = await main(environment(baseSha, 'true'), github(files, own).fetchIt, (l) =>
      said.push(l),
    );
    expect(on).toBe(1);
    expect(said).toContain(
      '::error::a rule asks for a person and no one but the author has approved',
    );

    const other = [{ user: { login: 'ana' }, state: 'APPROVED' }];
    const approved = await main(
      environment(baseSha, 'true'),
      github(files, other).fetchIt,
      () => {},
    );
    expect(approved).toBe(0);
  });

  it('writes nothing to the record and nothing to git', async () => {
    const baseSha = committedBase();
    const tip = git('rev-parse', 'HEAD');
    await main(environment(baseSha), github(['src/billing/invoice.ts']).fetchIt, () => {});
    expect(git('rev-parse', 'HEAD')).toBe(tip);
    // git sees no change to a tracked or an untracked file; only what .gitignore leaves out may appear
    expect(git('status', '--porcelain')).toBe('');
  });
});

describe('the Action with a checker key', () => {
  /**
   * A base whose one rule carries a check, and a runner key the record enrolls as a checker,
   * made under a home of its own — the way a repository secret holds it. The check passes only
   * when the program is NOT handed the Action's inputs: the key and the token are among them.
   */
  const HANDED =
    'process.exit(Object.keys(process.env).some((k) => k.startsWith("INPUT_")) ? 7 : 0)';

  function aCheckedBase(program = HANDED): { baseSha: string; key: string } {
    git('init', '-q', '-b', 'main');
    mnema('init');
    const id = idOf(mnema('decision', 'record', 'Keep money as integer cents', 'Floats drift.'));
    mnema('decision', 'move', 'accept', id, '--note', 'agreed');
    mnema('check', 'declare', id, 'node', '--', '-e', program);
    const account = JSON.parse(mnema('accountability', '--json')) as { byWho: { who: string }[] };
    const anchor = account.byWho[0]?.who ?? '';
    const runner = join(sandbox, 'runner');
    const asked = execFileSync(
      process.execPath,
      [CLI, 'key', 'request', '--checker', '--anchor', anchor],
      { cwd: repo, encoding: 'utf-8', env: { ...process.env, MNEMA_HOME: runner } },
    );
    const line = asked.split('\n').find((l) => l.startsWith('mnema-checker-request:1:')) ?? '';
    mnema('key', 'enroll', '--checker', line);
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const keys = join(runner, 'identity', 'keys');
    const file = readdirSync(keys).find((name) => name.endsWith('.key')) as string;
    return { baseSha: git('rev-parse', 'HEAD'), key: readFileSync(join(keys, file), 'utf-8') };
  }

  // Each run starts the binary several times — init, a request under another home, an
  // enrolment, the Action's own verify and check run — so it is given room the default
  // five seconds do not leave on a loaded machine.
  it('runs the checks with the key, leaves the results in the tree, and hands the program no input', async () => {
    const { baseSha, key } = aCheckedBase();
    // Where the runner keeps its temporary files, pointed into the sandbox so that what the run
    // leaves there can be read: the key's file has to be gone once the run ends.
    const runnerTemp = join(sandbox, 'runner-temp');
    mkdirSync(runnerTemp);
    const said: string[] = [];
    const code = await main(
      { ...environment(baseSha, 'false', key), RUNNER_TEMP: runnerTemp },
      github([]).fetchIt,
      (line) => said.push(line),
    );
    expect(said.join('\n')).toContain('1 passed · 0 failed at');
    expect(code).toBe(0);
    expect(git('status', '--porcelain')).toContain('.mnema/');
    expect(readdirSync(runnerTemp).filter((name) => name.startsWith('mnema-checker-'))).toEqual([]);
  }, 30_000);

  it('fails the check when a rule’s check did not pass, and records that it did not', async () => {
    const { baseSha, key } = aCheckedBase('process.exit(3)');
    const said: string[] = [];
    const code = await main(environment(baseSha, 'false', key), github([]).fetchIt, (line) =>
      said.push(line),
    );
    expect(code).toBe(1);
    expect(said).toContain('::error::a rule’s check did not pass, or the checks did not run');
    expect(said.join('\n')).toContain('0 passed · 1 failed at');
  }, 30_000);

  it('hands a program the environment without one input of the Action', () => {
    expect(
      withoutTheInputs({ 'INPUT_CHECKER-KEY': 'k', 'INPUT_GITHUB-TOKEN': 't', PATH: '/bin' }),
    ).toEqual({ PATH: '/bin' });
  });
});

describe('requestFrom', () => {
  it('answers only a pull_request event, by name', () => {
    expect(() => requestFrom({ GITHUB_EVENT_NAME: 'push' }, () => '{}')).toThrow(
      'this run is a push',
    );
  });

  it('says what is missing rather than guessing', () => {
    const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: 'e' };
    expect(() => requestFrom(env, () => '{}')).toThrow('INPUT_GITHUB-TOKEN is not set');
    const full = { ...env, GITHUB_REPOSITORY: 'o/r', 'INPUT_GITHUB-TOKEN': 't' };
    expect(() => requestFrom({ ...full, GITHUB_REPOSITORY: '' }, () => '{}')).toThrow(
      'GITHUB_REPOSITORY is not set',
    );
    expect(() => requestFrom(full, () => '{}')).toThrow('holds no pull request');
  });

  it('takes the approval input as true or false and nothing else', () => {
    const event = JSON.stringify({
      pull_request: { number: 1, base: { sha: 's' }, user: { login: 'u' } },
    });
    const env = {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: 'e',
      GITHUB_REPOSITORY: 'o/r',
      'INPUT_GITHUB-TOKEN': 't',
    };
    expect(requestFrom(env, () => event).requireApprovalForAsks).toBe(false);
    expect(
      requestFrom({ ...env, 'INPUT_REQUIRE-APPROVAL-FOR-ASKS': ' True ' }, () => event)
        .requireApprovalForAsks,
    ).toBe(true);
    expect(() =>
      requestFrom({ ...env, 'INPUT_REQUIRE-APPROVAL-FOR-ASKS': 'yes' }, () => event),
    ).toThrow('takes true or false');
  });

  it('takes a checker key when one is given, and none when the input is empty', () => {
    const event = JSON.stringify({
      pull_request: { number: 1, base: { sha: 's' }, user: { login: 'u' } },
    });
    const env = {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: 'e',
      GITHUB_REPOSITORY: 'o/r',
      'INPUT_GITHUB-TOKEN': 't',
    };
    expect(requestFrom(env, () => event).checkerKey).toBeUndefined();
    expect(requestFrom({ ...env, 'INPUT_CHECKER-KEY': '  ' }, () => event).checkerKey).toBe(
      undefined,
    );
    expect(requestFrom({ ...env, 'INPUT_CHECKER-KEY': 'PEM' }, () => event).checkerKey).toBe('PEM');
  });
});
