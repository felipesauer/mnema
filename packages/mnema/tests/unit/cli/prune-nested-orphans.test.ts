import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pruneNestedOrphanMirrors } from '@/cli/commands/doctor-command.js';

describe('pruneNestedOrphanMirrors', () => {
  let backlog: string;

  beforeEach(() => {
    backlog = mkdtempSync(path.join(tmpdir(), 'mnema-prune-nested-'));
  });
  afterEach(() => {
    rmSync(backlog, { recursive: true, force: true });
  });

  const write = (state: string, key: string): void => {
    const dir = path.join(backlog, state);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${key}.md`), `# ${key}`, 'utf-8');
  };
  const exists = (state: string, key: string): boolean =>
    existsSync(path.join(backlog, state, `${key}.md`));

  it('prunes a genuine single orphan (one copy, no row)', () => {
    write('DRAFT', 'T-9');
    const removed = pruneNestedOrphanMirrors(backlog, new Set(), fs);
    expect(removed).toEqual(['T-9']);
    expect(exists('DRAFT', 'T-9')).toBe(false);
  });

  it('does NOT prune a row-less key mirrored in more than one state dir (would lose the task)', () => {
    // The fresh-clone data-loss shape: committed duplicate, no row yet.
    write('DONE', 'T-1');
    write('READY', 'T-1');
    const conflicts: string[] = [];
    const removed = pruneNestedOrphanMirrors(backlog, new Set(), fs, conflicts);

    // Both copies survive; nothing removed; the key is reported as a conflict.
    expect(removed).toEqual([]);
    expect(exists('DONE', 'T-1')).toBe(true);
    expect(exists('READY', 'T-1')).toBe(true);
    expect(conflicts).toEqual(['T-1']);
  });

  it('the acceptance case: prunes the single orphan AND spares the row-less duplicate', () => {
    write('DONE', 'T-1');
    write('READY', 'T-1'); // duplicate, no row → spared
    write('DRAFT', 'T-9'); // single orphan, no row → pruned
    const conflicts: string[] = [];
    const removed = pruneNestedOrphanMirrors(backlog, new Set(), fs, conflicts);

    expect(removed).toEqual(['T-9']);
    expect(conflicts).toEqual(['T-1']);
    expect(exists('DONE', 'T-1')).toBe(true);
    expect(exists('READY', 'T-1')).toBe(true);
    expect(exists('DRAFT', 'T-9')).toBe(false);
  });

  it('still prunes a key that HAS a duplicate-looking name but a live row (normal orphan sweep untouched for known keys)', () => {
    // A key WITH a row is never an orphan, whether duplicated or not.
    write('DONE', 'T-2');
    write('READY', 'T-2');
    const removed = pruneNestedOrphanMirrors(backlog, new Set(['T-2']), fs);
    // Known key → not an orphan → both copies left (duplicate handling for a
    // ROW-backed key is the quarantine sweep's job, not the orphan prune's).
    expect(removed).toEqual([]);
    expect(exists('DONE', 'T-2')).toBe(true);
    expect(exists('READY', 'T-2')).toBe(true);
  });

  it('works without a conflicts collector (backward-compatible signature)', () => {
    write('DONE', 'T-1');
    write('READY', 'T-1');
    write('DRAFT', 'T-9');
    // No 4th arg: duplicates are still spared, the single orphan still pruned.
    const removed = pruneNestedOrphanMirrors(backlog, new Set(), fs);
    expect(removed).toEqual(['T-9']);
    expect(exists('DONE', 'T-1')).toBe(true);
    expect(exists('READY', 'T-1')).toBe(true);
  });

  it('ignores the .quarantine dir (never counts or prunes its contents)', () => {
    write('.quarantine/READY', 'T-1');
    write('DRAFT', 'T-9');
    const conflicts: string[] = [];
    const removed = pruneNestedOrphanMirrors(backlog, new Set(), fs, conflicts);
    // The quarantined copy is invisible: T-1 is not counted (so not a conflict)
    // and not pruned; only the real orphan T-9 is removed.
    expect(removed).toEqual(['T-9']);
    expect(conflicts).toEqual([]);
    expect(existsSync(path.join(backlog, '.quarantine', 'READY', 'T-1.md'))).toBe(true);
  });
});
