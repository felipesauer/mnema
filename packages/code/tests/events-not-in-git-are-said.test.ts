/**
 * THE EVENTS GIT DOES NOT HOLD ARE SAID (`events-not-in-git.ts`): with real git, a bare remote and
 * the built binary, every program run with a home of the sandbox's own.
 *
 * What it asks: a decision recorded and not committed shows its count and age in `mnema status`
 * (the screen and `--json`), in `mnema doctor` and in the closing line of a session; once
 * `mnema record commit`'s branch is merged into the default branch and pulled, all three go quiet;
 * the branch a fetch shows ahead says `mnema record pull`; a tail git does not track counts whole;
 * outside git and with the record ignored by git nothing is said; the closing line says nothing
 * with its switch off; a day makes an event old; and the three surfaces take the sentence from the
 * one module (`events-not-in-git.ts`).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OLD_AFTER_HOURS,
  readEventsNotInGit,
  saysEventsNotInGit,
  theDefaultBranch,
} from '../src/events-not-in-git.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-not-in-git-'));
  mkdirSync(join(sandbox, 'home'), { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function env(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: join(sandbox, 'home'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    GIT_AUTHOR_NAME: 'a',
    GIT_AUTHOR_EMAIL: 'a@example.invalid',
    GIT_COMMITTER_NAME: 'a',
    GIT_COMMITTER_EMAIL: 'a@example.invalid',
  };
}

function git(cwd: string, ...args: string[]): { status: number; out: string } {
  const ran = spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf-8',
    env: env(),
  });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}` };
}

function mnema(
  cwd: string,
  args: string[],
  input?: string,
): { status: number; out: string; stdout: string } {
  const ran = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf-8',
    env: env(),
    ...(input !== undefined ? { input } : {}),
  });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}`, stdout: ran.stdout };
}

function decide(checkout: string, title: string): void {
  const ran = mnema(checkout, ['decision', 'record', title, 'a rationale']);
  expect(ran.status, ran.out).toBe(0);
}

/** A remote, and a clone of it with a record founded, committed and pushed. */
function world(): { local: string; remote: string } {
  const remote = join(sandbox, 'remote.git');
  const local = join(sandbox, 'local');
  expect(git(sandbox, 'init', '-q', '--bare', remote).status).toBe(0);
  expect(git(sandbox, 'clone', '-q', remote, local).status).toBe(0);
  expect(mnema(local, ['init', '--all-hosts']).status).toBe(0);
  expect(git(local, 'add', '.').status).toBe(0);
  expect(git(local, 'commit', '-qm', 'the record').status).toBe(0);
  expect(git(local, 'push', '-q', 'origin', 'main').status).toBe(0);
  expect(git(local, 'remote', 'set-head', 'origin', 'main').status).toBe(0);
  return { local, remote };
}

/** The tails of a checkout, each with the segment's path from the repository's top. */
function segments(checkout: string): string[] {
  return readdirSync(join(checkout, '.mnema', 'tails')).map(
    (id) => `.mnema/tails/${id}/000001.jsonl`,
  );
}

function linesOf(text: string): number {
  return text.split('\n').filter(Boolean).length;
}

/**
 * The events above HEAD, counted from git's own answer and the file: the independent source the
 * module's count is held to.
 */
function waiting(checkout: string): number {
  let sum = 0;
  for (const path of segments(checkout)) {
    const here = linesOf(readFileSync(join(checkout, path), 'utf-8'));
    const head = git(checkout, 'show', `HEAD:${path}`);
    sum += here - (head.status === 0 ? linesOf(head.out) : 0);
  }
  return sum;
}

/** What a host hands the Stop hook: a transcript in which one file was written. */
function stopPayload(checkout: string): string {
  const at = (s: number) => `2020-01-01T00:00:0${s}.000Z`;
  const transcript = join(sandbox, 'session.jsonl');
  writeFileSync(
    transcript,
    `${[
      JSON.stringify({
        type: 'user',
        timestamp: at(0),
        cwd: checkout,
        origin: { kind: 'human' },
        message: { role: 'user', content: 'change a file' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: at(1),
        cwd: checkout,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Write',
              input: { file_path: join(checkout, 'code.txt') },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: at(2),
        cwd: checkout,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
        },
      }),
    ].join('\n')}\n`,
  );
  return JSON.stringify({
    hook_event_name: 'Stop',
    transcript_path: transcript,
    cwd: checkout,
  });
}

/** The three surfaces' answers, joined: the screen of status, `--json`, doctor, and the closing line. */
function surfaces(checkout: string) {
  const status = mnema(checkout, ['status']);
  const json = mnema(checkout, ['status', '--json']);
  const doctor = mnema(checkout, ['doctor']);
  const tally = mnema(checkout, ['tally'], stopPayload(checkout));
  return {
    status: status.out,
    json: json.stdout,
    doctor: doctor.out,
    closing: (JSON.parse(tally.stdout) as { systemMessage?: string }).systemMessage ?? '',
  };
}

const SLOW = { timeout: 120_000 };

describe('the events git does not hold', SLOW, () => {
  it('are counted, with their age, by status, doctor and the closing line, and go quiet once the branch is merged and pulled', () => {
    const { local, remote } = world();
    expect(surfaces(local).closing).not.toMatch(/not in a git commit/);
    decide(local, 'the first');
    decide(local, 'the second');
    const events = waiting(local);
    expect(events).toBeGreaterThan(1);

    const said = surfaces(local);
    const sentence = new RegExp(
      `${events} events of this record are not in a git commit yet \\(the oldest was written less than an hour ago\\): \`mnema record commit\` prepares them as a branch for a pull request and prints the commands to run next; it pushes nothing\\.`,
    );
    expect(said.status).toMatch(sentence);
    expect(said.status).toContain('Not in git yet:');
    expect(said.doctor).toMatch(new RegExp(`to do · record-in-git: ${sentence.source}`));
    expect(said.closing).toMatch(sentence);
    const json = JSON.parse(said.json) as { eventsNotInGit: Record<string, unknown> };
    expect(json.eventsNotInGit).toMatchObject({
      events,
      tails: 1,
      oldestHours: 0,
      old: false,
      pullDue: 0,
    });
    // The verb is not named as an order, and nothing here tells anyone to push.
    for (const text of [said.status, said.doctor, said.closing]) {
      expect(text).not.toMatch(/\b(you should|you must|please|now run)\b/i);
    }

    // The cut is made, pushed and merged on the forge's side, and pulled back here.
    const made = mnema(local, ['record', 'commit']);
    expect(made.status, made.out).toBe(0);
    const branch = /(mnema-record\/[\w-]+)/.exec(made.out)?.[1] as string;
    expect(git(local, 'push', '-q', 'origin', branch).status).toBe(0);
    const forge = join(sandbox, 'forge');
    expect(git(sandbox, 'clone', '-q', remote, forge).status).toBe(0);
    expect(git(forge, 'merge', '-q', '--no-ff', '-m', 'merge', `origin/${branch}`).status).toBe(0);
    expect(git(forge, 'push', '-q', 'origin', 'main').status).toBe(0);

    // Merged but not fetched: this clone cannot know yet, and still says what it counted.
    expect(surfaces(local).status).toMatch(sentence);
    // Fetched: the branch followed is ahead with a commit of the record, and the line says the pull.
    expect(git(local, 'fetch', '-q').status).toBe(0);
    const ahead = surfaces(local);
    expect(ahead.doctor).toMatch(
      /The branch this one follows holds 1 commit that changed the record and this clone lacks: `mnema record pull` brings them over the events waiting here\./,
    );
    expect(ahead.closing).toMatch(/`mnema record pull`/);
    expect(
      (JSON.parse(ahead.json) as { eventsNotInGit: { pullDue: number } }).eventsNotInGit,
    ).toMatchObject({
      pullDue: 1,
    });

    const pulled = mnema(local, ['record', 'pull']);
    expect(pulled.status, pulled.out).toBe(0);
    const after = surfaces(local);
    // Everything the cut carried is in a commit: nothing is said anywhere.
    expect(after.status).not.toMatch(/Not in git yet|not in a git commit/);
    expect(after.doctor).not.toMatch(/record-in-git/);
    expect(after.closing).not.toMatch(/not in a git commit/);
    expect(JSON.parse(after.json)).not.toHaveProperty('eventsNotInGit');
  });

  it('counts a tail git does not track whole, beside what the tracked one grew by', () => {
    const { local } = world();
    decide(local, 'from the first key');
    const grew = waiting(local);
    // A second key writing here opens a tail git does not hold at all.
    const second = { ...env(), HOME: join(sandbox, 'second-home') };
    mkdirSync(second.HOME, { recursive: true });
    const wrote = spawnSync(
      process.execPath,
      [CLI, 'decision', 'record', 'from a second key', 'why'],
      {
        cwd: local,
        encoding: 'utf-8',
        env: second,
      },
    );
    expect(wrote.status, `${wrote.stdout}${wrote.stderr}`).toBe(0);
    expect(segments(local)).toHaveLength(2);
    const whole = segments(local)
      .filter((path) => git(local, 'cat-file', '-e', `HEAD:${path}`).status !== 0)
      .map((path) => linesOf(readFileSync(join(local, path), 'utf-8')));
    expect(whole).toHaveLength(1);
    const read = readEventsNotInGit({
      cwd: local,
      env: { home: join(sandbox, 'home') },
      processEnv: env(),
    });
    expect(read).toMatchObject({ events: grew + (whole[0] as number), tails: 2 });
  });

  it('says nothing outside git, and nothing where git ignores the record', () => {
    const plain = join(sandbox, 'plain');
    mkdirSync(plain);
    expect(mnema(plain, ['init', '--all-hosts']).status).toBe(0);
    decide(plain, 'outside any repository');
    const outside = surfaces(plain);
    expect(outside.status).not.toMatch(/not in a git commit/);
    expect(outside.doctor).not.toMatch(/record-in-git/);
    expect(outside.closing).not.toMatch(/not in a git commit/);
    expect(JSON.parse(outside.json)).not.toHaveProperty('eventsNotInGit');

    const ignored = join(sandbox, 'ignored');
    mkdirSync(ignored);
    expect(git(ignored, 'init', '-q').status).toBe(0);
    writeFileSync(join(ignored, '.gitignore'), '.mnema/\n');
    expect(mnema(ignored, ['init', '--all-hosts']).status).toBe(0);
    decide(ignored, 'a record git ignores');
    expect(
      readEventsNotInGit({ cwd: ignored, env: { home: join(sandbox, 'home') }, processEnv: env() }),
    ).toBeUndefined();
  });

  it('says nothing in the closing line with its switch off, and still says it in status and doctor', () => {
    const { local } = world();
    decide(local, 'waiting');
    expect(mnema(local, ['switch', 'off', 'session-tally']).status).toBe(0);
    const said = surfaces(local);
    expect(said.closing).toBe('');
    expect(said.status).toMatch(/not in a git commit yet/);
    expect(said.doctor).toMatch(/record-in-git/);
  });

  it('marks an event old past a day, and the rule is the module’s', () => {
    const { local } = world();
    decide(local, 'waiting');
    const ctx = { cwd: local, env: { home: join(sandbox, 'home') }, processEnv: env() };
    const fresh = readEventsNotInGit({ ...ctx, now: Date.now() }) as NonNullable<
      ReturnType<typeof readEventsNotInGit>
    >;
    expect(fresh.old).toBe(false);
    const day = readEventsNotInGit({
      ...ctx,
      now: Date.now() + OLD_AFTER_HOURS * 3_600_000,
    }) as NonNullable<ReturnType<typeof readEventsNotInGit>>;
    expect(day.old).toBe(false);
    const later = readEventsNotInGit({
      ...ctx,
      now: Date.now() + (OLD_AFTER_HOURS + 30) * 3_600_000,
    }) as NonNullable<ReturnType<typeof readEventsNotInGit>>;
    expect(later.old).toBe(true);
    expect(saysEventsNotInGit(later)).toMatch(
      /\(the oldest was written 2 days ago, which is old: past 24 hours\)/,
    );
    expect(saysEventsNotInGit(day)).toMatch(/\(the oldest was written 24 hours ago\)/);
    // Commits that reached the default branch since the last one that changed the record.
    expect(fresh.commitsSinceRecordCommit).toBe(0);
    writeFileSync(join(local, 'code.txt'), 'x\n');
    expect(git(local, 'add', 'code.txt').status).toBe(0);
    expect(git(local, 'commit', '-qm', 'work').status).toBe(0);
    expect(git(local, 'push', '-q', 'origin', 'main').status).toBe(0);
    expect(git(local, 'fetch', '-q').status).toBe(0);
    const since = readEventsNotInGit(ctx) as NonNullable<ReturnType<typeof readEventsNotInGit>>;
    expect(since).toMatchObject({ defaultBranch: 'origin/main', commitsSinceRecordCommit: 1 });
    expect(saysEventsNotInGit(since)).toMatch(
      /origin\/main has had 1 commit since the last one that changed the record\./,
    );
  });

  it('reads the default branch where the base of record commit reads it, and refuses what it refuses', () => {
    const { local } = world();
    const ask = (args: readonly string[]) => {
      const ran = git(local, ...args);
      return ran.status === 0 ? ran.out.trim() : undefined;
    };
    expect(theDefaultBranch(ask)).toMatchObject({ ok: true, remote: 'origin', branch: 'main' });
    expect(theDefaultBranch(() => undefined)).toEqual({
      ok: false,
      reason: 'NO_REMOTE',
      remotes: [],
    });
  });
});

describe('the three surfaces take the sentence from one module', () => {
  const surfaceFiles = [
    'commands/doctor.ts',
    'commands/tally.ts',
    'presentation/status.ts',
    'commands/status.ts',
  ];

  it('each reads or says it through events-not-in-git.ts, and no other file words it', () => {
    for (const file of surfaceFiles.slice(0, 3)) {
      expect(readFileSync(join(SRC, file), 'utf-8'), file).toContain('saysEventsNotInGit');
    }
    expect(readFileSync(join(SRC, 'commands/status.ts'), 'utf-8')).toContain('readEventsNotInGit');
    expect(readFileSync(join(SRC, 'commands/record-commit.ts'), 'utf-8')).toContain(
      'theDefaultBranch',
    );
    const phrase = 'not in a git commit yet';
    const holders = readdirSync(SRC, { recursive: true, encoding: 'utf-8' })
      .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
      .filter((path) => readFileSync(join(SRC, path), 'utf-8').includes(phrase));
    expect(holders).toEqual(['events-not-in-git.ts']);
  });
});
