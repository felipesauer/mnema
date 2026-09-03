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
 * THIS PARAGRAPH USED TO END "that the two agree is asserted instead, over the manifest
 * itself, in `tests/the-page-follows-the-terminal.test.ts`", AND BOTH HALVES OF THAT WERE
 * FALSE. No file of that name exists in any package of this workspace, and no case anywhere
 * compares this string to the manifest's — the nearest,
 * `tests/the-record-arrives-unasked.test.ts`, asserts only that `manifest.version` is SHAPED
 * like a version. What does pin this value is `cli.help.golden.txt`, which holds the bytes
 * commander prints for `--version`, so a bump here reddens the golden and nothing at all says
 * the manifest disagreed. That the two agree is an INTENTION of this module, not a promise it
 * can point a test at.
 */

/** The version this build of the product reports, wherever it is asked. */
export const VERSION = '0.0.0';
