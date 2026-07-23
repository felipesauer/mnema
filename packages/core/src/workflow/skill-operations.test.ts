import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  openChainForWriting,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents } from '../projections/order.js';
import { projectSkills } from '../projections/skill.js';
import type { Clock } from './clock.js';
import {
  adoptSkill,
  createSkill,
  deprecateSkill,
  rejectSkill,
  reviewSkill,
  type SkillWriteContext,
} from './skill-operations.js';

const upcasters = catalogUpcasters();
const WHICH = 'claude';

let root: string;
let roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-skill-'));
  roots = [root];
});

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A clock the test drives, so `at` is deterministic across appends. */
function fixedClock(): { clock: Clock; tick: () => void } {
  let n = 0;
  return {
    clock: () => `2026-07-23T00:00:${String(n).padStart(2, '0')}.000Z`,
    tick: () => {
      n += 1;
    },
  };
}

function contextFor(w: ChainWriter, r: string, clock: Clock): SkillWriteContext {
  const layout: ChainLayout = { root: r };
  return { writer: w, layout, upcasters, clock };
}

/** Creates a skill and returns its minted id. */
function mustCreate(
  ctx: SkillWriteContext,
  input: { name: string; body: string; which?: string },
): string {
  const result = createSkill(ctx, input);
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.id;
}

/** Reads the skills the chain currently proves. */
function skillsOf(r: string) {
  return projectSkills(orderedEvents({ root: r }, upcasters));
}

describe('createSkill — birth', () => {
  it('mints an id the caller never supplies, and starts proposed', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    const id = mustCreate(contextFor(w, root, clock), {
      name: 'Small PRs',
      body: 'One slice per PR; merge before the next.',
      which: WHICH,
    });
    const s = skillsOf(root).get(id);
    expect(s?.state).toBe('proposed');
    expect(s?.name).toBe('Small PRs');
    expect(s?.body).toBe('One slice per PR; merge before the next.');
  });

  it('mints a distinct id for each create (no caller-chosen id to reuse)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const first = mustCreate(ctx, { name: 'a', body: 'x' });
    tick();
    const second = mustCreate(ctx, { name: 'b', body: 'y' });
    expect(first).not.toBe(second);
    const s = skillsOf(root);
    expect(s.get(first)?.name).toBe('a');
    expect(s.get(second)?.name).toBe('b');
  });

  it('records the writer anchor as who, distinct from the signing fingerprint', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    mustCreate(contextFor(w, root, clock), { name: 't', body: 'b' });
    for (const e of orderedEvents({ root }, upcasters)) {
      expect(e.who).toBe(w.anchor);
      expect(e.signerFp).toBe(w.signerFingerprint);
    }
    expect(w.anchor.startsWith('mnid:')).toBe(true);
    expect(w.anchor).not.toBe(w.signerFingerprint);
  });

  it('refuses a skill where the agent IS the authorizing anchor', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    const result = createSkill(contextFor(w, root, clock), {
      name: 't',
      body: 'b',
      which: w.anchor,
    });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
  });
});

describe('the skill transitions are gated against the chain', () => {
  it('walks the full life: proposed → reviewed → adopted → deprecated', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustCreate(ctx, { name: 't', body: 'b' });
    tick();

    expect(reviewSkill(ctx, { id, fields: { note: 'looked' } })).toMatchObject({
      ok: true,
      to: 'reviewed',
    });
    tick();
    expect(adoptSkill(ctx, { id, fields: { note: 'use it' } })).toMatchObject({
      ok: true,
      to: 'adopted',
    });
    tick();
    expect(deprecateSkill(ctx, { id, fields: { reason: 'obsolete' } })).toMatchObject({
      ok: true,
      to: 'deprecated',
    });
    expect(skillsOf(root).get(id)?.state).toBe('deprecated');
  });

  it('rejects a proposed skill directly (no review needed)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustCreate(ctx, { name: 't', body: 'b' });
    tick();
    expect(rejectSkill(ctx, { id, fields: { note: 'no' } })).toMatchObject({
      ok: true,
      to: 'rejected',
    });
  });

  it('review requires a note (proof enforced at write time)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustCreate(ctx, { name: 't', body: 'b' });
    tick();
    expect(reviewSkill(ctx, { id })).toMatchObject({ ok: false, code: 'MISSING_PROOF' });
    // Nothing was written — the skill is still proposed.
    expect(skillsOf(root).get(id)?.state).toBe('proposed');
  });

  it('refuses a transition on a skill that does not exist', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    const result = reviewSkill(contextFor(w, root, clock), {
      id: 'sk-ghost',
      fields: { note: 'n' },
    });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_SKILL' });
  });

  it('refuses adopt straight from proposed (must be reviewed first)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustCreate(ctx, { name: 't', body: 'b' });
    tick();
    expect(adoptSkill(ctx, { id, fields: { note: 'skip review' } })).toMatchObject({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
    });
  });

  it('refuses to reject an adopted skill (no retroactive rejection)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustCreate(ctx, { name: 't', body: 'b' });
    tick();
    reviewSkill(ctx, { id, fields: { note: 'ok' } });
    tick();
    adoptSkill(ctx, { id, fields: { note: 'yes' } });
    tick();
    expect(rejectSkill(ctx, { id, fields: { note: 'changed mind' } })).toMatchObject({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
    });
    // Still adopted — the illegal move wrote nothing.
    expect(skillsOf(root).get(id)?.state).toBe('adopted');
  });

  it('refuses any move out of a deprecated skill (terminal)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustCreate(ctx, { name: 't', body: 'b' });
    tick();
    reviewSkill(ctx, { id, fields: { note: 'ok' } });
    tick();
    adoptSkill(ctx, { id, fields: { note: 'yes' } });
    tick();
    deprecateSkill(ctx, { id, fields: { reason: 'old' } });
    tick();
    expect(reviewSkill(ctx, { id, fields: { note: 'revive?' } })).toMatchObject({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
    });
  });
});

describe('rebuild is byte-identical: replaying the events reproduces the projection', () => {
  it('a projection folded twice from the same chain agrees', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustCreate(ctx, { name: 't', body: 'b' });
    tick();
    reviewSkill(ctx, { id, fields: { note: 'ok' } });

    const once = skillsOf(root);
    const twice = skillsOf(root);
    expect([...twice.entries()]).toEqual([...once.entries()]);
    expect(once.get(id)?.state).toBe('reviewed');
  });
});

describe('skill — end to end: a clone reconstructs and verifies from events alone', () => {
  it('the CLONE reconstructs the adopted skill from the chain, and verifies', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustCreate(ctx, { name: 'Small PRs', body: 'One slice per PR.' });
    tick();
    reviewSkill(ctx, { id, fields: { note: 'looked' } });
    tick();
    adoptSkill(ctx, { id, fields: { note: 'use it' } });
    // Checkpoint so the tail is fully signed for an anonymous verify.
    w.checkpoint();

    const clone = mkdtempSync(join(tmpdir(), 'mnema-skill-clone-'));
    roots.push(clone);
    cpSync(root, clone, { recursive: true });

    // Reconstruct from the chain alone — no cache copied.
    const s = projectSkills(orderedEvents({ root: clone }, upcasters)).get(id);
    expect(s?.state).toBe('adopted');
    expect(s?.name).toBe('Small PRs');
    expect(s?.body).toBe('One slice per PR.');

    // The anonymous verifier accepts the chain.
    const verdict = verify(clone);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });
});
