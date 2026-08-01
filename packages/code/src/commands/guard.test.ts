import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGuard } from './guard.js';
import { runInit } from './init.js';
import { runTask } from './task.js';
import { runTaskTransition } from './task-transition.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-guard-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/**
 * A project with one task, and the machine's own identity — which every guard here
 * asks AS. The actor is not a label: a real move's `who` is derived from a key, so a
 * dry-run for a value naming no identity would answer for a move nobody can make,
 * and the surface refuses it.
 */
function projectWithTask(): { repo: string; env: DiscoveryEnv; id: string; who: string } {
  const { repo, env } = setup();
  const started = runInit({ cwd: repo, env });
  const created = runTask({ cwd: repo, env }, { title: 'a task' });
  if (!created.ok) throw new Error('setup: task create refused');
  return { repo, env, id: created.id, who: started.anchor };
}

/**
 * A content digest of every file under `dir`, so a read that must write nothing
 * can be proven byte-identical: the whole sandbox (chain, cache, keys) is hashed
 * before and after the guard, and the two digests must be equal.
 */
function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

describe('mnema guard (dry-run of the gate)', () => {
  it('ALLOWS a legal move whose required proof is present (→ the state it reaches)', () => {
    const { repo, env, id, who } = projectWithTask();
    // approve is not legal from DRAFT; a legal proof-bearing move from DRAFT is
    // cancel (needs a reason). With the reason present it is allowed.
    const result = runGuard(
      { cwd: repo, env },
      { id, action: 'cancel', actor: who, proof: { reason: 'no longer needed' } },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verdict.ok).toBe(true);
      if (result.verdict.ok) {
        expect(result.verdict.to).toBe('CANCELED');
        expect(result.verdict.action).toBe('cancel');
      }
    }
  });

  it('REFUSES MISSING_PROOF for a legal move whose required proof is absent', () => {
    const { repo, env, id, who } = projectWithTask();
    // cancel is legal from DRAFT but needs a reason; without it the gate refuses
    // MISSING_PROOF — a USEFUL answer ("the move is legal, you are only missing
    // the reason"), not "you cannot do this".
    const result = runGuard({ cwd: repo, env }, { id, action: 'cancel', actor: who });
    expect(result.ok).toBe(true);
    if (result.ok && !result.verdict.ok) {
      expect(result.verdict.code).toBe('MISSING_PROOF');
    }
  });

  it('REFUSES ILLEGAL_TRANSITION for a move the task’s current state does not allow', () => {
    const { repo, env, id, who } = projectWithTask();
    // approve is not a legal move from DRAFT (a task must be submitted, started,
    // and put in review first) — the gate refuses ILLEGAL_TRANSITION.
    const result = runGuard(
      { cwd: repo, env },
      { id, action: 'approve', actor: who, proof: { note: 'looks good' } },
    );
    expect(result.ok).toBe(true);
    if (result.ok && !result.verdict.ok) {
      expect(result.verdict.code).toBe('ILLEGAL_TRANSITION');
    }
  });

  it('REFUSES WHO_IS_WHICH when the simulated agent equals the actor', () => {
    const { repo, env, id, who } = projectWithTask();
    // A guard where --which equals --actor reproduces the identity invariant the
    // gate exists to hold: a human authorizes, an agent executes, never the same.
    const result = runGuard({ cwd: repo, env }, { id, action: 'submit', actor: who, which: who });
    expect(result.ok).toBe(true);
    if (result.ok && !result.verdict.ok) {
      expect(result.verdict.code).toBe('WHO_IS_WHICH');
    }
  });

  it('ALLOWS when who != which (an agent asking on a human’s behalf)', () => {
    const { repo, env, id, who } = projectWithTask();
    // submit needs no proof and is legal from DRAFT; a distinct which is fine.
    const result = runGuard(
      { cwd: repo, env },
      { id, action: 'submit', actor: who, which: 'agent' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.verdict.ok).toBe(true);
  });

  it('refuses UNKNOWN_TASK for an id no visible tree holds', () => {
    const { repo, env, who } = projectWithTask();
    const result = runGuard(
      { cwd: repo, env },
      { id: 'no-such-task-id', action: 'submit', actor: who },
    );
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_TASK' });
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { repo, env } = setup(); // no init
    const result = runGuard(
      { cwd: repo, env },
      { id: 'anything', action: 'submit', actor: `mnid:${'0'.repeat(64)}` },
    );
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('refuses an actor that names no identity this record knows', () => {
    const { repo, env, id, who } = projectWithTask();
    const result = runGuard({ cwd: repo, env }, { id, action: 'submit', actor: 'human' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_ANCHOR' });
    // And the identity it DOES know is named in the sentence, short enough to type.
    expect((result as { message: string }).message).toContain(who.slice(0, 13));
  });

  it('takes the actor by any prefix that names one identity here', () => {
    const { repo, env, id, who } = projectWithTask();
    const byPrefix = runGuard(
      { cwd: repo, env },
      { id, action: 'submit', actor: who.slice(0, 13) },
    );
    const whole = runGuard({ cwd: repo, env }, { id, action: 'submit', actor: who });
    expect(byPrefix).toEqual(whole);
    expect(byPrefix.ok && byPrefix.verdict.ok).toBe(true);
  });

  it('agrees with the real move: a verdict of ALLOWED is a move that then succeeds', () => {
    const { repo, env, id, who } = projectWithTask();
    // Guard says submit is allowed…
    const dryRun = runGuard({ cwd: repo, env }, { id, action: 'submit', actor: who });
    expect(dryRun.ok && dryRun.verdict.ok).toBe(true);
    // …and the real move then succeeds to the SAME state the guard predicted.
    const moved = runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    expect(moved.ok).toBe(true);
    if (dryRun.ok && dryRun.verdict.ok && moved.ok) {
      expect(moved.to).toBe(dryRun.verdict.to);
    }
  });

  it('writes NOTHING — the sandbox is byte-identical before and after', () => {
    const { repo, env, id, who } = projectWithTask();
    const before = digest(sandbox);
    // Run every kind of guard — allowed, each refusal — none may write.
    runGuard({ cwd: repo, env }, { id, action: 'submit', actor: who });
    runGuard({ cwd: repo, env }, { id, action: 'cancel', actor: who });
    runGuard({ cwd: repo, env }, { id, action: 'approve', actor: who, proof: { note: 'x' } });
    runGuard({ cwd: repo, env }, { id, action: 'submit', actor: who, which: who });
    runGuard({ cwd: repo, env }, { id, action: 'submit', actor: 'nobody' });
    runGuard({ cwd: repo, env }, { id: 'ghost', action: 'submit', actor: who });
    expect(digest(sandbox)).toBe(before);
  });
});
