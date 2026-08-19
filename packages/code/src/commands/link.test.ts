import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectLinks, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runLink } from './link.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-link-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Reads the link edges projected from a tree root. */
function linksOf(root: string) {
  return projectLinks(orderedEvents({ root }, catalogUpcasters()));
}

describe('mnema link', () => {
  it('links one entity to another, echoing the fact (there is no id)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runLink({ cwd: repo, env }, { subject: 'A', target: 'B', rel: 'relates-to' });
    // The whole result, so a field added here has to be declared: the tree it landed
    // in travels back with the echo, because nothing in the call named one.
    expect(result).toEqual({
      ok: true,
      subject: 'A',
      target: 'B',
      rel: 'relates-to',
      scope: 'public',
    });
    const root = resolveTrees(repo, env).projectPublic as string;
    const edges = linksOf(root);
    expect(edges).toEqual([
      expect.objectContaining({ subject: 'A', target: 'B', rel: 'relates-to' }),
    ]);
  });

  it('accepts a `rel` OUTSIDE the recommended set (the relation is an open string)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    // Not one of the recommended labels the catalog documents — still valid.
    const result = runLink(
      { cwd: repo, env },
      { subject: 'A', target: 'B', rel: 'inspired-by-a-dream' },
    );
    expect(result.ok).toBe(true);
    const root = resolveTrees(repo, env).projectPublic as string;
    expect(linksOf(root)[0]?.rel).toBe('inspired-by-a-dream');
  });

  it('does NOT validate the references: a dangling target is accepted', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runLink(
      { cwd: repo, env },
      { subject: 'A', target: '00000000-0000-7000-8000-000000000000', rel: 'relates-to' },
    );
    expect(result.ok).toBe(true);
  });

  it('leaves the tree fully signed after recording a link', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runLink({ cwd: repo, env }, { subject: 'A', target: 'B', rel: 'relates-to' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runLink({ cwd: orphan, env }, { subject: 'A', target: 'B', rel: 'relates-to' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('--scope private is honored: the link is born in the private tree', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runLink(
      { cwd: repo, env },
      { subject: 'A', target: 'B', rel: 'relates-to', scope: 'private' },
    );
    expect(result.ok).toBe(true);
    const trees = resolveTrees(repo, env);
    expect(linksOf(trees.projectPrivate as string).length).toBe(1);
    expect(linksOf(trees.projectPublic as string).length).toBe(0);
  });
});

describe('mnema link --which — the agent that executed', () => {
  /** Every `knowledge.linked` in a tree, with the agent each one names. */
  function edgesIn(root: string): { subject: string | undefined; which?: string }[] {
    return orderedEvents({ root }, catalogUpcasters())
      .filter((e) => e.kind === 'knowledge.linked')
      .map((e) => ({ subject: e.subject, ...(e.which !== undefined ? { which: e.which } : {}) }));
  }

  it('records the declared agent on the fact', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runLink(
      { cwd: repo, env },
      { subject: 'A', target: 'B', rel: 'relates-to', which: 'ci-runner', scope: 'public' },
    );
    expect(result.ok).toBe(true);
    const root = resolveTrees(repo, env).projectPublic as string;
    expect(edgesIn(root).find((e) => e.subject === 'A')?.which).toBe('ci-runner');
  });

  it('does NOT move the tree: an edge between the project’s records lands public', () => {
    // The site's rule: a link asserts a relation between records of the project, so it
    // travels with them. The endpoints are not checked and may be anywhere.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const trees = resolveTrees(repo, env);

    const byAgent = runLink(
      { cwd: repo, env },
      { subject: 'A', target: 'B', rel: 'relates-to', which: 'ci-runner' },
    );
    const byPerson = runLink({ cwd: repo, env }, { subject: 'C', target: 'D', rel: 'relates-to' });
    expect(byAgent.ok && byPerson.ok).toBe(true);
    expect(linksOf(trees.projectPublic as string).length).toBe(2);
    expect(linksOf(trees.projectPrivate as string).length).toBe(0);
    if (byAgent.ok) expect(byAgent.scope).toBe('public');
  });

  it('an explicit scope still wins over the kind', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runLink(
      { cwd: repo, env },
      { subject: 'A', target: 'B', rel: 'relates-to', scope: 'private' },
    );
    expect(result.ok).toBe(true);
    expect(linksOf(resolveTrees(repo, env).projectPrivate as string).length).toBe(1);
    if (result.ok) expect(result.scope).toBe('private');
  });

  it('refuses WHO_IS_WHICH when the agent IS the authorizing identity, linking nothing', () => {
    const { repo, env } = setup();
    const { anchor } = runInit({ cwd: repo, env });

    const trees = resolveTrees(repo, env);
    const roots = [trees.projectPublic, trees.projectPrivate, trees.global].filter(
      (root): root is string => root !== undefined,
    );
    const before = roots.reduce((n, root) => n + edgesIn(root).length, 0);

    const result = runLink(
      { cwd: repo, env },
      { subject: 'A', target: 'B', rel: 'relates-to', which: anchor },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'REFUSED',
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    });
    expect(roots.reduce((n, root) => n + edgesIn(root).length, 0)).toBe(before);
  });
});
