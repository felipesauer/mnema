/**
 * `onTheRecordAsItStands` on its own: when it judges once, when twice, what the second
 * judgement is handed, and that a refusal on the first reading takes no lock.
 *
 * The races of the four operations that use it are in `the-second-move-sees-the-first.test.ts`;
 * these cases pin the helper's own contract, with readings the cases choose.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChainWriter, identityFounded, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onTheRecordAsItStands, stateMoved } from './as-the-record-stands.js';

let tree: string;
let keyRoot: string;

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), 'mnema-as-it-stands-'));
  keyRoot = mkdtempSync(join(tmpdir(), 'mnema-as-it-stands-key-'));
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
  rmSync(keyRoot, { recursive: true, force: true });
});

function writer(): ChainWriter {
  return openChainForWriting(tree, { keyRoot });
}

/** Appends one event to the tree, as another session of the installation would. */
function anotherWriteLands(): void {
  const w = writer();
  w.append(
    identityFounded(
      {
        at: '2026-10-01T00:00:00.000Z',
        who: w.anchor,
        signerFp: w.signerFingerprint,
        subject: w.anchor,
      },
      { foundingFp: w.signerFingerprint },
    ),
  );
}

describe('onTheRecordAsItStands', () => {
  it('judges once, and writes under the lock, when nothing landed in between', () => {
    const w = writer();
    const judged: Array<[string, string | undefined]> = [];
    let lockHeld = false;
    const result = onTheRecordAsItStands(
      { writer: w, layout: { root: tree } },
      () => 'first',
      (view, earlier) => {
        judged.push([view, earlier]);
        return {
          write: () => {
            lockHeld = existsSync(join(tree, 'locks', `${w.tail}.lock`));
            return `wrote on ${view}`;
          },
        };
      },
    );
    expect(result).toBe('wrote on first');
    expect(judged).toEqual([['first', undefined]]);
    expect(lockHeld).toBe(true);
  });

  it('reads and judges again under the lock when the chain moved, handing the first reading as `earlier`', () => {
    const w = writer();
    const readings = ['first', 'second'];
    const judged: Array<[string, string | undefined]> = [];
    const result = onTheRecordAsItStands(
      { writer: w, layout: { root: tree } },
      () => {
        const reading = readings.shift() as string;
        // The other session's write lands after the first reading was taken.
        if (reading === 'first') anotherWriteLands();
        return reading;
      },
      (view, earlier) => {
        judged.push([view, earlier]);
        return { write: () => `wrote on ${view}` };
      },
    );
    expect(result).toBe('wrote on second');
    expect(judged).toEqual([
      ['first', undefined],
      ['second', 'first'],
    ]);
  });

  it('returns the second judgement’s refusal when the chain moved and it refuses', () => {
    const w = writer();
    let reads = 0;
    const result = onTheRecordAsItStands(
      { writer: w, layout: { root: tree } },
      () => {
        reads += 1;
        if (reads === 1) anotherWriteLands();
        return reads;
      },
      (view, earlier) =>
        earlier === undefined ? { write: () => 'wrote' } : { refuse: `refused on ${view}` },
    );
    expect(result).toBe('refused on 2');
  });

  it('returns a refusal on the first reading without taking the lock', () => {
    const w = writer();
    const result = onTheRecordAsItStands(
      { writer: w, layout: { root: tree } },
      () => 'first',
      () => ({ refuse: 'no' }),
    );
    expect(result).toBe('no');
    // Never taken: the tree has no `locks/` at all.
    expect(existsSync(join(tree, 'locks'))).toBe(false);
  });
});

describe('stateMoved', () => {
  it('names the subject, the move, the state it was judged on and the state it found', () => {
    expect(stateMoved('decision', 'd-1', 'reject', 'proposed', 'accepted')).toEqual({
      ok: false,
      code: 'STATE_MOVED',
      message:
        'decision "d-1" was proposed when this reject was asked and is accepted now: ' +
        'another write moved it first. This move was not appended.',
    });
  });

  it('puts a value with a line break in it on one line', () => {
    const refused = stateMoved('task', 'd-1', 'start\nnow', 'READY\n', 'DONE');
    expect(refused.message.split('\n')).toHaveLength(1);
  });
});
