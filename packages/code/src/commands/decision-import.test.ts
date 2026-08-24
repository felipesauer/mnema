import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import {
  type DiscoveryEnv,
  orderedEvents,
  projectDecisions,
  projectLinks,
  resolveTrees,
} from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DERIVED_FROM_RELATION, runDecisionImport } from './decision-import.js';
import { runInit } from './init.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-decision-import-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A project with a directory of decision documents in it. */
function setup(documents: Readonly<Record<string, string>> = {}): {
  repo: string;
  env: DiscoveryEnv;
} {
  const repo = join(sandbox, 'repo');
  const adr = join(repo, 'docs', 'adr');
  mkdirSync(adr, { recursive: true });
  for (const [name, text] of Object.entries(documents)) {
    writeFileSync(join(adr, name), text, 'utf8');
  }
  const env = { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  return { repo, env };
}

/** A well-formed decision document. */
function decision(title: string, why = 'why this was decided'): string {
  return `# ${title}\n\n## Context\n\n${why}\n`;
}

/** Everything the public tree holds. */
function publicTree(repo: string, env: DiscoveryEnv) {
  const root = resolveTrees(repo, env).projectPublic as string;
  const events = [...orderedEvents({ root }, catalogUpcasters())];
  return { decisions: projectDecisions(events), links: projectLinks(events) };
}

const TWO = {
  '0001-utc.md': decision('Use UTC everywhere'),
  '0002-ledger.md': decision('Credits are a ledger'),
};

describe('mnema decision import', () => {
  it('WRITES NOTHING without being told to, and says so', () => {
    // A verb that read and wrote in one breath would let one accidental invocation
    // fill a record with proposals nobody asked for, which is worse than not having
    // the verb. This is the case that holds that guard.
    const { repo, env } = setup(TWO);

    const result = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wrote).toBe(false);
    expect(result.proposals.map((p) => p.title)).toEqual([
      'Use UTC everywhere',
      'Credits are a ledger',
    ]);
    // The plan knows nothing an unwritten decision could not know.
    expect(result.proposals.every((p) => p.id === undefined && p.adr === undefined)).toBe(true);
    // And the record is untouched: not one decision, not one link.
    const tree = publicTree(repo, env);
    expect(tree.decisions.size).toBe(0);
    expect(tree.links).toEqual([]);
  });

  it('records what it planned, and every one of them is PROPOSED', () => {
    // There is no path in this product that creates an accepted decision, and this
    // verb adds none — no flag, no threshold, no confidence. A file that calls
    // itself Accepted is proposed all the same.
    const { repo, env } = setup({
      '0001-utc.md': `# Use UTC everywhere\n\n- **Status:** Accepted\n\n## Context\n\nthe zone drifts\n`,
    });

    const result = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wrote).toBe(true);
    expect(result.proposals).toHaveLength(1);
    const proposal = result.proposals[0];
    expect(proposal?.adr).toBe('ADR-1');
    // The file's own status is REPORTED and never applied.
    expect(proposal?.status).toBe('Accepted');

    const { decisions } = publicTree(repo, env);
    expect([...decisions.values()].map((d) => d.state)).toEqual(['proposed']);
  });

  it('records where each decision came from, as a fact of the record', () => {
    // The provenance is an edge and not a sentence in the prose: `derived-from` is
    // already one of the catalog's recommended labels, so this cost the record no
    // new field, no version and no upcaster.
    const { repo, env } = setup(TWO);

    const result = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { links } = publicTree(repo, env);
    expect(links).toHaveLength(2);
    expect(links.map((l) => [l.subject, l.rel, l.target])).toEqual(
      result.proposals.map((p) => [p.id, DERIVED_FROM_RELATION, p.path]),
    );
    // The path is the project's own, so every clone can open it — never this
    // machine's absolute one.
    expect(links.map((l) => l.target)).toEqual(['docs/adr/0001-utc.md', 'docs/adr/0002-ledger.md']);
  });

  it('proposes each file ONCE, however many times it is run', () => {
    // The `derived-from` edge is what recognizes "the same": a file already on the
    // far end of one is a file already imported, whatever its title says now.
    const { repo, env } = setup(TWO);

    const first = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true });
    const second = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true });
    expect(first.ok && second.ok).toBe(true);
    if (!(first.ok && second.ok)) return;

    expect(first.proposals).toHaveLength(2);
    expect(second.proposals).toHaveLength(0);
    expect(second.already.map((a) => a.path)).toEqual([
      'docs/adr/0001-utc.md',
      'docs/adr/0002-ledger.md',
    ]);
    // Two runs, two decisions — counted at the record and not at the report.
    expect(publicTree(repo, env).decisions.size).toBe(2);
  });

  it('recognizes a file already imported into ANOTHER tree', () => {
    // A proposal that landed in the private tree is still a decision derived from
    // that file. Re-proposing it into the public one because the public tree cannot
    // see it would duplicate exactly what idempotence is here to prevent.
    const { repo, env } = setup(TWO);

    runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true, scope: 'private' });
    const second = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.proposals).toHaveLength(0);
    expect(second.already).toHaveLength(2);
    expect(publicTree(repo, env).decisions.size).toBe(0);
  });

  it('carries the refusals through, so a file that produced nothing is named', () => {
    const { repo, env } = setup({
      '0001-fine.md': decision('Fine'),
      '0002-headless.md': 'no heading here\n',
    });

    const result = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals.map((p) => p.title)).toEqual(['Fine']);
    expect(result.refused.map((r) => r.code)).toEqual(['NO_TITLE']);
  });

  it('names every file the way a reader of another clone can open it — BOTH paths', () => {
    // The scanner walks in absolute paths and the plan relativizes what it READ, so
    // the refusals were being reported as `/home/…/repo/docs/adr/x.md` beside
    // proposals reported as `docs/adr/x.md`. The absolute one is this machine's, and
    // every other path this verb prints is one a reader of a pasted transcript can
    // open in their own clone.
    //
    // TWO SITES, TWO ASSERTIONS. The plan and the write each build their own result,
    // and fixing one and not the other is exactly what happened the first time.
    const { repo, env } = setup({ '0001-headless.md': 'no heading\n' });

    for (const write of [false, true]) {
      const result = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.wrote).toBe(write);
      expect(result.refused.map((r) => r.path)).toEqual(['docs/adr/0001-headless.md']);
    }
  });

  it('refuses a directory outside the project', () => {
    // The provenance a proposal records has to be citable by every clone, and an
    // absolute path on one machine is citable by none of them.
    const { repo, env } = setup(TWO);
    const outside = join(sandbox, 'elsewhere');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, '0001-a.md'), decision('A'), 'utf8');

    expect(runDecisionImport({ cwd: repo, env }, { from: outside, write: true })).toEqual({
      ok: false,
      reason: 'OUTSIDE_PROJECT',
      from: outside,
    });
    expect(publicTree(repo, env).decisions.size).toBe(0);
  });

  it('refuses outside a project at all', () => {
    const bare = join(sandbox, 'bare');
    mkdirSync(bare, { recursive: true });
    expect(
      runDecisionImport(
        { cwd: bare, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } },
        { from: '.' },
      ),
    ).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('names the agent on every fact it writes', () => {
    // A declared `which` names the agent on the fact and does not move the tree —
    // the same rule every other write follows. Both events it appends carry it.
    const { repo, env } = setup({ '0001-utc.md': decision('Use UTC everywhere') });

    runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true, which: 'claude' });

    const root = resolveTrees(repo, env).projectPublic as string;
    const written = [...orderedEvents({ root }, catalogUpcasters())].filter(
      (e) => e.kind === 'decision.recorded' || e.kind === 'knowledge.linked',
    );
    expect(written).toHaveLength(2);
    expect(written.every((e) => e.which === 'claude')).toBe(true);
  });
});
