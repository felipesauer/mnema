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
 *   - EVERY WORKFLOW THAT PICKS A NODE, because a floor CI never runs is a floor nobody has
 *     checked. This said "CI'S OWN MATRIX" and read `.github/workflows/ci.yml` by its path, on
 *     the premise that there was one such file. The flake sampler falsified that on 22/08/2026 by
 *     arriving with a node matrix of its own, and a matrix nothing reads is exactly the blind spot
 *     this case exists to close. The workflows now come from git, the way the READMEs above
 *     already did.
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
import { acceptedBy } from '../src/node-floor.js';

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
  /**
   * The sentence an adopter reads. The version, not the word `engines`, is the discriminant —
   * and the sentence is the one the binary refuses with (`acceptedBy` in `src/node-floor.ts`),
   * so the page and the refusal cannot say two ranges. The shape the floor had while it was one
   * number, `Requires Node ≥ X`, is still read, so a page left behind is found rather than
   * skipped by a pattern that no longer fits it.
   */
  const SAYS_THE_FLOOR =
    /Requires\s+Node\s+(≥\s*\d+(?:\.\d+)*|\d+\.\d+\.\d+\s+or\s+(?:later|a\s+later\s+\d+(?:\.\d+)?)(?:,\s+or\s+\d+\.\d+\.\d+\s+or\s+(?:later|a\s+later\s+\d+(?:\.\d+)?))*)/g;

  /** What the declared range says, in the refusal's words. */
  const SAID = (acceptedBy(DECLARING[0]?.read.engines?.node ?? '') ?? [])
    .map((a) => a.said)
    .join(', or ');

  /**
   * A RELEASED changelog entry states the floor of THAT release, which is history and is true;
   * only the part above the first released heading speaks for what is here now.
   */
  const current = (where: string, text: string): string => {
    if (where !== 'CHANGELOG.md') return text;
    const released = text.search(/\n## \[\d/);
    return released < 0 ? text : text.slice(0, released);
  };

  const prose = TRACKED.filter((where) => where.endsWith('.md'))
    .map((where) => ({ where, text: current(where, readFileSync(join(ROOT, where), 'utf-8')) }))
    .flatMap(({ where, text }) =>
      [...text.matchAll(SAYS_THE_FLOOR)].map((said) => ({
        where,
        said: (said[1] ?? '').replace(/\s+/g, ' '),
      })),
    );

  it('is said by the READMEs an adopter actually reads', () => {
    expect(SAID, 'the declared range is not one the refusal reads').not.toBe('');
    expect(prose.length, 'no shipped prose states the runtime floor').toBeGreaterThan(4);
    const wrong = prose.filter((p) => p.said !== SAID).map((p) => `${p.where}: ${p.said}`);
    expect(wrong, `prose states a range other than ${SAID}`).toEqual([]);
  });

  /**
   * THE BADGE ON LINE 3 OF EVERY PACKAGE README is the floor too, and the first one an adopter
   * sees. The sentence above is not in it — its words are an image's alt text and its range is
   * in a URL — so a floor raised everywhere else left all seven saying `22.12` and this case
   * green. Both halves are read: the alt in the refusal's words, and the image's message as the
   * declared range itself, once shields' own escaping (`--` for a dash, `__` for an underscore,
   * `_` for a space) and the URL's are undone.
   */
  const BADGE = /!\[([^\]]*)\]\((https:\/\/img\.shields\.io\/badge\/node-[^)\s]*)\)/g;
  const RANGE = DECLARING[0]?.read.engines?.node ?? '';
  const messageOf = (url: string): string => {
    const path = new URL(url).pathname.slice('/badge/node-'.length);
    const message = path.replace(/-[^-]*$/, '');
    const unescaped = message
      .split('--')
      .map((part) =>
        part
          .split('__')
          .map((piece) => piece.replace(/_/g, ' '))
          .join('_'),
      )
      .join('-');
    return decodeURIComponent(unescaped);
  };
  const badges = TRACKED.filter((where) => where.endsWith('README.md')).flatMap((where) => {
    const text = readFileSync(join(ROOT, where), 'utf-8');
    const found = [...text.matchAll(BADGE)].map((b) => ({
      where,
      alt: b[1] ?? '',
      message: messageOf(b[2] ?? ''),
    }));
    // An image that calls itself a Node badge but is not drawn by the pattern above is a badge
    // this case would otherwise skip.
    const named = [...text.matchAll(/!\[Node\b[^\]]*\]\(([^)]*)\)/g)].filter(
      (n) => !(n[1] ?? '').startsWith('https://img.shields.io/badge/node-'),
    );
    return [...found, ...named.map((n) => ({ where, alt: n[0], message: '(not read)' }))];
  });

  it('is said by the badge every package README opens with', () => {
    const packages = TRACKED.filter((where) => /^packages\/[^/]+\/README\.md$/.test(where));
    expect(packages.length, 'git found no package README').toBeGreaterThan(6);
    const without = packages.filter((where) => !badges.some((b) => b.where === where));
    expect(without, 'a package README has no Node badge').toEqual([]);
    const wrong = badges
      .filter((b) => b.alt !== `Node ${SAID}` || b.message !== RANGE)
      .map((b) => `${b.where}: [${b.alt}] ${b.message}`);
    expect(wrong, `a badge states a floor other than ${RANGE}`).toEqual([]);
  });

  /**
   * EVERY WORKFLOW THAT PICKS A NODE, NOT `ci.yml` BY NAME. This read one file by its path until
   * a second workflow arrived carrying a node matrix of its own — the flake sampler — and the
   * premise underneath the sentence in this file's header, *"CI'S OWN MATRIX"*, turned out to be
   * an assumption that there was exactly one. There is not, and the next one will not announce
   * itself either. So the list comes from git, the same way the prose sites above do.
   */
  const WORKFLOWS = TRACKED.filter(
    (where) => where.startsWith('.github/workflows/') && where.endsWith('.yml'),
  ).map((where) => ({ where, text: readFileSync(join(ROOT, where), 'utf-8') }));

  /** A version this repository pins somewhere. Expressions such as `${{ matrix.node }}` are not. */
  const pinned = (text: string, pattern: RegExp): string[] =>
    [...text.matchAll(pattern)]
      .flatMap((found) => (found[1] ?? '').split(','))
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter((entry) => /^\d+(\.\d+)*$/.test(entry));

  it('is a runtime CI actually runs, in every workflow that declares a matrix', () => {
    expect(WORKFLOWS.length, 'git found no workflow at all').toBeGreaterThan(0);

    const matrices = WORKFLOWS.map((file) => ({
      where: file.where,
      versions: pinned(file.text, /^\s*node: \[(.+)\]\s*$/gm),
    })).filter((file) => file.versions.length > 0);

    expect(
      matrices.map((file) => file.where),
      'no workflow declares a node matrix, so nothing here checks a runtime',
    ).toContain('.github/workflows/ci.yml');

    const misses = matrices
      .filter((file) => !file.versions.includes(FLOOR.join('.')))
      .map((file) => `${file.where}: ${file.versions.join(', ')}`);
    // The patch, not the major: a matrix that says `'24'` runs whatever 24 the runner resolves
    // today, and the floor itself (the 24 below the one that settled the Ed25519 rule) would be
    // declared and never run.
    expect(misses, 'a workflow matrix never runs the exact floor this workspace declares').toEqual(
      [],
    );
  });

  /**
   * THE ONE JOB THAT RUNS BELOW THE FLOOR ON PURPOSE. `the-binary-refuses-an-old-node` runs the
   * built binary under Nodes the floor refuses, because that is the only way to see what a person
   * on one is told (`.github/the-binary-runs/it-refuses-an-old-node.sh`). It is left out of the
   * scan BY NAME, so any other pin below the floor — in this job's neighbours, or in a job that
   * merely resembles it — still reddens; and the job is checked to exist and to run that script,
   * so the exemption cannot outlive the thing it excuses.
   */
  const REFUSES_AN_OLD_NODE = 'the-binary-refuses-an-old-node';
  const withoutTheJobThatRefusesAnOldNode = (text: string): string => {
    const lines = text.split('\n');
    const from = lines.findIndex((line) => line === `  ${REFUSES_AN_OLD_NODE}:`);
    if (from < 0) return text;
    const length = lines.slice(from + 1).findIndex((line) => /^ {2}[A-Za-z]/.test(line));
    return lines.filter((_, at) => at < from || (length >= 0 && at > from + length)).join('\n');
  };

  it('exempts the job that refuses an old Node only while it runs that script', () => {
    const ci = WORKFLOWS.find((file) => file.where === '.github/workflows/ci.yml');
    expect(ci?.text).toContain(`\n  ${REFUSES_AN_OLD_NODE}:\n`);
    expect(ci?.text).toContain('run: bash .github/the-binary-runs/it-refuses-an-old-node.sh');
    const stripped = withoutTheJobThatRefusesAnOldNode(ci?.text ?? '');
    expect(stripped).not.toContain(REFUSES_AN_OLD_NODE);
    expect(stripped).toContain('\n  the-link-cannot-come-back:\n');
    expect(stripped).toContain('\n  the-extension-as-a-file:\n');
    // And the job really does pin Nodes below the floor, or there would be nothing to exempt.
    expect(pinned(ci?.text ?? '', /^\s*node: \[(.+)\]\s*$/gm)).toContain('20.20.2');
  });

  it('is never undercut by a node pinned anywhere in a workflow', () => {
    const below = WORKFLOWS.flatMap((file) =>
      [
        ...pinned(withoutTheJobThatRefusesAnOldNode(file.text), /^\s*node: \[(.+)\]\s*$/gm),
        ...pinned(withoutTheJobThatRefusesAnOldNode(file.text), /^\s*node-version:\s*(\S+)\s*$/gm),
      ]
        .filter((entry) => Number(entry.split('.')[0]) < FLOOR[0])
        .map((entry) => `${file.where}: ${entry}`),
    );
    expect(below, 'a workflow runs a node this workspace does not claim to support').toEqual([]);
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
