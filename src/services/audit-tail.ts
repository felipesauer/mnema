import { existsSync, type FSWatcher, statSync, watch } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

import type { AuditEvent } from '../storage/audit/audit-writer.js';

/**
 * Filter applied to every event before it reaches the consumer.
 */
export interface AuditTailFilter {
  readonly kind?: string;
  readonly actor?: string;
  readonly via?: string;
  readonly run?: string;
}

/**
 * Callback fired for every matching audit event. Async callbacks are
 * awaited to provide simple back-pressure: the tail does not advance
 * until the consumer has handled the previous batch.
 */
export type AuditTailHandler = (event: AuditEvent) => void | Promise<void>;

/**
 * Live tail of the audit log file.
 *
 * Implementation is intentionally simple: the tail keeps a byte offset
 * into `current.jsonl`, calls `fs.watch` for change notifications, and
 * re-reads new bytes whenever the file grows. Survives a monthly
 * rotation by reopening when the inode changes.
 *
 * The tail is stateless across process restarts — there is no
 * "where I left off" state on disk.
 */
export class AuditTail {
  private offset = 0;
  private buffer = '';
  private watcher: FSWatcher | null = null;
  private inode: number | null = null;
  private inflight = false;
  private pending = false;

  constructor(
    private readonly auditDir: string,
    private readonly handler: AuditTailHandler,
    private readonly filter: AuditTailFilter = {},
  ) {}

  /**
   * Begins watching `current.jsonl`. If the file already exists every
   * line is ignored — the tail starts at the end of the file. Use
   * {@link replaySince} for a catch-up pass before calling `start`.
   */
  async start(): Promise<void> {
    const filePath = this.currentFilePath();
    if (existsSync(filePath)) {
      const stats = statSync(filePath);
      this.offset = stats.size;
      this.inode = stats.ino;
    }

    this.watcher = watch(this.auditDir, (_event, filename) => {
      if (filename === null || filename === undefined) return;
      if (filename !== 'current.jsonl' && !filename.endsWith('.jsonl')) return;
      void this.scheduleRead();
    });
  }

  /**
   * Stops watching and releases the underlying watcher.
   */
  stop(): void {
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Replays events whose `at` timestamp is at or after the supplied
   * lower bound. Useful for `--catchup` so the user sees recent
   * history before the live tail kicks in.
   *
   * @param since - Lower bound; either an ISO8601 string or a Date
   */
  async replaySince(since: Date): Promise<void> {
    const filePath = this.currentFilePath();
    if (!existsSync(filePath)) return;

    const file = await open(filePath, 'r');
    try {
      const data = await file.readFile({ encoding: 'utf-8' });
      const lines = data.split('\n');
      for (const line of lines) {
        if (line.length === 0) continue;
        const event = parseEvent(line);
        if (event === null) continue;
        if (Date.parse(event.at) < since.getTime()) continue;
        if (!this.matches(event)) continue;
        await this.handler(event);
      }
      const stats = statSync(filePath);
      this.offset = stats.size;
      this.inode = stats.ino;
    } finally {
      await file.close();
    }
  }

  private scheduleRead(): void {
    if (this.inflight) {
      this.pending = true;
      return;
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    this.inflight = true;
    try {
      do {
        this.pending = false;
        await this.readNew();
      } while (this.pending);
    } finally {
      this.inflight = false;
    }
  }

  private async readNew(): Promise<void> {
    const filePath = this.currentFilePath();
    if (!existsSync(filePath)) {
      this.offset = 0;
      this.buffer = '';
      this.inode = null;
      return;
    }
    const stats = statSync(filePath);
    if (this.inode !== null && stats.ino !== this.inode) {
      // File was rotated under us — restart from offset 0.
      this.offset = 0;
      this.buffer = '';
    }
    this.inode = stats.ino;
    if (stats.size <= this.offset) return;

    const file = await open(filePath, 'r');
    try {
      const length = stats.size - this.offset;
      const chunk = Buffer.alloc(length);
      await file.read(chunk, 0, length, this.offset);
      this.offset = stats.size;
      this.buffer += chunk.toString('utf-8');
    } finally {
      await file.close();
    }

    let newlineAt = this.buffer.indexOf('\n');
    while (newlineAt !== -1) {
      const line = this.buffer.slice(0, newlineAt);
      this.buffer = this.buffer.slice(newlineAt + 1);
      newlineAt = this.buffer.indexOf('\n');
      if (line.length === 0) continue;

      const event = parseEvent(line);
      if (event === null) continue;
      if (!this.matches(event)) continue;
      await this.handler(event);
    }
  }

  private currentFilePath(): string {
    return path.join(this.auditDir, 'current.jsonl');
  }

  private matches(event: AuditEvent): boolean {
    if (this.filter.kind !== undefined && event.kind !== this.filter.kind) return false;
    if (this.filter.actor !== undefined && event.actor !== this.filter.actor) return false;
    if (this.filter.via !== undefined && event.via !== this.filter.via) return false;
    if (this.filter.run !== undefined && event.run !== this.filter.run) return false;
    return true;
  }
}

function parseEvent(line: string): AuditEvent | null {
  try {
    return JSON.parse(line) as AuditEvent;
  } catch {
    return null;
  }
}
