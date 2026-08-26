/**
 * ONE WALK DOWN A TAIL, for the reading and for the act that completes an attestation.
 *
 * WHAT THIS EXISTS TO CATCH is a defect this product shipped. The reading learned to
 * ask every checkpoint a tail holds; `mnema witness upgrade` went on asking only the
 * last one. Both were correct in isolation and both had cases, and together they made
 * the product contradict itself about one disk in one minute — `verify` reporting that
 * an attestation had been requested and had not confirmed, and the verb whose whole
 * job is to finish such a request reporting that nothing had been asked, and skipping.
 * That is A3 exactly: two readings of one rule, drifting in silence.
 *
 * SO THE RULE HAS ONE SITE, and this reads the source to say so. A behaviour test
 * cannot: two implementations that happen to agree today pass every case, and the day
 * one of them changes there is nothing to go red. What is asserted is that the fact
 * each caller needs — which checkpoints a tail holds a proof for, and in what order a
 * walk down them stops — is derived in exactly one place, and that both callers reach
 * it through that place.
 *
 * IT IS ALSO THE ELO (A2): `witnessWalk` crosses the package line, and a public export
 * with no production caller is the shape four defects of this series took. The last
 * case names the caller.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** A source file of the product, read whole. */
function source(relative: string): string {
  const text = readFileSync(
    fileURLToPath(new URL(`../../../${relative}`, import.meta.url)),
    'utf-8',
  );
  // A guard that counts occurrences in an empty string counts zero and says nothing,
  // which is how a structural test goes vacuous without anybody noticing.
  expect(text.length, relative).toBeGreaterThan(1000);
  return text;
}

/** How many times a name appears — declaration and calls alike. */
function mentions(text: string, name: string): number {
  return text.split(name).length - 1;
}

const WITNESS = 'packages/chain/src/chain/witness.ts';
const ACTS = 'packages/code/src/commands/witness.ts';

describe('the checkpoints a tail holds a proof for are enumerated once', () => {
  it('lists the witness directory in ONE place, and it is the walk', () => {
    const text = source(WITNESS);
    // The directory read is the only thing that knows which checkpoints were ever
    // stamped. A second one is a second answer to that question.
    expect(mentions(text, 'readdirSync(')).toBe(1);
    // Declared once, called once — and the call is inside the walk.
    expect(mentions(text, 'stampedCheckpoints(')).toBe(2);
    const walk = bodyOf(text, 'export function* witnessWalk(');
    expect(walk).toContain('stampedCheckpoints(layout, tailId)');
  });

  it('derives the tail’s checkpoint list ONCE for the listing and the act', () => {
    const text = source(ACTS);
    // `mnema witness` and `mnema witness upgrade` are the two verbs a person alternates
    // between. A listing that showed a request the act did not walk to would be the same
    // contradiction, one list over — so the list has one derivation.
    expect(mentions(text, 'readTailCheckpoints(')).toBe(1);
    // And both verbs reach it through that one derivation.
    expect(bodyOf(text, 'export function runWitnessList(')).toContain('storedCheckpoints(chain)');
    expect(bodyOf(text, 'async function upgradeTail(')).toContain('storedCheckpoints(chain)');
  });
});

describe('both callers walk the tail through that one function', () => {
  it('is the only traversal in the reading', () => {
    const body = bodyOf(source(WITNESS), 'export function witnessOfTail(');
    expect(body).toContain('witnessWalk(layout, tailId, tail.checkpoints)');
    // No second loop over the offered checkpoints: the walk decides the order and where
    // it stops, and a `for` here would be a reading of that rule beside the walk's own.
    expect(body).not.toContain('for (let ');
  });

  it('is the only traversal in the act', () => {
    const text = source(ACTS);
    const body = bodyOf(text, 'async function upgradeTail(');
    expect(body).toContain('witnessWalk(chain.layout, chain.tail, checkpoints)');
    expect(body).not.toContain('for (let ');
    // And the act does not go back to the head-only derivation the defect came from.
    expect(bodyOf(text, 'export async function runWitnessUpgrade(')).not.toContain(
      'checkpointToWitness(',
    );
    // `stamp` still does, and should: it is the act that files something NEW.
    expect(bodyOf(text, 'export async function runWitnessStamp(')).toContain(
      'checkpointToWitness(',
    );
  });

  it('crosses the package line with a caller on the other side', () => {
    // A2. The export exists because `@mnema/code` calls it; without that it is a
    // contract with nobody on the far end.
    expect(source('packages/chain/src/index.ts')).toContain('witnessWalk,');
    expect(source(ACTS)).toContain('witnessWalk,');
  });
});

/**
 * One function's body, from its signature to the line that closes it at column zero.
 *
 * Crude on purpose: these files declare every top-level function at column zero and end
 * each with a `}` there, so the brace is unambiguous. It fails loudly rather than
 * returning an empty string, because a body-reader that quietly finds nothing turns
 * every assertion below it into a claim about the empty string.
 */
function bodyOf(text: string, signature: string): string {
  const from = text.indexOf(signature);
  expect(from, signature).toBeGreaterThan(-1);
  const end = text.indexOf('\n}\n', from);
  expect(end, signature).toBeGreaterThan(from);
  const body = text.slice(from, end);
  expect(body.length, signature).toBeGreaterThan(200);
  return body;
}
