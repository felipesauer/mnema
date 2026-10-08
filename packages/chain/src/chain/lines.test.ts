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

import {
  linesFromEnd,
  parsedFromEnd,
  parseStoredLine,
  type StoredLine,
  splitLines,
  UnreadableLineError,
} from './lines.js';

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
function file(content: string | Uint8Array): string {
  const path = join(dir, 'stored.jsonl');
  writeFileSync(path, content);
  return path;
}

/** A walked line with its bytes spelled as the text they are, for comparing. */
const readable = ({ bytes, start, end }: StoredLine) => ({
  text: Buffer.from(bytes).toString('utf-8'),
  start,
  end,
});

const textsFromEnd = (path: string, chunkBytes?: number): string[] =>
  [...linesFromEnd(path, chunkBytes)].map((line) => readable(line).text);

const bytesOf = (text: string): Buffer => Buffer.from(text, 'utf-8');

describe('walking a file backwards', () => {
  it('yields the pieces a forward split would, in reverse, with their offsets', () => {
    const walked = [...linesFromEnd(file('one\ntwo\nthree\n'))].map(readable);
    expect(walked).toEqual([
      { text: '', start: 14, end: 14 },
      { text: 'three', start: 8, end: 13 },
      { text: 'two', start: 4, end: 7 },
      { text: 'one', start: 0, end: 3 },
    ]);
    // `end` is where the text stops, so `end - start` is the line's length in bytes and
    // `end + 1` is the first byte of the line after it. A caller resuming from a
    // recorded position reads that arithmetic, so it is asserted and not implied.
    expect(walked.map((line) => line.end - line.start)).toEqual([0, 5, 3, 3]);
    expect(walked.map((line) => line.text).reverse()).toEqual('one\ntwo\nthree\n'.split('\n'));
  });

  it('marks an intact file with an empty first line whose offset is the file size', () => {
    // This is how a caller tells "the last append completed" from "a crash cut
    // it short" without reading anything else.
    expect([...linesFromEnd(file('a\nb\n'))].map(readable)[0]).toEqual({
      text: '',
      start: 4,
      end: 4,
    });
  });

  it('yields the unterminated last line first when the file does not end in one', () => {
    expect([...linesFromEnd(file('a\nbc'))].map(readable)[0]).toEqual({
      text: 'bc',
      start: 2,
      end: 4,
    });
  });

  it('yields a lone line with no newline at all at offset zero', () => {
    expect([...linesFromEnd(file('solo'))].map(readable)).toEqual([
      { text: 'solo', start: 0, end: 4 },
    ]);
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

  it('measures a multi-byte line in BYTES, not in characters', () => {
    // `end - start` is what a caller resuming from a recorded position adds up, and a
    // line's byte length is not its `text.length` for anything outside ASCII: this line
    // is 6 characters, 7 UTF-16 code units and 10 bytes, and all three differ.
    const [, line] = [...linesFromEnd(file('café \u{1f512}\n'))];
    expect(line && readable(line).text).toHaveLength(7);
    expect((line?.end ?? 0) - (line?.start ?? 0)).toBe(10);
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
      if (line.bytes.length > 0) break; // the empty line, then 'last'
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

  /** The locus a caller of the rule has to supply — see {@link parseStoredLine}. */
  const where = () => 'somewhere.jsonl line 7';

  it('drops a line that can be torn and fails to parse', () => {
    expect(parseStoredLine(bytesOf('{"n":1'), true, parse, where)).toBeNull();
  });

  it('refuses the same line when it cannot be torn, NAMING where it is', () => {
    // The refusal is the caller's finding, so it has to arrive as data and not as
    // whatever the parser happened to say: the locus and the reason, both readable.
    let refusal: unknown;
    try {
      parseStoredLine(bytesOf('{"n":1'), false, parse, where);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(UnreadableLineError);
    expect((refusal as UnreadableLineError).locus).toBe('somewhere.jsonl line 7');
    expect((refusal as UnreadableLineError).reason).toMatch(/JSON/);
    expect((refusal as Error).message).toContain(
      'unreadable stored line at somewhere.jsonl line 7',
    );
  });

  it('keeps a line that can be torn but parses — that is the caller’s problem', () => {
    // A fragment that happens to parse is indistinguishable from a complete
    // line here; a resuming writer heals the file first so it never sees one.
    expect(parseStoredLine(bytesOf('{"n":1}'), true, parse, where)).toEqual({ n: 1 });
  });

  it('grants the tolerance to the first line the backward walk meets, and no other', () => {
    const torn = file('{"n":1}\n{"n":2}\n{"n":3');
    expect([...parsedFromEnd(torn, true, parse)]).toEqual([{ n: 2 }, { n: 1 }]);
  });

  it('withholds it from a file whose end is not the stream’s end', () => {
    const torn = file('{"n":1}\n{"n":3');
    expect(() => [...parsedFromEnd(torn, false, parse)]).toThrow(UnreadableLineError);
  });

  it('withholds it from a terminated last line, so corruption there still throws', () => {
    const corrupt = file('{"n":1}\n{"n":3\n');
    expect(() => [...parsedFromEnd(corrupt, true, parse)]).toThrow(UnreadableLineError);
  });

  it('names the OFFSET of the line the backward walk refused, not the file alone', () => {
    // The backward walk has no line numbers — it has byte offsets, which is the
    // position it actually knows. `{"n":1}\n` is eight bytes, so the corrupt second
    // line starts at eight.
    const corrupt = file('{"n":1}\n{"n":3\n');
    let refusal: unknown;
    try {
      [...parsedFromEnd(corrupt, true, parse)];
    } catch (error) {
      refusal = error;
    }
    expect((refusal as UnreadableLineError).locus).toBe(`${corrupt} byte offset 8`);
  });

  it('never reaches corruption further up when the caller stops early', () => {
    const corrupt = file('{"n":1\n{"n":2}\n');
    const walk = parsedFromEnd(corrupt, true, parse);
    expect(walk.next().value).toEqual({ n: 2 });
    // Reading on would hit the malformed first line and throw — the point is
    // that a caller wanting only the last line never gets there.
    expect(() => [...walk]).toThrow(UnreadableLineError);
  });
});

describe('a line that is not UTF-8', () => {
  const parse = (line: string): { s: string } => JSON.parse(line) as { s: string };
  const where = () => 'somewhere.jsonl line 2';
  /** `{"s":"caf` and then the first byte of a two-byte `é`, and nothing after it. */
  const cutInsideACharacter = Buffer.concat([bytesOf('{"s":"caf'), Buffer.from([0xc3])]);

  it('is refused, naming the first byte that does not begin a character', () => {
    // Read the way `toString('utf-8')` reads it, the 0xff became U+FFFD and the line parsed.
    const line = Buffer.concat([bytesOf('{"s":"'), Buffer.from([0xff]), bytesOf('"}')]);
    let refusal: unknown;
    try {
      parseStoredLine(line, false, parse, where);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(UnreadableLineError);
    expect((refusal as UnreadableLineError).reason).toBe('not UTF-8 at byte 6');
  });

  it('is refused in the middle of a walk, and the lines around it are still UTF-8', () => {
    const bad = Buffer.concat([bytesOf('{"s":"a"}\n{"s":"'), Buffer.from([0xed, 0xa0, 0x80])]);
    const path = file(Buffer.concat([bad, bytesOf('"}\n{"s":"b"}\n')]));
    expect(() => [...parsedFromEnd(path, true, parse)]).toThrow('not UTF-8 at byte 6');
  });

  it('keeps a torn fragment cut inside a multi-byte character a torn fragment, dropped', () => {
    // A crash can stop an append between the two bytes of `é`. That fragment is what any
    // torn write is, and it is dropped as one — it is not a refusal of bytes that are not UTF-8.
    expect(parseStoredLine(cutInsideACharacter, true, parse, where)).toBeNull();
    const path = file(Buffer.concat([bytesOf('{"s":"a"}\n'), cutInsideACharacter]));
    expect([...parsedFromEnd(path, true, parse)]).toEqual([{ s: 'a' }]);
  });

  it('is refused when the same bytes are not the end of the stream', () => {
    expect(() => parseStoredLine(cutInsideACharacter, false, parse, where)).toThrow(
      'not UTF-8 at byte 9',
    );
  });

  it('keeps a byte-order mark as the character it is, which is not a canonical line', () => {
    // A decoder that swallowed it would read `{}` and call the line canonical; the second
    // reader keeps it, and so does this one.
    const line = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytesOf('{}')]);
    expect(() => parseStoredLine(line, false, parse, where)).toThrow(UnreadableLineError);
  });
});

describe('splitting a whole file into its lines', () => {
  it('cuts where `split` would, on the byte, keeping a byte that is not UTF-8 as it is', () => {
    const text = 'one\ntwo\n\nthree\n';
    const pieces = splitLines(bytesOf(text)).map((piece) => Buffer.from(piece).toString());
    expect(pieces).toEqual(text.split('\n'));
    expect([...(splitLines(Buffer.from([0x61, 0xff, 0x0a]))[0] ?? [])]).toEqual([0x61, 0xff]);
    expect(splitLines(new Uint8Array(0)).map((piece) => piece.length)).toEqual([0]);
  });
});
