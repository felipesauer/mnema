// /record/: the verifier page of THIS repository's record, written by `mnema site` of the binary built from
// the same commit. The site holds no copy of the record and no second reader: the page is what the command
// writes (with the head the build hands it through `--head`: the binary's own title is the same for every record, and
// a search engine reads this site's copy), and the build stops when the record does not verify, so a page that says "this does not verify"
// is never published as the site's own.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
 * What `command` (a line of the README that starts with `mnema`) prints on the record COMMITTED at `sha`, and only
 * on the public tree: `.mnema/` is extracted from the commit into a directory of its own outside the repository, and
 * the binary built under `root` runs there with a home of its own. The working tree of the checkout is never read, so
 * a file changed and not committed, and the private tree of whoever builds, are not in the verdict. Throws when the
 * command does not pass; returns what it printed, byte for byte.
 * @param {{ root: string, repo?: string, sha: string, command: string }} options
 */
export function theVerdictOfTheCommit({ root, repo = root, sha, command }) {
  const [program, ...args] = command.trim().split(/\s+/);
  if (program !== 'mnema') throw new Error(`the verdict is of a command of mnema, and "${command}" is not one`);
  const dir = mkdtempSync(join(tmpdir(), 'the-verdict-of-the-commit-'));
  try {
    const tar = join(dir, 'record.tar');
    const archived = spawnSync('git', ['archive', '--format=tar', '-o', tar, sha, '.mnema'], { cwd: repo, encoding: 'utf8' });
    if (archived.status !== 0) throw new Error(`the record of ${sha} could not be extracted:\n${archived.stderr}`);
    const tree = join(dir, 'tree');
    mkdirSync(tree);
    const unpacked = spawnSync('tar', ['-xf', tar, '-C', tree], { encoding: 'utf8' });
    if (unpacked.status !== 0) throw new Error(`the record of ${sha} could not be unpacked:\n${unpacked.stderr}`);
    const init = spawnSync('git', ['init', '-q', tree], { encoding: 'utf8' });
    if (init.status !== 0) throw new Error(`a directory for the record of ${sha} could not be made:\n${init.stderr}`);
    const said = run(root, tree, args);
    if (said.status !== 0) {
      throw new Error(`the record at ${sha} does not verify, so its verdict is not shown:\n${said.stdout}${said.stderr}`);
    }
    return said.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Writes `<out>/index.html` from the record committed under `cwd`, with the binary built under `root`.
 * With `backLink` the page carries one link back to the site (`mnema site --back-link`); with `head` (an object:
 * title, description, canonical, structuredData) it says what it is to a search engine (`mnema site --head`, handed a file).
 * Throws when `mnema verify` does not pass, or when `mnema site` refuses or says the record does not verify.
 * @param {{ root: string, cwd?: string, out: string, backLink?: string, head?: object }} options
 */
export function writeTheRecord({ root, cwd = root, out, backLink, head }) {
  const verify = run(root, cwd, ['verify']);
  if (verify.status !== 0) {
    throw new Error(`the record under ${cwd} does not verify, so /record/ is not written:\n${verify.stdout}${verify.stderr}`);
  }
  mkdirSync(out, { recursive: true });
  const headDir = mkdtempSync(join(tmpdir(), 'the-site-head-'));
  let site;
  try {
    const headFile = join(headDir, 'head.json');
    if (head !== undefined) writeFileSync(headFile, JSON.stringify(head));
    site = run(root, cwd, [
      'site',
      '--out',
      out,
      ...(backLink === undefined ? [] : ['--back-link', backLink]),
      ...(head === undefined ? [] : ['--head', headFile]),
    ]);
  } finally {
    rmSync(headDir, { recursive: true, force: true });
  }
  if (site.status !== 0 || /does not verify/.test(site.stderr)) {
    throw new Error(`mnema site refused or said the record does not verify:\n${site.stdout}${site.stderr}`);
  }
  return site.stdout;
}
