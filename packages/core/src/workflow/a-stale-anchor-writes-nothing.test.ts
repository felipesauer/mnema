import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  anchorPath,
  catalogUpcasters,
  deriveAnchor,
  openChainForWriting,
  publicKeyPath,
  signerAt,
  writeAnchor,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestEnrollment } from '../identity/handshake.js';
import { IdentityUnavailableError, rosterOf } from '../identity/membership.js';
import { enrollFromRequest, revokeMember } from '../identity/roster.js';
import {
  captureMemory,
  linkKnowledge,
  recordHandoff,
  recordObservation,
} from '../knowledge/operations.js';
import { ProjectionCache } from '../projections/cache.js';
import { chainArrivals, chainReplay, orderedEvents } from '../projections/order.js';
import * as writeSurface from '../write.js';
import { recordChannelAsked, recordChannelServed, switchChannel } from './channel-operations.js';
import {
  acceptDecision,
  recordDecision,
  rejectDecision,
  supersedeDecision,
} from './decision-operations.js';
import {
  type AnchorContext,
  enrollKey,
  ensureFounded,
  establishIdentity,
  recordedAnchorOf,
  revokeKey,
} from './identity-operations.js';
import { createTask, transitionTask, type WriteContext } from './operations.js';
import { authorizeTailPrune } from './prune-operations.js';
import { endRun, startRun } from './session-operations.js';
import {
  adoptSkill,
  createSkill,
  deprecateSkill,
  recordConsultation,
  rejectSkill,
  reviewSkill,
} from './skill-operations.js';

/**
 * A checkout whose recorded identity no longer counts its key writes NOTHING — through every
 * write the surface has.
 *
 * THE TRAP. A checkout records, locally, which identity it writes as, and nothing read that file
 * again: a key that left the identity — retired by this checkout's own `key revoke`, or by another
 * member and pulled in — went on signing as it. Every such write succeeded and left `verify`
 * failing on the record for good. Measured on the built binary before this existed, with git
 * clones (`code/tests/the-checkout-a-key-left.test.ts` holds the binary's cases now). The write
 * asks, before it appends, whether the recorded identity's roster still counts its key
 * (`ensureFounded`), and refuses with `STALE_ANCHOR` — naming the way out, never taking it.
 *
 * WHY A SWEEP. The question lives in ONE function, which every append goes through, and that is
 * the claim to test rather than to trust: every function the writing surface exports is driven
 * here from such a checkout and must append nothing — or is declared, with the reason, as one
 * that appends nothing at all — and the set is reconciled against the surface's own exports, so a
 * write added tomorrow is unclassified and RED until it is driven. Each drive has a CONTROL: the
 * same call made by a member that still counts goes through, so a refusal here is the anchor's
 * and never an input this file got wrong.
 *
 * THE COST, MEASURED — each number against two worktrees of the base commit, pairs alternated,
 * and the base-against-base control within its own noise (±22 µs in process, ±0.65 ms over MCP,
 * ±7 ms on the command line). The question is a roster, and where the caller holds nothing it is
 * a replay of the tree: in process, a later write went from ~0.9 ms to ~6.2 ms at 1,000 events
 * and to ~65 ms at 10,000 (+5.2 to +5.6 ms and +63 to +70 ms). On the command line, one per
 * command over a floor of ~180 ms: +21 ms at 1,036 events, +33 ms at 3,036, +101 ms at 10,036,
 * +264 ms at 30,036 — linear, and paid on the person's side, where a command holds nothing to
 * derive it from. The MCP session holds the record in order already and asks its cache instead
 * (`ProjectionCache.rosterAsOfNow`, the last describe here): a warm session's public write went
 * from ~2.0–2.4 ms to ~2.9–3.9 ms and its private one by +0.2 to +0.9 ms, flat from 100 events to
 * 10,000. A connection whose first call writes has no cache and pays the replay.
 */

const upcasters = catalogUpcasters();

let tree: string;
let homes: string[];

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), 'mnema-stale-anchor-'));
  homes = [];
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** A key root of its own — one machine, one key. */
function keyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mnema-stale-anchor-key-'));
  homes.push(root);
  return root;
}

/** A write context for the key under `root`, in the tree of this case. */
function contextOf(root: string, at = tree): WriteContext {
  return {
    writer: openChainForWriting(at, { keyRoot: root }),
    layout: { root: at },
    upcasters,
  };
}

function eventCount(): number {
  return orderedEvents({ root: tree }, upcasters).length;
}

/** Brings the key under `joining` into the identity `by` writes as, vouched by `by`. */
function join_(by: WriteContext, anchor: string, joining: string): string {
  const asked = requestEnrollment({ anchor, keyRoot: joining });
  if (!asked.ok) throw new Error(`the request could not be made: ${asked.code}`);
  const joined = enrollFromRequest(by, { request: asked.request });
  if (!joined.ok) throw new Error(`the key did not join: ${joined.code}`);
  return joined.fingerprint;
}

/** The refusal a drive threw, or undefined when it did not throw. */
function thrownBy(drive: () => unknown): unknown {
  try {
    drive();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('a checkout the key left writes nothing, through every write of the surface', () => {
  /** K founded A and let N in; then N retired K — the shape in which K's checkout hears nothing. */
  function aCheckoutTheKeyLeft() {
    const left = contextOf(keyRoot());
    const anchor = ensureFounded(left);
    const memberRoot = keyRoot();
    join_(left, anchor, memberRoot);
    const member = contextOf(memberRoot);

    // What the drives act on, made by the member while K still counts: nothing below may be
    // refused for a record that lacks it.
    const made = (result: { readonly ok: boolean; readonly id?: string }, what: string): string => {
      if (!result.ok || result.id === undefined) throw new Error(`setup: ${what}`);
      return result.id;
    };
    const task = made(createTask(member, { title: 'a task to move' }), 'task');
    const decisions = [1, 2, 3, 4].map((n) =>
      made(recordDecision(member, { title: `decision ${n}`, rationale: 'why' }), 'decision'),
    );
    const proposed = [1, 2].map((n) =>
      made(createSkill(member, { name: `proposed ${n}`, body: 'b' }), 'skill'),
    );
    const reviewed = made(createSkill(member, { name: 'reviewed', body: 'b' }), 'skill');
    if (!reviewSkill(member, { id: reviewed, fields: { note: 'n' } }).ok) throw new Error('setup');
    const adopted = made(createSkill(member, { name: 'adopted', body: 'b' }), 'skill');
    if (!reviewSkill(member, { id: adopted, fields: { note: 'n' } }).ok) throw new Error('setup');
    if (!adoptSkill(member, { id: adopted, fields: { note: 'n' } }).ok) throw new Error('setup');
    const run = startRun(member, { agent: 'the member' });
    if (!run.ok) throw new Error('setup: run');
    const joiner = requestEnrollment({ anchor, keyRoot: keyRoot() });
    const another = requestEnrollment({ anchor, keyRoot: keyRoot() });
    if (!joiner.ok || !another.ok) throw new Error('setup: requests');

    const retired = revokeMember(member, {
      fingerprint: left.writer.signerFingerprint,
      reason: 'the laptop leaves',
    });
    if (!retired.ok) throw new Error(`setup: the retirement was refused: ${retired.code}`);

    return {
      left,
      member,
      anchor,
      fixtures: { task, decisions, proposed, reviewed, adopted, run: run.id, joiner, another },
    };
  }

  type Shape = ReturnType<typeof aCheckoutTheKeyLeft>;

  /** One write, as a checkout drives it: `as` is the context, `who` says which of the two it is. */
  interface Probe {
    readonly op: string;
    /**
     * `the anchor` — the question every append asks refuses it (`STALE_ANCHOR`, thrown).
     * `the roster` — the verb's own check refuses first, before a writer is opened
     * (`CANNOT_VOUCH`, returned), because a vouch or a retirement signed by a key the roster does
     * not count would be rejected by the verifier; nothing is appended either way.
     */
    readonly refusedBy: 'the anchor' | 'the roster';
    readonly drive: (as: WriteContext, who: 'left' | 'member', shape: Shape) => unknown;
  }

  const PROBES: readonly Probe[] = [
    {
      op: 'createTask',
      refusedBy: 'the anchor',
      drive: (as) => createTask(as, { title: 't' }),
    },
    {
      op: 'transitionTask',
      refusedBy: 'the anchor',
      drive: (as, _, s) => transitionTask(as, { id: s.fixtures.task, action: 'submit' }),
    },
    {
      op: 'recordDecision',
      refusedBy: 'the anchor',
      drive: (as) => recordDecision(as, { title: 't', rationale: 'why' }),
    },
    {
      op: 'acceptDecision',
      refusedBy: 'the anchor',
      drive: (as, _, s) =>
        acceptDecision(as, { id: s.fixtures.decisions[0] as string, fields: { note: 'n' } }),
    },
    {
      op: 'rejectDecision',
      refusedBy: 'the anchor',
      drive: (as, _, s) =>
        rejectDecision(as, { id: s.fixtures.decisions[1] as string, fields: { note: 'n' } }),
    },
    {
      op: 'supersedeDecision',
      refusedBy: 'the anchor',
      drive: (as, _, s) =>
        supersedeDecision(as, {
          id: s.fixtures.decisions[2] as string,
          by: s.fixtures.decisions[3] as string,
          fields: { reason: 'r' },
        }),
    },
    {
      op: 'createSkill',
      refusedBy: 'the anchor',
      drive: (as) => createSkill(as, { name: 'n', body: 'b' }),
    },
    {
      op: 'reviewSkill',
      refusedBy: 'the anchor',
      drive: (as, _, s) =>
        reviewSkill(as, { id: s.fixtures.proposed[0] as string, fields: { note: 'n' } }),
    },
    {
      op: 'rejectSkill',
      refusedBy: 'the anchor',
      drive: (as, _, s) =>
        rejectSkill(as, { id: s.fixtures.proposed[1] as string, fields: { note: 'n' } }),
    },
    {
      op: 'adoptSkill',
      refusedBy: 'the anchor',
      drive: (as, _, s) => adoptSkill(as, { id: s.fixtures.reviewed, fields: { note: 'n' } }),
    },
    {
      op: 'deprecateSkill',
      refusedBy: 'the anchor',
      drive: (as, _, s) => deprecateSkill(as, { id: s.fixtures.adopted, fields: { reason: 'r' } }),
    },
    {
      op: 'recordConsultation',
      refusedBy: 'the anchor',
      drive: (as, _, s) => recordConsultation(as, { skill: s.fixtures.adopted }),
    },
    {
      op: 'captureMemory',
      refusedBy: 'the anchor',
      drive: (as) => captureMemory(as, { content: 'c' }),
    },
    {
      op: 'recordObservation',
      refusedBy: 'the anchor',
      drive: (as) => recordObservation(as, { about: 'x', topic: 'k', text: 't' }),
    },
    {
      op: 'recordHandoff',
      refusedBy: 'the anchor',
      drive: (as) => recordHandoff(as, { task: 't', fromAgent: 'a', toAgent: 'b' }),
    },
    {
      op: 'linkKnowledge',
      refusedBy: 'the anchor',
      drive: (as) => linkKnowledge(as, { subject: 'x', target: 'y', rel: 'r' }),
    },
    {
      op: 'startRun',
      refusedBy: 'the anchor',
      drive: (as) => startRun(as, { agent: 'a' }),
    },
    {
      op: 'endRun',
      refusedBy: 'the anchor',
      drive: (as, _, s) => endRun(as, { run: s.fixtures.run, which: 'the member' }),
    },
    {
      op: 'switchChannel',
      refusedBy: 'the anchor',
      drive: (as) => switchChannel(as, { channel: 'edit-rules-push', on: false }),
    },
    {
      op: 'recordChannelServed',
      refusedBy: 'the anchor',
      drive: (as) => recordChannelServed(as, { channel: 'edit-rules-push' }),
    },
    {
      op: 'recordChannelAsked',
      refusedBy: 'the anchor',
      drive: (as) =>
        recordChannelAsked(as, { channel: 'edit-asks-a-person', rule: 'r', path: 'src/x.ts' }),
    },
    {
      // A waiver names another installation's tail: each side names the other's.
      op: 'authorizeTailPrune',
      refusedBy: 'the anchor',
      drive: (as, who, s) =>
        authorizeTailPrune(as, {
          tail: who === 'left' ? s.member.writer.tail : s.left.writer.tail,
          reason: 'r',
        }),
    },
    {
      op: 'enrollKey',
      refusedBy: 'the anchor',
      drive: (as) => enrollKey(as, { newFp: 'f'.repeat(64), reverseSig: 'ab' }),
    },
    {
      op: 'revokeKey',
      refusedBy: 'the anchor',
      drive: (as) => revokeKey(as, { revokedFp: 'e'.repeat(64), reason: 'r' }),
    },
    {
      op: 'ensureFounded',
      refusedBy: 'the anchor',
      drive: (as) => ensureFounded(as),
    },
    {
      op: 'establishIdentity',
      refusedBy: 'the anchor',
      drive: (as) => establishIdentity(as, { keyRoot: keyRoot() }),
    },
    {
      op: 'enrollFromRequest',
      refusedBy: 'the roster',
      drive: (as, _, s) =>
        enrollFromRequest(as, {
          request: s.fixtures.joiner.ok ? s.fixtures.joiner.request : '',
        }),
    },
    {
      // Driven AFTER the enrollment above, whose control brought in the key it retires here.
      op: 'revokeMember',
      refusedBy: 'the roster',
      drive: (as, _, s) => {
        const joined = s.fixtures.joiner.ok ? s.fixtures.joiner.request : '';
        const fingerprint = writeSurface.decodeKeyRequest(joined)?.key.fingerprint ?? '';
        return revokeMember(as, { fingerprint, reason: 'r' });
      },
    },
  ];

  /** The exports that append nothing, each with the reason — the other half of the reconciliation. */
  const APPENDS_NOTHING: Readonly<Record<string, string>> = {
    authorizingAnchor: 'reads which anchor this installation serves',
    decideAnchor: 'settles the same question without writing',
    decodeKeyRequest: 'parses a request line',
    deferredWrite: 'pairs a signer with a writer it has not opened',
    encodeKeyRequest: 'serializes one',
    openTreeForWriting: 'opens a writer; the write is the caller’s',
    recordedAnchorOf:
      'asks the question every append asks — whether the recorded identity counts the key',
    requestEnrollment: 'produces a request and may mint a key, in the key root',
    restoreKey: 'records an anchor from the record — the way out this refusal names',
    signerFor: 'reads who would sign in a tree',
  };

  it('classifies every function the writing surface exports', () => {
    const exported = Object.entries(writeSurface)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    const driven = PROBES.map((probe) => probe.op);
    expect(new Set(driven).size, 'an op driven twice').toBe(driven.length);
    expect([...driven, ...Object.keys(APPENDS_NOTHING)].sort()).toEqual(exported);
  });

  it('refuses each one and appends nothing — and the member it did not leave writes the same call', () => {
    const shape = aCheckoutTheKeyLeft();
    // The trap is really there: the recorded identity does not count the key any more.
    expect(shape.left.writer.anchor).toBe(shape.anchor);
    expect(
      rosterOf({ tree, upcasters }, shape.anchor).has(shape.left.writer.signerFingerprint),
    ).toBe(false);

    for (const probe of PROBES) {
      const before = eventCount();
      let returned: unknown;
      const thrown = thrownBy(() => {
        returned = probe.drive(shape.left, 'left', shape);
      });
      expect(eventCount(), `${probe.op} appended from the checkout the key left`).toBe(before);
      if (probe.refusedBy === 'the anchor') {
        expect(thrown, probe.op).toBeInstanceOf(IdentityUnavailableError);
        expect((thrown as IdentityUnavailableError).code, probe.op).toBe('STALE_ANCHOR');
      } else {
        expect(thrown, probe.op).toBeUndefined();
        expect(returned, probe.op).toMatchObject({ ok: false, code: 'CANNOT_VOUCH' });
      }

      // THE CONTROL: the same call, by the member, is not refused.
      const control = probe.drive(shape.member, 'member', shape);
      const refused =
        typeof control === 'object' && control !== null && 'ok' in control && !control.ok;
      expect(
        refused,
        `${probe.op} was refused for the member too: ${JSON.stringify(control)}`,
      ).toBe(false);
    }
  });

  it('refuses the checkout that retired its own key the same way, the moment it has', () => {
    const left = contextOf(keyRoot());
    const anchor = ensureFounded(left);
    join_(left, anchor, keyRoot());
    const retired = revokeMember(left, {
      fingerprint: left.writer.signerFingerprint,
      reason: 'this laptop retires',
    });
    expect(retired.ok).toBe(true);
    const before = eventCount();
    const thrown = thrownBy(() => captureMemory(left, { content: 'written after it left' }));
    expect((thrown as IdentityUnavailableError).code).toBe('STALE_ANCHOR');
    expect(eventCount()).toBe(before);
  });
});

describe('what the refusal says, by what the record proves about the key', () => {
  /** The refusal a memory written through `ctx` gets. */
  function refusalOf(ctx: WriteContext): IdentityUnavailableError {
    const thrown = thrownBy(() => captureMemory(ctx, { content: 'a write' }));
    expect(thrown).toBeInstanceOf(IdentityUnavailableError);
    const refusal = thrown as IdentityUnavailableError;
    expect(refusal.code).toBe('STALE_ANCHOR');
    return refusal;
  }

  it('a member of one other identity: the restore that points the checkout there, and its file', () => {
    // K founds A; M founds J and brings K in; N joins A and K leaves it — the way out, done.
    const k = keyRoot();
    const left = contextOf(k);
    const anchor = ensureFounded(left);
    const other = contextOf(keyRoot());
    const j = ensureFounded(other);
    join_(other, j, k);
    join_(left, anchor, keyRoot());
    expect(revokeMember(left, { fingerprint: left.writer.signerFingerprint, reason: 'r' }).ok).toBe(
      true,
    );

    const refusal = refusalOf(left);
    expect(refusal.message).toBe(
      `this checkout records ${anchor} as the identity it writes as, and the record does not count this key among that identity's keys — a write signed with it there would leave the whole record failing verification, so none is made. The record proves the key a member of ${j}: \`mnema key restore "<the key file>"\` here makes this checkout write as it`,
    );
    expect(refusal.restores).toBe(left.writer.signerFingerprint);
  });

  it('a member of none: nothing it signs verifies, and a pull may bring the identity a restore needs', () => {
    // The retirement is this checkout's own, of its own key, with the key it let in left behind.
    const left = contextOf(keyRoot());
    const anchor = ensureFounded(left);
    join_(left, anchor, keyRoot());
    expect(revokeMember(left, { fingerprint: left.writer.signerFingerprint, reason: 'r' }).ok).toBe(
      true,
    );
    const refusal = refusalOf(left);
    expect(refusal.message).toContain(
      `this checkout records ${anchor} as the identity it writes as, and the record does not count this key among that identity's keys, nor among the keys of any other identity here: it was retired`,
    );
    expect(refusal.message).toContain(
      'If the record, once pulled, proves it a member of another identity, `mnema key restore "<the key file>"` here makes this checkout write as it',
    );
    expect(refusal.restores).toBe(left.writer.signerFingerprint);
  });

  it('a member of more than one: the ambiguity a fresh clone is told, and no restore', () => {
    const k = keyRoot();
    const left = contextOf(k);
    const anchor = ensureFounded(left);
    const first = contextOf(keyRoot());
    const second = contextOf(keyRoot());
    join_(first, ensureFounded(first), k);
    join_(second, ensureFounded(second), k);
    join_(left, anchor, keyRoot());
    expect(revokeMember(left, { fingerprint: left.writer.signerFingerprint, reason: 'r' }).ok).toBe(
      true,
    );
    const refusal = refusalOf(left);
    expect(refusal.message).toContain(
      "among that identity's keys; this key belongs to more than one identity in that record (",
    );
    expect(refusal.restores).toBeUndefined();
  });

  it.each([
    ['with', true],
    ['without', false],
  ])(
    'an anchor recorded with no founding behind it, %s the key’s public half: delete the file',
    (_, withHalf) => {
      // What the code before the anchor followed the founding left when a first write failed: the
      // anchor file, naming the identity the key would have founded, and nothing on the record —
      // written here by the function that code wrote it with.
      const k = keyRoot();
      const scratchTree = mkdtempSync(join(tmpdir(), 'mnema-stale-anchor-scratch-'));
      homes.push(scratchTree);
      const machine = contextOf(k, scratchTree);
      const fingerprint = machine.writer.signerFingerprint;
      const derived = deriveAnchor(fingerprint);
      writeAnchor({ root: tree }, fingerprint, derived);
      if (withHalf) {
        const scratch = contextOf(k, machine.layout.root);
        ensureFounded(scratch);
        for (const name of readdirSync(join(machine.layout.root, 'keys'))) {
          if (name === `${fingerprint}.pub`) {
            cpSync(
              join(machine.layout.root, 'keys', name),
              publicKeyPath({ root: tree }, fingerprint),
            );
          }
        }
      }
      const left = contextOf(k);
      expect(left.writer.anchor).toBe(derived);
      const refusal = refusalOf(left);
      expect(refusal.message).toBe(
        `this checkout records ${derived} as the identity it writes as, and nothing in the record founded an identity with this key or enrolled it into one — there is no identity for it to leave: delete ${anchorPath({ root: tree }, fingerprint)}, and the next write here decides again, from the record, as a first write does`,
      );
      expect(refusal.restores).toBeUndefined();

      // Followed: the file goes, and the next write founds — the record then counts the key.
      rmSync(anchorPath({ root: tree }, fingerprint));
      const founded = contextOf(k);
      expect(captureMemory(founded, { content: 'after the file went' }).ok).toBe(true);
      expect(rosterOf({ tree, upcasters }, derived).has(fingerprint)).toBe(true);
    },
  );

  it('a tree that lost the half the record needs: said as that, never with the deletion', () => {
    // K enrolled into J, which it writes as; then the tree loses the half that proves it.
    const k = keyRoot();
    const other = contextOf(keyRoot());
    const j = ensureFounded(other);
    const fingerprint = join_(other, j, k);
    const left = contextOf(k);
    expect(captureMemory(left, { content: 'adopts J' }).ok).toBe(true);
    expect(left.writer.anchor).toBe(j);
    rmSync(publicKeyPath({ root: tree }, fingerprint));

    const refusal = refusalOf(left);
    expect(refusal.message).toContain("this tree does not carry the key's public half");
    expect(refusal.message).toContain(publicKeyPath({ root: tree }, fingerprint));
    expect(refusal.message).not.toContain('delete');
  });
});

describe('the roster a write asks is the one the caller hands it, when it hands one', () => {
  it('asks the context’s reading, and replays the record only where the context has none', () => {
    const k = keyRoot();
    const ctx = contextOf(k);
    const anchor = ensureFounded(ctx);
    const fingerprint = ctx.writer.signerFingerprint;
    // A reading that does not count the key refuses even though the record does…
    const refused = thrownBy(() =>
      captureMemory({ ...ctx, roster: () => new Set<string>() }, { content: 'x' }),
    );
    expect((refused as IdentityUnavailableError).code).toBe('STALE_ANCHOR');
    // …a reading that does lets it through; and one that has nothing to read falls back to the
    // replay, which counts it.
    expect(
      captureMemory({ ...ctx, roster: () => new Set([fingerprint]) }, { content: 'y' }).ok,
    ).toBe(true);
    expect(captureMemory({ ...ctx, roster: () => undefined }, { content: 'z' }).ok).toBe(true);
    expect(rosterOf({ tree, upcasters }, anchor).has(fingerprint)).toBe(true);
  });
});

describe('recordedAnchorOf — the question a write asks, asked by what only reads', () => {
  it('answers nothing before an anchor is recorded, the identity while it counts, and the write’s own refusal once it does not', () => {
    const k = keyRoot();
    // Asked of the SIGNER, as `mnema init` asks it — nothing is opened, nothing is recorded.
    const signer = (): AnchorContext => ({
      writer: signerAt(tree, { keyRoot: k }),
      layout: { root: tree },
      upcasters,
    });
    expect(recordedAnchorOf(signer())).toBeUndefined();

    const left = contextOf(k);
    const anchor = ensureFounded(left);
    const memberRoot = keyRoot();
    join_(left, anchor, memberRoot);
    expect(recordedAnchorOf(signer())).toEqual({ anchor, counted: true });
    expect(recordedAnchorOf(left)).toEqual({ anchor, counted: true });

    const member = contextOf(memberRoot);
    expect(
      revokeMember(member, { fingerprint: left.writer.signerFingerprint, reason: 'r' }).ok,
    ).toBe(true);
    const before = eventCount();
    const asked = recordedAnchorOf(signer());
    expect(eventCount()).toBe(before);
    if (asked === undefined || asked.counted)
      throw new Error(`not refused: ${JSON.stringify(asked)}`);
    expect(asked.anchor).toBe(anchor);
    expect(asked.refusal.code).toBe('STALE_ANCHOR');
    // The SAME refusal the write gets — the words and the file its restore takes — because the
    // write asks this very function before it appends.
    const thrown = thrownBy(() => captureMemory(left, { content: 'written after it left' }));
    expect(thrown).toBeInstanceOf(IdentityUnavailableError);
    expect((thrown as IdentityUnavailableError).message).toBe(asked.refusal.message);
    expect((thrown as IdentityUnavailableError).restores).toBe(asked.refusal.restores);
    expect(eventCount()).toBe(before);
  });

  it('asks the roster the caller hands it, where it hands one', () => {
    const ctx = contextOf(keyRoot());
    const anchor = ensureFounded(ctx);
    expect(recordedAnchorOf({ ...ctx, roster: () => new Set<string>() })).toMatchObject({
      anchor,
      counted: false,
    });
    expect(recordedAnchorOf({ ...ctx, roster: () => undefined })).toEqual({
      anchor,
      counted: true,
    });
  });
});

describe('ProjectionCache.rosterAsOfNow — the roster a session asks, equal to a replay', () => {
  it('agrees with a replay before and after another key retires this one, and moves nothing', () => {
    const k = keyRoot();
    const left = contextOf(k);
    const anchor = ensureFounded(left);
    const memberRoot = keyRoot();
    join_(left, anchor, memberRoot);
    const cache = ProjectionCache.open(tree, { upcasters });
    try {
      cache.rebuild();
      const replayed = (): Set<string> => rosterOf({ tree, upcasters }, anchor);
      expect(cache.rosterAsOfNow(anchor)).toEqual(replayed());
      expect(cache.rosterAsOfNow(anchor).has(left.writer.signerFingerprint)).toBe(true);

      // The retirement arrives on ANOTHER tail after the cache read — the shape of a pull.
      const member = contextOf(memberRoot);
      expect(
        revokeMember(member, { fingerprint: left.writer.signerFingerprint, reason: 'r' }).ok,
      ).toBe(true);
      expect(cache.rosterAsOfNow(anchor)).toEqual(replayed());
      expect(cache.rosterAsOfNow(anchor).has(left.writer.signerFingerprint)).toBe(false);

      // And it brought nothing forward: the tables still stand where the rebuild left them.
      expect(cache.listMemories()).toHaveLength(0);
      expect(captureMemory(member, { content: 'after the retirement' }).ok).toBe(true);
      expect(cache.listMemories()).toHaveLength(0);
      cache.refresh();
      expect(cache.listMemories()).toHaveLength(1);
    } finally {
      cache.close();
    }
  });

  it('replays the record whole where what arrived out of order changes the answer', () => {
    // The other half of the fall-back: the order in hand says the key counts, and what arrived —
    // stamped before something the cache covers — says it does not. K founds A and lets N in; N
    // goes offline on a copy; K writes on (2030) and the cache reads; offline, N retires K (2025).
    // Placed by the merge, the retirement falls after the founding and before K's last write,
    // so the key is out; the order the cache holds alone would still count it.
    const at = (instant: string) => () => instant;
    const k = keyRoot();
    const left = { ...contextOf(k), clock: at('2020-01-01T00:00:00.000Z') };
    const anchor = ensureFounded(left);
    const nRoot = keyRoot();
    const asked = requestEnrollment({ anchor, keyRoot: nRoot });
    if (!asked.ok) throw new Error('setup: request');
    expect(enrollFromRequest(left, { request: asked.request }).ok).toBe(true);
    const offline = mkdtempSync(join(tmpdir(), 'mnema-stale-anchor-offline-'));
    homes.push(offline);
    cpSync(tree, offline, { recursive: true });
    const later = { ...left, clock: at('2030-01-01T00:00:00.000Z') };
    expect(captureMemory(later, { content: 'K writes on' }).ok).toBe(true);

    const cache = ProjectionCache.open(tree, { upcasters });
    try {
      cache.rebuild();
      const before = chainReplay({ root: tree }, upcasters).frontier;
      expect(cache.rosterAsOfNow(anchor).has(left.writer.signerFingerprint)).toBe(true);

      const n = { ...contextOf(nRoot, offline), clock: at('2025-01-01T00:00:00.000Z') };
      expect(revokeMember(n, { fingerprint: left.writer.signerFingerprint, reason: 'r' }).ok).toBe(
        true,
      );
      const theirs = n.writer.tail;
      cpSync(join(offline, 'tails', theirs), join(tree, 'tails', theirs), { recursive: true });

      const arrived = chainArrivals({ root: tree }, upcasters, before);
      expect(arrived.suffix ? '' : arrived.why).toBe('AN_ARRIVAL_IS_NOT_LATER');
      const replayed = rosterOf({ tree, upcasters }, anchor);
      expect(replayed.has(left.writer.signerFingerprint)).toBe(false);
      expect(cache.rosterAsOfNow(anchor)).toEqual(replayed);
    } finally {
      cache.close();
    }
  });

  it('replays the record whole where the order of what arrived decides the answer', () => {
    // The shape in which the ORDER decides the roster, so the fall-back is what answers. K founds
    // A and lets N and P in. P goes offline on a copy. In the tree, N retires K (2030), and the
    // cache reads. Offline, P — which never saw that — retires K (2024) and enrolls it again
    // (2025), and its tail arrives later. Appended behind what the cache holds, the re-enrollment
    // would come LAST and K would count; placed by the merge, the 2030 retirement comes last and
    // K does not. Only the replay says which, and that is the answer asked for.
    const at = (instant: string) => () => instant;
    const k = keyRoot();
    const left = { ...contextOf(k), clock: at('2020-01-01T00:00:00.000Z') };
    const anchor = ensureFounded(left);
    const nRoot = keyRoot();
    const pRoot = keyRoot();
    for (const root of [nRoot, pRoot]) {
      const asked = requestEnrollment({ anchor, keyRoot: root });
      if (!asked.ok) throw new Error('setup: request');
      expect(enrollFromRequest(left, { request: asked.request }).ok).toBe(true);
    }
    const offline = mkdtempSync(join(tmpdir(), 'mnema-stale-anchor-offline-'));
    homes.push(offline);
    cpSync(tree, offline, { recursive: true });

    const n = { ...contextOf(nRoot), clock: at('2030-01-01T00:00:00.000Z') };
    expect(revokeMember(n, { fingerprint: left.writer.signerFingerprint, reason: 'r' }).ok).toBe(
      true,
    );

    const cache = ProjectionCache.open(tree, { upcasters });
    try {
      cache.rebuild();
      const before = chainReplay({ root: tree }, upcasters).frontier;

      const early = { ...contextOf(pRoot, offline), clock: at('2024-01-01T00:00:00.000Z') };
      expect(
        revokeMember(early, { fingerprint: left.writer.signerFingerprint, reason: 'r' }).ok,
      ).toBe(true);
      const again = requestEnrollment({ anchor, keyRoot: k });
      if (!again.ok) throw new Error('setup: the request to come back');
      const later = { ...contextOf(pRoot, offline), clock: at('2025-01-01T00:00:00.000Z') };
      expect(enrollFromRequest(later, { request: again.request }).ok).toBe(true);
      const theirs = later.writer.tail;
      cpSync(join(offline, 'tails', theirs), join(tree, 'tails', theirs), { recursive: true });

      // The shape really is not a suffix, so the fall-back is the path this case takes…
      const arrived = chainArrivals({ root: tree }, upcasters, before);
      expect(arrived.suffix ? '' : arrived.why).toBe('AN_ARRIVAL_IS_NOT_LATER');
      // …and the order matters: behind the cache's order, the key would count.
      const replayed = rosterOf({ tree, upcasters }, anchor);
      expect(replayed.has(left.writer.signerFingerprint)).toBe(false);
      expect(cache.rosterAsOfNow(anchor)).toEqual(replayed);
    } finally {
      cache.close();
    }
  });
});
