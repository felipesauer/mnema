import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAccountability } from './accountability.js';
import { runInit } from './init.js';
import { runTask } from './task.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-accountability-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

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

describe('mnema accountability (who authorized what)', () => {
  it('with no filter accounts for the whole union — every author, every fact', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    // Two tasks across two trees — all authored by the same machine anchor here.
    const a = runTask({ cwd: repo, env }, { title: 'a', scope: 'public' });
    const b = runTask({ cwd: repo, env }, { title: 'b', scope: 'global' });
    if (!a.ok || !b.ok) throw new Error('setup');

    const result = runAccountability({ cwd: repo, env }, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // At least the two task births are counted, plus init's own events; the total
    // is the sum of every author's total.
    expect(result.account.total).toBeGreaterThanOrEqual(2);
    const summed = result.account.byWho.reduce((n, w) => n + w.total, 0);
    expect(summed).toBe(result.account.total);
    // Every task birth is attributed under some `who` with a task.created count.
    const created = result.account.byWho
      .flatMap((w) => w.byKind)
      .filter((k) => k.kind === 'task.created');
    expect(created.reduce((n, k) => n + k.count, 0)).toBe(2);
  });

  it('a --from window in the future narrows the account to zero (never an error)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'a', scope: 'public' });
    const result = runAccountability({ cwd: repo, env }, { from: '2999-01-01T00:00:00.000Z' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.account.total).toBe(0);
      expect(result.account.byWho).toEqual([]);
      // The applied filter is echoed back for the reader.
      expect(result.account.from).toBe('2999-01-01T00:00:00.000Z');
    }
  });

  it('a --who filter counts only that author (and zero for a stranger)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'a', scope: 'public' });
    // The real author is the machine anchor — take it from the unfiltered account.
    const all = runAccountability({ cwd: repo, env }, {});
    if (!all.ok || all.account.byWho.length === 0) throw new Error('setup');
    const realWho = all.account.byWho[0]?.who as string;

    const mine = runAccountability({ cwd: repo, env }, { who: realWho });
    expect(mine.ok && mine.account.byWho.length).toBe(1);

    const stranger = runAccountability({ cwd: repo, env }, { who: 'nobody-anchor' });
    expect(stranger.ok).toBe(true);
    if (stranger.ok) {
      expect(stranger.account.total).toBe(0);
      expect(stranger.account.byWho).toEqual([]);
    }
  });

  it('refuses NO_PROJECT outside a project', () => {
    const { repo, env } = setup(); // no init
    const result = runAccountability({ cwd: repo, env }, {});
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('writes NOTHING — the sandbox is byte-identical before and after', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'x', scope: 'public' });
    const before = digest(sandbox);
    runAccountability({ cwd: repo, env }, {});
    runAccountability({ cwd: repo, env }, { who: 'anyone', from: '2000-01-01T00:00:00.000Z' });
    expect(digest(sandbox)).toBe(before);
  });
});
