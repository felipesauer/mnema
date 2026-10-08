/**
 * A NODE BELOW THE FLOOR IS REFUSED IN ONE LINE, before anything that needs it is loaded.
 *
 * WHAT WAS WRONG. The package installs on a Node below its floor with a warning, and then the first
 * import that needs a newer runtime dies with a stack trace instead of a sentence. See
 * `src/node-floor.ts` for the mechanism.
 *
 * WHAT IS RUN. The built binary, on this machine's Node, with the version it reports lowered by a
 * preloaded module — so each alternative of the range is asked about the version just under its
 * floor and about the floor itself, the pair that tells the number was read from `engines` and not
 * from somewhere that happens to be near it. Beside it, the shapes of the guard that the binary cannot show: the parse of a range, the
 * sentence, that the declaration is a shape the guard reads (a floor it cannot parse would switch
 * it off without a test noticing), and that the entry (`cli.ts`) loads the program only past it.
 *
 * WHAT THIS CANNOT SHOW, AND WHO DOES. A lowered version on a Node that HAS `node:sqlite` was blind
 * to the defect: the guard was the first import, and the module graph was linked before it ran, so
 * a real old Node threw out of the link. The case below that takes the module away with
 * `--no-experimental-sqlite` is the same Node without the builtin; the real ones (a 22.12 and a
 * 24.14) run in the `the binary refuses an old Node` job of the CI workflow.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invokedAsTheBinary } from '../src/cli.js';
import { acceptedBy, declaredRange, floorRefusal } from '../src/node-floor.js';

const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
const BINARY = join(PACKAGE, 'dist', 'cli.js');
const DECLARED = (
  JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf-8')) as {
    engines: { node: string };
  }
).engines.node;

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-floor-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Runs the built binary as if the Node under it were `version`. */
function asIfNode(version: string, ...argv: string[]) {
  const preload = join(sandbox, `as-${version}.mjs`);
  writeFileSync(
    preload,
    `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)}, configurable: true });\n`,
  );
  return spawnSync(process.execPath, ['--import', preload, BINARY, ...argv], {
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: join(sandbox, 'home') },
  });
}

describe('the built binary, under a Node below the floor', () => {
  it('says one line on stderr, writes nothing to stdout, and exits 1', () => {
    const ran = asIfNode('20.20.2', 'search', 'anything');
    expect(ran.status).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toBe(
      'mnema needs Node 24.15.0 or a later 24, or 26.0.0 or later; this is Node 20.20.2. Install a newer Node and run it again.\n',
    );
  });

  it('refuses the version just under each declared floor and takes each floor itself', () => {
    const accepted = acceptedBy(DECLARED) ?? [];
    expect(accepted.length).toBeGreaterThan(0);
    for (const { from } of accepted) {
      const [major, minor, patch] = from;
      const under =
        patch > 0
          ? [major, minor, patch - 1]
          : minor > 0
            ? [major, minor - 1, 99]
            : [major - 1, 99, 99];
      const refused = asIfNode(under.join('.'), '--version');
      expect(refused.status, under.join('.')).toBe(1);
      const taken = asIfNode(from.join('.'), '--version');
      expect(taken.stderr).toBe('');
      expect(taken.status).toBe(0);
    }
  });

  it('says the sentence, and not a stack trace, on a Node that has no node:sqlite at all', () => {
    // The Node a person on 20 or on a 22 before 22.13 has: the builtin is not there to be linked.
    // This is the case the lowered version above could not reach, because the Node under it had
    // the module and so the link never failed.
    const preload = join(sandbox, 'as-20.20.2-without-sqlite.mjs');
    writeFileSync(
      preload,
      "Object.defineProperty(process.versions, 'node', { value: '20.20.2', configurable: true });\n",
    );
    const ran = spawnSync(
      process.execPath,
      ['--no-experimental-sqlite', '--import', preload, BINARY, '--version'],
      { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '', HOME: join(sandbox, 'home') } },
    );
    expect(ran.status).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toBe(
      'mnema needs Node 24.15.0 or a later 24, or 26.0.0 or later; this is Node 20.20.2. Install a newer Node and run it again.\n',
    );
  });

  it('refuses before any verb is looked at, `--version` and `--help` included', () => {
    for (const argv of [['--version'], ['--help'], ['init']]) {
      const ran = asIfNode('18.0.0', ...argv);
      expect(ran.status, argv.join(' ')).toBe(1);
      expect(ran.stdout, argv.join(' ')).toBe('');
    }
  });
});

describe('the entry decides whether it is the binary', () => {
  it('is the binary when argv names it, and not when something else does or nothing', () => {
    const here = pathToFileURL(BINARY).href;
    expect(invokedAsTheBinary(here, BINARY)).toBe(true);
    expect(invokedAsTheBinary(here, join(PACKAGE, 'dist', 'program.js'))).toBe(false);
    expect(invokedAsTheBinary(here, undefined)).toBe(false);
    // A path with nothing behind it is a file that is not this one, not an exception.
    expect(invokedAsTheBinary(here, join(sandbox, 'no-such-file.js'))).toBe(false);
  });

  it('is the binary through a symlink to it', () => {
    const link = join(sandbox, 'mnema');
    symlinkSync(BINARY, link);
    expect(invokedAsTheBinary(pathToFileURL(BINARY).href, link)).toBe(true);
  });
});

describe('the guard’s parts', () => {
  it('reads the floor of the shapes `engines` is written in', () => {
    expect(acceptedBy('>=22.12.0')).toEqual([{ from: [22, 12, 0], said: '22.12.0 or later' }]);
    expect(acceptedBy('^22.12')).toEqual([
      { from: [22, 12, 0], before: [23, 0, 0], said: '22.12.0 or a later 22' },
    ]);
    expect(acceptedBy('~22')?.[0]?.before).toEqual([22, 1, 0]);
    expect(acceptedBy('v20.20.2')?.[0]?.from).toEqual([20, 20, 2]);
    expect(acceptedBy('^24.15.0 || >=26.0.0')?.map((a) => a.from)).toEqual([
      [24, 15, 0],
      [26, 0, 0],
    ]);
    expect(acceptedBy('>22 || >=24')).toBeUndefined();
  });

  it('compares number by number, not as text', () => {
    expect(floorRefusal('22.9.0', '>=22.12.0')).toBeDefined();
    expect(floorRefusal('22.12.0', '>=22.12.0')).toBeUndefined();
    expect(floorRefusal('22.100.0', '>=22.12.0')).toBeUndefined();
    expect(floorRefusal('100.0.0', '>=22.12.0')).toBeUndefined();
  });

  it('takes a Node only inside an alternative, so the gap between two of them is refused', () => {
    const range = '^24.15.0 || >=26.0.0';
    // The last 22 and the 22 a runner image still ships: both are below the floor now.
    expect(floorRefusal('22.22.2', range)).toBeDefined();
    expect(floorRefusal('22.23.3', range)).toBeDefined();
    expect(floorRefusal('23.11.0', range)).toBeDefined();
    expect(floorRefusal('24.14.0', range)).toBeDefined();
    expect(floorRefusal('24.15.0', range)).toBeUndefined();
    expect(floorRefusal('24.99.0', range)).toBeUndefined();
    expect(floorRefusal('25.9.0', range)).toBeDefined();
    expect(floorRefusal('26.0.0', range)).toBeUndefined();
  });

  it('does not refuse on a reading it cannot make', () => {
    expect(floorRefusal('20.0.0', 'anything')).toBeUndefined();
    expect(floorRefusal('not a version', '>=22.12.0')).toBeUndefined();
    // A running version written as a range is no version either, even one below the floor.
    expect(floorRefusal('^20.0.0', '>=22.12.0')).toBeUndefined();
    expect(floorRefusal('>=20', '>=22.12.0')).toBeUndefined();
    // A version short of its minor and patch reads them as zero, and is refused below the floor.
    expect(floorRefusal('22', '>=22.12.0')).toBeDefined();
  });

  it('reads the number from the package’s own `engines`, and that is a shape it reads', () => {
    // A floor written as `>22 || >=24` would pass every case above and switch the guard off.
    expect(declaredRange()).toBe(DECLARED);
    expect(acceptedBy(DECLARED)).toBeDefined();
  });

  it('is the FIRST import of the entry, and the entry links nothing a Node below the floor lacks', () => {
    const source = readFileSync(join(PACKAGE, 'src', 'cli.ts'), 'utf-8');
    const imports = [...source.matchAll(/^import\s.*?['"]([^'"]+)['"];?$/gm)].map((m) => m[1]);
    expect(imports[0]).toBe('./node-floor.js');
    // The module graph is linked BEFORE the first line runs, so a static import of the program
    // (which reaches `node:sqlite`) is a traceback on a Node without it, whatever its order.
    // Everything the entry links is a builtin every Node has, or the guard itself.
    expect([...imports].sort()).toEqual(['./node-floor.js', 'node:fs', 'node:url']);
    // The program arrives through a dynamic import, past the guard.
    expect(source).toMatch(/import\('\.\/program\.js'\)/);
    // And the guard itself imports nothing that needs a newer Node: only `node:fs`.
    const guard = readFileSync(join(PACKAGE, 'src', 'node-floor.ts'), 'utf-8');
    const guardImports = [...guard.matchAll(/^import\s.*?['"]([^'"]+)['"];?$/gm)].map((m) => m[1]);
    expect(guardImports).toEqual(['node:fs']);
  });
});
