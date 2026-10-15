/**
 * A MOVE WRITTEN PAST THE GATE, signed with a valid key, is named by `verify` and moves nothing
 * else of the verdict (FORMAT.md §6.7).
 *
 * The case is the one that verified before the workflows were part of the format: a decision
 * rejected, then `rejected → accepted` appended by hand with the machine's own key and signed
 * over. Every byte is intact, so the verdict is what it was — the same level, the same exit — and
 * the census carries one note more.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decisionBirth, decisionTransitioned, identityFounded } from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import { openChainForWriting, verify } from './chain.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-illegal-move-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A founded tail holding a decision rejected, then the moves handed in, every act signed. */
function rejectedThen(...moves: { from: string; to: string; action: string }[]) {
  const w = openChainForWriting(root, { keyRoot: root });
  let second = 0;
  const env = (subject: string) => ({
    at: `2026-09-25T00:00:${String(second++).padStart(2, '0')}.000Z`,
    who: w.anchor,
    signerFp: w.signerFingerprint,
    subject,
  });
  const act = (...events: CatalogEvent[]) => {
    for (const event of events) w.append(event);
    w.checkpoint();
  };
  act(identityFounded(env(w.anchor), { foundingFp: w.signerFingerprint }));
  act(
    ...decisionBirth(env('d-1'), {
      title: 'Use X',
      rationale: 'r',
      adr: 'ADR-1',
      initial: 'proposed',
    }),
  );
  act(
    decisionTransitioned(env('d-1'), {
      from: 'proposed',
      to: 'rejected',
      action: 'reject',
      fields: { note: 'no' },
    }),
  );
  for (const move of moves)
    act(decisionTransitioned(env('d-1'), { ...move, fields: { note: 'yes' } }));
  return w.tail;
}

describe('verify names a move the workflow does not allow, and its verdict stays', () => {
  it('names rejected → accepted, written by hand and signed', () => {
    const tail = rejectedThen({ from: 'rejected', to: 'accepted', action: 'accept' });
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.level).toBe('fully-signed');
    expect(result.census.filter((note) => note.kind === 'illegal-move')).toEqual([
      {
        kind: 'illegal-move',
        subject: 'd-1',
        move: 'decision.transitioned',
        rule: 'not-in-the-table',
        tail,
        seq: 4,
        detail:
          'a decision.transitioned of d-1: a move rejected → accepted by "accept", which the ' +
          'workflow does not hold — the workflow does not allow it, so it is not applied',
      },
    ]);
    expect(result.summary).toContain(
      '1 move(s) the workflow does not allow, not applied (see census — informational, not a break)',
    );
  });

  it('names a move from a state its own tail had already left', () => {
    rejectedThen({ from: 'proposed', to: 'accepted', action: 'accept' });
    expect(
      verify(root)
        .census.filter((note) => note.kind === 'illegal-move')
        .map((note) => (note.kind === 'illegal-move' ? note.rule : undefined)),
    ).toEqual(['not-the-state-seen']);
  });

  it('names nothing on a record that followed the workflow', () => {
    rejectedThen();
    const result = verify(root);
    expect(result.census.filter((note) => note.kind === 'illegal-move')).toEqual([]);
    expect(result.summary).not.toContain('workflow');
  });
});
