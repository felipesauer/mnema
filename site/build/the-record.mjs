// /record/: the verifier page of THIS repository's record, written by `mnema site` of the binary built from
// the same commit. The site holds no copy of the record and no second reader: the page is what the command
// writes, and the build stops when the record does not verify, so a page that says "this does not verify"
// is never published as the site's own.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The binary runs with nothing of the machine's: a home of its own and the PATH that finds `node`. */
function run(root, cwd, args) {
  const home = mkdtempSync(join(tmpdir(), 'the-site-home-'));
  try {
    return spawnSync(process.execPath, [join(root, 'packages/code/dist/cli.js'), ...args], {
      cwd,
      env: { HOME: home, PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Writes `<out>/index.html` from the record committed under `cwd`, with the binary built under `root`.
 * Throws when `mnema verify` does not pass, or when `mnema site` refuses or says the record does not verify.
 */
export function writeTheRecord({ root, cwd = root, out }) {
  const verify = run(root, cwd, ['verify']);
  if (verify.status !== 0) {
    throw new Error(`the record under ${cwd} does not verify, so /record/ is not written:\n${verify.stdout}${verify.stderr}`);
  }
  mkdirSync(out, { recursive: true });
  const site = run(root, cwd, ['site', '--out', out]);
  if (site.status !== 0 || /does not verify/.test(site.stderr)) {
    throw new Error(`mnema site refused or said the record does not verify:\n${site.stdout}${site.stderr}`);
  }
  return site.stdout;
}
