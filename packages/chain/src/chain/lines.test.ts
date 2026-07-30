/**
 * The backward line walk — the bytes it returns, and the bytes it never reads.
 *
 * Every reader that resumes a tail enters its file from the end, so the edges
 * that matter here are physical: where a line starts, what a missing final
 * newline means, a line that outweighs the chunk the walk reads in, and a
 * multi-byte character split across a chunk boundary. The last case is the one
 * that would corrupt silently, so it is pinned with a chunk of a single byte.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { linesFromEnd, parsedFromEnd, parseStoredLine } from './lines.js';

/**
 * Counts the reads the walk actually issues. An ESM namespace cannot be spied
 * on, so the module is wrapped instead — every other export is the real one.
 */
const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    readSync: (...args: Parameters<typeof actual.readSync>): number => {
      reads.count += 1;
      return actual.readSync(...args);
    },
  };
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mnema-lines-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Writes `content` verbatim (no added newline) and returns its path. */
function file(content: string): string {
  const path = join(dir, 'stored.jsonl');
  writeFileSync(path, content, 'utf-8');
  return path;
}

const textsFromEnd = (path: string, chunkBytes?: number): string[] =>
  [...linesFromEnd(path, chunkBytes)].map((line) => line.text);

describe('walking a file backwards', () => {
  it('yields the pieces a forward split would, in reverse, with their offsets', () => {
    const walked = [...linesFromEnd(file('one\ntwo\nthree\n'))];
    expect(walked).toEqual([
      { text: '', start: 14 },
      { text: 'three', start: 8 },
      { text: 'two', start: 4 },
      { text: 'one', start: 0 },
    ]);
    expect(walked.map((line) => line.text).reverse()).toEqual('one\ntwo\nthree\n'.split('\n'));
  });

  it('marks an intact file with an empty first line whose offset is the file size', () => {
    // This is how a caller tells "the last append completed" from "a crash cut
    // it short" without reading anything else.
    expect([...linesFromEnd(file('a\nb\n'))][0]).toEqual({ text: '', start: 4 });
  });

  it('yields the unterminated last line first when the file does not end in one', () => {
    expect([...linesFromEnd(file('a\nbc'))][0]).toEqual({ text: 'bc', start: 2 });
  });

  it('yields a lone line with no newline at all at offset zero', () => {
    expect([...linesFromEnd(file('solo'))]).toEqual([{ text: 'solo', start: 0 }]);
  });

  it('yields nothing for an empty file', () => {
    expect([...linesFromEnd(file(''))]).toEqual([]);
  });

  it('yields one empty line per newline for a file of only newlines', () => {
    expect(textsFromEnd(file('\n\n\n'))).toEqual(['', '', '']);
  });

  it('returns a line heavier than the chunk whole', () => {
    // A stored event can carry a free-text field at the 64 KiB cap, so a line
    // CAN outweigh the chunk the walk reads in. It has to keep reading back.
    const huge = 'x'.repeat(80 * 1024);
    expect(textsFromEnd(file(`first\n${huge}\n`))).toEqual(['', huge, 'first']);
    expect(textsFromEnd(file(`first\n${huge}\n`), 64)).toEqual(['', huge, 'first']);
  });

  it('keeps a multi-byte character whole across a chunk boundary', () => {
    // One byte per read forces every multi-byte sequence to be split. Newlines
    // are found at the byte level and a line is decoded only once every one of
    // its bytes is in hand, so the split is never visible.
    expect(textsFromEnd(file('café \u{1f512}\nplain\n'), 1)).toEqual([
      '',
      'plain',
      'café \u{1f512}',
    ]);
  });

  it('reads only as far back as the caller consumes', () => {
    const path = file(`${'y'.repeat(200 * 1024)}\nlast\n`);

    reads.count = 0;
    for (const line of linesFromEnd(path)) {
      if (line.text.length > 0) break; // the empty line, then 'last'
    }
    // One 64 KiB chunk answered the question; the 200 KiB above it was never
    // read. This is the whole point of the walk, so it is asserted in reads.
    expect(reads.count).toBe(1);

    reads.count = 0;
    expect([...linesFromEnd(path)]).toHaveLength(3);
    expect(reads.count).toBe(4); // the same file, consumed whole
  });
});

describe('the torn-fragment tolerance', () => {
  const parse = (line: string): { n: number } => {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    return parsed as { n: number };
  };

  it('drops a line that can be torn and fails to parse', () => {
    expect(parseStoredLine('{"n":1', true, parse)).toBeNull();
  });

  it('throws for the same line when it cannot be torn', () => {
    expect(() => parseStoredLine('{"n":1', false, parse)).toThrow();
  });

  it('keeps a line that can be torn but parses — that is the caller’s problem', () => {
    // A fragment that happens to parse is indistinguishable from a complete
    // line here; a resuming writer heals the file first so it never sees one.
    expect(parseStoredLine('{"n":1}', true, parse)).toEqual({ n: 1 });
  });

  it('grants the tolerance to the first line the backward walk meets, and no other', () => {
    const torn = file('{"n":1}\n{"n":2}\n{"n":3');
    expect([...parsedFromEnd(torn, true, parse)]).toEqual([{ n: 2 }, { n: 1 }]);
  });

  it('withholds it from a file whose end is not the stream’s end', () => {
    const torn = file('{"n":1}\n{"n":3');
    expect(() => [...parsedFromEnd(torn, false, parse)]).toThrow();
  });

  it('withholds it from a terminated last line, so corruption there still throws', () => {
    const corrupt = file('{"n":1}\n{"n":3\n');
    expect(() => [...parsedFromEnd(corrupt, true, parse)]).toThrow();
  });

  it('never reaches corruption further up when the caller stops early', () => {
    const corrupt = file('{"n":1\n{"n":2}\n');
    const walk = parsedFromEnd(corrupt, true, parse);
    expect(walk.next().value).toEqual({ n: 2 });
    // Reading on would hit the malformed first line and throw — the point is
    // that a caller wanting only the last line never gets there.
    expect(() => [...walk]).toThrow();
  });
});
