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
import { runDecisionImport } from './decision-import.js';
import { runInit } from './init.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-import-bridges-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function put(root: string, name: string, text: string): void {
  const path = join(root, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function tree() {
  const root = resolveTrees(repo, env).projectPublic as string;
  const events = [...orderedEvents({ root }, catalogUpcasters())];
  return { decisions: projectDecisions(events), links: projectLinks(events) };
}

const VAULT_MEMORY = JSON.stringify({
  id: 'mem-1',
  kind: 'decision',
  state: 'active',
  trust: 'unreviewed',
  title: 'Use sqlite for the local cache',
  body: 'One file, no server.',
});

describe('decision import --format', () => {
  it('the ECC Memory Vault: proposed, cited to its file, planned before written', () => {
    put(repo, 'vault/a.json', VAULT_MEMORY);
    const plan = runDecisionImport({ cwd: repo, env }, { from: 'vault', format: 'ecc-vault' });
    expect(plan.ok && plan.proposals.map((p) => [p.title, p.path, p.status])).toEqual([
      ['Use sqlite for the local cache', 'vault/a.json', 'active'],
    ]);
    expect(tree().decisions.size).toBe(0);

    runDecisionImport({ cwd: repo, env }, { from: 'vault', format: 'ecc-vault', write: true });
    expect([...tree().decisions.values()].map((d) => d.state)).toEqual(['proposed']);
    expect(tree().links.map((l) => l.target)).toEqual(['vault/a.json']);
  });

  it('the superpowers ledger: each Ruling line is one proposal, cited by line', () => {
    put(
      repo,
      'docs/ledger.md',
      '# Ledger\nRuling: keep parsing strict\n\nRuling: drop the cache\n',
    );
    const done = runDecisionImport(
      { cwd: repo, env },
      { from: 'docs/ledger.md', format: 'rulings', write: true },
    );
    expect(done.ok && done.proposals.map((p) => p.path)).toEqual([
      'docs/ledger.md:2',
      'docs/ledger.md:4',
    ]);
    expect(tree().links.map((l) => l.target)).toEqual(['docs/ledger.md:2', 'docs/ledger.md:4']);
    // A second run finds both edges and proposes nothing.
    const again = runDecisionImport(
      { cwd: repo, env },
      { from: 'docs/ledger.md', format: 'rulings', write: true },
    );
    expect(again.ok && [again.proposals.length, again.already.length]).toEqual([0, 2]);
  });

  it('the host memory, from outside the project: cited by source and file', () => {
    const memory = join(sandbox, 'home', '.claude', 'projects', 'p', 'memory');
    put(memory, 'MEMORY.md', '- [x](feedback_x.md) — index\n');
    put(
      memory,
      'feedback_x.md',
      '---\nname: No publish\ndescription: d\nmetadata:\n  type: feedback\n---\n\nDo not suggest publishing.\n',
    );
    const done = runDecisionImport(
      { cwd: repo, env },
      { from: memory, format: 'claude-memory', write: true },
    );
    expect(done.ok && done.proposals.map((p) => [p.title, p.path])).toEqual([
      ['No publish', 'claude-memory:feedback_x.md'],
    ]);
    expect(tree().links.map((l) => l.target)).toEqual(['claude-memory:feedback_x.md']);
    expect([...tree().decisions.values()].map((d) => d.state)).toEqual(['proposed']);
  });

  it('a malformed file is named, and nothing is written from it', () => {
    put(repo, 'vault/a.json', '{ not json');
    const done = runDecisionImport(
      { cwd: repo, env },
      { from: 'vault', format: 'ecc-vault', write: true },
    );
    expect(done.ok && done.proposals).toEqual([]);
    expect(done.ok && done.refused).toEqual([{ path: 'vault/a.json', code: 'MALFORMED' }]);
    expect(tree().decisions.size).toBe(0);
    expect(tree().links).toEqual([]);
  });

  it('a directory of decision files outside the project is still refused', () => {
    expect(runDecisionImport({ cwd: repo, env }, { from: sandbox, write: true })).toEqual({
      ok: false,
      reason: 'OUTSIDE_PROJECT',
      from: sandbox,
    });
  });
});
