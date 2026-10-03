/**
 * What a cache says about itself — the stamp, the frontier and the fingerprints — and the one
 * thing each is for: telling a cache that can still be trusted from one that cannot.
 */

import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema.js';
import { IN_MEMORY, openDatabase } from '../db/sqlite.js';
import {
  type CacheMeta,
  productStamp,
  readGeneration,
  readMeta,
  sealedFingerprints,
  sealedSegmentsHold,
  writeMeta,
} from './cache-meta.js';
import type { ChainFrontier } from './order.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mnema-meta-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function frontierOver(segments: readonly string[]): ChainFrontier {
  return {
    events: 12,
    tails: new Map([
      [
        'a-tail',
        {
          lastSeq: 11,
          lastHash: 'h'.repeat(64),
          boundary: { segment: segments.at(-1) as string, bytes: 400 },
          segments,
          latestAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]),
  };
}

describe('the stamp', () => {
  it('is one value for the code that is running, and a digest of it', () => {
    expect(productStamp()).toBe(productStamp());
    expect(productStamp()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('what is stored', () => {
  it('reads back exactly what was written, frontier included', () => {
    const db = openDatabase(IN_MEMORY);
    ensureSchema(db);
    expect(readMeta(db), 'a fresh database says nothing').toBeUndefined();
    expect(readGeneration(db)).toBe(-1);

    const meta: CacheMeta = {
      stamp: productStamp(),
      generation: 4,
      frontier: frontierOver(['/x/000001.jsonl']),
      breaks: [{ tail: 'a-tail', seq: 3, detail: 'seq gap: expected 3, found 4' }],
      sealed: { '/x/000001.jsonl': '10:1' },
    };
    writeMeta(db, meta);
    expect(readMeta(db)).toEqual(meta);
    expect(readGeneration(db)).toBe(4);
    db.close();
  });
});

describe('the fingerprints of sealed segments', () => {
  it('cover every segment but the one a tail is still appending to', () => {
    const sealed = join(dir, '000001.jsonl');
    const live = join(dir, '000002.jsonl');
    writeFileSync(sealed, 'a\n');
    writeFileSync(live, 'b\n');
    const fingerprints = sealedFingerprints(frontierOver([sealed, live]));
    expect(Object.keys(fingerprints)).toEqual([sealed]);
  });

  it('hold while the file is the file, and stop holding when it is not', () => {
    const sealed = join(dir, '000001.jsonl');
    writeFileSync(sealed, 'the same bytes\n');
    const recorded = sealedFingerprints(frontierOver([sealed, join(dir, '000002.jsonl')]));
    expect(sealedSegmentsHold(recorded)).toBe(true);

    // The same size, a later modification time: a rewrite, which a sealed segment never is.
    const before = statSync(sealed);
    utimesSync(sealed, new Date(before.atimeMs + 5_000), new Date(before.mtimeMs + 5_000));
    expect(sealedSegmentsHold(recorded)).toBe(false);

    // And a file that is gone is not the file that was recorded.
    rmSync(sealed);
    expect(sealedSegmentsHold(recorded)).toBe(false);
  });
});
