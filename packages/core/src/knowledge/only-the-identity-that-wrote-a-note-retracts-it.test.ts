/**
 * ONLY THE IDENTITY THAT WROTE A NOTE RETRACTS IT.
 *
 * A retraction used to be a fact any writer of the tree could append, about any note in it:
 * a second identity took back the first one's memory, `verify` passed, and the search stopped
 * finding the note. The rule now is one comparison, the retraction's `who` against the note's
 * `who`, asked from three sides:
 *   - the write refuses an identity that did not write the note, and says whose it is;
 *   - the read does not apply a retraction by another identity, so the note is still served;
 *   - `verify` reports such a retraction in its census, informational, exit untouched.
 * Identity is the anchor, not the key: another key of the same identity retracts.
 *
 * Three machines over one shared tree: one founds an identity, a second key is enrolled into
 * that same identity, and a third is a different identity.
 */

import { createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  enrollmentMessage,
  loadOrCreateKeyPair,
  materializePublicKey,
  memoryCaptured,
  noteRetracted,
  openChainForWriting,
  sign,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectionCache } from '../projections/cache.js';
import { orderedEvents } from '../projections/order.js';
import { appendEvent } from '../workflow/append.js';
import { enrollKey, ensureFounded } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { captureMemory, retractNote } from './operations.js';

const upcasters = catalogUpcasters();

let tree: string;
let scratch: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A writer over the shared tree for the key at a fresh key root. */
function machine(prefix: string, keyRoot = tmp(prefix)): WriteContext & { keyRoot: string } {
  // A machine that has its key: a first key is kept only at a first append.
  loadOrCreateKeyPair({ root: keyRoot });
  const writer = openChainForWriting(tree, { keyRoot });
  return { writer, layout: { root: tree }, upcasters, keyRoot };
}

/** `b` joins `a`'s identity: its consent, `a`'s vouch, and its public half committed. */
function enrolInto(a: WriteContext, b: WriteContext & { keyRoot: string }): void {
  const anchor = ensureFounded(a);
  const fp = b.writer.signerFingerprint;
  const keys = join(b.keyRoot, 'keys');
  materializePublicKey(
    { root: tree },
    {
      publicKey: createPublicKey(readFileSync(join(keys, `${fp}.pub`), 'utf-8')),
      fingerprint: fp,
    },
  );
  const privateKey = createPrivateKey(readFileSync(join(keys, `${fp}.key`), 'utf-8'));
  const enrolled = enrollKey(a, {
    newFp: fp,
    reverseSig: Buffer.from(sign(enrollmentMessage(anchor, fp), privateKey)).toString('hex'),
  });
  if (!enrolled.ok) throw new Error('the enrolment was refused');
}

function memory(ctx: WriteContext, content: string): string {
  const captured = captureMemory(ctx, { content });
  if (!captured.ok) throw new Error(captured.message);
  return captured.id;
}

/** What a replay serves, and what a cache brought forward over the same events serves. */
function served(open: ProjectionCache, id: string) {
  return {
    searched: open.search({ term: 'relational' }).hits.map((hit) => hit.id),
    listed: open.listMemories().map((m) => m.id),
    retracted: open.getMemory(id)?.retracted,
  };
}

beforeEach(() => {
  scratch = [];
  tree = tmp('mnema-only-the-author-');
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('only the identity that wrote a note retracts it', () => {
  it('refuses another identity at the write, says whose the note is, and appends nothing', () => {
    const a = machine('mnema-author-a-');
    const b = machine('mnema-author-b-');
    const taken = memory(a, 'The cache is SQLite because the load is relational.');
    const author = ensureFounded(a);
    ensureFounded(b);
    const before = orderedEvents({ root: tree }, upcasters).length;

    const refused = retractNote(b, { id: taken, reason: 'It was a key lookup.' });

    expect(refused).toMatchObject({ ok: false, code: 'NOT_THE_AUTHOR' });
    expect(refused.ok ? '' : refused.message).toContain(author);
    expect(orderedEvents({ root: tree }, upcasters)).toHaveLength(before);
  });

  it('does not apply a retraction another identity signed, and verify says so in its census', () => {
    const a = machine('mnema-author-a-');
    const b = machine('mnema-author-b-');
    const taken = memory(a, 'The cache is SQLite because the load is relational.');
    a.writer.checkpoint();
    const cache = ProjectionCache.open(tree);
    cache.rebuild();

    // Written by hand, past the operation's refusal: a well-formed, signed event by B.
    const stranger = ensureFounded(b);
    const appended = appendEvent(
      b.writer,
      noteRetracted(
        {
          at: new Date().toISOString(),
          who: stranger,
          signerFp: b.writer.signerFingerprint,
          subject: taken,
        },
        { reason: 'It was a key lookup.' },
      ),
    );
    expect(appended.ok).toBe(true);
    b.writer.checkpoint();

    try {
      // The cache that was open brings itself forward, and a fresh one replays: both serve it.
      cache.refresh();
      expect(served(cache, taken)).toEqual({
        searched: [taken],
        listed: [taken],
        retracted: undefined,
      });
      const replayed = ProjectionCache.open(tree);
      try {
        replayed.rebuild();
        expect(served(replayed, taken)).toEqual({
          searched: [taken],
          listed: [taken],
          retracted: undefined,
        });
      } finally {
        replayed.close();
      }
    } finally {
      cache.close();
    }

    const verdict = verify(tree, upcasters);
    expect(verdict.ok).toBe(true);
    expect(verdict.census.map((note) => note.kind)).toEqual(['foreign-retraction']);
    expect(verdict.census[0]).toMatchObject({
      note: taken,
      by: stranger,
      author: ensureFounded(a),
    });
    expect(verdict.summary).toContain('not applied');

    // And the stranger's fact does not stand in the author's way.
    expect(retractNote(a, { id: taken, reason: 'It was a key lookup.' }).ok).toBe(true);
  });

  it('applies a retraction by another key of the same identity', () => {
    const a = machine('mnema-author-a-');
    const a2 = machine('mnema-author-a2-');
    const taken = memory(a, 'The cache is SQLite because the load is relational.');
    enrolInto(a, a2);

    expect(retractNote(a2, { id: taken, reason: 'It was a key lookup.' }).ok).toBe(true);
    a2.writer.checkpoint();

    const replayed = ProjectionCache.open(tree);
    try {
      replayed.rebuild();
      const now = served(replayed, taken);
      expect(now.searched).toEqual([]);
      expect(now.listed).toEqual([]);
      expect(now.retracted?.who).toBe(ensureFounded(a));
    } finally {
      replayed.close();
    }
    const verdict = verify(tree, upcasters);
    expect(verdict.ok).toBe(true);
    expect(verdict.census.filter((note) => note.kind === 'foreign-retraction')).toEqual([]);
  });
});

/**
 * A NOTE IS THE IDENTITY THAT FIRST WROTE IT. Its id is minted at the capture, so the product
 * never writes one id twice; a second writing of it is written by hand, past every operation.
 * The read used to take the LAST writing in the merged order, so a second identity that wrote
 * the same id with a later `at` became its author, its content was served, and its retraction
 * took the note out; `verify` read the author off the last writing in TAIL order, so it either
 * said nothing or said the retraction was not applied while the read applied it. Every reader
 * now takes the first writing in the merged order, and both arrangements of the two tails are
 * asked, since the order of their ids is what the census used to depend on.
 */
describe('a note is the identity that first wrote it', () => {
  const at = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

  for (const creatorTail of ['first', 'last'] as const) {
    it(`serves the creator's note when another identity writes its id again and retracts it (the creator's tail sorts ${creatorTail})`, () => {
      const one = machine('mnema-writer-one-');
      const two = machine('mnema-writer-two-');
      const oneFirst = one.writer.tail < two.writer.tail;
      const [creator, intruder] = (creatorTail === 'first') === oneFirst ? [one, two] : [two, one];
      const taken = memory(creator, 'The cache is SQLite because the load is relational.');
      const author = ensureFounded(creator);
      const stranger = ensureFounded(intruder);
      creator.writer.checkpoint();
      intruder.writer.checkpoint();
      const cache = ProjectionCache.open(tree);
      cache.rebuild();

      // Written by hand, past the operations: well-formed, signed events by the intruder.
      const envelope = (seconds: number) => ({
        at: at(seconds),
        who: stranger,
        signerFp: intruder.writer.signerFingerprint,
        subject: taken,
      });
      const rewrite = memoryCaptured(envelope(60), {
        content: 'The cache is a flat file, written by hand.',
      });
      expect(appendEvent(intruder.writer, rewrite).ok).toBe(true);
      const retraction = noteRetracted(envelope(120), { reason: 'Mine now.' });
      expect(appendEvent(intruder.writer, retraction).ok).toBe(true);
      intruder.writer.checkpoint();

      const theCreators = {
        content: 'The cache is SQLite because the load is relational.',
        who: author,
      };
      try {
        // The cache that was open brings itself forward, and a fresh one replays: both agree.
        cache.refresh();
        expect(cache.getMemory(taken)).toMatchObject(theCreators);
        expect(cache.getMemory(taken)?.retracted).toBeUndefined();
        expect(served(cache, taken)).toMatchObject({ searched: [taken], listed: [taken] });
        const replayed = ProjectionCache.open(tree);
        try {
          replayed.rebuild();
          expect(replayed.getMemory(taken)).toMatchObject(theCreators);
          expect(replayed.getMemory(taken)?.retracted).toBeUndefined();
          expect(served(replayed, taken)).toMatchObject({ searched: [taken], listed: [taken] });
        } finally {
          replayed.close();
        }
      } finally {
        cache.close();
      }

      const verdict = verify(tree, upcasters);
      expect(verdict.ok).toBe(true);
      expect(verdict.census.map((note) => note.kind).sort()).toEqual([
        'foreign-retraction',
        'foreign-rewrite',
      ]);
      for (const note of verdict.census) {
        expect(note).toMatchObject({ note: taken, by: stranger, author });
      }

      // The write asks the same rule: the intruder is refused, the creator retracts.
      expect(retractNote(intruder, { id: taken, reason: 'Mine now.' })).toMatchObject({
        ok: false,
        code: 'NOT_THE_AUTHOR',
      });
      expect(retractNote(creator, { id: taken, reason: 'It was a key lookup.' }).ok).toBe(true);
    });
  }

  it('serves the later writing when the same identity writes its note again, and lets it retract', () => {
    const a = machine('mnema-author-a-');
    const taken = memory(a, 'The cache is SQLite because the load is relational.');
    const author = ensureFounded(a);
    const cache = ProjectionCache.open(tree);
    cache.rebuild();
    const again = memoryCaptured(
      { at: at(60), who: author, signerFp: a.writer.signerFingerprint, subject: taken },
      { content: 'The cache is SQLite because the load is relational and small.' },
    );
    expect(appendEvent(a.writer, again).ok).toBe(true);
    expect(retractNote(a, { id: taken, reason: 'It was a key lookup.' }).ok).toBe(true);
    a.writer.checkpoint();

    try {
      cache.refresh();
      const replayed = ProjectionCache.open(tree);
      try {
        replayed.rebuild();
        for (const open of [cache, replayed]) {
          const note = open.getMemory(taken);
          expect(note?.content).toBe(
            'The cache is SQLite because the load is relational and small.',
          );
          expect(note?.retracted?.who).toBe(author);
        }
      } finally {
        replayed.close();
      }
    } finally {
      cache.close();
    }
    const verdict = verify(tree, upcasters);
    expect(verdict.ok).toBe(true);
    expect(verdict.census).toEqual([]);
  });
});
