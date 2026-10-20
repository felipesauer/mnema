// @reads-the-tree
/**
 * `.github/release-prepare/prepare.mjs` (`pnpm release:prepare`) WRITES THE ONE NUMBER IN EVERY
 * PLACE THE WORKSPACE SPELLS IT, AND CUTS THE CHANGELOG.
 *
 * WHAT IS RUN. The script itself, as a subprocess, in a throwaway git repository that holds a
 * COPY of every manifest the real workspace tracks (found here by file name, not by asking the
 * script), the three source spellings, and a small CHANGELOG. A manifest that the script's own
 * finder cannot see is therefore still in the copy, and still has to come out with the new
 * number: that is the Nth+1 manifest, the one a typed list would miss. A second manifest is added
 * under a path no one has written down.
 *
 * WHAT IT DOES NOT COVER. Remaking `recordings/console.cast` and the GIF: that needs the built
 * binary, a pseudo-terminal and `agg`, so the fixture has no cast and the script skips it.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(ROOT, '.github/release-prepare/prepare.mjs');
const VERSION_TS = 'packages/code/src/version.ts';
const READER_TS = 'packages/chain/src/version.ts';
const GOLDEN = 'packages/code/src/cli.help.golden.txt';
const SOURCES = [VERSION_TS, READER_TS, GOLDEN];
/**
 * THE NUMBERS ARE DERIVED FROM THE ONE THE PRODUCT IS AT, never typed: a test file that spelled
 * the current number would be accused by `the-version-is-one-number.test.ts` on the day it is
 * bumped. `TARGET` is a number the fixture is moved to; `NEXT_MINOR` and `NEXT_PATCH` are what
 * the changelog asks for.
 */
const [MAJOR = 0, MINOR = 0, PATCH = 0] = VERSION.split('.').map(Number);
const TARGET = `${MAJOR}.${MINOR + 2}.0`;
const NEXT_MINOR = `${MAJOR}.${MINOR + 1}.0`;
const NEXT_PATCH = `${MAJOR}.${MINOR}.${PATCH + 1}`;
const NAMES = new Set(['package.json', 'plugin.json', 'gemini-extension.json']);

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- A thing.

### Fixed

- Another.

## [0.2.0-beta] - 2026-10-11

### Added

- Old.

[Unreleased]: https://github.com/felipesauer/mnema/commits/main
[0.2.0-beta]: https://github.com/felipesauer/mnema/tree/abc
`;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' });

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repository with a copy of the real manifests and sources, committed. */
function fixture(changelog = CHANGELOG): { dir: string; manifests: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'release-prepare-'));
  made.push(dir);
  git(dir, 'init', '-q');
  const manifests = git(ROOT, 'ls-files', '-z')
    .split('\0')
    .filter((where) => NAMES.has(basename(where)))
    .filter(
      (where) => typeof JSON.parse(readFileSync(join(ROOT, where), 'utf-8')).version === 'string',
    );
  for (const where of [...manifests, ...SOURCES]) {
    mkdirSync(dirname(join(dir, where)), { recursive: true });
    cpSync(join(ROOT, where), join(dir, where));
  }
  // A manifest at a path nothing here names.
  const extra = 'packages/zz-new/package.json';
  mkdirSync(join(dir, 'packages/zz-new'), { recursive: true });
  writeFileSync(join(dir, extra), `{\n  "name": "zz-new",\n  "version": "${VERSION}"\n}\n`);
  manifests.push(extra);
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  git(dir, 'add', '.');
  return { dir, manifests };
}

const run = (dir: string, ...args: string[]) => {
  try {
    return {
      code: 0,
      out: execFileSync('node', [SCRIPT, ...args], { cwd: dir, encoding: 'utf-8' }),
    };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: e.stdout + e.stderr };
  }
};

describe('release:prepare with a number', () => {
  it('writes the number into every manifest, the two sources and the golden, and cuts the changelog', () => {
    const { dir, manifests } = fixture();
    expect(manifests.length).toBeGreaterThan(10);
    const { code } = run(dir, TARGET, '--date', '2030-01-02');
    expect(code).toBe(0);

    const stale = manifests.filter(
      (where) => JSON.parse(readFileSync(join(dir, where), 'utf-8')).version !== TARGET,
    );
    expect(stale).toEqual([]);
    expect(readFileSync(join(dir, VERSION_TS), 'utf-8')).toContain(`VERSION = '${TARGET}'`);
    expect(readFileSync(join(dir, READER_TS), 'utf-8')).toContain(`READER_VERSION = '${TARGET}'`);
    expect(readFileSync(join(dir, GOLDEN), 'utf-8')).toContain(`$ mnema --version\n| ${TARGET}\n`);

    const log = readFileSync(join(dir, 'CHANGELOG.md'), 'utf-8');
    expect(log).toContain(`## [Unreleased]\n\n## [${TARGET}] - 2030-01-02\n\n### Added`);
    expect(log).toContain(
      '[Unreleased]: https://github.com/felipesauer/mnema/commits/main\n' +
        `[${TARGET}]: https://github.com/felipesauer/mnema/releases/tag/v${TARGET}\n`,
    );
    expect(log).toContain(
      '## [0.2.0-beta] - 2026-10-11, a pre-release withdrawn, from before this line',
    );
  });

  it('leaves nothing for a second run, and --check says so', () => {
    const { dir } = fixture();
    run(dir, TARGET, '--date', '2030-01-02');
    const again = run(dir, TARGET, '--check', '--date', '2030-01-02');
    expect(again.code).toBe(0);
    expect(again.out).toContain('nothing to change');
  });
});

describe('release:prepare --check', () => {
  it('exits 1 and changes nothing when something would change', () => {
    const { dir } = fixture();
    const before = git(dir, 'status', '--porcelain');
    const { code, out } = run(dir, TARGET, '--check', '--date', '2030-01-02');
    expect(code).toBe(1);
    expect(out).toContain('would write CHANGELOG.md');
    expect(out).toContain('would write packages/zz-new/package.json');
    expect(git(dir, 'status', '--porcelain')).toBe(before);
    expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf-8')).toBe(CHANGELOG);
  });
});

describe('release:prepare without a number', () => {
  it('proposes a minor when Unreleased has Added, and says why', () => {
    const { dir } = fixture();
    const { code, out } = run(dir, '--check');
    expect(code).toBe(1);
    expect(out).toContain(`proposed ${NEXT_MINOR} (minor: Unreleased has Added)`);
  });

  it('proposes a patch when Unreleased has only Fixed', () => {
    const { dir } = fixture(CHANGELOG.replace('### Added\n\n- A thing.\n\n', ''));
    const { out } = run(dir, '--check');
    expect(out).toContain(`proposed ${NEXT_PATCH} (patch: Unreleased has only Fixed)`);
  });

  it('refuses an empty Unreleased', () => {
    const { dir } = fixture('# Changelog\n\n## [Unreleased]\n\n## [0.2.0-beta] - 2026-10-11\n');
    const { code, out } = run(dir, '--check');
    expect(code).not.toBe(0);
    expect(out).toContain('nothing to release');
  });
});
