import { describe, expect, it } from 'vitest';

import { identityFounded, memoryCaptured, tailRelinked } from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import { type Entry, sealEntry } from './entry.js';
import { deriveAnchor } from './keys.js';
import {
  arrivedSince,
  genesisTail,
  RECORD_DOMAIN,
  RELINK_CONFLICT,
  RELINK_FROM_MISMATCH,
  RELINK_HEAD_MISMATCH,
  RELINK_HOSTED_BY_A_RELINKED_TAIL,
  RELINK_INTO_ITS_OWN_RECORD,
  RELINK_INTO_MISMATCH,
  RELINK_NOT_A_MEMBER,
  RELINK_NOT_THE_OWNER,
  RELINKED_TAIL_GREW,
  recordName,
  recordOf,
  recordToWriteUnder,
  relinkedNaming,
  tailsReadAsOneRecord,
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
      noted: [],
      foreign: [],
      relinked: [],
    });
    expect(arrivedSince(base, none, named([TAIL, x]))).toEqual({
      records: [x],
      unnamed: [],
      noted: [],
      foreign: [],
      relinked: [],
    });
  });

  it('names a new tail that names no record', () => {
    expect(arrivedSince(named([TAIL, x]), none, named([TAIL, x], [OTHER, undefined]))).toEqual({
      records: [x],
      unnamed: [OTHER],
      noted: [],
      foreign: [],
      relinked: [],
    });
  });

  it('leaves an unnamed tail the base already held to the census', () => {
    const base = named([TAIL, x], [OTHER, undefined]);
    expect(arrivedSince(base, none, named([TAIL, x], [OTHER, undefined]))).toEqual({
      records: [x],
      unnamed: [],
      noted: [],
      foreign: [],
      relinked: [],
    });
  });

  it('names the new tails that name another record than the base, as one group by name', () => {
    const here = named([TAIL, x], [OTHER, y], [THIRD, y]);
    expect(arrivedSince(named([TAIL, x]), none, here)).toEqual({
      records: [x],
      unnamed: [],
      noted: [],
      foreign: [{ name: y, tails: [OTHER, THIRD] }],
      relinked: [],
    });
  });

  it('holds new tails to the genesis of a base none of whose tails names a record', () => {
    const base = named([TAIL, undefined], [OTHER, undefined]);
    const older = firsts([TAIL, '2026-01-01T00:00:00.000Z'], [OTHER, '2026-02-01T00:00:00.000Z']);
    const same = named([TAIL, undefined], [OTHER, undefined], [THIRD, x]);
    expect(arrivedSince(base, older, same)).toEqual({
      records: [x],
      unnamed: [],
      noted: [],
      foreign: [],
      relinked: [],
    });
    const graft = named([TAIL, undefined], [OTHER, undefined], [THIRD, y]);
    expect(arrivedSince(base, older, graft)).toEqual({
      records: [x],
      unnamed: [],
      noted: [],
      foreign: [{ name: y, tails: [THIRD] }],
      relinked: [],
    });
  });

  it('notes, and does not name, a new unnamed tail where no tail of the base names a record', () => {
    const base = named([TAIL, undefined]);
    const older = firsts([TAIL, '2026-01-01T00:00:00.000Z']);
    expect(arrivedSince(base, older, named([TAIL, undefined], [OTHER, undefined]))).toEqual({
      records: [x],
      unnamed: [],
      noted: [OTHER],
      foreign: [],
      relinked: [],
    });
  });

  it('holds no new tail to a record where the base held none, and only notes an unnamed one', () => {
    expect(arrivedSince(named(), none, named([TAIL, x], [OTHER, undefined]))).toEqual({
      records: [],
      unnamed: [],
      noted: [OTHER],
      foreign: [],
      relinked: [],
    });
  });

  it('holds a tail the base held unnamed that names a record now to the name of the base genesis', () => {
    const base = named([TAIL, undefined], [OTHER, undefined]);
    const older = firsts([TAIL, '2026-01-01T00:00:00.000Z'], [OTHER, '2026-02-01T00:00:00.000Z']);
    expect(arrivedSince(base, older, named([TAIL, undefined], [OTHER, x]))).toEqual({
      records: [x],
      unnamed: [],
      noted: [],
      foreign: [],
      relinked: [],
    });
    expect(arrivedSince(base, older, named([TAIL, undefined], [OTHER, y]))).toEqual({
      records: [x],
      unnamed: [],
      noted: [],
      foreign: [{ name: y, tails: [OTHER] }],
      relinked: [],
    });
  });

  it('refuses a tail the base held unnamed that names a record now, where no genesis is found', () => {
    const base = named([TAIL, undefined]);
    expect(arrivedSince(base, none, named([TAIL, x]))).toEqual({
      records: [],
      unnamed: [],
      noted: [],
      foreign: [{ name: x, tails: [TAIL] }],
      relinked: [],
    });
  });

  describe('a tail its owner relinked (FORMAT.md section 6.11)', () => {
    const HOST = `${'ab'.repeat(32)}-${'ef'.repeat(16)}`;
    const FIRST_AT = '2026-03-01T00:00:00.000Z';
    // What `relinkedNaming` counts of the relink of TAIL, out of record x, into record y.
    const counted = {
      relink: {
        host: HOST,
        seq: 0,
        signerFp: 'ab'.repeat(32),
        tail: TAIL,
        source: x,
        into: y,
        throughHash: '1'.repeat(64),
        eventCount: 2,
      },
      events: 2,
      firstAt: FIRST_AT,
      detail: 'the census line',
    };
    // The names a reader gives the directory once the relink counts: TAIL under y.
    const relinkedHere = named([OTHER, y], [TAIL, y], [HOST, y]);

    it('is no tail of another record, and is said as arrived where the base did not hold it', () => {
      const said = arrivedSince(named([OTHER, y]), none, relinkedHere, {
        base: [],
        here: [counted],
      });
      expect(said.foreign).toEqual([]);
      expect(said.relinked).toEqual([
        { tail: TAIL, from: x, events: 2, firstAt: FIRST_AT, held: false },
      ]);
    });

    it('is said as held where the base held the tail under the record it left', () => {
      const base = named([OTHER, y], [TAIL, x]);
      const said = arrivedSince(base, none, relinkedHere, { base: [], here: [counted] });
      expect(said.foreign).toEqual([]);
      expect(said.relinked).toEqual([
        { tail: TAIL, from: x, events: 2, firstAt: FIRST_AT, held: true },
      ]);
    });

    it('is not said again where the relink counted at the base already', () => {
      const base = named([OTHER, y], [TAIL, y], [HOST, y]);
      const said = arrivedSince(base, none, relinkedHere, { base: [counted], here: [counted] });
      expect(said.relinked).toEqual([]);
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

describe('the tails a reading of the record reads (tailsReadAsOneRecord)', () => {
  const THIRD = `${'12'.repeat(32)}-${'34'.repeat(16)}`;
  const B = recordName(TAIL);
  const A = recordName(OTHER);

  it('are every tail where no tail names a record', () => {
    const named = new Map<string, string | undefined>([
      [OTHER, undefined],
      [TAIL, undefined],
    ]);
    expect(tailsReadAsOneRecord(named)).toEqual({ read: [OTHER, TAIL], several: [] });
  });

  it('are every tail where the named tails name one record, an unnamed one among them', () => {
    const named = new Map<string, string | undefined>([
      [OTHER, undefined],
      [TAIL, B],
    ]);
    expect(tailsReadAsOneRecord(named)).toEqual({ read: [OTHER, TAIL], several: [] });
  });

  it('are none where the named tails name two records, whichever holds the genesis, and the records are said', () => {
    // TAIL derives B and names it: B holds its genesis. OTHER derives A and names it: so does A.
    // The genesis by `at` is not asked: a directory alone cannot tell which record it is.
    const named = new Map<string, string | undefined>([
      [OTHER, A],
      [TAIL, B],
      [THIRD, undefined],
    ]);
    expect(tailsReadAsOneRecord(named)).toEqual({
      read: [],
      several: [
        { name: A, tails: [OTHER] },
        { name: B, tails: [TAIL] },
      ].sort((x, y) => (x.name < y.name ? -1 : 1)),
    });
  });
});

describe('the name a relink gives a tail (relinkedNaming, FORMAT.md section 6.11)', () => {
  // One key (K) wrote T in record X and H in record Y; another key wrote E in record Y.
  const K = 'ab'.repeat(32);
  const T = `${K}-${'01'.repeat(16)}`;
  const H = `${K}-${'02'.repeat(16)}`;
  const E = `${'ef'.repeat(32)}-${'03'.repeat(16)}`;
  const X = recordName(T);
  const Y = recordName(E);
  const AT = '2026-10-31T00:00:00.000Z';
  const who = `mnid:${'11'.repeat(32)}`;

  /** A tail of `count` notes signed by `fp`, then the events `extra` gives, sealed in order. */
  function tail(id: string, fp: string, count: number, extra: CatalogEvent[] = []): Entry[] {
    const entries: Entry[] = [];
    const events = [
      ...Array.from({ length: count }, (_, i) =>
        memoryCaptured({ at: AT, who, signerFp: fp, subject: `n-${id}-${i}` }, { content: 'a' }),
      ),
      ...extra,
    ];
    for (const event of events) {
      entries.push(
        sealEntry({
          event,
          tail: id,
          seq: entries.length,
          prev: entries.at(-1)?.link.hash ?? null,
        }),
      );
    }
    return entries;
  }

  /** The relink of `of` (as it stands) by `signer`, saying what `claim` overrides. */
  function relink(of: readonly Entry[], signer = K, claim: Partial<Record<string, unknown>> = {}) {
    return tailRelinked({ at: AT, who, signerFp: signer, subject: who }, {
      tail: T,
      from: X,
      into: Y,
      throughHash: of.at(-1)?.link.hash ?? '',
      eventCount: of.length,
      reason: 'two inits joined',
      ...claim,
    } as Parameters<typeof tailRelinked>[1]);
  }

  const noIssue = () => [];
  const t = tail(T, K, 3);
  const e = tail(E, 'ef'.repeat(32), 2);

  function read(
    host: Entry[],
    options: {
      covered?: number;
      named?: Partial<Record<string, string | undefined>>;
      entries?: Map<string, readonly Entry[]>;
      fold?: Parameters<typeof relinkedNaming>[3];
    } = {},
  ) {
    const entries =
      options.entries ??
      new Map<string, readonly Entry[]>([
        [T, t],
        [H, host],
        [E, e],
      ]);
    const named = new Map<string, string | undefined>([
      [T, X],
      [H, Y],
      [E, Y],
    ]);
    for (const [id, name] of Object.entries(options.named ?? {})) named.set(id, name);
    for (const id of [...named.keys()]) if (!entries.has(id)) named.delete(id);
    const covered = new Map(
      [...entries.keys()].map((id) => [id, (entries.get(id)?.length ?? 0) - 1]),
    );
    if (options.covered !== undefined) covered.set(H, options.covered);
    return relinkedNaming(named, entries, covered, options.fold ?? noIssue);
  }

  it('names nothing anew where no tail holds a relink, and says nothing', () => {
    const named = new Map<string, string | undefined>([
      [T, X],
      [E, Y],
    ]);
    const entries = new Map<string, readonly Entry[]>([
      [T, t],
      [E, e],
    ]);
    const read = relinkedNaming(named, entries, new Map(), noIssue);
    expect(read.named).toEqual(named);
    expect([read.counted, read.refused, read.uncovered, read.absent]).toEqual([[], [], [], []]);
  });

  it('names the tail into the record its host names, where every check holds', () => {
    const found = read(tail(H, K, 1, [relink(t)]));
    expect(found.named.get(T)).toBe(Y);
    expect(found.refused).toEqual([]);
    expect(
      found.counted.map((one) => [one.relink.host, one.relink.seq, one.events, one.firstAt]),
    ).toEqual([[H, 1, 3, AT]]);
  });

  it('asks the fold over the tails that name the record joined by their own artifacts, the relinked one left out', () => {
    const asked: string[][] = [];
    read(tail(H, K, 1, [relink(t)]), {
      fold: (entries) => {
        asked.push([...entries.keys()].sort());
        return [];
      },
    });
    expect(asked).toEqual([[E, H].sort()]);
  });

  it('counts for nothing above the host’s last checkpoint (relink-uncovered), said and not refused', () => {
    const found = read(tail(H, K, 1, [relink(t)]), { covered: 0 });
    expect(found.named.get(T)).toBe(X);
    expect(found.uncovered.map((one) => one.seq)).toEqual([1]);
    expect(found.refused).toEqual([]);
  });

  it('refuses a relink another key signed (relink-not-the-owner)', () => {
    const other = 'ef'.repeat(32);
    const host = `${other}-${'04'.repeat(16)}`;
    const entries = new Map<string, readonly Entry[]>([
      [T, t],
      [host, tail(host, other, 1, [relink(t, other)])],
      [E, e],
    ]);
    const found = read([], { entries, named: { [host]: Y } });
    expect(found.refused.map((one) => one.token)).toEqual([RELINK_NOT_THE_OWNER]);
    expect(found.named.get(T)).toBe(X);
  });

  it('refuses a relink into a record its host does not name (relink-into-mismatch)', () => {
    const found = read(tail(H, K, 1, [relink(t, K, { into: recordName('elsewhere') })]));
    expect(found.refused.map((one) => one.token)).toEqual([RELINK_INTO_MISMATCH]);
  });

  it('refuses a relink from a record the tail does not name (relink-from-mismatch)', () => {
    const found = read(tail(H, K, 1, [relink(t, K, { from: recordName('elsewhere') })]));
    expect(found.refused.map((one) => one.token)).toEqual([RELINK_FROM_MISMATCH]);
  });

  it('refuses a relinked tail that grew past its head (relinked-tail-grew)', () => {
    const grown = tail(T, K, 4);
    const host = tail(H, K, 1, [relink(grown.slice(0, 3))]);
    const found = read(host, {
      entries: new Map<string, readonly Entry[]>([
        [T, grown],
        [H, host],
        [E, e],
      ]),
    });
    expect(found.refused.map((one) => one.token)).toEqual([RELINKED_TAIL_GREW]);
    expect(found.named.get(T)).toBe(X);
  });

  it('refuses a relink whose head is not the tail’s (relink-head-mismatch)', () => {
    const found = read(tail(H, K, 1, [relink(t, K, { throughHash: '9'.repeat(64) })]));
    expect(found.refused.map((one) => one.token)).toEqual([RELINK_HEAD_MISMATCH]);
  });

  it('refuses two relinks of one tail, once for the tail (relink-conflict)', () => {
    const found = read(tail(H, K, 1, [relink(t), relink(t)]));
    expect(found.refused.map((one) => one.token)).toEqual([RELINK_CONFLICT]);
    expect(found.named.get(T)).toBe(X);
  });

  it('refuses a relink hosted by a tail that is itself relinked (relink-hosted-by-a-relinked-tail)', () => {
    // H is relinked by a covered relink its own key signed, in a third tail of the key.
    const third = `${K}-${'05'.repeat(16)}`;
    const host = tail(H, K, 1, [relink(t)]);
    const relinkOfHost = tailRelinked(
      { at: AT, who, signerFp: K, subject: who },
      {
        tail: H,
        from: Y,
        into: Y,
        throughHash: host.at(-1)?.link.hash ?? '',
        eventCount: 2,
        reason: 'r',
      },
    );
    const entries = new Map<string, readonly Entry[]>([
      [T, t],
      [H, host],
      [third, tail(third, K, 0, [relinkOfHost])],
      [E, e],
    ]);
    const found = read([], { entries, named: { [third]: Y } });
    // The relink of H names Y as both ends, which is refused in its turn; it is still a covered
    // relink by H's owner, so the relink H hosts does not count.
    expect(found.refused.map((one) => [one.token, one.relink.host])).toEqual([
      [RELINK_HOSTED_BY_A_RELINKED_TAIL, H],
      [RELINK_INTO_ITS_OWN_RECORD, third],
    ]);
  });

  it('refuses a relink that names one record as both ends (relink-into-its-own-record)', () => {
    const found = read(tail(H, K, 1, [relink(t, K, { from: Y })]));
    expect(found.refused.map((one) => one.token)).toEqual([RELINK_INTO_ITS_OWN_RECORD]);
    expect(found.named.get(T)).toBe(X);
  });

  it('says a relink of a tail that is not here, and names nothing by it', () => {
    const entries = new Map<string, readonly Entry[]>([
      [H, tail(H, K, 1, [relink(t)])],
      [E, e],
    ]);
    const found = read([], { entries });
    expect(found.absent.map((one) => one.tail)).toEqual([T]);
    expect(found.refused).toEqual([]);
  });

  it('refuses a relink whose key the record joined holds no membership of at that point (relink-not-a-member)', () => {
    const found = read(tail(H, K, 1, [relink(t)]), {
      fold: () => [{ tail: H, seq: 1 }],
    });
    expect(found.refused.map((one) => one.token)).toEqual([RELINK_NOT_A_MEMBER]);
    expect(found.named.get(T)).toBe(X);
  });
});

describe('the membership a relink asks for is one the record joined gave (ADR-157)', () => {
  const K = 'ab'.repeat(32);
  const G = 'ef'.repeat(32);
  const T = `${K}-${'01'.repeat(16)}`;
  const H = `${K}-${'02'.repeat(16)}`;
  const GENESIS = `${G}-${'03'.repeat(16)}`;
  const AT = '2026-10-31T00:00:00.000Z';

  function sealed(id: string, events: CatalogEvent[]): Entry[] {
    const entries: Entry[] = [];
    for (const event of events) {
      entries.push(
        sealEntry({
          event,
          tail: id,
          seq: entries.length,
          prev: entries.at(-1)?.link.hash ?? null,
        }),
      );
    }
    return entries;
  }

  const found = (fp: string) =>
    identityFounded(
      { at: AT, who: deriveAnchor(fp), signerFp: fp, subject: deriveAnchor(fp) },
      { foundingFp: fp },
    );

  it('hands the fold no founding but the genesis tail’s', () => {
    const t = sealed(T, [found(K)]);
    const host = sealed(H, [
      found(K),
      tailRelinked(
        { at: AT, who: deriveAnchor(K), signerFp: K, subject: deriveAnchor(K) },
        {
          tail: T,
          from: recordName(T),
          into: recordName(GENESIS),
          throughHash: t[0]?.link.hash ?? '',
          eventCount: 1,
          reason: 'r',
        },
      ),
    ]);
    const genesis = sealed(GENESIS, [found(G)]);
    const kinds: Record<string, string[]> = {};
    relinkedNaming(
      new Map([
        [T, recordName(T)],
        [H, recordName(GENESIS)],
        [GENESIS, recordName(GENESIS)],
      ]),
      new Map([
        [T, t],
        [H, host],
        [GENESIS, genesis],
      ]),
      new Map([
        [T, 0],
        [H, 1],
        [GENESIS, 0],
      ]),
      (entries) => {
        for (const [tail, held] of entries) kinds[tail] = held.map((entry) => entry.event.kind);
        return [];
      },
    );
    expect(kinds).toEqual({
      [H]: ['tail.relinked'],
      [GENESIS]: ['identity.founded'],
    });
  });
});
