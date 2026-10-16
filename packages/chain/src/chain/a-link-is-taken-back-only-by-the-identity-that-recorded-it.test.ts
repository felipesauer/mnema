/**
 * A LINK IS TAKEN BACK BY THE IDENTITY THAT RECORDED IT, and a retraction by any other is
 * named in the census as one that does not apply (FORMAT.md §6.4).
 *
 * The verdict is not what is asked here: the event is intact and signed, so the record
 * verifies either way. What is asked is the census note, which is the only place the product
 * says that a link still stands although someone signed to take it back. Four sides of the
 * rule, because each is a different way for it to be wrong:
 *
 * - the one that recorded the link takes it back: nothing is named;
 * - an identity that recorded no assertion of the edge: named, with who asserted it;
 * - two identities both asserted the edge and one of them takes it back: nothing is named,
 *   because the retractor is one of those who asserted it. Reading the rule as "every
 *   asserter" instead of "any asserter" names it;
 * - two asserted it and a third, who asserted nothing, takes it back: named, with both.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, knowledgeLinked, linkRetracted } from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';
import type { ChainWriter } from './writer.js';

const SUBJECT = '019f81f8-e400-7002-8000-000000000002';
const EDGE = { target: 'src/billing', rel: 'governs' };

let sandbox: string;
let root: string;
let tick = 0;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-link-retraction-'));
  root = join(sandbox, 'tree');
  mkdirSync(root, { recursive: true });
  tick = 0;
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function envelope(writer: ChainWriter, subject: string) {
  tick += 1;
  return {
    at: `2026-10-15T00:00:${String(tick).padStart(2, '0')}.000Z`,
    who: writer.anchor,
    signerFp: writer.signerFingerprint,
    subject,
  };
}

/** A founded identity of its own, writing into the shared tree with a key root of its own. */
function identity(name: string): ChainWriter {
  const writer = openChainForWriting(root, { keyRoot: join(sandbox, name) });
  writer.append(
    identityFounded(envelope(writer, writer.anchor), { foundingFp: writer.signerFingerprint }),
  );
  writer.checkpoint();
  return writer;
}

function link(writer: ChainWriter): void {
  writer.append(knowledgeLinked(envelope(writer, SUBJECT), EDGE));
  writer.checkpoint();
}

function takeBack(writer: ChainWriter): void {
  writer.append(
    linkRetracted(envelope(writer, SUBJECT), { ...EDGE, reason: 'The rule is about the ledger.' }),
  );
  writer.checkpoint();
}

const named = () => verify(root).census.filter((note) => note.kind === 'foreign-link-retraction');

describe('a link is taken back by the identity that recorded it', () => {
  it('names nothing when the identity that recorded the link takes it back', () => {
    const author = identity('author');
    link(author);
    takeBack(author);

    expect(verify(root).ok).toBe(true);
    expect(named()).toEqual([]);
  });

  it('names the retraction of an identity that recorded no assertion of the edge', () => {
    const author = identity('author');
    const stranger = identity('stranger');
    link(author);
    takeBack(stranger);

    expect(verify(root).ok).toBe(true);
    expect(named()).toMatchObject([
      {
        kind: 'foreign-link-retraction',
        link: { subject: SUBJECT, ...EDGE },
        by: stranger.anchor,
        authors: [author.anchor],
      },
    ]);
  });

  it('names nothing when one of two identities that asserted the edge takes it back', () => {
    const first = identity('first');
    const other = identity('other');
    link(first);
    link(other);
    takeBack(other);

    expect(verify(root).ok).toBe(true);
    expect(named()).toEqual([]);
  });

  it('names an identity that asserted nothing when two others did', () => {
    const first = identity('first');
    const other = identity('other');
    const stranger = identity('stranger');
    link(first);
    link(other);
    takeBack(stranger);

    const [note] = named();
    expect(named()).toHaveLength(1);
    expect(note).toMatchObject({ by: stranger.anchor });
    expect(note && 'authors' in note ? [...note.authors].sort() : []).toEqual(
      [first.anchor, other.anchor].sort(),
    );
  });
});
