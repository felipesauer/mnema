/**
 * Reading many tails, held as PROPERTIES over generated chains — the rule `FORMAT.md` writes
 * under "Reading many tails" and `order.ts` implements, each case against a NAIVE MODEL that
 * restates the definition in a few lines inside this file.
 *
 * THE DEFINITION BEING HELD. Every tail is its own stream, in `seq` order, and `seq` is never
 * reordered. Across tails, the next event is the one whose tail's HEAD has the smallest `at`,
 * a tie going to the smaller tail key. The model below is that sentence and nothing cleverer:
 * it re-sorts the heads from scratch at every step, which is quadratic and cannot share a bug
 * with the cursor walk of `order.ts`.
 *
 * WHAT EACH CASE NAMES (the names are the ones the format section cites):
 *
 *   - MR1, a permutation of the tails changes nothing;
 *   - MR2, merging parts and then the whole is merging the whole;
 *   - MR3, the same tail copied twice changes nothing, and a tail copied under another id is
 *     a break the reading names;
 *   - MR4, an event appended about something else moves neither a decision's state nor the
 *     divergence reported on it;
 *   - MR5, cutting a tail's suffix leaves its prefix verifying, unless a checkpoint covers
 *     the cut;
 *   - P1, within a tail the order is `seq` even when `at` runs backwards;
 *   - P2, a cache brought forward arrival by arrival, and one deleted at a drawn point, answers
 *     what a replay answers;
 *   - and the behaviour of today under clocks that disagree, which is FIXED here and not
 *     endorsed: the study of a clock that knows before it is told may change it.
 *
 * The seed is fixed so the CI is the same run every time; `FC_SEED` explores another. A
 * counterexample is printed by fast-check with the seed and the path that replays it.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CanonicalValue,
  type CatalogEvent,
  canonicalStringify,
  catalogUpcasters,
  decisionBirth,
  decisionTransitioned,
  identityFounded,
  openChainForWriting,
  orderedSegments,
  projectionCachePath,
  tailDir,
  taskBirth,
  taskCreated,
  taskTransitioned,
  verify,
} from '@mnema/chain';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectionCache } from './cache.js';
import { projectDecisions } from './decision.js';
import { divergentMoves } from './divergent-moves.js';
import { chainReplay, orderedEvents, orderedEventsOfRecord } from './order.js';

/** Each case writes and signs real chains many times over, which five seconds does not hold. */
const CASE_TIMEOUT = 120_000;

const SEED = Number(process.env.FC_SEED ?? 20_261_007);
const upcasters = catalogUpcasters();
const SLOTS = 3;
/** The instant each machine's founding is stamped with: before any drawn one, and its own. */
const foundedAt = (slot: number): string =>
  new Date(Date.UTC(2026, 6, 20, 0, 0, slot)).toISOString();

/** One key root per slot, made once: a slot is a machine, and a machine keeps its key. */
const keyRoots: string[] = [];
const scratch: string[] = [];

beforeAll(() => {
  for (let slot = 0; slot < SLOTS; slot += 1) {
    const keyRoot = mkdtempSync(join(tmpdir(), `mnema-tails-key-${slot}-`));
    keyRoots.push(keyRoot);
  }
});

afterAll(() => {
  for (const dir of [...keyRoots, ...scratch]) rmSync(dir, { recursive: true, force: true });
});

function freshDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `mnema-tails-${label}-`));
  scratch.push(dir);
  return dir;
}

/** Drops what a run made: the properties run hundreds of times and must not fill `/tmp`. */
function cleanUp(...dirs: string[]): void {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
    const at = scratch.indexOf(dir);
    if (at >= 0) scratch.splice(at, 1);
  }
}

const iso = (second: number): string =>
  new Date(Date.UTC(2026, 6, 21, 0, 0, 0) + second * 1_000).toISOString();

// ---------------------------------------------------------------------------------------------
// What is drawn
// ---------------------------------------------------------------------------------------------

type Act =
  | { readonly kind: 'task' }
  | { readonly kind: 'birth'; readonly decision: string }
  | { readonly kind: 'move'; readonly decision: string; readonly to: 'accepted' | 'rejected' };

/** One thing one machine does, at the instant ITS clock gives — which may run backwards. */
interface Op {
  readonly slot: number;
  readonly at: number;
  readonly act: Act;
  /** The number its subjects are minted from; the position in the history when left out. */
  readonly n?: number;
}

const X = 'dec-x';
const slotArb = fc.integer({ min: 0, max: SLOTS - 1 });
/** A small range on purpose: ties between tails are the case the tie-break exists for. */
const atArb = fc.integer({ min: 0, max: 6 });

const noiseArb: fc.Arbitrary<Op> = fc.record({
  slot: slotArb,
  at: atArb,
  act: fc.oneof(
    fc.constant<Act>({ kind: 'task' }),
    fc.nat({ max: 3 }).map((n): Act => ({ kind: 'birth', decision: `dec-n${n}` })),
  ),
});

/** At most ONE move of X out of `proposed` per machine: what one machine can honestly write. */
const movesArb: fc.Arbitrary<Op[]> = fc
  .array(
    fc.option(
      fc.record({
        at: atArb,
        to: fc.constantFrom<'accepted' | 'rejected'>('accepted', 'rejected'),
      }),
      { nil: undefined },
    ),
    { minLength: SLOTS, maxLength: SLOTS },
  )
  .map((moves) =>
    moves.flatMap((move, slot): Op[] =>
      move === undefined
        ? []
        : [{ slot, at: move.at, act: { kind: 'move', decision: X, to: move.to } }],
    ),
  );

/** A history: X is born on machine 0, then drawn noise and drawn moves in a drawn interleaving. */
const historyArb: fc.Arbitrary<Op[]> = fc
  .tuple(fc.array(noiseArb, { maxLength: 8 }), movesArb)
  .chain(([noise, moves]) =>
    fc.shuffledSubarray([...noise, ...moves], {
      minLength: noise.length + moves.length,
      maxLength: noise.length + moves.length,
    }),
  )
  .map((rest): Op[] => [{ slot: 0, at: 0, act: { kind: 'birth', decision: X } }, ...rest]);

const permutationArb = fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 });

// ---------------------------------------------------------------------------------------------
// Writing a history to disk, and the model of reading it back
// ---------------------------------------------------------------------------------------------

/** What was appended to each tail, in append order, as the builders made it. */
type Appended = Map<string, CatalogEvent[]>;

/** One machine's writer per slot, founded on first use, remembering what each tail was given. */
class Scribe {
  readonly appended: Appended = new Map();
  readonly tails = new Map<number, string>();
  private readonly writers = new Map<number, ReturnType<typeof openChainForWriting>>();
  private readonly counts = new Map<number, number>();
  private applied = 0;

  constructor(
    private readonly root: string,
    private readonly checkpointAfter: ReadonlyMap<number, number> = new Map(),
  ) {}

  private put(slot: number, event: CatalogEvent): void {
    const writer = this.writers.get(slot) as ReturnType<typeof openChainForWriting>;
    writer.append(event);
    const list = this.appended.get(writer.tail) ?? [];
    list.push(event);
    this.appended.set(writer.tail, list);
    const n = (this.counts.get(slot) ?? 0) + 1;
    this.counts.set(slot, n);
    if (this.checkpointAfter.get(slot) === n) writer.checkpoint();
  }

  /** The machine of `slot`, founded if this is its first word. */
  open(slot: number): ReturnType<typeof openChainForWriting> {
    let writer = this.writers.get(slot);
    if (writer === undefined) {
      writer = openChainForWriting(this.root, {
        keyRoot: keyRoots[slot] as string,
        maxUnsignedEvents: 10_000,
      });
      this.writers.set(slot, writer);
      this.tails.set(slot, writer.tail);
      this.put(
        slot,
        identityFounded(
          {
            at: foundedAt(slot),
            who: writer.anchor,
            signerFp: writer.signerFingerprint,
            subject: writer.anchor,
          },
          { foundingFp: writer.signerFingerprint },
        ),
      );
    }
    return writer;
  }

  /** Appends one operation; the subjects it mints are numbered by how many came before. */
  apply(op: Op): void {
    const index = op.n ?? this.applied;
    this.applied += 1;
    const writer = this.open(op.slot);
    const env = (subject: string) => ({
      at: iso(op.at),
      who: writer.anchor,
      signerFp: writer.signerFingerprint,
      subject,
    });
    const { act } = op;
    if (act.kind === 'task') {
      this.put(op.slot, taskCreated(env(`task-${index}`), { title: `task ${index}` }));
    } else if (act.kind === 'birth') {
      for (const event of decisionBirth(env(act.decision), {
        title: `title of ${act.decision}`,
        rationale: 'because',
        adr: `ADR-${index}`,
        initial: 'proposed',
      })) {
        this.put(op.slot, event);
      }
    } else {
      this.put(
        op.slot,
        decisionTransitioned(env(act.decision), {
          from: 'proposed',
          to: act.to,
          action: act.to === 'accepted' ? 'accept' : 'reject',
          fields: { note: `move ${index}` },
        }),
      );
    }
  }
}

/**
 * Appends a history to `root`. `open` is the order the machines first touch the directory —
 * what MR1 permutes — and only machines that have something to say are opened.
 */
function write(
  root: string,
  history: readonly Op[],
  open: readonly number[] = [0, 1, 2],
  checkpointAfter?: ReadonlyMap<number, number>,
): Scribe {
  const scribe = new Scribe(root, checkpointAfter);
  const used = new Set(history.map((op) => op.slot));
  for (const slot of open) if (used.has(slot)) scribe.open(slot);
  for (const op of history) scribe.apply(op);
  return scribe;
}

const identity = (event: CatalogEvent): string =>
  canonicalStringify(event as unknown as CanonicalValue);

interface Stream {
  readonly key: string;
  readonly events: readonly CatalogEvent[];
}

const streamsOf = (appended: Appended): Stream[] =>
  [...appended].map(([key, events]) => ({ key, events }));

/**
 * THE MODEL. Re-sorts the heads at every step: the smallest `at` wins, a tie goes to the smaller
 * key, and the winner's tail advances by one. Quadratic, and nothing like a cursor walk.
 */
function model(streams: readonly Stream[]): CatalogEvent[] {
  const queues = streams.map((stream) => ({ key: stream.key, left: [...stream.events] }));
  const out: CatalogEvent[] = [];
  for (;;) {
    const live = queues.filter((queue) => queue.left.length > 0);
    if (live.length === 0) return out;
    live.sort((a, b) => {
      const atA = (a.left[0] as CatalogEvent).at;
      const atB = (b.left[0] as CatalogEvent).at;
      if (atA !== atB) return atA < atB ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    out.push((live[0] as (typeof live)[number]).left.shift() as CatalogEvent);
  }
}

const read = (root: string): string[] => orderedEvents({ root }, upcasters).map(identity);
const modelled = (streams: readonly Stream[]): string[] => model(streams).map(identity);

/** Runs a property under the fixed seed. */
function holds<T>(arbitrary: fc.Arbitrary<T>, predicate: (value: T) => void, runs = 20): void {
  fc.assert(fc.property(arbitrary, predicate), { seed: SEED, numRuns: runs });
}

/** The events of `merged` that belong to `tail`, as identities: what that tail's subsequence is. */
function subsequenceOf(merged: readonly CatalogEvent[], events: readonly CatalogEvent[]): string[] {
  const mine = new Set(events.map(identity));
  return merged.map(identity).filter((id) => mine.has(id));
}

// ---------------------------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------------------------

describe('the merge of many tails is its definition', () => {
  it(
    'the optimized merge equals the naive one over generated tails',
    () => {
      holds(historyArb, (history) => {
        const root = freshDir('merge');
        try {
          const { appended } = write(root, history);
          expect(read(root)).toEqual(modelled(streamsOf(appended)));
        } finally {
          cleanUp(root);
        }
      });
    },
    CASE_TIMEOUT,
  );

  it(
    'MR1: the order the tails are written into the directory changes nothing, in the model or on disk',
    () => {
      holds(fc.tuple(historyArb, permutationArb), ([history, permutation]) => {
        const a = freshDir('mr1a');
        const b = freshDir('mr1b');
        try {
          const first = write(a, history);
          const second = write(b, history, permutation);
          const streams = streamsOf(first.appended);
          expect(read(b)).toEqual(read(a));
          expect(modelled([...streams].reverse())).toEqual(modelled(streams));
          expect(read(b)).toEqual(modelled(streamsOf(second.appended)));
        } finally {
          cleanUp(a, b);
        }
      });
    },
    CASE_TIMEOUT,
  );

  it(
    'P1: within a tail the order is seq, even when at runs backwards',
    () => {
      holds(historyArb, (history) => {
        const root = freshDir('p1');
        try {
          const { appended } = write(root, history);
          const merged = orderedEvents({ root }, upcasters);
          for (const [tail, events] of appended) {
            expect(subsequenceOf(merged, events), `tail ${tail}`).toEqual(events.map(identity));
          }
        } finally {
          cleanUp(root);
        }
      });
    },
    CASE_TIMEOUT,
  );

  it(
    'P1: a tail whose at runs strictly backwards is still read forwards',
    () => {
      holds(
        fc.integer({ min: 2, max: 8 }),
        (length) => {
          const root = freshDir('p1-down');
          try {
            const history: Op[] = Array.from({ length }, (_, index) => ({
              slot: 0,
              at: length - index,
              act: { kind: 'task' },
            }));
            const { appended } = write(root, history);
            expect(read(root)).toEqual([...appended.values()].flat().map(identity));
          } finally {
            cleanUp(root);
          }
        },
        10,
      );
    },
    CASE_TIMEOUT,
  );
});

describe('MR2: merging the parts and then the whole is merging the whole', () => {
  /** Two directories, each holding what its slots wrote: the parts a pull would bring together. */
  function parts(history: readonly Op[], cut: number) {
    const left = freshDir('part-l');
    const right = freshDir('part-r');
    const whole = freshDir('whole');
    // A slot keeps its key wherever it is written, so a slot's tail is the same in all three.
    const numbered = history.map((op, n) => ({ ...op, n }));
    const l = write(
      left,
      numbered.filter((op) => op.slot < cut),
    );
    const r = write(
      right,
      numbered.filter((op) => op.slot >= cut),
    );
    write(whole, numbered);
    return { left, right, whole, l, r };
  }

  it(
    'across trees, a tie goes to the tree first and then the tail: the model of that says it',
    () => {
      holds(fc.tuple(historyArb, fc.integer({ min: 1, max: 2 })), ([history, cut]) => {
        const { left, right, whole, l, r } = parts(history, cut);
        try {
          const across = orderedEventsOfRecord([{ root: left }, { root: right }], upcasters).across;
          const keyed = [
            ...[...l.appended].map(([key, events]) => ({ key: `0:${key}`, events })),
            ...[...r.appended].map(([key, events]) => ({ key: `1:${key}`, events })),
          ];
          expect(across.map(identity)).toEqual(modelled(keyed));
        } finally {
          cleanUp(left, right, whole);
        }
      });
    },
    CASE_TIMEOUT,
  );

  it(
    'with no two heads on the same instant, the parts joined are the whole',
    () => {
      holds(fc.tuple(historyArb, fc.integer({ min: 1, max: 2 })), ([history, cut]) => {
        // An instant owned by one machine: `at * SLOTS + slot`, so no tie can arise between tails.
        const apart = history.map((op) => ({ ...op, at: op.at * SLOTS + op.slot }));
        const { left, right, whole } = parts(apart, cut);
        try {
          const across = orderedEventsOfRecord([{ root: left }, { root: right }], upcasters).across;
          const swapped = orderedEventsOfRecord(
            [{ root: right }, { root: left }],
            upcasters,
          ).across;
          expect(across.map(identity)).toEqual(read(whole));
          expect(swapped.map(identity)).toEqual(read(whole));
        } finally {
          cleanUp(left, right, whole);
        }
      });
    },
    CASE_TIMEOUT,
  );
});

describe('MR3: the union of tails is idempotent', () => {
  it(
    'copying the same tails in again changes neither the order nor the verdict',
    () => {
      holds(
        historyArb,
        (history) => {
          const root = freshDir('mr3');
          const copy = freshDir('mr3-copy');
          try {
            write(root, history);
            const before = read(root);
            cpSync(join(root, 'tails'), join(copy, 'tails'), { recursive: true });
            cpSync(join(root, 'keys'), join(copy, 'keys'), { recursive: true });
            cpSync(join(copy, 'tails'), join(root, 'tails'), { recursive: true });
            cpSync(join(copy, 'keys'), join(root, 'keys'), { recursive: true });
            expect(read(root)).toEqual(before);
            expect(chainReplay({ root }, upcasters).linkBreaks).toEqual([]);
          } finally {
            cleanUp(root, copy);
          }
        },
        20,
      );
    },
    CASE_TIMEOUT,
  );

  it(
    'a tail copied under another id does not read as a second tail: the reading names the break',
    () => {
      holds(
        historyArb,
        (history) => {
          const root = freshDir('mr3-id');
          try {
            const { tails } = write(root, history);
            const original = [...tails.values()][0] as string;
            const fake = `${original.slice(0, 8)}-fabricated`;
            cpSync(tailDir({ root }, original), tailDir({ root }, fake), { recursive: true });
            const broken = chainReplay({ root }, upcasters).linkBreaks.map((b) => b.tail);
            expect(broken).toContain(fake);
            expect(broken).not.toContain(original);
          } finally {
            cleanUp(root);
          }
        },
        15,
      );
    },
    CASE_TIMEOUT,
  );
});

describe('MR4: an event about something else moves neither the state nor the divergence', () => {
  /** What the model says of X from the merged stream: its last state, and the moves out of proposed. */
  function modelOfX(streams: readonly Stream[]) {
    const mine = model(streams).filter(
      (event) => event.kind === 'decision.transitioned' && event.subject === X,
    );
    const last = mine[mine.length - 1];
    const outOfProposed = mine.filter(
      (event) => event.kind === 'decision.transitioned' && event.payload.from === 'proposed',
    );
    return {
      state: last?.kind === 'decision.transitioned' ? last.payload.to : undefined,
      diverged:
        outOfProposed.length > 1
          ? outOfProposed.flatMap((event) =>
              event.kind === 'decision.transitioned' ? [event.payload.to] : [],
            )
          : [],
    };
  }

  const viewOfX = (root: string) => {
    const events = orderedEvents({ root }, upcasters);
    return {
      state: projectDecisions(events).get(X)?.state,
      diverged: divergentMoves(events)
        .filter((move) => move.entityId === X)
        .flatMap((move) => move.to),
    };
  };

  it(
    'what is read of X is what the model reads of X',
    () => {
      holds(historyArb, (history) => {
        const root = freshDir('mr4-model');
        try {
          const { appended } = write(root, history);
          expect(viewOfX(root)).toEqual(modelOfX(streamsOf(appended)));
        } finally {
          cleanUp(root);
        }
      });
    },
    CASE_TIMEOUT,
  );

  it(
    'MR4: appending an event about another subject, on any tail, at any instant, leaves X as it was',
    () => {
      holds(
        fc.tuple(historyArb, slotArb, atArb, fc.constantFrom('task', 'birth', 'other-move')),
        ([history, slot, at, noise]) => {
          const plain = freshDir('mr4-plain');
          const noisy = freshDir('mr4-noisy');
          try {
            // The noise is appended LAST on its tail, which is the only place a signed record
            // can put it: an earlier position would be a different chain, not a longer one.
            const act: Act =
              noise === 'task'
                ? { kind: 'task' }
                : noise === 'birth'
                  ? { kind: 'birth', decision: 'dec-other' }
                  : { kind: 'move', decision: 'dec-other', to: 'accepted' };
            write(plain, history);
            write(noisy, [...history, { slot, at, act }]);
            expect(viewOfX(noisy)).toEqual(viewOfX(plain));
            // WHY it holds: an appended event lands after everything its tail already held, so the
            // events that were read before are read in the same relative order with it there.
            const before = new Set(read(plain));
            expect(read(noisy).filter((id) => before.has(id))).toEqual(read(plain));
          } finally {
            cleanUp(plain, noisy);
          }
        },
      );
    },
    CASE_TIMEOUT,
  );
});

/** Keeps the first `keep` entries of a tail, cutting whole lines off the end of its segments. */
function cutTailTo(root: string, tail: string, keep: number): void {
  let left = keep;
  for (const segment of orderedSegments({ root }, tail)) {
    const path = segment;
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    const kept = lines.slice(0, left);
    left -= kept.length;
    writeFileSync(path, kept.length === 0 ? '' : `${kept.join('\n')}\n`);
  }
}

describe('MR5: cutting the suffix of a tail leaves its prefix', () => {
  it(
    'a cut above the last checkpoint verifies, reads as the model of the prefix, and chains',
    () => {
      holds(
        fc.tuple(historyArb, fc.nat({ max: 5 }), fc.nat({ max: 5 })),
        ([history, covered, drop]) => {
          const root = freshDir('mr5');
          try {
            // The checkpoint falls after `covered + 1` events of machine 0 (the founding is one).
            const { appended, tails } = write(
              root,
              history,
              [0, 1, 2],
              new Map([[0, covered + 1]]),
            );
            const tail = tails.get(0) as string;
            const events = appended.get(tail) as CatalogEvent[];
            const keep = Math.max(Math.min(covered + 1, events.length), events.length - drop);
            cutTailTo(root, tail, keep);
            expect(verify(root).ok).toBe(true);
            expect(chainReplay({ root }, upcasters).linkBreaks).toEqual([]);
            const prefixed: Appended = new Map(appended);
            prefixed.set(tail, events.slice(0, keep));
            expect(read(root)).toEqual(modelled(streamsOf(prefixed)));
          } finally {
            cleanUp(root);
          }
        },
        20,
      );
    },
    CASE_TIMEOUT,
  );

  it(
    'a cut BELOW a checkpoint is the one a verifier calls broken',
    () => {
      holds(
        fc.integer({ min: 2, max: 6 }),
        (count) => {
          const root = freshDir('mr5-below');
          try {
            const history: Op[] = Array.from({ length: count }, (_, index) => ({
              slot: 0,
              at: index,
              act: { kind: 'task' },
            }));
            const { tails } = write(root, history, [0, 1, 2], new Map([[0, count]]));
            cutTailTo(root, tails.get(0) as string, count - 1);
            expect(verify(root).ok).toBe(false);
          } finally {
            cleanUp(root);
          }
        },
        10,
      );
    },
    CASE_TIMEOUT,
  );
});

describe('P2: a cache brought forward is a replay', () => {
  /** Every read of the cache that depends on the order of the merge. */
  const answers = (cache: ProjectionCache) => ({
    decisions: cache.listDecisions(),
    tasks: cache.listTasks(),
    divergent: cache.divergentMoves(),
    collisions: cache.adrCollisions(),
    breaks: cache.linkBreaks,
  });

  it(
    'after any arrivals, with the cache deleted at a drawn point, it answers what a replay answers',
    () => {
      holds(
        fc.tuple(
          historyArb,
          fc.array(fc.nat({ max: 4 }), { maxLength: 3 }),
          fc.option(fc.nat({ max: 3 }), { nil: undefined }),
        ),
        ([history, cuts, wipeAt]) => {
          const root = freshDir('p2');
          try {
            const scribe = new Scribe(root);
            let from = 0;
            let round = 0;
            for (const cut of [...cuts.map((c) => from + c), history.length]) {
              const to = Math.min(history.length, Math.max(from, cut));
              for (const op of history.slice(from, to)) scribe.apply(op);
              from = to;
              const cache = ProjectionCache.open(root, { upcasters, persist: true });
              try {
                cache.refresh();
              } finally {
                cache.close();
              }
              // The cache file is deleted after a drawn round: the next open builds it again.
              if (wipeAt === round) rmSync(projectionCachePath({ root }), { force: true });
              round += 1;
            }
            const live = ProjectionCache.open(root, { upcasters, persist: true });
            const replay = ProjectionCache.open(root, { upcasters });
            try {
              live.refresh();
              replay.rebuild();
              expect(answers(live)).toEqual(answers(replay));
              // And what both say of X is what the naive merge says it is: the LAST move out.
              const moved = model(streamsOf(scribe.appended)).filter(
                (event) => event.kind === 'decision.transitioned' && event.subject === X,
              );
              const last = moved[moved.length - 1];
              expect(live.getDecision(X)?.state).toEqual(
                last?.kind === 'decision.transitioned' ? last.payload.to : undefined,
              );
            } finally {
              live.close();
              replay.close();
            }
          } finally {
            cleanUp(root);
          }
        },
        20,
      );
    },
    CASE_TIMEOUT,
  );
});

describe('clocks that disagree: what the merge does TODAY, fixed and not endorsed', () => {
  it(
    'today, a clock that runs behind sorts an honest task sequence out of its order, and the move is named as a divergence',
    () => {
      // Machine 0 births a task, moves it on, and reopens it. Machine 1 pulls the reopened task and
      // cancels it, but its clock is behind, so the merge puts its move BEFORE the reopening. The
      // record is honest; the reading of tasks leans on the order and names a divergence.
      const root = freshDir('skew-task');
      try {
        const first = openChainForWriting(root, {
          keyRoot: keyRoots[0] as string,
          maxUnsignedEvents: 10_000,
        });
        const second = openChainForWriting(root, {
          keyRoot: keyRoots[1] as string,
          maxUnsignedEvents: 10_000,
        });
        const env = (writer: typeof first, at: number) => ({
          at: iso(at),
          who: writer.anchor,
          signerFp: writer.signerFingerprint,
          subject: 'task-honest',
        });
        for (const event of taskBirth(env(first, 10), { title: 'a task', initial: 'draft' })) {
          first.append(event);
        }
        first.append(
          taskTransitioned(env(first, 20), { from: 'draft', to: 'ready', action: 'ready' }),
        );
        first.append(
          taskTransitioned(env(first, 30), { from: 'ready', to: 'draft', action: 'reopen' }),
        );
        second.append(
          taskTransitioned(env(second, 25), { from: 'draft', to: 'cancelled', action: 'cancel' }),
        );
        const merged = orderedEvents({ root }, upcasters);
        expect(merged.map((event) => event.at)).toEqual([
          iso(10),
          iso(10),
          iso(20),
          iso(25),
          iso(30),
        ]);
        const named = divergentMoves(merged).filter((move) => move.entityId === 'task-honest');
        expect(named).toHaveLength(1);
        expect(named[0]?.evidence).toHaveLength(2);
      } finally {
        cleanUp(root);
      }
    },
    CASE_TIMEOUT,
  );

  it(
    'today, a machine with a skewed clock keeps its own order, and two moves out of one state are always named',
    () => {
      holds(
        fc.tuple(
          fc.array(fc.integer({ min: -30, max: 30 }), { minLength: SLOTS, maxLength: SLOTS }),
          historyArb,
        ),
        ([skews, history]) => {
          const root = freshDir('skew');
          try {
            const skewed = history.map((op) => ({
              ...op,
              at: op.at + (skews[op.slot] as number) + 30,
            }));
            const { appended } = write(root, skewed);
            const merged = orderedEvents({ root }, upcasters);
            // The order of a tail never changes, whatever the clocks say.
            for (const [tail, events] of appended) {
              expect(subsequenceOf(merged, events), tail).toEqual(events.map(identity));
            }
            // The divergence is named whichever move the order puts last, and never silently.
            const moves = skewed.filter((op) => op.act.kind === 'move');
            const named = divergentMoves(merged).filter((move) => move.entityId === X);
            if (moves.length > 1) {
              expect(named).toHaveLength(1);
              expect(named[0]?.evidence).toHaveLength(moves.length);
            } else {
              expect(named).toEqual([]);
            }
          } finally {
            cleanUp(root);
          }
        },
      );
    },
    CASE_TIMEOUT,
  );
});
