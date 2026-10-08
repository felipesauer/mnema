#!/usr/bin/env node
/**
 * The `mnema` binary: the Node it runs on is checked, and only then is the program loaded.
 *
 * WHY THE PROGRAM IS NOT IMPORTED HERE. An ES module is linked before it is evaluated: every
 * static import below this line is resolved first, the whole graph of them, and the first line
 * of the first module runs only when that is done. The program (`program.ts`) reaches
 * `node:sqlite` through `@mnema/core`, a builtin that does not exist in a Node below 22.5 and
 * that needs a flag until 22.13, and that prints an `ExperimentalWarning` in a 24 before 24.15 (measured on 24.14.0).
 * So a guard written as the first import of the program spoke after the thing it was guarding
 * against: the old Node threw `ERR_UNKNOWN_BUILTIN_MODULE` out of the link, and the sentence
 * never came. The program is therefore loaded by a dynamic `import()` that is reached only past
 * the guard, and this file imports nothing but `node:fs` and `node:url` (and `node-floor.ts`,
 * which imports `node:fs`), which every Node a person can have carries.
 * The CI job `the binary refuses an old Node` (`.github/the-binary-runs/it-refuses-an-old-node.sh`)
 * holds it on real Nodes, and `tests/the-node-below-the-floor-is-refused.test.ts` holds it here.
 *
 * The program is a module of its own so a test can build it without running it; this file is
 * the one that runs.
 */

// The guard: below the Node floor this says so and exits 1, before the line that loads the program.
import './node-floor.js';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Whether this module is the file the process was told to run (the binary, as opposed to something importing it).
 *
 * WHAT THIS REPLACED, AND WHAT IT COST. The comparison here used to be
 * ``import.meta.url === `file://${process.argv[1]}` `` — a concatenation, against a URL.
 * It agreed with itself only when the path was spelled the same on both sides, and there
 * are two ordinary ways for it not to be. Both were measured on the built binary, and both
 * were SILENT: no output, no stderr, exit 0.
 *
 *   - THE SYMLINK. Node resolves a symlink before it names the module, so `import.meta.url`
 *     is the real file while `process.argv[1]` is the link that was typed. Every
 *     `npm i -g`, `pnpm add -g` and `npx` runs the binary through `node_modules/.bin/mnema`,
 *     which IS a symlink — so the published install was the one invocation that could not
 *     speak, and three pages said otherwise.
 *   - THE PATH THAT NEEDS ESCAPING. `import.meta.url` percent-encodes; concatenating
 *     `file://` does not. A space or a non-ASCII character in any parent directory —
 *     `/home/João/`, `C:\Program Files\` — was enough, with no symlink anywhere.
 *
 * So both sides are brought to one spelling: the path is followed to what is actually on
 * disk, and turned into a URL by the function that does the escaping.
 *
 * WHY THE FAILURE IS SWALLOWED. `realpathSync` THROWS when the path is not there, and a
 * throw at module scope is worse than a mute binary: a test that imports this
 * module (`tests/the-node-below-the-floor-is-refused.test.ts` does, for this very function)
 * counts on this block to stay quiet. The
 * answer for a path with nothing behind it is the honest one anyway — a file that is not on
 * disk is not the file this module is — so it is `false`, not an exception. Same shape as
 * `identityOf` in `commands/verify.ts`, and the same reason.
 *
 * Proved by `tests/the-binary-a-page-promises-is-the-one-that-speaks.test.ts`, which runs
 * the BUILT binary through a symlink and from a directory whose name carries a space and an
 * accent — the two spellings the old comparison lost — and asserts it stays quiet under
 * import.
 */
export function invokedAsTheBinary(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync.native(argv1)).href;
  } catch {
    return false;
  }
}

// Auto-run when invoked as the binary (not when something imports this file).
if (invokedAsTheBinary(import.meta.url, process.argv[1])) {
  void import('./program.js').then(({ runAsTheBinary }) => {
    runAsTheBinary();
  });
}
