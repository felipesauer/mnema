/**
 * The events about a subject, found by searching the segments for the bytes that name it.
 *
 * What the search rests on is that every line a reader accepts is canonical, so the envelope's
 * `subject` is written there as exactly the bytes it looks for. The cases hold both halves: a line
 * that merely MENTIONS the id is not among what it returns, and a line that names it in a way the
 * search cannot see, an escape, is a line every reader refuses, so the record it is in reads as
 * broken whatever the search returns. The order across tails is held against the replay in
 * `packages/core/src/projections/many-tails.properties.test.ts`.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { memoryCaptured, runEnded, runStarted } from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting } from './chain.js';
import { tailDir } from './layout.js';
import { UnreadableLineError } from './lines.js';
import { readTailEntries } from './store.js';
import { subjectEvents, writtenAsItself } from './subject-events.js';

const upcasters = catalogUpcasters();
const RUN = '0a1b2c3d-0000-4000-8000-00000000abcd';

let root: string;
let keyRoot: string;
const machineKeys: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-subject-'));
  keyRoot = mkdtempSync(join(tmpdir(), 'mnema-subject-key-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(keyRoot, { recursive: true, force: true });
  for (const dir of machineKeys.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeARun(): string {
  const writer = openChainForWriting(root, { keyRoot });
  const env = (subject: string, at: string, run?: string) => ({
    at,
    who: writer.anchor,
    signerFp: writer.signerFingerprint,
    subject,
    ...(run !== undefined ? { run } : {}),
  });
  writer.append(runStarted(env(RUN, '2026-10-01T00:00:01.000Z'), { agent: 'claude' }));
  // Names the run twice without being about it: pinned to it, and in its text.
  writer.append(
    memoryCaptured(env('note-1', '2026-10-01T00:00:02.000Z', RUN), {
      content: `"subject":"${RUN}" is how the run is named`,
    }),
  );
  writer.append(runEnded(env(RUN, '2026-10-01T00:00:03.000Z'), {}));
  return writer.tail;
}

/** A writer of its own tail, with a key of its own, that says each event by its instant. */
function machine(options: { citeHeads?: boolean } = {}) {
  const machineKey = mkdtempSync(join(tmpdir(), 'mnema-subject-machine-'));
  machineKeys.push(machineKey);
  const writer = openChainForWriting(root, {
    keyRoot: machineKey,
    maxUnsignedEvents: 10_000,
    ...options,
  });
  return {
    tail: writer.tail,
    say: (subject: string, at: string) =>
      writer.append(
        memoryCaptured(
          { at, who: writer.anchor, signerFp: writer.signerFingerprint, subject },
          { content: at },
        ),
      ),
  };
}

/** The one segment of a tail. */
function segmentOf(tail: string): string {
  const dir = tailDir({ root }, tail);
  return join(dir, readdirSync(dir).find((name) => name.endsWith('.jsonl')) as string);
}

const T = (n: number) => `2026-10-01T00:00:0${n}.000Z`;

describe('the events about a subject on more than one tail', () => {
  it('are in the order of the merge, not tail by tail', () => {
    const a = machine();
    const b = machine();
    // Either tail alone, then the other, would read 1 3 2 or 2 1 3, never 1 2 3.
    a.say(RUN, T(1));
    b.say(RUN, T(2));
    a.say(RUN, T(3));
    b.say('someone-else', T(0));

    const found = subjectEvents({ root }, upcasters, [RUN]).get(RUN);
    expect(found?.map((event) => event.at)).toEqual([T(1), T(2), T(3)]);
  });

  it('hold back a head that cites a tail not yet taken, as the merge does', () => {
    const a = machine();
    const b = machine({ citeHeads: true });
    a.say(RUN, T(5));
    // Written after a's head is read: it cites it, and so comes after it despite its instant.
    const cites = b.say(RUN, T(1));
    expect(cites.event.after).toHaveLength(1);

    const found = subjectEvents({ root }, upcasters, [RUN]).get(RUN);
    expect(found?.map((event) => event.at)).toEqual([T(5), T(1)]);
  });

  it('are in the order of the merge when a tail ends without its newline', () => {
    const a = machine();
    const b = machine();
    a.say(RUN, T(1));
    b.say(RUN, T(2));
    a.say(RUN, T(3));
    // A complete last line with no newline after it: read by parsing, not by its bytes.
    for (const tail of [a.tail, b.tail]) {
      const file = segmentOf(tail);
      writeFileSync(file, readFileSync(file, 'utf8').replace(/\n$/, ''));
    }

    const found = subjectEvents({ root }, upcasters, [RUN]).get(RUN);
    expect(found?.map((event) => event.at)).toEqual([T(1), T(2), T(3)]);
  });

  it('drop a torn last line, and order an id written otherwise by the merge', () => {
    const quoted = 'say "hi"';
    const a = machine();
    const b = machine();
    a.say(quoted, T(1));
    b.say(quoted, T(2));
    a.say(quoted, T(3));
    b.say(quoted, T(4));
    const file = segmentOf(b.tail);
    const text = readFileSync(file, 'utf8');
    // The last line cut short: a tail whose writer died in the middle of it.
    writeFileSync(file, text.slice(0, text.length - 40));

    const found = subjectEvents({ root }, upcasters, [quoted, RUN]);
    expect(found.get(quoted)?.map((event) => event.at)).toEqual([T(1), T(2), T(3)]);
    expect(found.get(RUN)).toEqual([]);
  });
});

describe('the events about a subject, by the bytes that name it', () => {
  it('finds every event about the subject, in order, and none that only mentions it', () => {
    writeARun();
    const found = subjectEvents({ root }, upcasters, [RUN, 'nobody']);
    expect(found.get(RUN)?.map((event) => event.kind)).toEqual(['run.started', 'run.ended']);
    expect(found.get('nobody')).toEqual([]);
  });

  it('a line that names the subject only by an escape is not found, and no reader accepts it', () => {
    const tail = writeARun();
    const dir = tailDir({ root }, tail);
    const segment = join(dir, readdirSync(dir).find((name) => name.endsWith('.jsonl')) as string);
    const lines = readFileSync(segment, 'utf8').split('\n');
    const last = lines.length - 2;
    // The same value, its first letter written as an escape: the bytes the search looks for are
    // gone, and the line is no longer the canonical serialization of what it holds.
    lines[last] = (lines[last] as string).replace(
      `"subject":"${RUN}"`,
      `"subject":"\\u0030${RUN.slice(1)}"`,
    );
    writeFileSync(segment, lines.join('\n'));

    expect(
      subjectEvents({ root }, upcasters, [RUN])
        .get(RUN)
        ?.map((e) => e.kind),
    ).toEqual(['run.started']);
    expect(() => readTailEntries({ root }, tail, upcasters)).toThrow(UnreadableLineError);
  });

  it('searches by bytes only an id the canonical form writes as itself', () => {
    // A minted id (UUIDv7, lower-case hex and dashes) and an anchor (hex) are written as
    // themselves; a quote, a backslash, a control character or a letter outside ASCII is not.
    expect(writtenAsItself(RUN)).toBe(true);
    expect(writtenAsItself('9a9b7666de4e5646bab858882ff59165')).toBe(true);
    for (const other of ['', 'say "hi"', 'a\\b', 'line\nbreak', 'ação', 'a b']) {
      expect(writtenAsItself(other)).toBe(false);
    }
  });

  it('an id written otherwise than as itself is still found, by reading every line', () => {
    // The canonical form writes these with an escape, or composed: a search for the id's own
    // bytes would not see them, so they are not searched for.
    const quoted = 'say "hi"';
    const accented = 'ação';
    const writer = openChainForWriting(root, { keyRoot });
    const env = (subject: string, at: string) => ({
      at,
      who: writer.anchor,
      signerFp: writer.signerFingerprint,
      subject,
    });
    writer.append(memoryCaptured(env(quoted, '2026-10-01T00:00:01.000Z'), { content: 'one' }));
    writer.append(memoryCaptured(env(accented, '2026-10-01T00:00:02.000Z'), { content: 'two' }));
    writer.append(memoryCaptured(env(quoted, '2026-10-01T00:00:03.000Z'), { content: 'three' }));

    const found = subjectEvents({ root }, upcasters, [quoted, accented, RUN]);
    expect(found.get(quoted)?.map((e) => e.at)).toEqual([
      '2026-10-01T00:00:01.000Z',
      '2026-10-01T00:00:03.000Z',
    ]);
    expect(found.get(accented)?.map((e) => e.at)).toEqual(['2026-10-01T00:00:02.000Z']);
    expect(found.get(RUN)).toEqual([]);
  });

  it('an id is the same subject only as the same string: another case is another subject', () => {
    // Every fold keys a subject by the exact string; so does this, or a line the fold reads
    // would be one this does not, or the other way round.
    writeARun();
    const upper = RUN.toUpperCase();
    const found = subjectEvents({ root }, upcasters, [upper, RUN]);
    expect(found.get(upper)).toEqual([]);
    expect(found.get(RUN)?.map((e) => e.kind)).toEqual(['run.started', 'run.ended']);
  });

  it('a line it finds in another Unicode composition is refused, as every reader refuses it', () => {
    // Valid JSON holding the same value: what a lenient parse would accept. It is not the
    // canonical serialization of that value, so `parseCanonicalLine` refuses it.
    const writer = openChainForWriting(root, { keyRoot });
    writer.append(
      memoryCaptured(
        {
          at: '2026-10-01T00:00:01.000Z',
          who: writer.anchor,
          signerFp: writer.signerFingerprint,
          subject: RUN,
        },
        { content: 'café' },
      ),
    );
    const dir = tailDir({ root }, writer.tail);
    const segment = join(dir, readdirSync(dir).find((name) => name.endsWith('.jsonl')) as string);
    writeFileSync(segment, readFileSync(segment, 'utf8').replace('café', 'café'.normalize('NFD')));

    expect(() => subjectEvents({ root }, upcasters, [RUN])).toThrow(UnreadableLineError);
    expect(() => readTailEntries({ root }, writer.tail, upcasters)).toThrow(UnreadableLineError);
  });

  it('a line it finds that does not parse is refused, as a replay refuses it', () => {
    const tail = writeARun();
    const dir = tailDir({ root }, tail);
    const segment = join(dir, readdirSync(dir).find((name) => name.endsWith('.jsonl')) as string);
    const lines = readFileSync(segment, 'utf8').split('\n');
    lines[0] = (lines[0] as string).replace('"agent":"claude"', '"agent": "claude"');
    writeFileSync(segment, lines.join('\n'));

    expect(() => subjectEvents({ root }, upcasters, [RUN])).toThrow(UnreadableLineError);
    expect(() => readTailEntries({ root }, tail, upcasters)).toThrow(UnreadableLineError);
  });
});
