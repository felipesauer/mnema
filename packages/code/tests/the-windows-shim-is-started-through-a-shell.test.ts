/**
 * THE `mnema.cmd` THAT NPM WRITES ON WINDOWS IS STARTED THROUGH A SHELL, OR NOT AT ALL.
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

type Target = { program: string; shell: boolean };
const { spawnTarget } = (await import(
  pathToFileURL(join(ROOT, 'plugin', 'hooks', 'hand-over.mjs')).href
)) as { spawnTarget: (program: string, platform?: NodeJS.Platform) => Target };

describe('the program a hook starts', () => {
  it('goes through a shell on Windows, quoted, and nowhere else', () => {
    expect(spawnTarget('mnema.cmd', 'win32')).toEqual({ program: '"mnema.cmd"', shell: true });
    expect(spawnTarget('C:\\Program Files\\mnema\\mnema.cmd', 'win32')).toEqual({
      program: '"C:\\Program Files\\mnema\\mnema.cmd"',
      shell: true,
    });
    for (const platform of ['linux', 'darwin', 'freebsd'] as const) {
      expect(spawnTarget('mnema', platform)).toEqual({ program: 'mnema', shell: false });
    }
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
