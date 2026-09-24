/**
 * A home of its own — the guard every test process runs under catches what it says it catches.
 *
 * `.github/a-home-of-its-own/setup.mjs` points each test process at a `HOME` made for it and stands
 * in front of every process a test starts. A guard of that shape is green by default: take its
 * wrappers away and the suite stays green, because nothing in it happens to start a process in the
 * machine's home today. So this file starts such processes on purpose — one per way a child can
 * end up there — and asserts, for each, that the child saw the test's home instead and that the
 * start was caught. It reads what was caught itself (`takeCaught`), which is why these cases pass
 * where any other case doing the same would fail.
 *
 * And it counts the two things the guard cannot stand in front of, so a limit written in a header
 * is a number here and not a hope.
 */

import { exec, execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  HOME_OF_ITS_OWN,
  reachesTheMachine,
  THE_MACHINES_HOME,
  THE_VARIABLE,
  takeCaught,
} from '../../../.github/a-home-of-its-own/setup.mjs';
import { codeOnly } from './support/reading-source.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const THIS_FILE = 'a-home-of-its-own.test.ts';

/** A child that prints the home it resolves — `os.homedir()`, the product's own fallback. */
const PRINTS_ITS_HOME = ['-e', "process.stdout.write(require('node:os').homedir())"];

/** A child that prints the relocation variable it was handed, or `undefined`. */
const PRINTS_THE_VARIABLE = ['-e', `process.stdout.write(String(process.env.${THE_VARIABLE}))`];

/** The one start the guard caught since the last read, asserted to be exactly one, from here. */
function caughtOnce(): string {
  const caught = takeCaught();
  expect(caught).toHaveLength(1);
  expect(caught[0]).toContain(`${THIS_FILE}:`);
  return caught[0] as string;
}

describe('every test process runs in a home of its own', () => {
  it('is wired to what starts every test file, and the file it names exists', () => {
    const config = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf-8');
    expect(config).toContain("setupFiles: ['./.github/a-home-of-its-own/setup.mjs']");
    expect(statSync(join(ROOT, '.github/a-home-of-its-own/setup.mjs')).isFile()).toBe(true);
  });

  it('points this process at a directory made for it, and hands it no relocation', () => {
    expect(process.env.HOME).toBe(HOME_OF_ITS_OWN);
    expect(HOME_OF_ITS_OWN).not.toBe(THE_MACHINES_HOME);
    expect(HOME_OF_ITS_OWN.startsWith(THE_MACHINES_HOME + sep)).toBe(false);
    expect(process.env[THE_VARIABLE]).toBeUndefined();
  });

  it('gives that home to a child started with no environment of its own, and catches nothing', () => {
    const child = spawnSync(process.execPath, PRINTS_ITS_HOME, { encoding: 'utf-8' });
    expect(child.stdout).toBe(HOME_OF_ITS_OWN);
    expect(takeCaught()).toEqual([]);
  });
});

describe('a child that would resolve the machine’s home starts in the test’s, and is caught', () => {
  it('when its environment carries no HOME — the password database answers, with the machine’s', () => {
    const child = spawnSync(process.execPath, PRINTS_ITS_HOME, {
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(child.stdout).toBe(HOME_OF_ITS_OWN);
    expect(caughtOnce()).toContain('HOME=null');
  });

  it('when its HOME is empty, or relative — neither names a home, so the account’s is used', () => {
    for (const home of ['', 'relative/home']) {
      const child = spawnSync(process.execPath, PRINTS_ITS_HOME, {
        encoding: 'utf-8',
        env: { PATH: process.env.PATH ?? '', HOME: home },
      });
      expect(child.stdout, `HOME=${JSON.stringify(home)}`).toBe(HOME_OF_ITS_OWN);
      expect(caughtOnce()).toContain(`HOME=${JSON.stringify(home)}`);
    }
  });

  it('when its HOME is the machine’s own', () => {
    const child = spawnSync(process.execPath, PRINTS_ITS_HOME, {
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: THE_MACHINES_HOME },
    });
    expect(child.stdout).toBe(HOME_OF_ITS_OWN);
    caughtOnce();
  });

  it('when its relocation points inside the machine’s home — and the child never sees the value', () => {
    const child = spawnSync(process.execPath, PRINTS_THE_VARIABLE, {
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: HOME_OF_ITS_OWN,
        [THE_VARIABLE]: join(THE_MACHINES_HOME, '.mnema'),
      },
    });
    expect(child.stdout).toBe('undefined');
    expect(caughtOnce()).toContain(`${THE_VARIABLE}=`);
  });

  it('through the other ways a process starts — the synchronous file, and a promisified shell', async () => {
    const env = { PATH: process.env.PATH ?? '' };
    expect(execFileSync(process.execPath, PRINTS_ITS_HOME, { encoding: 'utf-8', env })).toBe(
      HOME_OF_ITS_OWN,
    );
    caughtOnce();

    const { stdout } = await promisify(exec)(
      `"${process.execPath}" -e "process.stdout.write(require('node:os').homedir())"`,
      { encoding: 'utf-8', env },
    );
    expect(stdout).toBe(HOME_OF_ITS_OWN);
    expect(caughtOnce()).toContain('(promisified)');
  });
});

describe('the question it asks of an environment', () => {
  it('names the key root this suite was started with, wherever that is', () => {
    const started = '/srv/keys/mnema';
    const env = { HOME: HOME_OF_ITS_OWN, [THE_VARIABLE]: started };
    expect(reachesTheMachine(env, started)).toHaveLength(1);
    expect(reachesTheMachine({ ...env, [THE_VARIABLE]: '/srv/another' }, started)).toEqual([]);
  });

  it('lets a sandbox under the machine’s home through — only the home itself is the machine’s', () => {
    const sandbox = join(THE_MACHINES_HOME, 'somewhere', 'sandbox');
    expect(reachesTheMachine({ HOME: sandbox }, undefined)).toEqual([]);
    expect(reachesTheMachine({ HOME: THE_MACHINES_HOME }, undefined)).toHaveLength(1);
  });
});

describe('what it cannot stand in front of, counted', () => {
  /** Every `.ts` under a package's `src/` and `tests/`, walked on disk — tracked or not. */
  function testSources(): string[] {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) files.push(path);
      }
    };
    for (const pkg of readdirSync(join(ROOT, 'packages'))) {
      for (const part of ['src', 'tests']) {
        try {
          walk(join(ROOT, 'packages', pkg, part));
        } catch {
          // A package without that part has nothing to walk.
        }
      }
    }
    return files.filter((file) => /\.test\.ts$|[\\/]tests[\\/]/.test(file));
  }

  it('walks the test tree it counts over — a count over nothing would read as zero', () => {
    expect(testSources().length).toBeGreaterThan(300);
  });

  it('no test reads the account’s home by hand — the one in-process way past the guard', () => {
    // A CALL, read over the code alone: a sentence that names `userInfo()` — the floor's own
    // declaration of what `env.ts` imports does — reads nothing, and matching it would be the
    // mention taken for the act.
    const readers = testSources()
      .filter((file) => !file.endsWith(THIS_FILE))
      .filter((file) => /\buserInfo\s*\(/.test(codeOnly(readFileSync(file, 'utf-8'))))
      .map((file) => relative(ROOT, file));
    expect(readers).toEqual([]);
  });

  it('no test starts a process with an environment built from nothing — the grandchild it cannot see', () => {
    // Read raw, and on purpose: the thing looked for IS text inside a string — a shell command
    // handed to a process — which a code-only reading would blank.
    const builders = testSources()
      .filter((file) => !file.endsWith(THIS_FILE))
      .filter((file) =>
        /\benv\s+-i\b|['"]env['"]\s*,\s*\[\s*['"]-i['"]/.test(readFileSync(file, 'utf-8')),
      )
      .map((file) => relative(ROOT, file));
    expect(builders).toEqual([]);
  });
});
