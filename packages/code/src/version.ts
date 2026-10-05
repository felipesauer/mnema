/**
 * WHICH VERSION OF THIS PRODUCT THIS IS — one string, and every surface says the same one.
 *
 * It was typed twice: once for the flag that prints it (`cli.ts`) and once for the
 * handshake an MCP client reads (`mcp/server.ts`). Two literals is two answers the day one
 * of them is bumped and the other is not, and nothing would have said so — a client would
 * have been told one number while the caller at a shell was told another.
 *
 * A THIRD SURFACE IS WHAT FORCED IT. The console's opening box carries the version on its
 * title, the way the reference it was drawn from does, and a third copy is where a
 * duplication stops being tolerable. So the string lives here, and the three read it.
 *
 * IT IS A CONSTANT AND NOT A READ OF THE MANIFEST, deliberately. `package.json` is the
 * packaging fact and this is what the program says about itself; reading the file at
 * startup would put a filesystem call in the floor of every invocation — the closure a
 * `mnema --version` pays for is measured and guarded
 * (`tests/the-floor-is-the-declaration.test.ts`).
 *
 * THAT THE MANIFEST AGREES IS NOW A PROMISE, AND IT WAS NOT WHEN THIS FILE WAS WRITTEN.
 * This paragraph said the agreement was "an INTENTION of this module, not a promise it can
 * point a test at" — true when the workspace published one package, and no longer true.
 * `tests/the-version-is-one-number.test.ts` reads every tracked `package.json` and
 * `plugin.json` off the disk together with this constant and requires one number across all
 * of them; the list is git's rather than typed, so a package added tomorrow is held to it
 * without anybody remembering. `cli.help.golden.txt` still pins the bytes commander prints
 * for `--version`, and it is the ONE site where the number is written as a literal — which is
 * what makes a bump here a deliberate two-line change rather than a drift.
 *
 * WHAT FALSIFIED THE OLD PARAGRAPH was four packages going to the registry at once: a
 * constant that disagreed with the manifest used to mean one wrong line in `--version`, and
 * now it means the npm page and the binary state different versions of the same release.
 */

/** The version this build of the product reports, wherever it is asked. */
export const VERSION = '0.1.0-beta';

/**
 * The name this product answers `mnema --identify` with, before its version — the package it is
 * installed as.
 *
 * WHY A PROGRAM NEEDS TO SAY WHICH ONE IT IS. The plugin runs whatever `mnema` the PATH finds
 * first, and a program of the same name placed earlier is run in its stead: measured with
 * Claude Code 2.1.281, the host started such a program at all three points the plugin declares
 * (`brief --hook`, `recall --hook`, `mcp`), the session opened without the record, and nothing
 * said so. The version alone does not tell a program apart — any tool prints a number — so the
 * answer carries the name as well, and the name is the package's: a scoped name on the registry
 * belongs to one publisher. `plugin/hooks/hand-over.mjs` asks before it runs a verb, and
 * `the-record-arrives-unasked.test.ts` holds that this answer and the plugin's expectation agree
 * and that a program which answers otherwise is named to the session instead of being run.
 */
export const PRODUCT_NAME = '@mnema/code';

/** The whole answer to `mnema --identify`: the name, then the version. */
export const IDENTITY = `${PRODUCT_NAME} ${VERSION}`;
