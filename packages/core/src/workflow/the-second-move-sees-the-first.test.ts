/**
 * Two moves of one subject, by two sessions of one installation: the second sees the first.
 *
 * Measured on the built binary before this: `mnema decision move accept` and `… reject` run
 * together on a `proposed` decision both exited 0 in 19 of 20 rounds, and the record kept two
 * transitions out of `proposed` that `verify` passed; two concurrent `decision record` minted
 * the same `ADR-<n>` in 10 of 10 pairs. Each process replayed the record, judged the move, and
 * only then took the tail's lock to append — so both judged the same state.
 *
 * ## Why these cases are not a race
 *
 * The hazard is the STALE READING the concurrency produces, and two writers of one tail in one
 * process reproduce it every time (the reasoning `tail-lock.test.ts` gives for the lock's own
 * cases): the second session reads the record, and before it appends, the first session's
 * whole move runs. Here that is done at the one point every one of these operations shares —
 * right after the first reading of the record the move is judged on returns — by wrapping the
 * replay. It does not intercept a method of the operation, so it is not tied to the order of
 * the calls inside it, only to "the move was judged on a reading taken before the other move
 * landed", which is the defect. On the code before this, every case here records both moves.
 *
 * The rounds-and-rates form, on the binary through the real processes, is a measurement and
 * lives with the delivery's evidence.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CatalogEvent,
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  openChainForWriting,
  type UpcasterRegistry,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureMemory } from '../knowledge/operations.js';
import { projectDecisions } from '../projections/decision.js';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from './clock.js';
import { acceptDecision, recordDecision, rejectDecision } from './decision-operations.js';
import { ensureFounded } from './identity-operations.js';
import { createTask, transitionTask, type WriteContext } from './operations.js';
import { endRun, startRun } from './session-operations.js';
import { createSkill, rejectSkill, reviewSkill } from './skill-operations.js';

/**
 * The replay every operation reads the record through, with one hook: armed, the first replay
 * that returns runs the other session's move before handing its reading back.
 */
const race = vi.hoisted(() => ({
  other: undefined as (() => void) | undefined,
  /** Replays of the record, not counting the ones the other session's move makes. */
  reads: 0,
  inOther: false,
}));

vi.mock('../projections/order.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../projections/order.js')>();
  return {
    ...real,
    orderedEvents: (layout: ChainLayout, upcasters: UpcasterRegistry): CatalogEvent[] => {
      if (!race.inOther) race.reads += 1;
      const reading = real.orderedEvents(layout, upcasters);
      const other = race.other;
      if (other !== undefined) {
        race.other = undefined;
        race.inOther = true;
        try {
          other();
        } finally {
          race.inOther = false;
        }
      }
      return reading;
    },
  };
});

const upcasters = catalogUpcasters();

let tree: string;
let keyRoot: string;
let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-10-01T00:00:${String(tick).padStart(2, '0')}.000Z`;
};

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), 'mnema-second-move-'));
  keyRoot = mkdtempSync(join(tmpdir(), 'mnema-second-move-key-'));
  tick = 0;
  race.other = undefined;
  race.reads = 0;
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
  rmSync(keyRoot, { recursive: true, force: true });
});

/** A session of THE one installation: same key root, same tree, so the same tail. */
function session(): WriteContext {
  const writer: ChainWriter = openChainForWriting(tree, { keyRoot });
  return { writer, layout: { root: tree }, upcasters, clock };
}

/** Arms the hook: `other` runs once, inside the next replay, after its reading was taken. */
function whileTheNextReadIsInFlight(other: () => void): void {
  race.other = other;
}

function events(): CatalogEvent[] {
  return orderedEvents({ root: tree }, upcasters);
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`setup refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

/** The record proves out, whatever the cases appended. */
function verifies(...sessions: WriteContext[]): void {
  for (const s of sessions) s.writer.checkpoint();
  expect(verify(tree, upcasters)).toMatchObject({ ok: true });
}

describe('a decision moved by two sessions at once', () => {
  it('appends the first move and refuses the second as STATE_MOVED, naming the state it found', () => {
    const one = session();
    const two = session();
    const { id } = ok(recordDecision(one, { title: 'Use SQLite', rationale: 'Relational load.' }));

    let first: ReturnType<typeof acceptDecision> | undefined;
    whileTheNextReadIsInFlight(() => {
      first = acceptDecision(one, { id, fields: { note: 'agreed' } });
    });
    const second = rejectDecision(two, { id, fields: { note: 'no' } });

    expect(first).toMatchObject({ ok: true, to: 'accepted' });
    expect(second).toMatchObject({ ok: false, code: 'STATE_MOVED' });
    expect(second.ok === false && second.message).toContain('was proposed');
    expect(second.ok === false && second.message).toContain('is accepted now');

    const moves = events().filter((e) => e.kind === 'decision.transitioned' && e.subject === id);
    // The birth and ONE move out of `proposed` — not two.
    expect(moves.map((e) => (e.kind === 'decision.transitioned' ? e.payload.to : ''))).toEqual([
      'proposed',
      'accepted',
    ]);
    expect(projectDecisions(events()).get(id)?.state).toBe('accepted');
    verifies(one, two);
  });

  it('numbers two decisions recorded at once in sequence, never twice the same', () => {
    const one = session();
    const two = session();
    ok(recordDecision(one, { title: 'first', rationale: 'r' }));

    let first: ReturnType<typeof recordDecision> | undefined;
    whileTheNextReadIsInFlight(() => {
      first = recordDecision(one, { title: 'second', rationale: 'r' });
    });
    const second = recordDecision(two, { title: 'third', rationale: 'r' });

    expect(first).toMatchObject({ ok: true, adr: 'ADR-2' });
    expect(second).toMatchObject({ ok: true, adr: 'ADR-3' });
    const labels = [...projectDecisions(events()).values()].map((d) => d.adr).sort();
    expect(labels).toEqual(['ADR-1', 'ADR-2', 'ADR-3']);
    verifies(one, two);
  });
});

describe('a task moved by two sessions at once', () => {
  it('appends the first move and refuses the second as STATE_MOVED', () => {
    const one = session();
    const two = session();
    const { id } = ok(createTask(one, { title: 'Ship it' }));
    ok(transitionTask(one, { id, action: 'submit' }));

    let first: ReturnType<typeof transitionTask> | undefined;
    whileTheNextReadIsInFlight(() => {
      first = transitionTask(one, { id, action: 'start' });
    });
    const second = transitionTask(two, { id, action: 'cancel', fields: { reason: 'dropped' } });

    expect(first).toMatchObject({ ok: true, to: 'IN_PROGRESS' });
    expect(second).toMatchObject({ ok: false, code: 'STATE_MOVED' });
    expect(second.ok === false && second.message).toContain('was READY');
    const fromReady = events().filter(
      (e) => e.kind === 'task.transitioned' && e.subject === id && e.payload.from === 'READY',
    );
    expect(fromReady).toHaveLength(1);
    verifies(one, two);
  });
});

describe('a skill moved by two sessions at once', () => {
  it('appends the first move and refuses the second as STATE_MOVED', () => {
    const one = session();
    const two = session();
    const { id } = ok(createSkill(one, { name: 'deploy', body: 'Run the deploy.' }));

    let first: ReturnType<typeof reviewSkill> | undefined;
    whileTheNextReadIsInFlight(() => {
      first = reviewSkill(one, { id, fields: { note: 'reads well' } });
    });
    const second = rejectSkill(two, { id, fields: { note: 'not needed' } });

    expect(first).toMatchObject({ ok: true, to: 'reviewed' });
    expect(second).toMatchObject({ ok: false, code: 'STATE_MOVED' });
    const fromProposed = events().filter(
      (e) => e.kind === 'skill.transitioned' && e.subject === id && e.payload.from === 'proposed',
    );
    expect(fromProposed).toHaveLength(1);
    verifies(one, two);
  });
});

describe('a run closed by two sessions at once', () => {
  it('appends the first close and refuses the second as STATE_MOVED', () => {
    const one = session();
    const two = session();
    const { id } = ok(startRun(one, { agent: 'claude' }));

    let first: ReturnType<typeof endRun> | undefined;
    whileTheNextReadIsInFlight(() => {
      first = endRun(one, { run: id, which: 'claude' });
    });
    const second = endRun(two, { run: id, which: 'claude' });

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, code: 'STATE_MOVED' });
    expect(events().filter((e) => e.kind === 'run.ended' && e.subject === id)).toHaveLength(1);
    verifies(one, two);
  });
});

describe('what the second reading costs, and when it is paid', () => {
  // A move replays the record more than once on its own — the state it is judged on, and the
  // roster `ensureFounded` asks before every append — so each case compares against the same
  // move with nothing landing in between, rather than against a number of replays.
  function readsOfAnUncontendedAccept(): number {
    const one = session();
    const { id } = ok(recordDecision(one, { title: 'control', rationale: 'r' }));
    race.reads = 0;
    ok(acceptDecision(one, { id, fields: { note: 'agreed' } }));
    return race.reads;
  }

  it('reads the record no more than the code before did when nothing landed in between', () => {
    // The code before: one reading of the decisions, one of the roster.
    expect(readsOfAnUncontendedAccept()).toBe(2);
  });

  it('reads it once more, under the lock, when another write landed — and goes ahead if that moved something else', () => {
    const control = readsOfAnUncontendedAccept();
    const one = session();
    const two = session();
    const { id } = ok(recordDecision(one, { title: 'Use SQLite', rationale: 'r' }));
    race.reads = 0;
    whileTheNextReadIsInFlight(() => {
      ok(captureMemory(one, { content: 'an unrelated note' }));
    });
    const moved = acceptDecision(two, { id, fields: { note: 'agreed' } });
    expect(moved).toMatchObject({ ok: true, to: 'accepted' });
    expect(race.reads).toBe(control + 1);
    verifies(one, two);
  });

  it('refuses on the first reading without taking the lock, as before', () => {
    const one = session();
    const two = session();
    const { id } = ok(recordDecision(one, { title: 'Use SQLite', rationale: 'r' }));
    ok(acceptDecision(one, { id, fields: { note: 'agreed' } }));
    // Sequential, not concurrent: the gate's own refusal, not STATE_MOVED.
    const late = rejectDecision(two, { id, fields: { note: 'no' } });
    expect(late.ok).toBe(false);
    expect(late.ok === false && late.code).not.toBe('STATE_MOVED');
  });
});

describe('the first write of two sessions at once founds once', () => {
  it('a second session that decided to found finds the first one’s founding under the lock', () => {
    const one = session();
    const two = session();
    // The first session has decided — no anchor recorded — and is about to found when the whole
    // of the second session's first write runs: the moment it asks for the tail's lock.
    let raced = false;
    const racing = new Proxy(one.writer, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== 'function') return value;
        if (prop === 'exclusively' && !raced) {
          return (...args: unknown[]) => {
            raced = true;
            ok(captureMemory(two, { content: 'session two' }));
            return (value as (...given: unknown[]) => unknown).apply(target, args);
          };
        }
        return value.bind(target);
      },
    });
    ok(captureMemory({ ...one, writer: racing }, { content: 'session one' }));

    expect(raced).toBe(true);
    const foundings = events().filter((e) => e.kind === 'identity.founded');
    expect(foundings).toHaveLength(1);
    expect(ensureFounded(one)).toBe(ensureFounded(two));
    verifies(one, two);
  });
});
