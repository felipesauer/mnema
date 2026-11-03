/**
 * THE BUILT-IN INDEX IS THE REPOSITORY'S. `mnema stack index` with no folder reads the index that
 * ships inside the package (`dist/stack-index/`), because in a folder that is not a mnema checkout
 * there is no `stack-index/` to read. The repository's `stack-index/index.json` stays the one file
 * people edit; the build copies it, and the example stacks it lists, into the package.
 *
 * Held on the built output and the built binary:
 * - the built-in `index.json` is the repository's, byte for byte;
 * - every listed folder is in the package, file for file what the repository holds, and the digest
 *   the entry lists is the one `mnema stack add <that folder> --dry-run` shows;
 * - run from a folder that is no checkout, with a home of its own, the binary lists both entries
 *   with folders that exist.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const BUILT = fileURLToPath(new URL('../dist/stack-index/', import.meta.url));

interface Entry {
  name: string;
  digest: string;
  path?: string;
  source?: string;
}
const repoIndex = readFileSync(join(REPO, 'stack-index', 'index.json'));
const listed = (JSON.parse(repoIndex.toString('utf8')) as { stacks: Entry[] }).stacks;

let sandbox: string;
let home: string;
let outside: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-built-in-index-'));
  home = join(sandbox, 'home');
  outside = join(sandbox, 'not-a-checkout');
  mkdirSync(home);
  mkdirSync(outside);
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function mnema(...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: outside,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    },
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

/** Every file under a folder, as relative paths. */
function filesUnder(root: string, at = ''): string[] {
  return readdirSync(join(root, at), { withFileTypes: true }).flatMap((entry) => {
    const rel = at === '' ? entry.name : `${at}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(root, rel) : [rel];
  });
}

describe('the index that ships inside the package', () => {
  it('is the repository index, byte for byte', () => {
    expect(readFileSync(join(BUILT, 'index.json'))).toEqual(repoIndex);
  });

  it('lists at least the two example stacks, each with a folder', () => {
    expect(listed.map((e) => e.name)).toEqual(
      expect.arrayContaining(['evidence-first', 'review-pass']),
    );
    expect(listed.every((e) => typeof e.path === 'string')).toBe(true);
  });

  it.each(listed.map((e) => [e.name, e] as const))(
    '%s: its folder is in the package, file for file the repository folder',
    (_, entry) => {
      const inPackage = join(BUILT, entry.path as string);
      const inRepo = join(REPO, entry.path as string);
      expect(filesUnder(inPackage).sort()).toEqual(filesUnder(inRepo).sort());
      for (const file of filesUnder(inRepo)) {
        expect(readFileSync(join(inPackage, file))).toEqual(readFileSync(join(inRepo, file)));
      }
    },
  );
});

describe('the built binary, run from a folder that is no checkout', () => {
  it('starts from a folder with a record of its own', () => {
    expect(existsSync(join(outside, 'stack-index'))).toBe(false);
    expect(mnema('init').status).toBe(0);
  });

  it('lists the built-in entries with folders that exist', () => {
    const ran = mnema('stack', 'index', '--json');
    expect(ran.status, ran.err).toBe(0);
    const shown = (JSON.parse(ran.out) as { stacks: Entry[] }).stacks;
    expect(shown.map((e) => e.name)).toEqual(listed.map((e) => e.name));
    for (const entry of shown) {
      expect(entry.source).toBe(join(BUILT, listed.find((e) => e.name === entry.name)?.path ?? ''));
      expect(existsSync(join(entry.source as string, 'stack.json'))).toBe(true);
    }
  });

  it.each(listed.map((e) => [e.name, e.digest] as const))(
    '%s: the plan for the entry folder shows the digest the index lists',
    (name, digest) => {
      const shown = (JSON.parse(mnema('stack', 'index', '--json').out) as { stacks: Entry[] })
        .stacks;
      const source = shown.find((e) => e.name === name)?.source as string;
      const dry = mnema('stack', 'add', source, '--dry-run');
      expect(dry.status, dry.err).toBe(0);
      expect(/digest {3}([0-9a-f]{64})/.exec(dry.out)?.[1]).toBe(digest);
    },
  );

  it('prints the entries, the folders and what being listed does not prove', () => {
    const ran = mnema('stack', 'index');
    expect(ran.status, ran.err).toBe(0);
    expect(ran.out).toContain('evidence-first 1.0.0');
    expect(ran.out).toContain(`folder  ${join(BUILT, 'packages/stacks/examples/evidence-first')}`);
    expect(ran.out).toContain('Being listed does not make a stack safe');
  });

  it('refuses a folder with no index.json, and says what an index is and what no folder reads', () => {
    const ran = mnema('stack', 'index', 'nowhere');
    expect(ran.status).not.toBe(0);
    expect(ran.err.trim()).toBe(
      'Refused (STACK_INDEX_REFUSED): there is no index.json in "nowhere". An index is a folder holding an index.json that lists stacks: for each, a name, a version, a link and a digest. With no folder given, the index that comes with this installation is read.',
    );
  });
});
