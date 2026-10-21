/**
 * Whether a write can meet a rule of the record, decided WITHOUT loading `mnema`: the gate's
 * handler asks it before it starts the verb, and starts nothing where the answer is no.
 *
 * WHY. In a host whose hooks are processes (Cursor, VS Code) the gate before a write is a process
 * that starts `mnema before-a-write`, and most of what that costs is loading `mnema`, paid on every
 * write even in a project where no rule is addressed at any path. A rule asks for a person or
 * refuses a write only through a link whose relation carries an ADDRESS (`ADDRESS_RELATIONS` in
 * `@mnema/chain`), so a record none of whose stored lines holds such a link has nothing to meet,
 * and the verb answers `{}` there, which the handler passes on as silence.
 *
 * WHAT IT READS IS THE STORED LINES, NEVER A CACHE. A rule that arrived by `git pull` or a checkout,
 * with nothing written on this machine, is a line in a segment like any other, so it is read here
 * the moment it is on disk. Nothing is kept between two writes.
 *
 * WHY THE MARKER CANNOT BE MISSED. A stored line is the canonical serialization of its event
 * (`FORMAT.md` §1 and §4): keys sorted, no whitespace, no letter written as an escape, and the
 * reader refuses a line that is not that serialization. So a stored link whose `rel` is an address
 * relation holds, byte for byte, `"rel":"<relation>"` ({@link MARKERS}).
 *
 * AND A RECORD `mnema` CANNOT READ STILL REACHES `mnema`, which refuses every write over one. So a
 * line is passed over here only when it reads as the reader reads it: UTF-8, canonical, an entry
 * whose event is of a `kind` and `v` in `event-schema.json` (a copy of the declarations the first
 * version published to the npm registry held, which every later one reads: `FORMAT.md` §7.1) with
 * every field declared and of its declared shape, or a checkpoint of its declared shape.
 *
 * EVERY DOUBT RUNS `mnema`, and being wrong that way costs what every write cost before: a tree
 * that cannot be listed or read, a line that does not read as above, a `MNEMA_HOME` that is not
 * absolute, a directory nested deeper than {@link DEEPEST}. It reads MORE trees than `mnema`
 * resolves, never fewer: every `.mnema/` on the way up from where the session is (not only the
 * nearest, and past the home), the whole `mnema/` folder of every git directory on the way up
 * (every project's private tree), and the global tree under every place the data directory can be.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * The relations whose target is an address, as a stored line spells them: the strings of
 * `ADDRESS_RELATIONS` in `@mnema/chain`, held to it by
 * `packages/code/tests/a-write-no-rule-can-meet-starts-no-mnema.test.ts`.
 */
export const ADDRESS_RELATIONS = ['governs', 'asks-for-a-person', 'refuses-a-write'];

/** What a stored link under an address relation holds, byte for byte. */
const MARKERS = ADDRESS_RELATIONS.map((rel) => Buffer.from(`"rel":${JSON.stringify(rel)}`));

/** How deep under a tree's root a `tails/` directory is looked for before it is a doubt. */
const DEEPEST = 6;

/** The scheme every checkpoint line names. */
const CHECKPOINT_SCHEME = 'mnema-checkpoint/1';

/** A reason to run `mnema` rather than answer here. */
class Doubt extends Error {}

/**
 * Whether a write from `cwd` can meet a rule of the record: `false` only where every tree `mnema`
 * could read from there was read here, no stored line of any holds a link with an address, and
 * every line reads as `mnema` reads it. Anything else is `true`.
 *
 * @param {string} cwd Where the verb would run.
 * @param {Readonly<Record<string, string | undefined>>} env The host's environment.
 * @returns {boolean}
 */
export function anAddressCanBeMet(cwd, env) {
  try {
    const here = resolve(cwd);
    const projects = projectTreesAbove(here);
    // NO `.mnema/` ON THE WAY UP IS NO PROJECT, and the verb answers nothing outside one.
    if (projects.length === 0) return false;
    const schema = theSchema();
    const roots = [...projects, ...privateTreesAbove(here), ...globalTrees(env)];
    return roots.some((root) => holdsAnAddress(root, 0, schema));
  } catch {
    return true;
  }
}

/**
 * Every `.mnema/` directory from `dir` up to the root.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function projectTreesAbove(dir) {
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
function privateTreesAbove(dir) {
  /** @type {string[]} */
  const found = [];
  for (let at = dir; ; at = dirname(at)) {
    const dotGit = join(at, '.git');
    const stat = statOrNothing(dotGit);
    if (stat !== undefined) {
      const gitDir = stat.isDirectory() ? dotGit : gitDirNamedBy(dotGit, at);
      if (gitDir !== undefined) {
        found.push(join(gitDir, 'mnema'), join(commonDirOf(gitDir), 'mnema'));
      }
    }
    if (dirname(at) === at) return found;
  }
}

/**
 * The git directory a `.git` file names, or nothing where it names none.
 *
 * @param {string} dotGit
 * @param {string} at
 * @returns {string | undefined}
 */
function gitDirNamedBy(dotGit, at) {
  const named = readFileSync(dotGit, 'utf-8').match(/^gitdir: *(.+?)\s*$/m)?.[1];
  return named === undefined ? undefined : resolve(at, named);
}

/**
 * The common git directory a linked worktree's names in `commondir`, or itself.
 *
 * @param {string} gitDir
 * @returns {string}
 */
function commonDirOf(gitDir) {
  const commondir = join(gitDir, 'commondir');
  if (statOrNothing(commondir) === undefined) return gitDir;
  const named = readFileSync(commondir, 'utf-8').trim();
  return named.length > 0 ? resolve(gitDir, named) : gitDir;
}

/**
 * The global tree under every place the data directory can be.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {string[]}
 */
function globalTrees(env) {
  const relocated = env.MNEMA_HOME ?? '';
  if (relocated !== '' && !isAbsolute(relocated)) throw new Doubt('MNEMA_HOME is relative');
  /** @type {string[]} */
  const trees = relocated === '' ? [] : [join(relocated, 'global')];
  for (const home of [env.HOME, homedir(), accountHome()]) {
    if (home !== undefined && isAbsolute(home)) trees.push(join(home, '.mnema', 'global'));
  }
  return trees;
}

/** @returns {string | undefined} */
function accountHome() {
  try {
    return userInfo().homedir;
  } catch {
    return undefined;
  }
}

/**
 * @typedef {object} Schema
 * @property {Record<string, string>} envelope
 * @property {Record<string, string>} fields
 * @property {Map<string, Record<string, string>>} contracts
 */

/**
 * The declarations a line is read against, from the copy beside this file.
 *
 * @returns {Schema}
 */
function theSchema() {
  /** @type {{ envelope: Record<string, string>, transitionFields: Record<string, string>, contracts: { kind: string, v: number, payload: Record<string, string> }[] }} */
  const schema = JSON.parse(readFileSync(new URL('./event-schema.json', import.meta.url), 'utf-8'));
  const contracts = new Map(
    schema.contracts.map((contract) => [`${contract.kind}@${contract.v}`, contract.payload]),
  );
  return { envelope: schema.envelope, fields: schema.transitionFields, contracts };
}

/**
 * Whether a tree at `root` can hold a link with an address: a `tails/` under it whose stored lines
 * hold the marker or that this module cannot vouch for. A root that is not there holds nothing.
 *
 * @param {string} root
 * @param {number} depth
 * @param {Schema} schema
 * @returns {boolean}
 */
function holdsAnAddress(root, depth, schema) {
  if (depth > DEEPEST) throw new Doubt(`deeper than ${DEEPEST} under a tree`);
  let entries;
  try {
    entries = readdirSync(root);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
  for (const name of entries) {
    const path = join(root, name);
    if (!isDirectory(path)) continue;
    const holds =
      name === 'tails' ? tailsHoldAnAddress(path, schema) : holdsAnAddress(path, depth + 1, schema);
    if (holds) return true;
  }
  return false;
}

/**
 * Whether a `tails/` directory's lines hold an address, or one this module cannot vouch for.
 *
 * @param {string} tails
 * @param {Schema} schema
 * @returns {boolean}
 */
function tailsHoldAnAddress(tails, schema) {
  for (const tail of readdirSync(tails)) {
    const dir = join(tails, tail);
    if (!isDirectory(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const bytes = readFileSync(join(dir, file));
      if (MARKERS.some((marker) => bytes.includes(marker))) return true;
      const vouch = file === 'checkpoints.jsonl' ? aCheckpoint : anEntry;
      for (const line of STRICT_UTF8.decode(bytes).split('\n')) {
        if (line.length > 0) vouch(canonicalValueOf(line), schema);
      }
    }
  }
  return false;
}

/** A string holding a surrogate that is not half of a pair. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * The value a line holds, where the line is its canonical serialization (`FORMAT.md` §1).
 *
 * @param {string} line
 * @returns {unknown}
 */
function canonicalValueOf(line) {
  const value = JSON.parse(line);
  if (JSON.stringify(normalized(value)) !== line) throw new Doubt('not canonical');
  return value;
}

/**
 * `value` with every string in NFC and every object's keys sorted, as canonical bytes hold it.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function normalized(value) {
  if (typeof value === 'string') {
    if (LONE_SURROGATE.test(value)) throw new Doubt('a lone surrogate');
    return value.normalize('NFC');
  }
  if (Array.isArray(value)) return value.map(normalized);
  if (isObject(value)) {
    /** @type {Record<string, unknown>} */
    const out = Object.create(null);
    const keys = Object.keys(value)
      .map((written) => ({ key: written.normalize('NFC'), written }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const { key, written } of keys) {
      if (Object.hasOwn(out, key)) throw new Doubt('two keys that normalize to one');
      out[key] = normalized(value[written]);
    }
    return out;
  }
  return value;
}

/**
 * A stored entry: `event` and `link` and nothing else, each of its declared shape.
 *
 * @param {unknown} value
 * @param {Schema} schema
 */
function anEntry(value, schema) {
  if (!isObject(value)) throw new Doubt('not an entry');
  const keys = Object.keys(value);
  if (keys.length !== 2 || keys[0] !== 'event' || keys[1] !== 'link') {
    throw new Doubt('not an entry');
  }
  const { event, link } = value;
  if (!isObject(link) || !isText(link.tail) || !isText(link.hash)) throw new Doubt('the link');
  if (!Number.isInteger(link.seq) || link.seq < 0) throw new Doubt('the link');
  if (link.prev !== null && !isText(link.prev)) throw new Doubt('the link');
  if (!isObject(event) || typeof event.v !== 'number') throw new Doubt('the event');
  const payload = schema.contracts.get(`${event.kind}@${event.v}`);
  if (payload === undefined) throw new Doubt('a kind or a version not read here');
  declared(event, { ...schema.envelope, payload: 'object' }, schema);
  declared(event.payload, payload, schema);
}

/**
 * Every key of `value` declared in `rules`, and every declared field of its shape.
 *
 * @param {Record<string, any>} value
 * @param {Record<string, string>} rules
 * @param {Schema} schema
 */
function declared(value, rules, schema) {
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(rules, key)) throw new Doubt(`a field not declared: ${key}`);
  }
  for (const [field, rule] of Object.entries(rules)) {
    if (!ofShape(value[field], rule, schema)) throw new Doubt(`${field} is not ${rule}`);
  }
}

const ENTRY_HASH = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Whether `value` is of the shape `rule` names in `event-schema.json`'s `rules`.
 *
 * @param {any} value
 * @param {string} rule
 * @param {Schema} schema
 * @returns {boolean}
 */
function ofShape(value, rule, schema) {
  if (rule.endsWith('?') && value === undefined) return true;
  switch (rule) {
    case 'object':
      return isObject(value);
    case 'string':
    case 'string?':
    case 'kind':
      return isText(value);
    case 'string|null':
      return value === null || isText(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'count':
    case 'version':
      return Number.isSafeInteger(value) && value >= 1;
    case 'string[]?':
      return Array.isArray(value) && value.length > 0 && value.every(isText);
    case 'hashes?':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(
          (/** @type {unknown} */ hash, /** @type {number} */ i) =>
            typeof hash === 'string' && ENTRY_HASH.test(hash) && (i === 0 || value[i - 1] < hash),
        )
      );
    case 'instant':
      return isText(value) && INSTANT.test(value) && sameInstant(value);
    case 'fields?':
      if (!isObject(value) || Object.keys(value).length === 0) return false;
      declared(value, schema.fields, schema);
      return true;
    default:
      return false;
  }
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function sameInstant(text) {
  const date = new Date(text);
  return !Number.isNaN(date.getTime()) && date.toISOString() === text;
}

/**
 * A checkpoint line, of the shape the reader parses.
 *
 * @param {unknown} value
 */
function aCheckpoint(value) {
  if (!isObject(value) || value.scheme !== CHECKPOINT_SCHEME) throw new Doubt('a checkpoint');
  for (const key of ['tail', 'contentRoot', 'signerFp', 'sig']) {
    if (!isText(value[key])) throw new Doubt('a checkpoint');
  }
  for (const key of ['fromSeq', 'toSeq']) {
    if (!Number.isInteger(value[key]) || value[key] < 0) throw new Doubt('a checkpoint');
  }
  if (value.prev !== null && !isText(value.prev)) throw new Doubt('a checkpoint');
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isText(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {string} path */
function isDirectory(path) {
  return statOrNothing(path)?.isDirectory() === true;
}

/** @param {string} path */
function statOrNothing(path) {
  return statSync(path, { throwIfNoEntry: false });
}
