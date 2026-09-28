/**
 * WHAT A VERIFICATION COSTS, COUNTED — in operations over the record, never in seconds.
 *
 * THE SHAPE THIS EXISTS TO KEEP OUT. The verifier took each checkpoint's range with a
 * `filter` over every entry of the tail, and this product signs once per act, so the
 * checkpoints grow with the events: the verb that proves a record touched each entry once
 * per checkpoint, and cost the square of the history — 1.9 s at 10 thousand events, 8.0 to
 * 8.4 s at 31.6 thousand, 77 s at 100 thousand, measured over records the product's own
 * writer wrote. It read the committed key off the disk once per checkpoint, too. Three
 * comments in the console said the verb was linear; none of them had a test.
 *
 * SO THIS COUNTS, BECAUSE A CLOCK CANNOT BE A GUARD. A time is a property of the machine it
 * ran on and of whatever else ran beside it; a count of what the verifier touched is a
 * property of the verifier. What is counted:
 *
 *   - every read the verifier makes of an ENTRY or a CHECKPOINT — an index into what a
 *     tail's files held, or a field of one — over the same record at two sizes, four times
 *     apart. Linear work grows about four times; the old shape grew about fourteen. The
 *     bound between them is loose on purpose: it has to hold whatever linear pass is added
 *     later, and to fail for any pass repeated per checkpoint — over the entries, over the
 *     checkpoints themselves, over a copy of either.
 *   - every read of a committed KEY off the disk, and every derivation of a key's
 *     fingerprint: once per key per verification, whatever number of checkpoints, tails and
 *     enrolments name it. The derivation is an export and a hash, and it was paid once per
 *     checkpoint for a value that cannot change.
 *
 * The record is the product's own writer's, signed once per act: two machines, two tails,
 * the second machine's key enrolled into the first one's identity — so the one key is
 * asked for by all three checks that need a key (its checkpoints, its tail's ownership
 * proof, and the enrolment that brought it in).
 *
 * THE INSTRUMENT SAYS WHEN IT BROKE. Every counter sits on a path the verifier may stop
 * using — the entries and checkpoints are counted where `readTail` and
 * `readTailCheckpoints` hand them over, the keys where
 * `readFileSync` opens them — and a count of zero from a counter nobody reaches would read
 * as the cheapest verifier there ever was. So each count is first held to a floor it
 * cannot be under if it saw anything at all, and says `RULER BROKEN` when it is.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enrollmentMessage,
  identityFounded,
  keyEnrolled,
  memoryCaptured,
} from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';
import { sign } from './keys.js';
import { loadOrCreateKeyPair } from './keystore.js';
import { publicKeyPath } from './layout.js';
import type { ChainWriter } from './writer.js';

/**
 * The counters, and the wrapping that feeds them — hoisted, because the module mocks
 * below run before anything else in this file does. Nothing is counted while `on` is
 * false, so writing the record costs the count nothing.
 */
const counted = vi.hoisted(() => {
  const state = {
    on: false,
    reads: 0,
    keyReads: new Map<string, number>(),
    derivations: 0,
  };
  const tick = () => {
    if (state.on) state.reads += 1;
  };
  /** Each item, and the array holding them, behind a proxy that counts every read. */
  const items = <T extends object>(held: readonly T[]): T[] =>
    new Proxy(
      held.map(
        (entry) =>
          new Proxy(entry, {
            get(target, key, receiver) {
              tick();
              return Reflect.get(target, key, receiver);
            },
          }),
      ),
      {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) tick();
          return Reflect.get(target, key, receiver);
        },
      },
    );
  return { state, items };
});

vi.mock('./store.js', async (importActual) => {
  const actual = await importActual<typeof import('./store.js')>();
  return {
    ...actual,
    readTail: (...args: Parameters<typeof actual.readTail>) => {
      const read = actual.readTail(...args);
      return { ...read, entries: counted.items(read.entries) };
    },
    readTailCheckpoints: (...args: Parameters<typeof actual.readTailCheckpoints>) =>
      counted.items(actual.readTailCheckpoints(...args)),
  };
});

vi.mock('./keys.js', async (importActual) => {
  const actual = await importActual<typeof import('./keys.js')>();
  return {
    ...actual,
    fingerprintOf: (...args: Parameters<typeof actual.fingerprintOf>) => {
      if (counted.state.on) counted.state.derivations += 1;
      return actual.fingerprintOf(...args);
    },
  };
});

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  const readFileSync = (...args: Parameters<typeof actual.readFileSync>) => {
    const [path] = args;
    if (counted.state.on && typeof path === 'string' && path.endsWith('.pub')) {
      counted.state.keyReads.set(path, (counted.state.keyReads.get(path) ?? 0) + 1);
    }
    return actual.readFileSync(...args);
  };
  return { ...actual, readFileSync };
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mnema-verify-cost-'));
});

afterEach(() => {
  counted.state.on = false;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A record of two machines writing `acts` acts each, every act signed. The first machine
 * founds an identity and enrols the second machine's key into it; the second writes as
 * that identity from its own tail. The instants rise across both machines, so the
 * enrolment is folded before anything the second key signs.
 */
function twoMachines(acts: number): { root: string; events: number; keys: readonly string[] } {
  const root = join(dir, `record-${acts}`);
  const firstKeys = join(dir, `first-${acts}`);
  const secondKeys = join(dir, `second-${acts}`);
  for (const path of [root, firstKeys, secondKeys]) mkdirSync(path);
  const second = loadOrCreateKeyPair({ root: secondKeys });
  const first = openChainForWriting(root, { keyRoot: firstKeys });
  const anchor = first.anchor;
  let clock = Date.UTC(2026, 8, 25);
  let events = 0;
  const act = (w: ChainWriter, build: (at: string) => Parameters<ChainWriter['append']>[0]) => {
    clock += 1000;
    w.append(build(new Date(clock).toISOString()));
    w.checkpoint();
    events += 1;
  };
  act(first, (at) =>
    identityFounded(
      { at, who: anchor, signerFp: first.signerFingerprint, subject: anchor },
      { foundingFp: first.signerFingerprint },
    ),
  );
  act(first, (at) =>
    keyEnrolled(
      { at, who: anchor, signerFp: first.signerFingerprint, subject: anchor },
      {
        newFp: second.fingerprint,
        reverseSig: Buffer.from(
          sign(enrollmentMessage(anchor, second.fingerprint), second.privateKey),
        ).toString('hex'),
      },
    ),
  );
  const joined = openChainForWriting(root, { keyRoot: secondKeys });
  for (let i = 0; i < acts; i += 1) {
    for (const w of [first, joined]) {
      act(w, (at) =>
        memoryCaptured(
          { at, who: anchor, signerFp: w.signerFingerprint, subject: `m-${events}` },
          { content: `note ${events}` },
        ),
      );
    }
  }
  const keys = [first.signerFingerprint, second.fingerprint].map((fp) =>
    publicKeyPath({ root }, fp),
  );
  return { root, events, keys };
}

/** One verification of `root`, with both counters on, and what it read. */
function countedVerification(root: string) {
  counted.state.reads = 0;
  counted.state.keyReads.clear();
  counted.state.derivations = 0;
  counted.state.on = true;
  const result = verify(root);
  counted.state.on = false;
  return {
    result,
    reads: counted.state.reads,
    keyReads: new Map(counted.state.keyReads),
    derivations: counted.state.derivations,
  };
}

describe('what a verification costs', () => {
  it('grows with the record, not with the record times its checkpoints', () => {
    const small = twoMachines(60);
    const large = twoMachines(240);
    const atSmall = countedVerification(small.root);
    const atLarge = countedVerification(large.root);
    // Both are records the product wrote, and both verify: a cost read off a record the
    // verifier refused would be the cost of refusing.
    expect(atSmall.result.level).toBe('fully-signed');
    expect(atLarge.result.level).toBe('fully-signed');
    // Every entry is read at least once by the hash chain alone.
    expect(
      atSmall.reads >= small.events ? 'counted' : 'RULER BROKEN: fewer reads than entries',
    ).toBe('counted');
    const growth = atLarge.reads / atSmall.reads;
    const sizes = large.events / small.events;
    expect({
      growth: Math.round(growth * 100) / 100,
      perEvent: [
        Math.round(atSmall.reads / small.events),
        Math.round(atLarge.reads / large.events),
      ],
      linear: growth < 2 * sizes,
    }).toMatchObject({ linear: true });
  });

  it('reads each committed key off the disk once, however many checks name it', () => {
    const record = twoMachines(40);
    const { result, keyReads, derivations } = countedVerification(record.root);
    expect(result.level).toBe('fully-signed');
    // The second key is the one all three checks ask for: its own checkpoints, its tail's
    // ownership proof, and the enrolment that brought it in.
    expect(
      record.keys.every((path) => (keyReads.get(path) ?? 0) > 0)
        ? 'counted'
        : 'RULER BROKEN: a committed key was never read',
    ).toBe('counted');
    expect(Object.fromEntries(keyReads)).toEqual(
      Object.fromEntries(record.keys.map((path) => [path, 1])),
    );
    // And what each key's fingerprint is, derived once for every check that compares it.
    expect(derivations).toBe(record.keys.length);
  });

  it('reads them again on the next verification, which holds a reader of its own', () => {
    const record = twoMachines(3);
    countedVerification(record.root);
    const { keyReads } = countedVerification(record.root);
    expect(Object.fromEntries(keyReads)).toEqual(
      Object.fromEntries(record.keys.map((path) => [path, 1])),
    );
  });
});
