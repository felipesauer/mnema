/**
 * THE SPLIT IS FROZEN BEFORE THE NUMBER.
 *
 * A measurement of this product's first promise is pre-registered under `measurements/p1/`:
 * the promise, the arms, the scorer, the reading of every possible outcome, and — the part
 * this file guards — WHICH tasks the harness may be iterated against, which are touched
 * exactly once, and which of them the headline number is computed over.
 *
 * WHY A TEST AND NOT A PARAGRAPH. The split is the only part of a pre-registration that can be
 * violated by accident. A pilot that runs whatever task sorts first touches a held-out task
 * without anybody deciding to; a harness fixed against the negative control softens the very
 * signal that would invalidate the run; a headline averaged over the tasks the harness was
 * tuned against reports the tuning as if it were the product. All three are one line away at
 * all times, and none of them leaves a trace in the result. So the rules are asserted here,
 * over the committed files, where a violation is red before it is a number.
 *
 * IT GUARDS EVERY ROUND, and the rules are written ONCE and applied to each. The protocol has
 * THREE rounds. (This comment said "two rounds" until 20 Aug 2026, and what falsified it is
 * `round-3/`: the first round ran in August 2026 and spent its tasks, the second ran on the 20th
 * and spent its own, and the third is pre-registered with ten new tasks frozen before the
 * mechanism it will measure exists.) A guard written for one round and copied for the others is
 * two readings of one rule, which is the shape that drifts in silence — so `describe.each` over
 * the rounds is the point, not a convenience. What differs between rounds is declared per round
 * below, never duplicated.
 *
 * AND ROUND 3 WAS FROZEN TWICE, which is the one thing a pre-registration may do and the one
 * thing a diff hides. It was declared with five arms and re-declared with four, before a cell of
 * it ran and before any mechanism of it was built, so nothing about the change can have been
 * chosen against a result. What keeps that readable in the committed state rather than only in
 * history is `split.json`'s `arms_withdrawn`, and the cases below hold `arms.md` to naming a
 * reason for every arm that is absent — the ones round 2 ran and this round does not, and the
 * ones this round declared and withdrew. `prosa` is both, which is why that list is computed in
 * one function instead of two loops.
 *
 * AND ONE RULE IS ABOUT THE ROUNDS TOGETHER: no task belongs to two of them. Each round keeps
 * its tasks in a different directory of a workbench git ignores, so both rounds' own checks pass
 * while the newer one quietly re-runs a task whose result is already known. That is spending a
 * held-out task twice, which is the one mistake this protocol cannot undo, and no per-round
 * check can see it.
 *
 * WHAT THIS CANNOT COVER, said out loud rather than left to be discovered. The tasks live in a
 * workbench that git ignores, so nothing here can read them: `fixtures.sha256` is the
 * committed PROXY for which tasks exist, and this file checks the pre-registration against
 * itself. That the file matches the tasks on disk is checked by the harness's own preflight,
 * which refuses to run when a hash moves or a task is missing from the split — and that is a
 * check no committed test can make, because the thing it compares against is not committed.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The pre-registration — this file is `packages/code/tests/…`. */
const P1 = fileURLToPath(new URL('../../../measurements/p1/', import.meta.url));

/**
 * The selection a sieving round froze BEFORE it ran: which arm sieves, how many times,
 * and the band that keeps a task. Every number the derivation below uses comes from here
 * and none of them is repeated in this file — a band written twice is a band that can be
 * widened in one place after a result.
 */
type Sieve = {
  readonly arm: string;
  readonly runs: number;
  readonly keep_if_rate_between: readonly [number, number];
  readonly min_scorable: number;
  readonly cells_are_discarded: boolean;
};

/** One candidate as the sieve measured it. The rate is DERIVED, never stored and trusted. */
type Candidate = {
  readonly id: string;
  readonly scorable: number;
  readonly conforms: number;
};

/**
 * What a sieve produced — written after it ran and before the comparison's first cell.
 *
 * It carries the complement as well as the selection, and that is the whole reason it is a
 * file rather than an edit to `split.json`: a headline that is a SUBSET of what the split
 * implies leaves the reader unable to tell a task that was sieved out from a task that was
 * quietly dropped, unless both sides are data.
 */
type Outcome = {
  readonly round: number;
  readonly headline: readonly string[];
  readonly sieved_out: readonly string[];
  readonly candidates: readonly Candidate[];
  /** How many survivors a comparison needs, and whether this round got them. */
  readonly minimum: number;
  readonly survivors: number;
  readonly comparison_runs: boolean;
};

type Split = {
  readonly frozen_at: string;
  readonly pilot: string;
  readonly development: readonly string[];
  readonly held_out: readonly string[];
  /**
   * The tasks the headline is computed over — a LIST for a round that names them at the
   * freeze, and `null` for a round whose headline is derived by a sieve that has not run
   * yet. Round 4 is the first of the second kind, and the null is the honest value: the
   * set is not unknown to this file, it is not yet a fact about the world.
   */
  readonly headline: readonly string[] | null;
  readonly rule: string;
  /** The tasks a sieving round may keep. Absent in a round with no sieve. */
  readonly candidates?: readonly string[];
  /** How a sieving round selects, frozen before its first cell. */
  readonly sieve?: Sieve;
  /** Round 2 declares its arms; round 1's file predates the field and is not edited. */
  readonly arms?: readonly string[];
  /** Rounds 2 and 3 carry the size as data, with the decision on it named as open. */
  readonly n?: number;
  readonly n_decision?: string;
  /** Round 3 states how its development pair was chosen; rounds 1 and 2 do not carry it. */
  readonly development_criterion?: string;
  /**
   * The arms a round DECLARED and then withdrew, before running a cell of it.
   *
   * Round 3 alone carries it, because round 3 alone was frozen twice. An arm that leaves
   * a pre-registration in a diff is an arm nobody can check was ever declared, so the
   * withdrawal is data and the reason for it is prose the case below holds it to.
   */
  readonly arms_withdrawn?: readonly string[];
  readonly arms_withdrawn_note?: string;
};

/** The protocol, shared by every round: the promise and the size of the first one. */
const protocol = readFileSync(join(P1, 'protocol.md'), 'utf-8');

/** One round of the protocol: where its pre-registration lives, and what it holds. */
type Round = {
  readonly round: number;
  readonly dir: string;
  readonly split: Split;
  readonly digests: string;
  /**
   * `null` for a round whose comparison a rule frozen before its first cell REFUSED.
   *
   * Round 4 is the first: its sieve kept one candidate of sixteen, `sieve.md` §5 fixed
   * "fewer than four and the comparison does not run" before any cell existed, and a
   * pre-registration of a comparison that will not happen is a pre-registration of nothing.
   * The absence is therefore a state to be asserted, not a file to be demanded.
   */
  readonly reading: string | null;
  /** Whether `reading.md` is on disk — asked of the directory, never inferred from the round. */
  readonly readingExists: boolean;
  /** How many tasks it fixes, how many its split IMPLIES may count, and how many do. */
  readonly tasks: number;
  readonly implied: number;
  readonly headline: number;
  /** What its sieve produced, or `null` for a round that has none. */
  readonly outcome: Outcome | null;
};

function roundAt(
  round: number,
  dir: string,
  tasks: number,
  implied: number,
  headline: number,
): Round {
  const split = JSON.parse(readFileSync(join(dir, 'split.json'), 'utf-8')) as Split;
  const outcome =
    split.sieve === undefined
      ? null
      : (JSON.parse(readFileSync(join(dir, 'headline.json'), 'utf-8')) as Outcome);
  // WHETHER THE FILE IS THERE, asked separately from whether this round should have one.
  // MEASURED: reading it only when the round proceeds made `reading === null` mean "the round
  // was refused" instead of "there is no reading", so a stray `reading.md` beside a refused
  // comparison left every case green — a mutation that had to go red came back at zero. The
  // existence is a fact about the directory and it is read as one.
  const readingPath = join(dir, 'reading.md');
  const readingExists = existsSync(readingPath);
  return {
    round,
    dir,
    split,
    digests: readFileSync(join(dir, 'fixtures.sha256'), 'utf-8'),
    readingExists,
    reading: readingExists ? readFileSync(readingPath, 'utf-8') : null,
    tasks,
    implied,
    headline,
    outcome,
  };
}

/**
 * The tasks a round's headline is computed over — from its split, or from what its sieve
 * produced. ONE reading, because the cases below ask this question four times.
 */
function headlineOf(round: Round): readonly string[] {
  const named = round.split.headline ?? round.outcome?.headline;
  if (named === undefined) throw new Error(`round ${round.round} names no headline anywhere`);
  return named;
}

/**
 * The rounds, with their SIZES written here as literals.
 *
 * Not derived from the files they check: a count read out of the same file it is asserted
 * against agrees with every future change, and the whole job of these two numbers is to go red
 * when a task quietly appears in or disappears from a frozen set.
 */
/**
 * How many of round 4's sixteen candidates its sieve kept.
 *
 * A LITERAL, like the two counts beside it and for the same reason: read out of
 * `headline.json` it would agree with every future edit of that file, and the whole job of
 * this number is to go red when the headline set moves after the sieve that produced it.
 */
const ROUND_4_HEADLINE = 1;

const ROUNDS: readonly Round[] = [
  roundAt(1, P1, 8, 4, 4),
  roundAt(2, join(P1, 'round-2'), 10, 6, 6),
  roundAt(3, join(P1, 'round-3'), 10, 6, 6),
  roundAt(4, join(P1, 'round-4'), 20, 16, ROUND_4_HEADLINE),
];

/** A digest line: sixty-four lowercase hex, two spaces, the task's id. */
const DIGEST_LINE = /^([0-9a-f]{64}) {2}([a-z0-9-]+)$/;

/** The lines of a `fixtures.sha256` that are not commentary. */
function digestLines(round: Round): readonly string[] {
  return round.digests.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
}

/** Every task a round fixes, by id. */
function tasks(round: Round): readonly string[] {
  return digestLines(round).map((line) => DIGEST_LINE.exec(line)?.[2] ?? line);
}

/**
 * The axis of a task, which is the first letter of its id — the harness's own rule, and the
 * reason a task whose id starts with neither letter is refused there rather than scored on the
 * wrong axis. Axis B is the negative control: every arm has to tie on it.
 */
const isNegativeControl = (id: string): boolean => id.startsWith('b');

describe.each(ROUNDS)(
  'round $round · what may be iterated on and what is touched once',
  (round) => {
    it('covers every task, exactly once', () => {
      const ids = tasks(round);
      // Non-vacuity first: every rule below is about a set, and an empty set obeys all of them.
      expect(ids.length, 'the pre-registration fixes the wrong number of tasks').toBe(round.tasks);
      expect(new Set(ids).size, 'a task is fixed twice').toBe(ids.length);

      expect([...round.split.development, ...round.split.held_out].sort()).toEqual([...ids].sort());
      expect(
        round.split.development.filter((id) => round.split.held_out.includes(id)),
        'a task is on both sides of the split',
      ).toEqual([]);
    });

    it('holds back the negative control — no axis B task develops anything', () => {
      const controls = tasks(round).filter(isNegativeControl);
      expect(controls.length, 'there is no negative control to hold back').toBeGreaterThan(0);
      // The contamination detector. A harness iterated against these after seeing their result
      // is a harness tuned to soften the one signal that says the run does not count.
      expect(round.split.development.filter(isNegativeControl)).toEqual([]);
      expect(
        controls.filter((id) => !round.split.held_out.includes(id)),
        'a negative control is not held out',
      ).toEqual([]);
    });

    it('pilots on a development task, so the pilot does not spend a held-out one', () => {
      expect(tasks(round), 'the pilot names no task this round fixes').toContain(round.split.pilot);
      expect(round.split.development).toContain(round.split.pilot);
    });

    it('carries its own rule, in the file the harness reads', () => {
      // The caveat rides in the data, not in the prose beside it: whoever reads the split
      // programmatically reads what being held out means.
      expect(round.split.rule).toContain('held-out');
      expect(round.split.frozen_at, 'the freeze carries no date').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('names exactly the headline the split allows, so one file decides who counts', () => {
      /** What the split ALLOWS to count: held out, and not the negative control. */
      const implied = tasks(round).filter(
        (id) => !isNegativeControl(id) && round.split.held_out.includes(id),
      );
      // Non-vacuity first, on both sides: an empty set on either would make the equality below
      // true about nothing, which is the shape a rule about a subset fails in silently.
      expect(implied.length, 'the split allows the wrong number of tasks to count').toBe(
        round.implied,
      );
      const headline = headlineOf(round);
      expect(headline.length, 'the headline names no task').toBeGreaterThan(0);
      expect(headline.length, 'the headline is the wrong size').toBe(round.headline);

      if (round.split.sieve === undefined) {
        // A round with no sieve counts everything it holds back. Rounds 1 to 3 are these.
        expect([...headline].sort()).toEqual([...implied].sort());
        return;
      }

      // A SIEVING ROUND'S HEADLINE IS A SUBSET, and what keeps that honest is that the
      // complement is data. Without `sieved_out` a reader cannot tell a task the sieve
      // dropped from a task somebody quietly left out, and both look like a shorter list.
      const out = round.outcome as Outcome;
      expect([...headline, ...out.sieved_out].sort()).toEqual([...implied].sort());
      expect(
        headline.filter((id) => out.sieved_out.includes(id)),
        'a task is both in the headline and sieved out',
      ).toEqual([]);
    });

    it('folds in no development task — the harness may be fixed against those', () => {
      // The reason the set exists. A task the harness was iterated against measures the harness
      // as much as it measures the arm, and it is one line away from the headline at all times.
      expect(headlineOf(round).filter((id) => round.split.development.includes(id))).toEqual([]);
      // And no negative control: axis B is read for the tie, never for the number.
      expect(headlineOf(round).filter(isNegativeControl)).toEqual([]);
    });

    it('and the table in its reading says of each task what its split says', () => {
      if (round.reading === null) {
        // A ROUND WHOSE COMPARISON WAS REFUSED HAS NO READING, and that is the assertion here
        // rather than a skip: the case below reads a table out of a file, and demanding the file
        // would demand a pre-registration of a comparison a frozen rule already refused. What
        // must hold instead is that the refusal is the reason — checked in its own case below.
        expect(
          round.outcome?.comparison_runs,
          'a round with no reading is running a comparison',
        ).toBe(false);
        return;
      }
      // The reading LISTS the tasks, which makes it a second place naming who counts — the very
      // shape the set exists to avoid. The count below would not catch a swap that keeps the size,
      // so membership is checked row by row and the prose is held to the data.
      const rows = new Map(
        [...round.reading.matchAll(/^\| `([a-z0-9-]+)` \| ([AB]) \| (.+?) \|$/gm)].map(
          (row) =>
            [row[1] as string, { axis: row[2] as string, headline: row[3] as string }] as const,
        ),
      );
      expect(rows.size, 'the reading lists the wrong number of tasks').toBe(round.tasks);

      for (const id of tasks(round)) {
        const row = rows.get(id);
        expect(row, `the reading's table says nothing about ${id}`).toBeDefined();
        expect(row?.axis, `${id} is on the wrong axis in the reading`).toBe(
          isNegativeControl(id) ? 'B' : 'A',
        );
        const counted = row?.headline.startsWith('**yes**');
        expect(counted, `the reading and the split disagree about ${id}`).toBe(
          headlineOf(round).includes(id),
        );
      }
    });

    it('runs its comparison only when the sieve left enough tasks to read one over', () => {
      // THE REFUSAL IS THE FROZEN RULE'S, NOT A CHOICE MADE AFTER THE TABLE APPEARED. Round 4's
      // sieve kept ONE candidate of sixteen, and `sieve.md` §5 fixed "fewer than four and the
      // comparison does not run" before its first cell — the number is there because condition 1
      // of a reading needs four eligible tasks. So the minimum is read from that frozen prose and
      // not from the file written after the sieve, which is the file that could have been chosen
      // to suit the outcome.
      if (round.split.sieve === undefined) {
        expect(round.reading, 'a round with no sieve has no reading').not.toBeNull();
        return;
      }
      const out = round.outcome as Outcome;
      const sieveMd = readFileSync(join(round.dir, 'sieve.md'), 'utf-8');
      expect(
        sieveMd,
        'the sieve does not say what too few survivors means, so the minimum is a number nobody froze',
      ).toContain(`fewer than ${out.minimum}`);

      expect(out.survivors, 'the outcome miscounts its own survivors').toBe(out.headline.length);
      expect(out.comparison_runs, 'the comparison ran against its own minimum').toBe(
        out.survivors >= out.minimum,
      );
      // And the reading exists exactly when the comparison does — asked of the DISK, both
      // directions. One of them is the state this round is actually in, and the other is the
      // mutation that came back at zero when this compared a value the round had already decided.
      expect(
        round.readingExists,
        out.comparison_runs
          ? 'the comparison runs and there is no reading to read it by'
          : 'a reading exists for a comparison a frozen rule refused',
      ).toBe(out.comparison_runs);
    });

    it('derives a sieved headline from the band its split froze, never by hand', () => {
      // THE CASE THAT MAKES A SIEVE A SIEVE. `headline.json` is written after numbers exist,
      // which is the one moment a set can be chosen to suit them. So it is not trusted: the
      // band and the scorable floor are read from `split.json` — frozen before the first cell
      // — and applied here to the counts the sieve recorded. A headline that is not exactly
      // what the frozen rule keeps is red, whatever the file says.
      if (round.split.sieve === undefined) {
        expect(round.outcome, 'a round with no sieve carries a sieve outcome').toBeNull();
        return;
      }
      const sieve = round.split.sieve;
      const out = round.outcome as Outcome;
      const candidates = round.split.candidates as readonly string[];

      // Non-vacuity: the sieve measured every candidate and nothing else.
      expect([...out.candidates.map((c) => c.id)].sort()).toEqual([...candidates].sort());
      expect(candidates.length, 'the split names no candidate').toBeGreaterThan(0);

      const [low, high] = sieve.keep_if_rate_between;
      const kept = out.candidates
        .filter((c) => {
          if (c.scorable < sieve.min_scorable) return false;
          const rate = c.conforms / c.scorable;
          return rate >= low && rate <= high;
        })
        .map((c) => c.id);

      expect([...out.headline].sort(), 'the headline is not what the frozen band keeps').toEqual(
        [...kept].sort(),
      );
      expect([...out.sieved_out].sort()).toEqual(
        [...candidates].filter((id) => !kept.includes(id)).sort(),
      );
      // And no cell of the sieve may count: the bias of reusing them was measured at -3.86
      // points, against -0.16 for sieving and discarding.
      expect(sieve.cells_are_discarded, 'the sieve keeps its own cells').toBe(true);
      // NOT VACUOUS: a candidate outside the band must NOT be kept, and one whose cells did
      // not score must not either. Both are checked against the same function, on values the
      // sieve cannot have produced.
      const outside = [
        { id: 'x', scorable: sieve.runs, conforms: sieve.runs },
        { id: 'y', scorable: sieve.runs, conforms: 0 },
        { id: 'z', scorable: sieve.min_scorable - 1, conforms: 1 },
      ];
      for (const c of outside) {
        const rate = c.conforms / c.scorable;
        const wouldKeep = c.scorable >= sieve.min_scorable && rate >= low && rate <= high;
        expect(wouldKeep, `${c.id} would pass a band that keeps everything`).toBe(false);
      }
    });

    it('fixes each task by a digest, with the command that reproduces it', () => {
      const lines = digestLines(round);
      expect(lines.length).toBe(round.tasks);
      for (const line of lines) expect(line, 'not a digest and an id').toMatch(DIGEST_LINE);

      // A hash nobody knows how to reproduce proves nothing, so the file carries its own
      // command — and the parts asserted here are the ones that make the archive DETERMINISTIC,
      // which is the whole of why two runs of it can be compared at all.
      const commentary = round.digests
        .split('\n')
        .filter((line) => line.startsWith('#'))
        .join('\n');
      for (const part of [
        'tar',
        '--sort=name',
        "--mtime='UTC 1970-01-01'",
        '--numeric-owner',
        "--exclude='__pycache__'",
        'sha256sum',
      ]) {
        expect(commentary, `the reproducing command does not carry ${part}`).toContain(part);
      }
      // And the command has to name every task it claims to hash: a loop over eight ids under a
      // file of ten digests is a command that reproduces most of the freeze.
      for (const id of tasks(round)) {
        expect(commentary, `the reproducing command does not name ${id}`).toContain(id);
      }
    });
  },
);

describe('the shape a digest line is accepted in', () => {
  it('is not everything', () => {
    // The net's teeth: with the files honest, the cases above only ever say "nothing is
    // accused", so they have never shown they can go red.
    const hex = 'a'.repeat(64);
    expect(DIGEST_LINE.test(`${hex}  a1-rounding`)).toBe(true);
    expect(DIGEST_LINE.test(`${'a'.repeat(63)}  a1-rounding`)).toBe(false);
    expect(DIGEST_LINE.test(`${'A'.repeat(64)}  a1-rounding`)).toBe(false);
    expect(DIGEST_LINE.test(`${hex} a1-rounding`)).toBe(false);
    expect(DIGEST_LINE.test(`${hex}  a1-rounding extra`)).toBe(false);
    expect(DIGEST_LINE.test('a1-rounding')).toBe(false);
  });
});

/**
 * How many runs a (task, arm) gets, for the FIRST round — read from the protocol instead of
 * repeated here, so a protocol that changes its size moves the arithmetic below with it rather
 * than leaving this file asserting the old product.
 */
function runsPerCell(): number {
  const declared = /\bn=(\d+) per \(task, arm\)/.exec(protocol)?.[1];
  expect(declared, 'the protocol does not say how many runs a (task, arm) gets').toBeDefined();
  return Number(declared);
}

describe('each round says its own size, and says it the way that round decided it', () => {
  it('round 1 counts the cells its headline implies, not a number it remembers', () => {
    // The reading states the size of the headline in prose. Said twice — here as data, there
    // as a sentence — it is a number that ages in silence the day the split moves, so the
    // sentence is checked against the arithmetic rather than trusted.
    const first = ROUNDS[0] as Round;
    const cells = first.split.headline.length * runsPerCell();
    const counted = [...first.reading.matchAll(/(\d+) cells/g)].map((match) => Number(match[1]));
    expect(counted.length, 'the reading states no cell count at all').toBeGreaterThan(0);
    for (const n of counted) {
      expect(n, 'the reading counts cells the split does not imply').toBe(cells);
    }
  });

  it('round 2 carries n as data, names the decision on it as open, and costs every candidate', () => {
    // ROUND 2 STATES ITS SIZE DIFFERENTLY, and that is the thing this case exists to pin.
    // Round 1 fixed n in the protocol before it ran. Round 2 inherits the value and leaves the
    // decision open — round 1 spent five points of a weekly meter where three were authorised —
    // so what is frozen is not a size but an arithmetic: every candidate size, costed, so that
    // whoever closes the decision closes it against numbers written before any result exists.
    const second = ROUNDS[1] as Round;
    expect(second.split.n, 'round 2 does not carry n as data').toBe(runsPerCell());
    expect(second.split.n_decision, 'the decision on n is not named as open').toMatch(/OPEN/);

    const arms = second.split.arms as readonly string[];
    const tasksOf = tasks(second).length;
    // Every candidate size the reading is allowed to cost, and each one has to BE there: a
    // table missing a row is a decision made by omission.
    for (const n of [2, 3, 4]) {
      expect(second.reading, `the reading does not cost n=${n}`).toContain(
        `| ${tasksOf * arms.length * n} |`,
      );
    }
    // NOT VACUOUS: a size the split does not imply must NOT be costed, or the case above would
    // pass over a table of every number anybody ever typed.
    expect(second.reading, 'the reading costs a size the split does not imply').not.toContain(
      `| ${tasksOf * arms.length * 5} |`,
    );
  });
});

describe('the rounds together', () => {
  it('share no task, so no round re-runs one whose result is known', () => {
    const seen = new Map<string, number>();
    for (const round of ROUNDS) {
      for (const id of tasks(round)) {
        const before = seen.get(id);
        expect(
          before,
          `${id} is fixed by round ${String(before)} and by round ${round.round}`,
        ).toBeUndefined();
        seen.set(id, round.round);
      }
    }
    // Non-vacuity: the map has to have been filled, or the loop above proved nothing.
    expect(seen.size).toBe(ROUNDS.reduce((total, round) => total + round.tasks, 0));
  });

  it('and each round is frozen no earlier than the one before it', () => {
    const dates = ROUNDS.map((round) => round.split.frozen_at);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('the arms of round 2', () => {
  /** The arms round 1 ran, read from the protocol's own table and not listed again here. */
  function armsOfRoundOne(): readonly string[] {
    const table = /## The four arms\n([\s\S]*?)\n\n/.exec(protocol)?.[1];
    expect(table, 'the protocol no longer describes the arms of round 1').toBeDefined();
    return [...(table ?? '').matchAll(/^\| `([a-z]+)` \|/gm)].map((row) => row[1] as string);
  }

  it('keep every arm that ran round 1, and add exactly one', () => {
    const declared = (ROUNDS[1] as Round).split.arms;
    expect(declared, 'round 2 declares no arms').toBeDefined();
    const arms = declared as readonly string[];
    expect(new Set(arms).size, 'an arm is declared twice').toBe(arms.length);

    const before = armsOfRoundOne();
    // Non-vacuity: the protocol's table has to have been read, or "keeps them all" is a claim
    // about an empty set.
    expect(before.length, 'the protocol names no arm of round 1').toBe(4);
    expect(
      before.filter((arm) => !arms.includes(arm)),
      'round 2 drops an arm that round 1 ran — the control that says WHICH half worked',
    ).toEqual([]);
    expect(
      arms.filter((arm) => !before.includes(arm)).length,
      'round 2 adds more than one arm',
    ).toBe(1);
  });

  it('and the file that declares them names every one, by name', () => {
    // The prose is held to the data: `arms.md` is where a reader learns what an arm holds, and
    // an arm in the split that the file never mentions is an arm nobody described.
    const declared = readFileSync(join(P1, 'round-2', 'arms.md'), 'utf-8');
    const arms = (ROUNDS[1] as Round).split.arms as readonly string[];
    for (const arm of arms) {
      expect(declared, `arms.md says nothing about ${arm}`).toContain(`| \`${arm}\` |`);
    }
    // NOT VACUOUS: a name that is not an arm is not described there either.
    expect(declared).not.toContain('| `no-such-arm` |');
  });
});

/**
 * Every arm a round OWES a written reason for — ONE list, computed in one place.
 *
 * Two ways an arm can be missing from a round, and both of them leave the reader with the
 * same question. One ran the round before and does not run this one. The other was
 * DECLARED by this round and withdrawn before it ran — round 3 was frozen twice, and an
 * arm that vanishes between two freezes of the same file is invisible in the committed
 * state unless the file says it was there.
 *
 * The union is computed here and read once, because the alternative is two lists asserted
 * separately and a `prosa` that is on both — which is exactly this round's case, and the
 * shape in which a doubly-named arm gets checked twice and a singly-named one not at all.
 */
function armsOwedAReason(round: Round, previous: readonly string[]): readonly string[] {
  const arms = round.split.arms ?? [];
  const gone = previous.filter((arm) => !arms.includes(arm));
  return [...new Set([...gone, ...(round.split.arms_withdrawn ?? [])])].sort();
}

describe('the arms of round 3', () => {
  const third = ROUNDS[2] as Round;
  const armsMd = readFileSync(join(P1, 'round-3', 'arms.md'), 'utf-8');

  it('runs FOUR arms — two of round 2 leave and one arrives', () => {
    const declared = third.split.arms;
    expect(declared, 'round 3 declares no arms').toBeDefined();
    const arms = declared as readonly string[];
    expect(new Set(arms).size, 'an arm is declared twice').toBe(arms.length);

    const before = (ROUNDS[1] as Round).split.arms as readonly string[];
    // Non-vacuity: round 2's arms have to have been read, or every difference below is a
    // difference from an empty set.
    expect(before.length, 'round 2 declares no arm to compare against').toBe(5);
    // THE COUNT IS A LITERAL, for the reason the task counts are: derived from the file it
    // checks, it would agree with any future change, and the job of this number is to go red
    // when an arm quietly appears in or leaves a frozen round.
    expect(arms.length, 'round 3 does not run four arms').toBe(4);

    // ROUND 3 IS THE FIRST ROUND THAT DROPS AN ARM, and it now drops TWO. Round 2's rule was
    // "keeps every arm and adds one"; this round's first freeze was "exactly one leaves,
    // exactly one arrives", and the re-freeze falsified that too — `prosa` left beside
    // `mnema` when the round's question became internal to the surface. So the shape is
    // asserted as it is rather than as the previous freeze had it: a rule loosened until it
    // says nothing is worse than a rule that changed and said so.
    expect(
      before.filter((arm) => !arms.includes(arm)),
      'round 3 drops other than two of round 2 arms',
    ).toHaveLength(2);
    expect(
      arms.filter((arm) => !before.includes(arm)),
      'round 3 adds more or fewer than one arm',
    ).toHaveLength(1);
  });

  it('carries the arms it withdrew as DATA, and never as an arm it also runs', () => {
    // The re-freeze is the one change a pre-registration allows, and the only thing that
    // keeps it from being a silent rewrite is that the file says what left. In a diff it is
    // invisible; in the committed state it has to be readable without one.
    const withdrawn = third.split.arms_withdrawn;
    expect(withdrawn, 'round 3 does not say which arms it withdrew').toBeDefined();
    const gone = withdrawn as readonly string[];
    expect(gone.length, 'the withdrawal names no arm').toBeGreaterThan(0);
    expect(new Set(gone).size, 'an arm is withdrawn twice').toBe(gone.length);

    const arms = third.split.arms as readonly string[];
    // An arm cannot be both declared and withdrawn: that is a round claiming to measure
    // what it says it dropped.
    expect(
      gone.filter((arm) => arms.includes(arm)),
      'an arm is both declared and withdrawn',
    ).toEqual([]);
    expect(third.split.arms_withdrawn_note, 'the withdrawal carries no reason').toMatch(/before/);
  });

  it('and the file that declares them names every one, and says why each absent one left', () => {
    const arms = third.split.arms as readonly string[];
    for (const arm of arms) {
      expect(armsMd, `arms.md says nothing about ${arm}`).toContain(`| \`${arm}\` |`);
    }
    // NOT VACUOUS: a name that is not an arm is not described there either.
    expect(armsMd).not.toContain('| `no-such-arm` |');

    // An arm that leaves in silence is an arm nobody can check was ever there. The reason has
    // to be in the file that declares the arms, naming the arm — and it is owed for BOTH
    // ways of being absent, which is why the list is one function and not two loops.
    const owed = armsOwedAReason(third, (ROUNDS[1] as Round).split.arms as readonly string[]);
    expect(owed.length, 'no arm is absent, so this case is about nothing').toBe(3);
    for (const arm of owed) {
      expect(armsMd, `arms.md does not say why \`${arm}\` is not in this round`).toContain(
        `Why \`${arm}\` is not in this round`,
      );
    }
    // NOT VACUOUS in the other direction: the file does not carry that section for an arm it
    // runs, which would be a round describing its own treatment as absent.
    for (const arm of arms) {
      expect(armsMd, `arms.md says why \`${arm}\` left, and it did not`).not.toContain(
        `Why \`${arm}\` is not in this round`,
      );
    }
  });

  it('carries n as data, names the decision on it as open, and costs every candidate', () => {
    // The same shape round 2 froze, for the same reason: what is frozen is not a size but an
    // arithmetic, so whoever closes the decision closes it against numbers written before any
    // result exists.
    expect(third.split.n, 'round 3 does not carry n as data').toBe(runsPerCell());
    expect(third.split.n_decision, 'the decision on n is not named as open').toMatch(/OPEN/);

    const arms = third.split.arms as readonly string[];
    const tasksOf = tasks(third).length;
    for (const n of [2, 3, 4]) {
      expect(third.reading, `the reading does not cost n=${n}`).toContain(
        `| ${tasksOf * arms.length * n} |`,
      );
    }
    // NOT VACUOUS: a size the split does not imply must NOT be costed, or the case above would
    // pass over a table of every number anybody ever typed. With four arms this is also the
    // cell count the FIVE-arm freeze costed at n=4, so the case doubles as the one that goes
    // red if the old table survives the re-freeze.
    expect(third.reading, 'the reading costs a size the split does not imply').not.toContain(
      `| ${tasksOf * arms.length * 5} |`,
    );
  });

  it('says how its development pair was chosen, blind to what the tasks contain', () => {
    // Rounds 1 and 2 do not carry this field and are not edited to acquire it. Round 3 does,
    // because round 2's report described a criterion that does not reproduce round 1's pick —
    // so the criterion is stated by the round that used it, where it can be checked.
    const criterion = third.split.development_criterion;
    expect(criterion, 'round 3 does not say how its development pair was chosen').toBeDefined();
    expect(third.split.development, 'the development pair is not a pair').toHaveLength(2);
    // The criterion names the pilot as the lowest-numbered axis A task, so the pilot has to BE
    // the first development task in numeric order — the one property of it a test can hold.
    const numberOf = (id: string): number => Number(/^[ab](\d+)/.exec(id)?.[1] ?? NaN);
    const ordered = [...third.split.development].sort((a, b) => numberOf(a) - numberOf(b));
    expect(ordered[0], 'the pilot is not the lowest-numbered development task').toBe(
      third.split.pilot,
    );
  });
});

describe('the prediction of round 3', () => {
  const third = ROUNDS[2] as Round;
  const prediction = readFileSync(join(P1, 'round-3', 'prediction.md'), 'utf-8');

  /** A row of the prediction's table: the task, its axis, whether it counts, and the call. */
  const ROW =
    /^\| `([a-z0-9-]+)` \| ([AB]) \| (\*\*yes\*\*|no) \| \*\*(first write|later)\*\* \| (.+?) \|$/gm;

  it('calls every task of the round, exactly once, with a reason', () => {
    // WHY THIS IS A TEST. Round 3 exists to attribute a number to one of two channels, and the
    // only thing that keeps that from being decided after the fact is a call made before the
    // round, per task, in a file nothing may edit afterwards. A task with no call is a task the
    // round can attribute anything to.
    //
    // THE CALL IS THE SAME CALL IT WAS AT THE FIRST FREEZE, and what changed is what it
    // IMPLIES. It used to be read as "here the injected rule should gain"; it is now read as
    // "here the per-edit push CANNOT have acted, so the two arms are expected to tie". The
    // classification is about the shape of a task, and withdrawing an arm does not reshape a
    // task, so the table is not rewritten to follow the arms.
    const rows = new Map(
      [...prediction.matchAll(ROW)].map(
        (row) =>
          [
            row[1] as string,
            {
              axis: row[2] as string,
              headline: row[3] as string,
              call: row[4] as string,
              why: row[5] as string,
            },
          ] as const,
      ),
    );
    expect(rows.size, 'the prediction calls the wrong number of tasks').toBe(third.tasks);

    for (const id of tasks(third)) {
      const row = rows.get(id);
      expect(row, `the prediction says nothing about ${id}`).toBeDefined();
      expect(row?.axis, `${id} is on the wrong axis in the prediction`).toBe(
        isNegativeControl(id) ? 'B' : 'A',
      );
      expect(row?.headline === '**yes**', `the prediction and the split disagree about ${id}`).toBe(
        third.split.headline.includes(id),
      );
      // A call with no reason is a coin toss written down. Ten of those would pass every other
      // assertion in this file.
      expect((row?.why ?? '').length, `${id} is called with no reason`).toBeGreaterThan(20);
    }
  });

  it('names the COLUMN that decides whether the push could have acted at all', () => {
    // The prediction is now about POSSIBILITY: a push that arrives after the first write cannot
    // act on a task the first write settled. That is checkable per cell, and the column is the
    // one the round already has — so the prediction has to name it, and name the value that
    // makes the difference, or it is a claim with no procedure.
    expect(prediction, 'the prediction names no column that would check it').toContain(
      'mcp_pushed',
    );
    // BOTH SIDES, because a rule stated on one value only is a rule that cannot be wrong: the
    // value where the push could not act, and the value where it could.
    expect(prediction, 'the prediction does not say what one dispatch means').toMatch(
      /`mcp_pushed = 1`/,
    );
    expect(
      prediction,
      'the prediction does not say where a difference would have to appear',
    ).toMatch(/`mcp_pushed ≥ 2`/);
    // And the claim's own limit: a second dispatch is necessary for the push to have acted and
    // does not prove that it did. A prediction that reads it as proof would confirm itself.
    expect(prediction, 'the prediction reads a second dispatch as sufficient').toMatch(
      /[Nn]ecessary and not sufficient/,
    );
  });

  it('and the reading refuses to read it without the column that would check it', () => {
    // "Read it loosely" is the answer that would let the round confirm itself, so the reading
    // has to say what happens when the column cannot answer, in the word that closes it.
    //
    // WHAT THIS ASSERTED UNTIL THE RE-FREEZE, and what falsified it: the phrase was `the line
    // carries no write count`, and the reason the reading gave for needing it was that
    // `mcp_pushed` is 1 in 47 of 48 cells "because the per-edit channel speaks once per cell".
    // That described `channel_served`, not `mcp_pushed` — the committed cell
    // `a7-partial-refund` / `mnema+` / run 4 carries `mcp_pushed` 2 beside `channel_served`
    // `edit-rules-push:1`, and a column that reaches 2 does not speak once per cell. So the
    // round is read over the column it has, and what the reading owes is the refusal for the
    // cells where that column is silent.
    expect(third.reading, 'the reading does not require the column').toContain('`mcp_pushed`');
    expect(third.reading, 'the reading names no consequence for the silent column').toMatch(
      /the prediction is not read on that task at all/,
    );
  });

  it('and the round adds the condition that its own capture earned', () => {
    // Round 2 published three `>` readings for the one arm its contamination detector could not
    // see. The fifth condition is that hole closed, and it is asserted here because it is the
    // one clause of the reading that can VETO a result this product wins — which is exactly the
    // kind of clause that gets quietly dropped.
    expect(third.reading, 'the reading has no fifth condition on `>`').toMatch(
      /has a rate on at least one negative control/,
    );
    expect(third.reading, 'the reading does not declare what the new condition costs').toMatch(
      /withdraws three of that round's eight `>` readings/,
    );
  });
});
