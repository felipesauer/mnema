/**
 * Where the record of a project is kept on this machine, and which of its rules reach a path: read
 * from the stored lines, never by running `mnema`.
 *
 * TWO READERS USE IT. `an-address-can-be-met.mjs` asks WHERE the trees are, to decide whether a write
 * can meet a rule at all and start nothing where it cannot. And the gate asks {@link aRuleReaches}
 * when `mnema` cannot answer (no node takes it, it exits non-zero, it does not finish in time):
 * a write is then refused only where a rule that refuses it, or asks for a person at it, addresses
 * THAT path. A path no such rule addresses is let through, since nothing of the record says it is
 * governed. The copy of this file that Gemini CLI's script and OpenCode's plugin carry is made from
 * it by the host-file generator, so there is one reading.
 *
 * AN ADDRESS IS A PREFIX BY SEGMENTS, relative to the project's root (the directory that holds the
 * `.mnema/` or the `.git`), as `packages/context/src/intelligence/governance.ts` reads it. Every
 * doubt answers "it reaches": a line that does not parse, a tree that cannot be read, a payload that
 * names no path this reads. Being wrong that way costs a refusal that the reason names the fix of;
 * the other way lets through a write a rule refuses.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** A reason to run `mnema` rather than answer here. */
export class Doubt extends Error {}

/**
 * `path` as written and as the kernel resolves it, where it resolves: a path joined with a
 * relative one climbs from the written spelling textually, and from the real one as the kernel
 * would, so both are read.
 *
 * @param {string} path
 * @returns {string[]}
 */
export function bothSpellings(path) {
  let real;
  try {
    real = realpathSync.native(path);
  } catch {
    return [path];
  }
  return real === path ? [path] : [path, real];
}

/**
 * Every `.mnema/` directory from `dir` up to the root.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function projectTreesAbove(dir) {
  /** @type {string[]} */
  const found = [];
  for (let at = dir; ; at = dirname(at)) {
    const tree = join(at, '.mnema');
    if (isDirectory(tree)) found.push(tree);
    if (dirname(at) === at) return found;
  }
}

/**
 * The `mnema/` folder of the git directory, and of the common one, of every repository from
 * `dir` up: where each project's private tree lives inside a repository.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function privateTreesAbove(dir) {
  /** @type {string[]} */
  const found = [];
  for (let at = dir; ; at = dirname(at)) {
    const dotGit = join(at, '.git');
    const stat = statOrNothing(dotGit);
    if (stat !== undefined) {
      const gitDirs = stat.isDirectory() ? [dotGit] : gitDirsNamedBy(dotGit, at);
      for (const gitDir of gitDirs) {
        found.push(join(gitDir, 'mnema'), ...commonDirsOf(gitDir).map((one) => join(one, 'mnema')));
      }
    }
    if (dirname(at) === at) return found;
  }
}

/**
 * The git directory a `.git` file names, resolved against the directory holding it as written
 * and as it really is, or none where it names none.
 *
 * @param {string} dotGit
 * @param {string} at
 * @returns {string[]}
 */
function gitDirsNamedBy(dotGit, at) {
  const named = readFileSync(dotGit, 'utf-8').match(/^gitdir: *(.+?)\s*$/m)?.[1];
  return named === undefined ? [] : bothSpellings(at).map((dir) => resolve(dir, named));
}

/**
 * The common git directory a linked worktree's names in `commondir`, resolved against it as
 * written and as it really is, or itself.
 *
 * @param {string} gitDir
 * @returns {string[]}
 */
function commonDirsOf(gitDir) {
  const commondir = join(gitDir, 'commondir');
  if (statOrNothing(commondir) === undefined) return [gitDir];
  const named = readFileSync(commondir, 'utf-8').trim();
  if (named.length === 0) return [gitDir];
  return bothSpellings(gitDir).map((dir) => resolve(dir, named));
}

/**
 * The global tree under every place the data directory can be, each as written and as it
 * really is.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {string[]}
 */
export function globalTrees(env) {
  const relocated = env.MNEMA_HOME ?? '';
  if (relocated !== '' && !isAbsolute(relocated)) throw new Doubt('MNEMA_HOME is relative');
  /** @type {string[]} */
  const dataDirs = relocated === '' ? [] : bothSpellings(resolve(relocated));
  for (const home of [env.HOME, homedir(), accountHome()]) {
    if (home === undefined || !isAbsolute(home)) continue;
    for (const spelled of bothSpellings(home)) dataDirs.push(join(spelled, '.mnema'));
  }
  return dataDirs.map((dir) => join(dir, 'global'));
}

/** @returns {string | undefined} */
function accountHome() {
  try {
    return userInfo().homedir;
  } catch {
    return undefined;
  }
}

/** @param {string} path */
export function isDirectory(path) {
  return statOrNothing(path)?.isDirectory() === true;
}

/** @param {string} path */
export function statOrNothing(path) {
  return statSync(path, { throwIfNoEntry: false });
}

/** How deep under a tree's root a `tails/` directory is looked for before it is a doubt. */
const REACH_DEEPEST = 6;

/** The relations that refuse a write or ask for a person at it, as a stored line spells them. */
const GATING = ['refuses-a-write', 'asks-for-a-person'];

/**
 * Whether a rule IN FORCE that refuses a write or asks for a person at it addresses a path this payload
 * is about to write, or may: `true` on every doubt. In force is what the verb counts: ruled `accepted`
 * (or `adopted`) and not since superseded or deprecated, read from the move events of the same pass.
 *
 * @param {string} cwd Where the session is.
 * @param {Readonly<Record<string, string | undefined>>} env The host's environment.
 * @param {string} raw What the host handed the hook: JSON naming the tool and its input.
 * @returns {boolean}
 */
export function aRuleReaches(cwd, env, raw) {
  try {
    const starts = [
      ...new Set([
        realpathSync.native(isAbsolute(cwd) ? cwd : `${process.cwd()}/${cwd}`),
        resolve(cwd),
      ]),
    ];
    const roots = [
      ...starts.flatMap(projectTreesAbove),
      ...starts.flatMap(privateTreesAbove),
      ...globalTrees(env),
    ];
    /** @type {Map<string, { rule: string, address: string }>} */
    const standing = new Map();
    /** @type {Map<string, Standing>} */
    const rules = new Map();
    for (const root of roots) readEdges(root, 0, standing, rules);
    // A rule that is not in force refuses nothing and asks for nobody, as the verb counts it.
    const addresses = [...standing.values()]
      .filter((edge) => inForce(rules.get(edge.rule)))
      .map((edge) => edge.address);
    if (addresses.length === 0) return false;
    const written = pathsWritten(raw, cwd);
    if (written.length === 0) return true;
    const bases = starts.flatMap(projectRootsAbove);
    return addresses.some((address) =>
      written.some((path) => bases.some((base) => covers(address, path, base))),
    );
  } catch {
    return true;
  }
}

/**
 * Every directory from `dir` up that holds a `.mnema/` or a `.git`: the places an address is
 * relative to.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function projectRootsAbove(dir) {
  /** @type {string[]} */
  const found = [];
  for (let at = dir; ; at = dirname(at)) {
    if (isDirectory(join(at, '.mnema')) || statOrNothing(join(at, '.git')) !== undefined) {
      found.push(at);
    }
    if (dirname(at) === at) return found;
  }
}

/**
 * What the moves of one rule say of where it stands: it was ruled in force (`accepted`, `adopted`),
 * and it was taken out of force from there (superseded, deprecated). Both are terminal, so no order
 * is needed. A rule closed from a state it was not live in (a reject beside an accept, from two
 * clones) is left in force: where the record doubts, the rule reaches.
 *
 * @typedef {{ live: boolean, left: boolean }} Standing
 */

/** The states a move can take a rule into that make it govern. */
const LIVE = ['accepted', 'adopted'];

/** The states a move takes a rule into that end its governing. */
const CLOSED = ['rejected', 'superseded', 'deprecated'];

/**
 * @param {Standing | undefined} rule
 * @returns {boolean}
 */
function inForce(rule) {
  return rule?.live === true && !rule.left;
}

/**
 * The refusing and asking links that stand in the tails under `root`, by edge, each to its rule and
 * address, and what the moves of every rule say of where it stands.
 *
 * @param {string} root
 * @param {number} depth
 * @param {Map<string, { rule: string, address: string }>} standing
 * @param {Map<string, Standing>} rules
 */
function readEdges(root, depth, standing, rules) {
  if (depth > REACH_DEEPEST) throw new Doubt('deeper than a tree goes');
  let entries;
  try {
    entries = readdirSync(root);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return;
    throw error;
  }
  for (const name of entries) {
    const path = join(root, name);
    if (!isDirectory(path)) continue;
    if (name !== 'tails') {
      readEdges(path, depth + 1, standing, rules);
      continue;
    }
    for (const tail of readdirSync(path)) {
      const dir = join(path, tail);
      if (!isDirectory(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.jsonl') || file === 'checkpoints.jsonl') continue;
        for (const line of readFileSync(join(dir, file), 'utf-8').split('\n')) {
          if (
            line.includes('"kind":"knowledge.linked"') ||
            line.includes('"kind":"link.retracted"')
          ) {
            readEdge(line, standing);
          } else if (line.includes('.transitioned"')) {
            readMove(line, rules);
          }
        }
      }
    }
  }
}

/**
 * A move of a decision or a pattern, read only where it takes the rule into or out of force: the
 * line is parsed after a cheap look for the states, which is a small share of a record's lines.
 *
 * @param {string} line
 * @param {Map<string, Standing>} rules
 */
function readMove(line, rules) {
  if (!/"to":"(?:accepted|adopted|rejected|superseded|deprecated)"/.test(line)) return;
  const { event } = JSON.parse(line);
  if (event.kind !== 'decision.transitioned' && event.kind !== 'skill.transitioned') return;
  const { from, to } = event.payload;
  const rule = rules.get(event.subject) ?? { live: false, left: false };
  if (LIVE.includes(to)) rule.live = true;
  else if (CLOSED.includes(to) && LIVE.includes(from)) rule.left = true;
  rules.set(event.subject, rule);
}

/**
 * @param {string} line
 * @param {Map<string, { rule: string, address: string }>} standing
 */
function readEdge(line, standing) {
  const { event } = JSON.parse(line);
  const { kind, payload, subject, who } = event;
  const key = `${who}\0${subject}\0${payload?.rel}\0${payload?.target}`;
  if (kind === 'link.retracted') standing.delete(key);
  else if (kind === 'knowledge.linked' && GATING.includes(payload.rel)) {
    standing.set(key, { rule: String(subject), address: String(payload.target) });
  }
}

/**
 * Whether `address` covers `path` under `base`: a prefix of its segments, as the record reads it.
 *
 * @param {string} address
 * @param {string} path An absolute path.
 * @param {string} base The project's root.
 * @returns {boolean}
 */
function covers(address, path, base) {
  if (isAbsolute(address)) {
    const where = resolve(address);
    return path === where || path.startsWith(where.endsWith(sep) ? where : where + sep);
  }
  const under = relative(base, path);
  if (under === '' || under.startsWith('..') || isAbsolute(under))
    return under === '' && address.replace(/[./]/g, '') === '';
  const wanted = [];
  for (const segment of address.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (wanted.length === 0) return false;
      wanted.pop();
    } else wanted.push(segment);
  }
  const have = under.split(sep);
  return wanted.every((segment, at) => have[at] === segment);
}

/**
 * The absolute paths a write payload is about to touch, as far as a payload of any of the hosts can
 * be read: the fields the hosts name a file by, and the headers of a patch. Each as written and,
 * where its nearest directory exists, as the kernel resolves it. None where it names none.
 *
 * @param {string} raw
 * @param {string} cwd
 * @returns {string[]}
 */
function pathsWritten(raw, cwd) {
  let input;
  try {
    input = JSON.parse(raw)?.tool_input;
  } catch {
    return [];
  }
  /** @type {string[]} */
  const named = [];
  const visit = (/** @type {unknown} */ value, /** @type {string} */ key) => {
    if (typeof value === 'string') {
      if (['file_path', 'filePath', 'path', 'target_file'].includes(key)) named.push(value);
      else if (value.includes('*** ')) {
        for (const line of value.split(/\r?\n/)) {
          const header = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
          if (header?.[1] !== undefined) named.push(header[1].trim());
        }
      }
    } else if (Array.isArray(value)) {
      for (const one of value) visit(one, key);
    } else if (typeof value === 'object' && value !== null) {
      for (const [field, one] of Object.entries(value)) visit(one, field);
    }
  };
  visit(input, '');
  return [
    ...new Set(named.filter((one) => one !== '').flatMap((one) => spelled(resolve(cwd, one)))),
  ];
}

/**
 * `path` as written and as the kernel resolves its nearest existing directory.
 *
 * @param {string} path
 * @returns {string[]}
 */
function spelled(path) {
  const rest = [];
  for (let at = path; ; at = dirname(at)) {
    try {
      const real = realpathSync.native(at);
      return [...new Set([path, resolve(real, ...rest)])];
    } catch {
      if (dirname(at) === at) return [path];
      rest.unshift(at.slice(dirname(at).length + 1));
    }
  }
}
