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
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../../code/tests/support/git-without-maintenance.js';
import { renderComment } from './comment.js';
import { judge } from './judge.js';
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
  it.each([2, 4, 6])(
    'quotes the refusal by name with %i keys without a tail',
    (keys) => {
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
    },
    60_000,
  );
});

/** `git` whose output is read, with the same sandbox as `git` above. */
const gitOut = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
  }).trim();

describe('a pull request that lifts the rule off the file it edits', () => {
  /**
   * A base where accepted rule R asks for a person at src/auth.ts, a branch that supersedes R and
   * edits the file ("attack"), and one that only edits it ("control").
   */
  function theRepository(rel = 'asks-for-a-person'): { repo: string; base: string } {
    const repo = join(sandbox, `repo-${rel}`);
    const home = join(sandbox, `home-${rel}`);
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(home);
    git(repo, 'init', '-q', '-b', 'main');
    mnemaAs(home, repo, 'init');
    writeFileSync(join(repo, 'src', 'auth.ts'), 'export const secret = 1;\n');
    const said = mnemaAs(home, repo, 'decision', 'record', 'Auth needs a person', 'Sensitive');
    const old = /[0-9a-f]{8}-[0-9a-f-]{27}/.exec(said)?.[0] as string;
    mnemaAs(
      home,
      repo,
      'decision',
      'move',
      'accept',
      old,
      '--note',
      'Maintainer: auth needs a person',
    );
    mnemaAs(home, repo, 'link', old, 'src/auth.ts', '--rel', rel);
    git(repo, 'add', '.mnema', 'src');
    git(repo, 'commit', '-q', '-m', 'base');
    const base = gitOut(repo, 'rev-parse', 'HEAD');

    git(repo, 'switch', '-q', '-c', 'control');
    writeFileSync(join(repo, 'src', 'auth.ts'), 'export const secret = 2;\n');
    git(repo, 'commit', '-q', '-am', 'edit auth');
    git(repo, 'switch', '-q', 'main');
    git(repo, 'switch', '-q', '-c', 'moved');
    git(repo, 'mv', 'src/auth.ts', 'src/auth2.ts');
    git(repo, 'commit', '-q', '-m', 'move auth');
    git(repo, 'switch', '-q', 'main');
    git(repo, 'switch', '-q', '-c', 'moved-and-edited');
    git(repo, 'mv', 'src/auth.ts', 'src/auth2.ts');
    writeFileSync(
      join(repo, 'src', 'auth2.ts'),
      'export const secret = 1;\nexport const more = 2;\n',
    );
    git(repo, 'add', 'src');
    git(repo, 'commit', '-q', '-m', 'move and edit auth');
    git(repo, 'switch', '-q', 'main');
    git(repo, 'switch', '-q', '-c', 'deleted');
    git(repo, 'rm', '-q', 'src/auth.ts');
    git(repo, 'commit', '-q', '-m', 'delete auth');
    git(repo, 'switch', '-q', 'main');

    git(repo, 'switch', '-q', 'main');
    git(repo, 'switch', '-q', '-c', 'attack');
    const relaxed = mnemaAs(home, repo, 'decision', 'record', 'Auth needs nobody', 'Relaxed');
    const next = /[0-9a-f]{8}-[0-9a-f-]{27}/.exec(relaxed)?.[0] as string;
    mnemaAs(home, repo, 'decision', 'move', 'accept', next, '--note', 'Maintainer: relax');
    mnemaAs(home, repo, 'decision', 'supersede', old, next, '--reason', 'relax the auth rule');
    writeFileSync(join(repo, 'src', 'auth.ts'), 'export const secret = 2;\n');
    git(repo, 'add', '.mnema', 'src');
    git(repo, 'commit', '-q', '-m', 'relax the rule and edit auth');
    vi.stubEnv('HOME', home);
    return { repo, base };
  }

  async function judged(repo: string, base: string, branch: string) {
    git(repo, 'switch', '-q', branch);
    let comment = '';
    const github = {
      changedFiles: async () =>
        gitOut(repo, 'diff', '-M', '--name-status', `${base}..HEAD`)
          .split('\n')
          .map((line) => line.split('\t'))
          .map(([status, a, b]) =>
            status?.startsWith('R')
              ? { path: b as string, renamedFrom: a as string }
              : { path: a as string },
          ),
      reviews: async () => [],
      upsertComment: async (body: string) => {
        comment = body;
        return 'created';
      },
    };
    const world = worldAt(repo, github as never, { info() {}, warning() {} }, {});
    const verdict = await judge(world, {
      baseSha: base,
      author: 'author',
      requireApprovalForAsks: true,
    });
    return { verdict, comment };
  }

  it('fails the attack and the control alike, and says where the rules came from', async () => {
    const { repo, base } = theRepository();
    const attack = await judged(repo, base, 'attack');
    expect(attack.verdict.failed, attack.comment).toBe(true);
    expect(attack.comment).toContain('Rules read at the base');
    expect(attack.comment).toContain('asks for a person: Auth needs a person');
    const control = await judged(repo, base, 'control');
    expect(control.verdict.failed, control.comment).toBe(true);
  }, 120_000);

  it('fails a rename of the protected file, edited or not, and its removal', async () => {
    const { repo, base } = theRepository();
    for (const branch of ['moved', 'moved-and-edited', 'deleted']) {
      const run = await judged(repo, base, branch);
      expect(run.verdict.failed, `${branch}: ${run.comment}`).toBe(true);
      expect(run.comment, branch).toContain('asks for a person: Auth needs a person');
    }
    const renamed = await judged(repo, base, 'moved-and-edited');
    expect(renamed.comment).toContain('`src/auth.ts` (renamed to src/auth2.ts)');
  }, 120_000);

  it('fails the same way when the rule refuses a write, edited, moved or removed', async () => {
    const { repo, base } = theRepository('refuses-a-write');
    for (const branch of ['attack', 'control', 'moved', 'moved-and-edited', 'deleted']) {
      const run = await judged(repo, base, branch);
      expect(run.verdict.failed, `${branch}: ${run.comment}`).toBe(true);
      expect(run.verdict.reasons, branch).toEqual([
        'a rule refuses a write to a changed file and no one but the author has approved',
      ]);
      expect(run.comment, branch).toContain('a write is refused by Auth needs a person');
    }
  }, 120_000);

  it('reads, in this process, the very answer the command prints, at the head and at the base', () => {
    const { repo, base } = theRepository();
    const world = worldAt(repo, {} as never, { info() {}, warning() {} }, {});
    const printed = (cwd: string, path: string): unknown =>
      JSON.parse(mnemaAs(process.env.HOME as string, cwd, 'rules', '--json', '--', path));
    const paths = ['src/auth.ts', 'src/auth2.ts', 'src', 'README.md', 'src/missing/deep.ts'];
    const atBase = world.mnema.rulesAt(base);
    try {
      for (const path of paths) {
        expect(world.mnema.rules(path), `head ${path}`).toEqual(printed(repo, path));
      }
      // The attack branch is checked out: its head says the rule was superseded, its base says not.
      expect(atBase.rules('src/auth.ts')).not.toEqual(world.mnema.rules('src/auth.ts'));
      const governed = atBase.rules('src/auth.ts') as { asks: { name?: string }[] };
      expect(governed.asks.map((one) => one.name)).toEqual(['Auth needs a person']);
    } finally {
      atBase.close();
    }
  }, 120_000);

  it('leaves no copy of the base behind', async () => {
    const { repo, base } = theRepository();
    const runnerTemp = join(sandbox, 'runner-temp');
    mkdirSync(runnerTemp);
    vi.stubEnv('RUNNER_TEMP', runnerTemp);
    await judged(repo, base, 'attack');
    expect(readdirSync(runnerTemp)).toEqual([]);
  }, 120_000);
});

describe('a pull request that brings a tail the base is not the record of', () => {
  /** A record an earlier binary wrote, before records were named: its one tail names none. */
  const WRITTEN_BEFORE = join(
    import.meta.dirname,
    '../../chain/src/chain/__fixtures__/written-by-an-earlier-binary',
  );

  /** Copies the one tail of the record at `from`, with every public key beside it, into `repo`. */
  function graft(repo: string, from: string): string {
    const tail = readdirSync(join(from, 'tails'))[0] as string;
    cpSync(join(from, 'tails', tail), join(repo, '.mnema', 'tails', tail), { recursive: true });
    for (const key of readdirSync(join(from, 'keys'))) {
      if (key.endsWith('.pub')) cpSync(join(from, 'keys', key), join(repo, '.mnema', 'keys', key));
    }
    return tail;
  }

  /**
   * A base named by the record `init` began, and four branches: a second machine writing into the
   * same record, a tail written before records were named grafted in, a tail of another record
   * grafted in, and the first machine writing again.
   */
  function theRepository(): { repo: string; base: string; unnamed: string; foreign: string } {
    const repo = join(sandbox, 'repo-arrived');
    const home = join(sandbox, 'home-arrived');
    const second = join(sandbox, 'second-arrived');
    const elsewhere = join(sandbox, 'elsewhere-arrived');
    const other = join(sandbox, 'other-arrived');
    for (const dir of [repo, home, second, elsewhere, other]) mkdirSync(dir);
    git(repo, 'init', '-q', '-b', 'main');
    mnemaAs(home, repo, 'init');
    mnemaAs(home, repo, 'decision', 'record', 'Use the standard library', 'It is there');
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'base');
    const base = gitOut(repo, 'rev-parse', 'HEAD');
    git(other, 'init', '-q');
    mnemaAs(elsewhere, other, 'init');
    mnemaAs(elsewhere, other, 'decision', 'record', 'Another project', 'Elsewhere');

    const branch = (name: string, change: () => void) => {
      git(repo, 'switch', '-q', 'main');
      git(repo, 'switch', '-q', '-c', name);
      change();
      git(repo, 'add', '.mnema');
      git(repo, 'commit', '-q', '-m', name);
    };
    branch('same-record', () => {
      mnemaAs(second, repo, 'decision', 'record', 'A second machine', 'Its own tail');
    });
    let unnamed = '';
    branch('unnamed', () => {
      unnamed = graft(repo, WRITTEN_BEFORE);
    });
    let foreign = '';
    branch('another-record', () => {
      foreign = graft(repo, join(other, '.mnema'));
    });
    branch('nothing-new', () => {
      mnemaAs(home, repo, 'decision', 'record', 'The same machine', 'The same tail');
    });
    vi.stubEnv('HOME', home);
    return { repo, base, unnamed, foreign };
  }

  async function judged(repo: string, base: string, branch: string) {
    git(repo, 'switch', '-q', branch);
    let comment = '';
    const github = {
      changedFiles: async () =>
        gitOut(repo, 'diff', '--name-only', `${base}..HEAD`)
          .split('\n')
          .filter(Boolean)
          .map((path) => ({ path })),
      reviews: async () => [],
      upsertComment: async (body: string) => {
        comment = body;
        return 'created';
      },
    };
    const world = worldAt(repo, github as never, { info() {}, warning() {} }, {});
    const verdict = await judge(world, {
      baseSha: base,
      author: 'author',
      requireApprovalForAsks: false,
    });
    return { verdict, comment };
  }

  it('fails the tail that names no record and the tail of another record, saying which', async () => {
    const { repo, base, unnamed, foreign } = theRepository();
    for (const branch of ['same-record', 'nothing-new']) {
      const run = await judged(repo, base, branch);
      expect(run.verdict.failed, `${branch}: ${run.comment}`).toBe(false);
    }
    const bare = await judged(repo, base, 'unnamed');
    expect(bare.verdict.reasons).toEqual([
      'the record does not verify as signed, as the base record grown',
    ]);
    expect(bare.comment).toContain(`tail ${unnamed} arrived since and names no record`);
    const grafted = await judged(repo, base, 'another-record');
    expect(grafted.verdict.failed).toBe(true);
    expect(grafted.comment).toContain(`tail ${foreign} arrived since and names record`);
    expect(grafted.comment).toContain('a tail of another record (another-record)');
  }, 120_000);
});
