/**
 * THE RECORD THAT WAS STAMPED, AND THEN WRITTEN TO — the state the product used to
 * lie about, on a disk.
 *
 * WHAT IT LIED. The reading asked the LAST checkpoint and nothing else, so a record
 * holding a valid attestation in its own tree began answering `nothing outside this
 * machine attests this record` the moment somebody appended one more event and sealed
 * it. The proof was still there, still valid, still proving that everything up to that
 * point existed at that instant — and the product had stopped saying so. It is the
 * mirror of the defect the delivery before this one fixed: there it overstated (a
 * request nobody had answered counted as coverage), here it understated.
 *
 * WHY THIS NEEDS A FIXTURE AND NOT A BUILDER, for the reason `witnessed-record.test.ts`
 * gives: reading `covered` means folding a checkpoint's digest through a Merkle path
 * into the merkle root of a block that was really mined, and a test that could build
 * that pair would be a test that had found a SHA-256 preimage. So this record is
 * frozen too — and it is the SAME record as `witnessed-record`, with the two older
 * checkpoints stamped and the head left alone. Nothing was removed to make it: the
 * proofs were asked of the public OpenTimestamps calendars on 2026-08-25 over those
 * two checkpoints' own digests, by this product's own `stampCheckpoint`, and both
 * confirmed in Bitcoin block 963937.
 *
 * SO IT IS A WORLD THE PRODUCT PRODUCES, byte for byte: somebody stamped after two
 * events, stamped again after the third, then wrote a fourth and sealed it. The digest
 * a checkpoint is filed under does not depend on WHEN it was stamped, so the tree here
 * is the tree that person would have.
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';
import { witnessBlocksPath, witnessProofPath } from './layout.js';
import { meetsRequirement } from './level.js';

/** The record as it was frozen — copied per case, never verified in place. */
const FIXTURE = fileURLToPath(new URL('./__fixtures__/witnessed-then-written', import.meta.url));

/** The one tail it holds — the same tail `witnessed-record` holds. */
const TAIL =
  '7e5a72fd0ea237237651690087e4a87133dab8b78847efadde778f633214cca4-05e27e636158e547a09e594545603717';

/** The checkpoint covering seq 0..1, stamped first. */
const OLDER = '797d1de8cd3eb8c8944a7b308f75ef04567de73702bd49742769e749c9770709';

/** The checkpoint covering seq 2..2, stamped second — the NEWEST attested one. */
const NEWER = '19cd79b2bd85360bdcba5a812c48d92c633251aa40de6ceeda5a60402ecd2e73';

/** The block both proofs confirmed in, and the instant its header claims. */
const BLOCK = 963937;
const ATTESTED_AT = '2026-08-25T01:47:34.000Z';

/** What the whole verdict says about this record, in one line, to the byte. */
const THE_CLAUSE =
  `external witness (T3): not covered — the last attested checkpoint is dated by ` +
  `Bitcoin block ${BLOCK} at ${ATTESTED_AT}, with 1 event(s) written after it`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-then-written-'));
  cpSync(FIXTURE, root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The witness clause of the verdict, as a clause and not as a slice of the line. */
const clauseOf = (result: ReturnType<typeof verify>): string | undefined =>
  result.clauses.find((clause) => clause.of === 'witness')?.text;

describe('a record that was dated, and then written to', () => {
  it('says the date, the block, and how many events fall outside it', () => {
    // The delivery's case, end to end, through the verdict a person reads. Asserted
    // as the WHOLE clause, because the three numbers only mean anything together: a
    // date with no boundary claims more than the record holds, and a count with no
    // date is a complaint rather than a fact.
    expect(clauseOf(verify(root, catalogUpcasters()))).toBe(THE_CLAUSE);
  });

  it('does NOT say that nothing attests this record — the sentence that was the defect', () => {
    // Asserted as an ABSENCE. This record holds two valid attestations in its own
    // tree and answered that sentence before this delivery, which is not a wording
    // problem: it is the product being wrong about its own files.
    expect(verify(root, catalogUpcasters()).summary).not.toContain(
      'nothing outside this machine attests this record',
    );
  });

  it('takes the NEWEST attestation, not the oldest one it can find', () => {
    // Both proofs confirmed in the same block, so the date cannot tell them apart —
    // the REACH can. The newer checkpoint covers seq 2, leaving one event after it;
    // the older covers seq 1, leaving two. A reading that walked to the oldest would
    // say two, and would be reporting a smaller prefix than the record can prove.
    expect(clauseOf(verify(root, catalogUpcasters()))).toContain(
      'with 1 event(s) written after it',
    );
    // And it is choosing rather than landing there: with the newer proof gone from
    // this COPY, the reading falls back to the older one and says so.
    rmSync(witnessProofPath({ root }, TAIL, NEWER));
    rmSync(witnessBlocksPath({ root }, TAIL, NEWER));
    expect(clauseOf(verify(root, catalogUpcasters()))).toContain(
      'with 2 event(s) written after it',
    );
  });

  it('is NOT coverage: the level is what the record earns without any witness at all', () => {
    // The mirror of what `pending` got wrong. A record dated to a point is not a
    // record that is covered, so nothing here may reach the top rung — and the level
    // this record has is the one it would have with its witness directory empty.
    const result = verify(root, catalogUpcasters());
    expect(result.witness).toBe('not-covered');
    expect(result.level).toBe('fully-signed');
    expect(meetsRequirement(result.level, 'witnessed')).toBe(false);
    expect(meetsRequirement(result.level, 'signed')).toBe(true);
  });

  it('is a fully proven record underneath — the dating is the only thing missing', () => {
    const result = verify(root, catalogUpcasters());
    expect(result.issues).toEqual([]);
    expect(result.fullySigned).toBe(true);
    expect(result.uncheckpointedEvents).toBe(0);
  });

  it('says the untouched words once its proofs are gone from the copy', () => {
    // The non-regression, from the other direction: the walk may only ever ADD a
    // sentence to a record that holds a proof. Strip both proofs out of this sandbox
    // copy and the record is one nobody stamped, which earns the words every reader
    // of this product has matched on — byte for byte.
    for (const hash of [OLDER, NEWER]) {
      rmSync(witnessProofPath({ root }, TAIL, hash));
      rmSync(witnessBlocksPath({ root }, TAIL, hash));
    }
    expect(clauseOf(verify(root, catalogUpcasters()))).toBe(
      'external witness (T3): not covered — nothing outside this machine attests this record',
    );
  });
});
