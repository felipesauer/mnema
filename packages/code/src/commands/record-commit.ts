/**
 * `mnema record commit [--through <decision>]`: the record's committed tree, cut at a signed
 * checkpoint, made a commit on a branch of its own for a pull request (ADR-104, ADR-145).
 *
 * WHY IT EXISTS. A writer appends to a tail and commits nothing; the events reach git when a person
 * cuts them by hand into a pull request, and measured in this repository an event waited 10.8 h on
 * average for that. A tail can be committed in pieces without changing the format: a prefix of a
 * tail that ends where one of its checkpoints ends verifies, and `verify --since` reads it as the
 * base grown (FORMAT.md section 6: a checkpoint covers a contiguous range, never more than the tail
 * held). This makes that cut, and only that cut:
 *
 *   1. THE BASE is the branch the remote calls its default, as this clone last read it: the remote
 *      is the one the current branch follows, else the only one, else `origin`; the default branch
 *      is what `refs/remotes/<remote>/HEAD` names (set by `git clone`, or by `git remote set-head`).
 *      Nothing is read from the network: where that ref is missing it refuses and says how to set
 *      it, and it says how long ago the base was last updated. Every tail file the base holds must
 *      be the start of the one here ({@link joinGrownTail}, the rule `record pull` and the merge
 *      driver ask), or it refuses naming the tail and pointing at `mnema record pull`.
 *   2. THE CUT, per tail of the committed tree: through its last checkpoint, or, for the tail that
 *      holds the recording of the decision `--through` names, through the first checkpoint that
 *      covers that recording; never below what the base holds. Events above the cut stay out and
 *      are counted. What enters is what the cut needs to verify and nothing else: the segments and
 *      `checkpoints.jsonl` cut there, the tail proof, and each key file a line it carries names
 *      (the key that signs a tail, a key it enrols or declares), all asked of the binary in
 *      `the-record-reaches-git-through-a-pull-request.test.ts`. It is also meant to carry the
 *      witness files of the checkpoints it carries, which no case there asks: it holds no witness.
 *      Nothing of the private tree, the global tree or any file outside the record's folder; the
 *      files that are not part of the proof (`README.md`, `.gitattributes`, `inherit.json`) stay
 *      as the base has them, and are named when they differ.
 *   3. THE COMMIT is built with git's plumbing over the base's tree: blobs, a temporary index,
 *      `write-tree`, `commit-tree` and `update-ref` of a new branch. The working tree, the index and
 *      HEAD are not touched. `commit-tree` does not read `commit.gpgSign` (measured on git 2.55: it
 *      wrote an unsigned commit where `git commit` refused for the failing signer), so this reads
 *      it and passes `-S` when it is set, which signs with the key and the format the clone's own
 *      configuration names, as `git commit` would.
 *   4. BEFORE A BRANCH EXISTS the tree is checked out, alone, into a temporary repository that
 *      borrows this one's objects, and the readers rule on it: `verify` at the signed level and
 *      `verify --since <base>`. Where either fails it refuses, and no branch is made.
 *   5. It PRINTS what to run next, `git push` and the forge's command to open the pull request,
 *      chosen from the remote's address; it pushes nothing and calls no forge (ADR-145).
 *   6. The branch is named from the cut, with a digest of the checkpoints it ends at, so running it
 *      again with nothing new says the branch is there, and a base that holds the cut says there is
 *      nothing to commit.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkpointHash, parseCheckpoint } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { type DecisionFacts, nameOf, readDecisionFacts } from '../decisions-in-git.js';
import { withTreesRead } from '../tree-sources.js';
import { joinGrownTail } from './record-merge-tail.js';
import { runVerify } from './verify.js';
import { sinceBase, sinceHolds } from './verify-since.js';

/** What `record commit` needs: injected so it is testable against a sandbox. */
export interface RecordCommitContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /** The environment git runs with. */
  readonly processEnv: NodeJS.ProcessEnv;
  /** Now, in milliseconds: how old the base is, is said against it. */
  readonly now: number;
}

/** A tail file here that does not grow from the base's copy. */
export interface NotGrown {
  readonly tail: string;
  /** The path from the repository's top. */
  readonly path: string;
  readonly said: string;
}

export type RecordCommitRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | { readonly ok: false; readonly reason: 'NOT_A_REPOSITORY' }
  | { readonly ok: false; readonly reason: 'NO_REMOTE'; readonly remotes: readonly string[] }
  | { readonly ok: false; readonly reason: 'NO_DEFAULT_BRANCH'; readonly remote: string }
  | { readonly ok: false; readonly reason: 'NOT_A_PREFIX'; readonly found: readonly NotGrown[] }
  | { readonly ok: false; readonly reason: 'NO_SUCH_DECISION'; readonly typed: string }
  | {
      readonly ok: false;
      readonly reason: 'AMBIGUOUS_LABEL';
      readonly typed: string;
      readonly ids: readonly string[];
    }
  | { readonly ok: false; readonly reason: 'NOT_COVERED'; readonly typed: string }
  | { readonly ok: false; readonly reason: 'GIT_FAILED'; readonly said: string }
  | { readonly ok: false; readonly reason: 'DOES_NOT_VERIFY'; readonly said: readonly string[] };

/** The branch the cut is put on top of. */
export interface Base {
  readonly remote: string;
  /** The default branch, as the remote names it (`main`). */
  readonly branch: string;
  /** The remote-tracking ref (`origin/main`). */
  readonly ref: string;
  readonly commit: string;
  /** How long ago this clone last updated that ref, in hours, when git keeps it. */
  readonly hoursOld?: number;
}

/** What one tail brings. */
export interface TailCut {
  readonly tail: string;
  /** Events the commit adds to what the base holds of this tail. */
  readonly events: number;
  /** The last sequence number the commit carries. */
  readonly throughSeq: number;
  /** Events of this tail that stay above the cut. */
  readonly left: number;
}

/** A decision a line of the cut records or moves, as the committed tree reads it. */
export interface CutDecision {
  readonly id: string;
  readonly adr: string;
  readonly state: string;
  readonly title: string;
}

/** What stays out of the commit. */
export interface LeftOut {
  /** Events above the cut, every tail of the committed tree counted. */
  readonly events: number;
  /** Files of the record that differ from the base and that the commit does not carry. */
  readonly files: readonly string[];
}

/** The commands a person runs next; the verb runs neither. */
export interface NextCommands {
  readonly push: string;
  readonly forge: 'github' | 'gitlab' | 'other';
  /** The forge's command, or, for a forge this does not know, what to do in words. */
  readonly open: string;
}

export type RecordCommitDone =
  | { readonly ok: true; readonly kind: 'nothing'; readonly base: Base; readonly left: LeftOut }
  | {
      readonly ok: true;
      readonly kind: 'exists' | 'made';
      readonly base: Base;
      readonly branch: string;
      readonly commit: string;
      readonly title: string;
      readonly body: string;
      readonly tails: readonly TailCut[];
      readonly decisions: readonly CutDecision[];
      readonly left: LeftOut;
      readonly next: NextCommands;
    };

/** A base older than this is said to be worth updating before the cut. */
export const STALE_AFTER_HOURS = 1;

type Ran = { readonly status: number; readonly out: Buffer; readonly err: string };

/** A git with automatic maintenance off; bytes out, so a tail is read as it is. */
function git(
  ctx: RecordCommitContext,
  cwd: string,
  args: readonly string[],
  extra: { readonly input?: Buffer; readonly env?: NodeJS.ProcessEnv } = {},
): Ran {
  const ran = spawnSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], {
    cwd,
    env: { ...ctx.processEnv, ...extra.env },
    maxBuffer: 1 << 30,
    ...(extra.input !== undefined ? { input: extra.input } : {}),
  });
  return {
    status: ran.status ?? -1,
    out: ran.stdout ?? Buffer.alloc(0),
    err: ran.stderr?.toString('utf-8') ?? String(ran.error ?? ''),
  };
}

function said(ran: Ran): string | undefined {
  return ran.status === 0 ? ran.out.toString('utf-8').trim() : undefined;
}

/** The complete lines of a file: each one's end, past its newline. A last piece without one is not a line. */
function lineEnds(bytes: Uint8Array): number[] {
  const ends: number[] = [];
  for (let at = 0; at < bytes.length; at++) if (bytes[at] === 0x0a) ends.push(at + 1);
  return ends;
}

const SEGMENT = /^\d{6}\.jsonl$/;
const CHECKPOINTS = 'checkpoints.jsonl';
const TAILPROOF = 'tailproof.json';
const FINGERPRINT = /^[0-9a-f]{64}$/;

/** One event of a tail, as the cut needs to read it. */
interface EventLine {
  readonly segment: string;
  readonly end: number;
  readonly seq: number | undefined;
  readonly kind: string | undefined;
  readonly subject: string | undefined;
  readonly adr: string | undefined;
}

function readEvent(segment: string, line: Buffer, end: number): EventLine {
  try {
    const stored = JSON.parse(line.toString('utf-8')) as {
      event?: { kind?: unknown; subject?: unknown; payload?: { adr?: unknown } };
      link?: { seq?: unknown };
    };
    const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
    return {
      segment,
      end,
      seq: typeof stored.link?.seq === 'number' ? stored.link.seq : undefined,
      kind: text(stored.event?.kind),
      subject: text(stored.event?.subject),
      adr: text(stored.event?.payload?.adr),
    };
  } catch {
    return { segment, end, seq: undefined, kind: undefined, subject: undefined, adr: undefined };
  }
}

/** A tail of the committed tree as this clone holds it. */
interface LocalTail {
  readonly id: string;
  readonly segments: readonly string[];
  readonly events: readonly EventLine[];
  /** Each checkpoint: its line's end, the last seq it covers, and its hash. */
  readonly checkpoints: readonly {
    readonly end: number;
    readonly toSeq: number;
    readonly hash: string;
  }[];
  readonly bytes: ReadonlyMap<string, Buffer>;
}

function readTail(dir: string, id: string): LocalTail {
  const names = readdirSync(dir).sort();
  const bytes = new Map<string, Buffer>();
  const segments = names.filter((name) => SEGMENT.test(name));
  const events: EventLine[] = [];
  for (const segment of segments) {
    const held = readFileSync(join(dir, segment));
    bytes.set(segment, held);
    let start = 0;
    for (const end of lineEnds(held)) {
      if (end - start > 1) events.push(readEvent(segment, held.subarray(start, end - 1), end));
      start = end;
    }
  }
  const checkpoints: { end: number; toSeq: number; hash: string }[] = [];
  if (names.includes(CHECKPOINTS)) {
    const held = readFileSync(join(dir, CHECKPOINTS));
    bytes.set(CHECKPOINTS, held);
    let start = 0;
    for (const end of lineEnds(held)) {
      const line = held.subarray(start, end - 1).toString('utf-8');
      start = end;
      if (line === '') continue;
      try {
        const checkpoint = parseCheckpoint(line);
        checkpoints.push({ end, toSeq: checkpoint.toSeq, hash: checkpointHash(checkpoint) });
      } catch {
        // A line no reader would take ends the checkpoints this can cut at.
        break;
      }
    }
  }
  return { id, segments, events, checkpoints, bytes };
}

/** The decisions of the committed tree at `root` (its `.mnema/`), read in memory. */
function decisionsOf(root: string): DecisionFacts[] {
  return withTreesRead([{ scope: 'public', chainRoot: root }], (sources) =>
    readDecisionFacts(sources, dirname(root)),
  );
}

/** Quotes one word for a POSIX shell. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The host a remote's address names, lower-cased, without credentials or port. */
export function remoteHost(url: string): string | undefined {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i.exec(url);
  if (withScheme?.[1] !== undefined) return withScheme[1].toLowerCase();
  const scpLike = /^(?:[^@/]+@)?([^/:]+):(?!\/\/)/.exec(url);
  return scpLike?.[1]?.toLowerCase();
}

/**
 * The commands that publish the branch and open its pull request: `git push`, then the forge's
 * own command where the remote's host is GitHub's or GitLab's, or a sentence where it is neither.
 * No address is printed: one may carry a credential.
 */
export function nextCommands(input: {
  readonly url: string | undefined;
  readonly remote: string;
  readonly base: string;
  readonly branch: string;
  readonly title: string;
  readonly body: string;
}): NextCommands {
  const push = `git push -u ${shellWord(input.remote)} ${shellWord(input.branch)}`;
  const host = input.url === undefined ? undefined : remoteHost(input.url);
  const [title, body, base, head] = [input.title, input.body, input.base, input.branch].map(
    shellWord,
  );
  if (host === 'github.com' || host === 'ssh.github.com') {
    return {
      push,
      forge: 'github',
      open: `gh pr create --base ${base} --head ${head} --title ${title} --body ${body}`,
    };
  }
  if (host !== undefined && /(?:^|\.)gitlab\./.test(host)) {
    return {
      push,
      forge: 'gitlab',
      open: `glab mr create --target-branch ${base} --source-branch ${head} --title ${title} --description ${body}`,
    };
  }
  return {
    push,
    forge: 'other',
    open: `open a pull request from ${input.branch} into ${input.base} on the forge that hosts ${input.remote}, titled "${input.title}"`,
  };
}

/** `ADR-12` as 12, for the order labels are said in; a label of another shape goes last. */
function labelNumber(adr: string): number {
  const n = /^ADR-(\d+)$/.exec(adr)?.[1];
  return n === undefined ? Number.MAX_SAFE_INTEGER : Number(n);
}

/** The pull request's title, the commit's subject: what the cut carries, with no name or path. */
export function cutTitle(labels: readonly string[], events: number): string {
  const events1 = `${events} event${events === 1 ? '' : 's'}`;
  if (labels.length === 0) return `Record ${events1}`;
  if (labels.length === 1) return `Record ${labels[0]}`;
  if (labels.length === 2) return `Record ${labels[0]} and ${labels[1]}`;
  return `Record ${labels.length} decisions, ${labels[0]} to ${labels[labels.length - 1]}`;
}

/** The branch the cut is put on: from the labels it carries and a digest of where it ends. */
export function cutBranch(labels: readonly string[], digest: string): string {
  const first = labels[0];
  const last = labels[labels.length - 1];
  const words =
    first === undefined || last === undefined
      ? 'events'
      : first === last
        ? first.toLowerCase()
        : `${first.toLowerCase()}-to-${last.slice(4)}`;
  return `mnema-record/${words.replace(/[^a-z0-9-]/g, '-')}-${digest}`;
}

/** Cuts the committed tree here at a signed checkpoint and makes it a commit on a branch of its own. */
export function runRecordCommit(
  ctx: RecordCommitContext,
  input: { readonly through?: string },
): RecordCommitDone | RecordCommitRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const record = trees.projectPublic;
  const top = said(git(ctx, record, ['rev-parse', '--show-toplevel']));
  const prefix = said(git(ctx, record, ['rev-parse', '--show-prefix']));
  if (top === undefined || prefix === undefined || prefix === '') {
    return { ok: false, reason: 'NOT_A_REPOSITORY' };
  }
  const recordDir = prefix.endsWith('/') ? prefix : `${prefix}/`;

  // 1. The base: the default branch of the remote, as this clone last read it.
  const remotes = (said(git(ctx, top, ['remote'])) ?? '').split('\n').filter(Boolean);
  const current = said(git(ctx, top, ['symbolic-ref', '--quiet', '--short', 'HEAD']));
  const followed =
    current === undefined ? undefined : said(git(ctx, top, ['config', `branch.${current}.remote`]));
  const remote =
    followed !== undefined && remotes.includes(followed)
      ? followed
      : remotes.length === 1
        ? remotes[0]
        : remotes.includes('origin')
          ? 'origin'
          : undefined;
  if (remote === undefined) return { ok: false, reason: 'NO_REMOTE', remotes };
  const headRef = said(git(ctx, top, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]));
  const tracking = `refs/remotes/${remote}/`;
  const commit =
    headRef === undefined
      ? undefined
      : said(git(ctx, top, ['rev-parse', '--verify', '--quiet', `${headRef}^{commit}`]));
  if (headRef === undefined || !headRef.startsWith(tracking) || commit === undefined) {
    return { ok: false, reason: 'NO_DEFAULT_BRANCH', remote };
  }
  const branch = headRef.slice(tracking.length);
  const updated = said(
    git(ctx, top, ['reflog', 'show', '-1', '--date=unix', '--format=%gd', headRef]),
  );
  const at = /@\{(\d+)\}$/.exec(updated ?? '')?.[1];
  const base: Base = {
    remote,
    branch,
    ref: `${remote}/${branch}`,
    commit,
    ...(at !== undefined
      ? { hoursOld: Math.max(0, Math.floor((ctx.now / 1000 - Number(at)) / 3600)) }
      : {}),
  };

  // What the base holds of the record, by path from the top.
  const held = new Set(
    git(ctx, top, ['ls-tree', '-r', '-z', '--name-only', commit, '--', recordDir])
      .out.toString('utf-8')
      .split('\0')
      .filter(Boolean),
  );
  const heldBytes = (path: string): Buffer | undefined => {
    if (!held.has(path)) return undefined;
    const blob = git(ctx, top, ['cat-file', 'blob', `${commit}:${path}`]);
    return blob.status === 0 ? blob.out : undefined;
  };

  // The tails of the committed tree here.
  const tailsDir = join(record, 'tails');
  const tails = existsSync(tailsDir)
    ? readdirSync(tailsDir)
        .filter((id) => statSync(join(tailsDir, id)).isDirectory())
        .sort()
        .map((id) => readTail(join(tailsDir, id), id))
    : [];

  // Every tail file the base holds must be the start of the one here.
  const found: NotGrown[] = [];
  for (const path of held) {
    const rest = path.slice(recordDir.length).split('/');
    if (rest[0] !== 'tails' || rest.length !== 3) continue;
    const [, id, name] = rest as [string, string, string];
    if (!SEGMENT.test(name) && name !== CHECKPOINTS && name !== TAILPROOF) continue;
    const here = join(tailsDir, id, name);
    const theirs = heldBytes(path);
    if (theirs === undefined) continue;
    if (!existsSync(here)) {
      if (!existsSync(join(tailsDir, id))) continue; // A tail only the base holds: kept as it is.
      found.push({ tail: id, path, said: `${path}: on ${base.ref}, and not here.` });
      continue;
    }
    const ours = readFileSync(here);
    const joined = joinGrownTail(ours, theirs);
    if (joined.kind === 'same') continue;
    if (name !== TAILPROOF && joined.kind === 'longer' && joined.side === 'ours') continue;
    found.push({
      tail: id,
      path,
      said:
        joined.kind === 'fork'
          ? `${path}: this clone and ${base.ref} part at line ${joined.line}, a fork.`
          : name === TAILPROOF
            ? `${path}: holds other bytes than on ${base.ref}.`
            : `${path}: ${base.ref} holds more of it than this clone does.`,
    });
  }
  if (found.length > 0) return { ok: false, reason: 'NOT_A_PREFIX', found };

  // `--through`: the decision, among those of the committed tree here, and the tail that records it.
  let throughTail: { readonly id: string; readonly seq: number } | undefined;
  if (input.through !== undefined) {
    const named = nameOf(decisionsOf(record), input.through);
    if (named.kind === 'none') {
      return { ok: false, reason: 'NO_SUCH_DECISION', typed: input.through };
    }
    if (named.kind === 'ambiguous') {
      return { ok: false, reason: 'AMBIGUOUS_LABEL', typed: input.through, ids: named.ids };
    }
    for (const tail of tails) {
      const recorded = tail.events.find(
        (event) => event.kind === 'decision.recorded' && event.subject === named.decision.id,
      );
      if (recorded?.seq !== undefined) {
        throughTail = { id: tail.id, seq: recorded.seq };
        break;
      }
    }
    if (throughTail === undefined) {
      return { ok: false, reason: 'NOT_COVERED', typed: input.through };
    }
    const seq = throughTail.seq;
    const tail = tails.find((one) => one.id === throughTail?.id);
    if (tail?.checkpoints.find((one) => one.toSeq >= seq) === undefined) {
      return { ok: false, reason: 'NOT_COVERED', typed: input.through };
    }
  }

  // 2. The cut, per tail.
  const writes = new Map<string, Buffer>();
  const cuts: TailCut[] = [];
  const ends: string[] = [];
  const moved = new Set<string>();
  const labelOf = new Map<string, string>();
  let leftEvents = 0;
  for (const tail of tails) {
    for (const event of tail.events) {
      if (event.kind === 'decision.recorded' && event.subject !== undefined && event.adr) {
        labelOf.set(event.subject, event.adr);
      }
    }
    const at = (name: string) => `${recordDir}tails/${tail.id}/${name}`;
    const baseEvents = tail.segments.reduce((sum, segment) => {
      const theirs = heldBytes(at(segment));
      return sum + (theirs === undefined ? 0 : lineEnds(theirs).length);
    }, 0);
    const wanted =
      throughTail?.id === tail.id
        ? tail.checkpoints.findIndex((one) => one.toSeq >= (throughTail?.seq ?? 0))
        : tail.checkpoints.length - 1;
    // Never below what the base holds: the first checkpoint that covers all of it, if that is later.
    const floor = tail.checkpoints.findIndex((one) => one.toSeq + 1 >= baseEvents);
    const chosen = wanted === -1 || floor === -1 ? -1 : Math.max(wanted, floor);
    const checkpoint = tail.checkpoints[chosen];
    if (checkpoint === undefined) {
      leftEvents += Math.max(0, tail.events.length - baseEvents);
      continue;
    }
    const carried = checkpoint.toSeq + 1;
    const lastCarried = tail.events[carried - 1];
    let grew = false;
    const put = (name: string, bytes: Buffer) => {
      const theirs = heldBytes(at(name));
      if (theirs?.equals(bytes)) return;
      writes.set(at(name), bytes);
      grew = true;
    };
    for (const segment of tail.segments) {
      const inIt = tail.events.slice(0, carried).filter((event) => event.segment === segment);
      const last = inIt[inIt.length - 1];
      if (last === undefined) continue;
      put(segment, (tail.bytes.get(segment) as Buffer).subarray(0, last.end));
    }
    put(CHECKPOINTS, (tail.bytes.get(CHECKPOINTS) as Buffer).subarray(0, checkpoint.end));
    leftEvents += Math.max(0, tail.events.length - carried);
    if (!grew) continue;
    const proof = join(tailsDir, tail.id, TAILPROOF);
    if (!held.has(at(TAILPROOF)) && existsSync(proof))
      writes.set(at(TAILPROOF), readFileSync(proof));
    const covered = new Set(tail.checkpoints.slice(0, chosen + 1).map((one) => one.hash));
    const witness = join(tailsDir, tail.id, 'witness');
    if (existsSync(witness)) {
      for (const name of readdirSync(witness).sort()) {
        if (!covered.has(name.split('.')[0] ?? '')) continue;
        const bytes = readFileSync(join(witness, name));
        const theirs = heldBytes(at(`witness/${name}`));
        if (theirs === undefined || !theirs.equals(bytes)) writes.set(at(`witness/${name}`), bytes);
      }
    }
    for (const event of tail.events.slice(baseEvents, carried)) {
      if (event.kind?.startsWith('decision.') && event.subject !== undefined)
        moved.add(event.subject);
    }
    ends.push(`${tail.id} ${checkpoint.hash}`);
    cuts.push({
      tail: tail.id,
      events: carried - baseEvents,
      throughSeq: lastCarried?.seq ?? checkpoint.toSeq,
      left: Math.max(0, tail.events.length - carried),
    });
  }

  // The key files the cut names: the key that signs a tail it carries, a key a line of it names.
  const carriedBytes = [...writes.values()];
  const keysDir = join(record, 'keys');
  if (existsSync(keysDir)) {
    for (const name of readdirSync(keysDir).sort()) {
      const fp = name.endsWith('.pub') ? name.slice(0, -4) : '';
      const path = `${recordDir}keys/${name}`;
      if (!FINGERPRINT.test(fp) || held.has(path)) continue;
      const named =
        cuts.some((cut) => cut.tail.startsWith(`${fp}-`)) ||
        carriedBytes.some((bytes) => bytes.includes(fp));
      if (named) writes.set(path, readFileSync(join(keysDir, name)));
    }
  }

  // The files of the record that differ from the base and stay out; a tail's own lines are counted as events.
  const differing = new Set([
    ...git(ctx, top, ['diff', '--name-only', '-z', '--no-renames', commit, '--', recordDir])
      .out.toString('utf-8')
      .split('\0'),
    ...git(ctx, top, ['ls-files', '-z', '--others', '--exclude-standard', '--', recordDir])
      .out.toString('utf-8')
      .split('\0'),
  ]);
  const leftFiles = [...differing]
    .filter((path) => path !== '' && !writes.has(path))
    .filter((path) => {
      const rest = path.slice(recordDir.length).split('/');
      const name = rest[2] ?? '';
      return !(
        rest[0] === 'tails' &&
        rest.length === 3 &&
        (SEGMENT.test(name) || name === CHECKPOINTS)
      );
    })
    .sort();
  const left: LeftOut = { events: leftEvents, files: leftFiles };
  if (writes.size === 0) return { ok: true, kind: 'nothing', base, left };

  // 3. The tree: the base's, with the cut's files in it, through an index of its own.
  const scratch = mkdtempSync(join(tmpdir(), 'mnema-record-commit-'));
  try {
    const index = { GIT_INDEX_FILE: join(scratch, 'index') };
    const failed = (ran: Ran) => ({
      ok: false as const,
      reason: 'GIT_FAILED' as const,
      said: ran.err.trim(),
    });
    const read = git(ctx, top, ['read-tree', commit], { env: index });
    if (read.status !== 0) return failed(read);
    for (const [path, bytes] of [...writes].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const blob = git(ctx, top, ['hash-object', '-w', '--no-filters', '--stdin'], {
        input: bytes,
      });
      const oid = said(blob);
      if (oid === undefined) return failed(blob);
      const added = git(
        ctx,
        top,
        ['update-index', '--add', '--cacheinfo', `100644,${oid},${path}`],
        {
          env: index,
        },
      );
      if (added.status !== 0) return failed(added);
    }
    const wrote = git(ctx, top, ['write-tree'], { env: index });
    const tree = said(wrote);
    if (tree === undefined) return failed(wrote);

    const digest = createHash('sha256').update(ends.sort().join('\n')).digest('hex').slice(0, 12);
    const existing = (
      said(
        git(ctx, top, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/mnema-record/']),
      ) ?? ''
    )
      .split('\n')
      .find((name) => name.endsWith(`-${digest}`));

    // 4. The readers, over the tree checked out alone, before any branch exists.
    const checked = checkTree(ctx, top, scratch, tree, recordDir, commit);
    if (!checked.ok) return { ok: false, reason: 'DOES_NOT_VERIFY', said: checked.said };
    const facts = new Map(checked.decisions.map((one) => [one.id, one]));
    const decisions: CutDecision[] = [...moved]
      .map((id) => {
        const fact = facts.get(id);
        return {
          id,
          adr: fact?.adr ?? labelOf.get(id) ?? id,
          state: fact?.state ?? 'unknown',
          title: fact?.title ?? '',
        };
      })
      .sort((a, b) => labelNumber(a.adr) - labelNumber(b.adr) || (a.id < b.id ? -1 : 1));
    const labels = decisions.map((one) => one.adr);
    const events = cuts.reduce((sum, cut) => sum + cut.events, 0);
    const title = cutTitle(labels, events);
    // One line, so the command printed to open the pull request is one line too.
    const body = `The record's events through a signed checkpoint of each tail: ${events} event${events === 1 ? '' : 's'} in ${cuts.length} tail${cuts.length === 1 ? '' : 's'}, made by mnema record commit and verified with verify --since ${base.ref}${decisions.length > 0 ? `; the decisions: ${decisions.map((one) => `${one.adr} ${one.state}`).join(', ')}` : ''}.`;
    const name = existing ?? cutBranch(labels, digest);
    const next = nextCommands({
      url: said(git(ctx, top, ['remote', 'get-url', remote])),
      remote,
      base: branch,
      branch: name,
      title,
      body,
    });
    const shape = { base, branch: name, title, body, tails: cuts, decisions, left, next };
    if (existing !== undefined) {
      const tip = said(git(ctx, top, ['rev-parse', '--verify', `refs/heads/${existing}^{commit}`]));
      return { ok: true, kind: 'exists', commit: tip ?? '', ...shape };
    }

    // 5. The commit, signed where the clone's configuration says `git commit` signs, and its branch.
    const sign =
      said(git(ctx, top, ['config', '--type=bool', '--get', 'commit.gpgSign'])) === 'true';
    const made = git(
      ctx,
      top,
      ['commit-tree', tree, '-p', commit, ...(sign ? ['-S'] : []), '-F', '-'],
      {
        input: Buffer.from(`${title}\n\n${body}\n`),
      },
    );
    const sha = said(made);
    if (sha === undefined) return failed(made);
    const ref = git(ctx, top, [
      'update-ref',
      '-m',
      'mnema record commit',
      `refs/heads/${name}`,
      sha,
      '',
    ]);
    if (ref.status !== 0) return failed(ref);
    return { ok: true, kind: 'made', commit: sha, ...shape };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The readers over `tree`'s record, checked out alone into a repository of its own that borrows
 * this one's objects, so nothing is written here: `verify` at the signed level, and `verify
 * --since` the base. With the decisions that tree reads, for what the output says of them.
 */
function checkTree(
  ctx: RecordCommitContext,
  top: string,
  scratch: string,
  tree: string,
  recordDir: string,
  base: string,
):
  | { readonly ok: true; readonly decisions: DecisionFacts[] }
  | { readonly ok: false; readonly said: string[] } {
  const repo = join(scratch, 'checkout');
  mkdirSync(repo);
  const objects = said(
    git(ctx, top, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']),
  );
  const steps: Ran[] = [git(ctx, repo, ['init', '-q', '--template=', '.'])];
  if (objects !== undefined && steps[0]?.status === 0) {
    writeFileSync(join(repo, '.git', 'objects', 'info', 'alternates'), `${objects}\n`);
    const path = recordDir.slice(0, -1);
    steps.push(git(ctx, repo, ['read-tree', `--prefix=${recordDir}`, `${tree}:${path}`]));
    steps.push(git(ctx, repo, ['checkout-index', '-a']));
  }
  const broke = steps.find((step) => step.status !== 0);
  if (objects === undefined || broke !== undefined) {
    return { ok: false, said: [`the tree could not be checked out: ${broke?.err.trim() ?? ''}`] };
  }
  const root = join(repo, recordDir.slice(0, -1));
  const verdict = runVerify({
    cwd: dirname(root),
    env: ctx.env,
    requirement: 'signed',
    global: false,
  });
  const problems: string[] = [];
  if (!verdict.ok) problems.push('verify found no record in the tree');
  else if (!verdict.record.ok || !verdict.requirementMet) {
    problems.push(
      `verify: ${verdict.record.ok ? `the tree reads ${verdict.record.level}, short of fully-signed` : 'the tree does not verify'}`,
    );
  }
  const since = sinceBase({ recordRoot: root, rev: base });
  if (!sinceHolds(since)) {
    problems.push(
      since.kind === 'refused'
        ? `verify --since: ${since.why}`
        : `verify --since: ${[...since.findings.map((one) => `${one.file} ${one.what}`), ...since.arrived.unnamed.map((tail) => `${tail} names no record`), ...since.arrived.foreign.flatMap((group) => group.tails.map((tail) => `${tail} names another record`))].join(', ')}`,
    );
  }
  if (problems.length > 0) return { ok: false, said: problems };
  return { ok: true, decisions: decisionsOf(root) };
}
