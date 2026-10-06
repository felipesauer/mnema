/**
 * ONLY THE IDENTITY THAT RECORDED A LINK RETRACTS IT.
 *
 * A link was a fact nobody could take back: the record only grows, and a `governs` recorded on
 * the wrong path went on refusing edits there. A `link.retracted` now withdraws its identity's
 * assertion of the edge it names — the note's retraction, for an edge — under one comparison,
 * the retraction's `who` against the link's `who`, asked from three sides:
 *   - the write refuses an identity that did not record the link, and says whose it is;
 *   - the read does not apply a retraction by another identity, so the edge still stands;
 *   - `verify` reports such a retraction in its census, informational, exit untouched.
 * Identity is the anchor, not the key: another key of the same identity retracts. And the
 * read is the same whether a cache replays the record or is brought forward over it.
 */

import { createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  enrollmentMessage,
  linkRetracted,
  materializePublicKey,
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
import { linkKnowledge, retractLink } from './operations.js';

const upcasters = catalogUpcasters();
const RULE = '019f81f8-e400-7002-8000-000000000002';
const EDGE = { subject: RULE, target: 'src/billing', rel: 'governs' } as const;
const WHY = 'The rule is about the ledger, not billing.';

let tree: string;
let scratch: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A writer over the shared tree for the key at a fresh key root. */
function machine(prefix: string, keyRoot = tmp(prefix)): WriteContext & { keyRoot: string } {
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

function link(ctx: WriteContext): void {
  const linked = linkKnowledge(ctx, EDGE);
  if (!linked.ok) throw new Error(linked.message);
  ctx.writer.checkpoint();
}

/** The `governs` edges a cache serves, as (who) of each — what every reader of rules reads. */
function governing(cache: ProjectionCache): string[] {
  return cache.linksByRelation('governs').map((edge) => edge.who);
}

/** What a cache brought forward over the arrivals serves, and what a fresh replay serves. */
function bothServe(open: ProjectionCache): { forward: string[]; replayed: string[] } {
  open.refresh();
  const replayed = ProjectionCache.open(tree);
  try {
    replayed.rebuild();
    return { forward: governing(open), replayed: governing(replayed) };
  } finally {
    replayed.close();
  }
}

beforeEach(() => {
  scratch = [];
  tree = tmp('mnema-only-the-linker-');
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('only the identity that recorded a link retracts it', () => {
  it('the author retracts it, the edge stops standing, and a second retraction is refused', () => {
    const a = machine('mnema-linker-a-');
    link(a);
    const author = ensureFounded(a);
    const cache = ProjectionCache.open(tree);
    try {
      cache.rebuild();
      expect(governing(cache)).toEqual([author]);

      expect(retractLink(a, { ...EDGE, reason: WHY })).toMatchObject({ ok: true, ...EDGE });
      a.writer.checkpoint();
      expect(bothServe(cache)).toEqual({ forward: [], replayed: [] });

      const before = orderedEvents({ root: tree }, upcasters).length;
      expect(retractLink(a, { ...EDGE, reason: WHY })).toMatchObject({
        ok: false,
        code: 'ALREADY_RETRACTED',
      });
      expect(orderedEvents({ root: tree }, upcasters)).toHaveLength(before);

      // Recorded again after the retraction, the edge stands again.
      link(a);
      expect(bothServe(cache)).toEqual({ forward: [author], replayed: [author] });
    } finally {
      cache.close();
    }
    const verdict = verify(tree, upcasters);
    expect(verdict.ok).toBe(true);
    expect(verdict.census.filter((note) => note.kind === 'foreign-link-retraction')).toEqual([]);
  });

  it('refuses another identity at the write, says whose the link is, and appends nothing', () => {
    const a = machine('mnema-linker-a-');
    const b = machine('mnema-linker-b-');
    link(a);
    const author = ensureFounded(a);
    ensureFounded(b);
    const before = orderedEvents({ root: tree }, upcasters).length;

    const refused = retractLink(b, { ...EDGE, reason: WHY });
    expect(refused).toMatchObject({ ok: false, code: 'NOT_THE_AUTHOR' });
    expect(refused.ok ? '' : refused.message).toContain(author);

    const unknown = retractLink(a, { ...EDGE, rel: 'relates-to', reason: WHY });
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_LINK' });
    expect(orderedEvents({ root: tree }, upcasters)).toHaveLength(before);
  });

  it('does not apply a retraction another identity signed, and verify names it in its census', () => {
    const a = machine('mnema-linker-a-');
    const b = machine('mnema-linker-b-');
    link(a);
    const author = ensureFounded(a);
    const cache = ProjectionCache.open(tree);
    cache.rebuild();

    // Written by hand, past the operation's refusal: a well-formed, signed event by B.
    const stranger = ensureFounded(b);
    const appended = appendEvent(
      b.writer,
      linkRetracted(
        {
          at: new Date().toISOString(),
          who: stranger,
          signerFp: b.writer.signerFingerprint,
          subject: EDGE.subject,
        },
        { target: EDGE.target, rel: EDGE.rel, reason: WHY },
      ),
    );
    expect(appended.ok).toBe(true);
    b.writer.checkpoint();

    try {
      expect(bothServe(cache)).toEqual({ forward: [author], replayed: [author] });
    } finally {
      cache.close();
    }

    const verdict = verify(tree, upcasters);
    expect(verdict.ok).toBe(true);
    expect(verdict.census.map((note) => note.kind)).toEqual(['foreign-link-retraction']);
    expect(verdict.census[0]).toMatchObject({ link: EDGE, by: stranger, authors: [author] });
    expect(verdict.summary).toContain('not applied');

    // And the stranger's fact does not stand in the author's way.
    expect(retractLink(a, { ...EDGE, reason: WHY }).ok).toBe(true);
  });

  it('applies a retraction by another key of the same identity', () => {
    const a = machine('mnema-linker-a-');
    const a2 = machine('mnema-linker-a2-');
    link(a);
    enrolInto(a, a2);
    const cache = ProjectionCache.open(tree);
    try {
      cache.rebuild();
      expect(retractLink(a2, { ...EDGE, reason: WHY }).ok).toBe(true);
      a2.writer.checkpoint();
      expect(bothServe(cache)).toEqual({ forward: [], replayed: [] });
    } finally {
      cache.close();
    }
  });

  it('withdraws only its own identity’s assertion: an edge another identity also records stands', () => {
    const a = machine('mnema-linker-a-');
    const b = machine('mnema-linker-b-');
    link(a);
    link(b);
    const other = ensureFounded(b);
    const cache = ProjectionCache.open(tree);
    try {
      cache.rebuild();
      expect(retractLink(a, { ...EDGE, reason: WHY }).ok).toBe(true);
      a.writer.checkpoint();
      // The edge stands, and its origin is now the assertion that is left.
      expect(bothServe(cache)).toEqual({ forward: [other], replayed: [other] });
    } finally {
      cache.close();
    }
  });
});
