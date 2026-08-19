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
 * two rounds: the first ran in August 2026 and spent its tasks, and the second is pre-registered
 * in `round-2/` with tasks of its own, frozen before the product surface it will measure exists.
 * A guard written for one round and copied for the other is two readings of one rule, which is
 * the shape that drifts in silence — so `describe.each` over the rounds is the point, not a
 * convenience. What differs between rounds is declared per round below, never duplicated.
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The pre-registration — this file is `packages/code/tests/…`. */
const P1 = fileURLToPath(new URL('../../../measurements/p1/', import.meta.url));

type Split = {
  readonly frozen_at: string;
  readonly pilot: string;
  readonly development: readonly string[];
  readonly held_out: readonly string[];
  readonly headline: readonly string[];
  readonly rule: string;
  /** Round 2 declares its arms; round 1's file predates the field and is not edited. */
  readonly arms?: readonly string[];
  /** Round 2 carries the size as data, with the decision on it named as open. */
  readonly n?: number;
  readonly n_decision?: string;
};

/** The protocol, shared by every round: the promise and the size of the first one. */
const protocol = readFileSync(join(P1, 'protocol.md'), 'utf-8');

/** One round of the protocol: where its pre-registration lives, and what it holds. */
type Round = {
  readonly round: number;
  readonly dir: string;
  readonly split: Split;
  readonly digests: string;
  readonly reading: string;
  /** How many tasks it fixes, and how many of those the headline is about. */
  readonly tasks: number;
  readonly headline: number;
};

function roundAt(round: number, dir: string, tasks: number, headline: number): Round {
  return {
    round,
    dir,
    split: JSON.parse(readFileSync(join(dir, 'split.json'), 'utf-8')) as Split,
    digests: readFileSync(join(dir, 'fixtures.sha256'), 'utf-8'),
    reading: readFileSync(join(dir, 'reading.md'), 'utf-8'),
    tasks,
    headline,
  };
}

/**
 * The rounds, with their SIZES written here as literals.
 *
 * Not derived from the files they check: a count read out of the same file it is asserted
 * against agrees with every future change, and the whole job of these two numbers is to go red
 * when a task quietly appears in or disappears from a frozen set.
 */
const ROUNDS: readonly Round[] = [roundAt(1, P1, 8, 4), roundAt(2, join(P1, 'round-2'), 10, 6)];

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

    it('names exactly the headline the split implies, so one file decides who counts', () => {
      /** What the split IMPLIES: held out, and not the negative control. */
      const implied = tasks(round).filter(
        (id) => !isNegativeControl(id) && round.split.held_out.includes(id),
      );
      // Non-vacuity first, on both sides: an empty set on either would make the equality below
      // true about nothing, which is the shape a rule about a subset fails in silently.
      expect(implied.length, 'the split implies the wrong number of headline tasks').toBe(
        round.headline,
      );
      expect(round.split.headline.length, 'the headline names no task').toBeGreaterThan(0);
      expect([...round.split.headline].sort()).toEqual([...implied].sort());
    });

    it('folds in no development task — the harness may be fixed against those', () => {
      // The reason the set exists. A task the harness was iterated against measures the harness
      // as much as it measures the arm, and it is one line away from the headline at all times.
      expect(round.split.headline.filter((id) => round.split.development.includes(id))).toEqual([]);
      // And no negative control: axis B is read for the tie, never for the number.
      expect(round.split.headline.filter(isNegativeControl)).toEqual([]);
    });

    it('and the table in its reading says of each task what its split says', () => {
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
          round.split.headline.includes(id),
        );
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
