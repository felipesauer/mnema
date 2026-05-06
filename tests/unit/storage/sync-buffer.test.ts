import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncBuffer, type SyncBufferEntry } from '@/storage/buffer/sync-buffer.js';

function makeEntry(taskKey: string): SyncBufferEntry {
  return {
    v: 1,
    at: new Date().toISOString(),
    kind: 'task_synced',
    taskKey,
    mdTarget: `backlog/DRAFT/${taskKey}.md`,
  };
}

describe('SyncBuffer', () => {
  let dir: string;
  let buffer: SyncBuffer;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-sync-buffer-'));
    buffer = new SyncBuffer(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the state directory when missing', () => {
    rmSync(dir, { recursive: true, force: true });
    const fresh = new SyncBuffer(dir);
    fresh.append(makeEntry('TST-1'));
    expect(existsSync(fresh.getPath())).toBe(true);
  });

  it('appends entries on separate JSONL lines', () => {
    buffer.append(makeEntry('TST-1'));
    buffer.append(makeEntry('TST-2'));

    const raw = readFileSync(buffer.getPath(), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l) as SyncBufferEntry);
    expect(parsed.map((e) => e.taskKey)).toEqual(['TST-1', 'TST-2']);
  });

  it('reads back every entry in order', () => {
    buffer.append(makeEntry('TST-1'));
    buffer.append(makeEntry('TST-2'));

    const entries = buffer.readAll();
    expect(entries.map((e) => e.taskKey)).toEqual(['TST-1', 'TST-2']);
  });

  it('returns empty array on missing or blank file', () => {
    expect(buffer.readAll()).toEqual([]);
    writeFileSync(buffer.getPath(), '\n\n', 'utf-8');
    expect(buffer.readAll()).toEqual([]);
  });

  it('skips malformed lines without crashing', () => {
    writeFileSync(
      buffer.getPath(),
      `${JSON.stringify(makeEntry('TST-1'))}\n{not json\n${JSON.stringify(makeEntry('TST-2'))}\n`,
      'utf-8',
    );

    const entries = buffer.readAll();
    expect(entries.map((e) => e.taskKey)).toEqual(['TST-1', 'TST-2']);
  });

  it('truncate() leaves an empty file behind', () => {
    buffer.append(makeEntry('TST-1'));
    buffer.truncate();
    expect(buffer.size()).toBe(0);
    expect(existsSync(buffer.getPath())).toBe(true);
    expect(readFileSync(buffer.getPath(), 'utf-8')).toBe('');
  });
});
