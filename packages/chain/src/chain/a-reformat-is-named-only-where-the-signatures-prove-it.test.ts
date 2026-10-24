/**
 * A REFORMAT IS NAMED ONLY WHERE THE SIGNATURES PROVE IT, and the verdict does not move.
 *
 * A formatter or an editor that rewrites the record leaves bytes that are not the bytes the
 * proof was taken over: prettier, Biome, dprint and pre-commit's `pretty-format-json` indent
 * `tailproof.json`, an EditorConfig with `end_of_line = crlf` (and pre-commit's
 * `mixed-line-ending --fix=crlf`) puts a carriage return on every line. The verifier refuses
 * them, as it must. What it adds is ONE line saying that a formatter did it, and only when that
 * is proved: the files read back in canonical form, in memory, verify under the same verifier
 * with no issue at all, and every line that had to be put back is covered by a signature (an
 * event by a verified checkpoint, a checkpoint or a tail proof by its own signature).
 *
 * THREE EARLIER DESIGNS WERE REFUSED, and each refusal is a case below. Comparing a line with
 * its own canonical form let a tampering plus one space read as a reformat; confirming it with
 * the line's own stored hash let a tampering that recomputed that hash through; re-reading a
 * canonicalized copy on disk wrote through a symlink and fell over without TMPDIR. Nothing here
 * is written anywhere, and the last line of a tail that no checkpoint covers is never called a
 * reformat: the hash a keyless party can recompute is all that binds it.
 *
 * THE SECOND READER REFUSES THE SAME RECORDS AND SAYS NOTHING OF A FORMATTER: the diagnosis is
 * this reader's alone (see the verifier's README), and the verdict is the one both give.
 */

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, memoryCaptured } from '../events/build.js';
import { canonicalStringify } from '../events/canonical.js';
import { openChainForWriting, verify } from './chain.js';
import { entryHash, writtenAsStored } from './hash.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mnema-reformat-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Written {
  readonly root: string;
  readonly tail: string;
  /** The tail's directory, under the chain root. */
  readonly tailDir: string;
  /** Paths under the chain root, the way a verdict names them. */
  readonly segment: string;
  readonly checkpoints: string;
  readonly tailproof: string;
}

/** A record of one machine: founded, then `acts` notes, each signed unless `lastUnsigned`. */
function aRecord(acts: number, options: { lastUnsigned?: boolean } = {}): Written {
  const root = join(dir, 'record');
  const keyRoot = join(dir, 'keys');
  mkdirSync(root);
  mkdirSync(keyRoot);
  const w = openChainForWriting(root, { keyRoot });
  let clock = Date.UTC(2026, 9, 1);
  const at = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };
  w.append(
    identityFounded(
      { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: w.anchor },
      { foundingFp: w.signerFingerprint },
    ),
  );
  w.checkpoint();
  for (let i = 0; i < acts; i += 1) {
    w.append(
      memoryCaptured(
        { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: `note-${i}` },
        { content: `note ${i}, with "quotes" and naïve accents` },
      ),
    );
    if (!(options.lastUnsigned === true && i === acts - 1)) w.checkpoint();
  }
  const tailDir = `tails/${w.tail}`;
  return {
    root,
    tail: w.tail,
    tailDir,
    segment: `${tailDir}/000001.jsonl`,
    checkpoints: `${tailDir}/checkpoints.jsonl`,
    tailproof: `${tailDir}/tailproof.json`,
  };
}

const read = (r: Written, path: string): string => readFileSync(join(r.root, path), 'utf-8');
const write = (r: Written, path: string, text: string): void =>
  writeFileSync(join(r.root, path), text);

/** What an EditorConfig with `end_of_line = crlf` leaves. */
const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
/** What prettier, dprint and `pretty-format-json` leave of a one-line JSON file. */
const indented = (text: string): string => `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
/** A line rewritten with its keys in reverse and a space after each colon and comma. */
function reordered(line: string): string {
  const flip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(flip);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([k, v]) => [k, flip(v)]),
    );
  };
  return JSON.stringify(flip(JSON.parse(line)), null, 1).replace(/\n\s*/g, ' ');
}

/** The lines of a JSONL file, its final newline left out. */
const linesOf = (text: string): string[] => text.split('\n').filter((line) => line !== '');

function secondReader(root: string): { verdict: string; text: string } {
  const run = spawnSync('python3', [VERIFIER, '--json', 'record', root], { encoding: 'utf-8' });
  if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
  const reading = JSON.parse(run.stdout) as { verdict: string };
  return { verdict: reading.verdict, text: run.stdout };
}

describe('a record a formatter rewrote is still refused, and the reformat is named', () => {
  it('names an indented tail proof (prettier, Biome, dprint, pretty-format-json)', () => {
    const r = aRecord(3);
    write(r, r.tailproof, indented(read(r, r.tailproof)));
    const result = verify(r.root);
    expect(result.ok).toBe(false);
    expect(result.level).toBe('broken');
    expect(result.issues.map((issue) => issue.detail)).toEqual([
      expect.stringContaining('has a malformed ownership proof'),
    ]);
    expect(result.reformatted?.files).toEqual([r.tailproof]);
    expect(result.reformatted?.detail).toContain(r.tailproof);
    expect(result.reformatted?.detail).toContain('a formatter or an editor rewrote');
  });

  it('names every file an EditorConfig set to CRLF rewrote, the verdict unchanged', () => {
    const r = aRecord(3);
    for (const path of [r.segment, r.checkpoints, r.tailproof]) write(r, path, crlf(read(r, path)));
    const result = verify(r.root);
    expect(result.ok).toBe(false);
    expect(result.level).toBe('unreadable');
    // Every line still refused, by the CRLF sentence it had before.
    const unreadable = result.issues.filter((issue) => issue.detail.startsWith('UNREADABLE'));
    expect(unreadable).toHaveLength(4 + 4);
    expect(unreadable.every((issue) => issue.detail.includes('the line ends in CRLF'))).toBe(true);
    expect(result.reformatted?.files).toEqual([r.segment, r.checkpoints, r.tailproof]);
  });

  it('names a covered line whose keys were reordered and spaced', () => {
    const r = aRecord(3);
    const lines = linesOf(read(r, r.segment));
    lines[2] = reordered(lines[2] as string);
    write(r, r.segment, `${lines.join('\n')}\n`);
    const result = verify(r.root);
    expect(result.ok).toBe(false);
    expect(result.reformatted?.files).toEqual([r.segment]);
  });

  it('is said by this reader alone: the second reader refuses the same bytes, and names no formatter', () => {
    const r = aRecord(2);
    for (const path of [r.segment, r.checkpoints]) write(r, path, crlf(read(r, path)));
    write(r, r.tailproof, indented(read(r, r.tailproof)));
    expect(verify(r.root).reformatted).toBeDefined();
    const second = secondReader(r.root);
    expect(second.verdict).toBe('REFUSED');
    expect(second.text).not.toMatch(/formatter/i);
  });
});

describe('what only imitates a formatter is never called one', () => {
  it('a covered event whose content changed, laid out as a formatter would', () => {
    const r = aRecord(3);
    const lines = linesOf(read(r, r.segment));
    lines[2] = reordered((lines[2] as string).replace('note 1,', 'note 9,'));
    write(r, r.segment, `${lines.join('\n')}\n`);
    const result = verify(r.root);
    expect(result.ok).toBe(false);
    expect(result.reformatted).toBeUndefined();
  });

  it('a covered event changed, its hash and every hash after it recomputed, then set to CRLF', () => {
    const r = aRecord(3);
    const entries = linesOf(read(r, r.segment)).map(
      (line) =>
        JSON.parse(line) as { event: Record<string, unknown>; link: Record<string, unknown> },
    );
    (entries[2]?.event.payload as { content: string }).content = 'note 9, rewritten';
    let prev: string | null = null;
    for (const entry of entries) {
      entry.link.prev = prev;
      entry.link.hash = entryHash({
        event: writtenAsStored(entry.event as never),
        tail: entry.link.tail as string,
        seq: entry.link.seq as number,
        prev,
      });
      prev = entry.link.hash as string;
    }
    const text = entries.map((entry) => canonicalStringify(entry as never)).join('\n');
    write(r, r.segment, crlf(`${text}\n`));
    const result = verify(r.root);
    expect(result.ok).toBe(false);
    expect(result.reformatted).toBeUndefined();
  });

  it('the last event of a tail, which no checkpoint covers, reformatted and nothing else', () => {
    const r = aRecord(3, { lastUnsigned: true });
    write(r, r.segment, crlf(read(r, r.segment)));
    const result = verify(r.root);
    expect(result.ok).toBe(false);
    expect(result.reformatted).toBeUndefined();
  });

  it('the last event, uncovered, rewritten with its hash recomputed and a space added', () => {
    const r = aRecord(3, { lastUnsigned: true });
    const lines = linesOf(read(r, r.segment));
    const last = JSON.parse(lines.at(-1) as string) as {
      event: { payload: { content: string } };
      link: { tail: string; seq: number; prev: string | null; hash: string };
    };
    last.event.payload.content = 'a fact nobody signed';
    last.link.hash = entryHash({
      event: writtenAsStored(last.event as never),
      tail: last.link.tail,
      seq: last.link.seq,
      prev: last.link.prev,
    });
    lines[lines.length - 1] = canonicalStringify(last as never).replace('":', '": ');
    write(r, r.segment, `${lines.join('\n')}\n`);
    const result = verify(r.root);
    expect(result.ok).toBe(false);
    expect(result.reformatted).toBeUndefined();
  });

  it('an indented tail proof whose signature was changed', () => {
    const r = aRecord(2);
    const proof = JSON.parse(read(r, r.tailproof)) as { sig: string };
    proof.sig = `${proof.sig.slice(0, -2)}00`;
    write(r, r.tailproof, `${JSON.stringify(proof, null, 2)}\n`);
    expect(verify(r.root).reformatted).toBeUndefined();
  });

  it('a checkpoint whose covered range was changed, laid out with CRLF', () => {
    const r = aRecord(2);
    const lines = linesOf(read(r, r.checkpoints));
    const first = JSON.parse(lines[0] as string) as { contentRoot: string };
    first.contentRoot = first.contentRoot.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    lines[0] = canonicalStringify(first as never);
    write(r, r.checkpoints, crlf(`${lines.join('\n')}\n`));
    expect(verify(r.root).reformatted).toBeUndefined();
  });

  it('a reformat beside a break that is not one', () => {
    const r = aRecord(2);
    write(r, r.segment, crlf(read(r, r.segment)));
    const proof = JSON.parse(read(r, r.tailproof)) as { sig: string };
    proof.sig = `${proof.sig.slice(0, -2)}00`;
    write(r, r.tailproof, `${canonicalStringify(proof as never)}\n`);
    expect(verify(r.root).reformatted).toBeUndefined();
  });

  it('a line holding a key twice, spaced', () => {
    const r = aRecord(2);
    const lines = linesOf(read(r, r.segment));
    lines[1] = (lines[1] as string).replace('{"event":', '{"event": {}, "event":');
    write(r, r.segment, `${lines.join('\n')}\n`);
    expect(verify(r.root).reformatted).toBeUndefined();
  });

  it('a record nothing rewrote carries no such line', () => {
    const r = aRecord(2);
    const result = verify(r.root);
    expect(result.ok).toBe(true);
    expect(result.reformatted).toBeUndefined();
  });
});

describe('the diagnosis reads in memory and writes nothing', () => {
  it('reads a tail proof through a symlink and writes nothing through it, with no TMPDIR', () => {
    const r = aRecord(2);
    const outside = join(dir, 'outside.json');
    writeFileSync(outside, indented(read(r, r.tailproof)));
    rmSync(join(r.root, r.tailproof));
    symlinkSync(outside, join(r.root, r.tailproof));
    write(r, r.segment, crlf(read(r, r.segment)));
    const before = readFileSync(outside);
    const listing = (): string[] =>
      readdirSync(dir, { recursive: true, encoding: 'utf-8' })
        .map((name) => `${name}:${statSync(join(dir, name)).mtimeMs}`)
        .sort();
    const was = listing();
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = join(dir, 'no-such-directory');
    let result: ReturnType<typeof verify>;
    try {
      result = verify(r.root);
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
    expect(result.ok).toBe(false);
    expect(result.reformatted?.files).toEqual([r.segment, r.tailproof]);
    expect(readFileSync(outside).equals(before)).toBe(true);
    expect(listing()).toEqual(was);
  });
});
