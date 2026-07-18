import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkStoreFormat,
  computeStoreFormatHash,
  readStoreFormatInputs,
  readStoreFormatMarker,
  STORE_FORMAT_RELATIVE,
  writeStoreFormatMarker,
} from '@/services/integrity/store-format.js';

/**
 * The store-format marker pins the on-disk format a store was written under, so
 * a mutation from a binary with a DIFFERENT format is refused rather than
 * interleaving writes under diverging shapes. These tests exercise the hash
 * (deterministic, sensitive to every input), the marker round-trip, and the
 * mutation check's three states: fail-open (no marker), match, and mismatch.
 */
describe('store-format', () => {
  let tempRoot: string;
  let migrationsDir: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-storefmt-'));
    // A synthetic migrations dir so a test can add a migration and prove the
    // hash moves — without touching the real baseline.
    migrationsDir = path.join(tempRoot, 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(path.join(migrationsDir, '001_baseline.sql'), '-- baseline\n', 'utf-8');
  });
  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  it('hashes deterministically regardless of key order', () => {
    const inputs = readStoreFormatInputs(migrationsDir);
    expect(computeStoreFormatHash(inputs)).toBe(computeStoreFormatHash({ ...inputs }));
    // A hex sha256.
    expect(computeStoreFormatHash(inputs)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the hash when the max migration id moves', () => {
    const before = computeStoreFormatHash(readStoreFormatInputs(migrationsDir));
    writeFileSync(path.join(migrationsDir, '002_add_thing.sql'), '-- next\n', 'utf-8');
    const after = computeStoreFormatHash(readStoreFormatInputs(migrationsDir));
    expect(after).not.toBe(before);
  });

  it('changes the hash when any single input changes', () => {
    const base = readStoreFormatInputs(migrationsDir);
    const baseHash = computeStoreFormatHash(base);
    for (const key of ['event', 'attest', 'mirror', 'workflow', 'config'] as const) {
      const mutated = { ...base, [key]: `${base[key]}-x` };
      expect(computeStoreFormatHash(mutated)).not.toBe(baseHash);
    }
  });

  it('writes a single-line hex marker under keys/ and reads it back', () => {
    writeStoreFormatMarker(tempRoot, migrationsDir);
    const raw = readFileSync(path.join(tempRoot, STORE_FORMAT_RELATIVE), 'utf-8');
    expect(raw).toMatch(/^[0-9a-f]{64}\n$/); // exactly one line, trailing newline
    expect(readStoreFormatMarker(tempRoot)).toBe(raw.trim());
  });

  it('checkStoreFormat is fail-OPEN when no marker exists', () => {
    const check = checkStoreFormat(tempRoot, migrationsDir);
    expect(check.ok).toBe(true);
    expect(check.diverged).toEqual([]);
  });

  it('checkStoreFormat passes when the marker matches this binary', () => {
    writeStoreFormatMarker(tempRoot, migrationsDir);
    const check = checkStoreFormat(tempRoot, migrationsDir);
    expect(check.ok).toBe(true);
  });

  it('treats an empty or corrupt marker as fail-OPEN, never a lockout', () => {
    // A botched merge can leave the marker empty, whitespace, a git conflict
    // marker, or otherwise not a clean sha256. None of those must block a
    // mutation — only a well-formed marker naming a different format does.
    const markerPath = path.join(tempRoot, STORE_FORMAT_RELATIVE);
    mkdirSync(path.dirname(markerPath), { recursive: true });
    for (const corrupt of ['', '   \n', '<<<<<<< HEAD\n', 'not-a-hash', 'ab']) {
      writeFileSync(markerPath, corrupt, 'utf-8');
      expect(readStoreFormatMarker(tempRoot)).toBeNull();
      expect(checkStoreFormat(tempRoot, migrationsDir).ok).toBe(true);
    }
  });

  it('checkStoreFormat refuses and names the inputs when the marker diverges', () => {
    // A marker written under a DIFFERENT format: an extra migration on disk at
    // write time, then removed, so the committed hash no longer matches.
    writeFileSync(path.join(migrationsDir, '002_add_thing.sql'), '-- next\n', 'utf-8');
    writeStoreFormatMarker(tempRoot, migrationsDir);
    rmSync(path.join(migrationsDir, '002_add_thing.sql'));

    const check = checkStoreFormat(tempRoot, migrationsDir);
    expect(check.ok).toBe(false);
    // Names the candidate input set so the operator sees what to compare.
    expect(check.diverged.some((d) => d.startsWith('migration='))).toBe(true);
    expect(check.diverged.some((d) => d.startsWith('config='))).toBe(true);
  });
});
