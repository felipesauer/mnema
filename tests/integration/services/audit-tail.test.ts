import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditTail } from '@/services/integrity/audit-tail.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function appendEvent(file: string, event: AuditEvent): void {
  appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf-8');
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 1_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value !== undefined) return value;
    await sleep(10);
  }
  throw new Error('waitFor timed out');
}

describe('AuditTail', () => {
  let dir: string;
  let currentFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-audit-tail-'));
    currentFile = path.join(dir, 'current.jsonl');
    writeFileSync(currentFile, '', 'utf-8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('emits events appended after start()', async () => {
    const seen: AuditEvent[] = [];
    const tail = new AuditTail(dir, (event) => {
      seen.push(event);
    });
    await tail.start();

    try {
      appendEvent(currentFile, {
        v: 1,
        at: '2026-05-01T10:00:00.000Z',
        kind: 'task_created',
        actor: 'daniel',
        data: { key: 'X-1' },
      });

      const captured = await waitFor(() => (seen.length > 0 ? seen[0] : undefined));
      expect(captured.kind).toBe('task_created');
    } finally {
      tail.stop();
    }
  });

  it('replaySince emits events at or after the given timestamp', async () => {
    appendEvent(currentFile, {
      v: 1,
      at: '2026-04-30T23:00:00.000Z',
      kind: 'task_created',
      actor: 'daniel',
      data: { key: 'OLD-1' },
    });
    appendEvent(currentFile, {
      v: 1,
      at: '2026-05-01T10:00:00.000Z',
      kind: 'task_created',
      actor: 'daniel',
      data: { key: 'NEW-1' },
    });

    const seen: AuditEvent[] = [];
    const tail = new AuditTail(dir, (event) => {
      seen.push(event);
    });

    await tail.replaySince(new Date('2026-05-01T00:00:00.000Z'));
    expect(seen.map((e) => (e.data as { key: string }).key)).toEqual(['NEW-1']);
  });

  it('applies filters before invoking the handler', async () => {
    const seen: AuditEvent[] = [];
    const tail = new AuditTail(
      dir,
      (event) => {
        seen.push(event);
      },
      { kind: 'task_transitioned' },
    );
    await tail.start();

    try {
      appendEvent(currentFile, {
        v: 1,
        at: '2026-05-01T10:00:00.000Z',
        kind: 'task_created',
        actor: 'daniel',
        data: {},
      });
      appendEvent(currentFile, {
        v: 1,
        at: '2026-05-01T10:00:01.000Z',
        kind: 'task_transitioned',
        actor: 'daniel',
        data: { key: 'X-1' },
      });

      const captured = await waitFor(() => (seen.length > 0 ? seen[0] : undefined));
      expect(captured.kind).toBe('task_transitioned');
      // Other events are filtered out.
      await sleep(40);
      expect(seen).toHaveLength(1);
    } finally {
      tail.stop();
    }
  });
});
