/**
 * THE TOP RUNG, REACHED BY A REAL RECORD — the case that was impossible to write
 * until this delivery, and impossible to FABRICATE at any point.
 *
 * WHY IT NEEDS A FIXTURE AND NOT A BUILDER. Every other case in this package builds
 * its chain in a `beforeEach`. This one cannot, and the reason is the whole security
 * of the layer: to read `covered`, an attestation has to fold a checkpoint's digest
 * through a Merkle path into the merkle root of a block that was really mined. A test
 * that could construct that pair for a checkpoint it had just signed would be a test
 * that had found a SHA-256 preimage. So the record is frozen instead — founded by
 * this product's own CLI, stamped through the public OpenTimestamps calendars on
 * 2026-08-23, and confirmed in Bitcoin block 963690 the same morning.
 *
 * WHAT A STRANGER CAN CHECK, WITHOUT THIS PRODUCT. The `.ots` in the fixture is the
 * ecosystem's own file: `ots verify` against a Bitcoin node answers the same question
 * this file asks, from the same bytes. The `.blocks` sidecar beside it is what lets
 * the answer be reached OFFLINE — the 80-byte headers, which hash to block ids any
 * explorer will confirm.
 *
 * IT IS FROZEN, so it never needs the network again and it never expires: a block
 * mined in the past stays mined. What it cannot do is grow — a record this test
 * appended to would have a new last checkpoint, which nothing has attested. That is
 * not a limitation of the fixture, it is the layer working: an attestation dates the
 * checkpoints below it and says nothing about what comes after.
 *
 * WHAT THAT DID NOT MEAN, corrected here because this file's own words carried the
 * mistake: *says nothing about what comes after* was read as *says nothing at all*.
 * The product asked only the last checkpoint, so a record that was stamped and then
 * written to answered `nothing outside this machine attests this record` — false
 * about a record whose proof is in its own tree. `witnessed-then-written` is the
 * frozen record for that state, and it is this same one with the head left unstamped.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';
import { witnessBlocksPath, witnessProofPath } from './layout.js';
import { meetsRequirement } from './level.js';
import { readWitness } from './witness.js';

/** This directory — where the modules the closure walk reads live. */
const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * Every module reachable from `entry` by a static relative import, transitively.
 *
 * The specifiers are read with the same expression `boundaries.test.ts` uses, so the
 * two agree about what an import IS, and the walk is transitive because the property
 * being asserted is about the closure: a verifier that reached the network three
 * modules down would satisfy any guard that looked only at the file it started from.
 */
function modulesUnder(entry: string): readonly string[] {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const module = pending.pop() as string;
    if (seen.has(module)) continue;
    seen.add(module);
    const code = readFileSync(join(HERE, module), 'utf-8');
    const specifiers = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
    for (const found of code.matchAll(specifiers)) {
      const spec = found[1] as string;
      if (!spec.startsWith('./')) continue;
      pending.push(spec.slice(2).replace(/\.js$/, '.ts'));
    }
  }
  return [...seen];
}

/** A file's code with its comments taken out — so a guard reads what RUNS. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The record as it was frozen — copied per case, never verified in place. */
const FIXTURE = fileURLToPath(new URL('./__fixtures__/witnessed-record', import.meta.url));

/** The one tail the frozen record holds. */
const TAIL =
  '7e5a72fd0ea237237651690087e4a87133dab8b78847efadde778f633214cca4-05e27e636158e547a09e594545603717';

/** The checkpoint the attestation is filed under — the last one the record sealed. */
const CHECKPOINT = 'f84396462713a5fd1fefd3a043cddb2eed81c00f5fead86f0474bfaa551c42e2';

/** The block that carries it, and the instant that block claims. */
const BLOCK = 963690;
const ATTESTED_AT = 1787466198;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-witnessed-'));
  cpSync(FIXTURE, root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a record an outside witness has dated', () => {
  it('reaches externally-witnessed — the top of the tuple, by a record on a disk', () => {
    const result = verify(root, catalogUpcasters());
    expect(result.level).toBe('externally-witnessed');
    expect(result.witness).toBe('covered');
  });

  it('says which block dated it, and when, in the verdict a person reads', () => {
    const result = verify(root, catalogUpcasters());
    expect(result.summary).toContain('local integrity verified (T1/T2/T4) and witnessed (T3)');
    expect(result.summary).toContain(
      `external witness (T3): covered — Bitcoin block ${BLOCK} at ${new Date(ATTESTED_AT * 1000).toISOString()}`,
    );
  });

  it('satisfies --require=witnessed, which nothing could satisfy before', () => {
    const { level } = verify(root, catalogUpcasters());
    for (const requirement of ['chained', 'signed', 'witnessed'] as const) {
      expect(meetsRequirement(level, requirement), requirement).toBe(true);
    }
  });

  it('is still a fully proven record underneath: no issue, no residual', () => {
    const result = verify(root, catalogUpcasters());
    expect(result.issues).toEqual([]);
    expect(result.fullySigned).toBe(true);
    expect(result.uncheckpointedEvents).toBe(0);
  });

  it('reaches it with no network of any kind — the whole answer is these files', () => {
    // SAID OF THE CLOSURE, NOT OF A FILE, AND NOT OF A MENTION. The first draft of this
    // grepped `witness.ts` for the string `witness-request` and went red on its own
    // doc-comment, which NAMES the module in order to say it does not import it — a
    // guard on a mention, which the record has learned to distrust. And a guard on the
    // two files alone would be satisfied by an import three modules down. So the whole
    // static graph under the verifier is walked, and the module that speaks to a
    // calendar has to be absent from all of it.
    const closure = modulesUnder('chain.ts');
    expect(closure).toContain('witness.ts');
    expect(closure).toContain('verify.ts');
    expect(closure).not.toContain('witness-request.ts');
    // And nothing in that closure reaches the network by any other name.
    for (const module of closure) {
      const code = withoutComments(readFileSync(join(HERE, module), 'utf-8'));
      expect(code, module).not.toMatch(/\bfetch\b|node:http/);
    }
  });
});

describe('what the attestation is, and is not, evidence of', () => {
  it('falls to PENDING when the block header goes and the anchor stays', () => {
    // The state a record is in between asking and confirming, reached here by taking
    // away the 80 bytes: the proof still reaches block 963690 and this machine can no
    // longer check that it does. It is not coverage, and the level drops one rung.
    rmSync(witnessBlocksPath({ root }, TAIL, CHECKPOINT));
    const result = verify(root, catalogUpcasters());
    expect(result.witness).toBe('pending');
    expect(result.level).toBe('fully-signed');
    expect(meetsRequirement(result.level, 'witnessed')).toBe(false);
  });

  it('falls to NOT COVERED when the header is swapped for one nobody mined', () => {
    // The forgery the difficulty floor exists for: a header whose merkle root is
    // whatever the attestation folded to, mined at the easiest target the format can
    // express. It contradicts nothing internally and it is refused.
    const line = readFileSync(witnessBlocksPath({ root }, TAIL, CHECKPOINT), 'utf-8');
    const stored = JSON.parse(line.trim().split('\n')[0] as string) as { header: string };
    const forged = Buffer.from(stored.header, 'hex');
    forged.writeUInt32LE(0x207fffff, 72);
    writeFileSync(
      witnessBlocksPath({ root }, TAIL, CHECKPOINT),
      `${JSON.stringify({ header: forged.toString('hex'), height: BLOCK })}\n`,
      'utf-8',
    );
    const result = verify(root, catalogUpcasters());
    expect(result.witness).toBe('not-covered');
    expect(result.summary).toContain('carries no proof of work');
  });

  it('says NOTHING about an event appended after the checkpoint it dated', () => {
    // The residual, one layer up. This is asserted by removing the checkpoint the
    // attestation names: what is left is a record whose last VERIFIED checkpoint is
    // another one, and the witness is filed under a digest nothing proves any more.
    const checkpoints = join(root, 'tails', TAIL, 'checkpoints.jsonl');
    const kept = readFileSync(checkpoints, 'utf-8').trim().split('\n').slice(0, -1);
    writeFileSync(checkpoints, `${kept.join('\n')}\n`, 'utf-8');
    const result = verify(root, catalogUpcasters());
    expect(result.witness).toBe('not-covered');
    // And the level is what a shortened chain earns on its own merits, never the rung
    // an attestation about a checkpoint that is gone would have bought.
    expect(result.level).not.toBe('externally-witnessed');
  });
});

describe('the file a stranger checks', () => {
  it('is the ecosystem’s own detached proof, and carries nothing of ours', () => {
    // The `.ots` is what `ots verify` reads. Anything of this product mixed into it
    // would turn the one file somebody else can check into a file only we can — which
    // is why the block headers live in a sidecar and not inside the proof. The magic
    // is asserted in hex, because it opens with a byte no source file may hold.
    const proof = readFileSync(witnessProofPath({ root }, TAIL, CHECKPOINT));
    expect(proof.subarray(0, 16).toString('hex')).toBe('004f70656e54696d657374616d707300');
    expect(readWitness({ root }, TAIL, CHECKPOINT).status).toBe('covered');
  });

  it('commits to the checkpoint digest and to no other value of the record', () => {
    // What left the machine, checked from the bytes that left it: the proof's subject
    // is the digest of a checkpoint's signed message and there is nothing else in the
    // file that came from this record — no id, no title, no body, no count.
    const proof = readFileSync(witnessProofPath({ root }, TAIL, CHECKPOINT));
    expect(proof.includes(Buffer.from(CHECKPOINT, 'hex'))).toBe(true);
    // EVERY VALUE THE STORED EVENTS HOLD, asked of the bytes that left — rather than a
    // list of field names, which is the ADDRESS-LIST shape that carries the writer's
    // blind spot. The first draft grepped `"id":` and found none, because this record's
    // envelope calls it `subject`; the non-vacuity line below is what caught that.
    const events = readFileSync(join(root, 'tails', TAIL, '000001.jsonl'), 'utf-8');
    const values = [...events.matchAll(/"([^"\\]{12,})"/g)].map((found) => found[1] as string);
    expect(values.length).toBeGreaterThan(10);
    for (const value of new Set(values)) {
      expect(proof.includes(Buffer.from(value, 'utf-8')), value).toBe(false);
      // And not as raw bytes either, for the values that are hex — a digest smuggled
      // in binary would pass a search for its text.
      if (/^[0-9a-f]+$/.test(value) && value.length % 2 === 0) {
        expect(proof.includes(Buffer.from(value, 'hex')), value).toBe(false);
      }
    }
  });
});
