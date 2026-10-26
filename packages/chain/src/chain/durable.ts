/**
 * Appending to a file of the record so that, once the call returns, the bytes are on the
 * disk and not only in the kernel's cache.
 *
 * WHAT A RETURN USED TO MEAN. The writer appended with `appendFileSync` and nothing else, so
 * an event the command line reported as written had reached the page cache: it survived the
 * process (a crash, a kill) and did not survive the machine (a power cut, a kernel panic)
 * until the kernel flushed it on its own, seconds later. Nothing in the product said which of
 * the two it promised.
 *
 * WHAT IT MEANS NOW. Every line the writer appends (an entry to a segment, a checkpoint to
 * `checkpoints.jsonl`) goes through {@link appendDurably}, which asks the kernel to put the
 * file's bytes on the disk (`fsync`) before it returns; and when the append CREATED the file,
 * the directory that names it is synced too, because a file whose bytes are on the disk and
 * whose name is not can still vanish whole. Asserted in `durable.test.ts`, which counts the
 * syncs a write and a checkpoint issue against the files they wrote.
 *
 * WHAT IT COSTS, measured through the writer itself on the head that turned it on, against the
 * trunk before it (two arms and an A/A copy of each, order rotated, 20 repetitions, ext4 on NVMe
 * with other work on the disk): an act of one entry and one checkpoint went from about 0.4–0.5 ms
 * to 10–13 ms at the median, 20–23 ms at the 90th percentile; one `mnema memory` on the command
 * line, base and head alternated 20 times, from 180 ms to 189 ms at the median. The number moves
 * with what else the disk is doing, and nothing here waits on anything but the disk.
 *
 * THE FILES WRITTEN ONCE BESIDE THE RECORD that name who signs (a key's public half, the
 * private half, the local installation id and the anchor) go through {@link writeFileDurably}
 * and {@link syncFile}: a power cut after the call reported them written used to leave a name
 * with nothing behind it, or no name at all, for an identity the record already carried events
 * of. Asserted in `durable.test.ts` the same way, by the syncs asked.
 *
 * WHAT IT DOES NOT COVER. A tail's proof of ownership and the key root's ignore file are written
 * as before. A segment truncated back to its last whole
 * line on recovery is not synced either: it shortens a tail to what was already durable.
 * On Windows a directory cannot be opened to be synced, so there only the file is.
 */

import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Appends `data` to the file at `path`, creating it if it is absent, and returns only once
 * the kernel reports the file's bytes (and, for a file this call created, its name in the
 * directory) written to the disk.
 *
 * A throw from the sync is a throw from the append: the caller treats it as the write
 * failing, which is what it is, since nothing promises the bytes landed.
 */
export function appendDurably(path: string, data: string): void {
  const created = !existsSync(path);
  const fd = openSync(path, 'a');
  try {
    appendFileSync(fd, data, 'utf-8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (created) syncDirectory(dirname(path));
}

/**
 * Writes `data` to `path` (replacing what is there) and returns only once the file's bytes, and
 * the directory entry of a file this call created, are on the disk.
 */
export function writeFileDurably(
  path: string,
  data: string,
  options: { readonly mode?: number } = {},
): void {
  const created = !existsSync(path);
  const fd = openSync(path, 'w', options.mode);
  try {
    writeFileSync(fd, data, 'utf-8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (created) syncDirectory(dirname(path));
}

/** Syncs a file already written through a descriptor of the caller's, then the directory naming it. */
export function syncFile(fd: number, path: string): void {
  fsyncSync(fd);
  syncDirectory(dirname(path));
}

/** Syncs a directory's entries to the disk: a no-op where a directory cannot be opened. */
export function syncDirectory(dir: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
