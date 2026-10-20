// Prepares a release: writes ONE version number everywhere the workspace spells it, and cuts the
// CHANGELOG. `pnpm release:prepare [x.y.z] [--check] [--date YYYY-MM-DD]`.
//
// Without a number it takes the current one from the root `package.json` and proposes the next
// from the `## [Unreleased]` section (anything under Added, Changed or Removed is a minor; only
// Fixed, or anything else, is a patch; in 0.x a breaking change is a minor too), prints why, and
// applies it. With a number it applies that one. `--check` changes nothing: it lists what would
// change and exits 1 if anything would, 0 if the tree is already as the release would leave it.
//
// WHERE THE NUMBER LIVES is asked of git, never typed here: every tracked `package.json`,
// `plugin.json` and `gemini-extension.json` that declares a top-level `version`, found the way
// `packages/code/tests/the-version-is-one-number.test.ts` finds them, plus the three places that
// spell it in source: `packages/code/src/version.ts`, `packages/chain/src/version.ts` and the
// `--version` line of `packages/code/src/cli.help.golden.txt`. When the number moves it also
// makes `recordings/console.cast` and its GIF again, because the console draws it.
// `packages/code/tests/the-release-prepare-writes-every-number.test.ts` holds all of this.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_NAMES = new Set(['package.json', 'plugin.json', 'gemini-extension.json']);
const VERSION_TS = 'packages/code/src/version.ts';
const READER_VERSION_TS = 'packages/chain/src/version.ts';
const GOLDEN = 'packages/code/src/cli.help.golden.txt';
const CHANGELOG = 'CHANGELOG.md';
const RELEASES = 'https://github.com/felipesauer/mnema/releases/tag/';
const RETIRED = ', a pre-release withdrawn, from before this line';
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Every tracked manifest that declares a top-level `version`.
 * @param {string} root
 * @returns {string[]}
 */
export function trackedManifests(root) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter((where) => where !== '' && MANIFEST_NAMES.has(basename(where)))
    .filter((where) => {
      try {
        return typeof JSON.parse(readFileSync(join(root, where), 'utf-8')).version === 'string';
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * The headings of the Unreleased section that have something under them.
 * @param {string} changelog
 * @returns {string[]}
 */
export function unreleasedKinds(changelog) {
  const at = changelog.indexOf('## [Unreleased]');
  if (at < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  const rest = changelog.slice(at + 1);
  const end = rest.search(/^## \[/m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const filled = section
    .split(/^### /m)
    .slice(1)
    .map((part) => {
      const lines = part.split('\n');
      return { name: (lines[0] ?? '').trim(), body: lines.slice(1).join('\n').trim() };
    })
    .filter(({ body }) => body !== '')
    .map(({ name }) => name);
  if (filled.length === 0) {
    throw new Error('"## [Unreleased]" is empty: there is nothing to release');
  }
  return filled;
}

/**
 * The next number the CHANGELOG's Unreleased section asks for.
 * @param {string} current
 * @param {string} changelog
 * @returns {{ version: string, why: string }}
 */
export function propose(current, changelog) {
  const [major = 0, minor = 0, patch = 0] = (current.split(/[-+]/)[0] ?? '').split('.').map(Number);
  const filled = unreleasedKinds(changelog);
  const minorKinds = filled.filter((name) => ['Added', 'Changed', 'Removed'].includes(name));
  return minorKinds.length > 0
    ? { version: `${major}.${minor + 1}.0`, why: `minor: Unreleased has ${minorKinds.join(', ')}` }
    : {
        version: `${major}.${minor}.${patch + 1}`,
        why: `patch: Unreleased has only ${filled.join(', ')}`,
      };
}

/**
 * @param {string} text
 * @param {RegExp} pattern
 * @param {string} version
 * @param {string} where
 */
function rewrite(text, pattern, version, where) {
  if (!pattern.test(text)) throw new Error(`${where}: found no version to write`);
  return text.replace(pattern, `$1${version}$2`);
}

/**
 * What the release would leave on disk: path to new text, only for the files that change.
 * @param {string} root
 * @param {string} version
 * @param {string} date
 * @returns {Map<string, string>}
 */
export function plan(root, version, date) {
  /** @type {Map<string, string>} */
  const edits = new Map();
  const read = (/** @type {string} */ where) => readFileSync(join(root, where), 'utf-8');
  const put = (/** @type {string} */ where, /** @type {string} */ text) => {
    if (text !== read(where)) edits.set(where, text);
  };
  for (const where of trackedManifests(root)) {
    put(where, rewrite(read(where), /^( {2}"version":\s*")[^"]*(")/m, version, where));
  }
  put(
    VERSION_TS,
    rewrite(read(VERSION_TS), /^(export const VERSION = ')[^']*(')/m, version, VERSION_TS),
  );
  put(
    READER_VERSION_TS,
    rewrite(
      read(READER_VERSION_TS),
      /^(export const READER_VERSION = ')[^']*(')/m,
      version,
      READER_VERSION_TS,
    ),
  );
  put(GOLDEN, rewrite(read(GOLDEN), /(\$ mnema --version\n\| )[^\n]*(\n)/, version, GOLDEN));

  let log = read(CHANGELOG);
  if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(log)) {
    unreleasedKinds(log);
    log = log.replace('## [Unreleased]\n', `## [Unreleased]\n\n## [${version}] - ${date}\n`);
    log = log.replace(/^(\[Unreleased\]: .*\n)/m, `$1[${version}]: ${RELEASES}v${version}\n`);
  }
  log = log.replace(/^(## \[\d+\.\d+\.\d+-[^\]]+\] - \d{4}-\d{2}-\d{2})$/gm, `$1${RETIRED}`);
  put(CHANGELOG, log);
  return edits;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const at = args.indexOf('--date');
  const date = (at >= 0 ? args[at + 1] : undefined) ?? new Date().toISOString().slice(0, 10);
  const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--date');
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
  if (named.length > 1 || (named[0] !== undefined && !SEMVER.test(named[0]))) {
    console.error('usage: pnpm release:prepare [x.y.z] [--check] [--date YYYY-MM-DD]');
    process.exit(2);
  }
  const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version;
  /** @type {string} */
  let version = named[0] ?? '';
  if (version === '') {
    const proposal = propose(current, readFileSync(join(root, CHANGELOG), 'utf-8'));
    version = proposal.version;
    console.log(`proposed ${version} (${proposal.why})`);
  }
  const edits = plan(root, version, date);
  const remake = existsSync(join(root, 'recordings/console.cast')) && version !== current;
  for (const where of edits.keys()) console.log(`${check ? 'would write' : 'writes'} ${where}`);
  if (remake) {
    console.log(`${check ? 'would make' : 'makes'} recordings/console.cast and console.gif again`);
  }
  if (check) {
    if (edits.size > 0 || remake) process.exit(1);
    console.log('nothing to change');
    return;
  }
  for (const [where, text] of edits) writeFileSync(join(root, where), text);
  if (remake) {
    const run = (/** @type {string} */ cmd, /** @type {string[]} */ argv, env = {}) =>
      execFileSync(cmd, argv, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    run('pnpm', ['build']);
    run(
      'pnpm',
      ['vitest', 'run', 'packages/code/tests/the-recordings-are-what-the-binary-draws.test.ts'],
      { RECORDING: 'console' },
    );
    run('agg', [
      '--theme',
      'github-dark',
      '--font-size',
      '16',
      'recordings/console.cast',
      'recordings/console.gif',
    ]);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`release:prepare: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}
