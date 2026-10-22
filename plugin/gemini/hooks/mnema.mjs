// Generated from packages/code/src/host-names.ts: change the table, not this file.
//
// What Gemini CLI runs for this extension's hooks: `open` hands a session the project's committed
// mnema record as it starts, `gate` refuses a write where a rule of that record refuses it, and
// `settled`, after a question to the person was answered, says which tool records a choice.
// It runs `mnema` from the PATH, and every outcome that is not an answer, such as no `mnema`, no
// project or a program of that name that is not @mnema/code, leaves the session as it would
// have been without it: nothing on stdout, exit 0. One outcome is not silence: a `mnema` that is
// there and cannot answer (no node on the PATH takes it, it exits non-zero, it does not finish)
// refuses a write at a path that a rule which refuses it, or asks for a person at it, addresses;
// any other write goes through.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// ---- the reading of what to do where `mnema` cannot answer, as the plugin ships it ----

/**
 * The Node versions `mnema` takes, as `engines.node` of `@mnema/code` says them. A copy, because the
 * plugin runs with no build and cannot import the product's reader (`packages/code/src/node-floor.ts`);
 * `the-hooks-run-mnema-on-a-node-it-takes.test.ts` holds it to the manifest and to that reader over
 * a table of versions, so a floor raised there turns this red.
 */
const NODE_RANGE = '^24.15.0 || >=26.0.0';

/** The versions as the page says them, for a reason a person reads. */
const NODE_SAID = '24.15.0 or a later 24, or 26 or later';

/**
 * How long the whole search for a node may take, and how long one `node` is given to say its version:
 * a `node` that hangs on `-p` must not use up the host's 15 seconds, which the run of `mnema` that
 * follows (10 seconds at most) needs the rest of.
 */
const SEARCH_BUDGET = 3000;
const PROBE = 1000;

/** @typedef {{ readonly env: Readonly<Record<string, string | undefined>>, readonly refusal: string | null }} Runtime */

/**
 * Whether a Node of this version is one `mnema` takes: each `||` alternative of {@link NODE_RANGE}
 * is `^x.y.z` (that major from there) or `>=x.y.z`.
 *
 * @param {string} version
 * @returns {boolean}
 */
function nodeIsTaken(version) {
  const have = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())?.slice(1).map(Number);
  if (have === undefined) return false;
  const reaches = (/** @type {number[]} */ from) => {
    for (let at = 0; at < 3; at += 1) {
      if ((have[at] ?? 0) !== (from[at] ?? 0)) return (have[at] ?? 0) > (from[at] ?? 0);
    }
    return true;
  };
  return NODE_RANGE.split('||').some((alternative) => {
    const said = /^\s*(\^|>=)\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(alternative);
    if (said === null) return false;
    const from = [Number(said[2]), Number(said[3]), Number(said[4])];
    return reaches(from) && (said[1] === '>=' || have[0] === from[0]);
  });
}

/** The file name of a Node on this platform. */
const NODE_NAME = process.platform === 'win32' ? 'node.exe' : 'node';

/**
 * Where a program is, on `env`'s PATH or by its own path, or `null`.
 *
 * @param {string} name A bare name (searched on the PATH) or a path.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {string | null}
 */
function whereIs(name, env) {
  const executable = (/** @type {string} */ path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (name.includes('/') || name.includes('\\')) return executable(name) ? name : null;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir !== '' && executable(join(dir, name))) return join(dir, name);
  }
  return null;
}

/**
 * The version a Node says it is, or `null` where it did not say one in `timeout` milliseconds.
 *
 * @param {string} node
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {number} timeout
 * @returns {string | null}
 */
function versionOf(node, env, timeout) {
  const ran = spawnSync(node, ['-p', 'process.versions.node'], {
    env,
    encoding: 'utf-8',
    timeout,
    // A node that ignores SIGTERM must not outlive its probe: the gate's answer waits on it.
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const said = (ran.stdout ?? '').trim();
  return ran.error === undefined && ran.status === 0 && /^\d+\.\d+\.\d+/.test(said) ? said : null;
}

/** @param {string} path */
function realOf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * WHICH NODE `mnema` RUNS ON, and what to say where none takes it.
 *
 * The first `node` is asked what it is (not asked at all where it is the one running this file,
 * which already answers). Below the floor the search goes on: the `node` beside the `mnema` that was
 * found, which is the one that installed it, then every other `node` of the PATH, in order, while
 * the {@link SEARCH_BUDGET} lasts. The first that takes `mnema` is put in front of the PATH.
 *
 * NO `mnema` AT ALL IS NOT A REFUSAL: nothing is checked where there is no program to run, which is
 * the plugin installed on a machine without the product.
 *
 * @param {string} binary What is run: a bare name or a path.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {Runtime}
 */
function settleTheRuntime(binary, env) {
  const asIs = { env, refusal: null };
  const mnema = whereIs(binary, env);
  if (mnema === null) return asIs;
  const deadline = Date.now() + SEARCH_BUDGET;
  const probe = () => Math.min(PROBE, Math.max(1, deadline - Date.now()));
  const first = whereIs(NODE_NAME, env);
  const firstVersion =
    first === null
      ? null
      : realOf(first) === realOf(process.execPath)
        ? process.versions.node
        : versionOf(first, env, probe());
  if (firstVersion !== null && nodeIsTaken(firstVersion)) return asIs;
  const candidates = [
    join(dirname(mnema), NODE_NAME),
    ...(env.PATH ?? '').split(delimiter).map((dir) => join(dir, NODE_NAME)),
  ];
  const tried = new Set(first === null ? [] : [first]);
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    if (tried.has(candidate) || whereIs(candidate, env) === null) continue;
    tried.add(candidate);
    const version = versionOf(candidate, env, probe());
    if (version !== null && nodeIsTaken(version)) {
      const path = `${dirname(candidate)}${delimiter}${env.PATH ?? ''}`;
      return { env: { ...env, PATH: path }, refusal: null };
    }
  }
  const found =
    first === null
      ? 'there is no node on the PATH the host gives its hooks'
      : `the first node on the PATH the host gives its hooks is ${firstVersion ?? 'one that did not say its version'} (${first})`;
  return {
    env,
    refusal:
      `mnema needs Node ${NODE_SAID}, and ${found}; no other node on that PATH takes it. ` +
      'Install one with your Node manager (for example `nvm install 24`) and put it first on the PATH the host ' +
      "gives its hooks; for a host that carries a Node of its own (Cursor's command-line agent), start the host " +
      'from a shell where it comes first. `mnema doctor` in a terminal says which node it runs on there.',
  };
}

/**
 * The sentence a refusal carries when `mnema` was there and did not answer, with what to do.
 *
 * @param {string} because Why it did not answer, in words.
 * @returns {string}
 */
function couldNotAnswer(because) {
  return (
    `mnema could not answer for this write: ${because}. A rule of this project's record addresses this path, ` +
    'and a gate that cannot read the record does not let a write through. Run `mnema doctor` in a terminal ' +
    'to see what stops it; once mnema answers again, the record decides this write.'
  );
}

/** How much of what `mnema` said on its second stream is quoted back in a reason. */
const QUOTED = 120;

/**
 * Whether `text` is a reply a host reads: `{}`, or an object that carries `hookSpecificOutput`
 * (the shape of every host the plugin's hooks serve) or a `decision` (Gemini CLI's own).
 *
 * @param {string} text
 * @returns {boolean}
 */
function isAReply(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    return (
      Object.keys(parsed).length === 0 ||
      (typeof parsed.hookSpecificOutput === 'object' && parsed.hookSpecificOutput !== null) ||
      typeof parsed.decision === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * Why one run of the gate's verb is not an answer, in words: `undefined` where it answered, `null`
 * where there is no program to run (a machine with the plugin and without the product is not made
 * worse by the plugin), and a reason where the program was there and did not answer: it could not
 * start, it did not finish in `timeout` milliseconds, it exited non-zero, or what it printed is not
 * a reply a host reads.
 *
 * @param {import('node:child_process').SpawnSyncReturns<string>} ran
 * @param {number} timeout
 * @returns {string | null | undefined}
 */
function whyItDidNotAnswer(ran, timeout) {
  const code = /** @type {NodeJS.ErrnoException | undefined} */ (ran.error)?.code;
  if (code === 'ENOENT') return null;
  if (code === 'ETIMEDOUT') return `it did not answer in ${timeout / 1000} seconds`;
  // A closed input is not a failure: a `mnema` that refuses an option at its arguments exits before it
  // reads the payload, and what it said is read as it would be had the write gone through.
  if (code !== undefined && code !== 'EPIPE') return `it could not be started (${code})`;
  if (ran.status !== 0) {
    const said = (ran.stderr ?? '').trim().split('\n')[0] ?? '';
    return `it exited ${ran.status ?? ran.signal}${said === '' ? '' : `: ${said.slice(0, QUOTED)}`}`;
  }
  return isAReply(ran.stdout ?? '') ? undefined : 'what it printed is not a reply a host reads';
}

/** A reason to run `mnema` rather than answer here. */
class Doubt extends Error {}

/**
 * `path` as written and as the kernel resolves it, where it resolves: a path joined with a
 * relative one climbs from the written spelling textually, and from the real one as the kernel
 * would, so both are read.
 *
 * @param {string} path
 * @returns {string[]}
 */
function bothSpellings(path) {
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
function globalTrees(env) {
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
function isDirectory(path) {
  return statOrNothing(path)?.isDirectory() === true;
}

/** @param {string} path */
function statOrNothing(path) {
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
function aRuleReaches(cwd, env, raw) {
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
  return rule !== undefined && rule.live && !rule.left;
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

/** What `mnema --identify` starts its answer with: the package, then the version. */
const THIS_PRODUCT = '@mnema/code ';

/** The tools Gemini CLI writes a file through. */
const WRITES = new Set(['write_file', 'replace']);

/** The tool Gemini CLI asks the person a question through. */
const ASKS = 'ask_user';

/** How long `mnema` is given to answer, in milliseconds. */
const WAIT = 15000;

/**
 * What every step of the gate is given, so that the steps TOGETHER stay under the host's own cap
 * (the hooks file's 15 seconds): the search for a node takes at most 3 s, `--identify` at most
 * IDENTIFY_WAIT, and the gate at most GATE_WAIT with its second attempt included. 3 + 2 + 6 = 11 s,
 * so a mnema that hangs is answered by the refusal, not by the host killing the hook (which a host
 * reads as nothing to say, and the write goes through).
 */
const IDENTIFY_WAIT = 2000;
const GATE_WAIT = 6000;

/** The agent whose key signs what the gate records, where the record enrols it. */
const AGENT = ['--agent-key', 'gemini'];

/** What is run: npm's own shim name on Windows. */
const BINARY = process.platform === 'win32' ? 'mnema.cmd' : 'mnema';

/** Which node `mnema` runs on, settled once: the first on the PATH, or the first that takes it. */
let settled;
const theRuntime = () => {
  settled ??= settleTheRuntime(BINARY, process.env);
  return settled;
};

/**
 * One run of `mnema`, both streams kept; a run that did not finish carries an `error`.
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} [input]
 * @param {number} [timeout]
 */
function run(args, cwd, input, timeout = WAIT) {
  return spawnSync(BINARY, args, {
    cwd,
    env: theRuntime().env,
    input,
    encoding: 'utf-8',
    timeout,
    killSignal: 'SIGKILL',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Which `mnema` is on the PATH: this product, another program of that name, none, or one that did
 * not answer the question (it exited non-zero or did not finish), which is the case a gate exists for.
 * @param {string} cwd
 */
function whoIsThere(cwd) {
  const ran = run(['--identify'], cwd, undefined, IDENTIFY_WAIT);
  const failure = /** @type {NodeJS.ErrnoException | undefined} */ (ran.error);
  if (failure?.code === 'ENOENT') return 'other';
  if (ran.error !== undefined || ran.status !== 0) return 'broken';
  return ran.stdout.startsWith(THIS_PRODUCT) ? 'this' : 'other';
}

/**
 * What a verb printed for a hook, or nothing: the second stream rides under the first.
 * @param {string} verb
 * @param {string} cwd
 */
function whatItSays(verb, cwd) {
  const ran = run([verb, '--hook'], cwd);
  if (ran.error !== undefined || ran.status !== 0 || ran.stdout.trim() === '') return [];
  const alsoSaid = ran.stderr.trim();
  return [alsoSaid === '' ? ran.stdout : [ran.stdout, alsoSaid].join('\n\n')];
}

/**
 * The gate's answer where `mnema` could not give one: a refusal only where a rule that refuses the
 * write or asks for a person at it addresses the path, nothing otherwise.
 * @param {string} because
 * @param {string} cwd
 * @param {string} raw
 */
function closedWhere(because, cwd, raw) {
  return aRuleReaches(cwd, process.env, raw)
    ? { decision: 'deny', reason: couldNotAnswer(because) }
    : undefined;
}

/**
 * What the hook answers for one payload, or nothing.
 * @param {string | undefined} mode `open`, `gate` or `settled`
 * @param {string} raw what the host wrote to stdin
 */
function answer(mode, raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const cwd = typeof input?.cwd === 'string' ? input.cwd : process.cwd();
  if (mode === 'gate' && !WRITES.has(input?.tool_name)) return undefined;
  if (mode === 'settled' && input?.tool_name !== ASKS) return undefined;
  if (mode === 'gate' && theRuntime().refusal !== null) {
    return closedWhere(theRuntime().refusal, cwd, raw);
  }
  const who = theRuntime().refusal === null ? whoIsThere(cwd) : 'broken';
  if (who === 'broken' && mode === 'gate') {
    return closedWhere('it did not answer `mnema --identify`', cwd, raw);
  }
  if (who !== 'this') return undefined;
  if (mode === 'open') {
    const text = ['brief', 'recall'].flatMap((verb) => whatItSays(verb, cwd)).join('\n\n');
    return text === ''
      ? undefined
      : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
  }
  if (mode === 'settled') {
    const ran = run(['settled'], cwd, raw);
    if (ran.error !== undefined || ran.status !== 0) return undefined;
    const said = JSON.parse(ran.stdout);
    return said.hookSpecificOutput === undefined ? undefined : said;
  }
  if (mode !== 'gate') return undefined;
  const gate = ['before-a-write', '--host', 'gemini'];
  const started = Date.now();
  let ran = run([...gate, ...AGENT], cwd, raw, GATE_WAIT);
  // A `mnema` too old to know the option refuses it by name: asked again without it, with what is
  // left of the one budget.
  if (ran.status !== 0 && ran.stderr.includes('--agent-key')) {
    ran = run(gate, cwd, raw, Math.max(1, GATE_WAIT - (Date.now() - started)));
  }
  const failed = whyItDidNotAnswer(ran, GATE_WAIT);
  if (failed === null) return undefined;
  if (failed !== undefined) return closedWhere(failed, cwd, raw);
  const said = JSON.parse(ran.stdout);
  return said.decision === 'deny' ? { decision: 'deny', reason: said.reason } : undefined;
}

try {
  const said = answer(process.argv[2], readFileSync(0, 'utf-8'));
  if (said !== undefined) process.stdout.write(JSON.stringify(said));
} catch {
  // Silence: this must never make a session worse than it would have been without it.
}
