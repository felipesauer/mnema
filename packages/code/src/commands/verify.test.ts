import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runTask } from './task.js';
import { runVerify } from './verify.js';

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

describe('mnema verify', () => {
  it('verifies a freshly inited project as ok and fully signed', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const out = runVerify({ cwd: repo, env });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.ok).toBe(true);
      expect(out.result.fullySigned).toBe(true);
    }
  });

  it('stays ok and fully signed after a task is created', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'a task' });
    const out = runVerify({ cwd: repo, env });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.ok).toBe(true);
      expect(out.result.fullySigned).toBe(true);
      expect(out.result.uncheckpointedEvents).toBe(0);
    }
  });

  it('preserves the honest verdict: the external witness (T3) is reported not-covered', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const out = runVerify({ cwd: repo, env });
    expect(out.ok).toBe(true);
    if (out.ok) {
      // The command must not upgrade the guarantee: T3 is honestly uncovered,
      // and the summary says so — no "tamper-proof" gloss.
      expect(out.result.witness).toBe('not-covered');
      expect(out.result.summary).toContain('external witness (T3): not covered');
      expect(out.result.summary).not.toMatch(/tamper[- ]?proof/i);
    }
  });

  it('reports a tamper as a real failure (does not paper over it)', () => {
    const { repo, env } = setup();
    const init = runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'genuine' });
    // Tamper with a committed event, keeping the line valid JSON so the hash
    // chain — not a parse — is what catches it. Rewrite the `at` of the first
    // entry; the recorded link no longer matches the recomputed hash.
    const tailsDir = join(init.root, 'tails');
    const tail = readdirSync(tailsDir)[0] as string;
    const tailDir = join(tailsDir, tail);
    const segFile = readdirSync(tailDir).find((f) => /^\d+\.jsonl$/.test(f)) as string;
    const segPath = join(tailDir, segFile);
    const lines = readFileSync(segPath, 'utf8').split('\n').filter(Boolean);
    const first = JSON.parse(lines[0] as string) as { event: { at: string } };
    first.event.at = '1999-01-01T00:00:00.000Z';
    lines[0] = JSON.stringify(first);
    writeFileSync(segPath, `${lines.join('\n')}\n`, 'utf8');

    const out = runVerify({ cwd: repo, env });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.ok).toBe(false);
      expect(out.result.issues.length).toBeGreaterThan(0);
    }
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const out = runVerify({ cwd: orphan, env });
    expect(out).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
