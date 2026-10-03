/**
 * `mnema inherit` and the brief that carries what it points at: a decisions repository is
 * another git repository with a record, read at one commit.
 *
 * The origin here is a LOCAL repository built in the sandbox — no network anywhere — whose
 * `.mnema/` was written by the product itself, then committed. Every assertion is about what a
 * person or the document would see, or about what must NOT change in the project's own record.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../../tests/support/git-without-maintenance.js';
import { briefDocument } from '../presentation/brief.js';
import { runBrief } from './brief.js';
import { runDecision } from './decision.js';
import { runDecisionTransition } from './decision-transition.js';
import { runInheritSet, runInheritUpdate } from './inherit.js';
import { runInit } from './init.js';
import { runVerify } from './verify.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-inherit-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE, GIT_CONFIG_NOSYSTEM: '1' },
    encoding: 'utf8',
  }).trim();
}

interface Place {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

function place(name: string): Place {
  const cwd = join(sandbox, name);
  mkdirSync(cwd, { recursive: true });
  const env = { home: join(sandbox, `${name}-home`) };
  runInit({ cwd, env });
  return { cwd, env };
}

function accept(at: Place, title: string): void {
  const recorded = runDecision(at, { title, rationale: 'because the record says so' });
  if (!recorded.ok) throw new Error(`setup: ${recorded.reason}`);
  const moved = runDecisionTransition(at, {
    id: recorded.id,
    action: 'accept',
    proof: { note: 'agreed' },
  });
  if (!moved.ok) throw new Error(`setup: ${moved.reason}`);
}

function commit(at: Place): string {
  git(at.cwd, 'add', '.mnema');
  git(
    at.cwd,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'record',
  );
  return git(at.cwd, 'rev-parse', 'HEAD');
}

/** A repository of decisions with one accepted decision, committed. */
function origin(): { at: Place; first: string } {
  const at = place('origin');
  git(at.cwd, 'init', '-q', '-b', 'main');
  accept(at, 'Postgres in every new service');
  return { at, first: commit(at) };
}

function titlesOf(at: Place): string[] {
  const done = runBrief(at);
  if (!done.ok) throw new Error('setup: brief refused');
  return done.inherited?.state === 'read' ? done.inherited.decisions.map((d) => d.title) : [];
}

describe('pointing a project at another repository', () => {
  it('prints what it would inherit and writes nothing without --write', () => {
    const { at: source, first } = origin();
    const project = place('project');
    const plan = runInheritSet(project, { where: source.cwd });
    expect(plan).toMatchObject({ ok: true, written: false, to: { commit: first } });
    if (!plan.ok) return;
    expect(plan.added.map((d) => d.title)).toEqual(['Postgres in every new service']);
    expect(existsSync(join(project.cwd, '.mnema', 'inherit.json'))).toBe(false);
  });

  it('records origin and the full commit in a committed file under --write', () => {
    const { at: source, first } = origin();
    const project = place('project');
    const plan = runInheritSet(project, { where: source.cwd, write: true });
    expect(plan.ok && plan.written).toBe(true);
    const file = JSON.parse(readFileSync(join(project.cwd, '.mnema', 'inherit.json'), 'utf8'));
    expect(file).toEqual({ origin: source.cwd, commit: first });
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    // The file is not ignored by the tree's own .gitignore: it travels with the repository.
    git(project.cwd, 'init', '-q');
    expect(() => git(project.cwd, 'check-ignore', '-q', '.mnema/inherit.json')).toThrow();
  });

  it('refuses a second `set` and sends the person to `update`', () => {
    const { at: source } = origin();
    const project = place('project');
    runInheritSet(project, { where: source.cwd, write: true });
    expect(runInheritSet(project, { where: source.cwd })).toMatchObject({
      ok: false,
      reason: 'ALREADY_INHERITING',
    });
  });

  it('keeps its copy under the mnema home and nothing in the project but the pointer', () => {
    const { at: source } = origin();
    const project = place('project');
    runInheritSet(project, { where: source.cwd, write: true });
    expect(readdirSync(join(project.env.home, '.mnema', 'inherited')).length).toBe(1);
    expect(readdirSync(project.cwd)).toEqual(['.mnema']);
    expect(existsSync(join(project.cwd, '.mnema', 'inherited'))).toBe(false);
  });
});

describe('the brief with an inherited record', () => {
  it('prints them in a section of their own with the origin and the commit, never among the project’s', () => {
    const { at: source, first } = origin();
    const project = place('project');
    accept(project, 'Use tabs here');
    runInheritSet(project, { where: source.cwd, write: true });
    const done = runBrief(project);
    if (!done.ok) throw new Error('refused');
    expect(done.brief.decisions.map((d) => d.title)).toEqual(['Use tabs here']);
    const text = briefDocument(done.brief, done.inherited).join('\n');
    const [own, inherited] = text.split('## Inherited decisions');
    expect(own).toContain('Use tabs here');
    expect(own).not.toContain('Postgres');
    expect(inherited).toContain('Postgres in every new service');
    expect(inherited).toContain(source.cwd);
    expect(inherited).toContain(first);
    expect(inherited).toContain('did not decide or sign');
  });

  it('is byte-identical to before for a project that inherits nothing', () => {
    const project = place('project');
    accept(project, 'Use tabs here');
    const done = runBrief(project);
    expect(done.ok && done.inherited).toBeUndefined();
    if (done.ok) expect(briefDocument(done.brief)).toEqual(briefDocument(done.brief, undefined));
  });

  it('does not sign them, and the project’s verify does not count them', () => {
    const { at: source } = origin();
    const project = place('project');
    accept(project, 'Use tabs here');
    const events = (): number => {
      const done = runVerify({ ...project, requirement: 'chained', global: false });
      if (!done.ok) throw new Error('refused');
      return done.trees
        .flatMap((t) => (t.kind === 'verdict' ? t.result.tails : []))
        .reduce((n, t) => n + t.entryCount, 0);
    };
    const before = events();
    runInheritSet(project, { where: source.cwd, write: true });
    expect(titlesOf(project)).toEqual(['Postgres in every new service']);
    expect(events()).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it('prints none of a record that does not verify at the pinned commit, and says so', () => {
    const { at: source } = origin();
    const project = place('project');
    runInheritSet(project, { where: source.cwd, write: true });
    // The origin's next commit alters a signed segment in place.
    const tails = join(source.cwd, '.mnema', 'tails');
    const segment = readdirSync(tails, { recursive: true, encoding: 'utf8' }).find((f) =>
      f.endsWith('000001.jsonl'),
    ) as string;
    const file = join(tails, segment);
    writeFileSync(file, readFileSync(file, 'utf8').replace('Postgres', 'Mysql'));
    const tampered = commit(source);
    writeFileSync(
      join(project.cwd, '.mnema', 'inherit.json'),
      JSON.stringify({ origin: source.cwd, commit: tampered }),
    );
    const done = runBrief(project);
    if (!done.ok) throw new Error('refused');
    expect(done.inherited?.state).toBe('unverified');
    const text = briefDocument(done.brief, done.inherited).join('\n');
    expect(text).toContain('did not verify');
    expect(text).not.toContain('Mysql');
    expect(text).not.toContain('Postgres');
    // and `set`/`update` will not point at it
    const refused = runInheritUpdate(project, { to: tampered, write: true });
    expect(refused).toMatchObject({ ok: false, reason: 'NOT_VERIFIED' });
  });

  it('says it when there is no copy and no origin to ask, and the rest still prints', () => {
    const project = place('project');
    accept(project, 'Use tabs here');
    writeFileSync(
      join(project.cwd, '.mnema', 'inherit.json'),
      JSON.stringify({ origin: join(sandbox, 'gone'), commit: 'a'.repeat(40) }),
    );
    const done = runBrief(project);
    if (!done.ok) throw new Error('refused');
    expect(done.inherited?.state).toBe('unavailable');
    const text = briefDocument(done.brief, done.inherited).join('\n');
    expect(text).toContain('could not be read here');
    expect(text).toContain('Use tabs here');
  });
});

describe('updating', () => {
  it('shows what changes between the two commits before it moves the pointer', () => {
    const { at: source, first } = origin();
    const project = place('project');
    runInheritSet(project, { where: source.cwd, write: true });
    accept(source, 'Redis for queues');
    const second = commit(source);
    const shown = runInheritUpdate(project, {});
    expect(shown).toMatchObject({
      ok: true,
      written: false,
      from: { commit: first },
      to: { commit: second },
      commits: 1,
      previous: 'read',
    });
    if (!shown.ok) return;
    expect(shown.added.map((d) => d.title)).toEqual(['Redis for queues']);
    expect(shown.removed).toEqual([]);
    expect(
      JSON.parse(readFileSync(join(project.cwd, '.mnema', 'inherit.json'), 'utf8')).commit,
    ).toBe(first);
    const moved = runInheritUpdate(project, { write: true });
    expect(moved.ok && moved.written).toBe(true);
    expect(
      JSON.parse(readFileSync(join(project.cwd, '.mnema', 'inherit.json'), 'utf8')).commit,
    ).toBe(second);
    expect(titlesOf(project).sort()).toEqual(['Postgres in every new service', 'Redis for queues']);
  });

  it('does not follow the origin on its own: a brief reads the pinned commit', () => {
    const { at: source } = origin();
    const project = place('project');
    runInheritSet(project, { where: source.cwd, write: true });
    accept(source, 'Redis for queues');
    commit(source);
    expect(titlesOf(project)).toEqual(['Postgres in every new service']);
  });

  it('refuses when nothing is inherited yet', () => {
    expect(runInheritUpdate(place('project'), {})).toMatchObject({
      ok: false,
      reason: 'NOT_INHERITING',
    });
  });

  it('says an unreachable origin and writes nothing', () => {
    const project = place('project');
    expect(runInheritSet(project, { where: join(sandbox, 'nowhere'), write: true })).toMatchObject({
      ok: false,
      reason: 'UNREACHABLE',
    });
    expect(existsSync(join(project.cwd, '.mnema', 'inherit.json'))).toBe(false);
  });
});
