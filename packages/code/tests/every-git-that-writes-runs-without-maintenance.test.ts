/**
 * EVERY GIT A TEST STARTS TO WRITE A REPOSITORY RUNS WITH AUTOMATIC MAINTENANCE OFF — through the
 * file `support/git-without-maintenance.ts` names, handed as `GIT_CONFIG_GLOBAL`, which is the one
 * channel the remote of a local push reads.
 *
 * WHY. A clone of a bare remote, made right after a push to it, lost a file under it once in sixty
 * runs of the suite: the push had started git's automatic maintenance on the remote, in the
 * background, and its repack deleted the loose objects the clone was copying. The support module
 * says what was measured, and why a `-c` on the command line never reaches that remote.
 *
 * WHAT IS ASSERTED:
 *   - the file is the one git reads, and it says what the module says it says;
 *   - behind it, a push that puts two loose objects in the remote's `objects/17` leaves them there,
 *     with no pack beside them — git 2.55's defaults repack such a remote about 30 ms after the
 *     push returns, which is the race;
 *   - every call that starts git, in every file of the workspace that starts one to write a
 *     repository, hands it that file. The calls are FOUND, never listed: a file starts git where a
 *     `spawn`, `spawnSync`, `execFile` or `execFileSync` is called with `'git'` first, and it
 *     writes a repository where it names, as a literal, a verb that starts automatic maintenance
 *     (`commit`, `merge`, `pull`, `fetch`, `am`, `rebase`, `cherry-pick`, `revert`), pushes into
 *     one (`push`, whose receiving side does), or copies one file by file (`clone`). A call that
 *     names its verb is read by it: one of those counts, and any other (`ls-files`, `show`) is a
 *     read that starts nothing. A call that names none — a helper forwarding its arguments —
 *     counts wherever its file writes, because the verb is its callers'.
 *
 * WHAT IT DOES NOT SEE, said so a green is not read as more: a git started through a shell
 * (`sh -c "git …"`), or by a program the test starts; and a call whose environment is built
 * somewhere else and passed by name — the walk reads the call's own text. None of the three exists
 * in this workspace today; a file that needs one says why beside it.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { codeOnly } from './support/reading-source.js';

/** The workspace root, whose files the walk reads. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Where a script of the workspace can live. Built output and installed packages are not scripts. */
const WALKED = ['packages', '.github', 'plugin'];
const NOT_WALKED = new Set(['node_modules', 'dist', 'coverage']);

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-without-maintenance-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `git <args>` in `dir`, as every git a test writes a repository with runs. */
function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')} in ${dir}: ${ran.stderr}`);
  return ran.stdout;
}

/** Writes two files into `dir` whose blobs git files under `objects/17`, and returns their ids. */
function twoBlobsFiledUnder17(dir: string): string[] {
  const ids: string[] = [];
  for (let i = 0; ids.length < 2; i++) {
    const content = `filed under 17, try ${i}\n`;
    const id = createHash('sha1')
      .update(`blob ${Buffer.byteLength(content)}\0${content}`)
      .digest('hex');
    if (!id.startsWith('17')) continue;
    writeFileSync(join(dir, `under-17-${ids.length}`), content);
    ids.push(id);
  }
  return ids;
}

/** The packs a repository's object store holds. */
function packsIn(repository: string): string[] {
  const at = join(repository, 'objects', 'pack');
  return existsSync(at) ? readdirSync(at).filter((name) => name.endsWith('.pack')) : [];
}

describe('the file every git that writes a repository reads', () => {
  it('is the one git reads, and turns automatic maintenance off', () => {
    expect(git(sandbox, 'config', '--global', '--get', 'maintenance.auto').trim()).toBe('false');
    expect(git(sandbox, 'config', '--global', '--get', 'gc.auto').trim()).toBe('0');
  });

  it('behind it, a push that puts two loose objects in the remote’s objects/17 leaves them there', () => {
    const remote = join(sandbox, 'origin.git');
    git(sandbox, 'init', '-q', '--bare', remote);
    const work = join(sandbox, 'work');
    git(sandbox, 'clone', '-q', remote, work);
    const ids = twoBlobsFiledUnder17(work);
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'two blobs filed under 17');
    git(work, 'push', '-q', 'origin', 'HEAD:main');

    // Two seconds is the window a background repack would have had: measured, git's defaults
    // start one and delete the loose objects about 30 ms after a push like this one returns.
    const until = Date.now() + 2000;
    while (Date.now() < until) {
      expect(packsIn(remote), 'the remote was repacked behind the push').toEqual([]);
      spawnSync('sleep', ['0.1']);
    }
    for (const id of ids) {
      expect(existsSync(join(remote, 'objects', id.slice(0, 2), id.slice(2))), id).toBe(true);
    }
  });
});

/** Every script of the workspace, recursively, built output and installed packages left out. */
function scriptsUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (NOT_WALKED.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...scriptsUnder(path));
    else if (/\.(?:ts|mjs)$/.test(entry.name)) found.push(path);
  }
  return found;
}

/** Where a call starts git: the name of the function, the `(`, and `'git'` as the first argument. */
const STARTS_GIT = /\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*(['"`])git\1/g;

/** A verb, as a literal, whose git writes a repository — see the header for why each is here. */
const WRITES = /(['"`])(?:commit|merge|pull|fetch|am|rebase|cherry-pick|revert|push|clone)\1/;

/**
 * The verb a call names as the first word of its arguments, when it names one there. A word that
 * starts with a dash is an option (`-c`), never a verb, and leaves the call counted.
 */
const NAMED_VERB = /^\(\s*(['"`])git\1\s*,\s*\[\s*(['"`])([a-z][a-z-]*)\2/;

/** One call that starts git: where it is, the whole text of it, and the verb it names, if any. */
interface Call {
  readonly line: number;
  readonly text: string;
  readonly verb: string | undefined;
}

/**
 * Every call in `source` that starts git, each to its closing parenthesis — found on the source
 * with comments and literals blanked (`codeOnly`), so a parenthesis inside a string does not end
 * a call, and a call written inside a string is not one. A call that never closes is the
 * scanner's failure, and says so.
 */
function callsStartingGit(file: string, source: string): Call[] {
  const code = codeOnly(source);
  if (code.length !== source.length) {
    throw new Error(`RULER BROKEN: codeOnly changed the length of ${file}`);
  }
  const calls: Call[] = [];
  for (const match of source.matchAll(STARTS_GIT)) {
    const open = (match.index as number) + match[0].indexOf('(');
    // A call written inside a literal — as the synthetic sources below are — is text, not a call.
    if (code[open] !== '(') continue;
    let depth = 0;
    let close = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) throw new Error(`RULER BROKEN: a call to git in ${file} never closes`);
    const text = source.slice(open, close + 1);
    calls.push({
      line: source.slice(0, open).split('\n').length,
      text,
      verb: NAMED_VERB.exec(text)?.[3],
    });
  }
  return calls;
}

/**
 * Whether a call turns automatic maintenance off, by either channel: the file handed as
 * `GIT_CONFIG_GLOBAL` (which a test's remote reads), or both settings on the call's own command
 * line (`-c`), which is how a product module does it for the cache it fetches into.
 */
function turnsMaintenanceOff(text: string): boolean {
  return (
    /\bGIT_CONFIG_GLOBAL:\s*GIT_WITHOUT_MAINTENANCE\b/.test(text) ||
    (text.includes('maintenance.auto=false') && text.includes('gc.auto=0'))
  );
}

/**
 * The calls in one file that start git to write a repository without the file that turns automatic
 * maintenance off, as `file:line` — the whole rule, in the one function both cases below ask.
 */
function bareCallsIn(file: string, source: string): string[] {
  if (!WRITES.test(source)) return [];
  return callsStartingGit(file, source)
    .filter((call) => call.verb === undefined || WRITES.test(`'${call.verb}'`))
    .filter((call) => !turnsMaintenanceOff(call.text))
    .map((call) => `${file}:${call.line}`);
}

/** Every file of the workspace that starts git, with its source and whether it writes a repository. */
const startingGit = WALKED.flatMap((top) => scriptsUnder(join(ROOT, top)))
  .map((path) => {
    const source = readFileSync(path, 'utf-8');
    const file = relative(ROOT, path).split(sep).join('/');
    return { file, source, writes: WRITES.test(source), calls: callsStartingGit(file, source) };
  })
  .filter((one) => one.calls.length > 0);

const THIS_FILE = relative(ROOT, fileURLToPath(import.meta.url))
  .split(sep)
  .join('/');

describe('the reading of a call', () => {
  it('counts a forwarding helper and a call whose first word is an option, and passes a read over', () => {
    // Each line a call of its own, so the answer is the lines. A `)` inside a literal before the
    // environment must not end the call there; a `-c` first must not be read as the verb.
    const source = [
      "spawnSync('git', args, { env: { GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE } });",
      "spawnSync('git', args, { cwd: 'a)b', env: { HOME: home } });",
      "execFileSync('git', ['ls-files', 'x'], { cwd: root });",
      "spawnSync('git', ['-c', 'user.name=x', 'commit', '-q'], { env: {} });",
      "execFileSync('git', ['commit', '-q'], { cwd: 'a)b', env: { GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE } });",
      "spawn('git', ['push'], {});",
      "execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], {});",
      "execFileSync('git', ['-c', 'gc.auto=0', ...args], {});",
    ].join('\n');
    expect(bareCallsIn('synthetic.ts', source)).toEqual([
      'synthetic.ts:2',
      'synthetic.ts:4',
      'synthetic.ts:6',
      'synthetic.ts:8',
    ]);
    // A file that names no verb that writes starts nothing that repacks: none of its calls count.
    expect(
      bareCallsIn('reads.ts', "execFileSync('git', ['ls-files'], {});\nspawnSync('git', a, {});"),
    ).toEqual([]);
  });
});

describe('every git a test starts to write a repository', () => {
  it('walks enough to mean something: the files that start git, and the ones that write', () => {
    const writing = startingGit.filter((one) => one.writes).map((one) => one.file);
    // A floor, never the list: the file whose clone lost the race writes, and so does this one.
    expect(writing).toContain('packages/code/tests/the-refusal-names-the-way-out.test.ts');
    expect(writing).toContain(THIS_FILE);
    expect(startingGit.length).toBeGreaterThan(writing.length);
  });

  it('hands every one of its calls the file that turns automatic maintenance off', () => {
    // The product's own modules are held to it too: the one that fetches does it into a cache of
    // its own and says so in the call, with `-c maintenance.auto=false -c gc.auto=0`.
    const bare = startingGit.flatMap((one) => bareCallsIn(one.file, one.source));
    expect(
      bare,
      'a git that writes a repository, started without GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE',
    ).toEqual([]);
  });
});
