/**
 * A DECISION IS THE TEXT ITS FIRST WRITER RECORDED (FORMAT.md section 6.8).
 *
 * A second `decision.recorded` of an accepted decision's id, signed by a key of another identity
 * the writer founded itself, used to replace the decision's title and rationale in every reading,
 * while the decision stayed `accepted` with the note its first text was accepted on, and `verify`
 * passed. The product mints a decision's id when it records it, so it never writes one id twice:
 * every second writing is made past it.
 *
 * Every reading of a decision (`show`, `brief`, `search`, the rules a path is governed by) reads
 * the cache's projection, so the cache is asked here, the way those readings ask it: the decision
 * by its id, the list, and the full-text index. And `verify` names the second writing in its
 * census, informational, its verdict unchanged.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  decisionBirth,
  decisionRecorded,
  decisionTransitioned,
  identityFounded,
  openChainForWriting,
  verify,
} from '@mnema/chain';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectionCache } from './cache.js';

const upcasters = catalogUpcasters();
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

const D = '01a1805f-0000-7000-8000-000000000001';

/** A writes and accepts "Use SQLite"; B, an identity of its own, records the id again. */
function forgedRecord(): string {
  const tree = tmp('mnema-first-writer-');
  const a = openChainForWriting(tree, { keyRoot: tmp('mnema-key-a-') });
  const b = openChainForWriting(tree, { keyRoot: tmp('mnema-key-b-') });
  const env = (writer: typeof a, second: number) => ({
    at: new Date(Date.UTC(2026, 9, 27, 12, 0, second)).toISOString(),
    who: writer.anchor,
    signerFp: writer.signerFingerprint,
    subject: D,
  });
  for (const writer of [a, b]) {
    writer.append(
      identityFounded(
        { ...env(writer, 0), subject: writer.anchor },
        { foundingFp: writer.signerFingerprint },
      ),
    );
  }
  for (const event of decisionBirth(env(a, 1), {
    title: 'Use SQLite',
    rationale: 'Fast and embedded, one file',
    adr: 'ADR-1',
    initial: 'proposed',
  })) {
    a.append(event);
  }
  a.append(
    decisionTransitioned(env(a, 2), {
      from: 'proposed',
      to: 'accepted',
      action: 'accept',
      fields: { note: 'agreed' },
    }),
  );
  b.append(
    decisionRecorded(env(b, 3), {
      title: 'Use MongoDB',
      rationale: 'Schemaless documents',
      adr: 'ADR-1',
    }),
  );
  a.checkpoint();
  b.checkpoint();
  return tree;
}

describe('a decision is the text its first writer recorded', () => {
  it('is what the cache serves by id, in the list, and in the full-text index', () => {
    const tree = forgedRecord();
    const cache = ProjectionCache.open(tree, { upcasters });
    try {
      cache.refresh();
      const decision = cache.getDecision(D);
      expect(decision?.title).toBe('Use SQLite');
      expect(decision?.rationale).toBe('Fast and embedded, one file');
      expect(decision?.state).toBe('accepted');
      expect(cache.listDecisions().map((d) => d.title)).toEqual(['Use SQLite']);
      expect(cache.search({ term: 'MongoDB' }).hits).toEqual([]);
      expect(cache.search({ term: 'SQLite' }).hits.map((hit) => hit.id)).toEqual([D]);
    } finally {
      cache.close();
    }
  });

  it('verify names the second writing in its census, and the verdict holds', () => {
    const tree = forgedRecord();
    const result = verify(tree, upcasters);
    expect(result.ok).toBe(true);
    const named = result.census.filter((note) => note.kind === 'decision-rewrite');
    expect(named).toHaveLength(1);
    expect(named[0]).toMatchObject({ kind: 'decision-rewrite', decision: D, seq: 1 });
  });
});

/**
 * B's tail is OLDER than A's record: B founded its identity before A wrote anything, and A, writing
 * as the product does, cited B's head when it wrote. B then appends a writing of A's decision dated
 * between its founding and A's writing, so the merged order takes it first. `when` says whether
 * B wrote it before A accepted, and whether A had pulled it and so cited it at the accept.
 */
function backdatedRecord(when: 'after-the-accept' | 'seen-by-the-accept' | 'never-judged'): string {
  const tree = tmp('mnema-backdated-');
  const keyA = tmp('mnema-key-a-');
  const keyB = tmp('mnema-key-b-');
  const at = (second: number) =>
    new Date(Date.UTC(2026, 9, 27, 12, 0, 0, second * 1000)).toISOString();
  const b = openChainForWriting(tree, { keyRoot: keyB });
  b.append(
    identityFounded(
      { at: at(0), who: b.anchor, signerFp: b.signerFingerprint, subject: b.anchor },
      { foundingFp: b.signerFingerprint },
    ),
  );
  // A writes as the product does: every append cites the heads of the other tails it read.
  let a = openChainForWriting(tree, { keyRoot: keyA, citeHeads: true });
  const envA = (second: number) => ({
    at: at(second),
    who: a.anchor,
    signerFp: a.signerFingerprint,
    subject: D,
  });
  a.append(
    identityFounded(
      { at: at(0), who: a.anchor, signerFp: a.signerFingerprint, subject: a.anchor },
      { foundingFp: a.signerFingerprint },
    ),
  );
  for (const event of decisionBirth(envA(1), {
    title: 'Use SQLite',
    rationale: 'Fast and embedded, one file',
    adr: 'ADR-1',
    initial: 'proposed',
  })) {
    a.append(event);
  }
  const forge = () =>
    b.append(
      decisionRecorded(
        { at: at(0.5), who: b.anchor, signerFp: b.signerFingerprint, subject: D },
        { title: 'Use MongoDB', rationale: 'Schemaless documents', adr: 'ADR-1' },
      ),
    );
  if (when !== 'after-the-accept') {
    forge();
    // A opens again, as a new session does, and reads the head B moved to.
    a = openChainForWriting(tree, { keyRoot: keyA, citeHeads: true });
  }
  if (when !== 'never-judged') {
    a.append(
      decisionTransitioned(envA(2), {
        from: 'proposed',
        to: 'accepted',
        action: 'accept',
        fields: { note: 'agreed' },
      }),
    );
  }
  if (when === 'after-the-accept') forge();
  a.checkpoint();
  b.checkpoint();
  return tree;
}

/** What the cache serves of D, and the writings `verify` names, by tail and seq. */
function read(tree: string) {
  const cache = ProjectionCache.open(tree, { upcasters });
  try {
    cache.refresh();
    const decision = cache.getDecision(D);
    const result = verify(tree, upcasters);
    const named = result.census.flatMap((note) =>
      note.kind === 'decision-rewrite' ? [{ by: note.by, seq: note.seq }] : [],
    );
    return {
      title: decision?.title,
      state: decision?.state,
      recordedBy: decision?.recordedBy?.who,
      searchMongo: cache.search({ term: 'MongoDB' }).hits.length,
      ok: result.ok,
      named,
    };
  } finally {
    cache.close();
  }
}

describe('a decision is the text its acceptance was made on', () => {
  it('serves the text accepted, and names the writing dated back from an older tail after the accept', () => {
    const tree = backdatedRecord('after-the-accept');
    const said = read(tree);
    const anchors = verify(tree, upcasters).census;
    expect(said).toMatchObject({
      title: 'Use SQLite',
      state: 'accepted',
      searchMongo: 0,
      ok: true,
    });
    expect(said.named).toHaveLength(1);
    // The writing named is the one B signed, never the one the accept was made on.
    expect(said.named[0]?.by).not.toBe(said.recordedBy);
    expect(said.named[0]?.seq).toBe(1);
    expect(
      anchors.some((note) => note.kind === 'decision-rewrite' && note.by === said.recordedBy),
    ).toBe(false);
  });

  it('serves the text the accept was shown, when its writer had read the writing dated back', () => {
    const said = read(backdatedRecord('seen-by-the-accept'));
    expect(said).toMatchObject({ title: 'Use MongoDB', state: 'accepted', ok: true });
    expect(said.named).toHaveLength(1);
    expect(said.named[0]?.by).not.toBe(said.recordedBy);
  });

  it('serves the first writing in the order while no judgment has bound one', () => {
    const said = read(backdatedRecord('never-judged'));
    expect(said).toMatchObject({ title: 'Use MongoDB', state: 'proposed', ok: true });
    expect(said.named).toHaveLength(1);
  });
});

describe('a cache brought forward over the judgment that binds the text', () => {
  it('reads the record again, and serves what a replay serves', () => {
    const tree = tmp('mnema-bound-live-');
    const keyA = tmp('mnema-key-a-');
    const keyB = tmp('mnema-key-b-');
    const at = (second: number) =>
      new Date(Date.UTC(2026, 9, 27, 12, 0, 0, second * 1000)).toISOString();
    const a = openChainForWriting(tree, { keyRoot: keyA });
    const b = openChainForWriting(tree, { keyRoot: keyB });
    for (const writer of [a, b]) {
      writer.append(
        identityFounded(
          {
            at: at(0),
            who: writer.anchor,
            signerFp: writer.signerFingerprint,
            subject: writer.anchor,
          },
          { foundingFp: writer.signerFingerprint },
        ),
      );
    }
    const envA = (second: number) => ({
      at: at(second),
      who: a.anchor,
      signerFp: a.signerFingerprint,
      subject: D,
    });
    for (const event of decisionBirth(envA(1), {
      title: 'Use SQLite',
      rationale: 'Fast and embedded, one file',
      adr: 'ADR-1',
      initial: 'proposed',
    })) {
      a.append(event);
    }
    b.append(
      decisionRecorded(
        { at: at(0.5), who: b.anchor, signerFp: b.signerFingerprint, subject: D },
        { title: 'Use MongoDB', rationale: 'Schemaless documents', adr: 'ADR-1' },
      ),
    );
    const live = ProjectionCache.open(tree, { upcasters, persist: true });
    try {
      live.refresh();
      // Pending: the first writing in the order, which is B's.
      expect(live.getDecision(D)?.title).toBe('Use MongoDB');
    } finally {
      live.close();
    }
    // A accepts on its own tail, citing nothing: what it had read is the writing on its tail.
    a.append(
      decisionTransitioned(envA(2), {
        from: 'proposed',
        to: 'accepted',
        action: 'accept',
        fields: { note: 'agreed' },
      }),
    );
    const again = ProjectionCache.open(tree, { upcasters, persist: true });
    const replay = ProjectionCache.open(tree, { upcasters });
    try {
      again.refresh();
      replay.rebuild();
      expect(again.getDecision(D)?.title).toBe('Use SQLite');
      expect(again.listDecisions()).toEqual(replay.listDecisions());
    } finally {
      again.close();
      replay.close();
    }
  });
});
