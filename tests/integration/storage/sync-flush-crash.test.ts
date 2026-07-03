import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Task } from '@/domain/entities/task.js';
import { SyncService } from '@/services/sync-service.js';
import { SyncBuffer, type SyncBufferEntry } from '@/storage/buffer/sync-buffer.js';
import type { MarkdownIo, ParsedMarkdown } from '@/storage/markdown/markdown-io.js';
import type { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';

/**
 * Guards the flush ordering (A3): flushAll drains the buffer atomically,
 * then writes the markdown. If a write throws mid-loop, the un-written
 * entries must return to the buffer so a later flush replays them —
 * nothing is silently lost.
 */
describe('SyncService.flushAll crash safety', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-flush-crash-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A task repository that returns a fully-shaped DRAFT task for any key. */
  const taskRepo = {
    findByKey: (key: string): Task =>
      ({
        key,
        state: 'DRAFT',
        title: `Task ${key}`,
        description: '',
        acceptanceCriteria: [],
        estimate: null,
        priority: 3,
        assigneeId: null,
        reporterId: null,
        reopenCount: 0,
        metadata: {},
        updatedAt: new Date().toISOString(),
      }) as unknown as Task,
  } as unknown as TaskRepository;

  /**
   * A MarkdownIo whose `write` throws on the Nth call (1-indexed). `read`
   * returns an empty parsed doc so flushOne proceeds to the write.
   */
  function failingMarkdownIo(failOnCall: number): { io: MarkdownIo; writes: () => number } {
    let writeCount = 0;
    const io = {
      read: (): ParsedMarkdown => ({ mnemaData: {}, otherFrontmatter: {}, content: '' }),
      write: (): void => {
        writeCount += 1;
        if (writeCount === failOnCall) throw new Error(`injected write failure #${failOnCall}`);
      },
    } as unknown as MarkdownIo;
    return { io, writes: () => writeCount };
  }

  function entry(taskKey: string): SyncBufferEntry {
    return {
      v: 1,
      at: new Date().toISOString(),
      kind: 'task_transitioned',
      taskKey,
      mdTarget: `.mnema/backlog/DRAFT/${taskKey}.md`,
    };
  }

  function service(io: MarkdownIo, buffer: SyncBuffer): SyncService {
    return new SyncService(
      taskRepo,
      io,
      { projectRoot: root, backlogDir: '.mnema/backlog' },
      buffer,
    );
  }

  it('re-appends the un-flushed remainder when a write fails mid-batch, then completes on retry', () => {
    const buffer = new SyncBuffer(root);
    for (const k of ['T-1', 'T-2', 'T-3', 'T-4']) buffer.append(entry(k));

    // Fail on the 2nd markdown write: T-1 written, T-2 fails, T-3/T-4 untouched.
    const failing = failingMarkdownIo(2);
    expect(() => service(failing.io, buffer).flushAll()).toThrow(/injected write failure/);

    // The buffer must now hold the remainder (T-2, T-3, T-4) — not empty.
    const remaining = buffer.readAll().map((e) => e.taskKey);
    expect(remaining).toEqual(['T-2', 'T-3', 'T-4']);

    // A second flush with a healthy MarkdownIo drains everything.
    const healthy = failingMarkdownIo(Number.POSITIVE_INFINITY);
    service(healthy.io, buffer).flushAll();
    expect(buffer.readAll()).toHaveLength(0);
    expect(healthy.writes()).toBe(3);
  });

  it('keeps every entry when the very first write fails', () => {
    const buffer = new SyncBuffer(root);
    for (const k of ['T-1', 'T-2']) buffer.append(entry(k));

    const failing = failingMarkdownIo(1);
    expect(() => service(failing.io, buffer).flushAll()).toThrow();

    expect(buffer.readAll().map((e) => e.taskKey)).toEqual(['T-1', 'T-2']);
  });

  it('drops nothing and leaves the buffer empty on a fully successful flush', () => {
    const buffer = new SyncBuffer(root);
    for (const k of ['T-1', 'T-2']) buffer.append(entry(k));

    const healthy = failingMarkdownIo(Number.POSITIVE_INFINITY);
    service(healthy.io, buffer).flushAll();

    expect(buffer.readAll()).toHaveLength(0);
    expect(healthy.writes()).toBe(2);
  });
});
