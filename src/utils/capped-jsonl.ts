import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { writeFileAtomic } from './atomic-write.js';

/**
 * Appends one line to a JSONL file, capping it at `maxEntries` lines by
 * dropping the OLDEST when the append would exceed the cap. Shared by the
 * local, git-ignored, best-effort logs (crash log, usage counter) that must
 * not grow without bound — they are diagnostics, not durable records.
 *
 * Fast path: below the cap, a plain append (no rewrite). Only at/over the cap do
 * we read the file, keep the newest `maxEntries - 1` lines plus the new one,
 * and rewrite it atomically ({@link writeFileAtomic} — temp then rename) so a
 * crash mid-rewrite can never truncate the log.
 *
 * The caller owns the best-effort contract: this throws on an unwritable path
 * like any fs call, and each caller already wraps it in a swallowing try/catch
 * (recording a crash or a usage tally must never fail the operation it logs).
 *
 * @param file - Absolute path to the JSONL file
 * @param entry - The already-serialised line WITHOUT a trailing newline
 * @param maxEntries - Maximum number of lines to keep (must be >= 1)
 */
export function appendCappedJsonl(file: string, entry: string, maxEntries: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const line = `${entry}\n`;

  const existing = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  const lineCount = existing.length === 0 ? 0 : existing.replace(/\n$/, '').split('\n').length;
  if (lineCount < maxEntries) {
    appendFileSync(file, line, 'utf-8');
    return;
  }
  // At/over the cap: keep the newest (maxEntries - 1) existing lines + the new
  // one, rewritten atomically.
  const kept = existing
    .replace(/\n$/, '')
    .split('\n')
    .slice(-(maxEntries - 1));
  writeFileAtomic(file, `${[...kept, entry].join('\n')}\n`);
}
