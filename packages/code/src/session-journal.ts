/**
 * The SESSION JOURNAL: what one session of the host did with the record, kept as a small file on
 * this machine, so the next thing that asks (the next session, the compaction of this one, the
 * close of its run) answers from it and not from reading a transcript again.
 *
 * DISPOSABLE, AND OUTSIDE THE RECORD. No event is written, nothing is signed, `verify` never reads
 * the file and no format changes; the file is one per session in a directory per project, beside
 * the count of tool calls (`tool-calls.ts`), in the machine's data directory. Deleting it loses
 * nothing the record holds: the next Stop starts a reading over from the top of the transcript,
 * and a session that has no journal is a session with nothing to resume from.
 *
 * IT HOLDS THE SHAPE OF THE SESSION AND NEVER ITS WORDS. The ids of the decisions recorded since
 * the session opened and their state; the ids of the host's notes copied into the private tree; how
 * many questions the person answered with no decision recorded after; how many files holding
 * decisions were written and cited nowhere; how many files were edited; the tasks in progress and
 * the runs open; and, from those, for EACH of the project's trees, the goal of a run in it (the title
 * of the first task the session had in progress IN THAT TREE, a title the record holds there) and an
 * outcome that is a sentence of counts. A run takes its goal and its outcome from the records of its
 * own tree and from no other: a private task's title, or the count of private decisions, never
 * reaches a run that is written to the public record. Never a prompt,
 * never the text of a message, never a tool's output, never the content or the diff of a file,
 * never the environment, never a secret and never the answer a person chose. The cursor into the
 * transcript is a byte offset and a few digests: a file is kept by a digest of its path, and the bytes
 * already read by a digest of their first and of their last 4096 bytes, so a transcript that shrank
 * or whose head or tail changed is read again from the top. A rewrite that leaves the size and both
 * of those ends alone is NOT told: reading the whole file at each Stop is what the digests are there
 * to spare.
 *
 * PRIVATE TO THE PERSON: the file is 0600 and its directories 0700, whatever the umask.
 *
 * ONE LIFE: {@link PRUNE_AFTER_MS} and {@link PRUNE_KEEP}. Every write prunes the directory of its
 * project, by age and by number, so the journals of sessions nobody will ask about again do not pile
 * up. A failure to read or write one is swallowed: a journal is a convenience, and a session never
 * fails because of its own.
 */

import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { ScopedCache } from '@mnema/context';
import type { ResolvedTrees, TaskState } from '@mnema/core';
import { cites } from './commands/after-a-write.js';
import { HOST_MEMORY_MARK } from './host-memory.js';
import { projectDigest } from './tool-calls.js';
import { emptyReading, type Reading } from './what-the-session-did.js';

/** The directory, under the machine data directory, that holds one directory per project. */
export const SESSIONS_DIR = 'sessions';

/** A journal untouched for this long is let go at the next write. */
export const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** The most journals a project keeps: the newest ones. */
export const PRUNE_KEEP = 50;

/** A journal untouched for this long belongs to a session that is over, whether or not it said so. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** How long a holder of a journal's lock is waited for, and how old a lock must be to be taken as left. */
const LOCK_WAIT_MS = 3000;
const LOCK_LEFT_MS = 15000;

/** The two trees of a project that a run can be written to and a journal speaks of. */
const TREES = ['public', 'private'] as const;

/** The one version of the file's shape. */
const VERSION = 1;

/** A decision recorded since the session opened, by id, and where it stands. */
export interface JournalDecision {
  readonly id: string;
  readonly state: string;
}

/**
 * The private task a session hands its dispatched work to (`commands/dispatched.ts`): its id, how many
 * handoffs hang on it, and whether the session's end already closed it. Ids and a count, like the rest.
 */
export interface HandedOver {
  readonly task: string;
  readonly handoffs: number;
  readonly closed: boolean;
}

/** What a run in one tree takes from the session: its goal and its outcome, both from that tree. */
export interface TreeAccount {
  /** The title of the first task in progress in that tree since the session opened, once known. */
  readonly goal: string | null;
  /** What the session did, as a sentence of counts that counts only that tree's records. */
  readonly outcome: string | null;
}

/** The journal of one session: see the head of this file for what it holds and never holds. */
export interface Journal {
  readonly version: 1;
  /** The host's id for the session: the file's name. */
  readonly session: string;
  /** When the journal was last written, ISO 8601. */
  readonly updatedAt: string;
  /** The earliest instant on the transcript. */
  readonly openedAt: string | null;
  /** Decisions of the project's own trees created since the session opened. */
  readonly decisions: readonly JournalDecision[];
  /** Notes of the host's memory copied into the private tree since the session opened. */
  readonly notes: readonly string[];
  /** Questions the person answered with no decision recorded after them. */
  readonly questionsWithoutDecision: number;
  /** Files holding decisions the session wrote that the record cites nowhere. */
  readonly decisionFilesUncited: number;
  /** Distinct files the session's own tool calls wrote. */
  readonly filesEdited: number;
  /** Tasks in progress that moved since the session opened, by id. */
  readonly tasksInProgress: readonly string[];
  /** Runs open that started since the session opened, by id. */
  readonly runsOpen: readonly string[];
  /**
   * When the host's connection to the server ended, which is when the session did: set by the close
   * of that connection, and gone at the next `Stop`, which is the session going on. Absent for a
   * session no one saw end.
   */
  readonly endedAt?: string;
  /** The goal and the outcome a run takes, by the tree the run is written to. */
  readonly trees: { readonly public: TreeAccount; readonly private: TreeAccount };
  /** Where the reading of the transcript stands. */
  readonly reading: Reading;
  /** The task this session's dispatches hang on, once the first one was seen. */
  readonly handedOver?: HandedOver;
}

/** What a session's id may look like to be a file name here: the host's own are UUIDs. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** The id, or undefined when it is not one this module will make a file name of. */
export function sessionIdOf(value: unknown): string | undefined {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : undefined;
}

/** Where this project's journal for `session` lives, or undefined outside a project. */
export function journalFile(trees: ResolvedTrees, session: string): string | undefined {
  const digest = projectDigest(trees);
  const id = sessionIdOf(session);
  if (digest === undefined || id === undefined) return undefined;
  return join(dirname(trees.global), SESSIONS_DIR, digest, `${id}.json`);
}

/** The directory this project keeps its journals in, or undefined outside a project. */
export function journalsDir(trees: ResolvedTrees): string | undefined {
  const digest = projectDigest(trees);
  return digest === undefined ? undefined : join(dirname(trees.global), SESSIONS_DIR, digest);
}

/** Whether `value` holds an account for each of the two trees. */
function areAccounts(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const both = value as Record<string, unknown>;
  return TREES.every((tree) => {
    const one = both[tree] as Record<string, unknown> | null | undefined;
    return (
      typeof one === 'object' &&
      one !== null &&
      (one['goal'] === null || typeof one['goal'] === 'string') &&
      (one['outcome'] === null || typeof one['outcome'] === 'string')
    );
  });
}

/** Whether `value` has the shape of a journal: a hand edit or another version is read as none. */
function isJournal(value: unknown): value is Journal {
  if (typeof value !== 'object' || value === null) return false;
  const one = value as Record<string, unknown>;
  const reading = one['reading'] as Record<string, unknown> | undefined;
  return (
    one['version'] === VERSION &&
    typeof one['session'] === 'string' &&
    Array.isArray(one['decisions']) &&
    Array.isArray(one['notes']) &&
    typeof one['filesEdited'] === 'number' &&
    areAccounts(one['trees']) &&
    typeof reading === 'object' &&
    reading !== null &&
    typeof reading['bytes'] === 'number' &&
    (reading['anchors'] === null || typeof reading['anchors'] === 'object') &&
    (one['endedAt'] === undefined || typeof one['endedAt'] === 'string') &&
    typeof reading['files'] === 'object' &&
    typeof reading['pending'] === 'object' &&
    Array.isArray(reading['questionTimes']) &&
    Array.isArray(reading['decisionFiles'])
  );
}

/** Reads the journal at `file`, or undefined when there is none or it is not one. */
export function readJournal(file: string): Journal | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    return isJournal(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The modes a journal and its directories keep, whatever the umask: the person's alone. */
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

/** Writes `journal` to `file`, whole and atomically, then prunes its directory. Never throws. */
export function writeJournal(file: string, journal: Journal, now: Date): void {
  try {
    const dir = dirname(file);
    mkdirSync(dir, { recursive: true, mode: DIRECTORY_MODE });
    // `mkdir` is subject to the umask, and a directory that already exists keeps the mode it had.
    chmodSync(dir, DIRECTORY_MODE);
    chmodSync(dirname(dir), DIRECTORY_MODE);
    const staging = `${file}.${process.pid}.tmp`;
    writeFileSync(staging, JSON.stringify(journal), { mode: FILE_MODE });
    chmodSync(staging, FILE_MODE);
    renameSync(staging, file);
    prune(dirname(file), now);
  } catch {
    // A journal is a convenience: losing one is the honest cost of never failing a session.
  }
}

/**
 * Takes a lock that a dead process left, and answers whether the lock is now this process's.
 *
 * TWO PROCESSES THAT BOTH FIND THE SAME LOCK OLD must not both clear it: the second one's `rm` would
 * remove the lock the first had just made, and both would go on to hold it. So the clearing is itself
 * under a lock (`<lock>.takeover`, made with `mkdir`, which only one process wins), and the age of the
 * lock is read again under it. A process that does not win it leaves the lock alone and asks again.
 * The takeover lock is held for the length of a `stat`, an `rm` and a `mkdir`; one left by a process
 * that died inside that is cleared by age, which is not itself under a lock (two processes that both
 * clear a takeover lock that a third died holding, in the same instant, are the one case left).
 */
function takeOverALeftLock(lock: string): boolean {
  const guard = `${lock}.takeover`;
  try {
    mkdirSync(guard);
  } catch {
    try {
      if (Date.now() - statSync(guard).mtimeMs > LOCK_LEFT_MS) {
        rmSync(guard, { recursive: true, force: true });
      }
    } catch {
      // Released between the two calls: ask again.
    }
    return false;
  }
  try {
    if (Date.now() - statSync(lock).mtimeMs <= LOCK_LEFT_MS) return false;
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
    return true;
  } catch {
    // The lock was released (statSync) or made by another meanwhile (mkdirSync): ask again.
    return false;
  } finally {
    rmSync(guard, { recursive: true, force: true });
  }
}

/**
 * Runs `work` as the only one touching `file`'s journal: parallel dispatches of one session are
 * parallel processes, and two that both read "no task yet" would each open one. A lock that cannot be
 * had in `waitMs` ({@link LOCK_WAIT_MS} unless a caller says) is not waited for any longer, and one
 * older than {@link LOCK_LEFT_MS} is a process that died holding it. Then the work DOES NOT RUN and
 * the answer is `undefined`: running it without the lock is how two processes each open a task, and
 * a task nobody closes. The caller says what it skipped.
 */
export function exclusivelyOn<T>(
  file: string,
  work: () => T,
  waitMs: number = LOCK_WAIT_MS,
): T | undefined {
  const lock = `${file}.lock`;
  let held = false;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: DIRECTORY_MODE });
    const until = Date.now() + waitMs;
    while (!held) {
      try {
        mkdirSync(lock);
        held = true;
      } catch {
        held = takeOverALeftLock(lock);
        if (held) break;
        if (Date.now() > until) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
  } catch {
    // No lock to be had, and no directory to make one in.
  }
  if (!held) return undefined;
  try {
    return work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** The file beside a journal that counts what the mirror could not do: one byte for each skip. */
const SKIPPED_SUFFIX = '.skipped';

/** Counts one dispatch the mirror did not record. An append, so two processes never lose each other's. */
export function countASkip(file: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: DIRECTORY_MODE });
    appendFileSync(`${file}${SKIPPED_SUFFIX}`, '.', { mode: FILE_MODE });
  } catch {
    // A count that cannot be kept is the one thing left unsaid.
  }
}

/** How many dispatches of the session the mirror skipped. */
export function skippedOf(file: string): number {
  try {
    return statSync(`${file}${SKIPPED_SUFFIX}`).size;
  } catch {
    return 0;
  }
}

/** The suffix of the marker that says a channel's service was recorded for a session. */
const SERVED_SUFFIX = '.served';

/**
 * What a session of the host remembers about a channel it was served through, outside the record: the
 * marker `<journal>.<channel>.served`, made with an EXCLUSIVE create, so that of several processes
 * asking at once about the same session and channel exactly one is told it is the first.
 *
 * WHY HERE. A hook that is a process per write has no connection to remember the run by, and the
 * fact that the push was live (`channel.served`) is declared once per run and per channel: recorded
 * on every edit it is the thousands-of-writes shape the declaration refuses. The session's id is the
 * run's stand-in, and this directory is the memory a session already has on this machine: one file
 * per session, 0600, pruned with the journals, never read by `verify`, no format changes. A sibling
 * file and not a field of the journal, because the journal is rewritten whole by whoever reads the
 * transcript (`journalAfter`), and a field that writer does not carry would be dropped by it.
 *
 * LOSING IT COSTS AT MOST ONE FACT MORE, NEVER A PUSH LESS: a marker that was pruned or deleted makes
 * the next edit the first again. Where the marker cannot be made at all (a directory that refuses
 * it) the answer is `true`, so the fact is recorded and the push goes out; the fact then repeats for
 * as long as the directory refuses, which is the cost of never pushing without a fact.
 *
 * Returns the marker to give back (`release`) when the fact could not be recorded, so that the next
 * edit tries again, or `undefined` when this session was already served. Never throws.
 */
export function takeTheFirstServing(
  trees: ResolvedTrees,
  session: string,
  channel: string,
): { readonly release: () => void } | undefined {
  const file = journalFile(trees, session);
  if (file === undefined) return { release: () => undefined };
  const marker = `${file}.${channel}${SERVED_SUFFIX}`;
  try {
    const dir = dirname(file);
    mkdirSync(dir, { recursive: true, mode: DIRECTORY_MODE });
    chmodSync(dir, DIRECTORY_MODE);
    writeFileSync(marker, '', { mode: FILE_MODE, flag: 'wx' });
    return { release: () => rmSync(marker, { force: true }) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
    return { release: () => undefined };
  }
}

/** A journal that names a task the session's end never closed, with where it is. */
export interface LeftOpen {
  readonly file: string;
  readonly journal: Journal;
  readonly held: HandedOver;
}

/** The journals of this project, but `own`, untouched for {@link STALE_AFTER_MS}, whose task is still open. */
export function leftOpen(trees: ResolvedTrees, own: string, now: Date): readonly LeftOpen[] {
  const dir = journalsDir(trees);
  if (dir === undefined) return [];
  const left: LeftOpen[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const file = join(dir, name);
      if (file === own) continue;
      try {
        if (now.getTime() - statSync(file).mtimeMs <= STALE_AFTER_MS) continue;
      } catch {
        continue;
      }
      const journal = readJournal(file);
      const held = journal?.handedOver;
      if (journal !== undefined && held !== undefined && !held.closed)
        left.push({ file, journal, held });
    }
  } catch {
    // No directory: nothing was left.
  }
  return left;
}

/** Lets go of the journals older than {@link PRUNE_AFTER_MS} and of all but the newest {@link PRUNE_KEEP}. */
function prune(dir: string, now: Date): void {
  const kept: { path: string; mtime: number }[] = [];
  for (const name of readdirSync(dir)) {
    if (
      !name.endsWith('.json') &&
      !name.endsWith('.tmp') &&
      !name.endsWith(SKIPPED_SUFFIX) &&
      !name.endsWith(SERVED_SUFFIX)
    )
      continue;
    const path = join(dir, name);
    try {
      const mtime = statSync(path).mtimeMs;
      if (now.getTime() - mtime > PRUNE_AFTER_MS) rmSync(path, { force: true });
      else if (name.endsWith('.json')) kept.push({ path, mtime });
    } catch {
      // Gone already: another session pruned it.
    }
  }
  kept.sort((a, b) => b.mtime - a.mtime);
  for (const old of kept.slice(PRUNE_KEEP)) rmSync(old.path, { force: true });
}

/** The state a task is in while somebody works on it: typed, so a renamed state does not compile. */
const IN_PROGRESS: TaskState = 'IN_PROGRESS';

/** What the record holds of a session, read through the caches of the project's trees named. */
function whatTheRecordHolds(
  sources: readonly ScopedCache[],
  since: number,
  mirrored: string | undefined,
): Pick<Journal, 'decisions' | 'notes' | 'tasksInProgress' | 'runsOpen'> & {
  readonly lastDecisionAt: number;
  readonly firstTask: string | null;
} {
  const own = sources;
  const decisions = own
    .flatMap((source) => source.cache.listDecisions())
    .filter((one) => Date.parse(one.createdAt) >= since);
  const notes = own
    .flatMap((source) => source.cache.listMemories())
    .filter((one) => one.content.includes(HOST_MEMORY_MARK) && Date.parse(one.capturedAt) >= since);
  const tasks = own
    .flatMap((source) => source.cache.listTasksByState(IN_PROGRESS))
    // The task the session's dispatches hang on is the mirror's, not work the session set out on.
    .filter((one) => one.id !== mirrored && Date.parse(one.updatedAt) >= since);
  // The first to move into progress is the one the session set out on.
  let first = tasks[0];
  for (const one of tasks) if (first !== undefined && one.updatedAt < first.updatedAt) first = one;
  const runs = own
    .flatMap((source) => source.cache.listOpenRuns())
    .filter((one) => Date.parse(one.startedAt) >= since);
  return {
    decisions: decisions.map((one) => ({ id: one.id, state: one.state })),
    notes: notes.map((one) => one.id),
    tasksInProgress: tasks.map((one) => one.id),
    runsOpen: runs.map((one) => one.id),
    lastDecisionAt: decisions.reduce(
      (latest, one) => Math.max(latest, Date.parse(one.createdAt)),
      0,
    ),
    firstTask: first?.title ?? null,
  };
}

/** How many of a thing, in the words the outcome uses for it. */
function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The outcome a run ends with: a sentence of counts, in the order of what a person asks of a
 * session. Nothing in it is anybody's words. It is the journal as of the session's LAST Stop, and
 * says so: a run closes after that Stop, and a decision recorded in between is not in it.
 */
export function outcomeOf(
  journal: Pick<Journal, 'decisions' | 'filesEdited' | 'notes' | 'questionsWithoutDecision'>,
): string {
  const parts = [
    `${counted(journal.decisions.length, 'decision', 'decisions')} recorded`,
    `${counted(journal.filesEdited, 'file', 'files')} edited`,
  ];
  if (journal.notes.length > 0) {
    parts.push(`${counted(journal.notes.length, 'note', 'notes')} of the host's memory copied`);
  }
  if (journal.questionsWithoutDecision > 0) {
    parts.push(
      `${counted(journal.questionsWithoutDecision, 'question', 'questions')} answered with no decision recorded after`,
    );
  }
  return `${parts.join('; ')}, as of the session's last Stop.`;
}

/**
 * The journal after this reading: the cursor as it stands, and the record's side of the session
 * asked of the caches now. `previous` supplies only what is kept once it is known (the goal).
 */
export function journalAfter(input: {
  readonly session: string;
  readonly previous: Journal | undefined;
  readonly reading: Reading;
  readonly sources: readonly ScopedCache[];
  readonly now: Date;
}): Journal {
  const { reading, sources, previous } = input;
  const since = reading.openedAt === undefined ? Number.NaN : Date.parse(reading.openedAt);
  const decisionFilesUncited = reading.decisionFiles.filter((path) => !cites(sources, path)).length;
  const filesEdited = Object.keys(reading.files).length;
  // Each tree is read through its own caches only, and what a run of that tree carries is made from
  // that reading alone: the other tree's records are not consulted for the goal nor listed.
  const held = (tree: (typeof TREES)[number]) =>
    Number.isNaN(since)
      ? undefined
      : whatTheRecordHolds(
          sources.filter((source) => source.scope === tree),
          since,
          previous?.handedOver?.task,
        );
  const publicHeld = held('public');
  const privateHeld = held('private');
  // WHETHER A QUESTION HAD A DECISION AFTER IT is a fact of the session, and the direction it crosses
  // matters: the private run counts the decisions of both trees (what the public tree holds is
  // visible to whoever reads the private one), but the PUBLIC run, which is signed and committed,
  // counts only the public tree's. A decision that exists only in the private tree must not change a
  // word of a run written to the public record, nor, with several questions, tell when it was made.
  const questionsAfter = (lastDecisionAt: number) =>
    reading.questionTimes.filter((at) => Date.parse(at) > lastDecisionAt).length;
  const lastPublicDecisionAt = publicHeld?.lastDecisionAt ?? 0;
  const lastDecisionAt = Math.max(lastPublicDecisionAt, privateHeld?.lastDecisionAt ?? 0);
  const questionsWithoutDecision = questionsAfter(lastDecisionAt);
  const of = (
    held: ReturnType<typeof whatTheRecordHolds> | undefined,
    tree: (typeof TREES)[number],
  ) => {
    const base = {
      decisions: held?.decisions ?? [],
      notes: held?.notes ?? [],
      filesEdited,
      questionsWithoutDecision:
        tree === 'public' ? questionsAfter(lastPublicDecisionAt) : questionsWithoutDecision,
    };
    return {
      held,
      account: {
        goal: previous?.trees[tree].goal ?? held?.firstTask ?? null,
        outcome: outcomeOf(base),
      },
    };
  };
  const publicOnes = of(publicHeld, 'public');
  const privateOnes = of(privateHeld, 'private');
  const together = {
    decisions: [...(publicOnes.held?.decisions ?? []), ...(privateOnes.held?.decisions ?? [])],
    notes: [...(publicOnes.held?.notes ?? []), ...(privateOnes.held?.notes ?? [])],
    tasksInProgress: [
      ...(publicOnes.held?.tasksInProgress ?? []),
      ...(privateOnes.held?.tasksInProgress ?? []),
    ],
    runsOpen: [...(publicOnes.held?.runsOpen ?? []), ...(privateOnes.held?.runsOpen ?? [])],
  };
  return {
    version: VERSION,
    session: input.session,
    updatedAt: input.now.toISOString(),
    openedAt: reading.openedAt ?? null,
    ...together,
    filesEdited,
    questionsWithoutDecision,
    decisionFilesUncited,
    trees: { public: publicOnes.account, private: privateOnes.account },
    reading,
    ...(previous?.handedOver !== undefined ? { handedOver: previous.handedOver } : {}),
    ...(previous?.endedAt !== undefined ? { endedAt: previous.endedAt } : {}),
  };
}

/**
 * The decisions the project's own trees hold that were created since `openedAt`, with the state they
 * have NOW: the record's answer, which a journal written at the last `Stop` can be behind. Undefined
 * when the instant is not one.
 */
export function decisionsRecordedSince(
  sources: readonly ScopedCache[],
  openedAt: string | null,
): readonly JournalDecision[] | undefined {
  const since = openedAt === null ? Number.NaN : Date.parse(openedAt);
  if (Number.isNaN(since)) return undefined;
  return sources
    .filter((source) => source.scope !== 'global')
    .flatMap((source) => source.cache.listDecisions())
    .filter((one) => Date.parse(one.createdAt) >= since)
    .map((one) => ({ id: one.id, state: one.state }));
}

/**
 * The label of each decision the trees hold, by id. Each tree numbers its own decisions, so two
 * trees can both hold an `ADR-1`: a label that more than one tree holds carries the name of its
 * tree (`ADR-1 (private)`), and one that is only in a single tree stays as the record numbered it.
 */
export function labelsOf(sources: readonly ScopedCache[]): ReadonlyMap<string, string> {
  const held = sources.flatMap((source) =>
    source.cache.listDecisions().map((one) => ({ id: one.id, adr: one.adr, scope: source.scope })),
  );
  const scopesOf = new Map<string, Set<string>>();
  for (const one of held) {
    const scopes = scopesOf.get(one.adr) ?? new Set<string>();
    scopes.add(one.scope);
    scopesOf.set(one.adr, scopes);
  }
  return new Map(
    held.map((one) => [
      one.id,
      (scopesOf.get(one.adr)?.size ?? 0) > 1 ? `${one.adr} (${one.scope})` : one.adr,
    ]),
  );
}

/** The journal that has nothing in it yet: a reading from the top of the transcript. */
export function readingOf(previous: Journal | undefined): Reading {
  return previous === undefined ? emptyReading() : previous.reading;
}

/** A session counts as recent for the notes a new one is handed for this long after its last write. */
export const RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * A session whose journal was written to this recently, and whose connection did not end, may be a
 * session still going: the journal is written at the end of each response, so between two of them it
 * looks the same as one that stopped. It is not told to another session as the one that stopped.
 */
export const LIVE_MS = 15 * 60 * 1000;

/** How long the Stop tally and the end of a connection wait for a journal's lock: a write they skip is made up by the next reader. */
export const JOURNAL_LOCK_WAIT_MS = 1500;

/**
 * Marks the journal at `file` as one whose session ended at `now`. Never throws. The read and the
 * write are under the lock the dispatches and the tally take, so they cannot erase what those write
 * between the two (the task handed over, or an end already marked). A lock not had in `waitMs` leaves
 * the journal as it was, and the next reader works out that the session stopped from its age.
 */
export function markEnded(file: string, now: Date, waitMs: number = JOURNAL_LOCK_WAIT_MS): void {
  exclusivelyOn(
    file,
    () => {
      const journal = readJournal(file);
      if (journal === undefined || journal.endedAt !== undefined) return;
      writeJournal(file, { ...journal, endedAt: now.toISOString() }, now);
    },
    waitMs,
  );
}

/** Whether `journal` is that of a session that has stopped, as far as `now` can tell. */
export function hasStopped(journal: Journal, now: Date): boolean {
  if (journal.endedAt !== undefined) return true;
  return Date.parse(journal.updatedAt) + LIVE_MS <= now.getTime();
}

/** Whether a journal holds anything a later session would want to be told. */
export function hasSomethingToSay(journal: Journal): boolean {
  return (
    journal.decisions.length > 0 ||
    journal.filesEdited > 0 ||
    journal.tasksInProgress.length > 0 ||
    journal.decisionFilesUncited > 0 ||
    journal.questionsWithoutDecision > 0
  );
}

/**
 * The journal of the most recent OTHER session of this project that has something to say: not the
 * session `except` names (the one asking, when it is known), written to within {@link RECENT_MS} of
 * `now`, and stopped: its connection ended, or its journal has been quiet for {@link LIVE_MS}.
 * Undefined when there is none.
 */
export function lastJournalOf(
  trees: ResolvedTrees,
  input: { readonly except?: string | undefined; readonly now: Date },
): Journal | undefined {
  const dir = journalsDir(trees);
  if (dir === undefined) return undefined;
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return undefined;
  }
  let best: Journal | undefined;
  for (const name of names) {
    const journal = readJournal(join(dir, name));
    if (journal === undefined || journal.session === input.except) continue;
    const written = Date.parse(journal.updatedAt);
    if (Number.isNaN(written) || input.now.getTime() - written > RECENT_MS) continue;
    if (!hasSomethingToSay(journal) || !hasStopped(journal, input.now)) continue;
    if (best === undefined || journal.updatedAt > best.updatedAt) best = journal;
  }
  return best;
}
