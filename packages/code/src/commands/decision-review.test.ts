import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from './decision.js';
import { proposalsToReview } from './decision-review.js';
import { runDecisionTransition } from './decision-transition.js';
import { runInit } from './init.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-dreview-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  env = { home: join(sandbox, 'home') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function record(title: string, alternatives?: string): string {
  const done = runDecision(
    { cwd: repo, env },
    { title, rationale: `why ${title}`, ...(alternatives !== undefined ? { alternatives } : {}) },
  );
  if (!done.ok) throw new Error('setup: decision record refused');
  return done.id;
}

describe('the decisions a review goes through', () => {
  it('refuses outside a project', () => {
    expect(proposalsToReview({ cwd: repo, env })).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('lists the proposed ones, newest move first, with their reason and what they turned down', () => {
    runInit({ cwd: repo, env });
    const first = record('first', 'the other way');
    const second = record('second');
    const read = proposalsToReview({ cwd: repo, env });
    if (!read.ok) throw new Error('setup: nothing read');
    expect(read.proposals.map((one) => one.id)).toEqual([second, first]);
    expect(read.proposals[1]).toMatchObject({
      adr: 'ADR-1',
      title: 'first',
      rationale: 'why first',
      alternatives: 'the other way',
    });
    expect(read.proposals[0]?.alternatives).toBeUndefined();
    expect(read.linkBreaks).toEqual([]);
  });

  it('leaves out a decision once it has been ruled', () => {
    runInit({ cwd: repo, env });
    const first = record('first');
    const second = record('second');
    runDecisionTransition(
      { cwd: repo, env },
      { id: first, action: 'accept', proof: { note: 'agreed' } },
    );
    const read = proposalsToReview({ cwd: repo, env });
    if (!read.ok) throw new Error('setup: nothing read');
    expect(read.proposals.map((one) => one.id)).toEqual([second]);
  });
});
