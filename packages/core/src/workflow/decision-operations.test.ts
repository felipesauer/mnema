import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  openChainForWriting,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adrCollisions, projectDecisions } from '../projections/decision.js';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from './clock.js';
import {
  acceptDecision,
  type DecisionWriteContext,
  recordDecision,
  rejectDecision,
  supersedeDecision,
} from './decision-operations.js';

const upcasters = catalogUpcasters();
const WHICH = 'claude';

let root: string;
let roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-decision-'));
  roots = [root];
});

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A clock the test drives, so `at` is deterministic across appends. */
function fixedClock(): { clock: Clock; tick: () => void } {
  let n = 0;
  return {
    clock: () => `2026-07-21T00:00:${String(n).padStart(2, '0')}.000Z`,
    tick: () => {
      n += 1;
    },
  };
}

function contextFor(w: ChainWriter, r: string, clock: Clock): DecisionWriteContext {
  const layout: ChainLayout = { root: r };
  return { writer: w, layout, upcasters, clock };
}

/** Reads the decisions the chain currently proves. */
function decisionsOf(r: string) {
  return projectDecisions(orderedEvents({ root: r }, upcasters));
}

describe('recordDecision — the frozen ADR label', () => {
  it('assigns ADR-1 to the first decision and freezes it in the event', () => {
    const w = openChainForWriting(root);
    const { clock } = fixedClock();
    const result = recordDecision(contextFor(w, root, clock), {
      id: 'd-1',
      title: 'Use SQLite',
      rationale: 'Relational load.',
      which: WHICH,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.adr).toBe('ADR-1');
      // The label is part of the recorded fact, not derived on read.
      expect(decisionsOf(root).get('d-1')?.adr).toBe('ADR-1');
    }
  });

  it('numbers decisions sequentially as they are recorded', () => {
    const w = openChainForWriting(root);
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    for (const id of ['d-1', 'd-2', 'd-3']) {
      recordDecision(ctx, { id, title: id, rationale: 'r' });
      tick();
    }
    const d = decisionsOf(root);
    expect(d.get('d-1')?.adr).toBe('ADR-1');
    expect(d.get('d-2')?.adr).toBe('ADR-2');
    expect(d.get('d-3')?.adr).toBe('ADR-3');
  });

  it('records the writer anchor as who, distinct from the signing fingerprint', () => {
    const w = openChainForWriting(root);
    const { clock } = fixedClock();
    const result = recordDecision(contextFor(w, root, clock), {
      id: 'd-1',
      title: 't',
      rationale: 'r',
    });
    expect(result.ok).toBe(true);
    for (const e of orderedEvents({ root }, upcasters)) {
      expect(e.who).toBe(w.anchor);
      expect(e.signerFp).toBe(w.signerFingerprint);
    }
    expect(w.anchor.startsWith('mnid:')).toBe(true);
    expect(w.anchor).not.toBe(w.signerFingerprint);
  });

  it('refuses a decision where the agent IS the authorizing anchor', () => {
    const w = openChainForWriting(root);
    const { clock } = fixedClock();
    const result = recordDecision(contextFor(w, root, clock), {
      id: 'd-1',
      title: 't',
      rationale: 'r',
      which: w.anchor,
    });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });

  it('refuses a reused id (a decision is recorded once)', () => {
    const w = openChainForWriting(root);
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const first = recordDecision(ctx, { id: 'd-1', title: 'a', rationale: 'r' });
    expect(first.ok && first.adr).toBe('ADR-1');
    tick();
    const dup = recordDecision(ctx, { id: 'd-1', title: 'b', rationale: 'r' });
    expect(dup).toMatchObject({ ok: false, code: 'ALREADY_RECORDED' });
    // The first record is untouched: still ADR-1, still its own title.
    const d = decisionsOf(root).get('d-1');
    expect(d?.adr).toBe('ADR-1');
    expect(d?.title).toBe('a');
  });
});

describe('the frozen number does not slip when a concurrent decision merges in', () => {
  // Two clones work offline. Clone A records d-aaa then
  // d-ccc and cites "ADR-2" (d-ccc). Clone B records d-bbb concurrently. After
  // the offline merge, a number DERIVED on read would renumber d-ccc to ADR-3
  // and make "ADR-2" point at d-bbb — the citation would lie. Because the
  // number is FROZEN at write time, d-ccc stays ADR-2 forever.
  it('a citation stays pointed at the decision it was written for', () => {
    const rootB = mkdtempSync(join(tmpdir(), 'mnema-decision-b-'));
    roots.push(rootB);

    // Clone A: two decisions, ADR-1 (d-aaa) then ADR-2 (d-ccc).
    const a = openChainForWriting(root);
    const ca = fixedClock();
    const ctxA = contextFor(a, root, ca.clock);
    recordDecision(ctxA, { id: 'd-aaa', title: 'a', rationale: 'r' });
    ca.tick();
    const cited = recordDecision(ctxA, { id: 'd-ccc', title: 'c', rationale: 'r' });
    expect(cited.ok && cited.adr).toBe('ADR-2'); // the human cites "ADR-2" = d-ccc

    // Clone B (its own tail/key): a concurrent decision, also ADR-1 locally.
    const b = openChainForWriting(rootB);
    const cb = fixedClock();
    recordDecision(contextFor(b, rootB, cb.clock), {
      id: 'd-bbb',
      title: 'b',
      rationale: 'r',
    });

    // Offline merge: B's tail and key land in A's chain.
    cpSync(join(rootB, 'tails'), join(root, 'tails'), { recursive: true });
    cpSync(join(rootB, 'keys'), join(root, 'keys'), { recursive: true });

    // After the merge d-ccc is STILL ADR-2 — the citation did not slip.
    const merged = decisionsOf(root);
    expect(merged.get('d-ccc')?.adr).toBe('ADR-2');
    expect(merged.get('d-aaa')?.adr).toBe('ADR-1');
    expect(merged.get('d-bbb')?.adr).toBe('ADR-1'); // B's local number
  });

  it('surfaces the label collision the merge created (ADR-1 now held by two)', () => {
    const rootB = mkdtempSync(join(tmpdir(), 'mnema-decision-b-'));
    roots.push(rootB);
    const a = openChainForWriting(root);
    recordDecision(contextFor(a, root, fixedClock().clock), {
      id: 'd-aaa',
      title: 'a',
      rationale: 'r',
    });
    const b = openChainForWriting(rootB);
    recordDecision(contextFor(b, rootB, fixedClock().clock), {
      id: 'd-bbb',
      title: 'b',
      rationale: 'r',
    });
    cpSync(join(rootB, 'tails'), join(root, 'tails'), { recursive: true });
    cpSync(join(rootB, 'keys'), join(root, 'keys'), { recursive: true });

    const collisions = adrCollisions(decisionsOf(root).values());
    expect(collisions).toEqual([{ adr: 'ADR-1', ids: ['d-aaa', 'd-bbb'] }]);
  });
});

describe('the decision transitions are gated against the chain', () => {
  it('accepts a proposed decision, requiring a note', () => {
    const w = openChainForWriting(root);
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    recordDecision(ctx, { id: 'd-1', title: 't', rationale: 'r' });
    tick();
    const missing = acceptDecision(ctx, { id: 'd-1' });
    expect(missing).toMatchObject({ ok: false, code: 'MISSING_PROOF' });
    const ok = acceptDecision(ctx, { id: 'd-1', fields: { note: 'agreed' } });
    expect(ok).toMatchObject({ ok: true, to: 'accepted' });
    expect(decisionsOf(root).get('d-1')?.state).toBe('accepted');
  });

  it('rejects a proposed decision', () => {
    const w = openChainForWriting(root);
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    recordDecision(ctx, { id: 'd-1', title: 't', rationale: 'r' });
    tick();
    const ok = rejectDecision(ctx, { id: 'd-1', fields: { note: 'no' } });
    expect(ok).toMatchObject({ ok: true, to: 'rejected' });
  });

  it('refuses a transition on a decision that does not exist', () => {
    const w = openChainForWriting(root);
    const { clock } = fixedClock();
    const result = acceptDecision(contextFor(w, root, clock), {
      id: 'd-ghost',
      fields: { note: 'n' },
    });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_DECISION' });
  });

  it('refuses an illegal move (accept an already-accepted decision)', () => {
    const w = openChainForWriting(root);
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    recordDecision(ctx, { id: 'd-1', title: 't', rationale: 'r' });
    tick();
    acceptDecision(ctx, { id: 'd-1', fields: { note: 'ok' } });
    tick();
    const again = acceptDecision(ctx, { id: 'd-1', fields: { note: 'again' } });
    expect(again).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
  });
});

describe('supersede — the multi-entity move, with existence enforced', () => {
  function twoDecisions(): { ctx: DecisionWriteContext; tick: () => void } {
    const w = openChainForWriting(root);
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    recordDecision(ctx, { id: 'd-1', title: 'old', rationale: 'r' });
    tick();
    recordDecision(ctx, { id: 'd-2', title: 'new', rationale: 'r' });
    tick();
    return { ctx, tick };
  }

  it('supersedes an accepted decision and links both sides', () => {
    const { ctx, tick } = twoDecisions();
    acceptDecision(ctx, { id: 'd-1', fields: { note: 'ok' } });
    tick();
    const ok = supersedeDecision(ctx, {
      id: 'd-1',
      by: 'd-2',
      fields: { reason: 'replaced' },
    });
    expect(ok).toMatchObject({ ok: true, to: 'superseded' });
    const d = decisionsOf(root);
    expect(d.get('d-1')?.state).toBe('superseded');
    expect(d.get('d-1')?.supersededBy).toBe('d-2');
    expect(d.get('d-2')?.supersedes).toBe('d-1');
  });

  it('supersedes directly from proposed (no accept needed)', () => {
    const { ctx } = twoDecisions();
    const ok = supersedeDecision(ctx, {
      id: 'd-1',
      by: 'd-2',
      fields: { reason: 'r' },
    });
    expect(ok).toMatchObject({ ok: true, to: 'superseded' });
  });

  it('refuses a supersede whose successor does not exist (UNKNOWN_BY, anti-dangling)', () => {
    const { ctx } = twoDecisions();
    const result = supersedeDecision(ctx, {
      id: 'd-1',
      by: 'd-ghost',
      fields: { reason: 'r' },
    });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_BY' });
    // Nothing was written — d-1 is still proposed.
    expect(decisionsOf(root).get('d-1')?.state).toBe('proposed');
  });

  it('refuses a self-supersede (SELF_SUPERSEDE from the gate)', () => {
    const { ctx } = twoDecisions();
    const result = supersedeDecision(ctx, {
      id: 'd-1',
      by: 'd-1',
      fields: { reason: 'r' },
    });
    expect(result).toMatchObject({ ok: false, code: 'SELF_SUPERSEDE' });
  });

  it('refuses a supersede whose subject does not exist (UNKNOWN_DECISION)', () => {
    const { ctx } = twoDecisions();
    const result = supersedeDecision(ctx, {
      id: 'd-ghost',
      by: 'd-2',
      fields: { reason: 'r' },
    });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_DECISION' });
  });

  it('resolves a successor across Unicode composition (NFD id, NFC on disk)', () => {
    // The chain stores every string NFC, so a decision recorded under an NFD id
    // is read back NFC. The operation canonicalizes the id (NFC) on every path,
    // so a supersede whose `by` is the decomposed spelling still resolves and
    // both sides of the link key on the identical NFC string. The id here is
    // "cafe" + U+0301 (combining acute), built at runtime so the source
    // encoding cannot silently pre-compose it.
    const nfd = `d-cafe${String.fromCharCode(0x0301)}`;
    const nfc = nfd.normalize('NFC'); // what the chain stores / the projection keys on
    expect(nfc).not.toBe(nfd); // the two spellings really differ
    const w = openChainForWriting(root);
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    recordDecision(ctx, { id: 'd-old', title: 'old', rationale: 'r' });
    tick();
    recordDecision(ctx, { id: nfd, title: 'new', rationale: 'r' });
    tick();
    const ok = supersedeDecision(ctx, {
      id: 'd-old',
      by: nfd,
      fields: { reason: 'r' },
    });
    expect(ok).toMatchObject({ ok: true, to: 'superseded' });
    const d = decisionsOf(root);
    // Both sides key on the NFC form — no composition split.
    expect(d.get('d-old')?.supersededBy).toBe(nfc);
    expect(d.get(nfc)?.supersedes).toBe('d-old');
  });

  it('refuses to supersede an already-superseded decision (terminal)', () => {
    const { ctx, tick } = twoDecisions();
    // Record a third to be a second successor candidate.
    recordDecision(ctx, { id: 'd-3', title: 'newer', rationale: 'r' });
    tick();
    supersedeDecision(ctx, { id: 'd-1', by: 'd-2', fields: { reason: 'r' } });
    tick();
    const again = supersedeDecision(ctx, {
      id: 'd-1',
      by: 'd-3',
      fields: { reason: 'r' },
    });
    expect(again).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
  });
});
