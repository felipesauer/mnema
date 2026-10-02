/**
 * A NODE BELOW THE FLOOR IS REFUSED IN ONE LINE, before anything that needs it is loaded.
 *
 * WHAT WAS WRONG. The package installs on Node 20 with a warning, and then `mnema search` dies with
 * `Segmentation fault` (exit 139, nothing printed): the SQLite addon is built for the ABI of Node 22
 * and later. See `src/node-floor.ts` for the measurement and the mechanism.
 *
 * WHAT IS RUN. The built binary, on this machine's Node, with the version it reports lowered by a
 * preloaded module — so a floor of `22.12.0` is asked about 22.11.9 and about 22.12.0, the pair
 * that tells the number was read from `engines` and not from somewhere that happens to be near
 * it. Beside it, the shapes of the guard that the binary cannot show: the parse of a range, the
 * sentence, that the declaration is a shape the guard reads (a floor it cannot parse would switch
 * it off without a test noticing), and that it is the FIRST import of `cli.ts`.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declaredRange, floorOf, floorRefusal } from '../src/node-floor.js';

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
      'mnema needs Node 22.12.0 or later; this is Node 20.20.2. Install a newer Node and run it again.\n',
    );
  });

  it('refuses the version just under the declared floor and takes the floor itself', () => {
    const [major, minor, patch] = floorOf(DECLARED) as readonly [number, number, number];
    const under =
      patch > 0
        ? [major, minor, patch - 1]
        : minor > 0
          ? [major, minor - 1, 99]
          : [major - 1, 99, 99];
    const refused = asIfNode(under.join('.'), '--version');
    expect(refused.status, refused.stdout).toBe(1);
    const taken = asIfNode(`${major}.${minor}.${patch}`, '--version');
    expect(taken.stderr).toBe('');
    expect(taken.status).toBe(0);
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
    expect(floorOf('>=22.12.0')).toEqual([22, 12, 0]);
    expect(floorOf('^22.12')).toEqual([22, 12, 0]);
    expect(floorOf('~22')).toEqual([22, 0, 0]);
    expect(floorOf('v20.20.2')).toEqual([20, 20, 2]);
    expect(floorOf('>=22 || >=24')).toBeUndefined();
  });

  it('compares number by number, not as text', () => {
    expect(floorRefusal('22.9.0', '>=22.12.0')).toBeDefined();
    expect(floorRefusal('22.12.0', '>=22.12.0')).toBeUndefined();
    expect(floorRefusal('22.100.0', '>=22.12.0')).toBeUndefined();
    expect(floorRefusal('100.0.0', '>=22.12.0')).toBeUndefined();
  });

  it('does not refuse on a reading it cannot make', () => {
    expect(floorRefusal('20.0.0', 'anything')).toBeUndefined();
    expect(floorRefusal('not a version', '>=22.12.0')).toBeUndefined();
  });

  it('reads the number from the package’s own `engines`, and that is a shape it reads', () => {
    // A floor written as `>=22 || >=24` would pass every case above and switch the guard off.
    expect(declaredRange()).toBe(DECLARED);
    expect(floorOf(DECLARED)).toBeDefined();
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
