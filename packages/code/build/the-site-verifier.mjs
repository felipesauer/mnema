/**
 * Builds the script a generated page runs: `@mnema/chain`'s verifier, in one file.
 *
 * The chain reads the record through `node:fs` and hashes and verifies through
 * `node:crypto`; a page has neither, so the bundler is told to link those names to the
 * files under `src/site/browser/` — the same verifier code over the files a page carries, with a
 * synchronous SHA-256 and Ed25519. Nothing else is bundled: the output imports nothing and
 * reaches for no network.
 *
 * `bundleTheSiteVerifier` is the one place the script is made. The build runs this file to
 * write `dist/site-verifier.js`; the tests call the function and run what it returns.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = new URL('.', import.meta.url);
const browser = (name) => fileURLToPath(new URL(`../src/site/browser/${name}`, here));

/** The verifier as one script's text. */
export async function bundleTheSiteVerifier() {
  const built = await build({
    entryPoints: [browser('entry.ts')],
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
    },
    inject: [browser('buffer.ts')],
  });
  const text = built.outputFiles[0].text;
  // The script is written into a page between <script> tags, where either of these would end
  // it early or change how the rest is read. Minified output has neither today; this keeps
  // it that way rather than escaping something that should not be there.
  for (const hazard of ['</script', '<!--']) {
    if (text.toLowerCase().includes(hazard)) {
      throw new Error(`the site verifier contains "${hazard}", which a page cannot carry inline`);
    }
  }
  return text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = fileURLToPath(new URL('../dist/site-verifier.js', here));
  writeFileSync(target, await bundleTheSiteVerifier());
}
