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
