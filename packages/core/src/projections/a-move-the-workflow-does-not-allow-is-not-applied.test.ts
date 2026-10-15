/**
 * A MOVE THE WORKFLOW DOES NOT ALLOW IS NOT APPLIED — by any reading (FORMAT.md §6.7).
 *
 * Each record here is one the product's writes could not have made since the gate judges the
 * chain, and that a person with the machine's key can: a move appended by hand and signed. It
 * verifies, because every byte is intact; what it lacks is a place in the workflow, and so every
 * reading of the record reads the subject as if it had not been written — the replay, the cache
 * brought forward, the reading of one subject a gate makes — and the divergences do not take it
 * for two machines that had not seen each other.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CatalogEvent,
  catalogUpcasters,
  decisionTransitioned,
  openChainForWriting,
  subjectEvents,
  taskTransitioned,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acceptDecision,
  type DecisionWriteContext,
  recordDecision,
  rejectDecision,
} from '../workflow/decision-operations.js';
import { createTask, transitionTask } from '../workflow/operations.js';
import { ProjectionCache } from './cache.js';
import { projectDecisions } from './decision.js';
import { divergentMoves } from './divergent-moves.js';
import { orderedEvents } from './order.js';
import { projectTasks } from './task.js';

const upcasters = catalogUpcasters();
let root: string;
let keys: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-not-applied-'));
  keys = mkdtempSync(join(tmpdir(), 'mnema-not-applied-keys-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(keys, { recursive: true, force: true });
});

function writing(): DecisionWriteContext {
  return {
    writer: openChainForWriting(root, { keyRoot: keys, citeHeads: true }),
    layout: { root },
    upcasters,
  };
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`setup refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

/** Appends `event` with the machine's own key and signs over it: a move past every gate. */
function byHand(ctx: DecisionWriteContext, event: CatalogEvent): void {
  ctx.writer.append(event);
  ctx.writer.checkpoint();
}

function envelope(ctx: DecisionWriteContext, subject: string) {
  return {
    at: new Date(Date.now() + 1_000).toISOString(),
    who: ctx.writer.anchor,
    signerFp: ctx.writer.signerFingerprint,
    subject,
  };
}

/** What every reading says of a decision: the replay, the cache, and one subject's own lines. */
function readings(id: string) {
  const cache = ProjectionCache.open(root, { upcasters });
  try {
    cache.rebuild();
    return {
      replay: projectDecisions(orderedEvents({ root }, upcasters)).get(id)?.state,
      cache: cache.getDecision(id)?.state,
      subject: projectDecisions(subjectEvents({ root }, upcasters, [id]).get(id) ?? []).get(id)
        ?.state,
    };
  } finally {
    cache.close();
  }
}

describe('a move written by hand past the gate is not applied', () => {
  it('reads a decision rejected, then moved rejected → accepted by hand, as rejected everywhere', () => {
    const ctx = writing();
    const { id } = ok(recordDecision(ctx, { title: 'Use X', rationale: 'because' }));
    ok(rejectDecision(ctx, { id, fields: { note: 'no' } }));
    byHand(
      ctx,
      decisionTransitioned(envelope(ctx, id), {
        from: 'rejected',
        to: 'accepted',
        action: 'accept',
        fields: { note: 'by hand' },
      }),
    );
    expect(readings(id)).toEqual({ replay: 'rejected', cache: 'rejected', subject: 'rejected' });
    // Verified, and named: the verdict is what it was, with one note more.
    const verdict = verify(root, upcasters);
    expect(verdict.ok).toBe(true);
    expect(verdict.census.filter((note) => note.kind === 'illegal-move')).toHaveLength(1);
  });

  it('reads a state that is not one of the workflow as never reached', () => {
    const ctx = writing();
    const { id } = ok(recordDecision(ctx, { title: 'Use X', rationale: 'because' }));
    byHand(
      ctx,
      decisionTransitioned(envelope(ctx, id), {
        from: 'proposed',
        to: 'banana',
        action: 'teleport',
      }),
    );
    expect(readings(id)).toEqual({ replay: 'proposed', cache: 'proposed', subject: 'proposed' });
  });

  it('takes a second move out of one state, on the tail that saw the first, for no divergence', () => {
    // The cache edited back on one machine, or two writes racing before the tail had a lock: one
    // tail, two moves out of `proposed`. Its writer had seen the first; the second is not a move
    // of two machines that did not see each other, and is not said as one.
    const ctx = writing();
    const { id } = ok(recordDecision(ctx, { title: 'Use X', rationale: 'because' }));
    ok(rejectDecision(ctx, { id, fields: { note: 'no' } }));
    byHand(
      ctx,
      decisionTransitioned(envelope(ctx, id), {
        from: 'proposed',
        to: 'accepted',
        action: 'accept',
        fields: { note: 'again' },
      }),
    );
    expect(readings(id)).toEqual({ replay: 'rejected', cache: 'rejected', subject: 'rejected' });
    expect(divergentMoves(orderedEvents({ root }, upcasters))).toEqual([]);
  });

  it('reads a task moved out of a state it had left by hand as where it stood', () => {
    const ctx = writing();
    const { id } = ok(createTask(ctx, { title: 'Ship it' }));
    ok(transitionTask(ctx, { id, action: 'cancel', fields: { reason: 'not needed' } }));
    byHand(
      ctx,
      taskTransitioned(envelope(ctx, id), { from: 'READY', to: 'IN_PROGRESS', action: 'start' }),
    );
    expect(projectTasks(orderedEvents({ root }, upcasters)).get(id)?.state).toBe('CANCELED');
  });
});

describe('the gate judges a move from the state the readers keep', () => {
  it('lets a decision a move written by hand did not move be moved as it stands', () => {
    // An acceptance without the note its row requires is not applied: the decision is still
    // proposed to every reader, and so to the gate, which lets it be rejected.
    const ctx = writing();
    const { id } = ok(recordDecision(ctx, { title: 'Use X', rationale: 'because' }));
    byHand(
      ctx,
      decisionTransitioned(envelope(ctx, id), {
        from: 'proposed',
        to: 'accepted',
        action: 'accept',
      }),
    );
    expect(ok(rejectDecision(ctx, { id, fields: { note: 'no' } })).to).toBe('rejected');
    expect(acceptDecision(ctx, { id, fields: { note: 'yes' } })).toMatchObject({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
    });
  });
});
