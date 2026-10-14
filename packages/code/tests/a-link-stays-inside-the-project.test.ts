/**
 * A LINK IN THE PUBLIC TREE DOES NOT POINT OUTSIDE THE PROJECT.
 *
 * `mnema link <rule> /etc/passwd --rel governs` was accepted, exit 0, and committed to a tree that
 * reaches every clone an address no clone can resolve ("covers nothing here"). Both doors that write
 * a link refuse it now, before a writer is opened; the private and global trees are a person's own
 * machine and keep taking any path.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectLinks, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runLink } from '../src/commands/link.js';
import { outsideTheProject, targetAsRecorded } from '../src/link-target.js';
import { openSession } from '../src/mcp/session.js';
import { runLinkKnowledge } from '../src/mcp/tools.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-outside-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function publicTargets(): string[] {
  const root = resolveTrees(repo, env).projectPublic as string;
  return projectLinks(orderedEvents({ root }, catalogUpcasters())).map((edge) => edge.target);
}

const OUTSIDE = ['/etc/passwd', '../../etc/passwd', '..', 'src/../../x', '/tmp/elsewhere/src'];

describe('the command line', () => {
  it.each(OUTSIDE)('refuses %s in the public tree and records nothing', (target) => {
    const linked = runLink({ cwd: repo, env }, { subject: 'rule-1', target, rel: 'governs' });
    expect(linked).toMatchObject({ ok: false, reason: 'REFUSED', code: 'OUTSIDE_PROJECT' });
    expect(publicTargets()).toEqual([]);
  });

  it.each(['governs', 'asks-for-a-person', 'refuses-a-write'])('refuses it under %s', (rel) => {
    const linked = runLink({ cwd: repo, env }, { subject: 'rule-1', target: '/etc/x', rel });
    expect(linked).toMatchObject({ ok: false, code: 'OUTSIDE_PROJECT' });
  });

  it('leaves a relation that carries no address alone: derived-from cites a file', () => {
    const linked = runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: '../outside/0001.md', rel: 'derived-from' },
    );
    expect(linked.ok).toBe(true);
  });

  it('keeps taking a path inside, however it is spelled, and an id', () => {
    for (const target of [
      'src',
      'src/new.ts',
      './src/',
      'src/../src',
      join(repo, 'src'),
      'an-id',
    ]) {
      const linked = runLink({ cwd: repo, env }, { subject: 'rule-1', target, rel: 'governs' });
      expect(linked.ok, target).toBe(true);
    }
  });

  it('leaves the private and global trees alone', () => {
    for (const scope of ['private', 'global'] as const) {
      const linked = runLink(
        { cwd: repo, env },
        { subject: 'rule-1', target: '/etc/passwd', rel: 'governs', scope },
      );
      expect(linked.ok, scope).toBe(true);
    }
    expect(publicTargets()).toEqual([]);
  });
});

describe('the tool', () => {
  it.each(OUTSIDE)('refuses %s the same way', (target) => {
    const session = openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
    const linked = runLinkKnowledge(session, { subject: 'rule-1', target, rel: 'governs' });
    expect(linked).toMatchObject({ ok: false, code: 'OUTSIDE_PROJECT' });
    expect(publicTargets()).toEqual([]);
  });
});

describe('the one function', () => {
  it('says so for a path that leaves the root and for nothing else', () => {
    expect(outsideTheProject('governs', '/etc/passwd', '/p')).toContain('"/etc/passwd"');
    expect(outsideTheProject('governs', '../x', '/p')).toBeDefined();
    expect(outsideTheProject('governs', '/p/src', '/p')).toBeUndefined();
    expect(outsideTheProject('governs', 'src/a', '/p')).toBeUndefined();
    expect(outsideTheProject('governs', 'an-id', '/p')).toBeUndefined();
    expect(outsideTheProject('derived-from', '/etc/passwd', '/p')).toBeUndefined();
  });
});

/**
 * AN ABSOLUTE PATH UNDER THE ROOT IS RECORDED RELATIVE TO IT.
 *
 * `<root>/src` committed as typed is "inside" on the machine that wrote it and "outside" in a clone
 * with another root: the defect the refusal above closes for paths that leave, still open for paths
 * that stay. The public tree takes the reduction the gates compare by; an already-relative target,
 * a `derived-from` target and the private and global trees are recorded as typed.
 */
describe('an absolute path under the root', () => {
  const SPELLINGS: ReadonlyArray<readonly [(root: string) => string, string]> = [
    [(root) => join(root, 'src'), 'src'],
    [(root) => `${root}/a/../src`, 'src'],
    [(root) => `${root}/src/new.ts`, 'src/new.ts'],
    [(root) => root, '.'],
  ];

  function tool() {
    return openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
  }

  it.each(SPELLINGS)('is recorded relative by the command line (%#)', (spell, recorded) => {
    const linked = runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: spell(repo), rel: 'governs' },
    );
    expect(linked.ok).toBe(true);
    expect(publicTargets()).toEqual([recorded]);
  });

  it.each(SPELLINGS)('is recorded relative by the tool (%#)', (spell, recorded) => {
    const linked = runLinkKnowledge(tool(), {
      subject: 'rule-1',
      target: spell(repo),
      rel: 'governs',
    });
    expect(linked.ok).toBe(true);
    expect(publicTargets()).toEqual([recorded]);
  });

  it('reports the same reach whether it was typed absolute or relative, on both doors', () => {
    const typed = runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: join(repo, 'src'), rel: 'governs' },
    );
    const plain = runLink({ cwd: repo, env }, { subject: 'rule-1', target: 'src', rel: 'governs' });
    expect(typed.ok && plain.ok).toBe(true);
    if (!(typed.ok && plain.ok)) return;
    expect(typed.target).toBe('src');
    expect(typed.reach).toBeDefined();
    expect(typed.reach).toEqual(plain.reach);
    const door = runLinkKnowledge(tool(), {
      subject: 'rule-2',
      target: join(repo, 'src'),
      rel: 'governs',
    });
    expect(door.ok && door.reach).toEqual(plain.reach);
  });

  it('leaves an already-relative target exactly as typed', () => {
    for (const target of ['src/', './src', 'an-id']) {
      runLink({ cwd: repo, env }, { subject: 'rule-1', target, rel: 'governs' });
    }
    expect(publicTargets()).toEqual(['src/', './src', 'an-id']);
  });

  it('is recorded as typed under derived-from, and in the private and global trees', () => {
    runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: join(repo, 'src'), rel: 'derived-from' },
    );
    expect(publicTargets()).toEqual([join(repo, 'src')]);
    const private_ = runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: join(repo, 'src'), rel: 'governs', scope: 'private' },
    );
    expect(private_.ok && private_.target).toBe(join(repo, 'src'));
  });

  it('is one function: absolute under the root reduces, nothing else moves', () => {
    expect(targetAsRecorded('governs', '/p/src', '/p')).toBe('src');
    expect(targetAsRecorded('refuses-a-write', '/p/a/../src', '/p')).toBe('src');
    expect(targetAsRecorded('governs', '/p', '/p')).toBe('.');
    expect(targetAsRecorded('governs', 'src/', '/p')).toBe('src/');
    expect(targetAsRecorded('derived-from', '/p/src', '/p')).toBe('/p/src');
  });
});
