/**
 * The canonicalization vectors, and the elo between the code and the file a
 * stranger downloads.
 *
 * THE PREMISE THIS FILE USED TO STATE, AND WHAT FALSIFIED IT. It said the
 * vectors froze "a representative event of every kind", and called itself "the
 * regression floor under the whole proof". It held TEN vectors over NINE kinds
 * of the catalog's TWENTY, and the nine were the nine oldest: every kind the v1
 * added — `memory.captured`, `observation.recorded`, `handoff.recorded`,
 * `knowledge.linked`, the three `skill.*`, `tail.pruned` and the three
 * `channel.*` — had no frozen bytes at all. What falsified it is a count, taken
 * against `LATEST_VERSION`; and what let it drift is that nothing referred to
 * this file, so a kind added to the catalog moved no floor. The table is now a
 * type in `src` (`vectors.ts`) that does not compile until a new kind has a
 * vector, and the count is asserted below rather than described here.
 *
 * WHAT THE VECTORS ARE FOR. The property tests next door prove canonicalization
 * is deterministic, key-sorted and Unicode-normalized. They do NOT pin the ACTUAL
 * bytes: a refactor could change the byte layout while keeping every property
 * intact, and every existing test would stay green — silently breaking the
 * ability of an older clone, or a signed checkpoint, to reproduce the same
 * content root. These digests freeze the exact SHA-256 of the canonical bytes, so
 * a change to the format has to be a deliberate, versioned migration.
 *
 * HOW TO ADD A VECTOR, since the file is written by hand ON PURPOSE. Add the row to
 * `vectors.ts` (a kind with none does not compile), run this file, and paste the
 * digest the failure names into `canonical-vectors.json` along with the event and the
 * two aggregate folds it reports. It is deliberately not a snapshot the runner
 * rewrites: `--update` would silently move a frozen digest, and moving one is the one
 * edit here that has to be a decision somebody made.
 *
 * WHY THE DIGESTS ARE NOT IN THIS FILE. They live in `canonical-vectors.json` —
 * the artifact `FORMAT.md` describes and an outside implementation downloads —
 * and this file recomputes them. That is one list, not two: the file DECLARES the
 * digests and the code COMPUTES them, so a digest edited in the file alone goes
 * red, and a change to canonicalization that moves the bytes goes red on every
 * row. Holding a second copy of the digests here is exactly the shape that
 * produces a published file quietly disagreeing with the code it describes.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  contentRoot,
  ENTRY_DOMAIN,
  entryHash,
  eventBytes,
  ROOT_DOMAIN,
  writtenAsBuilt,
} from '../chain/hash.js';
import { type CanonicalValue, canonicalBytes, canonicalStringify } from './canonical.js';
import { type CatalogEvent, type EventKind, LATEST_VERSION } from './catalog.js';
import { parseEvent, toCanonical, unreadableReason } from './parse.js';
import { catalogUpcasters } from './registry.js';
import { CANONICAL_VECTORS, canonicalVectors, VECTORS_FILE } from './vectors.js';

/** The published artifact's shape, as this test reads it. */
interface Artifact {
  readonly vectorsVersion: number;
  readonly entryDomain: string;
  readonly rootDomain: string;
  readonly vectors: ReadonlyArray<{
    readonly name: string;
    readonly kind: string;
    readonly event: CanonicalValue;
    readonly sha256: string;
  }>;
  readonly chain: {
    readonly tail: string;
    readonly emptyRoot: string;
    readonly entryHashGenesis: { readonly seq: number; readonly entryHash: string };
    readonly entryHashLinked: { readonly seq: number; readonly entryHash: string };
    readonly contentRootOverAllVectors: string;
  };
}

const RAW = readFileSync(VECTORS_FILE, 'utf-8');
const artifact = JSON.parse(RAW) as Artifact;
const published = new Map(artifact.vectors.map((row) => [row.name, row]));

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (event: CatalogEvent): Uint8Array => eventBytes(writtenAsBuilt(event));

const vectors = canonicalVectors();

describe('the vectors cover the catalog, and the type is what keeps them covering it', () => {
  it('freezes at least one event for every kind the catalog declares', () => {
    const kinds = Object.keys(LATEST_VERSION) as readonly EventKind[];
    const uncovered = kinds.filter((kind) => CANONICAL_VECTORS[kind].length === 0);
    expect(uncovered, 'a kind of the catalog with no frozen bytes').toEqual([]);
    // NON-VACUITY: the walk above is over the catalog's own kinds, so a table that
    // lost a kind would read as covered if this file only iterated the table. The
    // count is asserted against the catalog rather than against a number typed here.
    expect(new Set(vectors.map((v) => v.event.kind)).size).toBe(kinds.length);
    expect(kinds.length).toBeGreaterThan(0);
  });

  it('names every vector once, since the name is what joins code to file', () => {
    const names = vectors.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists in the published file exactly the vectors the module holds, in order', () => {
    expect(artifact.vectors.map((row) => row.name)).toEqual(vectors.map((v) => v.name));
    expect(artifact.vectors.map((row) => row.kind)).toEqual(vectors.map((v) => v.event.kind));
  });
});

describe('canonicalization golden vectors — the byte format must not drift silently', () => {
  for (const { name, event } of vectors) {
    it(`${name} hashes to the digest the published file declares`, () => {
      const row = published.get(name);
      if (row === undefined) throw new Error(`no row named "${name}" in the published artifact`);
      // THE ELO, IN BOTH DIRECTIONS: the digest the file declares against the
      // digest the code computes. A digest edited only in the file reddens here,
      // and so does a change to canonicalization that moves the bytes.
      expect(digest(bytesOf(event))).toBe(row.sha256);
      // And the file's own copy of the event, which is what an outside
      // implementation actually hashes: it must be the SAME event, byte for byte
      // after canonicalization, or the file would publish a row whose digest is
      // right about an event this product does not write.
      expect(canonicalStringify(row.event)).toBe(canonicalStringify(toCanonical(event)));
    });

    it(`${name} is an event this product's own reader accepts, unchanged`, () => {
      // A fixture may only hold values the PRODUCT can produce, and the sharpest
      // available check is the product's own: `unreadableReason` runs the very
      // function `parseEvent` runs, so a vector carrying a field no kind declares,
      // a missing required one, or a count of zero is refused here rather than
      // frozen forever.
      expect(unreadableReason(event)).toBeUndefined();
      // Stronger than acceptance: the reader REBUILDS an event from the declared
      // fields alone, so re-canonicalizing what it hands back reproduces the frozen
      // bytes only if the vector has exactly those fields — no extra key riding
      // along, none of the declared ones absent.
      const rebuilt = parseEvent(canonicalStringify(toCanonical(event)), catalogUpcasters());
      expect(canonicalBytes(toCanonical(rebuilt))).toEqual(bytesOf(event));
    });
  }
});

describe('the published artifact says what the code says', () => {
  it('carries exactly the keys an outside consumer reads it for', () => {
    // The artifact is public surface, and three of its keys are read by nothing in
    // this suite — `vectorsVersion`, `describedBy` and `envelope` are for the
    // stranger, not for us. A key renamed or dropped would break every consumer and
    // pass every other case here, so the SHAPE is asserted whole.
    expect(Object.keys(artifact)).toEqual([
      'vectorsVersion',
      'describedBy',
      'entryDomain',
      'rootDomain',
      'envelope',
      'vectors',
      'chain',
    ]);
    expect(Object.keys(artifact.vectors[0] ?? {})).toEqual(['name', 'kind', 'event', 'sha256']);
    expect(Object.keys(artifact.chain)).toEqual([
      'tail',
      'emptyRoot',
      'entryHashGenesis',
      'entryHashLinked',
      'contentRootOverAllVectors',
    ]);
  });

  it('carries the domain tags the code hashes under, never a copy of them', () => {
    expect(artifact.entryDomain).toBe(ENTRY_DOMAIN);
    expect(artifact.rootDomain).toBe(ROOT_DOMAIN);
  });

  it('carries the two framings of an entry hash: genesis and linked', () => {
    const [first, second] = vectors.map((v) => writtenAsBuilt(v.event));
    if (first === undefined || second === undefined) {
      throw new Error('framing a link needs at least two vectors');
    }
    const genesis = entryHash({ event: first, tail: artifact.chain.tail, seq: 0, prev: null });
    expect(genesis).toBe(artifact.chain.entryHashGenesis.entryHash);
    expect(entryHash({ event: second, tail: artifact.chain.tail, seq: 1, prev: genesis })).toBe(
      artifact.chain.entryHashLinked.entryHash,
    );
  });

  it('carries the empty fold, and the fold over every vector in the file’s order', () => {
    expect(contentRoot([])).toBe(artifact.chain.emptyRoot);
    expect(contentRoot(vectors.map((v) => writtenAsBuilt(v.event)))).toBe(
      artifact.chain.contentRootOverAllVectors,
    );
  });

  it('keeps the decomposed spelling a reader has to normalize for itself', () => {
    // The NFC vector is only a test of normalization if the FILE holds the
    // DECOMPOSED form. A reformat that normalized the artifact would leave every
    // digest correct and the vector meaningless, so the raw bytes are asserted:
    // the combining acute is present, and the composed character is absent.
    expect(RAW).toContain('cafe\u0301');
    expect(RAW).not.toContain('caf\u00e9');
  });
});
