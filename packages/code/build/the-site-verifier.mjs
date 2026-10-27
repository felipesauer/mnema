/**
 * Builds the script a generated page runs: `@mnema/chain`'s verifier and the page's own
 * projections, in one file.
 *
 * The chain reads the record through `node:fs` and hashes and verifies through
 * `node:crypto`; a page has neither, so the bundler is told to link those names to the
 * files under `src/site/browser/`: the same verifier code over the files a page carries, with a
 * synchronous SHA-256 and Ed25519. The page also derives its lists again from those files, with
 * `site/model.ts`, which needs two PACKAGE names (not Node modules): `@mnema/core`, linked to
 * `browser-core.mjs`, which re-exports only the pure projections it uses, and `@mnema/context`, linked
 * to the one built module of it the model reads. Nothing else is bundled: the output imports nothing,
 * reaches for no network, and names no `node:` module and no `require(`; the build refuses an output
 * that does.
 *
 * `bundleTheSiteVerifier` is the one place the script is made. The build runs this file to
 * write `dist/site-verifier.js`; the tests call the function and run what it returns.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = new URL('.', import.meta.url);
const browser = (name) => fileURLToPath(new URL(`../src/site/browser/${name}`, here));
const sibling = (path) => fileURLToPath(new URL(path, here));

/** What the bundle refuses to contain: each is a way for a page to carry something it cannot run or cannot hold. */
const HAZARDS = [
  [/<\/script/i, '"</script"', 'which a page cannot carry inline'],
  [/<!--/, '"<!--"', 'which a page cannot carry inline'],
  // A module is named as a quoted string; a property called `node:` (a tree's, in `site/view.ts`) is not one.
  [/["'`]node:[a-z_/]+["'`]/, 'a quoted "node:" module', 'a module of Node, which a page does not have'],
  [/\brequire\(/, '"require("', 'a CommonJS load, which a page does not have'],
];

/**
 * The script as one text. `extra` is for the tests that prove the build refuses what a page cannot
 * carry: `alias` replaces a link (a shim that lacks a name), `banner` puts text before the script.
 * The build itself passes none.
 */
export async function bundleTheSiteVerifier(extra = {}) {
  const built = await build({
    entryPoints: [browser('entry.ts')],
    ...(extra.banner === undefined ? {} : { banner: { js: extra.banner } }),
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
    alias: {
      'node:fs': browser('fs.ts'),
      'node:path': browser('path.ts'),
      'node:crypto': browser('crypto.ts'),
      '@mnema/core': sibling('./browser-core.mjs'),
      '@mnema/context': sibling('../../context/dist/context/decisions.js'),
      ...extra.alias,
    },
    inject: [browser('buffer.ts')],
    // The chain makes a `SharedArrayBuffer` when it loads, for a sleep the verifier never
    // takes. A page that is not cross-origin isolated has none, and loading would stop there.
    // And it names two of its own data files by `import.meta.url`, which a script has no
    // module location to give. They are only ever named, never read, here.
    define: { SharedArrayBuffer: 'ArrayBuffer', 'import.meta.url': '"file:///the-chain/x.js"' },
  });
  const text = built.outputFiles[0].text;
  // The script is written into a page between <script> tags, where either of the first two would end
  // it early or change how the rest is read; the other two are a module the page cannot load. Minified
  // output has none today; this keeps it that way rather than escaping something that should not be there.
  for (const [hazard, name, why] of HAZARDS) {
    if (hazard.test(text)) throw new Error(`the site verifier contains ${name}, ${why}`);
  }
  return text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = fileURLToPath(new URL('../dist/site-verifier.js', here));
  writeFileSync(target, await bundleTheSiteVerifier());
}
