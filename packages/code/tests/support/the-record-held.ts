/**
 * WHAT THE RECORD HOLDS RIGHT NOW — the one reading of *did anything reach the chain?*
 *
 * IT WAS WRITTEN OUT TWICE AND A THIRD CASE NEEDED IT, which is the shape this bench keeps
 * paying for: two spellings of one measurement is how one of them quietly stops counting
 * something. The two were byte-for-byte the same rule — `every-verb-says-if-it-writes.test.ts`,
 * where every verb of the surface is exercised and counted around, and
 * `a-terminal-of-its-own.test.ts`, where the whole vocabulary is typed at the session's prompt —
 * and the third is the console crossing the floor of the window
 * (`a-floor-under-the-window.test.ts`), where what has to be true is that a page nobody could
 * draw wrote nothing down.
 *
 * THE EVENTS ARE COUNTED BY READING THE LINES of every segment in a sandbox, never by asking the
 * product to replay them: a count derived from the code under test moves with it, and a verb
 * that wrote an event the reader skipped would come out even.
 *
 * THE KEY MATERIAL IS HASHED BY PATH AND CONTENT, which is the other half of what *changed the
 * record* means: a key minted, adopted or installed by something that claimed to read is a
 * change even though no event was appended.
 *
 * AND THE CACHE IS DELIBERATELY NOT COUNTED. Most reads rebuild the projection, which writes a
 * file, so a digest of the whole sandbox would accuse every one of them. The question is whether
 * something can reach the RECORD, not whether it touched the disk — the argument in full is in
 * `every-verb-says-if-it-writes.test.ts`.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** A sealed segment of a tail: `NNNNNN.jsonl`, which is where events live. */
const SEGMENT = /^\d{6}\.jsonl$/;

/** Key material, wherever a tree or the key root keeps it. */
const KEY_MATERIAL = /\.(pub|key|enroll|inst|anchor)$/;

/** Everything under `dir`, as absolute paths. */
export function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/** How many events a sandbox holds, and what its key material is. */
export interface TheRecordHeld {
  /** How many events are in every tail of every tree under the directory. */
  readonly events: number;
  /** A digest of every key, by path and content. */
  readonly keys: string;
}

/** {@link TheRecordHeld}, read off a sandbox. */
export function held(dir: string): TheRecordHeld {
  let events = 0;
  const keys = createHash('sha256');
  for (const path of filesUnder(dir).sort()) {
    const name = basename(path);
    if (SEGMENT.test(name)) {
      events += readFileSync(path, 'utf-8')
        .split('\n')
        .filter((line) => line.trim().length > 0).length;
    }
    if (KEY_MATERIAL.test(name)) {
      keys.update(`${path}:`);
      keys.update(readFileSync(path));
      keys.update('\n');
    }
  }
  return { events, keys: keys.digest('hex') };
}
