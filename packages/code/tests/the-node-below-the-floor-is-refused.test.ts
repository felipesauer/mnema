/**
 * A NODE BELOW THE FLOOR IS REFUSED IN ONE LINE, before anything that needs it is loaded.
 *
 * WHAT WAS WRONG. The package installs on Node 20 with a warning, and then `mnema search` dies with
 * `Segmentation fault` (exit 139, nothing printed): the SQLite addon is built for the ABI of Node 22
 * and later. See `src/node-floor.ts` for the measurement and the mechanism.
 *
 * WHAT IS RUN. The built binary, on this machine's Node, with the version it reports lowered by a
 * preloaded module — so each alternative of the range is asked about the version just under its
 * floor and about the floor itself, the pair that tells the number was read from `engines` and not
 * from somewhere that happens to be near it. Beside it, the shapes of the guard that the binary cannot show: the parse of a range, the
 * sentence, that the declaration is a shape the guard reads (a floor it cannot parse would switch
 * it off without a test noticing), and that it is the FIRST import of `cli.ts`.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
      'mnema needs Node 22.22.2 or a later 22, or 24.15.0 or later; this is Node 20.20.2. Install a newer Node and run it again.\n',
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

  it('refuses before any verb is looked at, `--version` and `--help` included', () => {
    for (const argv of [['--version'], ['--help'], ['init']]) {
      const ran = asIfNode('18.0.0', ...argv);
      expect(ran.status, argv.join(' ')).toBe(1);
      expect(ran.stdout, argv.join(' ')).toBe('');
    }
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
    expect(acceptedBy('^22.22.2 || >=24.15.0')?.map((a) => a.from)).toEqual([
      [22, 22, 2],
      [24, 15, 0],
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
    const range = '^22.22.2 || >=24.15.0';
    expect(floorRefusal('22.22.2', range)).toBeUndefined();
    expect(floorRefusal('22.22.1', range)).toBeDefined();
    expect(floorRefusal('23.11.0', range)).toBeDefined();
    expect(floorRefusal('24.14.0', range)).toBeDefined();
    expect(floorRefusal('24.15.0', range)).toBeUndefined();
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

  it('is the FIRST import of the CLI, so nothing that needs the floor is loaded before it', () => {
    const source = readFileSync(join(PACKAGE, 'src', 'cli.ts'), 'utf-8');
    const imports = [...source.matchAll(/^import\s.*?['"]([^'"]+)['"];?$/gm)].map((m) => m[1]);
    expect(imports[0]).toBe('./node-floor.js');
    // And the guard itself imports nothing that loads a native addon: only `node:fs`.
    const guard = readFileSync(join(PACKAGE, 'src', 'node-floor.ts'), 'utf-8');
    const guardImports = [...guard.matchAll(/^import\s.*?['"]([^'"]+)['"];?$/gm)].map((m) => m[1]);
    expect(guardImports).toEqual(['node:fs']);
  });
});
