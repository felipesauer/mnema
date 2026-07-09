import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readErrors, recordError, resolveStateDir, sanitize } from '@/services/error-log.js';

describe('error-log', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-errlog-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records a crash and reads it back with all fields', () => {
    const err = new Error('boom');
    recordError(err, { stateDir: dir, argv: ['mnema', 'doctor'], now: '2026-01-01T00:00:00.000Z' });
    const entries = readErrors(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.at).toBe('2026-01-01T00:00:00.000Z');
    expect(entries[0]?.message).toBe('boom');
    expect(entries[0]?.stack).toContain('boom');
    expect(entries[0]?.argv).toEqual(['mnema', 'doctor']);
    expect(entries[0]?.node_version).toBe(process.version);
  });

  it('records a non-Error thrown value with a null stack', () => {
    recordError('a string was thrown', { stateDir: dir, now: '2026-01-01T00:00:00.000Z' });
    const entries = readErrors(dir);
    expect(entries[0]?.message).toBe('a string was thrown');
    expect(entries[0]?.stack).toBeNull();
  });

  it('creates the state dir if it is missing', () => {
    const nested = path.join(dir, 'does', 'not', 'exist');
    recordError(new Error('x'), { stateDir: nested, now: '2026-01-01T00:00:00.000Z' });
    expect(readErrors(nested)).toHaveLength(1);
  });

  it('is a no-op when no state dir can be resolved', () => {
    expect(() => recordError(new Error('x'), { stateDir: null })).not.toThrow();
  });

  it('returns no entries when the log does not exist', () => {
    expect(readErrors(path.join(dir, 'empty'))).toEqual([]);
  });

  it('skips malformed lines instead of throwing', () => {
    recordError(new Error('first'), { stateDir: dir, now: '2026-01-01T00:00:00.000Z' });
    appendFileSync(
      path.join(dir, 'errors.jsonl'),
      '{not json\n{"at":"2026-01-03T00:00:00.000Z","message":"third"}\n',
    );
    const entries = readErrors(dir);
    expect(entries.map((e) => e.message)).toEqual(['first', 'third']);
  });

  it('never throws even when the target cannot be written (best-effort)', () => {
    const asFile = path.join(dir, 'errors.jsonl');
    recordError(new Error('x'), { stateDir: dir }); // creates the file
    // Point at a path whose parent is now a file, so mkdir/append fail.
    expect(() =>
      recordError(new Error('y'), { stateDir: path.join(asFile, 'nested') }),
    ).not.toThrow();
  });

  describe('resolveStateDir', () => {
    it('finds .mnema/state by walking up from a nested cwd', () => {
      mkdirSync(path.join(dir, '.mnema'), { recursive: true });
      const nested = path.join(dir, 'a', 'b', 'c');
      mkdirSync(nested, { recursive: true });
      expect(resolveStateDir(nested)).toBe(path.join(dir, '.mnema', 'state'));
    });

    it('returns null when no .mnema exists up to the root', () => {
      const bare = mkdtempSync(path.join(tmpdir(), 'mnema-bare-'));
      try {
        expect(resolveStateDir(bare)).toBeNull();
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });
  });

  describe('sanitize', () => {
    it('collapses the home directory to ~', () => {
      const home = os.homedir();
      expect(sanitize(`opened ${home}/project/file.ts`)).toContain('~/project/file.ts');
      expect(sanitize(`opened ${home}/project/file.ts`)).not.toContain(home);
    });

    it('reduces a foreign absolute path to its basename', () => {
      const out = sanitize('at readFile (/var/secretplace/deep/config.ts:10:5)');
      expect(out).toContain('<path>/config.ts');
      expect(out).not.toContain('/var/secretplace');
    });

    it('redacts secret-shaped assignments', () => {
      expect(sanitize('env GITHUB_TOKEN=ghp_abcdef123 set')).toContain('GITHUB_TOKEN=<redacted>');
      expect(sanitize('env GITHUB_TOKEN=ghp_abcdef123 set')).not.toContain('ghp_abcdef123');
      expect(sanitize('MY_API_KEY=supersecretvalue')).toContain('MY_API_KEY=<redacted>');
    });

    it('redacts long opaque tokens', () => {
      const token = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6';
      expect(sanitize(`bearer ${token}`)).toContain('<redacted>');
      expect(sanitize(`bearer ${token}`)).not.toContain(token);
    });

    it('leaves ordinary text untouched', () => {
      expect(sanitize('task WEBAPP-42 failed the gate')).toBe('task WEBAPP-42 failed the gate');
    });
  });
});
