/**
 * THE SPLIT IS FROZEN BEFORE THE NUMBER.
 *
 * A measurement of this product's first promise is pre-registered under `measurements/p1/`:
 * the promise, the four arms, the scorer, the reading of every possible outcome, and — the
 * part this file guards — WHICH tasks the harness may be iterated against and which are
 * touched exactly once.
 *
 * WHY A TEST AND NOT A PARAGRAPH. The split is the only part of a pre-registration that can be
 * violated by accident. A pilot that runs whatever task sorts first touches a held-out task
 * without anybody deciding to; a harness fixed against the negative control softens the very
 * signal that would invalidate the run. Both are one line of code away at all times, and
 * neither leaves a trace in the result. So the rules are asserted here, over the committed
 * files, where a violation is red before it is a number.
 *
 * WHAT THIS CANNOT COVER, said out loud rather than left to be discovered. The tasks live in a
 * workbench that git ignores, so nothing here can read them: `fixtures.sha256` is the
 * committed PROXY for which tasks exist, and this file checks the pre-registration against
 * itself. That the file matches the tasks on disk is checked by the harness's own preflight,
 * which refuses to run when a hash moves or a task is missing from the split — and that is a
 * check no committed test can make, because the thing it compares against is not committed.
 */

import { readdirSync, readFileSync } from 'node:fs';
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
  readonly rule: string;
};

const split = JSON.parse(readFileSync(join(P1, 'split.json'), 'utf-8')) as Split;
const digests = readFileSync(join(P1, 'fixtures.sha256'), 'utf-8');

/** A digest line: sixty-four lowercase hex, two spaces, the task's id. */
const DIGEST_LINE = /^([0-9a-f]{64}) {2}([a-z0-9-]+)$/;

/** The lines of `fixtures.sha256` that are not commentary. */
function digestLines(): readonly string[] {
  return digests.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
}

/** Every task the pre-registration fixes, by id. */
function tasks(): readonly string[] {
  return digestLines().map((line) => DIGEST_LINE.exec(line)?.[2] ?? line);
}

/**
 * The axis of a task, which is the first letter of its id — the harness's own rule, and the
 * reason a task whose id starts with neither letter is refused there rather than scored on the
 * wrong axis. Axis B is the negative control: the four arms have to tie on it.
 */
const isNegativeControl = (id: string): boolean => id.startsWith('b');

describe('the split between what may be iterated on and what is touched once', () => {
  it('covers every task, exactly once', () => {
    const ids = tasks();
    // Non-vacuity first: every rule below is about a set, and an empty set obeys all of them.
    expect(ids.length, 'the pre-registration fixes no task at all').toBe(8);
    expect(new Set(ids).size, 'a task is fixed twice').toBe(ids.length);

    expect([...split.development, ...split.held_out].sort()).toEqual([...ids].sort());
    expect(
      split.development.filter((id) => split.held_out.includes(id)),
      'a task is on both sides of the split',
    ).toEqual([]);
  });

  it('holds back the negative control — neither axis B task develops anything', () => {
    const controls = tasks().filter(isNegativeControl);
    expect(controls.length, 'there is no negative control to hold back').toBeGreaterThan(0);
    // The contamination detector. A harness iterated against these after seeing their result
    // is a harness tuned to soften the one signal that says the run does not count.
    expect(split.development.filter(isNegativeControl)).toEqual([]);
  });

  it('pilots on a development task, so the pilot does not spend a held-out one', () => {
    expect(tasks(), 'the pilot names no task this protocol fixes').toContain(split.pilot);
    expect(split.development).toContain(split.pilot);
  });

  it('carries its own rule, in the file the harness reads', () => {
    // The caveat rides in the data, not in the prose beside it: whoever reads the split
    // programmatically reads what being held out means.
    expect(split.rule).toContain('held-out');
    expect(split.frozen_at, 'the freeze carries no date').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the tasks are fixed by a digest', () => {
  it('one per task, with the command that reproduces it', () => {
    const lines = digestLines();
    expect(lines.length).toBe(8);
    for (const line of lines) expect(line, 'not a digest and an id').toMatch(DIGEST_LINE);

    // A hash nobody knows how to reproduce proves nothing, so the file carries its own
    // command — and the parts asserted here are the ones that make the archive DETERMINISTIC,
    // which is the whole of why two runs of it can be compared at all.
    const commentary = digests
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
  });

  it('and the shape it accepts is not everything', () => {
    // The net's teeth: with the file honest, the case above only ever says "nothing is
    // accused", so it has never shown it can go red.
    const hex = 'a'.repeat(64);
    expect(DIGEST_LINE.test(`${hex}  a1-rounding`)).toBe(true);
    expect(DIGEST_LINE.test(`${'a'.repeat(63)}  a1-rounding`)).toBe(false);
    expect(DIGEST_LINE.test(`${'A'.repeat(64)}  a1-rounding`)).toBe(false);
    expect(DIGEST_LINE.test(`${hex} a1-rounding`)).toBe(false);
    expect(DIGEST_LINE.test(`${hex}  a1-rounding extra`)).toBe(false);
    expect(DIGEST_LINE.test('a1-rounding')).toBe(false);
  });
});

describe('the freeze comes before the first number', () => {
  /**
   * THIS CASE HAS AN END, and it is not a defect: the delivery that lands the first result
   * deletes it. Until then it is the whole point of the pre-registration — a reading fixed
   * after the number is not a reading, it is a rationalisation, and the only evidence that the
   * order was kept is that this directory was committed empty and stayed that way.
   */
  it('and the results directory holds nothing but its own README', () => {
    expect(readdirSync(join(P1, 'results'))).toEqual(['README.md']);
  });
});
