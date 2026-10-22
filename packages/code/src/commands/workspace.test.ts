import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../../tests/support/git-without-maintenance.js';
import { fixWorkbench, runDoctor } from './doctor.js';
import { runInit } from './init.js';
import { WORKBENCH_FILES } from './the-workbench-files.js';
import {
  repairTheLink,
  runWorkspaceInit,
  runWorkspaceStatus,
  type WorkspaceInitDone,
  type WorkspaceRefused,
  type WorkspaceStatus,
} from './workspace.js';

let sandbox: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-workspace-'));
  env = { home: join(sandbox, 'home') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** git over a repository of the sandbox, never reading the machine's own configuration. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: sandbox,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
}

/** A git repository with a founded mnema project at its top. */
function founded(): string {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.md'), '# a\n');
  git(repo, 'add', 'a.md');
  git(repo, 'commit', '-qm', 'base');
  const result = runInit({ cwd: repo, env });
  if ('refused' in result) throw new Error('setup: init refused');
  return repo;
}

function done(found: WorkspaceInitDone | WorkspaceRefused): WorkspaceInitDone {
  if (!found.ok) throw new Error(`setup: refused ${found.reason}`);
  return found;
}

function statusOf(found: WorkspaceStatus | WorkspaceRefused): WorkspaceStatus {
  if (!found.ok) throw new Error(`setup: refused ${found.reason}`);
  return found;
}

function presentStatus(found: WorkspaceStatus | WorkspaceRefused): WorkspaceStatus & {
  readonly present: true;
} {
  const status = statusOf(found);
  if (!status.present) throw new Error('setup: no workbench');
  return status;
}

describe('mnema workspace init', () => {
  it('refuses where there is no project, and where the .mnema/ was never founded', () => {
    const bare = join(sandbox, 'bare');
    mkdirSync(bare, { recursive: true });
    git(bare, 'init', '-q');
    expect(runWorkspaceInit({ cwd: bare, env })).toMatchObject({ ok: false, reason: 'NO_PROJECT' });

    // A `.mnema/` that holds only notes is no founded record: the walk would take it for a project.
    mkdirSync(join(bare, '.mnema', 'workbench'), { recursive: true });
    expect(runWorkspaceInit({ cwd: bare, env })).toMatchObject({
      ok: false,
      reason: 'NOT_FOUNDED',
    });
    expect(existsSync(join(bare, '.mnema', '.gitignore'))).toBe(false);
    expect(existsSync(join(bare, '.mnema', 'workbench', 'README.md'))).toBe(false);
  });

  it('refuses a project in no git repository, since the private half lives in the git directory', () => {
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    const result = runInit({ cwd: plain, env });
    expect('refused' in result).toBe(false);
    expect(runWorkspaceInit({ cwd: plain, env })).toMatchObject({
      ok: false,
      reason: 'NO_GIT_REPOSITORY',
    });
    expect(existsSync(join(plain, '.mnema', 'workbench'))).toBe(false);
  });

  it('makes the tree, links local into the git directory, and shows git only the shared files', () => {
    const repo = founded();
    const result = done(runWorkspaceInit({ cwd: repo, env }));

    expect(result.made).toEqual([
      'README.md',
      'templates/change.md',
      'templates/brief.md',
      'templates/study.md',
      'templates/log.md',
      'shared/.gitkeep',
    ]);
    const workbench = join(repo, '.mnema', 'workbench');
    const target = join(repo, '.git', 'mnema', '%2E', 'workbench');
    expect(lstatSync(join(workbench, 'local')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(workbench, 'local'))).toBe(target);
    expect(existsSync(join(target, 'changes'))).toBe(true);
    expect(existsSync(join(target, 'studies'))).toBe(true);
    // A private folder is never called `private`: that name is the private tree's.
    expect(existsSync(join(workbench, 'private'))).toBe(false);

    const shown = git(repo, 'status', '--porcelain', '-uall')
      .split('\n')
      .filter((line) => line.includes('workbench'))
      .map((line) => line.slice(3))
      .sort();
    expect(shown).toEqual([
      '.mnema/workbench/README.md',
      '.mnema/workbench/shared/.gitkeep',
      '.mnema/workbench/templates/brief.md',
      '.mnema/workbench/templates/change.md',
      '.mnema/workbench/templates/log.md',
      '.mnema/workbench/templates/study.md',
    ]);
  });

  it('keeps the link out of git in a record whose .gitignore predates the workbench', () => {
    const repo = founded();
    const ignore = join(repo, '.mnema', '.gitignore');
    const older = readFileSync(ignore, 'utf-8')
      .split('\n')
      .filter((line) => !line.includes('workbench'))
      .join('\n');
    writeFileSync(ignore, older);

    done(runWorkspaceInit({ cwd: repo, env }));

    expect(readFileSync(ignore, 'utf-8')).toContain('/workbench/local\n');
    const untracked = git(repo, 'status', '--porcelain', '-uall');
    expect(untracked).not.toContain('workbench/local');
    git(repo, 'add', '-A', '.mnema');
    expect(git(repo, 'diff', '--cached', '--name-only')).not.toContain('workbench/local');
  });

  it('makes no link when the record cannot be told to ignore it: the guarantee comes first', () => {
    const repo = founded();
    // A `.gitignore` that cannot be read as a file stops `ensureTree`; the link must not exist then.
    const ignore = join(repo, '.mnema', '.gitignore');
    rmSync(ignore);
    mkdirSync(ignore);

    expect(() => runWorkspaceInit({ cwd: repo, env })).toThrow();

    expect(existsSync(join(repo, '.mnema', 'workbench', 'local'))).toBe(false);
    expect(() => lstatSync(join(repo, '.mnema', 'workbench', 'local'))).toThrow();
  });

  it('changes nothing when run again, and says so', () => {
    const repo = founded();
    done(runWorkspaceInit({ cwd: repo, env }));
    const again = done(runWorkspaceInit({ cwd: repo, env }));
    expect(again.made).toEqual([]);
    expect(again.linked).toBe(false);
  });

  it('never writes over a file the person edited, a template included', () => {
    const repo = founded();
    done(runWorkspaceInit({ cwd: repo, env }));
    const readme = join(repo, '.mnema', 'workbench', 'README.md');
    const template = join(repo, '.mnema', 'workbench', 'templates', 'change.md');
    writeFileSync(readme, 'mine\n');
    writeFileSync(template, 'also mine\n');
    rmSync(join(repo, '.mnema', 'workbench', 'templates', 'study.md'));

    const again = done(runWorkspaceInit({ cwd: repo, env }));

    expect(readFileSync(readme, 'utf-8')).toBe('mine\n');
    expect(readFileSync(template, 'utf-8')).toBe('also mine\n');
    // What is absent is made again, and only that.
    expect(again.made).toEqual(['templates/study.md']);
  });

  it('leaves a link that points elsewhere, and a local that is no link, as they are', () => {
    const repo = founded();
    const local = join(repo, '.mnema', 'workbench', 'local');
    mkdirSync(join(repo, '.mnema', 'workbench'), { recursive: true });
    symlinkSync(sandbox, local, 'dir');
    expect(runWorkspaceInit({ cwd: repo, env })).toMatchObject({
      ok: false,
      reason: 'LINK_ELSEWHERE',
      detail: sandbox,
    });
    expect(readlinkSync(local)).toBe(sandbox);

    rmSync(local);
    mkdirSync(local);
    writeFileSync(join(local, 'mine.md'), 'mine\n');
    expect(runWorkspaceInit({ cwd: repo, env })).toMatchObject({
      ok: false,
      reason: 'LOCAL_NOT_A_LINK',
    });
    expect(readFileSync(join(local, 'mine.md'), 'utf-8')).toBe('mine\n');
  });

  it('links a worktree to the same folder: a note written in one is read in the other, and outlives it', () => {
    const repo = founded();
    git(repo, 'add', '-A', '.mnema');
    git(repo, 'commit', '-qm', 'record');
    done(runWorkspaceInit({ cwd: repo, env }));
    git(repo, 'add', '-A', '.mnema');
    git(repo, 'commit', '-qm', 'workbench');

    const other = join(sandbox, 'repo-other');
    git(repo, 'worktree', 'add', '-q', other, '-b', 'side');
    const result = done(runWorkspaceInit({ cwd: other, env }));
    expect(result.linked).toBe(true);
    expect(result.made).toEqual([]);
    expect(result.places.target).toBe(done(runWorkspaceInit({ cwd: repo, env })).places.target);

    writeFileSync(join(other, '.mnema', 'workbench', 'local', 'studies', 'note.md'), 'from side\n');
    expect(
      readFileSync(join(repo, '.mnema', 'workbench', 'local', 'studies', 'note.md'), 'utf-8'),
    ).toBe('from side\n');

    git(repo, 'worktree', 'remove', '--force', other);
    expect(
      readFileSync(join(repo, '.mnema', 'workbench', 'local', 'studies', 'note.md'), 'utf-8'),
    ).toBe('from side\n');
  });
});

describe('what init leaves to copy', () => {
  const text = (path: string): string => {
    const file = WORKBENCH_FILES.find((one) => one.path === path);
    if (file === undefined) throw new Error(`setup: no ${path}`);
    return file.text;
  };

  it('has a README of about forty lines that says the notes are not proof, and where a session starts', () => {
    const readme = text('README.md');
    expect(readme.split('\n').length).toBeGreaterThan(30);
    expect(readme.split('\n').length).toBeLessThan(50);
    expect(readme).toContain('Nothing here is proof');
    expect(readme).toContain('`mnema verify` does not read this folder');
    expect(readme).toContain('Read every `change.md` whose status is `open`');
    expect(readme).toContain('last line of the `log.md`');
    expect(readme).toContain('cites its id and never restates it');
  });

  it('has a change template with the status values, the front matter and the sections', () => {
    const change = text('templates/change.md');
    expect(change).toContain('status: proposed # proposed | open | paused | done | dropped');
    for (const key of [
      'opened',
      'closed',
      'claimed_by',
      'part_of',
      'base',
      'decisions',
      'delivered',
    ]) {
      expect(change).toContain(`\n${key}:`);
    }
    const sections = change.split('\n').filter((line) => line.startsWith('## '));
    expect(sections).toEqual([
      '## Why',
      '## Scope',
      '## Out of scope / Stop',
      '## Plan',
      '## Tasks',
      '## Done when',
    ]);
  });

  it('has a brief, a study and a log with theirs', () => {
    const brief = text('templates/brief.md');
    for (const key of ['change', 'n', 'to', 'sent']) expect(brief).toContain(`\n${key}:`);
    expect(brief.split('\n').filter((line) => line.startsWith('## '))).toEqual([
      '## Read first',
      '## Settled (mnema ids; do not reopen)',
      '## Build',
      '## Stop',
      '## Report',
    ]);
    const study = text('templates/study.md');
    for (const key of ['status', 'base', 'question']) expect(study).toContain(`${key}:`);
    expect(study.split('\n').filter((line) => line.startsWith('## '))).toEqual([
      '## Conclusion',
      '## Evidence',
      '## What would overturn it',
      '## Not examined',
      '## Decisions it produced (ids)',
    ]);
    expect(text('templates/log.md')).toContain('YYYY-MM-DD HH:MM · who · what · next');
    expect(text('shared/.gitkeep')).toBe('');
  });
});

describe('mnema workspace status', () => {
  it('says there is no workbench before init, in a repository or not, and refuses outside a project', () => {
    const repo = founded();
    expect(statusOf(runWorkspaceStatus({ cwd: repo, env })).present).toBe(false);
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    runInit({ cwd: plain, env });
    expect(statusOf(runWorkspaceStatus({ cwd: plain, env })).present).toBe(false);
    expect(runWorkspaceStatus({ cwd: sandbox, env })).toMatchObject({
      ok: false,
      reason: 'NO_PROJECT',
    });
  });

  it('counts each root and lists only the changes that are open or paused, naming no content', () => {
    const repo = founded();
    done(runWorkspaceInit({ cwd: repo, env }));
    const local = join(repo, '.mnema', 'workbench', 'local');
    const change = (root: string, folder: string, status: string): void => {
      mkdirSync(join(root, 'changes', folder), { recursive: true });
      writeFileSync(
        join(root, 'changes', folder, 'change.md'),
        `---\nstatus: ${status}\nclaimed_by: somebody\n---\n# SECRET-TITLE\nSECRET-BODY\n`,
      );
    };
    change(local, '2026-10-22-first', 'open');
    change(local, '2026-10-21-second', 'open # why');
    change(local, '2026-10-20-third', 'paused');
    change(local, '2026-10-19-fourth', 'done');
    change(join(repo, '.mnema', 'workbench', 'shared'), '2026-10-18-shared', 'open');
    // A body that merely says it is open is no front matter.
    mkdirSync(join(local, 'changes', '2026-10-17-body'), { recursive: true });
    writeFileSync(join(local, 'changes', '2026-10-17-body', 'change.md'), '# x\nstatus: open\n');

    const status = presentStatus(runWorkspaceStatus({ cwd: repo, env }));

    expect(status.present).toBe(true);
    expect(status.link).toEqual({ state: 'right' });
    expect(status.sharedFiles).toBe(2);
    expect(status.localFiles).toBe(5);
    expect(status.changes.map((c) => `${c.status} ${c.root} ${c.folder}`).sort()).toEqual([
      'open local 2026-10-21-second',
      'open local 2026-10-22-first',
      'open shared 2026-10-18-shared',
      'paused local 2026-10-20-third',
    ]);
    expect(JSON.stringify(status)).not.toContain('SECRET');
    expect(JSON.stringify(status)).not.toContain('somebody');
  });
});

describe('mnema doctor, the workbench', () => {
  const topic = (repo: string) =>
    runDoctor({
      cwd: repo,
      env,
      processEnv: { PATH: '' },
      running: { file: '', version: '0.0.0' },
    }).findings.filter((f) => f.topic === 'workbench');
  const ctx = (repo: string) => ({
    cwd: repo,
    env,
    processEnv: { PATH: '' },
    running: { file: '', version: '0.0.0' },
  });

  it('says nothing where there is no workbench, and fine where the link is right', () => {
    const repo = founded();
    expect(topic(repo)).toEqual([]);
    done(runWorkspaceInit({ cwd: repo, env }));
    expect(topic(repo).map((f) => f.state)).toEqual(['fine']);
  });

  it('after git clean -x: says the link is gone, that the notes are not, and --fix makes it again', () => {
    const repo = founded();
    done(runWorkspaceInit({ cwd: repo, env }));
    git(repo, 'add', '-A', '.mnema');
    git(repo, 'commit', '-qm', 'record');
    writeFileSync(join(repo, '.mnema', 'workbench', 'local', 'studies', 'n.md'), 'kept\n');

    git(repo, 'clean', '-xfdq');
    expect(existsSync(join(repo, '.mnema', 'workbench', 'local'))).toBe(false);

    const found = topic(repo);
    expect(found).toHaveLength(1);
    expect(found[0]?.state).toBe('attention');
    expect(found[0]?.line).toContain('git clean -x');
    expect(found[0]?.line).toContain('mnema doctor --fix workbench');

    const dry = fixWorkbench(ctx(repo), { dryRun: true });
    expect(dry.refused).toBe(false);
    expect(existsSync(join(repo, '.mnema', 'workbench', 'local'))).toBe(false);

    expect(fixWorkbench(ctx(repo), { dryRun: false }).refused).toBe(false);
    expect(
      readFileSync(join(repo, '.mnema', 'workbench', 'local', 'studies', 'n.md'), 'utf-8'),
    ).toBe('kept\n');
    expect(topic(repo).map((f) => f.state)).toEqual(['fine']);
    expect(git(repo, 'status', '--porcelain', '-uall')).not.toContain('workbench/local');
  });

  it('points a link that leads elsewhere to the right folder, and leaves a local that is no link', () => {
    const repo = founded();
    done(runWorkspaceInit({ cwd: repo, env }));
    const local = join(repo, '.mnema', 'workbench', 'local');
    rmSync(local);
    symlinkSync(sandbox, local, 'dir');
    expect(topic(repo)[0]?.line).toContain('points to');
    expect(topic(repo)[0]?.state).toBe('attention');
    expect(repairTheLink({ cwd: repo, env })).toMatchObject({ ok: true, made: true });
    expect(topic(repo).map((f) => f.state)).toEqual(['fine']);

    rmSync(local);
    mkdirSync(local);
    expect(fixWorkbench(ctx(repo), { dryRun: false }).refused).toBe(true);
    expect(lstatSync(local).isDirectory()).toBe(true);
  });

  it('refuses to fix where there is no workbench', () => {
    const repo = founded();
    expect(fixWorkbench(ctx(repo), { dryRun: false })).toMatchObject({ refused: true });
    expect(existsSync(join(repo, '.mnema', 'workbench'))).toBe(false);
  });
});
