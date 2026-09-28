/**
 * THE ANCHOR FOLLOWS THE FOUNDING: a key's first write into a tree records the anchor it serves
 * only once the fact that settles it is on the record.
 *
 * A recorded anchor is the one thing every later write trusts without reading the record —
 * `ensureFounded` returns on it at once — so an anchor with no founding behind it is not a stale
 * file. It is a key signing as an identity the record never admitted. That is what the order
 * before this file produced: the anchor was recorded FIRST and the founding appended second, so a
 * first write that failed between the two left the anchor behind, the next write signed without
 * founding, and `verify` failed on that tree for good (`[T2/T4] … is not a key enrolled for …
 * at this point`). Measured on the built binary with three ordinary triggers — a tail that
 * cannot be born (its birth lives inside the founding's append), a lock directory that is a
 * link to nothing, and the tail's lock held by another live session — and with a process killed
 * inside the founding's append.
 *
 * One case per trigger, each PLANTED rather than raced: the founding's append throwing after the
 * tail was born, the tail's lock held by a live process, and the state a process leaves when it
 * dies after its founding landed and before its anchor. Each asserts the state the failure
 * leaves AND what the next write makes of it, because the harm was never the failure — it was
 * the next write.
 */

import { createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type ChainWriter,
  catalogUpcasters,
  deriveAnchor,
  enrollmentMessage,
  materializePublicKey,
  openChainForWriting,
  sign,
  tailDir,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMemory } from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from './clock.js';
import { decideAnchor, enrollKey, ensureFounded } from './identity-operations.js';
import type { WriteContext } from './operations.js';

const upcasters = catalogUpcasters();

let tree: string;
let scratch: string[] = [];

beforeEach(() => {
  scratch = [];
  tree = tmp('mnema-anchor-tree-');
  tick = 0;
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-09-25T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`;
};

/** A machine: its own key root, and a writer over the shared tree. */
interface Machine {
  readonly keyRoot: string;
  readonly writer: ChainWriter;
  readonly ctx: WriteContext;
  readonly fingerprint: string;
}

function machine(prefix: string): Machine {
  return open(tmp(prefix));
}

/** A writer for the key at `keyRoot` — what a NEW process of that installation opens. */
function open(keyRoot: string): Machine {
  const writer = openChainForWriting(tree, { keyRoot });
  return {
    keyRoot,
    writer,
    ctx: { writer, layout: { root: tree }, upcasters, clock },
    fingerprint: writer.signerFingerprint,
  };
}

/** The local anchor file a key records for the tree. */
function anchorFile(fingerprint: string): string {
  return join(tree, 'keys', `${fingerprint}.anchor`);
}

/** Every founding on the record. */
function foundings(): unknown[] {
  return orderedEvents({ root: tree }, upcasters).filter((e) => e.kind === 'identity.founded');
}

/**
 * The first write, which is expected to fail: what it threw, so the case can say it failed the
 * way it was planted to.
 */
function failed(ctx: WriteContext): unknown {
  try {
    captureMemory(ctx, { content: 'the first write' });
  } catch (error) {
    return error;
  }
  throw new Error('the first write was planted to fail, and it did not');
}

/**
 * The next write, by a new process of the same installation, and what the tree is after it:
 * founded exactly once, under the anchor this key derives, and verifying whole.
 */
function theNextWriteFounds(keyRoot: string): void {
  const next = open(keyRoot);
  expect(decideAnchor(next.ctx).source).toBe('unfounded');
  expect(captureMemory(next.ctx, { content: 'the next write' }).ok).toBe(true);
  next.writer.checkpoint();
  expect(foundings()).toHaveLength(1);
  expect(readFileSync(anchorFile(next.fingerprint), 'utf-8').trim()).toBe(
    deriveAnchor(next.fingerprint),
  );
  expect(verify(tree, upcasters)).toMatchObject({ ok: true, fullySigned: true });
}

describe('the anchor follows the founding — a first write that fails leaves no anchor', () => {
  it('a founding whose append throws after the tail was born leaves no anchor, and the next write founds', () => {
    const b = machine('mnema-anchor-born-');
    // A disk that fills at the founding's line: the birth before it (the key's public half, the
    // tail's directory and its proof) has already been written, which is what moved INTO this
    // window when a tail began to be born at its first append.
    const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
    const appendFileSync = fs.appendFileSync;
    let fired = 0;
    fs.appendFileSync = ((path, data, options) => {
      if (String(data).includes('"kind":"identity.founded"')) {
        fired += 1;
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), {
          code: 'ENOSPC',
        });
      }
      return appendFileSync(path, data, options);
    }) as typeof fs.appendFileSync;
    syncBuiltinESMExports();
    let thrown: unknown;
    try {
      thrown = failed(b.ctx);
    } finally {
      fs.appendFileSync = appendFileSync;
      syncBuiltinESMExports();
    }

    // The plant fired, once, at the founding — a plant that never fires would leave every
    // assertion below true of a write that simply succeeded.
    expect(fired).toBe(1);
    expect((thrown as { code?: string }).code).toBe('ENOSPC');
    // AFTER the birth: the tail was born…
    expect(existsSync(join(tree, 'keys', `${b.fingerprint}.pub`))).toBe(true);
    expect(existsSync(join(tailDir({ root: tree }, b.writer.tail), 'tailproof.json'))).toBe(true);
    // …and neither the founding nor an anchor claiming it is there.
    expect(foundings()).toHaveLength(0);
    expect(existsSync(anchorFile(b.fingerprint))).toBe(false);

    theNextWriteFounds(b.keyRoot);
  });

  /**
   * A CEILING OF ITS OWN, and the line says what it waits on: a lock held by a process that is
   * alive and stays alive, which the founding's append is SUPPOSED to wait out — one
   * `DEFAULT_WAIT_MS` of 2000 ms, by design, before it refuses. The next write finds the lock
   * gone and does not wait. 12000 ms is six times the wait, the margin the lock's own case keeps.
   */
  it('a tail another live process is holding leaves no anchor, and the next write founds', {
    timeout: 12_000,
  }, () => {
    const b = machine('mnema-anchor-busy-');
    const lock = join(tree, 'locks', `${b.writer.tail}.lock`);
    mkdirSync(dirname(lock), { recursive: true });
    // Alive and fresh — this very process — so nothing may break it: two sessions writing one
    // project at once share the tail, and this is the moment the other one holds it.
    writeFileSync(lock, `${process.pid} ${Date.now()}\n`, 'utf-8');

    const thrown = failed(b.ctx);
    rmSync(lock);

    expect((thrown as { code?: string }).code).toBe('TAIL_BUSY');
    expect(foundings()).toHaveLength(0);
    expect(existsSync(anchorFile(b.fingerprint))).toBe(false);

    theNextWriteFounds(b.keyRoot);
  });
});

describe('the anchor follows the founding — a process that dies between the two', () => {
  it('dies after its founding landed and before its anchor: the next write adopts that founding and founds nothing', () => {
    const b = machine('mnema-anchor-died-');
    // The process dies at the anchor: nothing after that line runs. Thrown here rather than
    // killed, which leaves the same bytes on disk; the binary is killed for real by the probe
    // this case was written beside.
    const dying = new Proxy(b.writer, {
      get(target, prop, receiver) {
        if (prop === 'recordAnchor') {
          return () => {
            throw new Error('the process died here');
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect((failed({ ...b.ctx, writer: dying }) as Error).message).toBe('the process died here');

    // The founding is on the tail — it landed BEFORE the anchor — and no anchor claims it.
    expect(foundings()).toHaveLength(1);
    expect(existsSync(anchorFile(b.fingerprint))).toBe(false);

    // The next write finds no anchor, asks the record, and finds this key's own founding there.
    const next = open(b.keyRoot);
    const anchor = deriveAnchor(b.fingerprint);
    expect(decideAnchor(next.ctx)).toEqual({ anchor, source: 'adopted', membership: 'founded' });
    expect(captureMemory(next.ctx, { content: 'the next write' }).ok).toBe(true);
    next.writer.checkpoint();

    expect(foundings()).toHaveLength(1);
    expect(readFileSync(anchorFile(b.fingerprint), 'utf-8').trim()).toBe(anchor);
    expect(verify(tree, upcasters)).toMatchObject({ ok: true, fullySigned: true });
  });
});

describe('the anchor follows the founding — an adopted identity has nothing to follow', () => {
  it('records the anchor a member vouched for, and appends nothing', () => {
    const a = machine('mnema-anchor-adopt-a-');
    const anchor = ensureFounded(a.ctx);
    // B joins as `adoption.test.ts` has it join: its consent, A's vouch, and B's public half
    // committed beside the vouch.
    const b = machine('mnema-anchor-adopt-b-');
    const keys = join(b.keyRoot, 'keys');
    const half = {
      publicKey: createPublicKey(readFileSync(join(keys, `${b.fingerprint}.pub`), 'utf-8')),
      fingerprint: b.fingerprint,
    };
    materializePublicKey({ root: tree }, half);
    const privateKey = createPrivateKey(readFileSync(join(keys, `${b.fingerprint}.key`), 'utf-8'));
    enrollKey(a.ctx, {
      newFp: b.fingerprint,
      reverseSig: Buffer.from(sign(enrollmentMessage(anchor, b.fingerprint), privateKey)).toString(
        'hex',
      ),
    });
    const before = orderedEvents({ root: tree }, upcasters).length;

    expect(decideAnchor(b.ctx)).toEqual({ anchor, source: 'adopted', membership: 'enrolled' });
    expect(ensureFounded(b.ctx)).toBe(anchor);

    // The fact that settles this anchor is already on the record, so the anchor is recorded at
    // once — and the record is exactly as long as it was.
    expect(readFileSync(anchorFile(b.fingerprint), 'utf-8').trim()).toBe(anchor);
    expect(orderedEvents({ root: tree }, upcasters)).toHaveLength(before);
  });
});
