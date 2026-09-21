/**
 * THE BINARY A PAGE PROMISES IS THE ONE THAT SPEAKS — invoked the way it is installed.
 *
 * WHAT WAS UNCHECKED, AND WHAT IT COST. Three pages published a global install under the
 * sentence "This installs the `mnema` binary", and the binary that install creates printed
 * NOTHING: no output, no stderr, exit 0. The entry block in `src/cli.ts` compared
 * `import.meta.url` against a concatenated `file://${process.argv[1]}`, and that comparison
 * agrees with itself only when the path is spelled identically on both sides. Two ordinary
 * invocations spell it differently, and both were measured on the built binary:
 *
 *   - A SYMLINK. `node_modules/.bin/mnema` is a symlink, which is what `npm i -g`,
 *     `pnpm add -g` and `npx` all create. Node follows it before naming the module, so
 *     `import.meta.url` held the real file and `argv[1]` held the link.
 *   - A PATH THAT NEEDS ESCAPING. `import.meta.url` percent-encodes and the concatenation
 *     does not, so one space or one non-ASCII character in any parent directory was enough,
 *     with no symlink anywhere.
 *
 * WHY TWENTY-ODD SUBPROCESS TESTS DID NOT SEE IT, which is the part worth keeping. Every
 * subprocess invocation in this suite passes the REAL path —
 * `spawnSync(process.execPath, [CLI, …])` — and the real path is the one spelling that
 * worked. `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts` resolves every
 * published `mnema <verb>` against `buildProgram` and says in as many words that "nothing is
 * executed to find out": it answers "does the verb exist?". Nothing answered "does the
 * binary speak?". The path that works had ten witnesses; the path a reader touches had none.
 *
 * SO THIS FILE INVOKES THE BUILT BINARY THE WAY IT IS INSTALLED, and only that. It is not a
 * second reading of what the CLI does — `cli-e2e` and the rest own that. Each case here
 * asks `--version`, because the answer is one short line the product alone can produce, and
 * because a mute process and a working one differ by exactly that line.
 *
 * THE FOURTH CASE IS THE OTHER HALF, and it is why the fix could not simply be "compare
 * less". Over twenty test files import `../src/cli.js` for {@link buildProgram}, and they do
 * it counting on the entry block NOT firing. A fix that made the block eager would not go
 * obviously red — it would go strange, with the CLI running inside the runner. So one case
 * imports the built module from a script that was itself handed `--version`, and asserts the
 * process stays silent: had the block fired, it would have printed a version.
 *
 * WHAT IT DOES NOT CHECK. Windows spellings (`C:\Program Files\`) — the escaping half is
 * exercised by a space and an accent on this platform, and the drive-letter form is not
 * reachable from here. Nor does it install from a registry: the `workspace:*` dependencies
 * of the three internal packages still stop `npm i -g` before the binary is ever reached,
 * which is a separate, measured gap and is why the pages that publish that command now say
 * the package is not published yet.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

/** The built binary — the artifact a global install puts behind `mnema`. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The package's own dependencies, borrowed by the copy that runs from an escaped path. */
const NODE_MODULES = fileURLToPath(new URL('../node_modules', import.meta.url));

/** Where the built tree lives, so a copy of it can be planted somewhere else. */
const DIST = fileURLToPath(new URL('../dist', import.meta.url));

/**
 * Runs a node entry and returns what reached stdout, trimmed.
 *
 * `HOME` and `XDG_DATA_HOME` are the sandbox's own so that nothing here can read or write
 * the machine's record, and stderr is inherited rather than swallowed: a module that fails
 * to load must be loud, because a silent failure is the very defect this file exists for.
 */
function speaks(entry: string, sandbox: string): string {
  return execFileSync(process.execPath, [entry, '--version'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: sandbox,
      XDG_DATA_HOME: join(sandbox, 'data'),
      XDG_CONFIG_HOME: join(sandbox, 'config'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

describe('the binary a page promises is the one that speaks', () => {
  let sandbox: string;

  beforeEach(() => {
    // A6: this measurement creates its own directory and destroys it. Nothing is written to
    // the working tree, and no other job writes here.
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-speaks-'));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('is built, or there is nothing here to invoke', () => {
    // Not ceremony: without this, every case below fails with a module-resolution error and
    // reads like a defect in the product rather than a missing `pnpm build`.
    expect(existsSync(CLI), `${CLI} is missing — run \`pnpm build\` first`).toBe(true);
  });

  it('speaks from its real path', () => {
    // The control. This is the spelling the twenty-odd subprocess tests already use, and it
    // was never broken — it is here so that a failure in the two cases below cannot be
    // mistaken for a broken build or a broken sandbox.
    expect(speaks(CLI, sandbox)).toBe(VERSION);
  });

  it('speaks through a symlink — the shape every global install creates', () => {
    const link = join(sandbox, 'mnema');
    symlinkSync(CLI, link);
    expect(speaks(link, sandbox)).toBe(VERSION);
  });

  it('speaks from a path that needs escaping — a space and an accent, no symlink', () => {
    // The built tree is PLANTED here, not linked to: a link would be followed back to the
    // unescaped path and the case would pass without testing anything. Source maps and
    // declarations are left behind — nothing loads them, and copying them is the bulk of the
    // bytes.
    const home = join(sandbox, 'um diretório com espaço');
    mkdirSync(home);
    cpSync(DIST, join(home, 'dist'), {
      recursive: true,
      filter: (src) => !src.endsWith('.map') && !src.endsWith('.d.ts'),
    });
    symlinkSync(NODE_MODULES, join(home, 'node_modules'), 'dir');
    expect(speaks(join(home, 'dist', 'cli.js'), sandbox)).toBe(VERSION);
  });

  it('stays quiet when imported, even by a process that was handed --version', () => {
    // The other half of the contract, and the one a careless fix breaks. Over twenty test
    // files import `../src/cli.js`; if the entry block fired on import, this script would
    // print a version, because it was given exactly the argument that produces one.
    const importer = join(sandbox, 'importer.mjs');
    writeFileSync(importer, `await import(${JSON.stringify(pathToFileURL(CLI).href)});\n`);
    expect(speaks(importer, sandbox)).toBe('');
  });
});
