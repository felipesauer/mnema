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
  // keyRoot == chainRoot: the simple single-root layout for these tests.
  writer = openChainForWriting(root, { keyRoot: root });
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

/**
 * Creates a task and returns its minted id. The operation generates the id now,
 * so a test that later transitions the task carries back the id it was given.
 */
function mustCreate(input: { title: string; which?: string }): string {
  const result = createTask(ctx(), input);
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.id;
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
  it('appends the birth pair, mints a v7 id, and projects a DRAFT task', () => {
    const result = createTask(ctx(), { title: 'ship it', which: 'claude' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The id is minted by the operation and handed back; it is a v7 UUID.
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].event.kind).toBe('task.created');
      expect(result.entries[1].event.kind).toBe('task.transitioned');
      // The subject the events carry is exactly the returned id.
      expect(result.entries[0].event.subject).toBe(result.id);
      expect(stateOf(result.id)).toBe('DRAFT');
    }
    // The founding (seq 0) precedes the birth pair on a fresh installation.
    expect(eventCount()).toBe(3);
  });

  it('mints a distinct id on each create', () => {
    const first = mustCreate({ title: 'a' });
    const second = mustCreate({ title: 'b' });
    expect(first).not.toBe(second);
    // Two creates are two tasks — no false-merge from a shared caller id.
    const tasks = projectTasks(orderedEvents(layout, upcasters));
    expect(tasks.size).toBe(2);
  });

  it('stamps both birth events with one uniform `at`', () => {
    mustCreate({ title: 't' });
    const events = orderedEvents(layout, upcasters);
    // events[0] is the founding; the birth pair is events[1] and events[2],
    // which share one `at`.
    expect(events[1]?.at).toBe(events[2]?.at);
    expect(events[1]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('refuses creation where the agent IS the authorizing anchor, and writes nothing', () => {
    // The only self-authorization a caller can now attempt is naming the
    // writer's own anchor as the executing agent. That is still refused.
    const result = createTask(ctx(), { title: 't', which: writer.anchor });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
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
      hasAnchor: true, // already founded, so ensureFounded is a no-op here
      appendAll() {
        throw new Error('disk full');
      },
      append() {
        throw new Error('should not be called — birth must be one atomic write');
      },
    } as unknown as ChainWriter;
    const brokenCtx: WriteContext = { writer: boom, layout, upcasters, clock };
    expect(() => createTask(brokenCtx, { title: 't' })).toThrow('disk full');
    // Nothing reached the real tail: no half-birth to re-read.
    expect(eventCount()).toBe(0);
  });
});

describe('transitionTask — authorized moves persist and project', () => {
  let taskId: string;
  beforeEach(() => {
    taskId = mustCreate({ title: 'task', which: 'claude' });
  });

  it('a legal transition appends and the projection reflects it', () => {
    const result = transitionTask(ctx(), { id: taskId, action: 'submit', which: 'claude' });
    expect(result).toMatchObject({ ok: true, to: 'READY' });
    expect(stateOf(taskId)).toBe('READY');
    // founding + birth pair + this transition.
    expect(eventCount()).toBe(4);
  });

  it('records `to` from the workflow, not the caller, and carries proof through', () => {
    transitionTask(ctx(), { id: taskId, action: 'submit' });
    transitionTask(ctx(), { id: taskId, action: 'start', which: 'claude' });
    const done = transitionTask(ctx(), {
      id: taskId,
      action: 'complete',
      fields: { note: 'shipped', pr_url: 'https://x/1' },
      which: 'claude',
    });
    expect(done).toMatchObject({ ok: true, to: 'DONE' });
    expect(stateOf(taskId)).toBe('DONE');
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
    transitionTask(ctx(), { id: taskId, action: 'submit' });
    const last = orderedEvents(layout, upcasters).at(-1);
    expect(last?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('transitionTask — refused moves write NOTHING', () => {
  let taskId: string;
  beforeEach(() => {
    taskId = mustCreate({ title: 'task', which: 'claude' });
  });

  it('an illegal transition writes nothing and leaves state unchanged', () => {
    const before = eventCount();
    // A DRAFT task cannot be completed.
    const result = transitionTask(ctx(), {
      id: taskId,
      action: 'complete',
      fields: { note: 'x' },
    });
    expect(result).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(eventCount()).toBe(before);
    expect(stateOf(taskId)).toBe('DRAFT');
  });

  it('a missing required proof field writes nothing', () => {
    transitionTask(ctx(), { id: taskId, action: 'submit' });
    const before = eventCount();
    // cancel requires a reason.
    const result = transitionTask(ctx(), { id: taskId, action: 'cancel' });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF', field: 'reason' });
    expect(eventCount()).toBe(before);
    expect(stateOf(taskId)).toBe('READY');
  });

  it('a self-authorized move (agent == the anchor) writes nothing', () => {
    const before = eventCount();
    const result = transitionTask(ctx(), {
      id: taskId,
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
    const taskId = mustCreate({ title: 'task', which: 'claude' });
    // Walk DRAFT → READY → IN_PROGRESS → BLOCKED, then the only legal move is
    // unblock. Completing from BLOCKED must be refused — proof the gate saw the
    // real current state, BLOCKED, not the initial DRAFT.
    transitionTask(ctx(), { id: taskId, action: 'submit' });
    transitionTask(ctx(), { id: taskId, action: 'start', which: 'claude' });
    transitionTask(ctx(), { id: taskId, action: 'block', fields: { reason: 'waiting' } });
    expect(stateOf(taskId)).toBe('BLOCKED');

    const bad = transitionTask(ctx(), {
      id: taskId,
      action: 'complete',
      fields: { note: 'x' },
    });
    expect(bad).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });

    const good = transitionTask(ctx(), { id: taskId, action: 'unblock', which: 'claude' });
    expect(good).toMatchObject({ ok: true, to: 'IN_PROGRESS' });
    expect(stateOf(taskId)).toBe('IN_PROGRESS');
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
    const result = createTask(ctx(), { title: 't' });
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
    const taskId = mustCreate({ title: 't', which: 'claude' });
    transitionTask(ctx(), { id: taskId, action: 'submit', which: 'claude' });
    const actor = lastActor();
    expect(actor.who).toBe(writer.anchor);
    expect(actor.signerFp).toBe(writer.signerFingerprint);
    expect(actor.which).toBe('claude');
  });

  it('records the trimmed which, not the raw input (which is still caller-supplied)', () => {
    mustCreate({ title: 't', which: '  claude  ' });
    expect(lastActor().which).toBe('claude');
  });

  it('a whitespace-only which is dropped, not recorded as an empty agent', () => {
    mustCreate({ title: 't', which: '   ' });
    // The agent was blank; the birth records the anchor alone, no which.
    const actor = lastActor();
    expect(actor.who).toBe(writer.anchor);
    expect(actor.which).toBeUndefined();
  });

  it('who != which holds against a whitespace/composition variant of the anchor', () => {
    // A caller cannot slip past self-authorization by spacing or decomposing the
    // anchor: canonical identity settles both before the comparison.
    const spaced = `  ${writer.anchor}  `;
    const created = createTask(ctx(), { title: 't', which: spaced });
    expect(created).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    expect(eventCount()).toBe(0);
  });

  it('a later transition resolves the minted id it was handed back', () => {
    // The id is minted and returned; a transition that names that exact id
    // resolves against the stored subject. (Composition-variant lookup is a
    // property of canonicalId, unit-tested in id.test.ts; a minted id is
    // plain ASCII, so there is no composition variant to construct here.)
    const taskId = mustCreate({ title: 't' });
    const moved = transitionTask(ctx(), { id: taskId, action: 'submit' });
    expect(moved).toMatchObject({ ok: true, to: 'READY' });
    expect(stateOf(taskId)).toBe('READY');
  });
});
