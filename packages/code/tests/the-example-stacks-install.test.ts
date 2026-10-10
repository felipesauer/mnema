/**
 * THE EXAMPLE STACKS INSTALL — held on the built binary, in a home that is a sandbox.
 *
 * The stacks this repository ships as examples are installed by `mnema stack add` the way a person
 * installs one: the plan is read, the digest it shows is the digest the index lists, the files are
 * written under the sandbox's home, byte for byte, and the record `mnema verify` reads still
 * passes. Nothing of a stack is run: the folders hold text, and the test reads them.
 *
 * The CI job `the example stacks install` runs this file after a build, with `skills-ref` on the
 * path, and then holds the installed skill folders to the oracle as well.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../../stacks/examples', import.meta.url));
const INDEX = fileURLToPath(new URL('../../../stack-index/index.json', import.meta.url));

const BIN = process.env.SKILLS_REF_BIN ?? 'agentskills';
const oracle = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).status === 0;
const required = process.env.SKILLS_REF_IS_THE_ORACLE === '1';

const listed = new Map(
  (
    JSON.parse(readFileSync(INDEX, 'utf8')) as { stacks: { name: string; digest: string }[] }
  ).stacks.map((e) => [e.name, e.digest]),
);
const names = readdirSync(EXAMPLES).sort();

let sandbox: string;
let home: string;
let project: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-example-stacks-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(home);
  mkdirSync(project);
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: project,
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

describe('the example stacks, installed by the built binary into a sandbox home', () => {
  it('start from a project that has a record', () => {
    expect(mnema('init').status).toBe(0);
  });

  it.each(names)(
    '%s: the plan shows the listed digest, the files land, the record verifies',
    (name) => {
      const source = join(EXAMPLES, name);
      const dry = mnema('stack', 'add', source, '--dry-run');
      expect(dry.status, dry.err).toBe(0);
      const digest = /digest {3}([0-9a-f]{64})/.exec(dry.out)?.[1];
      expect(digest).toBe(listed.get(name));
      expect(dry.out).toContain('Hooks: none.');

      const added = mnema('stack', 'add', source, '--expect', digest as string);
      expect(added.status, added.err).toBe(0);

      for (const skill of readdirSync(join(source, 'skills'))) {
        for (const file of filesUnder(join(source, 'skills', skill))) {
          expect(readFileSync(join(project, '.claude/skills', skill, file))).toEqual(
            readFileSync(join(source, 'skills', skill, file)),
          );
        }
      }
      for (const agent of readdirSync(join(source, 'agents'))) {
        expect(statSync(join(project, '.claude/agents', agent)).isFile()).toBe(true);
      }
      expect(mnema('verify').status).toBe(0);
    },
  );

  it('left nothing in the sandbox home but what the binary keeps for itself', () => {
    const outside = filesUnder(home).filter((p) => !p.startsWith('.mnema/'));
    expect(outside).toEqual([]);
  });

  it.skipIf(!required)('has skills-ref wherever the CI job says it set it up', () => {
    expect(oracle).toBe(true);
  });

  it.skipIf(!oracle)('wrote skill folders that skills-ref takes', () => {
    const installed = readdirSync(join(project, '.claude/skills'));
    expect(installed.length).toBeGreaterThan(0);
    for (const skill of installed) {
      const ran = spawnSync(BIN, ['validate', join(project, '.claude/skills', skill)], {
        encoding: 'utf8',
      });
      expect(ran.status, `${skill}: ${ran.stdout}${ran.stderr}`).toBe(0);
    }
  });

  it('wrote no file a shell could run: none carries an execute bit', () => {
    for (const path of filesUnder(join(project, '.claude'))) {
      expect(statSync(join(project, '.claude', path)).mode & 0o111, path).toBe(0);
    }
  });
});
