/**
 * THE CEILING BELONGS TO THE CASE. A case that waits — one that starts processes, or drives
 * a terminal, or walks every source the product has — says so at its own `it`, and nothing
 * lifts the ceiling the other two thousand are judged against.
 *
 * WHERE THIS COMES FROM. Cases of this suite went red under load and green on their own,
 * with a message that named no cost and no cause: the run simply stopped at five seconds.
 * The cheap repair is one line in the workspace's configuration, and it is the wrong one —
 * it buys silence for every case at once, so the next case that grows from two seconds to
 * nine arrives green and nobody learns it grew. A ceiling written at the `it` says WHICH
 * case waits, and the line beside it says on what.
 *
 * SO THE RULE IS A BAN, and it is a ban at every place that could lift the floor for
 * everybody rather than at the one that was tempting:
 *
 *   - THE WORKSPACE'S OWN CONFIGURATION, which is the obvious one.
 *   - THE COMMAND LINE THE SUITE IS STARTED FROM — a script in a manifest, or a workflow in
 *     CI, which never passes through the configuration at all.
 *   - A CALL INSIDE A FILE, which raises it for every case in that file and is invisible to
 *     anybody reading the configuration.
 *
 * All three spell the same thing, so the scan below is one needle over everything the
 * workspace ships.
 *
 * WHAT THIS SCAN DOES NOT COVER, and where that went. The sentence here said the second
 * question — whether a case that waits actually HAS a ceiling of its own — "needs a DURATION,
 * and a scan over source has none", and then that it was "not something a guard can do without
 * becoming the thing it measures". THE FIRST HALF STANDS AND THE SECOND WAS FALSIFIED, by
 * building the thing it said could not be built: `.github/why-it-went-red/` reads the durations
 * off a run that already happened rather than measuring inside one. A reporter writes each
 * case's duration and the ceiling it actually ran under — vitest resolves `options.timeout` per
 * case, so the shared ceiling and a declared one arrive already told apart — and a reader
 * afterwards re-times, ALONE, every case that spent more of the shared ceiling than its budget.
 * The guard never becomes the thing it measures because it does not run inside the run.
 *
 * SO THIS SCAN IS STILL THE WHOLE OF THE BAN and none of the second question. It stays a scan:
 * the three shapes that lift the ceiling for everybody are text, and text is what it reads.
 *
 * AND THE DURATIONS WERE READ, on 21 Aug 2026, because CI reaching this trunk made them
 * available for the first time. Of 3484 cases, 3286 wait under the shared five seconds — read
 * off the run rather than counted in the source, since a positional argument also closes a
 * `beforeAll` and the source count says 215 where the cases say 198. The slowest of the 3286,
 * over two runner runs and four local configurations:
 *
 *   GitHub runner, node 24 ................. 955 ms, 1259 ms
 *   GitHub runner, node 22 ................. 1173 ms, 1595 ms
 *   container, 4 cores, node 22 ............ 1339 ms
 *   this workstation, 16 cores, node 24 .... 1635 ms
 *   the same, under v8 coverage ............ 2412 ms
 *
 * Nothing came within three seconds of the ceiling, in any of them, so no case needed one of its
 * own on that day and this ban costs nothing to keep.
 *
 * ONE CASE NEEDS ONE NOW, AND IT IS THE HALF THE READING ABOVE COULD NOT SEE. The table is of
 * cases that INHERIT, and it says what the slowest inheriting case cost; it cannot say whether
 * some case is quietly spending most of everybody's ceiling. `chain/src/chain/tail-lock.test.ts`
 * was: *refuses a tail a live process is holding* waits out two full lock timeouts on purpose,
 * 4018 ms with the machine to itself against the shared 5000, and `why-it-went-red` reported it
 * on every run. It carries a ceiling of its own now, with the wait named beside it. The ban is
 * unchanged and this is what the ban is FOR — the repair was one line at one `it`, and the
 * cheap line would have hidden it behind a number nobody would have looked at again. TWO THINGS IN THAT TABLE ARE WORTH THE READING.
 * The runner is not the slow machine — 1595 ms at its worst against this workstation's 1635 ms,
 * near parity — even though the suite's wall clock there is around 3x slower (101-134 s against
 * 36 s). Fewer workers on fewer cores contend less, and the slowest cases are pty and screen
 * work that waits on the clock, so the two ratios pull opposite ways: a ceiling sized from the
 * wall-clock ratio would have been three times too loose. And coverage instrumentation charges
 * 1.48x to the worst case while charging 11.6% to the wall clock (40.2 s against 36.0 s, four
 * passes alternating), because it charges most to the heaviest cases and parallelism absorbs
 * the rest.
 *
 * A SINGLE SAMPLE WOULD HAVE MISLED. The first runner run put node 22 at 1173 ms and node 24 at
 * 1259 ms; the second reversed them, at 1595 ms and 955 ms. The spread between two runs of the
 * same commit on the same image is wider than the gap between machines, which is the reason
 * these are written as a set and not as a figure.
 *
 * SO THE REPAIR THIS BAN REFUSES WAS PRICED, and it is still the wrong one: the cheap line
 * would have been written at the number this measurement produced, and the measurement says no
 * case is anywhere near needing it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** This file, which the scan reaches and must not accuse. */
const HERE = fileURLToPath(import.meta.url);

/**
 * What lifts the ceiling for everybody, spelled in PARTS. A needle written whole would sit
 * in this file's own source, the scan would find itself, and the guard would be red the day
 * it was written and switched off the day after.
 *
 * One pattern covers the three shapes: the key in a configuration and the argument of a call
 * are written one way, the flag on a command line the other.
 */
const LIFTS_THE_CEILING = new RegExp(`${'test'}[-_]?${'timeout'}`, 'i');

/** The extensions text is carried in here — sources, manifests, and CI's own files. */
const TEXT = /\.(ts|mts|cts|js|mjs|cjs|json|ya?ml)$/;

/** Every text file under `where`; `deep` walks it, and what is built or installed is not it. */
function filesUnder(where: string, deep: boolean): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(where, { withFileTypes: true })) {
    const path = join(where, entry.name);
    if (entry.isDirectory()) {
      if (!deep) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      found.push(...filesUnder(path, true));
    } else if (TEXT.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * Everything the workspace SHIPS that could configure a run: its own files at the root, the
 * packages and CI. The tree is scanned rather than excused, so a manifest or a script that
 * lands in a directory tomorrow is covered without anybody having to remember this file.
 */
const SCANNED: readonly string[] = [
  ...filesUnder(ROOT, false),
  ...filesUnder(join(ROOT, 'packages'), true),
  ...filesUnder(join(ROOT, '.github'), true),
];

describe('the ceiling a case waits under is that case’s own', () => {
  it('is lifted nowhere the workspace configures a run', () => {
    const lifting = SCANNED.filter((file) => LIFTS_THE_CEILING.test(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(ROOT.length))
      .sort();
    expect(lifting, 'something raises the ceiling for every case at once').toEqual([]);
    // THE SCAN REACHES ALL THREE PLACES, or the line above is true of nothing: the
    // workspace's configuration, the manifests a run is started from, and the files
    // themselves, where one call would cover a whole file at a time.
    const reached = SCANNED.map((file) => file.slice(ROOT.length));
    expect(reached, 'the configuration itself was not read').toContain('vitest.config.ts');
    expect(reached, 'no manifest was read').toContain('package.json');
    expect(
      reached.filter((file) => file.endsWith('.test.ts')).length,
      'the files that hold the cases were not read',
    ).toBeGreaterThan(100);
    expect(
      reached.filter((file) => file.startsWith('.github/')).length,
      'CI, which starts the suite without the configuration, was not read',
    ).toBeGreaterThan(0);
    // AND IT CANNOT FIND ITSELF. The needle is spelled in parts for exactly this: a file is
    // accused for lifting the ceiling, never for naming what it bans.
    expect(readFileSync(HERE, 'utf-8'), 'the scan finds itself').not.toMatch(LIFTS_THE_CEILING);
  });

  it('and would find one, in each of the three shapes that lift it', () => {
    // Non-vacuity on text this case owns, one line per shape the ban is about — and each
    // written in parts, because a sample spelled whole would put this file in the list.
    const key = ['test', 'Timeout'].join('');
    const flag = ['test', 'timeout'].join('-');
    expect(
      LIFTS_THE_CEILING.test(`export default defineConfig({ test: { ${key}: 60_000 } });`),
    ).toBe(true);
    expect(LIFTS_THE_CEILING.test(`"test": "vitest run --${flag}=60000"`)).toBe(true);
    expect(LIFTS_THE_CEILING.test(`vi.setConfig({ ${key}: 60_000 });`)).toBe(true);
    // And it is not true of anything: a ceiling written at a case is the shape this rule
    // EXISTS to leave alone, and prose about a case that waited is not a configuration.
    expect(LIFTS_THE_CEILING.test('  }, 60_000);')).toBe(false);
    expect(LIFTS_THE_CEILING.test('the case timed out, and the test said which one')).toBe(false);
  });
});
