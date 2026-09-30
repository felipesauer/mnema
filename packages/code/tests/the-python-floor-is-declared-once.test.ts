/**
 * THE PYTHON FLOOR IS DECLARED ONCE, AND CI RUNS IT — the second reader's twin of
 * `the-runtime-floor-is-declared-once.test.ts`.
 *
 * WHERE THIS COMES FROM. Two pages promise that the second reader in `packages/chain/verifier/`
 * runs on a Python as old as the one its own page names, "or later": that page, and the root
 * one. Nothing ran it there. Every case that starts the reader calls whatever `python3` the
 * machine has, `ci.yml` set up no Python at all, and the runner image this repository pins
 * ships 3.12 — so the floor two pages publish had been checked for its GRAMMAR once, by hand,
 * and never for its library. A floor CI never runs is a floor nobody has checked.
 *
 * SO THE FLOOR IS ONE NUMBER WITH ONE OWNER — the sentence on the reader's own page, which is
 * the page that travels with the reader in `@mnema/chain`'s tarball — and this case is what
 * makes every other place quote it rather than restate it:
 *
 *   - EVERY TRACKED FILE THAT STATES A PYTHON FLOOR, found by the claim and not by a list, in
 *     any file git carries — pages, docstrings, manifests and workflows alike.
 *   - EVERY WORKFLOW THAT SETS UP A PYTHON. The job that says it runs the floor sets up exactly
 *     that one, and no job anywhere sets up one below it.
 *   - THAT JOB RUNS EVERY TEST FILE THAT STARTS `python3`, found by the discriminant — a string
 *     literal that is the interpreter's name and nothing else — so a new file that starts the
 *     reader is red here until the job runs it too, and a file the job names that no longer
 *     starts it is red as well.
 *   - THAT JOB TYPE-CHECKS THE WHOLE READER AGAINST THE FLOOR, with a pinned `mypy`: every
 *     `--python-version` a job passes is the floor, like every page's sentence. The cases below
 *     only see what the floor lacks on a line they reach, and one error at a time — the reader's
 *     first run on 3.9 died on import, on a type alias spelled with `|`, and said nothing about
 *     the rest. The checker reads every line.
 *   - AND THE `python3` THOSE CASES CALL IS THE FLOOR, EXACTLY, in that job. The job says so by
 *     setting `PYTHON3_IS_THE_FLOOR`, and the last case here asks the interpreter itself for
 *     `sys.version_info[:2]` — so an image or an action that stopped putting the floor first on
 *     `PATH` turns the job red instead of green on the image's own Python. Everywhere else —
 *     a workstation, the matrix, the flake sampler — the same case asks only that it be no
 *     lower than the floor.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered:
 *   - A path of the reader that no case exercises, beyond what the checker reads. `mypy` names
 *     syntax and library the floor lacks when its stubs for the floor say so; a difference in
 *     BEHAVIOUR between the floor and a newer Python, on a line no case reaches, is as unchecked
 *     on the floor as it was before.
 *   - The patch release. The floor is a major and a minor, and `actions/setup-python` takes the
 *     newest release of that line it knows.
 *   - Whether the floor is too HIGH. Over-declaring is safe, under-declaring is the defect, and
 *     only the defect is guarded.
 *   - `measurements/p1/harness/`, which starts `python3` for fixtures that are not the reader. It
 *     is outside `packages/`, and vitest never runs it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * EVERYTHING THE WORKSPACE CARRIES, ASKED OF THE WORKSPACE ITSELF, the way the node floor's
 * case asks it: a walk over a list of directories would carry whoever wrote the list's blind
 * spot; this carries git's.
 */
const TRACKED: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => where !== '');

/**
 * A file as text, or null when it is not text this case can read a sentence out of. A NUL byte
 * decodes to U+0000, so looking for it in the text is looking for it in the bytes.
 */
function textOf(where: string): string | null {
  if (where === 'pnpm-lock.yaml') return null;
  const text = readFileSync(join(ROOT, where), 'utf-8');
  return text.includes('\u0000') ? null : text;
}

/** The owner of the floor: the second reader's own page. */
const OWNER = 'packages/chain/verifier/README.md';

/**
 * A PYTHON FLOOR, AS A FILE STATES ONE. The discriminant is the claim, and not the word `Python`
 * near a number: the runner's own 3.12 is named in this workspace, correctly, and it is not a
 * floor. It reads five shapes — `Python` and a number followed by `or later`, `or newer`,
 * `or above`, `or higher` or `+`, or preceded by `≥` or `>=` — and NOTHING ELSE: a floor written
 * as "requires 3.9" with no `Python` before it, or as `python3.9`, is not seen. The owner's own
 * sentence has to be one of the five, which the first case below holds.
 */
const SAYS_A_PYTHON_FLOOR =
  /\bPython\s*(?:≥|>=)\s*(\d+\.\d+)\b|\bPython\s+(\d+\.\d+)(?:\+|\s+or\s+(?:later|newer|above|higher)\b)/g;

/** Every floor any tracked file states, with where. */
const STATED = TRACKED.flatMap((where) => {
  const text = textOf(where);
  if (text === null) return [];
  return [...text.matchAll(SAYS_A_PYTHON_FLOOR)].map((said) => ({
    where,
    said: said[1] ?? said[2] ?? '',
  }));
});

/** A floor as a version this case can compare. */
const asVersion = (said: string): readonly [number, number] => {
  const [major, minor] = said.split('.').map(Number);
  return [major ?? Number.NaN, minor ?? Number.NaN];
};
const reaches = (have: string, need: string): boolean => {
  const [a, b] = [asVersion(have), asVersion(need)];
  return a[0] !== b[0] ? a[0] > b[0] : a[1] >= b[1];
};

describe('the python floor is one number', () => {
  it('is stated by the reader’s own page, once', () => {
    expect(
      STATED.filter((one) => one.where === OWNER),
      `${OWNER} no longer states the Python it runs on, in a shape this case reads`,
    ).toHaveLength(1);
  });

  it('is the same number wherever a file repeats it', () => {
    // NOT VACUOUS: the root page repeats it, so a sweep that found only the owner would be a
    // sweep that stopped reading.
    expect(STATED.length, 'no file other than the owner states the floor').toBeGreaterThan(1);
    const wrong = STATED.filter((one) => one.said !== FLOOR).map(
      (one) => `${one.where}: ${one.said}`,
    );
    expect(wrong, `a file states a Python floor other than ${FLOOR}`).toEqual([]);
  });
});

/** The floor itself, once the case above has earned the right to speak of one. */
const FLOOR: string = STATED.find((one) => one.where === OWNER)?.said ?? '';

/** The variable the floor's job sets, and the only thing that makes the last case exact. */
const THE_JOB_SAYS = 'PYTHON3_IS_THE_FLOOR';

/**
 * A workflow's jobs, each with its PROSE STRIPPED. A comment is a mention and not a setting: the
 * comment above the floor's job names the variable and the version to explain them, and a case
 * that read it would be green on a job whose settings had lost both.
 */
function jobsOf(where: string, text: string): readonly { where: string; body: string }[] {
  const lines = text.split('\n').filter((line) => !/^\s*#/.test(line));
  const from = lines.indexOf('jobs:');
  if (from === -1) return [];
  const jobs: { where: string; body: string[] }[] = [];
  for (const line of lines.slice(from + 1)) {
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header !== null) jobs.push({ where: `${where} ${header[1]}`, body: [] });
    else jobs.at(-1)?.body.push(line);
  }
  return jobs.map((job) => ({ where: job.where, body: job.body.join('\n') }));
}

const JOBS = TRACKED.filter(
  (where) => where.startsWith('.github/workflows/') && /\.ya?ml$/.test(where),
).flatMap((where) => jobsOf(where, readFileSync(join(ROOT, where), 'utf-8')));

/** Every Python a job sets up, as written. */
const pythonsOf = (body: string): string[] =>
  [...body.matchAll(/^\s*python-version:\s*(\S+)\s*$/gm)].map((found) =>
    (found[1] ?? '').replace(/^['"]|['"]$/g, ''),
  );

const SETS_UP_PYTHON = JOBS.filter((job) => /uses: actions\/setup-python@/.test(job.body));
const THE_FLOORS_JOB = SETS_UP_PYTHON.filter((job) =>
  new RegExp(`^\\s+${THE_JOB_SAYS}:\\s*\\S`, 'm').test(job.body),
);

/**
 * EVERY TEST FILE THAT STARTS THE INTERPRETER. The discriminant is a string literal that is the
 * interpreter's name and nothing else — `'python3'`, what every one of them hands `spawnSync` or
 * `execFileSync` — rather than the word near a call: a comment that says "`python3`" in back
 * quotes starts nothing, and the product names `python` beside `node` and `psql` as programs
 * whose way out it copies.
 */
const STARTS_PYTHON = /(['"])python(?:3(?:\.\d+)?)?\1/;
const startsPython = (where: string): boolean =>
  STARTS_PYTHON.test(readFileSync(join(ROOT, where), 'utf-8'));

describe('CI runs the floor', () => {
  it('in one job, which sets up exactly that Python and says so to the cases', () => {
    expect(
      THE_FLOORS_JOB.map((job) => job.where),
      `no job sets up a Python and sets ${THE_JOB_SAYS}, so nothing runs the floor`,
    ).toHaveLength(1);
    const [job] = THE_FLOORS_JOB;
    expect(
      pythonsOf(job?.body ?? ''),
      `${job?.where} sets up a Python other than the floor`,
    ).toEqual([FLOOR]);
  });

  it('and no job anywhere sets up a Python below it', () => {
    const below = SETS_UP_PYTHON.flatMap((job) =>
      pythonsOf(job.body)
        .filter((said) => !/^\d+\.\d+/.test(said) || !reaches(said, FLOOR))
        .map((said) => `${job.where}: ${said}`),
    );
    expect(
      below,
      'a job sets up a Python the pages do not promise, or one this cannot read',
    ).toEqual([]);
  });

  it('and that job runs every test file that starts python3, and names no other', () => {
    const tests = TRACKED.filter((where) => where.startsWith('packages/') && where.endsWith('.ts'));
    const starting = tests.filter(startsPython);
    // A HELPER THAT STARTS IT WOULD HIDE WHO CALLS IT. Every file found today is a test file
    // that starts the interpreter itself; a module that did it for them would leave the files
    // that import it out of the list below, with this case green.
    expect(
      starting.filter((where) => !where.endsWith('.test.ts')),
      'a module that is not a test starts python3, so the files that call it cannot be read here',
    ).toEqual([]);
    // NOT VACUOUS: the reader's own case and this one are among them, or the discriminant broke.
    expect(starting).toContain(
      'packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts',
    );
    expect(starting).toContain('packages/code/tests/the-python-floor-is-declared-once.test.ts');

    const named = [...(THE_FLOORS_JOB[0]?.body ?? '').matchAll(/\bpackages\/\S+\.test\.ts\b/g)].map(
      (found) => found[0],
    );
    expect(
      [...new Set(named)].sort(),
      'the floor job does not run exactly the files that start python3',
    ).toEqual([...starting].sort());
  });

  it('and that job type-checks the whole reader against the floor, with a checker pinned', () => {
    // THE FLOOR'S OTHER SPELLING. A checker told a target is one more place that repeats the
    // floor, so it is read here like the pages are: every `--python-version` any job passes is
    // the floor, and the floor's own job passes it to `mypy` over the reader's directory.
    const targets = JOBS.flatMap((job) =>
      [...job.body.matchAll(/--python-version[\s=]+(\S+)/g)].map((found) => ({
        where: job.where,
        said: (found[1] ?? '').replace(/^['"]|['"]$/g, ''),
      })),
    );
    expect(
      targets.filter((one) => one.said !== FLOOR).map((one) => `${one.where}: ${one.said}`),
      `a job type-checks against a Python other than the floor ${FLOOR}`,
    ).toEqual([]);
    const body = THE_FLOORS_JOB[0]?.body ?? '';
    expect(body, 'the floor job does not run mypy over the reader against the floor').toMatch(
      new RegExp(
        `\\bmypy\\b[^\\n]*--python-version[\\s=]+${FLOOR.replace('.', '\\.')}\\b[^\\n]*\\spackages/chain/verifier/?(?:\\s|$)`,
      ),
    );
    // A CHECKER THAT FLOATS IS A CHECK THAT CHANGES UNDER THE SAME HEAD, and one release of it
    // already refuses the floor as a target.
    expect(body, 'the floor job installs a mypy whose version is not pinned').toMatch(
      /\bmypy==\d+\.\d+\.\d+\b/,
    );
  });
});

describe('the python3 the cases call', () => {
  it('is at least the floor, and in the floor’s own job it is the floor exactly', () => {
    const ask = 'import sys; print("%d.%d" % sys.version_info[:2])';
    const asked = spawnSync('python3', ['-c', ask], { encoding: 'utf-8' });
    if (asked.error !== undefined) {
      throw new Error(`python3 could not be run: ${asked.error.message}`);
    }
    const running = asked.stdout.trim();
    expect(running, `python3 did not say its version: ${asked.stderr}`).toMatch(/^\d+\.\d+$/);
    if (process.env[THE_JOB_SAYS] !== undefined) {
      expect(running, `the floor's job set up ${FLOOR} and the cases are calling ${running}`).toBe(
        FLOOR,
      );
    } else {
      expect(reaches(running, FLOOR), `python3 here is ${running}, below the floor ${FLOOR}`).toBe(
        true,
      );
    }
  });
});
