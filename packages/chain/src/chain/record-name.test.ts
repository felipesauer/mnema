import { describe, expect, it } from 'vitest';

import {
  arrivedSince,
  genesisTail,
  RECORD_DOMAIN,
  recordName,
  recordOf,
  recordToWriteUnder,
} from './record-name.js';

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

describe('the record a writer writes under', () => {
  const THIRD = `${'ab'.repeat(32)}-${'99'.repeat(16)}`;
  const x = recordName(TAIL);
  const y = recordName(OTHER);
  const firsts =
    (...pairs: (readonly [string, string])[]) =>
    () =>
      pairs.map(([tail, at]) => ({ tail, at }));
  const none = firsts();

  it('is the name its own tail carries, first', () => {
    const named = new Map<string, string | undefined>([
      [TAIL, y],
      [OTHER, undefined],
    ]);
    expect(recordToWriteUnder(TAIL, named, firsts([OTHER, '2026-01-01T00:00:00.000Z']))).toEqual({
      name: y,
    });
  });

  it('is the name the other tails carry, when its own carries none', () => {
    const named = new Map<string, string | undefined>([
      [TAIL, undefined],
      [OTHER, y],
      [THIRD, undefined],
    ]);
    expect(recordToWriteUnder(TAIL, named, firsts([TAIL, '2020-01-01T00:00:00.000Z']))).toEqual({
      name: y,
    });
  });

  it('is the name of the genesis tail when no tail carries one', () => {
    const named = new Map<string, string | undefined>([
      [TAIL, undefined],
      [OTHER, undefined],
    ]);
    expect(
      recordToWriteUnder(
        TAIL,
        named,
        firsts([TAIL, '2026-10-29T10:00:00.000Z'], [OTHER, '2026-10-28T10:00:00.000Z']),
      ),
    ).toEqual({ name: y });
  });

  it('is the name of its own tail in a directory none of whose tails holds an entry', () => {
    expect(recordToWriteUnder(TAIL, new Map([[TAIL, undefined]]), none)).toEqual({ name: x });
    expect(recordToWriteUnder(TAIL, new Map(), none)).toEqual({ name: x });
  });

  it('refuses where the other tails name two records, even one its own tail names', () => {
    const named = new Map<string, string | undefined>([
      [TAIL, x],
      [OTHER, y],
      [THIRD, x],
    ]);
    expect(recordToWriteUnder(TAIL, named, none)).toEqual({
      refused: 'several',
      groups: [
        { name: x, tails: [THIRD] },
        { name: y, tails: [OTHER] },
      ].sort((a, b) => (a.name < b.name ? -1 : 1)),
    });
    const two = new Map<string, string | undefined>([
      [TAIL, undefined],
      [OTHER, y],
      [THIRD, x],
    ]);
    expect(recordToWriteUnder(TAIL, two, none)).toEqual({
      refused: 'several',
      groups: [
        { name: x, tails: [THIRD] },
        { name: y, tails: [OTHER] },
      ].sort((a, b) => (a.name < b.name ? -1 : 1)),
    });
  });

  it('refuses where its own tail names one record and every other named tail another', () => {
    const named = new Map<string, string | undefined>([
      [TAIL, x],
      [OTHER, y],
      [THIRD, undefined],
    ]);
    expect(recordToWriteUnder(TAIL, named, none)).toEqual({
      refused: 'foreign',
      own: x,
      record: y,
    });
  });

  it('is the record the directory continues, before the genesis rule, where no tail carries one', () => {
    const named = new Map<string, string | undefined>([
      [TAIL, undefined],
      [OTHER, undefined],
    ]);
    const older = firsts([OTHER, '2020-01-01T00:00:00.000Z']);
    expect(recordToWriteUnder(TAIL, named, older, () => x)).toEqual({ name: x });
    expect(recordToWriteUnder(TAIL, named, older, () => undefined)).toEqual({ name: y });
  });

  it('asks what the directory continues only where no tail carries a name', () => {
    let asked = 0;
    const continued = () => {
      asked += 1;
      return x;
    };
    expect(
      recordToWriteUnder(
        TAIL,
        new Map<string, string | undefined>([
          [TAIL, undefined],
          [OTHER, y],
        ]),
        none,
        continued,
      ),
    ).toEqual({ name: y });
    expect(recordToWriteUnder(TAIL, new Map([[TAIL, y]]), none, continued)).toEqual({ name: y });
    expect(asked).toBe(0);
  });

  it('asks for the first entries only when it applies the genesis rule', () => {
    let asked = 0;
    const counted = () => {
      asked += 1;
      return [];
    };
    recordToWriteUnder(TAIL, new Map([[TAIL, x]]), counted);
    recordToWriteUnder(
      TAIL,
      new Map<string, string | undefined>([
        [TAIL, undefined],
        [OTHER, y],
      ]),
      counted,
    );
    expect(asked).toBe(0);
    recordToWriteUnder(TAIL, new Map([[TAIL, undefined]]), counted);
    expect(asked).toBe(1);
  });
});

describe('the tails that arrived since a base', () => {
  const THIRD = `${'ab'.repeat(32)}-${'99'.repeat(16)}`;
  const x = recordName(TAIL);
  const y = recordName(OTHER);
  const firsts =
    (...pairs: (readonly [string, string])[]) =>
    () =>
      pairs.map(([tail, at]) => ({ tail, at }));
  const none = firsts();
  const named = (...pairs: (readonly [string, string | undefined])[]) =>
    new Map<string, string | undefined>(pairs);

  it('says nothing of a new tail that names the record the base is, nor of none at all', () => {
    const base = named([TAIL, x]);
    expect(arrivedSince(base, none, named([TAIL, x], [OTHER, x]))).toEqual({
      records: [x],
      unnamed: [],
      foreign: [],
    });
    expect(arrivedSince(base, none, named([TAIL, x]))).toEqual({
      records: [x],
      unnamed: [],
      foreign: [],
    });
  });

  it('names a new tail that names no record', () => {
    expect(arrivedSince(named([TAIL, x]), none, named([TAIL, x], [OTHER, undefined]))).toEqual({
      records: [x],
      unnamed: [OTHER],
      foreign: [],
    });
  });

  it('leaves an unnamed tail the base already held to the census', () => {
    const base = named([TAIL, x], [OTHER, undefined]);
    expect(arrivedSince(base, none, named([TAIL, x], [OTHER, undefined]))).toEqual({
      records: [x],
      unnamed: [],
      foreign: [],
    });
  });

  it('names the new tails that name another record than the base, as one group by name', () => {
    const here = named([TAIL, x], [OTHER, y], [THIRD, y]);
    expect(arrivedSince(named([TAIL, x]), none, here)).toEqual({
      records: [x],
      unnamed: [],
      foreign: [{ name: y, tails: [OTHER, THIRD] }],
    });
  });

  it('holds new tails to the genesis of a base none of whose tails names a record', () => {
    const base = named([TAIL, undefined], [OTHER, undefined]);
    const older = firsts([TAIL, '2026-01-01T00:00:00.000Z'], [OTHER, '2026-02-01T00:00:00.000Z']);
    const same = named([TAIL, undefined], [OTHER, undefined], [THIRD, x]);
    expect(arrivedSince(base, older, same)).toEqual({ records: [x], unnamed: [], foreign: [] });
    const graft = named([TAIL, undefined], [OTHER, undefined], [THIRD, y]);
    expect(arrivedSince(base, older, graft)).toEqual({
      records: [x],
      unnamed: [],
      foreign: [{ name: y, tails: [THIRD] }],
    });
  });

  it('holds no new tail to a record where the base held none, and still names an unnamed one', () => {
    expect(arrivedSince(named(), none, named([TAIL, x], [OTHER, undefined]))).toEqual({
      records: [],
      unnamed: [OTHER],
      foreign: [],
    });
  });

  it('asks for the first entries only where no tail of the base names a record', () => {
    let asked = 0;
    const counted = () => {
      asked += 1;
      return [];
    };
    arrivedSince(named([TAIL, x], [OTHER, undefined]), counted, named([TAIL, x], [THIRD, y]));
    expect(asked).toBe(0);
  });
});
