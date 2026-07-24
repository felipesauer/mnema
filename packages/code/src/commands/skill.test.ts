import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectSkills, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runSkill } from './skill.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-skill-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Reads the skills projected from a tree root. */
function skillsOf(root: string) {
  return projectSkills(orderedEvents({ root }, catalogUpcasters()));
}

describe('mnema skill', () => {
  it('proposes a skill, returning its id and its name (no alias)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runSkill(
      { cwd: repo, env },
      { name: 'stacked-prs', body: 'One slice per PR; merge before the next.' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The canonical id is a minted v7 uuid — never a `s-xxxx`-style alias.
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      // The name is echoed back as DISPLAY, not derived into an alias.
      expect(result.name).toBe('stacked-prs');
      // The skill really landed in the public tree, proposed.
      const root = resolveTrees(repo, env).projectPublic as string;
      const s = skillsOf(root).get(result.id);
      expect(s?.state).toBe('proposed');
      expect(s?.name).toBe('stacked-prs');
      expect(s?.body).toBe('One slice per PR; merge before the next.');
    }
  });

  it('the name is not a key: two skills may share a name, each its own id', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const first = runSkill({ cwd: repo, env }, { name: 'same', body: 'b1' });
    const second = runSkill({ cwd: repo, env }, { name: 'same', body: 'b2' });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.id).not.toBe(second.id);
      const root = resolveTrees(repo, env).projectPublic as string;
      const skills = skillsOf(root);
      // Both exist, keyed by id — the name is display, never an index.
      expect(skills.has(first.id)).toBe(true);
      expect(skills.has(second.id)).toBe(true);
    }
  });

  it('leaves the tree fully signed after proposing a skill', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runSkill({ cwd: repo, env }, { name: 'a skill', body: 'a pattern' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runSkill({ cwd: orphan, env }, { name: 'homeless', body: 'nowhere to live' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('--scope private is honored: the skill is born in the private tree', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runSkill(
      { cwd: repo, env },
      { name: 'private-habit', body: 'this machine only', scope: 'private' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(repo, env);
      expect(skillsOf(trees.projectPrivate as string).has(result.id)).toBe(true);
      // and NOT in public — the override truly routed the birth.
      expect(skillsOf(trees.projectPublic as string).has(result.id)).toBe(false);
    }
  });

  it('an omitted scope defaults to public (the provisional default)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runSkill({ cwd: repo, env }, { name: 'no-scope', body: 'default' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      expect(skillsOf(root).has(result.id)).toBe(true);
    }
  });

  it('--scope global works with no project (global needs no project)', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runSkill(
      { cwd: orphan, env },
      { name: 'cross-project-habit', body: 'applies everywhere', scope: 'global' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(orphan, env);
      expect(skillsOf(trees.global).has(result.id)).toBe(true);
    }
  });

  it('--scope public with no project refuses NO_PROJECT (guard is on the resolved scope)', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runSkill(
      { cwd: orphan, env },
      { name: 'homeless public', body: 'no home', scope: 'public' },
    );
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
