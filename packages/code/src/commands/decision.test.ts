import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectDecisions, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from './decision.js';
import { runInit } from './init.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-decision-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Reads the decisions projected from a tree root. */
function decisionsOf(root: string) {
  return projectDecisions(orderedEvents({ root }, catalogUpcasters()));
}

describe('mnema decision', () => {
  it('records a decision, returning its id and the frozen ADR label (no alias)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runDecision(
      { cwd: repo, env },
      { title: 'adopt the ledger', rationale: 'it is the audit surface' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      // The human name is the ADR, not a `d-xxxx` alias — there is no alias.
      expect(result.adr).toBe('ADR-1');
      // The decision really landed in the public tree, as proposed.
      const root = resolveTrees(repo, env).projectPublic as string;
      const d = decisionsOf(root).get(result.id);
      expect(d?.state).toBe('proposed');
      expect(d?.adr).toBe('ADR-1');
    }
  });

  it('increments the ADR label per decision', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const first = runDecision({ cwd: repo, env }, { title: 'one', rationale: 'r1' });
    const second = runDecision({ cwd: repo, env }, { title: 'two', rationale: 'r2' });
    expect(first.ok && first.adr).toBe('ADR-1');
    expect(second.ok && second.adr).toBe('ADR-2');
  });

  it('leaves the tree fully signed after recording a decision', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runDecision({ cwd: repo, env }, { title: 'a decision', rationale: 'because' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runDecision(
      { cwd: orphan, env },
      { title: 'homeless', rationale: 'nowhere to live' },
    );
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('--scope private is honored: the decision is born in the private tree', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runDecision(
      { cwd: repo, env },
      { title: 'private call', rationale: 'this machine only', scope: 'private' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(repo, env);
      expect(decisionsOf(trees.projectPrivate as string).has(result.id)).toBe(true);
      // and NOT in public — the override truly routed the birth.
      expect(decisionsOf(trees.projectPublic as string).has(result.id)).toBe(false);
    }
  });

  it('an omitted scope defaults to public (the provisional default)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runDecision({ cwd: repo, env }, { title: 'no scope', rationale: 'default' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      expect(decisionsOf(root).has(result.id)).toBe(true);
    }
  });

  it('--scope global works with no project (global needs no project)', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runDecision(
      { cwd: orphan, env },
      { title: 'cross-project rule', rationale: 'applies everywhere', scope: 'global' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(orphan, env);
      expect(decisionsOf(trees.global).has(result.id)).toBe(true);
    }
  });

  it('--scope public with no project refuses NO_PROJECT (guard is on the resolved scope)', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runDecision(
      { cwd: orphan, env },
      { title: 'homeless public', rationale: 'no home', scope: 'public' },
    );
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
