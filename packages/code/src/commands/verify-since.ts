/**
 * `mnema verify --since <rev>`: whether the record on disk is the record at `<rev>`, grown.
 *
 * WHAT `verify` CANNOT SEE, AND WHY THIS ASKS GIT. A record that is honest in every byte can
 * still be shorter than it was, or a different record altogether: the newest events cut with
 * the checkpoint that covered them, every tail deleted with every key, the record erased and
 * founded again, a key holder rewriting the middle and signing it again. Nothing inside the
 * directory remembers what it replaced, so no reading of the record alone can tell (the
 * fundamental limit `FORMAT.md` section 3 states), save that every tail deleted leaves a
 * record in which no tail holds anything, which the bare verdict refuses (section 4); one
 * tail deleted beside another still needs this. What does remember is the history the
 * project already keeps: the commit a change started from. This reads that commit's record
 * out of git and holds the disk to it.
 *
 * THE RULE, which is the one an append-only record obeys and nothing more: every file of the
 * committed tree that `<rev>` held under `tails/` and `keys/` is still on disk, and every
 * segment and `checkpoints.jsonl` still BEGINS with exactly the bytes it held there. A record
 * only grows at the end, so an honest change passes whatever it appended, and a witness proof
 * that was upgraded in place passes too (its presence is asked, not its bytes).
 *
 * AND A TAIL THAT ARRIVED IS THE BASE'S RECORD'S OWN (ADR-134, FORMAT.md section 6.10). A
 * directory alone cannot tell which of two records was there first, nor a tail written before
 * records were named from one grafted out of another record written then. The base can: a tail
 * on disk that it did not hold must name the record its tails were (the name they carry, or the
 * name of its genesis tail where none carries one). One that names no record is refused
 * (`born-unnamed`), and the tails that name another record are named as the ones that arrived
 * (`another-record`). A tail the base already held is not asked again: an unnamed one stays the
 * census note the bare verdict gives it.
 *
 * WHAT IT DOES NOT DO. It reads git and never the network: `<rev>` must already be in the
 * clone (a shallow CI checkout has no base, and is refused by name rather than passed). It
 * rules on the COMMITTED tree only: the private tree never travels, so git holds nothing of
 * it. It does not tell an authorized cut from tampering: a tail removed after a `tail.pruned`
 * fails here as well, which is the one change a reviewer has to look at. And it changes
 * nothing about the verdict when it is not asked for.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { type Arrivals, arrivalsSince, catalogUpcasters } from '@mnema/chain';

/** One file of the record at the base that the disk no longer holds as it was. */
export interface SinceFinding {
  /** The path, relative to the repository's root, as git names it. */
  readonly file: string;
  /** `gone`: not on disk. `rewritten`: on disk, and no longer begins with the base's bytes. */
  readonly what: 'gone' | 'rewritten';
}

/** What holding the disk to the base said. */
export type SinceReading =
  | {
      readonly kind: 'read';
      /** The revision as the caller wrote it. */
      readonly rev: string;
      /** The commit it named. */
      readonly commit: string;
      /** How many files of the record the base held: what was compared. */
      readonly held: number;
      readonly findings: readonly SinceFinding[];
      /**
       * The tails on disk that the base did not hold and that are not the base's record: those
       * that name no record, and those that name another (FORMAT.md section 6.10).
       */
      readonly arrived: Arrivals;
    }
  | { readonly kind: 'refused'; readonly rev: string; readonly why: string };

/**
 * Whether the record on disk is the base's record grown: compared, no file of the base gone or
 * rewritten, and no tail arrived that names no record or another record than the base's.
 */
export function sinceHolds(since: SinceReading): boolean {
  return (
    since.kind === 'read' &&
    since.findings.length === 0 &&
    since.arrived.unnamed.length === 0 &&
    since.arrived.foreign.length === 0
  );
}

/** The files whose bytes may only grow at the end: the segments and the checkpoints. */
const GROWS_AT_THE_END = /(?:^|\/)(?:checkpoints|\d{6})\.jsonl$/;

/** Git that writes nothing, not even an index refresh. */
const READ_ONLY = ['-c', 'core.fsmonitor=false', '--no-optional-locks'];

/** A segment is capped at a few MiB; this leaves room for any file a record holds. */
const GIT_MAX_BYTES = 256 * 1024 * 1024;

function git(cwd: string, args: readonly string[]): Buffer | null {
  const ran = spawnSync('git', [...READ_ONLY, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: GIT_MAX_BYTES,
  });
  if (ran.error !== undefined || ran.status !== 0) return null;
  return ran.stdout;
}

/**
 * Holds the committed record at `recordRoot` (a project's `.mnema/`) to the one `rev` held.
 */
export function sinceBase(ask: {
  /** The project's committed record, its `.mnema/`. */
  readonly recordRoot: string;
  /** The revision to hold it to, as the caller wrote it. */
  readonly rev: string;
}): SinceReading {
  const { recordRoot, rev } = ask;
  const top = git(recordRoot, ['rev-parse', '--show-toplevel'])?.toString('utf-8').trim();
  if (top === undefined || top === '') {
    return { kind: 'refused', rev, why: 'the record is not inside a git repository' };
  }
  const commit = git(recordRoot, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])
    ?.toString('utf-8')
    .trim();
  if (commit === undefined || commit === '') {
    return {
      kind: 'refused',
      rev,
      why: 'no commit by that name is in this clone (a shallow checkout holds no base: clone the history it needs)',
    };
  }
  const record = relative(realpathSync(top), realpathSync(recordRoot)).split(sep).join('/');
  const listed = git(top, [
    'ls-tree',
    '-r',
    '-z',
    '--name-only',
    commit,
    '--',
    `${record}/tails`,
    `${record}/keys`,
  ]);
  if (listed === null) {
    return { kind: 'refused', rev, why: 'git could not list the record that commit held' };
  }
  const files = listed.toString('utf-8').split('\0').filter(Boolean);
  const findings: SinceFinding[] = [];
  for (const file of files) {
    const onDisk = join(top, file);
    if (!existsSync(onDisk)) {
      findings.push({ file, what: 'gone' });
      continue;
    }
    if (!GROWS_AT_THE_END.test(file)) continue;
    const held = git(top, ['cat-file', 'blob', `${commit}:${file}`]);
    if (held === null) {
      return { kind: 'refused', rev, why: `git could not read ${file} at that commit` };
    }
    const now = readFileSync(onDisk);
    if (now.length < held.length || !now.subarray(0, held.length).equals(held)) {
      findings.push({ file, what: 'rewritten' });
    }
  }
  const arrived = arrivedSinceTheCommit(top, commit, record, files, recordRoot);
  if (arrived === null) {
    return { kind: 'refused', rev, why: 'git could not read the record that commit held' };
  }
  return { kind: 'read', rev, commit, held: files.length, findings, arrived };
}

/** A tail's file that says what the tail names, or where its first entry is. */
const NAMES_OR_BEGINS = /^tails\/([^/]+)\/(?:tailproof\.json|checkpoints\.jsonl|(\d{6})\.jsonl)$/;

/**
 * WHAT ARRIVED SINCE THE COMMIT: the tails on disk the commit did not hold, held to the record
 * the commit's tails were (`arrivalsSince`). The base is read as the commit held it, never off
 * the disk a pull request may have changed: each tail's proof, its checkpoints and its first
 * segment, and the keys, are taken out of git into a directory of its own, removed after.
 */
function arrivedSinceTheCommit(
  top: string,
  commit: string,
  record: string,
  files: readonly string[],
  recordRoot: string,
): Arrivals | null {
  const prefix = record === '' ? '' : `${record}/`;
  const wanted: string[] = [];
  const firstSegment = new Map<string, string>();
  for (const file of files) {
    const inRecord = file.slice(prefix.length);
    if (inRecord.startsWith('keys/')) {
      wanted.push(file);
      continue;
    }
    const matched = NAMES_OR_BEGINS.exec(inRecord);
    if (matched === null) continue;
    const segment = matched[2];
    if (segment === undefined) {
      wanted.push(file);
      continue;
    }
    const tail = matched[1] as string;
    const first = firstSegment.get(tail);
    if (first === undefined || file < first) firstSegment.set(tail, file);
  }
  wanted.push(...firstSegment.values());
  const base = mkdtempSync(join(tmpdir(), 'mnema-since-'));
  try {
    for (const file of wanted) {
      const bytes = git(top, ['cat-file', 'blob', `${commit}:${file}`]);
      if (bytes === null) return null;
      const into = join(base, file.slice(prefix.length));
      mkdirSync(dirname(into), { recursive: true });
      writeFileSync(into, bytes);
    }
    return arrivalsSince({ root: base }, { root: recordRoot }, catalogUpcasters());
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
