/**
 * The last entry this installation wrote to a tail, kept where git does not look, so its next
 * write can tell whether the tail still ends there (ADR-123: a tail is not forked).
 *
 * WHY. A tail's files are committed and its installation id is not, so the files move with
 * the branch and the id stays with the checkout. One checkout switched between two branches,
 * or a checkout whose id was copied into another, writes ONE tail on two lines of history,
 * and git then conflicts on the segment and on the checkpoints; a merge that keeps both sides
 * is refused by both readers. The writer cannot see it from the tail alone: whatever end a
 * branch left is a sound end. What it can see is that the end is not the entry it wrote last.
 *
 * WHAT IT IS. Beside the tail's lock in `locks/`, which the tree's `.gitignore` keeps out of
 * the record: machinery, never proof, never read by a reader. It changes no byte of the format.
 * Lost or unreadable, it reads as absent, and the writer then opens a new tail rather than
 * append to one it has no note of writing: a tail more, never a fork.
 *
 * WHAT IT CANNOT SEE. A copy that carries `locks/` with the tail (a `cp -a` of the checkout, a
 * backup restored whole) holds the same note, so both copies append to the same end. That fork
 * is the readers' to name (`fork`, FORMAT.md section 3).
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChainLayout } from './layout.js';

/** The last entry written to a tail: its seq and its entry hash. */
export interface KeptHead {
  readonly seq: number;
  readonly hash: string;
}

/** Where a tail keeps the last entry this installation wrote to it, by tail id. */
export function keptHeadPath(layout: ChainLayout, tailId: string): string {
  return join(layout.root, 'locks', `${tailId}.head`);
}

/** The note, or undefined when it is absent or does not read as one. */
export function readKeptHead(layout: ChainLayout, tailId: string): KeptHead | undefined {
  let text: string;
  try {
    text = readFileSync(keptHeadPath(layout, tailId), 'utf-8');
  } catch {
    return undefined;
  }
  const match = /^(\d+) ([0-9a-f]+)\n$/.exec(text);
  if (match === null) return undefined;
  return { seq: Number.parseInt(match[1] as string, 10), hash: match[2] as string };
}

/**
 * Replaces the note whole, so a reader never meets half of it. A note that could not be kept
 * costs the next write a new tail, and nothing else: it never decides what a reader sees.
 */
export function keepHead(layout: ChainLayout, tailId: string, head: KeptHead): void {
  const path = keptHeadPath(layout, tailId);
  const staging = `${path}.${process.pid}`;
  try {
    writeFileSync(staging, `${head.seq} ${head.hash}\n`);
    renameSync(staging, path);
  } catch {
    // See above: the next write opens a new tail.
  }
}
