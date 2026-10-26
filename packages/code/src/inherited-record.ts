/**
 * A record read from another repository, at one commit: what a project INHERITS.
 *
 * A project points at a repository of decisions (any git repository whose tree holds a mnema
 * record) by two facts in a committed file, `.mnema/inherit.json`: where it is, and the commit.
 * The commit is the whole of what makes this provable. A branch name moves under a reader; a
 * commit does not, so "what this project inherited" is the same bytes for everyone who clones it
 * and a verdict over them is a verdict about those bytes.
 *
 * WHAT THIS DOES NOT DO IS AS DELIBERATE AS WHAT IT DOES.
 *  - It never writes to the where and never into the project's own chain: an inherited decision
 *    is read, so it is not signed by the project, is not in any tree the project's `verify`
 *    covers, and cannot be confused with a decision the project made.
 *  - It never reaches the network on a read. Only `fetchOrigin` does, and only the two verbs that
 *    point or move the pointer call it. The brief reads this machine's copy and, when the pinned
 *    commit is not there, says so and names `inherit update`: `inherit.json` is committed, so a
 *    clone of someone else's repository must not make the opening fetch a URL they chose.
 *  - It reads what VERIFIES. The record at the commit is checked with the same `verify` the
 *    project's own is; a record that does not verify there contributes nothing, and the reading
 *    says so ({@link InheritedReading}).
 *
 * The copy lives under the mnema data directory (`<data>/inherited/<where digest>/`), never in
 * the project's tree: a bare repository fetched into, and one extracted copy of `.mnema/` per
 * commit read. Git is run with an argument array, never through a shell.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  ADDRESS_RELATIONS,
  ASKS_FOR_A_PERSON_RELATION,
  catalogUpcasters,
  contractNotHeldIn,
  GOVERNS_RELATION,
  REFUSES_A_WRITE_RELATION,
  type VerifyResult,
  verify,
} from '@mnema/chain';
import { type Acceptance, brief, type InheritedFrom, type ScopedCache } from '@mnema/context';
import type { ResolvedTrees } from '@mnema/core';
import { oneLine } from './one-line.js';
import {
  ASKS_A_PERSON_CHANNEL,
  EDIT_PUSH_CHANNEL,
  REFUSES_A_WRITE_CHANNEL,
} from './record-framing.js';
import { withCache } from './tree-sources.js';

/** The committed file, inside the project's tree, that names what is inherited. */
export const POINTER_FILE = 'inherit.json';

/** A full object name: 40 hex digits, or 64 for a SHA-256 repository. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** What a project inherits from: a repository, and the one commit of it that is read. */
export interface Pointer {
  readonly where: string;
  readonly commit: string;
}

/**
 * One inherited decision in force, WHOLE, as the where's record holds it: what it says, why, what
 * it turned down, its state and who accepted it, and every path it is addressed at. A reading that
 * kept the title alone could say a rule exists and not where it applies or why.
 */
export interface InheritedRule {
  readonly id: string;
  /** Its `ADR-<n>` label IN THE WHERE'S RECORD: the project's own numbering is another. */
  readonly adr: string;
  readonly title: string;
  readonly rationale: string;
  readonly alternatives?: string;
  readonly state: string;
  readonly acceptance?: Acceptance;
  /**
   * Every address the where's record holds for it, under the three relations that address a path
   * (`governs`, `asks-for-a-person`, `refuses-a-write`), in that order, then by target. A target is
   * read against the root of the project that INHERITS the rule, as the project's own are.
   */
  readonly addresses: readonly { readonly rel: string; readonly target: string }[];
}

/**
 * How many rules the inherited record places at an address, under each relation: its decisions in
 * force, and the rules it addresses that it does not hold at all (a link from the origin to a rule
 * of the project that inherits it, whose address is the origin's). The brief prints these beside
 * the project's own counts, so a refusal that comes from the origin is never one the brief said
 * would not come.
 */
export interface AddressingRules {
  readonly governs: number;
  readonly asks: number;
  readonly refuses: number;
}

/** What the pointer file holds, or why it cannot be used. */
export type PointerRead =
  | { readonly state: 'absent' }
  | { readonly state: 'found'; readonly pointer: Pointer }
  | { readonly state: 'invalid'; readonly why: string };

/**
 * What reading the inherited record at its pinned commit came to.
 *
 * Four outcomes and only the first carries decisions: the others each say, in a sentence, why
 * there are none, because an absence nobody explains is read as "the where has no rules".
 */
export type InheritedReading =
  | {
      readonly state: 'read';
      readonly pointer: Pointer;
      readonly decisions: readonly InheritedRule[];
      readonly addressing: AddressingRules;
    }
  | { readonly state: 'unverified'; readonly pointer: Pointer; readonly why: string }
  | { readonly state: 'unavailable'; readonly pointer: Pointer; readonly why: string }
  | { readonly state: 'invalid'; readonly why: string };

/** Reads `<tree>/inherit.json`. */
export function readPointer(projectPublic: string): PointerRead {
  const file = join(projectPublic, POINTER_FILE);
  if (!existsSync(file)) return { state: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { state: 'invalid', why: `${POINTER_FILE} is not valid JSON` };
  }
  const { origin: where, commit } = (parsed ?? {}) as { origin?: unknown; commit?: unknown };
  if (typeof where !== 'string' || where.length === 0 || where.startsWith('-')) {
    return { state: 'invalid', why: `${POINTER_FILE} has no usable "origin"` };
  }
  if (typeof commit !== 'string' || !COMMIT.test(commit)) {
    return { state: 'invalid', why: `${POINTER_FILE} has no full "commit" hash` };
  }
  return { state: 'found', pointer: { where, commit } };
}

/** Writes the pointer file: the only file this feature writes into a project. */
export function writePointer(projectPublic: string, pointer: Pointer): void {
  writeFileSync(
    join(projectPublic, POINTER_FILE),
    `${JSON.stringify({ origin: pointer.where, commit: pointer.commit }, null, 2)}\n`,
  );
}

/** Where a project's copies of one where live: under the data directory, outside the project. */
function homeOf(trees: ResolvedTrees, where: string): string {
  const digest = createHash('sha256').update(where).digest('hex').slice(0, 16);
  return join(dirname(trees.global), 'inherited', digest);
}

/**
 * What `git` is asked to fetch from. A path written relative is relative to the project's root,
 * the way a file in the repository would read it; a URL is left as it is.
 */
function sourceOf(where: string, projectRoot: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(where)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (scheme === 'https' || scheme === 'ssh') return where;
    throw new GitFailed(`an origin over ${scheme}:// is not read; use https, ssh or a local path`);
  }
  if (/^[\w.-]+@[\w.-]+:/.test(where)) return where;
  // `ext::<command>` and its kin are transport helpers: git would run what follows the `::`.
  if (where.includes('::')) {
    throw new GitFailed('an origin written as <helper>::<address> is not read');
  }
  return resolve(projectRoot, where);
}

/** Only these transports are spoken, and never one a URL the user did not type could pick. */
const TRANSPORTS = [
  'protocol.allow=never',
  'protocol.https.allow=always',
  'protocol.ssh.allow=always',
  'protocol.file.allow=always',
].flatMap((setting) => ['-c', setting]);

/** A git failure, with the last line git said: the part a person can act on. */
export class GitFailed extends Error {
  override readonly name = 'GitFailed';
}

function git(args: readonly string[], binary = false, timeout = 120_000): Buffer | string {
  try {
    return execFileSync(
      'git',
      ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...TRANSPORTS, ...args],
      {
        encoding: binary ? 'buffer' : 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PROTOCOL_FROM_USER: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        maxBuffer: 1024 * 1024 * 1024,
      },
    );
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    throw new GitFailed(stderr.split('\n').pop() || (error as Error).message);
  }
}

/** The bare repository the where is fetched into, created on first use. */
function repoOf(home: string): string {
  const repo = join(home, 'repo.git');
  if (!existsSync(repo)) {
    mkdirSync(home, { recursive: true });
    git(['init', '--bare', '--quiet', repo]);
  }
  return repo;
}

/** Whether this machine's copy of the where holds the commit. */
function holds(repo: string, commit: string): boolean {
  try {
    git(['-C', repo, 'cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** A fetch is a person waiting at `set` or `update`; long enough for a repository, not for a hang. */
const FETCH_TIMEOUT_MS = 10_000;

/** Brings the where's heads into the local copy. The only call here that may use the network. */
function fetchOrigin(repo: string, source: string): void {
  git(
    [
      '-C',
      repo,
      'fetch',
      '--quiet',
      '--no-tags',
      '--',
      source,
      '+HEAD:refs/mnema/head',
      '+refs/heads/*:refs/mnema/heads/*',
    ],
    false,
    FETCH_TIMEOUT_MS,
  );
}

/** The `.mnema/` of one commit, extracted once and never changed (a commit does not change). */
function materialize(home: string, repo: string, commit: string): string {
  const dest = join(home, 'at', commit);
  if (existsSync(join(dest, '.mnema'))) return join(dest, '.mnema');
  const archive = git(
    ['-C', repo, 'archive', '--format=tar', commit, '--', '.mnema/tails', '.mnema/keys'],
    true,
  ) as Buffer;
  const partial = `${dest}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  try {
    execFileSync('tar', ['-x', '-C', partial], {
      input: archive,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    mkdirSync(dirname(dest), { recursive: true });
    try {
      renameSync(partial, dest);
    } catch {
      // Another reader extracted the same commit first; theirs is the same bytes.
    }
  } finally {
    rmSync(partial, { recursive: true, force: true });
  }
  return join(dest, '.mnema');
}

/**
 * Why a record that did not verify is not read: the verdict's summary, after the refusal of a line
 * no contract of this reader reads, when that is the cause. The summary only says a tail could not
 * be read; every other reading of such a record names the pair and which mnema refuses
 * (`FORMAT.md` §7.1), and this one has only the verdict to say it from.
 */
function whyNotRead(verdict: VerifyResult): string {
  const named = new Set<string>();
  for (const issue of verdict.issues) {
    const refusal = contractNotHeldIn(issue.detail);
    if (refusal !== undefined) named.add(refusal);
  }
  return [...named, verdict.summary].join(' ');
}

type RecordRead =
  | {
      readonly ok: true;
      readonly decisions: readonly InheritedRule[];
      readonly addressing: AddressingRules;
    }
  | { readonly ok: false; readonly why: string };

/**
 * What each extracted record came to, in this process: verified once, then served.
 *
 * A COMMIT DOES NOT CHANGE, and the extracted copy of one is never rewritten (`materialize`), so the
 * same bytes would only verify the same way again. The verdict is kept for the life of the process
 * and never on disk: a command line verifies at every run, and the server a host keeps up verifies
 * once per connection, which is what lets the edit gate read the inherited rules at each write
 * without verifying at each write. A record that did not verify is kept too: it is the same bytes.
 */
const READ_IN_THIS_PROCESS = new Map<string, RecordRead>();

/** The decisions in force of one extracted record, once it verifies, or why it does not. */
function readRecord(root: string): RecordRead {
  const known = READ_IN_THIS_PROCESS.get(root);
  if (known !== undefined) return known;
  const read = verifyAndRead(root);
  READ_IN_THIS_PROCESS.set(root, read);
  return read;
}

function verifyAndRead(root: string): RecordRead {
  try {
    const upcasters = catalogUpcasters();
    const verdict = verify(root, upcasters);
    if (!verdict.ok) return { ok: false, why: whyNotRead(verdict) };
    const { decisions, addressing } = withCache(root, upcasters, (cache) => {
      const inForce = brief([{ scope: 'public', chainRoot: root, cache }], {
        editPush: EDIT_PUSH_CHANNEL,
        asksAPerson: ASKS_A_PERSON_CHANNEL,
        refusesAWrite: REFUSES_A_WRITE_CHANNEL,
      }).decisions.map((d): InheritedRule => {
        const held = cache.getDecision(d.id);
        return {
          id: d.id,
          adr: d.adr,
          title: d.title,
          rationale: held?.rationale ?? '',
          ...(held?.alternatives !== undefined ? { alternatives: held.alternatives } : {}),
          state: held?.state ?? 'accepted',
          ...(d.acceptance !== undefined ? { acceptance: d.acceptance } : {}),
          addresses: ADDRESS_RELATIONS.flatMap((rel) =>
            cache
              .linksByRelation(rel)
              .filter((edge) => edge.subject === d.id)
              .map((edge) => edge.target)
              .sort()
              .map((target) => ({ rel, target })),
          ),
        };
      });
      const standing = new Set(inForce.map((d) => d.id));
      // A rule the record places at an address: one of its decisions in force, or a rule it does
      // not hold at all (its address is the origin's, the rule the project's). A decision of its
      // own that is not in force places nothing, as the project's own count has it.
      const placed = (rel: string): number =>
        new Set(
          cache
            .linksByRelation(rel)
            .map((edge) => edge.subject)
            .filter(
              (id) =>
                standing.has(id) || (cache.getDecision(id) === null && cache.getSkill(id) === null),
            ),
        ).size;
      return {
        decisions: inForce,
        addressing: {
          governs: placed(GOVERNS_RELATION),
          asks: placed(ASKS_FOR_A_PERSON_RELATION),
          refuses: placed(REFUSES_A_WRITE_RELATION),
        },
      };
    });
    return { ok: true, decisions, addressing };
  } catch (error) {
    return { ok: false, why: (error as Error).message };
  }
}

/**
 * Reads the record a pointer names, at that commit.
 *
 * It reads what this machine already holds and never asks the where for a commit it lacks.
 */
export function readInherited(trees: ResolvedTrees, pointer: Pointer): InheritedReading {
  return readAt(trees, pointer).reading;
}

/** {@link readInherited}, with the extracted record's root when it was read. */
function readAt(
  trees: ResolvedTrees,
  pointer: Pointer,
): { readonly reading: InheritedReading; readonly root?: string } {
  const home = homeOf(trees, pointer.where);
  // A COMMIT ALREADY EXTRACTED IS READ WITHOUT ASKING GIT: it was held when it was extracted, and
  // the copy is never rewritten. That keeps a process off the edit gate's path (`git cat-file`).
  const extracted = join(home, 'at', pointer.commit, '.mnema');
  let root: string = extracted;
  if (!existsSync(extracted)) {
    const fresh = extract(home, pointer);
    if (typeof fresh !== 'string') return { reading: fresh };
    root = fresh;
  }
  const read = readRecord(root);
  return read.ok
    ? {
        reading: {
          state: 'read',
          pointer,
          decisions: read.decisions,
          addressing: read.addressing,
        },
        root,
      }
    : { reading: { state: 'unverified', pointer, why: read.why } };
}

/** The extracted `.mnema/` of the pinned commit, or the reading that says why there is none. */
function extract(home: string, pointer: Pointer): string | InheritedReading {
  let root: string;
  try {
    const repo = repoOf(home);
    if (!holds(repo, pointer.commit)) {
      return {
        state: 'unavailable',
        pointer,
        why: 'inherited record not fetched yet: run `mnema inherit update`',
      };
    }
    try {
      root = materialize(home, repo, pointer.commit);
    } catch {
      return { state: 'unverified', pointer, why: 'that commit holds no mnema record' };
    }
  } catch (error) {
    return { state: 'unavailable', pointer, why: (error as Error).message };
  }
  return root;
}

/** What the project's own pointer reads as, or `undefined` when it inherits nothing. */
export function readProjectInherited(trees: ResolvedTrees): InheritedReading | undefined {
  return inheritedTreeOf(trees)?.reading;
}

/**
 * The record a project inherits, as one more TREE an address reading can take once it verifies:
 * its root, the project it addresses, and where it came from (`ScopedCache.inherited`).
 */
export interface InheritedTree {
  readonly scope: 'public';
  readonly chainRoot: string;
  readonly project: string;
  readonly inherited: InheritedFrom;
}

/**
 * What the project's pointer reads as, and the tree to add to an address reading when it was read:
 * `undefined` when the project inherits nothing, which costs one file test. Every reading that
 * lists the rules over a path takes the tree from here ({@link withInheritedSource} on the command
 * line, the server's own registry for a connection), so the gate and the readers name the same
 * inherited rules.
 */
export function inheritedTreeOf(
  trees: ResolvedTrees,
): { readonly reading: InheritedReading; readonly tree?: InheritedTree } | undefined {
  if (trees.projectPublic === undefined) return undefined;
  const found = readPointer(trees.projectPublic);
  if (found.state === 'absent') return undefined;
  if (found.state === 'invalid') return { reading: found };
  const { reading, root } = readAt(trees, found.pointer);
  if (root === undefined || reading.state !== 'read') return { reading };
  return {
    reading,
    tree: {
      scope: 'public',
      chainRoot: root,
      project: dirname(trees.projectPublic),
      inherited: { origin: found.pointer.where, commit: found.pointer.commit },
    },
  };
}

/**
 * Hands `read` the project's sources with the inherited record added as one more, when the project
 * inherits one that verifies, and what reading the pointer came to (`undefined` when it inherits
 * nothing). The cache over the inherited record is opened and closed around `read`.
 */
export function withInheritedSource<T>(
  trees: ResolvedTrees,
  sources: readonly ScopedCache[],
  read: (all: readonly ScopedCache[], inherited: InheritedReading | undefined) => T,
): T {
  const found = inheritedTreeOf(trees);
  const tree = found?.tree;
  if (tree === undefined) return read(sources, found?.reading);
  return withCache(tree.chainRoot, catalogUpcasters(), (cache) =>
    read([...sources, { ...tree, cache }], found?.reading),
  );
}

/**
 * Whose ADDRESS a gate's opening sentence names: the project's record, the record it inherits, or
 * either, so a text that refuses or asks never says an inherited address is one the project made.
 * It names who placed the rule at the path and not who holds it: the record this project inherits
 * may address a rule of the project, and it is that address that refuses or asks here.
 */
export function aRuleOf(rules: readonly { readonly inherited?: InheritedFrom }[]): string {
  const inherited = rules.filter((rule) => rule.inherited !== undefined).length;
  if (inherited === 0) return 'A rule of this project’s record';
  return inherited === rules.length
    ? 'A rule addressed here by the record this project inherits'
    : 'A rule addressed here by this project’s record or by the record it inherits';
}

/** How a line names where an inherited rule comes from: the origin and the commit, short. */
export function inheritedFromText(from: InheritedFrom): string {
  // The repository the rule was inherited from, which is not a provenance (`derived-from`): named
  // apart so the word a provenance is introduced with keeps its one source.
  const repository = from.origin;
  return `inherited from ${oneLine(repository)} at ${oneLine(from.commit.slice(0, 12))}`;
}

/**
 * The sentence a reader of the rules over a path owes when the project points at a record that was
 * NOT read: none of that record's rules govern here, and this says why. Undefined when the record
 * was read or the project inherits nothing.
 */
export function inheritedNotReadLine(reading: InheritedReading | undefined): string | undefined {
  if (reading === undefined || reading.state === 'read') return undefined;
  const where =
    reading.state === 'invalid'
      ? `the ${POINTER_FILE} of this project`
      : `${oneLine(reading.pointer.where)} at ${oneLine(reading.pointer.commit.slice(0, 12))}`;
  return `No rule of the record this project inherits governs here: ${where} was not read (${oneLine(reading.why)}).`;
}

/** The commit a revision of the where names, after fetching, or why none. */
export function resolveAtOrigin(
  trees: ResolvedTrees,
  where: string,
  rev: string | undefined,
):
  | { readonly ok: true; readonly commit: string }
  | {
      readonly ok: false;
      readonly reason: 'UNREACHABLE' | 'NO_SUCH_REVISION';
      readonly detail: string;
    } {
  const projectRoot = dirname(trees.projectPublic as string);
  if (rev?.startsWith('-') === true) {
    return { ok: false, reason: 'NO_SUCH_REVISION', detail: `${rev} is not a revision` };
  }
  let repo: string;
  try {
    repo = repoOf(homeOf(trees, where));
    fetchOrigin(repo, sourceOf(where, projectRoot));
  } catch (error) {
    return { ok: false, reason: 'UNREACHABLE', detail: (error as Error).message };
  }
  const candidates = rev === undefined ? ['refs/mnema/head'] : [rev, `refs/mnema/heads/${rev}`];
  for (const candidate of candidates) {
    try {
      const commit = String(
        git(['-C', repo, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]),
      ).trim();
      if (COMMIT.test(commit)) return { ok: true, commit };
    } catch {
      // try the next spelling
    }
  }
  return {
    ok: false,
    reason: 'NO_SUCH_REVISION',
    detail: rev === undefined ? `${where} has no HEAD commit` : `${where} has no revision ${rev}`,
  };
}

/** How many commits lie between two, when this machine holds both. */
export function commitsBetween(
  trees: ResolvedTrees,
  where: string,
  from: string,
  to: string,
): number | undefined {
  try {
    const repo = repoOf(homeOf(trees, where));
    return Number(String(git(['-C', repo, 'rev-list', '--count', `${from}..${to}`])).trim());
  } catch {
    return undefined;
  }
}
