/**
 * THE RECORD'S NAME SURVIVES A CUT OF ITS GENESIS MADE WITH `mnema tail prune` (ADR-146, FORMAT.md
 * section 6.10).
 *
 * The name derives from the genesis tail, and a person may cut any whole tail, the genesis too.
 * The name does not move with the cut because of where the waiver is written: `tail prune` seals
 * the `tail.pruned` before the cut, while the genesis is still on disk, on the pruner's own tail,
 * and that tail's proof and checkpoint name the record under the second scheme. Once the genesis
 * is gone, a writer takes the name from that tail (the name the other tails carry), and the
 * readers find every named tail naming one record.
 *
 * WHAT IS RUN. The built binary, with a `HOME` of its own per machine, over a sandbox git
 * repository holding a record two earlier binaries wrote (two tails, neither naming a record). A
 * branch made before the cut names the record from the genesis; on main, the genesis is cut with
 * `tail prune` and then removed from git, and another machine writes; the branch is merged. Both
 * readers verify the merge and `verify --since` holds it to main after the cut.
 *
 * THE OTHER SIDE, declared and not mended: the same genesis removed from git with no waiver (a cut
 * by hand, or by mnema 0.1.4, whose waiver lives on a tail that names no record) leaves the main
 * writer to name the record from the tails present, and the merge holds two names, which both
 * readers refuse. `verify --since` refuses the branch before the merge. So does a tail written
 * before records were named whose first entry is older than the genesis, brought by a branch on
 * which a mnema that names records wrote after it (the clock case).
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { ROOT } from './support/published-examples.js';

const BINARY = join(ROOT, 'packages/code/dist/cli.js');
const VERIFIER = join(ROOT, 'packages/chain/verifier/mnema_verify.py');
const FIXTURES = join(ROOT, 'packages/chain/src/chain/__fixtures__');

/** The two records written before records were named, and the tail of each. */
const LATER = join(FIXTURES, 'written-by-an-earlier-binary');
const EARLIER = join(FIXTURES, 'witnessed-record');
/** The tail of {@link EARLIER}: its first entry is the earliest, so it is the genesis. */
const GENESIS =
  '7e5a72fd0ea237237651690087e4a87133dab8b78847efadde778f633214cca4-05e27e636158e547a09e594545603717';

let sandbox: string;

function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: join(sandbox, 'git-home'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** `mnema <args>` in `dir`, as the machine whose HOME is `machine`. */
function mnema(machine: string, dir: string, ...args: string[]) {
  const ran = spawnSync(process.execPath, [BINARY, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(sandbox, machine) },
  });
  return { status: ran.status ?? -1, out: ran.stdout, err: ran.stderr };
}

function written(machine: string, dir: string, ...args: string[]): void {
  const ran = mnema(machine, dir, ...args);
  if (ran.status !== 0) throw new Error(`mnema ${args.join(' ')}: ${ran.err}`);
}

/** The second reader's verdict over the record at `repo`. */
function secondVerdict(repo: string): string {
  const run = spawnSync('python3', ['-I', VERIFIER, '--json', 'record', join(repo, '.mnema')], {
    encoding: 'utf-8',
  });
  if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
  return (JSON.parse(run.stdout) as { verdict: string }).verdict;
}

/** A repository whose record two earlier binaries wrote: two tails, neither naming a record. */
function aRecordFromBefore(name: string): string {
  const repo = join(sandbox, name);
  mkdirSync(join(repo, '.mnema', 'tails'), { recursive: true });
  mkdirSync(join(repo, '.mnema', 'keys'));
  git(repo, 'init', '-q');
  for (const from of [LATER, EARLIER]) {
    for (const tail of readdirSync(join(from, 'tails'))) {
      cpSync(join(from, 'tails', tail), join(repo, '.mnema', 'tails', tail), { recursive: true });
    }
    for (const key of readdirSync(join(from, 'keys'))) {
      if (key.endsWith('.pub')) cpSync(join(from, 'keys', key), join(repo, '.mnema', 'keys', key));
    }
  }
  git(repo, 'add', '.mnema');
  git(repo, 'commit', '-q', '-m', 'a record from before records were named');
  return repo;
}

/**
 * A branch made before the cut, where a mnema that names records writes; then, on main, the
 * genesis cut (with the waiver first where `withTheVerb`), and another machine writing there.
 * Returns the commit of main right after the cut. Main is left checked out, not yet merged.
 */
function branchThenCut(repo: string, withTheVerb: boolean): string {
  git(repo, 'switch', '-q', '-c', 'feature');
  written('branch', repo, 'decision', 'record', 'Work on a branch', 'Made before the cut');
  git(repo, 'add', '.mnema');
  git(repo, 'commit', '-q', '-m', 'feature');
  git(repo, 'switch', '-q', 'main');
  if (withTheVerb) {
    written('pruner', repo, 'tail', 'prune', GENESIS, '--reason', 'Asked to be taken out');
    git(repo, 'add', '.mnema');
  }
  git(repo, 'rm', '-rq', join('.mnema', 'tails', GENESIS));
  git(repo, 'commit', '-q', '-m', 'cut the genesis');
  const cut = git(repo, 'rev-parse', 'HEAD');
  written('main', repo, 'decision', 'record', 'Work on main', 'After the cut');
  git(repo, 'add', '.mnema');
  git(repo, 'commit', '-q', '-m', 'main');
  return cut;
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-genesis-cut-'));
  for (const machine of ['git-home', 'branch', 'pruner', 'main']) {
    mkdirSync(join(sandbox, machine));
  }
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a genesis cut with tail prune keeps the record its name', () => {
  let repo: string;
  let cut: string;

  beforeAll(() => {
    repo = aRecordFromBefore('with-the-verb');
    cut = branchThenCut(repo, true);
    git(repo, 'merge', '-q', '--no-edit', 'feature');
  }, 120_000);

  it('verifies the merge in both readers, every named tail naming one record', () => {
    const ran = mnema('branch', repo, 'verify', '--require=signed');
    expect(ran.status, ran.err).toBe(0);
    expect(ran.err).not.toContain('another-record');
    expect(secondVerdict(repo)).toBe('VERIFIED');
  });

  it('holds the merge to main after the cut with verify --since', () => {
    const ran = mnema('branch', repo, 'verify', '--require=signed', '--since', cut);
    expect(ran.status, ran.err).toBe(0);
    expect(ran.out).toContain('the record only grew');
  });
});

describe('a genesis removed with no waiver leaves two names, refused before and after the merge', () => {
  let repo: string;
  let cut: string;

  beforeAll(() => {
    repo = aRecordFromBefore('by-hand');
    cut = branchThenCut(repo, false);
  }, 120_000);

  it('refuses the branch with verify --since against main after the cut', () => {
    git(repo, 'switch', '-q', 'feature');
    const ran = mnema('branch', repo, 'verify', '--require=signed', '--since', cut);
    git(repo, 'switch', '-q', 'main');
    expect(ran.status).toBe(1);
    expect(ran.err).toContain('(another-record)');
  });

  it('is refused by both readers once merged', () => {
    git(repo, 'merge', '-q', '--no-edit', 'feature');
    const ran = mnema('branch', repo, 'verify', '--require=signed');
    expect(ran.status).toBe(1);
    expect(ran.err).toContain('this directory holds tails of 2 records');
    expect(secondVerdict(repo)).toBe('REFUSED');
  });
});

describe('an older tail brought by a branch that named the record after it leaves two names', () => {
  let repo: string;
  let base: string;

  beforeAll(() => {
    // Main holds only the later tail; a branch brings the earlier one (a machine whose clock ran
    // behind, on mnema 0.1.4) and a mnema that names records writes there, naming the record from
    // it; main's own writer names it from the later one.
    repo = join(sandbox, 'clock');
    mkdirSync(join(repo, '.mnema'), { recursive: true });
    git(repo, 'init', '-q');
    cpSync(join(LATER, 'tails'), join(repo, '.mnema', 'tails'), { recursive: true });
    cpSync(join(LATER, 'keys'), join(repo, '.mnema', 'keys'), { recursive: true });
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'base');
    base = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'switch', '-q', '-c', 'older');
    cpSync(join(EARLIER, 'tails'), join(repo, '.mnema', 'tails'), { recursive: true });
    for (const key of readdirSync(join(EARLIER, 'keys'))) {
      if (key.endsWith('.pub'))
        cpSync(join(EARLIER, 'keys', key), join(repo, '.mnema', 'keys', key));
    }
    written('branch', repo, 'decision', 'record', 'Work beside an older tail', 'On the branch');
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'older');
    git(repo, 'switch', '-q', 'main');
    written('main', repo, 'decision', 'record', 'Work on main', 'Without it');
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'main');
  }, 120_000);

  it('refuses the branch with verify --since against the base', () => {
    git(repo, 'switch', '-q', 'older');
    const ran = mnema('branch', repo, 'verify', '--require=signed', '--since', base);
    git(repo, 'switch', '-q', 'main');
    expect(ran.status).toBe(1);
    expect(ran.err).toContain('(another-record)');
  });

  it('is refused by both readers once merged', () => {
    git(repo, 'merge', '-q', '--no-edit', 'older');
    const ran = mnema('branch', repo, 'verify', '--require=signed');
    expect(ran.status).toBe(1);
    expect(ran.err).toContain('this directory holds tails of 2 records');
    expect(secondVerdict(repo)).toBe('REFUSED');
  });
});
