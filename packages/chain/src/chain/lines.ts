/**
 * Reading an append-only file of lines from its END.
 *
 * Every file the chain stores is append-only and line-delimited, and everything
 * a resuming writer asks of one is about its last few lines: what the head is,
 * how far the coverage reaches, where the next append lands. Answering that by
 * reading the file forward costs the whole file on every write, which over a run
 * of N writes is O(N²) — the shape this module exists to remove. So the walk
 * starts at the physical end and reads only as far back as the caller asks.
 *
 * It reads in chunks and never assumes a line fits in one: a stored event can
 * carry a free-text field near the 64 KiB cap, so a single line can outweigh any
 * sensible chunk. The walk keeps reading backwards and accumulating until it
 * finds the newline that begins the line — and because the FIRST line of a file
 * has no newline before it, reaching offset 0 ends a line too.
 *
 * Newlines are found at the BYTE level, which is what makes this safe for UTF-8:
 * 0x0A never appears inside a multi-byte sequence, so a line is decoded only once
 * every one of its bytes is in hand, and a character split across a chunk
 * boundary is never seen half-decoded.
 */

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const NEWLINE = 0x0a;

/**
 * How many bytes one backward read pulls in. Sized so the common line — an entry
 * of a few hundred bytes, a checkpoint of a few hundred more — is reached in a
 * single read, while a line at the field cap still resolves in a couple. It is
 * not a limit on anything: the walk reads as many chunks as a line needs.
 */
const CHUNK_BYTES = 64 * 1024;

/** One line of a stored file, as the backward walk found it. */
export interface StoredLine {
  /** The line's text, without its terminating newline. */
  readonly text: string;
  /** The offset, in bytes, of the line's first byte in the file. */
  readonly start: number;
}

/**
 * Yields a file's lines from the LAST to the first — exactly the pieces
 * `content.split('\n')` would produce, in reverse.
 *
 * A file that ends in a newline therefore yields an EMPTY first line, at an
 * offset equal to the file's size, just as the forward split produces an empty
 * last element. That is not noise: it is how a caller tells an intact file from
 * one a crash left with a partial final line, without reading anything else.
 *
 * Nothing is read ahead of what is consumed. A caller that stops with `break`
 * after the first line has read one chunk, whatever the file weighs, and the
 * file descriptor closes on the way out.
 */
export function* linesFromEnd(file: string, chunkBytes = CHUNK_BYTES): Generator<StoredLine> {
  const fd = openSync(file, 'r');
  try {
    let pos = fstatSync(fd).size;
    // The bytes already read that belong to a line whose start has not been
    // found yet — never more than one line's worth, so it stays bounded.
    let carry = Buffer.alloc(0);
    while (pos > 0) {
      const size = Math.min(chunkBytes, pos);
      pos -= size;
      const chunk = Buffer.alloc(size);
      let got = 0;
      while (got < size) {
        const read = readSync(fd, chunk, got, size - got, pos + got);
        // A regular file only short-reads inside its own size if it shrank under
        // the walk, and a reader of an append-only file cannot answer for that.
        if (read === 0) throw new Error(`chain: ${file} shrank while being read backwards`);
        got += read;
      }
      const buf = carry.length === 0 ? chunk : Buffer.concat([chunk, carry]);
      let end = buf.length;
      while (end > 0) {
        const newline = buf.lastIndexOf(NEWLINE, end - 1);
        if (newline < 0) break;
        yield { text: buf.toString('utf-8', newline + 1, end), start: pos + newline + 1 };
        end = newline;
      }
      carry = buf.subarray(0, end);
    }
    // Offset 0 reached: whatever is left is the file's first line, which has no
    // newline before it to find.
    if (carry.length > 0) yield { text: carry.toString('utf-8'), start: 0 };
  } finally {
    closeSync(fd);
  }
}

/**
 * Parses one stored line, granting the ONE tolerance an append-only file earns.
 *
 * A malformed line is corruption worth surfacing — EXCEPT one specific, benign
 * case: a crash mid-append can leave a torn final line at the physical end of
 * the stream. A complete append always ends in a newline, so a torn write is
 * exactly "the line is not newline-terminated and it fails to parse". That one
 * fragment yields `null` so the intact prefix still reads and the writer can
 * resume; any malformed line elsewhere (or a torn fragment that happens to
 * parse) still throws.
 *
 * This is the ONE place the rule lives. Every reader of a stored line goes
 * through here — forward or backward, entries or checkpoints — so the tolerance
 * cannot drift between them.
 *
 * `couldBeTorn` is the caller's answer to "is this the unterminated last line of
 * the file that ends this stream?". For a tail's segments only the LAST one
 * qualifies: an earlier segment's end is a seal, not a crash boundary.
 */
export function parseStoredLine<T>(
  line: string,
  couldBeTorn: boolean,
  parse: (line: string) => T,
): T | null {
  try {
    return parse(line);
  } catch (error) {
    if (couldBeTorn) return null; // torn last write from a crash — drop it
    throw error;
  }
}

/**
 * Parses an append-only file's lines from the END, newest first, applying
 * {@link parseStoredLine}'s tolerance to the one line that can earn it.
 *
 * `endsTheStream` says whether this file's physical end is the stream's end —
 * true for a single-file stream like a tail's checkpoints, and true only of the
 * LAST segment of a tail.
 *
 * Being a generator is the whole point: the caller stops with `break` the moment
 * it has what it needs and nothing further is read or parsed.
 */
export function* parsedFromEnd<T>(
  file: string,
  endsTheStream: boolean,
  parse: (line: string) => T,
): Generator<T> {
  let atPhysicalEnd = true;
  for (const line of linesFromEnd(file)) {
    // Only the walk's first line sits at the physical end of the file — and if
    // the file ended in a newline that line is empty, so a torn fragment is
    // exactly a non-empty first line.
    const couldBeTorn = atPhysicalEnd && endsTheStream;
    atPhysicalEnd = false;
    if (line.text.length === 0) continue;
    const parsed = parseStoredLine(line.text, couldBeTorn, parse);
    if (parsed !== null) yield parsed;
  }
}
