/**
 * THE GATE ON WINDOWS: `mnema.cmd` IS STARTED THROUGH A SHELL, AND A PATH IS PLACED BY THE SYSTEM.
 *
 * Node refuses to start a `.cmd` or `.bat` file without a shell (`EINVAL`, since the fix for
 * CVE-2024-27980 in 20.12), and every hook runs `mnema` as a process. Run on a Windows runner, the
 * handlers answered `could not be started (EINVAL)`: the session opened with nothing, and a write
 * under a rule that refuses was refused for a reason that was no rule. The sentence in the page
 * that said it "may not be run at all" was right.
 *
 * What is held here is the choice, which does not need Windows to be observed: for `win32` the
 * program goes to a shell, quoted so that a path with a space in it (a `mnema_path` under
 * `C:\Program Files`) is one word; for every other platform it is started as it always was.
 * That the shell really starts the shim is what the job that runs the installed binary on a
 * Windows runner proves, in `.github/the-other-systems/smoke.mjs`.
 *
 * The other half is that no call is left behind: the hooks files and the two single-file plugins
 * (OpenCode and Gemini) each start `mnema`, and each must ask for the target before it does.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');

type Target = { command: string; args: string[]; shell: boolean };
const { spawnTarget } = (await import(
  pathToFileURL(join(ROOT, 'plugin', 'hooks', 'hand-over.mjs')).href
)) as {
  spawnTarget: (program: string, args: string[], platform?: NodeJS.Platform) => Target;
};

describe('the program a hook starts', () => {
  it('goes through a shell on Windows, as one command line, and nowhere else', () => {
    expect(spawnTarget('mnema.cmd', ['before-a-write', '--host', 'cursor'], 'win32')).toEqual({
      command: '"mnema.cmd" before-a-write --host cursor',
      args: [],
      shell: true,
    });
  });

  it('keeps a path with a space in it as one word on Windows', () => {
    expect(
      spawnTarget('C:\\Program Files\\mnema\\mnema.cmd', ['--tools', 'a b'], 'win32').command,
    ).toBe('"C:\\Program Files\\mnema\\mnema.cmd" --tools "a b"');
  });

  it('starts the program as it always was everywhere else', () => {
    for (const platform of ['linux', 'darwin', 'freebsd'] as const) {
      expect(spawnTarget('mnema', ['--identify'], platform)).toEqual({
        command: 'mnema',
        args: ['--identify'],
        shell: false,
      });
    }
  });
});

describe('the real place of a path is the system own', () => {
  // `fs.realpathSync` is Node's own walk of the path, and it keeps a Windows short name
  // (`RUNNER~1`) and the letter case a person typed; `.native` asks the system, which gives the
  // long name and the case the disk holds. A host may report a project path in either spelling,
  // and a rule is matched against the real one. Linux cannot show the difference, so this holds
  // the choice, and the job that runs on Windows and macOS holds what it buys.
  it('resolves through the native realpath, wherever it resolves a path to place a write', () => {
    const source = readFileSync(join(ROOT, 'packages/code/src/governed-tree.ts'), 'utf-8');
    expect(source.match(/\brealpathSync\(/g) ?? []).toEqual([]);
    expect((source.match(/\brealpathSync\.native\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('every start of mnema from the plugin asks for the target', () => {
  const FILES = [
    'plugin/hooks/hand-over.mjs',
    'plugin/opencode/mnema.js',
    'plugin/gemini/hooks/mnema.mjs',
  ];
  it.each(FILES)('%s starts no mnema without it', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf-8');
    const starts = [...source.matchAll(/spawnSync\(\s*(binaryToRun\(\)|BINARY)\b/g)];
    expect(starts, `${file} starts mnema directly`).toEqual([]);
    expect([...source.matchAll(/spawnTarget\(/g)].length).toBeGreaterThan(1);
  });
});
