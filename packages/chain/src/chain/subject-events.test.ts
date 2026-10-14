/**
 * The events about a subject, found by searching the segments for the bytes that name it.
 *
 * What the search rests on is that every line a reader accepts is canonical, so the envelope's
 * `subject` is written there as exactly the bytes it looks for. The cases hold both halves: a line
 * that merely MENTIONS the id is not among what it returns, and a line that names it in a way the
 * search cannot see — an escape — is a line every reader refuses, so the record it is in reads as
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
import { subjectEvents } from './subject-events.js';

const upcasters = catalogUpcasters();
const RUN = '0a1b2c3d-0000-4000-8000-00000000abcd';

let root: string;
let keyRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-subject-'));
  keyRoot = mkdtempSync(join(tmpdir(), 'mnema-subject-key-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(keyRoot, { recursive: true, force: true });
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

describe('the events about a subject, by the bytes that name it', () => {
  it('finds every event about the subject, in order, and none that only mentions it', () => {
    writeARun();
    const found = subjectEvents({ root }, upcasters, [RUN, 'nobody']);
    expect(found.get(RUN)?.map((event) => event.kind)).toEqual(['run.started', 'run.ended']);
    expect(found.get('nobody')).toEqual([]);
  });

  it('a line that names the subject only by an escape is not found — and no reader accepts it', () => {
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
