/**
 * The extent: what it moves for, and what it deliberately does not move for.
 *
 * Every case here is a fact about the SIGNAL, stated against files rather than
 * against a writer, because that is what the signal reads. What it means for a
 * retained projection is the surface's business — `the-record-may-have-moved.test.ts`
 * in `@mnema/code` runs the whole of it against real other processes.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chainExtent } from './freshness.js';
import { type ChainLayout, segmentPath, tailDir } from './layout.js';

let root: string;
let layout: ChainLayout;

/** Writes a tail's segment, creating the tail directory if it is new. */
function writeSegment(tailId: string, segment: number, content: string): void {
  mkdirSync(tailDir(layout, tailId), { recursive: true });
  writeFileSync(segmentPath(layout, tailId, segment), content, 'utf-8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-extent-'));
  layout = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a chain that has not moved reads the same', () => {
  it('the same files give the same extent, read again and again', () => {
    writeSegment('tail-a', 1, 'one line\n');
    const first = chainExtent(layout);
    expect(chainExtent(layout)).toBe(first);
    expect(chainExtent(layout)).toBe(first);
  });

  it('a tree with no tails is empty, and stays empty', () => {
    expect(chainExtent(layout)).toBe('');
    mkdirSync(join(root, 'tails'), { recursive: true });
    expect(chainExtent(layout)).toBe('');
  });
});

describe('every way a chain moves changes it', () => {
  it('an append — the last segment grew', () => {
    writeSegment('tail-a', 1, 'one line\n');
    const before = chainExtent(layout);
    writeSegment('tail-a', 1, 'one line\nanother line\n');
    expect(chainExtent(layout)).not.toBe(before);
  });

  it('a rotation — a later segment, on a tail already known', () => {
    // The one move that does not make a file bigger: the segment being filled is
    // sealed at its size and the next one starts. An extent that watched only the
    // size of a known file would call this unchanged.
    writeSegment('tail-a', 1, 'sealed\n');
    const before = chainExtent(layout);
    writeSegment('tail-a', 2, 'sealed\n'); // byte-identical, later file
    expect(chainExtent(layout)).not.toBe(before);
  });

  it('a tail that did not exist — another installation writing here', () => {
    writeSegment('tail-a', 1, 'ours\n');
    const before = chainExtent(layout);
    writeSegment('tail-b', 1, 'theirs\n');
    expect(chainExtent(layout)).not.toBe(before);
  });

  it('a tail directory appearing before its first event', () => {
    // The writer makes the directory (and its proof of ownership) before the
    // first append lands, so the empty tail is a real state — and the append
    // that follows still has to move the mark.
    const before = chainExtent(layout);
    mkdirSync(tailDir(layout, 'tail-a'), { recursive: true });
    const empty = chainExtent(layout);
    expect(empty).not.toBe(before);
    writeSegment('tail-a', 1, 'the first event\n');
    expect(chainExtent(layout)).not.toBe(empty);
  });

  it('a tail going away', () => {
    writeSegment('tail-a', 1, 'ours\n');
    writeSegment('tail-b', 1, 'theirs\n');
    const before = chainExtent(layout);
    rmSync(tailDir(layout, 'tail-b'), { recursive: true, force: true });
    expect(chainExtent(layout)).not.toBe(before);
  });

  it('a truncation — the writer healing a torn line off the end', () => {
    // Growth is what an append does, but the extent is not asserting monotonicity:
    // a recovering writer cuts a crash fragment off the last segment, and a
    // reader that had already replayed the fragment must not be left holding it.
    writeSegment('tail-a', 1, 'complete\npartial-l');
    const before = chainExtent(layout);
    writeSegment('tail-a', 1, 'complete\n');
    expect(chainExtent(layout)).not.toBe(before);
  });
});

describe('what it does not see, and must not', () => {
  it('a rewrite that preserves the size', () => {
    // The declared blind spot. This is tampering, and answering it means
    // recomputing hashes and checking signatures — which is `verifyChain`'s
    // subject, on a chain the extent has no business making claims about. A probe
    // that pretended to catch this would be promising proof on a signal chosen
    // for being one `stat`.
    const original = 'the original line\n';
    const forged = 'the forged   line\n';
    expect(forged).toHaveLength(original.length); // or this case is not the case
    writeSegment('tail-a', 1, original);
    const before = chainExtent(layout);
    writeSegment('tail-a', 1, forged);
    expect(chainExtent(layout)).toBe(before);
  });

  it('an edit to a segment already sealed', () => {
    // Same blind spot, one file earlier: only the last segment is stat'ed,
    // because only the last segment is one an append can reach. An earlier one
    // changing at all is not something the writer does.
    writeSegment('tail-a', 1, 'sealed\n');
    writeSegment('tail-a', 2, 'current\n');
    const before = chainExtent(layout);
    writeSegment('tail-a', 1, 'forged\n');
    expect(chainExtent(layout)).toBe(before);
  });

  it('a checkpoint appended with no event behind it', () => {
    // Checkpoints are not what a projection replays — the replay reads segments
    // — so a checkpoint file that grew on its own says nothing about what the
    // read model owes. The verifier is what reads every one of them.
    writeSegment('tail-a', 1, 'an event\n');
    const before = chainExtent(layout);
    writeFileSync(join(tailDir(layout, 'tail-a'), 'checkpoints.jsonl'), '{"a":1}\n', 'utf-8');
    expect(chainExtent(layout)).toBe(before);
  });
});

describe('a chain it cannot read', () => {
  it('a tails directory that is not a directory holds a stable mark, and does not throw', () => {
    // A read that cannot list must not take the caller down with it: the extent
    // was only ever asked whether anything moved, and reporting an unreadable
    // chain belongs to the replay, which reports it by failing. Stable, so a
    // reader does not replay in a loop against a fault that persists.
    writeFileSync(join(root, 'tails'), 'not a directory\n', 'utf-8');
    const first = chainExtent(layout);
    expect(first).toBe('!ENOTDIR');
    expect(chainExtent(layout)).toBe(first);
  });

  it('one unreadable tail does not silence the readable ones beside it', () => {
    // The mark is per tail, so a fault in one is a fault in one: a chain of
    // several tails where one has become unreadable still moves when a readable
    // one grows, and still says nothing has moved when none has.
    writeSegment('tail-a', 1, 'readable\n');
    mkdirSync(tailDir(layout, 'tail-b'), { recursive: true });
    // A segment that lists but cannot be stat'ed: the walk finds the name, and
    // the link points at nothing.
    symlinkSync(join(root, 'nowhere'), segmentPath(layout, 'tail-b', 1));

    const before = chainExtent(layout);
    expect(before).toContain('tail-b=!ENOENT');
    expect(chainExtent(layout)).toBe(before);

    writeSegment('tail-a', 1, 'readable\nand longer\n');
    expect(chainExtent(layout)).not.toBe(before);
  });
});
