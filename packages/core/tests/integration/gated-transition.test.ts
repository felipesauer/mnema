/**
 * The gated write operation end to end: a transition passes through the gate,
 * lands on the real chain, and the projection reflects it — and an illegal or
 * unproven move writes nothing at all.
 *
 * This crosses packages (the core operation drives a real @mnema/chain tail on
 * disk), so it lives here rather than beside a source file.
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
    const result = createTask(ctx(), {
      id: 't-1',
      title: 'ship it',
      who: 'felipe',
      which: 'claude',
    });
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
    createTask(ctx(), { id: 't-1', title: 't', who: 'felipe' });
    const events = orderedEvents(layout, upcasters);
    expect(events[0]?.at).toBe(events[1]?.at);
    expect(events[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('refuses creation with no who and writes nothing', () => {
    const result = createTask(ctx(), { id: 't-1', title: 't', who: '' });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_WHO' });
    expect(eventCount()).toBe(0);
  });

  it('refuses creation where who equals which and writes nothing', () => {
    const result = createTask(ctx(), { id: 't-1', title: 't', who: 'claude', which: 'claude' });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    expect(eventCount()).toBe(0);
  });

  it('births atomically: a failed write leaves NO orphan task.created', () => {
    // The birth pair must be all-or-nothing. If the write fails, the chain must
    // not carry a created-but-stateless task, which would burn the id forever.
    // A writer whose batch append throws stands in for a disk/IO failure.
    const boom = {
      appendAll() {
        throw new Error('disk full');
      },
      append() {
        throw new Error('should not be called — birth must be one atomic write');
      },
    } as unknown as ChainWriter;
    const brokenCtx: WriteContext = { writer: boom, layout, upcasters, clock };
    expect(() => createTask(brokenCtx, { id: 't-1', title: 't', who: 'felipe' })).toThrow(
      'disk full',
    );
    // Nothing reached the real tail: no half-birth to re-read.
    expect(eventCount()).toBe(0);
  });
});

describe('transitionTask — authorized moves persist and project', () => {
  beforeEach(() => {
    createTask(ctx(), { id: 't-1', title: 'task', who: 'felipe', which: 'claude' });
  });

  it('a legal transition appends and the projection reflects it', () => {
    const result = transitionTask(ctx(), {
      id: 't-1',
      action: 'submit',
      who: 'felipe',
      which: 'claude',
    });
    expect(result).toMatchObject({ ok: true, to: 'READY' });
    expect(stateOf('t-1')).toBe('READY');
    expect(eventCount()).toBe(3);
  });

  it('records `to` from the workflow, not the caller, and carries proof through', () => {
    transitionTask(ctx(), { id: 't-1', action: 'submit', who: 'felipe' });
    transitionTask(ctx(), { id: 't-1', action: 'start', who: 'felipe', which: 'claude' });
    const done = transitionTask(ctx(), {
      id: 't-1',
      action: 'complete',
      fields: { note: 'shipped', pr_url: 'https://x/1' },
      who: 'felipe',
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
    transitionTask(ctx(), { id: 't-1', action: 'submit', who: 'felipe' });
    const last = orderedEvents(layout, upcasters).at(-1);
    expect(last?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('transitionTask — refused moves write NOTHING', () => {
  beforeEach(() => {
    createTask(ctx(), { id: 't-1', title: 'task', who: 'felipe', which: 'claude' });
  });

  it('an illegal transition writes nothing and leaves state unchanged', () => {
    const before = eventCount();
    // A DRAFT task cannot be completed.
    const result = transitionTask(ctx(), {
      id: 't-1',
      action: 'complete',
      fields: { note: 'x' },
      who: 'felipe',
    });
    expect(result).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(eventCount()).toBe(before);
    expect(stateOf('t-1')).toBe('DRAFT');
  });

  it('a missing required proof field writes nothing', () => {
    transitionTask(ctx(), { id: 't-1', action: 'submit', who: 'felipe' });
    const before = eventCount();
    // cancel requires a reason.
    const result = transitionTask(ctx(), { id: 't-1', action: 'cancel', who: 'felipe' });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_PROOF', field: 'reason' });
    expect(eventCount()).toBe(before);
    expect(stateOf('t-1')).toBe('READY');
  });

  it('a self-authorized move (who == which) writes nothing', () => {
    const before = eventCount();
    const result = transitionTask(ctx(), {
      id: 't-1',
      action: 'submit',
      who: 'claude',
      which: 'claude',
    });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    expect(eventCount()).toBe(before);
  });

  it('transitioning a nonexistent task writes nothing', () => {
    const before = eventCount();
    const result = transitionTask(ctx(), { id: 'ghost', action: 'submit', who: 'felipe' });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_TASK' });
    expect(eventCount()).toBe(before);
  });
});

describe('transitionTask — gated against the chain, not a stale cache', () => {
  it('reads current state from the chain so each move is judged against the truth', () => {
    createTask(ctx(), { id: 't-1', title: 'task', who: 'felipe', which: 'claude' });
    // Walk DRAFT → READY → IN_PROGRESS → BLOCKED, then the only legal move is
    // unblock. Completing from BLOCKED must be refused — proof the gate saw the
    // real current state, BLOCKED, not the initial DRAFT.
    transitionTask(ctx(), { id: 't-1', action: 'submit', who: 'felipe' });
    transitionTask(ctx(), { id: 't-1', action: 'start', who: 'felipe', which: 'claude' });
    transitionTask(ctx(), {
      id: 't-1',
      action: 'block',
      fields: { reason: 'waiting' },
      who: 'felipe',
    });
    expect(stateOf('t-1')).toBe('BLOCKED');

    const bad = transitionTask(ctx(), {
      id: 't-1',
      action: 'complete',
      fields: { note: 'x' },
      who: 'felipe',
    });
    expect(bad).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });

    const good = transitionTask(ctx(), {
      id: 't-1',
      action: 'unblock',
      who: 'felipe',
      which: 'claude',
    });
    expect(good).toMatchObject({ ok: true, to: 'IN_PROGRESS' });
    expect(stateOf('t-1')).toBe('IN_PROGRESS');
  });
});

describe('canonical identity — what is validated is what is recorded', () => {
  /** The `who`/`which` of the last event on the chain. */
  function lastActor(): { who: string; which?: string } {
    const events = orderedEvents(layout, upcasters);
    const last = events[events.length - 1];
    if (last === undefined) throw new Error('no events');
    return { who: last.who, ...(last.which !== undefined ? { which: last.which } : {}) };
  }

  it('createTask records the trimmed who, not the raw input', () => {
    const result = createTask(ctx(), { id: 't-1', title: 't', who: '  felipe  ' });
    expect(result.ok).toBe(true);
    // both birth events carry the canonical form
    const events = orderedEvents(layout, upcasters);
    expect(events[0]?.who).toBe('felipe');
    expect(events[1]?.who).toBe('felipe');
  });

  it('createTask records the trimmed which, not the raw input', () => {
    createTask(ctx(), { id: 't-1', title: 't', who: 'felipe', which: '  claude  ' });
    expect(lastActor().which).toBe('claude');
  });

  it('transitionTask records the trimmed who/which', () => {
    createTask(ctx(), { id: 't-1', title: 't', who: 'felipe', which: 'claude' });
    transitionTask(ctx(), { id: 't-1', action: 'submit', who: '  felipe ' });
    expect(lastActor().who).toBe('felipe');
    transitionTask(ctx(), {
      id: 't-1',
      action: 'start',
      who: ' felipe ',
      which: ' claude ',
    });
    expect(lastActor()).toEqual({ who: 'felipe', which: 'claude' });
  });

  it('createTask and transitionTask refuse a whitespace-only who identically', () => {
    const created = createTask(ctx(), { id: 't-1', title: 't', who: '   ' });
    expect(created).toMatchObject({ ok: false, code: 'MISSING_WHO' });
    expect(eventCount()).toBe(0);

    // set up a real task, then try to transition with whitespace-only who
    createTask(ctx(), { id: 't-2', title: 't', who: 'felipe' });
    const before = eventCount();
    const moved = transitionTask(ctx(), { id: 't-2', action: 'submit', who: '   ' });
    expect(moved).toMatchObject({ ok: false, code: 'MISSING_WHO' });
    expect(eventCount()).toBe(before);
  });

  it('createTask and transitionTask refuse a non-string who without crashing', () => {
    const created = createTask(ctx(), {
      id: 't-1',
      title: 't',
      who: 5 as unknown as string,
    });
    expect(created).toMatchObject({ ok: false, code: 'MISSING_WHO' });

    createTask(ctx(), { id: 't-2', title: 't', who: 'felipe' });
    const moved = transitionTask(ctx(), {
      id: 't-2',
      action: 'submit',
      who: 5 as unknown as string,
    });
    expect(moved).toMatchObject({ ok: false, code: 'MISSING_WHO' });
  });

  it('who != which holds against a whitespace-only difference (create and transition)', () => {
    const created = createTask(ctx(), {
      id: 't-1',
      title: 't',
      who: 'claude',
      which: ' claude ',
    });
    expect(created).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    expect(eventCount()).toBe(0);

    createTask(ctx(), { id: 't-2', title: 't', who: 'felipe' });
    const before = eventCount();
    const moved = transitionTask(ctx(), {
      id: 't-2',
      action: 'submit',
      who: 'claude',
      which: ' claude ',
    });
    expect(moved).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    expect(eventCount()).toBe(before);
  });

  it('a whitespace-only which is dropped, not recorded as an empty agent', () => {
    createTask(ctx(), { id: 't-1', title: 't', who: 'felipe', which: '   ' });
    // the agent was blank; the birth records who alone, no which
    expect(lastActor()).toEqual({ who: 'felipe' });
  });
});
