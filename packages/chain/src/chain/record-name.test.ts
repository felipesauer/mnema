import { describe, expect, it } from 'vitest';

import { genesisTail, RECORD_DOMAIN, recordName, recordOf } from './record-name.js';

const TAIL = `${'ab'.repeat(32)}-${'cd'.repeat(16)}`;
const OTHER = `${'ef'.repeat(32)}-${'01'.repeat(16)}`;

describe('the name of a record', () => {
  it('is the framed SHA-256 of the domain and the genesis tail id', () => {
    // Computed outside this codebase: SHA-256 over uint32_be(15) "mnema.record.v1"
    // uint32_be(97) and the tail id's UTF-8 (FORMAT.md section 2).
    expect(RECORD_DOMAIN).toBe('mnema.record.v1');
    expect(recordName(TAIL)).toBe(
      '5e36e057e2628616611ea29ac910fd40442d335311db34a5b6ae6b239dfabb71',
    );
  });

  it('is another name for another genesis tail', () => {
    expect(recordName(OTHER)).not.toBe(recordName(TAIL));
  });
});

describe('the genesis tail', () => {
  it('is the tail whose first entry carries the smallest at, compared as text', () => {
    expect(
      genesisTail([
        { tail: TAIL, at: '2026-10-29T10:00:00.000Z' },
        { tail: OTHER, at: '2026-10-28T23:59:59.999Z' },
      ]),
    ).toBe(OTHER);
  });

  it('goes to the smaller tail id on a tie', () => {
    const at = '2026-10-29T10:00:00.000Z';
    expect(
      genesisTail([
        { tail: OTHER, at },
        { tail: TAIL, at },
      ]),
    ).toBe(TAIL);
  });

  it('is none for a record with no first entry', () => {
    expect(genesisTail([])).toBeUndefined();
  });
});

describe('which record the tails of a directory belong to', () => {
  it('is unnamed when no tail names one', () => {
    expect(
      recordOf(
        new Map([
          [TAIL, undefined],
          [OTHER, undefined],
        ]),
      ),
    ).toEqual({ state: 'unnamed' });
  });

  it('is the one name every named tail carries, with the tails that carry none', () => {
    const name = recordName(TAIL);
    expect(
      recordOf(
        new Map([
          [TAIL, name],
          [OTHER, undefined],
        ]),
      ),
    ).toEqual({ state: 'named', name, genesis: TAIL, unnamed: [OTHER] });
  });

  it('names no genesis when no tail of the directory hashes to the name', () => {
    const name = recordName('some-tail-that-is-not-here');
    expect(recordOf(new Map([[TAIL, name]]))).toEqual({ state: 'named', name, unnamed: [] });
  });

  it('is several records when two named tails name two, each with its tails', () => {
    const x = recordName(TAIL);
    const y = recordName(OTHER);
    const third = `${'ab'.repeat(32)}-${'99'.repeat(16)}`;
    const found = recordOf(
      new Map([
        [TAIL, x],
        [OTHER, y],
        [third, x],
      ]),
    );
    expect(found).toEqual({
      state: 'several',
      groups: [
        { name: x, tails: [TAIL, third] },
        { name: y, tails: [OTHER] },
      ].sort((a, b) => (a.name < b.name ? -1 : 1)),
    });
  });
});
