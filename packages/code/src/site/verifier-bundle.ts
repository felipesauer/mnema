/**
 * The script a generated page runs, as the build left it.
 *
 * `build/the-site-verifier.mjs` writes `dist/site-verifier.js` after the compiler runs. This
 * module sits two directories below the package root whether it is the source or its compiled
 * copy, so one relative path finds the file from either — and a missing file says what to run
 * instead of writing a page that cannot verify anything.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUNDLE = fileURLToPath(new URL('../../dist/site-verifier.js', import.meta.url));

/** The verifier script's text. */
export function theSiteVerifier(): string {
  try {
    return readFileSync(BUNDLE, 'utf-8');
  } catch {
    throw new Error(`the site verifier is not built (${BUNDLE}) — run \`pnpm build\``);
  }
}
