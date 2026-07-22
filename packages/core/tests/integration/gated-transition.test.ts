/**
 * The gated write operation end to end: a transition passes through the gate,
 * lands on the real chain, and the projection reflects it — and an illegal or
 * unproven move writes nothing at all.
 *
 * This crosses packages (the core operation drives a real @mnema/chain tail on
 * disk), so it lives here rather than beside a source file.
 *
 * `who` is never passed in: the operation derives it from the writer's own key
 * (the anchor), so these tests assert the DERIVED identity, not a typed-in one.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  openChainForWriting,
  type UpcasterRegistry,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents } from '../../src/projections/order.js';
import { projectTasks } from '../../src/projections/task.js';
import { createTask, transitionTask, type WriteContext } from '../../src/workflow/operations.js';

let root: string;
let writer: ChainWriter;
let layout: ChainLayout;
let upcasters: UpcasterRegistry;

/** A deterministic, monotonic clock so `at` never depends on the wall clock. */
let tick = 0;
const clock = () => {
  tick += 1;
  return `2026-07-21T00:00:${String(tick).padStart(2, '0')}.000Z`;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-gated-'));
  writer = openChainForWriting(root);
  layout = { root };
  upcasters = catalogUpcasters();
  tick = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function ctx(): WriteContext {
  return { writer, layout, upcasters, clock };
}

/** Current projected state of a task read straight from the chain. */
function stateOf(id: string): string | undefined {
  return projectTasks(orderedEvents(layout, upcasters)).get(id)?.state;
}

/** Number of events currently on the chain. */
function eventCount(): number {
  return orderedEvents(layout, upcasters).length;
}

describe('createTask', () => {
  it('appends the birth pair and projects a DRAFT task', () => {
    const result = createTask(ctx(), { id: 't-1', title: 'ship it', which: 'claude' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe('t-1');
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].event.kind).toBe('task.created');
      expect(result.entries[1].event.kind).toBe('task.transitioned');
    }
    expect(stateOf('t-1')).toBe('DRAFT');
    expect(eventCount()).toBe(2);
  });

  it('stamps both birth events with one uniform `at`', () => {
    createTask(ctx(), { id: 't-1', title: 't' });
    const events = orderedEvents(layout, upcasters);
    expect(events[0]?.at).toBe(events[1]?.at);
    expect(events[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('refuses creation where the agent IS the authorizing anchor, and writes nothing', () => {
    // The only self-authorization a caller can now attempt is naming the
    // writer's own anchor as the executing agent. That is still refused.
    const result = createTask(ctx(), { id: 't-1', title: 't', which: writer.anchor });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    expect(eventCount()).toBe(0);
  });

  it('rejects an id the chain cannot represent, and writes nothing', () => {
    const result = createTask(ctx(), { id: '\ud800bad', title: 't' });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_TASK' });
    expect(eventCount()).toBe(0);
  });

  it('births atomically: a failed write leaves NO orphan task.created', () => {
    // The birth pair must be all-or-nothing. If the write fails, the chain must
    // not carry a created-but-stateless task, which would burn the id forever.
    // A writer whose batch append throws stands in for a disk/IO failure — it
    // still exposes an anchor so identity derivation happens before the write.
    const boom = {
      anchor: writer.anchor,
      signerFingerprint: writer.signerFingerprint,
      appendAll() {
        throw new Error('disk full');
      },
      append() {
        throw new Error('should not be called — birth must be one atomic write');
      },
    } as unknown as ChainWriter;
    const brokenCtx: WriteContext = { writer: boom, layout, upcasters, clock };
    expect(() => createTask(brokenCtx, { id: 't-1', title: 't' })).toThrow('disk full');
    // Nothing reached the real tail: no half-birth to re-read.
    expect(eventCount()).toBe(0);
  });
});

describe('transitionTask — authorized moves persist and project', () => {
  beforeEach(() => {
    createTask(ctx(), { id: 't-1', title: 'task', which: 'claude' });
  });

  it('a legal transition appends and the projection reflects it', () => {
    const result = transitionTask(ctx(), { id: 't-1', action: 'submit', which: 'claude' });
    expect(result).toMatchObject({ ok: true, to: 'READY' });
    expect(stateOf('t-1')).toBe('READY');
    expect(eventCount()).toBe(3);
  });

  it('records `to` from the workflow, not the caller, and carries proof through', () => {
    transitionTask(ctx(), { id: 't-1', action: 'submit' });
    transitionTask(ctx(), { id: 't-1', action: 'start', which: 'claude' });
    const done = transitionTask(ctx(), {
      id: 't-1',
      action: 'complete',
      fields: { note: 'shipped', pr_url: 'https://x/1' },
      which: 'claude',
    });
    expect(done).toMatchObject({ ok: true, to: 'DONE' });
    expect(stateOf('t-1')).toBe('DONE');
    const last = orderedEvents(layout, upcasters).at(-1);
    if (last?.kind === 'task.transitioned') {
      expect(last.payload).toMatchObject({
        from: 'IN_PROGRESS',
        to: 'DONE',
        action: 'complete',
        fields: { note: 'shipped', pr_url: 'https://x/1' },
      });
    }
  });

  it('stamps the transition `at` from the uniform clock', () => {
    transitionTask(ctx(), { id: 't-1', action: 'submit' });
    const last = orderedEvents(layout, upcasters).at(-1);
    expect(last?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('transitionTask — refused moves write NOTHING', () => {
  beforeEach(() => {
    createTask(ctx(), { id: 't-1', title: 'task', which: 'claude' });
  });

  it('an illegal transition writes nothing and leaves state unchanged', () => {
    const before = eventCount();
    // A DRAFT task cannot be completed.
    const result = transitionTask(ctx(), {
      id: 't-1',
      action: 'complete',
      fields: { note: 'x' },
    });
    expect(result).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(eventCount()).toBe(before);
    expect(stateOf('t-1')).toBe('DRAFT');
  });

  it('a missing required proof field writes nothing', () => {
    transitionTask(ctx(), { id: 't-1', action: 'submit' });
    const before = eventCount();
    // cancel requires a reason.
    const result = transitionTask(ctx(), { id: 't-1', action: 'cancel' });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF', field: 'reason' });
    expect(eventCount()).toBe(before);
    expect(stateOf('t-1')).toBe('READY');
  });

  it('a self-authorized move (agent == the anchor) writes nothing', () => {
    const before = eventCount();
    const result = transitionTask(ctx(), {
      id: 't-1',
      action: 'submit',
      which: writer.anchor,
    });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    expect(eventCount()).toBe(before);
  });

  it('transitioning a nonexistent task writes nothing', () => {
    const before = eventCount();
    const result = transitionTask(ctx(), { id: 'ghost', action: 'submit' });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_TASK' });
    expect(eventCount()).toBe(before);
  });
});

describe('transitionTask — gated against the chain, not a stale cache', () => {
  it('reads current state from the chain so each move is judged against the truth', () => {
    createTask(ctx(), { id: 't-1', title: 'task', which: 'claude' });
    // Walk DRAFT → READY → IN_PROGRESS → BLOCKED, then the only legal move is
    // unblock. Completing from BLOCKED must be refused — proof the gate saw the
    // real current state, BLOCKED, not the initial DRAFT.
    transitionTask(ctx(), { id: 't-1', action: 'submit' });
    transitionTask(ctx(), { id: 't-1', action: 'start', which: 'claude' });
    transitionTask(ctx(), { id: 't-1', action: 'block', fields: { reason: 'waiting' } });
    expect(stateOf('t-1')).toBe('BLOCKED');

    const bad = transitionTask(ctx(), {
      id: 't-1',
      action: 'complete',
      fields: { note: 'x' },
    });
    expect(bad).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });

    const good = transitionTask(ctx(), { id: 't-1', action: 'unblock', which: 'claude' });
    expect(good).toMatchObject({ ok: true, to: 'IN_PROGRESS' });
    expect(stateOf('t-1')).toBe('IN_PROGRESS');
  });
});

describe('derived identity — who is the anchor, not a typed-in name', () => {
  /** The `who`/`which`/`signerFp` of the last event on the chain. */
  function lastActor(): { who: string; which?: string; signerFp: string } {
    const events = orderedEvents(layout, upcasters);
    const last = events[events.length - 1];
    if (last === undefined) throw new Error('no events');
    return {
      who: last.who,
      signerFp: last.signerFp,
      ...(last.which !== undefined ? { which: last.which } : {}),
    };
  }

  it('createTask records the writer anchor as who and its fingerprint as signerFp', () => {
    const result = createTask(ctx(), { id: 't-1', title: 't' });
    expect(result.ok).toBe(true);
    const events = orderedEvents(layout, upcasters);
    // Both birth events carry the derived identity, byte-identical.
    for (const e of events) {
      expect(e.who).toBe(writer.anchor);
      expect(e.signerFp).toBe(writer.signerFingerprint);
    }
    // The anchor is the mnid form, distinct from the bare fingerprint.
    expect(writer.anchor.startsWith('mnid:')).toBe(true);
    expect(writer.anchor).not.toBe(writer.signerFingerprint);
  });

  it('transitionTask records the same derived who/signerFp as creation', () => {
    createTask(ctx(), { id: 't-1', title: 't', which: 'claude' });
    transitionTask(ctx(), { id: 't-1', action: 'submit', which: 'claude' });
    const actor = lastActor();
    expect(actor.who).toBe(writer.anchor);
    expect(actor.signerFp).toBe(writer.signerFingerprint);
    expect(actor.which).toBe('claude');
  });

  it('records the trimmed which, not the raw input (which is still caller-supplied)', () => {
    createTask(ctx(), { id: 't-1', title: 't', which: '  claude  ' });
    expect(lastActor().which).toBe('claude');
  });

  it('a whitespace-only which is dropped, not recorded as an empty agent', () => {
    createTask(ctx(), { id: 't-1', title: 't', which: '   ' });
    // The agent was blank; the birth records the anchor alone, no which.
    const actor = lastActor();
    expect(actor.who).toBe(writer.anchor);
    expect(actor.which).toBeUndefined();
  });

  it('who != which holds against a whitespace/composition variant of the anchor', () => {
    // A caller cannot slip past self-authorization by spacing or decomposing the
    // anchor: canonical identity settles both before the comparison.
    const spaced = `  ${writer.anchor}  `;
    const created = createTask(ctx(), { id: 't-1', title: 't', which: spaced });
    expect(created).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    expect(eventCount()).toBe(0);
  });

  it('resolves a task id through a Unicode composition difference (id lookup is canonical)', () => {
    // The subject is stored NFC; a later transition that names the id in a
    // different composition must still resolve, not miss as UNKNOWN_TASK.
    const nfc = 'café-task'; // composed
    const nfd = 'café-task'; // decomposed — same identity once NFC-normalized
    const created = createTask(ctx(), { id: nfc, title: 't' });
    expect(created.ok).toBe(true);
    const moved = transitionTask(ctx(), { id: nfd, action: 'submit' });
    expect(moved).toMatchObject({ ok: true, to: 'READY' });
    // The stored subject is the single NFC form.
    expect(stateOf(nfc)).toBe('READY');
  });
});
