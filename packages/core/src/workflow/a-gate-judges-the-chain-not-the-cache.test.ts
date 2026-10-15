/**
 * A gate judges the subject as the CHAIN has it, not as the projection the tree keeps says it is.
 *
 * The projection is a file on the disk beside the record, unsigned and rebuilt at will: "the
 * projection is not a tamper detector". Measured on the built binary before this, a row of it
 * edited by hand was enough for every one of the four state machines to append a move its own gate
 * refuses — a rejected decision accepted, a cancelled task started, a rejected skill adopted, a run
 * ended twice, a supersede naming a successor nobody recorded — signed, and passed by `verify`.
 *
 * Each case below is one of those sites: it makes the record, edits the row the gate used to read,
 * and asks for the move. The refusal is the gate's own, and the chain holds nothing new. The last
 * case is the converse: a row edited to REFUSE a legal move does not stop it, because the row is
 * not what is read.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type CatalogEvent,
  type ChainWriter,
  catalogUpcasters,
  openChainForWriting,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectionCache } from '../projections/cache.js';
import { keptCachePath } from '../projections/cache-home.js';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from './clock.js';
import {
  acceptDecision,
  recordDecision,
  rejectDecision,
  supersedeDecision,
} from './decision-operations.js';
import { createTask, transitionTask, type WriteContext } from './operations.js';
import { endRun, startRun } from './session-operations.js';
import { adoptSkill, createSkill, rejectSkill } from './skill-operations.js';

const upcasters = catalogUpcasters();

let tree: string;
let keyRoot: string;
let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-10-01T00:00:${String(tick).padStart(2, '0')}.000Z`;
};

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), 'mnema-gate-chain-'));
  keyRoot = mkdtempSync(join(tmpdir(), 'mnema-gate-chain-key-'));
  tick = 0;
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
  rmSync(keyRoot, { recursive: true, force: true });
});

function session(): WriteContext {
  const writer: ChainWriter = openChainForWriting(tree, { keyRoot });
  return { writer, layout: { root: tree }, upcasters, clock };
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`setup refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function events(): CatalogEvent[] {
  return orderedEvents({ root: tree }, upcasters);
}

/**
 * Brings the kept projection up to the chain, then edits it with `sql` — the hand that wrote the
 * row a gate used to judge by. Brought up first so the edit is not undone by the arrivals the next
 * reading would fold over it.
 */
function editTheProjection(sql: string, ...params: string[]): void {
  const cache = ProjectionCache.open(tree, { upcasters, persist: true });
  try {
    cache.refresh();
  } finally {
    cache.close();
  }
  const db = new DatabaseSync(keptCachePath({ root: tree }));
  try {
    db.exec('BEGIN');
    for (const one of sql.split(';').filter((s) => s.trim().length > 0)) {
      const statement = db.prepare(one);
      const wanted = (one.match(/\?/g) ?? []).length;
      statement.run(...params.splice(0, wanted));
    }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

const movesOf = (id: string): string[] =>
  events().flatMap((e) =>
    (e.kind === 'decision.transitioned' ||
      e.kind === 'task.transitioned' ||
      e.kind === 'skill.transitioned') &&
    e.subject === id
      ? [`${e.payload.from}->${e.payload.to}`]
      : [],
  );

describe('a gate judges the subject as the chain has it', () => {
  it('a decision: rejected on the chain, proposed in the projection — accept is refused', () => {
    const ctx = session();
    const { id } = ok(recordDecision(ctx, { title: 'Use X', rationale: 'because' }));
    ok(rejectDecision(ctx, { id, fields: { note: 'no' } }));
    editTheProjection("UPDATE decisions SET state = 'proposed' WHERE id = ?", id);

    const accepted = acceptDecision(ctx, { id, fields: { note: 'yes' } });

    expect(accepted).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(movesOf(id)).toEqual(['null->proposed', 'proposed->rejected']);
  });

  it('a supersede: a successor only the projection holds is refused UNKNOWN_BY', () => {
    const ctx = session();
    const { id } = ok(recordDecision(ctx, { title: 'Use X', rationale: 'because' }));
    ok(acceptDecision(ctx, { id, fields: { note: 'yes' } }));
    const phantom = '01a13a99-0000-4000-8000-000000000000';
    editTheProjection(
      'CREATE TEMP TABLE ghost AS SELECT * FROM decisions WHERE id = ?;' +
        'UPDATE ghost SET id = ?;' +
        'INSERT INTO decisions SELECT * FROM ghost',
      id,
      phantom,
    );

    const superseded = supersedeDecision(ctx, { id, by: phantom, fields: { reason: 'replaced' } });

    expect(superseded).toMatchObject({ ok: false, code: 'UNKNOWN_BY' });
    expect(movesOf(id)).toEqual(['null->proposed', 'proposed->accepted']);
  });

  it('a task: cancelled on the chain, READY in the projection — start is refused', () => {
    const ctx = session();
    const { id } = ok(createTask(ctx, { title: 'Ship it' }));
    ok(transitionTask(ctx, { id, action: 'submit' }));
    ok(transitionTask(ctx, { id, action: 'cancel', fields: { reason: 'dropped' } }));
    editTheProjection("UPDATE tasks SET state = 'READY' WHERE id = ?", id);

    const started = transitionTask(ctx, { id, action: 'start' });

    expect(started).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(movesOf(id).at(-1)).toBe('READY->CANCELED');
  });

  it('a skill: rejected on the chain, reviewed in the projection — adopt is refused', () => {
    const ctx = session();
    const { id } = ok(createSkill(ctx, { name: 'deploy', body: 'Run the deploy.' }));
    ok(rejectSkill(ctx, { id, fields: { note: 'not needed' } }));
    editTheProjection("UPDATE skills SET state = 'reviewed' WHERE id = ?", id);

    const adopted = adoptSkill(ctx, { id, fields: { note: 'use it' } });

    expect(adopted).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    expect(movesOf(id).at(-1)).toBe('proposed->rejected');
  });

  it('a run: ended on the chain, open in the projection — a second end is refused', () => {
    const ctx = session();
    const { id } = ok(startRun(ctx, { agent: 'claude' }));
    ok(endRun(ctx, { run: id, which: 'claude' }));
    editTheProjection('UPDATE runs SET open = 1, ended_at = NULL WHERE id = ?', id);

    const ended = endRun(ctx, { run: id, which: 'claude' });

    expect(ended).toMatchObject({ ok: false, code: 'ALREADY_ENDED' });
    expect(events().filter((e) => e.kind === 'run.ended' && e.subject === id)).toHaveLength(1);
  });

  it('a decision only the projection holds is refused as unknown', () => {
    const ctx = session();
    const { id } = ok(recordDecision(ctx, { title: 'Use X', rationale: 'because' }));
    const phantom = '01a13a99-0000-4000-8000-000000000001';
    editTheProjection(
      'CREATE TEMP TABLE ghost AS SELECT * FROM decisions WHERE id = ?;' +
        'UPDATE ghost SET id = ?;' +
        'INSERT INTO decisions SELECT * FROM ghost',
      id,
      phantom,
    );

    const accepted = acceptDecision(ctx, { id: phantom, fields: { note: 'yes' } });

    expect(accepted).toMatchObject({ ok: false, code: 'UNKNOWN_DECISION' });
    expect(movesOf(phantom)).toEqual([]);
  });

  it('an id in another case is another subject: refused as unknown, as the replay has none', () => {
    const ctx = session();
    const { id } = ok(recordDecision(ctx, { title: 'Use X', rationale: 'because' }));
    const upper = id.toUpperCase();

    const accepted = acceptDecision(ctx, { id: upper, fields: { note: 'yes' } });

    expect(accepted).toMatchObject({ ok: false, code: 'UNKNOWN_DECISION' });
    expect(events().some((e) => e.subject === upper)).toBe(false);
    expect(movesOf(id)).toEqual(['null->proposed']);
  });

  it('and the converse: a projection edited to refuse a legal move does not stop it', () => {
    const ctx = session();
    const { id } = ok(recordDecision(ctx, { title: 'Use X', rationale: 'because' }));
    editTheProjection("UPDATE decisions SET state = 'rejected' WHERE id = ?", id);

    const accepted = acceptDecision(ctx, { id, fields: { note: 'yes' } });

    expect(accepted).toMatchObject({ ok: true, to: 'accepted' });
    expect(movesOf(id)).toEqual(['null->proposed', 'proposed->accepted']);
  });
});
