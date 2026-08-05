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

  it('records what the decision turned down, all the way to the projection', () => {
    // The option has to REACH the event: a plumbed option fed by no caller is the
    // class this project has paid for four times over.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runDecision(
      { cwd: repo, env },
      {
        title: 'adopt the ledger',
        rationale: 'it is the audit surface',
        alternatives: 'a wiki page: nobody owns it and it goes stale',
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const root = resolveTrees(repo, env).projectPublic as string;
    expect(decisionsOf(root).get(result.id)?.alternatives).toBe(
      'a wiki page: nobody owns it and it goes stale',
    );
  });

  it('records no alternatives key when the caller passed none', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runDecision({ cwd: repo, env }, { title: 't', rationale: 'r' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = resolveTrees(repo, env).projectPublic as string;
    const d = decisionsOf(root).get(result.id);
    expect(d).toBeDefined();
    if (d === undefined) return;
    expect('alternatives' in d).toBe(false);
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

describe('mnema decision --which — the agent that executed', () => {
  /** Every `decision.recorded` in a tree, with the agent each one names. */
  function recordsIn(root: string): { subject: string | undefined; which?: string }[] {
    return orderedEvents({ root }, catalogUpcasters())
      .filter((e) => e.kind === 'decision.recorded')
      .map((e) => ({ subject: e.subject, ...(e.which !== undefined ? { which: e.which } : {}) }));
  }

  it('records the declared agent on the fact', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runDecision(
      { cwd: repo, env },
      { title: 'use PKCE', rationale: 'no client secret', which: 'ci-runner', scope: 'public' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      expect(recordsIn(root).find((e) => e.subject === result.id)?.which).toBe('ci-runner');
    }
  });

  it('does NOT move the tree: an agent’s decision is the project’s decision', () => {
    // The site's rule, and the defect it closes: an ADR recorded by an agent used to
    // land in the tree that never leaves the machine, so a colleague cloning the
    // repository inherited a founding and nothing else. A decision is born
    // `proposed`, which is what keeps a fresh one a proposal rather than a fact.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const trees = resolveTrees(repo, env);

    const byAgent = runDecision(
      { cwd: repo, env },
      { title: 'an agent decision', rationale: 'why', which: 'ci-runner' },
    );
    const byPerson = runDecision(
      { cwd: repo, env },
      { title: 'a person decision', rationale: 'w' },
    );
    expect(byAgent.ok && byPerson.ok).toBe(true);
    if (byAgent.ok && byPerson.ok) {
      const inPublic = decisionsOf(trees.projectPublic as string);
      expect(inPublic.has(byAgent.id)).toBe(true);
      expect(inPublic.has(byPerson.id)).toBe(true);
      expect(decisionsOf(trees.projectPrivate as string).size).toBe(0);
      expect(byAgent.scope).toBe('public');
      expect(byPerson.scope).toBe('public');
    }
  });

  it('an explicit scope still wins over the kind', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runDecision(
      { cwd: repo, env },
      { title: 'mine alone', rationale: 'why', scope: 'private' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(decisionsOf(resolveTrees(repo, env).projectPrivate as string).has(result.id)).toBe(
        true,
      );
      expect(result.scope).toBe('private');
    }
  });

  it('refuses WHO_IS_WHICH when the agent IS the authorizing identity, recording nothing', () => {
    const { repo, env } = setup();
    const { anchor } = runInit({ cwd: repo, env });

    const trees = resolveTrees(repo, env);
    const roots = [trees.projectPublic, trees.projectPrivate, trees.global].filter(
      (root): root is string => root !== undefined,
    );
    const before = roots.reduce((n, root) => n + recordsIn(root).length, 0);

    const result = runDecision(
      { cwd: repo, env },
      { title: 'self-authorized', rationale: 'why', which: anchor },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'REFUSED',
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    });
    expect(roots.reduce((n, root) => n + recordsIn(root).length, 0)).toBe(before);
  });
});
