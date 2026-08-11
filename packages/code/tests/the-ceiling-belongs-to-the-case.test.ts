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
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered: whether a case
 * that waits actually HAS its own ceiling. That question needs a DURATION, and a scan over
 * source has none — it is answered by running the suite and reading the durations, which is
 * not something a guard can do without becoming the thing it measures.
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
 * packages, and CI. The workbench directories are local-only and ignored by git, so they are
 * not part of the tree this rule is about.
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
