/**
 * Reading many tails, held as PROPERTIES over generated chains: the rule `FORMAT.md` writes
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
 *   - MR3, a tail copied under another id is a break the reading names (copying the same tail
 *     in again changes no byte, so there is nothing there to hold);
 *   - MR4, an event appended about something else moves neither a decision's state nor the
 *     divergence reported on it;
 *   - MR5, cutting a tail's suffix leaves its prefix verifying, unless a checkpoint covers
 *     the cut;
 *   - P1, within a tail the order is `seq` even when `at` runs backwards;
 *   - P2, a cache brought forward arrival by arrival, and one deleted at a drawn point, answers
 *     what a replay answers;
 *   - the behaviour under clocks that disagree when nothing is cited, which is FIXED here and
 *     not endorsed: it is what a record written before citations existed still reads as;
 *   - and with every machine citing the heads it read, as the product's writer does: R5, the
 *     merge is a model that re-sorts the READY heads at every step; R6, a cache brought forward
 *     is a replay, including when an arrival is what a covered event cited and could not find.
 *     The pure half of the citation properties (R1-R4, R8) is in `chain/src/chain/
 *     causal-order.properties.test.ts`.
 *
 * WHAT THE READING LEAVES OUT IS NOT THE MERGE. The order a projection folds is the merge
 * without the moves the workflow does not allow (FORMAT.md §6.7), so every model below is the
 * merge it restates, judged by the readers' own `illegalMoves` ({@link applied}). The judgment is
 * not what these cases hold: that is held where it is written (`chain/src/chain/moves.test.ts`),
 * and a model of it here would be a second copy of the rule rather than a check of the merge.
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
  type CitationHeld,
  canonicalStringify,
  catalogUpcasters,
  decisionBirth,
  decisionTransitioned,
  identityFounded,
  illegalMoves,
  listTails,
  openChainForWriting,
  orderedSegments,
  projectionCachePath,
  readTail,
  subjectEvents,
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
import { chainArrivals, chainReplay, orderedEvents, orderedEventsOfRecord } from './order.js';

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
  | {
      readonly kind: 'birth';
      readonly decision: string;
      /** The number the `ADR-` label is minted from; the op's own index when left out. */
      readonly adr?: number;
    }
  | { readonly kind: 'move'; readonly decision: string; readonly to: 'accepted' | 'rejected' }
  /** `decision` is superseded BY `by`: the subject is the superseded one. */
  | { readonly kind: 'supersede'; readonly decision: string; readonly by: string };

/** One thing one machine does, at the instant ITS clock gives, which may run backwards. */
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
    /** Whether each machine cites the heads it read, as the product's writer does. */
    private readonly cite = false,
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
        citeHeads: this.cite,
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
      // A decision is born once: an id is minted unique (a UUIDv7), so the noise's is numbered
      // like its label. Two births of one id would be the second one no reader applies
      // (FORMAT.md §6.7), and two lines of the same bytes besides.
      const subject = act.decision === X ? X : `${act.decision}-${index}`;
      for (const event of decisionBirth(env(subject), {
        title: `title of ${subject}`,
        rationale: 'because',
        adr: `ADR-${act.adr ?? index}`,
        initial: 'proposed',
      })) {
        this.put(op.slot, event);
      }
    } else if (act.kind === 'supersede') {
      this.put(
        op.slot,
        decisionTransitioned(env(act.decision), {
          from: 'accepted',
          to: 'superseded',
          action: 'supersede',
          by: act.by,
        }),
      );
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
 * Appends a history to `root`. `open` is the order the machines first touch the directory,
 * what MR1 permutes, and only machines that have something to say are opened.
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
  const queues = streams.map((stream, tail) => ({
    key: stream.key,
    tail,
    taken: 0,
    left: [...stream.events],
  }));
  const out: { event: CatalogEvent; tail: number; position: number }[] = [];
  for (;;) {
    const live = queues.filter((queue) => queue.left.length > 0);
    if (live.length === 0) return applied(out);
    live.sort((a, b) => {
      const atA = (a.left[0] as CatalogEvent).at;
      const atB = (b.left[0] as CatalogEvent).at;
      if (atA !== atB) return atA < atB ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    const next = live[0] as (typeof live)[number];
    out.push({ event: next.left.shift() as CatalogEvent, tail: next.tail, position: next.taken });
    next.taken += 1;
  }
}

/**
 * What a reader folds of an order: the order without the moves the workflow does not allow,
 * judged by the readers' own rule (see the module comment), against the citations `held`, none
 * for the writers of this file that cite nothing.
 */
function applied(
  order: readonly { event: CatalogEvent; tail: number; position: number }[],
  held: readonly CitationHeld[] = [],
): CatalogEvent[] {
  const illegal = illegalMoves(order, held);
  return order.filter((_, index) => !illegal.has(index)).map(({ event }) => event);
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
          // A tail's events in seq order: those a reader applies (see the module comment).
          const kept = new Set(modelled(streamsOf(appended)));
          for (const [tail, events] of appended) {
            expect(subsequenceOf(merged, events), `tail ${tail}`).toEqual(
              events.map(identity).filter((id) => kept.has(id)),
            );
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
    // A move is written to the tree its subject was born in, as the product routes it: X is born
    // on machine 0, so a machine in the other part does not move it (a move there would be one of
    // a subject that part never held, judged per tree, FORMAT.md §6.7).
    const numbered = history
      .map((op, n) => ({ ...op, n }))
      .filter((op) => !(op.act.kind === 'move' && op.slot >= cut));
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

describe('across ten trees or more: the tree position is a number', () => {
  it(
    'the tree position in the tie is compared as a number, so the tree listed eleventh sorts after the one listed second',
    () => {
      const roots: string[] = [];
      try {
        for (let tree = 0; tree < 11; tree += 1) {
          const root = freshDir(`ten-${tree}`);
          roots.push(root);
          const writer = openChainForWriting(root, {
            keyRoot: keyRoots[0] as string,
            maxUnsignedEvents: 10_000,
          });
          writer.append(
            taskCreated(
              {
                at: iso(1),
                who: writer.anchor,
                signerFp: writer.signerFingerprint,
                subject: `tree-${tree}`,
              },
              { title: `tree ${tree}` },
            ),
          );
        }
        const across = orderedEventsOfRecord(
          roots.map((root) => ({ root })),
          upcasters,
        ).across.map((event) => event.subject);
        // Every head ties on `at` and on the tail id, so the tree's position decides, as a
        // number: 0, 1, 2, ... 10. Compared as text, `"10:"` sorted before `"1:"`.
        expect(across).toEqual(
          ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((tree) => `tree-${tree}`),
        );
      } finally {
        cleanUp(...roots);
      }
    },
    CASE_TIMEOUT,
  );
});

// MR3's first half, "copying the same tail in again changes nothing", is NOT held here: the copy
// lands on the same paths with the same bytes, so the tree does not change and no defect can
// light it, and the union has no deduplication to test. Nothing in the product merges two
// copies of one tail read from different places: `orderedEventsOfRecord` says so in its own
// words (a plain interleave, no de-duplication). What is held is the other half.
describe('MR3: a tail under another id is not a second tail', () => {
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

describe('clocks that disagree, with nothing cited: fixed and not endorsed', () => {
  it(
    'uncited, a clock that runs behind sorts an honest task sequence out of its order, and the move is not applied',
    () => {
      // Machine 0 births a task, submits it and starts it. Machine 1 pulls the started task and
      // cancels it, but its clock is behind, so the merge puts its move BEFORE the start. The
      // record is honest; its second writer cited nothing, so nothing says it saw the task at
      // all, and the task was READY there: the cancel left a state the task was not in, and no
      // reader applies it (FORMAT.md §6.7). `verify` names it.
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
        for (const event of taskBirth(env(first, 10), { title: 'a task', initial: 'DRAFT' })) {
          first.append(event);
        }
        first.append(
          taskTransitioned(env(first, 20), { from: 'DRAFT', to: 'READY', action: 'submit' }),
        );
        first.append(
          taskTransitioned(env(first, 30), { from: 'READY', to: 'IN_PROGRESS', action: 'start' }),
        );
        second.append(
          taskTransitioned(env(second, 25), {
            from: 'IN_PROGRESS',
            to: 'CANCELED',
            action: 'cancel',
            fields: { reason: 'not needed' },
          }),
        );
        const merged = orderedEvents({ root }, upcasters);
        expect(merged.filter((event) => event.subject === 'task-honest').map((e) => e.at)).toEqual([
          iso(10),
          iso(10),
          iso(20),
          iso(30),
        ]);
        expect(divergentMoves(merged).filter((move) => move.entityId === 'task-honest')).toEqual(
          [],
        );
        expect(
          verify(root).census.filter(
            (note) => note.kind === 'illegal-move' && note.subject === 'task-honest',
          ),
        ).toHaveLength(1);
      } finally {
        cleanUp(root);
      }
    },
    CASE_TIMEOUT,
  );

  it(
    'uncited, a machine with a skewed clock keeps its own order, and two moves out of one state are always named',
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
            // The order of a tail never changes, whatever the clocks say: of what is applied.
            const kept = new Set(modelled(streamsOf(appended)));
            for (const [tail, events] of appended) {
              expect(subsequenceOf(merged, events), tail).toEqual(
                events.map(identity).filter((id) => kept.has(id)),
              );
            }
            // Two moves out of one state are named whichever the order puts last, and never
            // silently: as a divergence when each writer saw the state it left, and otherwise as a
            // move the workflow does not allow, which no reader applies and `verify` names
            // (FORMAT.md §6.7). A writer that cites nothing saw no birth it did not write itself.
            const moves = skewed.filter((op) => op.act.kind === 'move');
            const applied =
              merged.filter(
                (event) => event.kind === 'decision.transitioned' && event.subject === X,
              ).length - 1;
            const named = divergentMoves(merged).filter((move) => move.entityId === X);
            const notApplied = verify(root).census.filter(
              (note) => note.kind === 'illegal-move' && note.subject === X,
            );
            expect(applied + notApplied.length).toBe(moves.length);
            if (applied > 1) {
              expect(named).toHaveLength(1);
              expect(named[0]?.evidence).toHaveLength(applied);
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

// ---------------------------------------------------------------------------------------------
// With citations: every machine cites the heads it read, as the product's writer does
// ---------------------------------------------------------------------------------------------

/** Every tail of `root` as read back, each entry with its hash: what the causal model needs. */
function tailsOnDisk(root: string) {
  return listTails({ root }).map((tail) => ({
    key: tail,
    entries: readTail({ root }, tail, upcasters).entries.map((entry) => ({
      event: entry.event,
      id: identity(entry.event),
      at: entry.event.at,
      hash: entry.link.hash,
      after: entry.event.after ?? [],
    })),
  }));
}

/**
 * THE CAUSAL MODEL. Re-sorts, at every step, the heads whose citations have all been taken
 * (a citation of a hash the record does not hold is no citation), by `at` and then tail id.
 * Quadratic, and it shares nothing with `causalOrder` but the sentence it restates.
 */
function causalModel(root: string): string[] {
  const tails = tailsOnDisk(root);
  const queues = tails.map((tail, index) => ({
    key: tail.key,
    tail: index,
    taken: 0,
    left: [...tail.entries],
  }));
  const held = new Set(queues.flatMap((queue) => queue.left.map((entry) => entry.hash)));
  // Where each entry is, so a citation can be told to the judgment by tail and position.
  const where = new Map<string, { tail: number; position: number }>();
  for (const [index, tail] of tails.entries()) {
    for (const [position, entry] of tail.entries.entries()) {
      where.set(entry.hash, { tail: index, position });
    }
  }
  const citations: CitationHeld[] = [];
  for (const [index, tail] of tails.entries()) {
    for (const [position, entry] of tail.entries.entries()) {
      for (const hash of entry.after) {
        const cited = where.get(hash);
        if (cited !== undefined) {
          citations.push({
            tail: index,
            position,
            citedTail: cited.tail,
            citedPosition: cited.position,
          });
        }
      }
    }
  }
  const taken = new Set<string>();
  const out: { event: CatalogEvent; tail: number; position: number }[] = [];
  for (;;) {
    const live = queues.filter((queue) => queue.left.length > 0);
    if (live.length === 0) return applied(out, citations).map(identity);
    const ready = live.filter((queue) =>
      (queue.left[0] as (typeof queue.left)[number]).after.every(
        (hash) => !held.has(hash) || taken.has(hash),
      ),
    );
    ready.sort((a, b) => {
      const atA = (a.left[0] as (typeof a.left)[number]).at;
      const atB = (b.left[0] as (typeof b.left)[number]).at;
      if (atA !== atB) return atA < atB ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    const queue = ready[0] as (typeof ready)[number];
    const next = queue.left.shift() as (typeof queues)[number]['left'][number];
    taken.add(next.hash);
    out.push({ event: next.event, tail: queue.tail, position: queue.taken });
    queue.taken += 1;
  }
}

/** A history with each machine's clock skewed by a drawn amount: clocks that disagree. */
const skewedArb = fc
  .tuple(
    fc.array(fc.integer({ min: -6, max: 6 }), { minLength: SLOTS, maxLength: SLOTS }),
    historyArb,
  )
  .map(([skews, history]) =>
    history.map((op) => ({ ...op, at: op.at + (skews[op.slot] as number) + 6 })),
  );

describe('with citations: every machine cites the heads it read, as the product writes', () => {
  it(
    'R5: under clocks that disagree, the merge is the causal model, and every tail is read in seq order',
    () => {
      holds(skewedArb, (history) => {
        const root = freshDir('cited');
        try {
          const scribe = new Scribe(root, new Map(), true);
          for (const slot of [0, 1, 2])
            if (history.some((op) => op.slot === slot)) scribe.open(slot);
          for (const op of history) scribe.apply(op);
          const kept = causalModel(root);
          expect(read(root)).toEqual(kept);
          const merged = orderedEvents({ root }, upcasters);
          const applied = new Set(kept);
          for (const tail of tailsOnDisk(root)) {
            const mine = new Set(tail.entries.map((entry) => entry.id));
            expect(merged.map(identity).filter((id) => mine.has(id))).toEqual(
              tail.entries.map((entry) => entry.id).filter((id) => applied.has(id)),
            );
          }
        } finally {
          cleanUp(root);
        }
      });
    },
    CASE_TIMEOUT,
  );

  it(
    'R6: a cache brought forward is a replay, with citations and clocks that disagree',
    () => {
      holds(
        fc.tuple(skewedArb, fc.array(fc.nat({ max: 4 }), { maxLength: 3 })),
        ([history, cuts]) => {
          const root = freshDir('cited-p2');
          try {
            const scribe = new Scribe(root, new Map(), true);
            let from = 0;
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
            }
            const live = ProjectionCache.open(root, { upcasters, persist: true });
            const replay = ProjectionCache.open(root, { upcasters });
            try {
              live.refresh();
              replay.rebuild();
              expect(live.listDecisions()).toEqual(replay.listDecisions());
              expect(live.listTasks()).toEqual(replay.listTasks());
              expect(live.divergentMoves()).toEqual(replay.divergentMoves());
            } finally {
              live.close();
              replay.close();
            }
          } finally {
            cleanUp(root);
          }
        },
      );
    },
    CASE_TIMEOUT,
  );

  it(
    'R6: an arrival that a covered event cited, and could not find, is not a suffix; the cache reads again',
    () => {
      const elsewhere = freshDir('cited-elsewhere');
      const root = freshDir('cited-arrives');
      try {
        const writerOf = (at: string, slot: number) => {
          const writer = openChainForWriting(at, {
            keyRoot: keyRoots[slot] as string,
            maxUnsignedEvents: 10_000,
          });
          const task = (second: number, id: string, after?: readonly string[]) =>
            writer.append(
              taskCreated(
                {
                  at: iso(second),
                  who: writer.anchor,
                  signerFp: writer.signerFingerprint,
                  subject: id,
                  ...(after === undefined ? {} : { after }),
                },
                { title: id },
              ),
            );
          return { writer, task };
        };
        // C writes on a clone this record has not pulled yet; B has, and cites C's head.
        const c = writerOf(elsewhere, 2);
        const cited = c.task(5, 'on-c').link.hash;
        writerOf(root, 0).task(1, 'on-a');
        writerOf(root, 1).task(2, 'on-b', [cited]);

        const covered = chainReplay({ root }, upcasters).frontier;
        expect(covered.unresolved).toEqual([cited]);
        const cache = ProjectionCache.open(root, { upcasters, persist: true });
        try {
          cache.refresh();
        } finally {
          cache.close();
        }

        // C's tail arrives. Its entry is LATER than everything covered, so by `at` alone it would
        // follow; but B cited it, so B moves after it, and what was covered is not a prefix.
        cpSync(tailDir({ root: elsewhere }, c.writer.tail), tailDir({ root }, c.writer.tail), {
          recursive: true,
        });
        expect(chainArrivals({ root }, upcasters, covered)).toMatchObject({
          suffix: false,
          why: 'AN_ARRIVAL_IS_NOT_LATER',
        });
        expect(orderedEvents({ root }, upcasters).map((event) => event.subject)).toEqual([
          'on-a',
          'on-c',
          'on-b',
        ]);
        const live = ProjectionCache.open(root, { upcasters, persist: true });
        const replay = ProjectionCache.open(root, { upcasters });
        try {
          live.refresh();
          replay.rebuild();
          expect(live.listTasks()).toEqual(replay.listTasks());
        } finally {
          live.close();
          replay.close();
        }
      } finally {
        cleanUp(elsewhere, root);
      }
    },
    CASE_TIMEOUT,
  );

  it(
    'R6: an ARRIVAL citing what the record does not hold yet still waits for it when it comes, read incrementally',
    () => {
      const elsewhere = freshDir('cited-later');
      const root = freshDir('cited-incremental');
      try {
        const open = (at: string, slot: number) =>
          openChainForWriting(at, { keyRoot: keyRoots[slot] as string, maxUnsignedEvents: 10_000 });
        const env = (
          writer: ReturnType<typeof open>,
          second: number,
          after?: readonly string[],
        ) => ({
          at: iso(second),
          who: writer.anchor,
          signerFp: writer.signerFingerprint,
          subject: X,
          ...(after === undefined ? {} : { after }),
        });
        const a = open(root, 0);
        for (const event of decisionBirth(env(a, 1), {
          title: 'x',
          rationale: 'because',
          adr: 'ADR-1',
          initial: 'proposed',
        })) {
          a.append(event);
        }
        // C accepts X on a clone this record has not pulled.
        const c = open(elsewhere, 2);
        const accepted = c.append(
          decisionTransitioned(env(c, 5), {
            from: 'proposed',
            to: 'accepted',
            action: 'accept',
            fields: { note: 'yes' },
          }),
        ).link.hash;
        const refreshed = () => {
          const cache = ProjectionCache.open(root, { upcasters, persist: true });
          try {
            cache.refresh();
          } finally {
            cache.close();
          }
        };
        refreshed();
        // B had pulled C's acceptance on its own clone and supersedes X on top of it, by a
        // decision A recorded, with a clock behind; this record receives B's tail first, and C's
        // only later.
        for (const event of decisionBirth(
          { ...env(a, 1), subject: 'dec-y' },
          {
            title: 'y',
            rationale: 'because',
            adr: 'ADR-2',
            initial: 'proposed',
          },
        )) {
          a.append(event);
        }
        const b = open(root, 1);
        b.append(
          decisionTransitioned(env(b, 2, [accepted]), {
            from: 'accepted',
            to: 'superseded',
            action: 'supersede',
            by: 'dec-y',
            fields: { reason: 'y replaces it' },
          }),
        );
        refreshed();
        cpSync(tailDir({ root: elsewhere }, c.tail), tailDir({ root }, c.tail), {
          recursive: true,
        });
        const live = ProjectionCache.open(root, { upcasters, persist: true });
        const replay = ProjectionCache.open(root, { upcasters });
        try {
          live.refresh();
          replay.rebuild();
          expect(replay.getDecision(X)?.state).toBe('superseded');
          expect(live.getDecision(X)?.state).toBe('superseded');
        } finally {
          live.close();
          replay.close();
        }
      } finally {
        cleanUp(elsewhere, root);
      }
    },
    CASE_TIMEOUT,
  );
});

describe('a subject read off its own lines is the subject the merge reads', () => {
  // A gate reads the subject it judges by searching the segments for the lines that name it
  // (`subjectEvents`), and a subject moved on more than one machine is placed by the merge over
  // keys read off the bytes. Whatever the clocks said and whether or not anything was cited, what
  // it hands back is the subsequence of the replay about that subject, and so is the state.
  it(
    'under clocks that disagree, cited or not, the events of every subject are the merge’s, in its order',
    () => {
      holds(
        fc.tuple(skewedArb, fc.boolean()),
        ([history, cite]) => {
          const root = freshDir('subject');
          try {
            const scribe = new Scribe(root, new Map(), cite);
            for (const slot of [0, 1, 2])
              if (history.some((op) => op.slot === slot)) scribe.open(slot);
            for (const op of history) scribe.apply(op);
            const merged = orderedEvents({ root }, upcasters);
            const subjects = [...new Set(merged.map((event) => event.subject))];
            const read = subjectEvents({ root }, upcasters, subjects);
            for (const subject of subjects) {
              expect((read.get(subject) ?? []).map(identity)).toEqual(
                merged.filter((event) => event.subject === subject).map(identity),
              );
            }
            expect(projectDecisions(read.get(X) ?? []).get(X)?.state).toBe(
              projectDecisions(merged).get(X)?.state,
            );
          } finally {
            cleanUp(root);
          }
        },
        40,
      );
    },
    CASE_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
// A supersede, and two decisions that carry the same label
// ---------------------------------------------------------------------------------------------

/**
 * The history above never supersedes anything and never gives two decisions one `ADR-` label,
 * so `supersededBy`, `supersedes` and `adrCollisions` were never asked a question. This one
 * does both: labels are drawn from a range of three, which two machines meeting there must
 * collide in, and a supersede names a successor that may or may not have been born.
 */
const collidingHistoryArb: fc.Arbitrary<Op[]> = fc
  .tuple(
    historyArb,
    fc.array(
      fc.record({ slot: slotArb, at: atArb, n: fc.nat({ max: 3 }), adr: fc.nat({ max: 2 }) }),
      { maxLength: 6 },
    ),
    fc.array(
      fc.record({ slot: slotArb, at: atArb, of: fc.nat({ max: 3 }), by: fc.nat({ max: 3 }) }),
      { maxLength: 4 },
    ),
  )
  .chain(([history, labelled, superseding]) => {
    const extra: Op[] = [
      ...labelled.map(
        (one): Op => ({
          slot: one.slot,
          at: one.at,
          act: { kind: 'birth', decision: `dec-n${one.n}`, adr: one.adr },
        }),
      ),
      ...superseding
        .filter((one) => one.of !== one.by)
        .map(
          (one): Op => ({
            slot: one.slot,
            at: one.at,
            act: { kind: 'supersede', decision: `dec-n${one.of}`, by: `dec-n${one.by}` },
          }),
        ),
    ];
    return fc
      .shuffledSubarray(extra, { minLength: extra.length, maxLength: extra.length })
      .map((rest): Op[] => [...history, ...rest]);
  });

/**
 * What the projection of decisions says, restated off the merged events in a few lines: a
 * decision is the LAST record and the LAST transition that name it, it exists only with both,
 * and a supersede writes `supersededBy` on its subject and `supersedes` on its successor.
 */
function expectedLinks(merged: readonly CatalogEvent[]) {
  const label = new Map<string, string>();
  const moved = new Set<string>();
  const supersededBy = new Map<string, string>();
  const supersedes = new Map<string, string>();
  for (const event of merged) {
    if (event.kind === 'decision.recorded') label.set(event.subject, event.payload.adr);
    if (event.kind === 'decision.transitioned') {
      moved.add(event.subject);
      if (event.payload.by !== undefined) {
        supersededBy.set(event.subject, event.payload.by);
        supersedes.set(event.payload.by, event.subject);
      }
    }
  }
  const projected = [...label.keys()].filter((id) => moved.has(id)).sort();
  const byLabel = new Map<string, string[]>();
  for (const id of projected) {
    const ids = byLabel.get(label.get(id) as string) ?? [];
    ids.push(id);
    byLabel.set(label.get(id) as string, ids);
  }
  return {
    projected,
    links: projected.map((id) => ({
      id,
      adr: label.get(id),
      supersededBy: supersededBy.get(id),
      supersedes: supersedes.get(id),
    })),
    collisions: [...byLabel]
      .filter(([, ids]) => ids.length > 1)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([adr, ids]) => ({ adr, ids })),
  };
}

describe('P2: the links and the label collisions of a supersede, over generated tails', () => {
  it(
    'a cache brought forward and a replay say what the naive reading says, in any order of the tails',
    () => {
      holds(
        fc.tuple(collidingHistoryArb, permutationArb),
        ([history, permutation]) => {
          const root = freshDir('links');
          const other = freshDir('links-permuted');
          try {
            const scribe = write(root, history);
            write(other, history, permutation);
            const want = expectedLinks(model(streamsOf(scribe.appended)));
            for (const dir of [root, other]) {
              const cache = ProjectionCache.open(dir, { upcasters });
              try {
                cache.rebuild();
                const got = cache
                  .listDecisions()
                  .map((d) => ({
                    id: d.id,
                    adr: d.adr,
                    supersededBy: d.supersededBy,
                    supersedes: d.supersedes,
                  }))
                  .sort((a, b) => (a.id < b.id ? -1 : 1));
                expect(got).toEqual(want.links);
                expect(cache.adrCollisions()).toEqual(want.collisions);
              } finally {
                cache.close();
              }
            }
          } finally {
            cleanUp(root, other);
          }
        },
        40,
      );
    },
    CASE_TIMEOUT,
  );
});
