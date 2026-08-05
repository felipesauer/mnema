import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DiscoveryEnv, resolveTrees, type Scope } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runTask } from './task.js';
import { runVerify, type TreeReport, type TreeVerdict, type VerifyDone } from './verify.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-verify-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** What was said about one tree of the record, by the tree's name. */
function treeOf(out: VerifyDone, scope: Scope): TreeReport | undefined {
  return out.trees.find((tree) => tree.scope === scope);
}

/** The verdict over one tree — fails the test if that tree got none. */
function verdictOf(out: VerifyDone, scope: Scope): TreeVerdict {
  const tree = treeOf(out, scope);
  if (tree === undefined || tree.kind !== 'verdict') {
    throw new Error(`no verdict for the ${scope} tree: ${JSON.stringify(tree)}`);
  }
  return tree;
}

/** The first tail's segment file in a tree. */
function firstSegment(root: string): string {
  const tailsDir = join(root, 'tails');
  const tail = readdirSync(tailsDir)[0] as string;
  const dir = join(tailsDir, tail);
  const segment = readdirSync(dir).find((f) => /^\d+\.jsonl$/.test(f)) as string;
  return join(dir, segment);
}

/**
 * Edits a stored event so the hash chain — not a parse — is what catches it: rewrite
 * the `at` of the first entry, and the recorded link no longer matches the recomputed
 * hash.
 */
function tamper(root: string): void {
  const path = firstSegment(root);
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const first = JSON.parse(lines[0] as string) as { event: { at: string } };
  first.event.at = '1999-01-01T00:00:00.000Z';
  lines[0] = JSON.stringify(first);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

/** Empties a tail's checkpoints — the signatures gone, the events left. */
function deleteSignatures(root: string): void {
  writeFileSync(join(firstSegment(root), '..', 'checkpoints.jsonl'), '', 'utf8');
}

describe('mnema verify', () => {
  it('verifies a freshly inited project as ok and fully signed', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const out = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.record.ok).toBe(true);
      expect(verdictOf(out, 'public').result.fullySigned).toBe(true);
      // A founding is signed the moment it lands, so the level is the top one the
      // product can reach — and the requirement the caller declared is met.
      expect(out.record.level).toBe('fully-signed');
      expect(out.requirement).toBe('chained');
      expect(out.requirementMet).toBe(true);
    }
  });

  it('answers the SAME verdict under a stricter minimum, and only the verdict', () => {
    // What `--require` may and may not touch: the record is one thing, and what a
    // caller is willing to accept about it is another. The result must not move.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const lenient = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
    const strict = runVerify({ cwd: repo, env, requirement: 'witnessed', global: false });
    expect(lenient.ok && strict.ok).toBe(true);
    if (lenient.ok && strict.ok) {
      expect(verdictOf(strict, 'public').result.summary).toBe(
        verdictOf(lenient, 'public').result.summary,
      );
      expect(strict.record.level).toBe(lenient.record.level);
      // Only the answer to the caller's question differs: nothing witnesses this
      // record, so the strictest minimum is not met and the exit will say so.
      expect(lenient.requirementMet).toBe(true);
      expect(strict.requirementMet).toBe(false);
    }
  });

  it('stays ok and fully signed after a task is created', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'a task' });
    const out = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.record.ok).toBe(true);
      expect(verdictOf(out, 'public').result.fullySigned).toBe(true);
      expect(verdictOf(out, 'public').result.uncheckpointedEvents).toBe(0);
    }
  });

  it('preserves the honest verdict: the external witness (T3) is reported not-covered', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const out = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
    expect(out.ok).toBe(true);
    if (out.ok) {
      // The command must not upgrade the guarantee: T3 is honestly uncovered,
      // and the summary says so — no "tamper-proof" gloss.
      const covered = verdictOf(out, 'public');
      expect(covered.result.witness).toBe('not-covered');
      expect(covered.result.summary).toContain('external witness (T3): not covered');
      expect(covered.result.summary).not.toMatch(/tamper[- ]?proof/i);
    }
  });

  it('reports a tamper as a real failure (does not paper over it)', () => {
    const { repo, env } = setup();
    const init = runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'genuine' });
    tamper(init.root);

    const out = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.record.ok).toBe(false);
      expect(verdictOf(out, 'public').result.issues.length).toBeGreaterThan(0);
      // A break fails the DEFAULT minimum — which is what makes a bare `mnema
      // verify` a gate at all, and it is the one exit this change had to leave
      // exactly where it was.
      expect(out.record.level).toBe('broken');
      expect(out.record.scopes).toEqual(['public']);
      expect(out.requirementMet).toBe(false);
    }
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const out = runVerify({ cwd: orphan, env, requirement: 'chained', global: false });
    expect(out).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});

describe('which trees the verdict covers', () => {
  it('covers the private tree, and its signed facts are in the verdict', () => {
    // The defect, at the command: a fact written `--scope private` is signed, and
    // nothing ever verified it. Both trees hold a record here, and both get a verdict.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const created = runTask({ cwd: repo, env }, { title: 'a private task', scope: 'private' });
    expect(created.ok).toBe(true);

    const out = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.trees.map((tree) => tree.scope)).toEqual(['public', 'private']);
      const own = verdictOf(out, 'private');
      expect(own.root).toBe(resolveTrees(repo, env).projectPrivate);
      expect(own.result.ok).toBe(true);
      expect(own.result.fullySigned).toBe(true);
      // The tree that was written is not empty in the verdict: its events were
      // replayed and its signatures checked.
      expect(own.result.tails.length).toBe(1);
      expect(own.result.tails[0]?.entryCount).toBeGreaterThan(0);
      expect(out.record.level).toBe('fully-signed');
      expect(out.record.scopes).toEqual(['public', 'private']);
    }
  });

  it('takes the verdict of the WORST tree, and names it', () => {
    // The aggregate that matters: the committed tree is intact and the private one is
    // edited. A verdict that passed on the healthy half would be worse than none.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'a private task', scope: 'private' });
    tamper(resolveTrees(repo, env).projectPrivate as string);

    const out = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
    expect(out.ok).toBe(true);
    if (out.ok) {
      // The committed tree is untouched and says so — the report does not smear one
      // tree's break over the other.
      expect(verdictOf(out, 'public').result.ok).toBe(true);
      expect(verdictOf(out, 'private').result.ok).toBe(false);
      expect(out.record.ok).toBe(false);
      expect(out.record.level).toBe('broken');
      expect(out.record.scopes).toEqual(['private']);
      expect(out.requirementMet).toBe(false);
    }
  });

  it('notes a private tree that holds nothing, and leaves the verdict alone', () => {
    // EVERY fresh clone is this case: the private tree is gitignored, so it is not
    // there. A note, not a break — and not a tree at a lower level either, so the
    // record stays fully signed and even the signature requirement passes.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const out = runVerify({ cwd: repo, env, requirement: 'signed', global: false });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(treeOf(out, 'private')).toEqual({
        kind: 'no-record',
        scope: 'private',
        root: resolveTrees(repo, env).projectPrivate,
      });
      expect(out.record.ok).toBe(true);
      expect(out.record.level).toBe('fully-signed');
      expect(out.record.scopes).toEqual(['public']);
      expect(out.requirementMet).toBe(true);
    }
  });

  it('holds the requirement over the AGGREGATE, not over the good tree', () => {
    // The gate cannot pass on the healthy half. The committed tree is fully covered;
    // the private tree's signatures are deleted, so its events rest on the hash chain
    // alone. `--require=signed` has to see that.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'a private task', scope: 'private' });
    deleteSignatures(resolveTrees(repo, env).projectPrivate as string);

    const out = runVerify({ cwd: repo, env, requirement: 'signed', global: false });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(verdictOf(out, 'public').result.level).toBe('fully-signed');
      expect(verdictOf(out, 'private').result.level).toBe('hash-chain-only');
      // Nothing is BROKEN — there is no signed statement left to contradict — and
      // that is exactly why the aggregate has to carry the level.
      expect(out.record.ok).toBe(true);
      expect(out.record.level).toBe('hash-chain-only');
      expect(out.record.scopes).toEqual(['private']);
      expect(out.requirementMet).toBe(false);
    }
  });

  it('leaves the global tree out unless it is asked for — even when it is broken', () => {
    // The global tree is always there, so folding it in by default would let it lower
    // the verdict of every project on this machine. Broken here, and the project is
    // still fully signed until `--global` asks.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'a personal task', scope: 'global' });
    tamper(resolveTrees(repo, env).global);

    const quiet = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
    expect(quiet.ok).toBe(true);
    if (quiet.ok) {
      expect(quiet.trees.map((tree) => tree.scope)).toEqual(['public', 'private']);
      expect(quiet.record.ok).toBe(true);
      expect(quiet.record.level).toBe('fully-signed');
      expect(quiet.requirementMet).toBe(true);
    }

    const asked = runVerify({ cwd: repo, env, requirement: 'chained', global: true });
    expect(asked.ok).toBe(true);
    if (asked.ok) {
      expect(asked.trees.map((tree) => tree.scope)).toEqual(['public', 'private', 'global']);
      expect(verdictOf(asked, 'global').result.ok).toBe(false);
      expect(asked.record.ok).toBe(false);
      expect(asked.record.level).toBe('broken');
      expect(asked.record.scopes).toEqual(['global']);
      expect(asked.requirementMet).toBe(false);
    }
  });

  it('notes a global tree that holds nothing when it is asked for', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const out = runVerify({ cwd: repo, env, requirement: 'chained', global: true });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(treeOf(out, 'global')).toEqual({
        kind: 'no-record',
        scope: 'global',
        root: resolveTrees(repo, env).global,
      });
      expect(out.record.scopes).toEqual(['public']);
      expect(out.requirementMet).toBe(true);
    }
  });
});
