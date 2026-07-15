import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCounters, recordCounter } from '@/services/metrics-counter.js';

describe('metrics-counter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-metrics-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends and reads back entries in order', () => {
    recordCounter(dir, 'doctor_ran', '2026-01-01T00:00:00Z');
    recordCounter(dir, 'doctor_ran', '2026-01-02T00:00:00Z');
    const entries = readCounters(dir);
    expect(entries).toEqual([
      { kind: 'doctor_ran', at: '2026-01-01T00:00:00Z' },
      { kind: 'doctor_ran', at: '2026-01-02T00:00:00Z' },
    ]);
  });

  it('creates the state dir if it is missing', () => {
    const nested = path.join(dir, 'does', 'not', 'exist');
    recordCounter(nested, 'doctor_ran', '2026-01-01T00:00:00Z');
    expect(readCounters(nested)).toHaveLength(1);
  });

  it('returns no entries when the log does not exist', () => {
    expect(readCounters(path.join(dir, 'empty'))).toEqual([]);
  });

  it('skips malformed lines instead of throwing (log is not tamper-evident)', () => {
    recordCounter(dir, 'doctor_ran', '2026-01-01T00:00:00Z');
    // Append a junk line followed by a valid one.
    const file = path.join(dir, 'metrics.jsonl');
    appendFileSync(file, '{not json\n{"kind":"doctor_ran","at":"2026-01-03T00:00:00Z"}\n');
    const entries = readCounters(dir);
    // The valid lines survive; the junk line is skipped.
    expect(entries.map((e) => e.at)).toEqual(['2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z']);
  });

  it('parses the first entry even when the file starts with a UTF-8 BOM', () => {
    const file = path.join(dir, 'metrics.jsonl');
    appendFileSync(file, `﻿{"kind":"doctor_ran","at":"2026-01-01T00:00:00Z"}\n`);
    expect(readCounters(dir)).toEqual([{ kind: 'doctor_ran', at: '2026-01-01T00:00:00Z' }]);
  });

  it('never throws even when the target cannot be written (best-effort)', () => {
    // Point at a path whose parent is a file, so mkdir/append fail.
    const asFile = path.join(dir, 'metrics.jsonl');
    recordCounter(dir, 'doctor_ran', '2026-01-01T00:00:00Z'); // creates the file
    expect(() => recordCounter(asFile, 'doctor_ran', '2026-01-02T00:00:00Z')).not.toThrow();
  });

  describe('cap', () => {
    it('caps at 500 entries, dropping the oldest and keeping the newest', () => {
      for (let i = 0; i < 620; i += 1) {
        // Encode the ordinal in the timestamp so we can assert the window.
        recordCounter(dir, 'doctor_ran', `2026-01-01T00:00:${String(i).padStart(4, '0')}Z`);
      }
      const entries = readCounters(dir);
      expect(entries).toHaveLength(500);
      // Newest kept, oldest dropped, contiguous window = [total-500 .. total-1].
      expect(entries.at(-1)?.at).toBe('2026-01-01T00:00:0619Z');
      expect(entries[0]?.at).toBe('2026-01-01T00:00:0120Z');
    });

    it('leaves a below-cap log untouched', () => {
      for (let i = 0; i < 10; i += 1) {
        recordCounter(dir, 'doctor_ran', `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`);
      }
      expect(readCounters(dir)).toHaveLength(10);
    });
  });
});
