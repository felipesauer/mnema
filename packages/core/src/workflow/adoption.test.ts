/**
 * Adoption: what a machine decides about its own identity the first time it
 * writes to a tree.
 *
 * The property under test is the one the whole between-machines flow rests on: a
 * key another machine already enrolled must write as THAT identity, not as the one
 * it could derive from itself. Getting this wrong does not fail loudly — it
 * appends a second `identity.founded` to a record the team shares, and from then
 * on one person reads as two strangers, with no way to take the events back.
 *
 * The second property is a cost, not a behaviour: the record is consulted ONLY
 * while no anchor is recorded yet. Every gated write passes through here, so a
 * replay on that path would be paid on every command forever. It is measured
 * below, not asserted in prose.
 */

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  deriveAnchor,
  enrollmentMessage,
  generateKeyPair,
  materializePublicKey,
  openChainForWriting,
  type PublicHalf,
  sign,
  signerAt,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdentityUnavailableError, membershipIn } from '../identity/membership.js';
import { captureMemory } from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from './clock.js';
import { decideAnchor, enrollKey, ensureFounded, revokeKey } from './identity-operations.js';
import type { WriteContext } from './operations.js';

const upcasters = catalogUpcasters();

let tree: string;
let scratch: string[] = [];

beforeEach(() => {
  scratch = [];
  tree = tmp('mnema-adoption-tree-');
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
  return `2026-07-27T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`;
};

/** A machine: its own key root, and a writer over the shared tree. */
interface Machine {
  readonly keyRoot: string;
  readonly writer: ChainWriter;
  readonly ctx: WriteContext;
  readonly fingerprint: string;
}

function machine(prefix: string): Machine {
  const keyRoot = tmp(prefix);
  return open(keyRoot);
}

function open(keyRoot: string): Machine {
  const writer = openChainForWriting(tree, { keyRoot });
  const layout: ChainLayout = { root: tree };
  return {
    keyRoot,
    writer,
    ctx: { writer, layout, upcasters, clock },
    fingerprint: writer.signerFingerprint,
  };
}

/** The request material a joining machine produces: its consent to join `anchor`. */
function consentOf(m: Pick<Machine, 'keyRoot' | 'fingerprint'>, anchor: string): string {
  const privateKey = createPrivateKey(
    readFileSync(join(m.keyRoot, 'keys', `${m.fingerprint}.key`), 'utf-8'),
  );
  return Buffer.from(sign(enrollmentMessage(anchor, m.fingerprint), privateKey)).toString('hex');
}

/** A machine's public half, read from its key root — the material a vouch commits. */
function publicHalfOf(m: Pick<Machine, 'keyRoot' | 'fingerprint'>): PublicHalf {
  return {
    publicKey: createPublicKey(
      readFileSync(join(m.keyRoot, 'keys', `${m.fingerprint}.pub`), 'utf-8'),
    ),
    fingerprint: m.fingerprint,
  };
}

/** The local anchor file a machine records for a tree. */
function anchorFile(fingerprint: string): string {
  return join(tree, 'keys', `${fingerprint}.anchor`);
}

describe('adoption — a key the record proves a member writes as THAT identity', () => {
  it('adopts the enrolling identity instead of founding a second one', () => {
    const a = machine('mnema-adoption-a-');
    const anchor = ensureFounded(a.ctx);

    // B joins: it produces its consent, A vouches, and A commits B's public half
    // (the material the consent is proven against).
    const b = machine('mnema-adoption-b-');
    materializePublicKey({ root: tree }, publicHalfOf(b));
    enrollKey(a.ctx, {
      newFp: b.fingerprint,
      reverseSig: consentOf(b, anchor),
    });

    // B has recorded no anchor for this tree: this is the moment the trap fires.
    expect(b.writer.hasAnchor).toBe(false);
    expect(decideAnchor(b.ctx)).toEqual({ anchor, source: 'adopted', membership: 'enrolled' });

    const captured = captureMemory(b.ctx, { content: "B's first fact" });
    expect(captured.ok).toBe(true);

    // The proof: B's FIRST event speaks for A's anchor, and the record carries
    // exactly one founding. (The `who` is read before the event is built, so an
    // adoption that only fixed the anchor FILE would still fail here.)
    const events = orderedEvents({ root: tree }, upcasters);
    const memory = events.find((e) => e.kind === 'memory.captured');
    expect(memory?.who).toBe(anchor);
    expect(memory?.signerFp).toBe(b.fingerprint);
    expect(memory?.who).not.toBe(deriveAnchor(b.fingerprint));
    expect(events.filter((e) => e.kind === 'identity.founded')).toHaveLength(1);

    // And the tree still verifies with both machines writing to it.
    a.writer.checkpoint();
    b.writer.checkpoint();
    expect(verify(tree, upcasters)).toMatchObject({ ok: true, fullySigned: true });
  });

  it('WITHOUT adoption the same enrolled key splits the identity — what this prevents', () => {
    // The neutralization: the same state, but B's anchor decision skipped. Writing
    // under the anchor B derives from its own key is what founding a second
    // identity looks like, and it is what the branch under test avoids.
    const a = machine('mnema-adoption-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-adoption-b-');
    materializePublicKey({ root: tree }, publicHalfOf(b));
    enrollKey(a.ctx, {
      newFp: b.fingerprint,
      reverseSig: consentOf(b, anchor),
    });

    // Record the wrong anchor by hand — exactly the state the old code produced.
    b.writer.recordAnchor(deriveAnchor(b.fingerprint));
    captureMemory(b.ctx, { content: 'written by a machine that founded its own' });

    const events = orderedEvents({ root: tree }, upcasters);
    expect(events.find((e) => e.kind === 'memory.captured')?.who).toBe(deriveAnchor(b.fingerprint));
    // Two identities in one record: the split this closes.
    const authors = new Set(events.map((e) => e.who));
    expect(authors.size).toBe(2);
  });

  it('founds its own anchor when the record proves nothing — a first installation', () => {
    const a = machine('mnema-adoption-solo-');
    expect(decideAnchor(a.ctx).source).toBe('unfounded');

    const anchor = ensureFounded(a.ctx);
    expect(anchor).toBe(deriveAnchor(a.fingerprint));
    const events = orderedEvents({ root: tree }, upcasters);
    expect(events.filter((e) => e.kind === 'identity.founded')).toHaveLength(1);
    expect(existsSync(anchorFile(a.fingerprint))).toBe(true);
  });

  it('adopts a founding it made itself — a copied key in a fresh clone re-founds nothing', () => {
    const a = machine('mnema-adoption-copy-');
    const anchor = ensureFounded(a.ctx);
    // The clone: the tree's committed material survives, the LOCAL anchor does not
    // (it is never committed). The same key opens the tree again.
    unlinkSync(anchorFile(a.fingerprint));

    const again = open(a.keyRoot);
    expect(decideAnchor(again.ctx)).toEqual({ anchor, source: 'adopted', membership: 'founded' });
    ensureFounded(again.ctx);

    // It records the anchor without appending a second founding: the record
    // already proves this key founded that identity.
    expect(readFileSync(anchorFile(a.fingerprint), 'utf-8').trim()).toBe(anchor);
    expect(
      orderedEvents({ root: tree }, upcasters).filter((e) => e.kind === 'identity.founded'),
    ).toHaveLength(1);
  });
});

describe('adoption — the record is read only where no anchor is recorded', () => {
  it('consults the record ONCE across five writes, then never again', () => {
    // The measurement the hot path deserves: `recordAnchor` sits in the same branch
    // as the record read, so counting it counts the reads. Five writes, one read.
    const a = machine('mnema-adoption-cost-');
    let records = 0;
    const counted = new Proxy(a.writer, {
      get(target, prop, receiver) {
        if (prop === 'recordAnchor') records += 1;
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const ctx: WriteContext = { ...a.ctx, writer: counted };

    for (let i = 0; i < 5; i += 1) {
      expect(captureMemory(ctx, { content: `fact ${i}` }).ok).toBe(true);
    }
    expect(records).toBe(1);

    // And the counter is real: with the recorded anchor removed before each write,
    // the branch runs every time. A test that could not tell the difference would
    // prove nothing about the cost.
    records = 0;
    for (let i = 0; i < 5; i += 1) {
      unlinkSync(anchorFile(a.fingerprint));
      captureMemory(ctx, { content: `again ${i}` });
    }
    expect(records).toBe(5);
  });
});

describe('adoption — an identity it cannot decide is an identity it does not write as', () => {
  it('throws AMBIGUOUS_MEMBERSHIP when the record proves two identities for this key', () => {
    // Two anchors in one tree both accepted this key: the machine that lost its
    // key, minted another, founded a second identity, and was later enrolled into
    // the first. Which one it speaks for is the person's call.
    const a = machine('mnema-adoption-amb-a-');
    const anchorA = ensureFounded(a.ctx);
    const b = machine('mnema-adoption-amb-b-');
    const anchorB = ensureFounded(b.ctx);
    materializePublicKey({ root: tree }, publicHalfOf(b));
    enrollKey(a.ctx, {
      newFp: b.fingerprint,
      reverseSig: consentOf(b, anchorA),
    });
    // B in a fresh clone: the local anchor is gone, and the record names two.
    unlinkSync(anchorFile(b.fingerprint));

    const fresh = open(b.keyRoot);
    let thrown: unknown;
    try {
      captureMemory(fresh.ctx, { content: 'which identity is this?' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IdentityUnavailableError);
    expect((thrown as IdentityUnavailableError).code).toBe('AMBIGUOUS_MEMBERSHIP');
    expect((thrown as Error).message).toContain(anchorA);
    expect((thrown as Error).message).toContain(anchorB);
    // Nothing was written, and no anchor was recorded on a guess.
    expect(existsSync(anchorFile(b.fingerprint))).toBe(false);
    expect(orderedEvents({ root: tree }, upcasters).some((e) => e.kind === 'memory.captured')).toBe(
      false,
    );
  });

  it('throws REVOKED_KEY when the identity retired this key', () => {
    const a = machine('mnema-adoption-rev-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-adoption-rev-b-');
    materializePublicKey({ root: tree }, publicHalfOf(b));
    enrollKey(a.ctx, {
      newFp: b.fingerprint,
      reverseSig: consentOf(b, anchor),
    });
    revokeKey(a.ctx, { revokedFp: b.fingerprint, reason: 'the machine was lost' });

    // B writes into a tree it has no recorded anchor for. Founding its own would
    // be honest but silent — a retired member reappearing as a stranger — so the
    // refusal is the same one the restore gives, for the same reason.
    let thrown: unknown;
    try {
      captureMemory(b.ctx, { content: 'written after being retired' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IdentityUnavailableError);
    expect((thrown as IdentityUnavailableError).code).toBe('REVOKED_KEY');
    expect(existsSync(anchorFile(b.fingerprint))).toBe(false);
  });

  it('is unmoved by an enrollment the tree merely NAMES — consent is proven, not asserted', () => {
    // A stranger's tree naming this key's fingerprint, with a signature it could
    // not have made. Adopting on that would let any repository hand a machine an
    // identity by writing its fingerprint down.
    const a = machine('mnema-adoption-named-a-');
    const anchor = ensureFounded(a.ctx);
    const b = machine('mnema-adoption-named-b-');
    materializePublicKey({ root: tree }, publicHalfOf(b));
    const impostor = generateKeyPair();
    enrollKey(a.ctx, {
      newFp: b.fingerprint,
      reverseSig: Buffer.from(
        sign(enrollmentMessage(anchor, b.fingerprint), impostor.privateKey),
      ).toString('hex'),
    });

    // Not a member: B founds its OWN identity rather than adopting one it never
    // consented to join.
    expect(decideAnchor(b.ctx).source).toBe('unfounded');
    expect(ensureFounded(b.ctx)).toBe(deriveAnchor(b.fingerprint));
  });
});

describe('the same decision with or without a writer — the one a caller takes before opening one', () => {
  /** Every directory and file under the tree, each file with its digest. */
  function listing(dir: string): string[] {
    const out: string[] = [];
    const walk = (at: string): void => {
      for (const name of readdirSync(at).sort()) {
        const path = join(at, name);
        if (statSync(path).isDirectory()) {
          out.push(`D ${path}`);
          walk(path);
        } else {
          out.push(`F ${createHash('sha256').update(readFileSync(path)).digest('hex')} ${path}`);
        }
      }
    };
    walk(dir);
    return out;
  }

  /** The decision for the key at `keyRoot`, asked of the signer — no writer is opened. */
  function asked(keyRoot: string): ReturnType<typeof decideAnchor> {
    return decideAnchor({ writer: signerAt(tree, { keyRoot }), layout: { root: tree }, upcasters });
  }

  /** A key root holding a key that has never opened a writer over the tree. */
  function unopened(prefix: string): { keyRoot: string; fingerprint: string } {
    const keyRoot = tmp(prefix);
    return { keyRoot, fingerprint: signerAt(tree, { keyRoot }).signerFingerprint };
  }

  it('for a key new to the tree: the anchor it would found — and the tree untouched by asking', () => {
    ensureFounded(machine('mnema-same-a-').ctx);
    const b = unopened('mnema-same-b-');
    const before = listing(tree);

    const without = asked(b.keyRoot);
    // No public half, no installation id, no tail: the asking left the tree as it was.
    expect(listing(tree)).toEqual(before);
    expect(without).toEqual({ anchor: deriveAnchor(b.fingerprint), source: 'unfounded' });
    // And a writer, which DOES materialize the half, reaches the same answer.
    expect(decideAnchor(open(b.keyRoot).ctx)).toEqual(without);
  });

  it('for a key another machine enrolled: the identity it joined, both ways', () => {
    const a = machine('mnema-same-a-');
    const anchor = ensureFounded(a.ctx);
    const b = unopened('mnema-same-b-');
    materializePublicKey({ root: tree }, publicHalfOf(b));
    enrollKey(a.ctx, { newFp: b.fingerprint, reverseSig: consentOf(b, anchor) });

    const without = asked(b.keyRoot);
    expect(without).toEqual({ anchor, source: 'adopted', membership: 'enrolled' });
    expect(decideAnchor(open(b.keyRoot).ctx)).toEqual(without);
  });

  it('for a key the record proves in two identities: both refuse, and neither picks', () => {
    const a = machine('mnema-same-a-');
    const anchorA = ensureFounded(a.ctx);
    const c = machine('mnema-same-c-');
    const anchorC = ensureFounded(c.ctx);
    const k = unopened('mnema-same-k-');
    materializePublicKey({ root: tree }, publicHalfOf(k));
    enrollKey(a.ctx, { newFp: k.fingerprint, reverseSig: consentOf(k, anchorA) });
    enrollKey(c.ctx, { newFp: k.fingerprint, reverseSig: consentOf(k, anchorC) });

    const refusalOf = (decide: () => unknown): string | undefined => {
      try {
        decide();
      } catch (error) {
        return (error as IdentityUnavailableError).code;
      }
      return undefined;
    };
    expect(refusalOf(() => asked(k.keyRoot))).toBe('AMBIGUOUS_MEMBERSHIP');
    expect(refusalOf(() => decideAnchor(open(k.keyRoot).ctx))).toBe('AMBIGUOUS_MEMBERSHIP');
  });
});

describe('the way out, with three identities — the words for more than two', () => {
  /** A key root holding a key that has never opened a writer over the tree. */
  function joiner(prefix: string): { keyRoot: string; fingerprint: string } {
    const keyRoot = tmp(prefix);
    return { keyRoot, fingerprint: signerAt(tree, { keyRoot }).signerFingerprint };
  }

  /** The refusal the record gives for the key, whole. */
  function refusalFor(k: { keyRoot: string; fingerprint: string }): string {
    const refused = membershipIn({ tree, upcasters }, publicHalfOf(k));
    expect(refused).toMatchObject({ ok: false, code: 'AMBIGUOUS_MEMBERSHIP' });
    return (refused as { message: string }).message;
  }

  it('enrolled into three, having founded none: the others let it go, each by a member of its own', () => {
    const founders = ['x', 'y', 'w'].map((name) => machine(`mnema-three-${name}-`));
    const anchors = founders.map((m) => ensureFounded(m.ctx));
    const k = joiner('mnema-three-k-');
    materializePublicKey({ root: tree }, publicHalfOf(k));
    founders.forEach((m, i) => {
      enrollKey(m.ctx, { newFp: k.fingerprint, reverseSig: consentOf(k, anchors[i] as string) });
    });

    const said = refusalFor(k);
    expect(said).toContain('It speaks for one of them again once the others let it go');
    expect(said).toContain(
      'a machine whose writes here speak for each identity that should not have it runs',
    );
    expect(said).toContain(`\`mnema key revoke ${k.fingerprint} --reason "<why>"\``);
  });

  it('founded one and enrolled into two: it speaks for the one it founded once both others let go', () => {
    const founders = ['x', 'y'].map((name) => machine(`mnema-three-${name}-`));
    const anchors = founders.map((m) => ensureFounded(m.ctx));
    // This key WRITES first, so it founds an identity of its own — whose only key it is.
    const k = machine('mnema-three-k-');
    const own = ensureFounded(k.ctx);
    founders.forEach((m, i) => {
      enrollKey(m.ctx, { newFp: k.fingerprint, reverseSig: consentOf(k, anchors[i] as string) });
    });

    const said = refusalFor(k);
    expect(said).toContain(
      `It speaks for ${own} again once ${anchors[0]} and ${anchors[1]} let it go: a machine whose writes here speak for each of them runs`,
    );
    // Leaving the one it founded would still leave the key in two identities, where no restore
    // chooses: with three, that way out is not handed over.
    expect(said).not.toContain('Or it can leave');
    expect(said).not.toContain('mnema key restore');
  });
});
