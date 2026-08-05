/**
 * The proof is over the form that was WRITTEN, never over the form a reader gets
 * back.
 *
 * This is the one file that runs the upcaster mechanism against the chain's
 * proofs, and it exists because that mechanism is otherwise DORMANT. The catalog
 * has a single version of every kind, so `catalogUpcasters()` is empty, every
 * event reaches "the latest" in zero steps, and the written event and the read
 * event are the same value — which means every other test in this repository
 * passes identically whether a digest is taken over the record or over a lifted
 * reading of it. A registry that lifts nothing can testify to nothing about the
 * code that runs when one does. So the ladder here is SYNTHETIC: a `latest`
 * taller than the catalog's, plus real single-step upcasters — the exact use
 * `UpcasterRegistry`'s constructor parameter exists for.
 *
 * Three shapes of lift are loaded, because the failure looks different for each
 * and only one of them is obvious: a bare version bump (the minimum any future
 * change costs), a lift that DROPS a field, and one that ADDS a field.
 *
 * What a chain written before the bump must do once that ladder is loaded: verify
 * green at T1 AND at T2/T4, keep handing the lifted event to whatever wants
 * meaning, and still refuse a line it cannot read at all.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decisionRecorded, identityFounded, runStarted, taskCreated } from '../events/build.js';
import { LATEST_VERSION } from '../events/catalog.js';
import { catalogUpcasters } from '../events/registry.js';
import {
  type LatestVersions,
  type Upcaster,
  UpcasterRegistry,
  type VersionedEvent,
} from '../events/upcaster.js';
import { openChainForWriting, verify } from './chain.js';
import type { Entry } from './entry.js';
import { contentRoot, eventBytes, writtenAsBuilt } from './hash.js';
import { listTails, readTailCheckpoints, readTailEntries } from './store.js';
import type { ChainWriter } from './writer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-upcast-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** High enough that no checkpoint fires on its own; the tests force them. */
const NEVER = 1_000_000;

/** A goal the synthetic v2 of `run.started` no longer carries. */
const DROPPED_GOAL = 'the goal only v1 records';
/** An alternatives note the synthetic v2 of `decision.recorded` fills in. */
const ADDED_ALTERNATIVES = 'the alternatives only v2 records';

/**
 * A catalog three kinds taller than the real one. Every other kind stays at 1,
 * so the chain also carries an event that does NOT lift (`identity.founded`) —
 * a mixed tail is the honest case, and it keeps the assertions from passing on
 * a registry that happens to lift everything.
 */
const TALLER_CATALOG: LatestVersions = {
  ...LATEST_VERSION,
  'task.created': 2,
  'run.started': 2,
  'decision.recorded': 2,
};

/** The minimum any version bump costs: the same fact, one higher `v`. */
const bumpsTheVersion: Upcaster = (event) => ({ ...event, v: 2 });

/** A lift that REMOVES a field — v2 of `run.started` stopped carrying the goal. */
const dropsTheGoal: Upcaster = (event) => {
  const payload = { ...(event.payload as Record<string, unknown>) };
  delete payload.goal;
  return { ...event, v: 2, payload };
};

/** A lift that ADDS a field — v2 of `decision.recorded` records alternatives. */
const addsAlternatives: Upcaster = (event) => ({
  ...event,
  v: 2,
  payload: {
    ...(event.payload as Record<string, unknown>),
    alternatives: ADDED_ALTERNATIVES,
  },
});

/** The registry of a future version: it knows the taller catalog and how to climb to it. */
function afterTheBump(): UpcasterRegistry {
  return new UpcasterRegistry(TALLER_CATALOG)
    .register({ kind: 'task.created', from: 1 }, bumpsTheVersion)
    .register({ kind: 'run.started', from: 1 }, dropsTheGoal)
    .register({ kind: 'decision.recorded', from: 1 }, addsAlternatives);
}

/**
 * A version that announces the taller catalog but ships no rung to reach it —
 * a broken ladder, the shape of a genuinely unreadable line.
 */
function withAMissingRung(): UpcasterRegistry {
  return new UpcasterRegistry(TALLER_CATALOG);
}

const env = (w: ChainWriter, subject: string) => ({
  at: '2026-07-21T00:00:00.000Z',
  who: w.anchor,
  signerFp: w.signerFingerprint,
  subject,
});

/**
 * Writes a tail with the registry of TODAY — everything at v1, nothing lifted —
 * which is what "a chain written before the bump" means. One event of each kind
 * the synthetic ladder touches, plus the founding that does not lift.
 */
function writeChainBeforeTheBump(opts: { checkpoint: boolean }): void {
  const w = openChainForWriting(root, { keyRoot: root, checkpointEvery: NEVER });
  w.append(identityFounded(env(w, w.anchor), { foundingFp: w.signerFingerprint }));
  w.append(taskCreated(env(w, 't-1'), { title: 'written under v1' }));
  w.append(runStarted(env(w, 'r-1'), { agent: 'claude', goal: DROPPED_GOAL }));
  w.append(
    decisionRecorded(env(w, 'd-1'), {
      title: 'written under v1',
      rationale: 'because the record predates the bump',
      adr: 'ADR-1',
    }),
  );
  if (opts.checkpoint) w.checkpoint();
}

function tailIdOf(): string {
  return listTails({ root })[0] as string;
}

/** The `v` of an event as it sits on the line, read off the written form. */
function writtenVersionsOf(registry: UpcasterRegistry): number[] {
  return readTailEntries({ root }, tailIdOf(), registry).map(
    (e) => (e.written.value as { v: number }).v,
  );
}

/**
 * The one entry of a kind, or a loud failure. A `find` that returns undefined
 * would make the assertions below pass over nothing — the shape of an emptied
 * guard — so absence is an error with a name, never a skipped check.
 */
function theOnly(entries: readonly Entry[], kind: string): Entry {
  const found = entries.filter((e) => e.event.kind === kind);
  if (found.length !== 1) {
    throw new Error(`expected exactly one ${kind} on the tail, found ${found.length}`);
  }
  return found[0] as Entry;
}

/** The payload as it sits on the LINE — the record, not the reading. */
function payloadOfRecord(entry: Entry): Record<string, string | undefined> {
  return (entry.written.value as { payload: Record<string, string | undefined> }).payload;
}

describe('a chain written before a version bump still proves itself', () => {
  it('verifies its hash chain (T1) with the lift loaded', () => {
    writeChainBeforeTheBump({ checkpoint: false });
    const registry = afterTheBump();

    // Non-vacuity FIRST: the ladder has to actually fire on this tail, or the
    // green below would be the green of an empty registry — which is exactly the
    // green this defect hid behind. The reading climbs to v2; the record does not
    // move, and `identity.founded` (no rung) stays where it was on both sides.
    const entries = readTailEntries({ root }, tailIdOf(), registry);
    expect(entries.map((e) => e.event.v)).toEqual([1, 2, 2, 2]);
    expect(writtenVersionsOf(registry)).toEqual([1, 1, 1, 1]);

    const result = verify(root, registry);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("verifies its checkpoint's signature (T2/T4) with the lift loaded", () => {
    // The half that costs the most to miss. A T1 break reads as "content or link
    // was altered"; a T2/T4 break reads as a broken Ed25519 signature, which in
    // this product means "someone edited this without holding the key". A version
    // bump must not be able to say that about an untouched chain.
    writeChainBeforeTheBump({ checkpoint: true });
    const registry = afterTheBump();

    const entries = readTailEntries({ root }, tailIdOf(), registry);
    expect(entries.map((e) => e.event.v)).toEqual([1, 2, 2, 2]); // the ladder fired

    const result = verify(root, registry);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.fullySigned).toBe(true);
    expect(result.tails[0]?.checkpointedThrough).toBe(3);
  });

  it('folds the signed root over the record, and the reading would NOT reproduce it', () => {
    // The measurement under the test above: the two roots really are different
    // values. If they were not, the T2/T4 case would be green for the wrong
    // reason and this whole file would be theatre.
    writeChainBeforeTheBump({ checkpoint: true });
    const registry = afterTheBump();
    const entries = readTailEntries({ root }, tailIdOf(), registry);
    const checkpoint = readTailCheckpoints({ root }, tailIdOf())[0];

    expect(contentRoot(entries.map((e) => e.written))).toBe(checkpoint?.contentRoot);
    expect(contentRoot(entries.map((e) => writtenAsBuilt(e.event)))).not.toBe(
      checkpoint?.contentRoot,
    );
  });

  it('is signed over the record by a writer that RESUMED it after the bump', () => {
    // The third site, and the one that is not in the verifier at all. A fresh
    // process refills the buffer the next checkpoint signs from the END of the
    // tail, and those entries came off the disk — lifted. A checkpoint folded
    // over them would be a real signature over bytes that are not on the tail:
    // undetectable as a forgery, and fatal to every later verification.
    writeChainBeforeTheBump({ checkpoint: false }); // 4 events, nothing signed yet
    const registry = afterTheBump();

    const resumed = openChainForWriting(root, {
      keyRoot: root,
      upcasters: registry,
      checkpointEvery: NEVER,
    });
    resumed.append(taskCreated(env(resumed, 't-2'), { title: 'appended after the bump' }));
    const checkpoint = resumed.checkpoint();

    // It really did sign the recovered range, not just the event it appended.
    expect(checkpoint?.fromSeq).toBe(0);
    expect(checkpoint?.toSeq).toBe(4);

    const result = verify(root, registry);
    expect(result.issues).toEqual([]);
    expect(result.fullySigned).toBe(true);
  });
});

describe('the lift still does its job — the proof was not bought with the reading', () => {
  it('serves the LIFTED event to a reader while the record keeps what was written', () => {
    // A fix that stopped upcasting would make every assertion above pass and
    // quietly destroy the reason upcasters exist. Both directions are checked:
    // the lift that removes a field and the lift that adds one.
    writeChainBeforeTheBump({ checkpoint: true });
    const entries = readTailEntries({ root }, tailIdOf(), afterTheBump());

    const run = theOnly(entries, 'run.started');
    expect((run.event.payload as { goal?: string }).goal).toBeUndefined();
    expect(payloadOfRecord(run).goal).toBe(DROPPED_GOAL);

    const decision = theOnly(entries, 'decision.recorded');
    expect((decision.event.payload as { alternatives?: string }).alternatives).toBe(
      ADDED_ALTERNATIVES,
    );
    expect(payloadOfRecord(decision).alternatives).toBeUndefined();
  });

  it('resolves identity from the LIFTED event while proving over the record', () => {
    // The other reader inside the verifier. The enrollment fold decides whose key
    // may speak by asking an event for `foundingFp`, `subject`, `who` — by their
    // CURRENT names, which is exactly what a lift exists to keep answering. It is
    // right that it reads the lifted form: it recomputes no digest over those
    // bytes, and the one signature it checks is over `enroll:<anchor>:<fp>`,
    // identifiers a faithful upcaster carries across unchanged. So both readings
    // have to hold at once on the same tail, and `identity.founded` is where they
    // meet — an identity break would surface here as an issue, not as a green.
    writeChainBeforeTheBump({ checkpoint: true });
    const registry = new UpcasterRegistry({
      ...LATEST_VERSION,
      'identity.founded': 2,
    }).register({ kind: 'identity.founded', from: 1 }, bumpsTheVersion);

    const entries = readTailEntries({ root }, tailIdOf(), registry);
    expect(theOnly(entries, 'identity.founded').event.v).toBe(2); // the ladder fired

    const result = verify(root, registry);
    expect(result.issues).toEqual([]);
    expect(result.fullySigned).toBe(true);
  });

  it('still refuses a chain it cannot READ, though every byte hashes perfectly', () => {
    // The guarantee that must not be traded for this one. Verifying over the
    // record without also reading it would be the cheaper fix, and it would make
    // the verifier blind to a line nobody can interpret — a green verdict over an
    // event no reader can open, on an append-only log where that is permanent.
    // Nothing on disk differs between the two calls below: same bytes, same
    // hashes, same real signature. Only the ladder differs.
    writeChainBeforeTheBump({ checkpoint: true });

    expect(verify(root, afterTheBump()).ok).toBe(true);
    expect(() => verify(root, withAMissingRung())).toThrow(/no upcaster for task\.created@1/);
  });
});

describe('why this stayed invisible', () => {
  it('with no upcaster registered, the record and the reading are the same bytes', () => {
    // The whole reason a defect at the centre of the proof survived: with the
    // real registry the two forms are one value, so every existing test is green
    // either way and the mistake has no observable consequence — until the first
    // version bump makes it a chain-wide claim of tampering.
    writeChainBeforeTheBump({ checkpoint: true });
    const entries = readTailEntries({ root }, tailIdOf(), catalogUpcasters());

    expect(entries).toHaveLength(4); // not a vacuous loop
    for (const entry of entries) {
      expect(eventBytes(entry.written)).toEqual(eventBytes(writtenAsBuilt(entry.event)));
    }
  });

  it('an upcaster is free to change anything, because nothing proves over its output', () => {
    // Stated as a property of the mechanism rather than of one lift: a step may
    // rewrite the shape wholesale and the chain owes it nothing, because the
    // bytes under every proof stayed on the tail.
    const rewritesEverything: Upcaster = (event: VersionedEvent) => ({
      v: 2,
      kind: event.kind,
      at: event.at,
      who: event.who,
      signerFp: event.signerFp,
      subject: event.subject,
      payload: { title: 'a title v2 invented' },
    });
    writeChainBeforeTheBump({ checkpoint: true });
    const registry = new UpcasterRegistry({ ...LATEST_VERSION, 'task.created': 2 }).register(
      { kind: 'task.created', from: 1 },
      rewritesEverything,
    );

    const entries = readTailEntries({ root }, tailIdOf(), registry);
    const task = theOnly(entries, 'task.created');
    expect((task.event.payload as { title: string }).title).toBe('a title v2 invented');

    const result = verify(root, registry);
    expect(result.issues).toEqual([]);
    expect(result.fullySigned).toBe(true);
  });
});
