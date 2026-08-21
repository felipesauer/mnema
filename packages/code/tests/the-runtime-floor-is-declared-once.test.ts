/**
 * THE RUNTIME FLOOR IS DECLARED ONCE, and every place that repeats it repeats the same number.
 *
 * WHERE THIS COMES FROM. Both manifests said `"node": ">=20"`, and three of this workspace's
 * own direct dependencies say otherwise: `better-sqlite3` and `ink` require 22, and
 * `commander` requires 22.12.0. There is no `.npmrc` in the alpha, so `engine-strict` was off
 * and pnpm installed anyway — which means the declaration was not merely wrong, it was wrong
 * and unenforced. Run under node 20 in a container shaped like the runner, the suite came back
 * with twenty-three red cases across nine files, all of them screen and pty work, which is
 * exactly the surface `ink` moves. An adopter on node 20 got a package that said it supported
 * their runtime, installed without complaint, and then failed in a tree they had already built.
 *
 * SO THE FLOOR IS ONE NUMBER WITH ONE OWNER — `engines.node` — and this case is what makes the
 * other eight places quote it rather than restate it:
 *
 *   - THE TWO MANIFESTS that declare it, which have to agree with each other.
 *   - THE FIVE READMEs that tell an adopter what to install. These are the half a symbol
 *     search does not find: not one of them contains the word `engines`, so the grep that
 *     locates the manifests locates none of them, and they are the only sites an adopter
 *     actually reads.
 *   - CI'S OWN MATRIX, because a floor that CI never runs is a floor nobody has checked.
 *   - `.npmrc`, because a floor pnpm does not enforce is prose.
 *
 * AND IT IS CHECKED AGAINST THE DEPENDENCIES, not just against itself. The eight sites agreeing
 * on `>=20` is precisely the state this case was written to end, so agreement alone would have
 * been green on the defect. What makes it red is the floor being compared to what the installed
 * direct dependencies demand — which is the fact that was true all along and that nothing read.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered. Transitive
 * dependencies, deliberately: their floors are not our promise to keep, and a guard that
 * reddened when something four levels down bumped a caret would be a guard switched off. Nor
 * whether the floor is *too high* — over-declaring is safe, under-declaring is the defect, and
 * only the defect is guarded. And it reads a dependency's range for its LOWEST accepted
 * runtime, not for holes above that: `vitest` says `^20 || ^22 || >=24`, which accepts 22 and
 * 24 and refuses 23, and nothing here would notice a floor landing in such a gap. Answering
 * that needs a semver resolver, and the matrix — which runs the real versions — answers it in
 * the only way that counts anyway.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * EVERYTHING THE WORKSPACE SHIPS, ASKED OF THE WORKSPACE ITSELF. A walk over a list of
 * directories would carry whoever wrote the list's blind spot; this carries git's.
 */
const TRACKED: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => where !== '');

/** A floor, as a version. */
type Version = readonly [number, number, number];

/**
 * ONE ALTERNATIVE of a range: `>=22.12.0`, `^22.0.0`, `~22.12`, or a bare `22`. Every one of
 * these has a lowest runtime it accepts, and that lowest runtime is the only thing read here.
 * A `>` is deliberately NOT read: `>22` and `>22.0.0` have different floors and guessing which
 * was meant is how a guard starts being wrong quietly.
 */
const AN_ALTERNATIVE = /^(>=|\^|~|v)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

const lower = (a: Version, b: Version): Version =>
  a[0] !== b[0]
    ? a[0] < b[0]
      ? a
      : b
    : a[1] !== b[1]
      ? a[1] < b[1]
        ? a
        : b
      : a[2] <= b[2]
        ? a
        : b;

/**
 * THE LOWEST RUNTIME A RANGE ACCEPTS, or null when the range is written in a shape this cannot
 * read. Disjunctions are read alternative by alternative and the lowest wins, because
 * `^20 || ^22 || >=24` accepts node 20 and a floor below 20 would be below it.
 */
function floorOf(range: string): Version | null {
  const alternatives = range.split('||').map((part) => part.trim());
  if (alternatives.length === 0) return null;
  let lowest: Version | null = null;
  for (const alternative of alternatives) {
    const said = AN_ALTERNATIVE.exec(alternative);
    if (said === null) return null;
    const here: Version = [Number(said[2]), Number(said[3] ?? '0'), Number(said[4] ?? '0')];
    lowest = lowest === null ? here : lower(lowest, here);
  }
  return lowest;
}

const show = (v: Version): string => v.join('.');
const reaches = (have: Version, need: Version): boolean =>
  have[0] !== need[0]
    ? have[0] > need[0]
    : have[1] !== need[1]
      ? have[1] > need[1]
      : have[2] >= need[2];

/** Every manifest the workspace ships, paired with what it declares. */
const MANIFESTS = TRACKED.filter(
  (where) => where === 'package.json' || where.endsWith('/package.json'),
).map((where) => ({
  where,
  read: JSON.parse(readFileSync(join(ROOT, where), 'utf-8')) as {
    name?: string;
    engines?: { node?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
}));

/** The ones that declare a floor. */
const DECLARING = MANIFESTS.filter((m) => typeof m.read.engines?.node === 'string');

describe('the runtime floor is one number', () => {
  it('is declared by more than one manifest, and they agree', () => {
    expect(DECLARING.length, 'no manifest declares engines.node at all').toBeGreaterThan(1);
    const said = [...new Set(DECLARING.map((m) => m.read.engines?.node))];
    expect(said, 'the manifests disagree about the runtime floor').toHaveLength(1);
  });

  it('is written in a shape this case can read', () => {
    for (const m of DECLARING) {
      expect(
        floorOf(m.read.engines?.node ?? ''),
        `${m.where} declares an unreadable range`,
      ).not.toBeNull();
    }
  });
});

/** The floor itself, once the two cases above have earned the right to speak of one. */
const FLOOR: Version = floorOf(DECLARING[0]?.read.engines?.node ?? '') ?? [0, 0, 0];

describe('the floor is at least what the dependencies demand', () => {
  /**
   * WHAT THE DIRECT DEPENDENCIES DEMAND, read from what is installed rather than from a list
   * written here — a list would go stale the first time somebody added a dependency, and going
   * stale silently is the failure mode this whole case exists to end.
   */
  const demanded = MANIFESTS.flatMap((m) =>
    Object.keys({ ...m.read.dependencies, ...m.read.devDependencies })
      .filter((dep) => !(m.read.dependencies?.[dep] ?? '').startsWith('workspace:'))
      .map((dep) => {
        const here = join(ROOT, m.where, '..');
        const found = [join(here, 'node_modules', dep), join(ROOT, 'node_modules', dep)].find(
          (candidate) => existsSync(join(candidate, 'package.json')),
        );
        if (found === undefined) return { dep, range: null, floor: null };
        const read = JSON.parse(readFileSync(join(found, 'package.json'), 'utf-8')) as {
          engines?: { node?: string };
        };
        const range = read.engines?.node ?? null;
        return { dep, range, floor: range === null ? null : floorOf(range) };
      }),
  );

  it('read the dependencies at all', () => {
    // NOT VACUOUS: an uninstalled tree, or a rename of node_modules' layout, would leave this
    // case comparing the floor against nothing and reporting that it is high enough.
    const installed = demanded.filter((d) => d.range !== null || d.floor === null);
    expect(demanded.length, 'no direct dependencies were found in any manifest').toBeGreaterThan(5);
    expect(
      installed.filter((d) => d.range !== null).length,
      'not one installed dependency declared engines.node — is the tree installed?',
    ).toBeGreaterThan(2);
  });

  it('reads every range it is given, or says which one it could not', () => {
    // An instrument that cannot say it broke is worse than no instrument: a dependency that
    // starts declaring `^22 || ^24` must stop this case, not be skipped by it.
    const unreadable = demanded
      .filter((d) => d.range !== null && d.floor === null)
      .map((d) => `${d.dep}: ${d.range}`);
    expect(unreadable, 'a dependency declares a range this case cannot read').toEqual([]);
  });

  it('is not below any direct dependency', () => {
    const above = demanded
      .filter((d) => d.floor !== null && !reaches(FLOOR, d.floor))
      .map((d) => `${d.dep} needs ${d.range}`)
      .sort();
    expect(above, `the declared floor ${show(FLOOR)} is below what these demand`).toEqual([]);
  });
});

describe('every place that repeats the floor repeats this number', () => {
  /** The sentence an adopter reads. The version, not the word `engines`, is the discriminant. */
  const SAYS_THE_FLOOR = /Requires Node ≥ (\d+(?:\.\d+)*)/g;

  const prose = TRACKED.filter((where) => where.endsWith('.md'))
    .map((where) => ({ where, text: readFileSync(join(ROOT, where), 'utf-8') }))
    .flatMap(({ where, text }) =>
      [...text.matchAll(SAYS_THE_FLOOR)].map((said) => ({ where, said: said[1] ?? '' })),
    );

  it('is said by the READMEs an adopter actually reads', () => {
    expect(prose.length, 'no shipped prose states the runtime floor').toBeGreaterThan(4);
    const wrong = prose.filter((p) => p.said !== show(FLOOR)).map((p) => `${p.where}: ${p.said}`);
    expect(wrong, `prose states a floor other than ${show(FLOOR)}`).toEqual([]);
  });

  it('is a runtime CI actually runs', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
    const matrix = /^\s*node: \[(.+)\]\s*$/m.exec(ci);
    expect(matrix, 'CI declares no node matrix').not.toBeNull();
    const versions = (matrix?.[1] ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter((entry) => entry !== '');
    expect(versions.length, 'the node matrix came back empty').toBeGreaterThan(0);
    expect(versions, 'CI never runs the floor it declares').toContain(String(FLOOR[0]));
    const below = versions.filter((entry) => Number(entry) < FLOOR[0]);
    expect(below, 'CI runs a node this workspace does not claim to support').toEqual([]);
  });

  it('is enforced by pnpm rather than merely stated', () => {
    const npmrc = join(ROOT, '.npmrc');
    expect(existsSync(npmrc), 'there is no .npmrc, so engines.node is advisory').toBe(true);
    expect(
      readFileSync(npmrc, 'utf-8')
        .split('\n')
        .map((line) => line.trim()),
      'engine-strict is not on, so pnpm installs below the floor and fails later',
    ).toContain('engine-strict=true');
  });
});
