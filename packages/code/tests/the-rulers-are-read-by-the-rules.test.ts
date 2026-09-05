/**
 * THE RULERS ARE READ BY THE RULES. Every `.mjs` this repository ships or runs as an
 * instrument goes through the same lint and the same type-check as the product, through
 * the entry points that already exist and no others.
 *
 * WHERE THIS COMES FROM. Five files judge this workspace and nothing judged them. Four
 * decide whether a red was the guard or the machine (`why-it-went-red/`), how often the
 * suite lied (`flake-sampler/`) and what it left in `/tmp` (`what-the-suite-left-behind/`);
 * the fifth is shipped, and is the first thing a Claude Code user receives from this
 * product. Measured on the trunk: `biome check` over `.github/` reported `Checked 0 files`
 * — not an error, ZEROS, which is the vacuous shape this bench has been bitten by twice —
 * and `tsc` with `checkJs` over the five reported 88 errors, two of which were a field
 * whose declared type could not hold what its own second line assigned to it.
 *
 * THE UNIVERSE IS TWO DIRECTORIES, AND THAT IS A JUDGEMENT WRITTEN DOWN. `plugin/` is
 * what this repository SHIPS and `.github/` is what it RUNS itself with; both are read
 * off the disk here, never off a list. `measurements/` also holds `.mjs` and is
 * deliberately outside: it is the record of rounds already run, kept as it was when it
 * produced its numbers, and holding a past round to today's options would edit evidence.
 *
 * WHAT IS RECONCILED, IN BOTH DIRECTIONS. A file on disk that neither config's globs
 * reach is accused, and a glob that reaches nothing is accused too — a config whose
 * patterns stopped matching reads exactly like a clean one, which is the failure this
 * whole family of files exists to refuse.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered:
 *
 *   - the two behavioural halves run in a sandbox of their own with the REAL config
 *     copied into it, so they answer "do these options accuse this mutation" and not "is
 *     the working tree clean right now". Whether the working tree is clean is what
 *     `pnpm lint` and `pnpm typecheck` answer, on every run;
 *   - the sandbox borrows this workspace's `node_modules` by symlink, because the rulers
 *     import `node:*` and vitest's own reporter types. A machine with no install cannot
 *     run these two, which is also true of every other case in this suite;
 *   - it says nothing about what the rulers DO. That is
 *     `the-red-says-why-it-went-red`, `the-sampler-counts-or-refuses`,
 *     `what-the-suite-left-behind` and `the-record-arrives-unasked`, which run all five.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/** The repository root: `packages/code/tests/` is three levels under it. */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** The two trees this repository ships from and runs itself with. */
const THE_TREES = ['.github', 'plugin'] as const;

/** Where the rulers' options live. */
const RULERS_PROJECT = join(REPO, 'tsconfig.rulers.json');

/** `tsc` and `biome` as this workspace installed them. */
const TSC = join(REPO, 'node_modules', '.bin', 'tsc');
const BIOME = join(REPO, 'node_modules', '.bin', 'biome');

/** A tsconfig may carry comments; this reads one the way `tsc` does. */
function readConfig<T>(at: string): T {
  const stripped = readFileSync(at, 'utf-8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(stripped) as T;
}

/** Every `.mjs` this repository ships or runs, off the disk. */
function theInstruments(): string[] {
  return globSync(
    THE_TREES.map((tree) => `${tree}/**/*.mjs`),
    { cwd: REPO },
  )
    .map((one) => one.replaceAll('\\', '/'))
    .sort();
}

/** What a config's globs actually reach, from the repository root. */
function reachedBy(patterns: readonly string[]): string[] {
  return globSync([...patterns], { cwd: REPO })
    .map((one) => one.replaceAll('\\', '/'))
    .sort();
}

let sandboxes: string[] = [];

/** A sandbox of this own making, torn down after the case that made it. */
function sandbox(): string {
  const here = mkdtempSync(join(tmpdir(), 'mnema-rulers-'));
  sandboxes.push(here);
  return here;
}

afterEach(() => {
  for (const here of sandboxes) rmSync(here, { recursive: true, force: true });
  sandboxes = [];
});

/** What a command said, whether or not it exited zero. */
function ran(command: string, args: readonly string[], cwd: string): string {
  try {
    return execFileSync(command, [...args], { cwd, encoding: 'utf-8', stdio: 'pipe' });
  } catch (why) {
    const said = why as { stdout?: string; stderr?: string };
    return `${said.stdout ?? ''}${said.stderr ?? ''}`;
  }
}

describe('the same globs reach every instrument this repository ships or runs', () => {
  it('lints every one of them, and its globs reach nothing else and nothing less', () => {
    const config = readConfig<{ files: { includes: string[] } }>(join(REPO, 'biome.json'));
    const mjs = config.files.includes.filter((one) => one.endsWith('.mjs'));
    // Reaching nothing is the failure mode, so the count is asserted before the set.
    expect(mjs.length).toBeGreaterThan(0);
    expect(reachedBy(mjs)).toEqual(theInstruments());
  });

  it('type-checks every one of them, off the project the root references', () => {
    const root = readConfig<{ references: { path: string }[] }>(join(REPO, 'tsconfig.json'));
    // The entry point is the one that already exists: `pnpm typecheck` is `tsc -b` over
    // these references, so being one of them is what "reached" means.
    expect(root.references.map((one) => one.path)).toContain('tsconfig.rulers.json');

    const rulers = readConfig<{
      compilerOptions: { allowJs?: boolean; checkJs?: boolean };
      include: string[];
    }>(RULERS_PROJECT);
    expect(rulers.compilerOptions.allowJs).toBe(true);
    // Without this the project compiles the files and asserts nothing about them, which
    // is a green that says less than no green at all.
    expect(rulers.compilerOptions.checkJs).toBe(true);
    expect(rulers.include.length).toBeGreaterThan(0);
    expect(reachedBy(rulers.include)).toEqual(theInstruments());
  });

  it('holds all five of them, so a delivery that emptied a tree is red', () => {
    // The two cases above compare two sets, and two empty sets are equal. This is what
    // stops them from passing over a repository whose instruments went missing.
    expect(theInstruments()).toEqual([
      '.github/flake-sampler/summarize.mjs',
      '.github/what-the-suite-left-behind/sweep.mjs',
      '.github/why-it-went-red/ledger.mjs',
      '.github/why-it-went-red/verdict.mjs',
      'plugin/hooks/session-start.mjs',
    ]);
  });
});

describe('the lint reaches a ruler, and it is the includes that carry it there', () => {
  /**
   * A copy of a real ruler under `.github/`, beside a copy of the real `biome.json`.
   *
   * `git init` because the config asks git what is ignored; without a repository biome
   * refuses for a reason that has nothing to do with what is being asked here.
   */
  function stagedWith(includes: string[] | null): { here: string; file: string } {
    const here = sandbox();
    const file = '.github/what-the-suite-left-behind/sweep.mjs';
    mkdirSync(join(here, dirname(file)), { recursive: true });
    copyFileSync(join(REPO, file), join(here, file));
    const config = readConfig<{ files: { includes: string[] } }>(join(REPO, 'biome.json'));
    if (includes !== null) config.files.includes = includes;
    writeFileSync(join(here, 'biome.json'), JSON.stringify(config, null, 2));
    execFileSync('git', ['init', '-q'], { cwd: here, stdio: 'ignore' });
    return { here, file };
  }

  /** The one line a lint rule of this configuration accuses. */
  const A_VIOLATION = "\nexport const drifted = THE_FAMILY == 'mnema-';\n";

  it('passes over the ruler as it stands', () => {
    const { here, file } = stagedWith(null);
    const said = ran(BIOME, ['check', '--error-on-warnings', file], here);
    expect(said).toContain('Checked 1 file');
    expect(said).not.toContain('lint/');
  });

  it('accuses a violation planted in it', () => {
    const { here, file } = stagedWith(null);
    writeFileSync(join(here, file), readFileSync(join(here, file), 'utf-8') + A_VIOLATION, 'utf-8');
    const said = ran(BIOME, ['check', '--error-on-warnings', file], here);
    expect(said).toContain('lint/suspicious/noDoubleEquals');
  });

  it('says nothing at all about the same violation once the tree leaves the includes', () => {
    // THE MUTATION THAT PROVES WHICH LINE CARRIES THIS. Drop `.github/**/*.mjs` and the
    // identical file with the identical violation comes back as ZEROS — not a refusal, a
    // clean-looking nothing. That is the state this repository was in, and it is why the
    // case above is worth something.
    const config = readConfig<{ files: { includes: string[] } }>(join(REPO, 'biome.json'));
    const without = config.files.includes.filter((one) => !one.startsWith('.github/'));
    expect(without.length).toBeLessThan(config.files.includes.length);
    const { here, file } = stagedWith(without);
    writeFileSync(join(here, file), readFileSync(join(here, file), 'utf-8') + A_VIOLATION, 'utf-8');
    const said = ran(BIOME, ['check', '--error-on-warnings', file], here);
    expect(said).not.toContain('lint/suspicious/noDoubleEquals');
    expect(said).toContain('No files were processed');
  });
});

describe('the type-check reaches a ruler, and it is checkJs that carries it there', () => {
  /**
   * A copy of a real ruler, under a copy of the REAL rulers project — same `strict`, same
   * `noUncheckedIndexedAccess`, same everything, because the options are what is on trial.
   *
   * `extends` is rewritten to an absolute path and `node_modules` is borrowed by symlink,
   * which are the two things a directory outside the workspace cannot inherit.
   */
  function staged(change: (options: Record<string, unknown>) => void = () => undefined): {
    here: string;
    file: string;
  } {
    const here = sandbox();
    const file = '.github/why-it-went-red/ledger.mjs';
    mkdirSync(join(here, dirname(file)), { recursive: true });
    copyFileSync(join(REPO, file), join(here, file));
    symlinkSync(join(REPO, 'node_modules'), join(here, 'node_modules'), 'dir');
    const project = readConfig<{ compilerOptions: Record<string, unknown>; include: string[] }>(
      RULERS_PROJECT,
    );
    change(project.compilerOptions);
    writeFileSync(
      join(here, 'tsconfig.json'),
      JSON.stringify(
        { ...project, extends: join(REPO, 'tsconfig.base.json'), include: ['.github/**/*.mjs'] },
        null,
        2,
      ),
    );
    return { here, file };
  }

  /** The annotation whose absence is the defect this slice found. */
  const THE_ANNOTATION = '   * @type {ReturnType<typeof setInterval> | null}\n';

  it('passes over the ruler as it stands', () => {
    const { here } = staged();
    expect(ran(TSC, ['-p', 'tsconfig.json'], here).trim()).toBe('');
  });

  it('accuses the field again the moment its type stops saying what it holds', () => {
    // THE MUTATION THE SLICE OWES. `#timer` was declared `null` and assigned a `Timeout`
    // on its own second line. Nothing failed at runtime, and nothing could see it either.
    const { here, file } = staged();
    const source = readFileSync(join(here, file), 'utf-8');
    expect(source).toContain(THE_ANNOTATION);
    writeFileSync(join(here, file), source.replace(THE_ANNOTATION, ''), 'utf-8');
    const said = ran(TSC, ['-p', 'tsconfig.json'], here);
    expect(said).toContain("Type 'Timeout' is not assignable to type 'null'");
    expect(said).toContain("Object is possibly 'null'");
  });

  it('says nothing about the same mutation once checkJs is off', () => {
    // THE OTHER SIDE. Without `checkJs` the project still COMPILES the file and reports a
    // clean run — the reach is the option, not the include.
    const { here, file } = staged((options) => {
      options.checkJs = false;
    });
    const source = readFileSync(join(here, file), 'utf-8');
    const without = source.replace(THE_ANNOTATION, '');
    expect(without).not.toBe(source);
    writeFileSync(join(here, file), without, 'utf-8');
    // Not `not.toContain`: a run that broke for some other reason would satisfy that and
    // say nothing. The clean run is the whole claim.
    expect(ran(TSC, ['-p', 'tsconfig.json'], here).trim()).toBe('');
  });
});

describe('the two entry points that already existed are still the only ones', () => {
  it('adds no script of its own, and sends the existing ones at the new tree', () => {
    const scripts = (
      JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    // A `lint:harness` beside `lint` would be a second answer to "is this repository
    // linted", which is the shape that produces two answers to one question.
    for (const name of Object.keys(scripts)) {
      expect(name, `${name} is a second entry point`).not.toMatch(/harness|ruler/i);
    }
    expect(scripts.typecheck).toBe('tsc -b');
    expect(scripts.lint).toContain('.github/');
    expect(scripts['lint:fix']).toContain('.github/');
  });
});
