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
 * already read by a digest of their head and of their tail, so a transcript the host rewrote is read
 * again from the top and not from the middle of another history.
 *
 * PRIVATE TO THE PERSON: the file is 0600 and its directories 0700, whatever the umask.
 *
 * ONE LIFE: {@link PRUNE_AFTER_MS} and {@link PRUNE_KEEP}. Every write prunes the directory of its
 * project, by age and by number, so the journals of sessions nobody will ask about again do not pile
 * up. A failure to read or write one is swallowed: a journal is a convenience, and a session never
 * fails because of its own.
 */

import {
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

/** The two trees of a project that a run can be written to and a journal speaks of. */
const TREES = ['public', 'private'] as const;

/** The one version of the file's shape. */
const VERSION = 1;

/** A decision recorded since the session opened, by id, and where it stands. */
export interface JournalDecision {
  readonly id: string;
  readonly state: string;
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

/** Lets go of the journals older than {@link PRUNE_AFTER_MS} and of all but the newest {@link PRUNE_KEEP}. */
function prune(dir: string, now: Date): void {
  const kept: { path: string; mtime: number }[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue;
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
    .filter((one) => Date.parse(one.updatedAt) >= since);
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
 * session. Nothing in it is anybody's words.
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
  return `${parts.join('; ')}.`;
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
  // that reading alone: the other tree's records are not consulted for the goal nor counted.
  const of = (tree: (typeof TREES)[number]) => {
    const held = Number.isNaN(since)
      ? undefined
      : whatTheRecordHolds(
          sources.filter((source) => source.scope === tree),
          since,
        );
    const questionsWithoutDecision = reading.questionTimes.filter(
      (at) => Date.parse(at) > (held?.lastDecisionAt ?? 0),
    ).length;
    const base = {
      decisions: held?.decisions ?? [],
      notes: held?.notes ?? [],
      filesEdited,
      questionsWithoutDecision,
    };
    return {
      held,
      account: {
        goal: previous?.trees[tree].goal ?? held?.firstTask ?? null,
        outcome: outcomeOf(base),
      },
    };
  };
  const publicOnes = of('public');
  const privateOnes = of('private');
  const together = {
    decisions: [...(publicOnes.held?.decisions ?? []), ...(privateOnes.held?.decisions ?? [])],
    notes: [...(publicOnes.held?.notes ?? []), ...(privateOnes.held?.notes ?? [])],
    tasksInProgress: [
      ...(publicOnes.held?.tasksInProgress ?? []),
      ...(privateOnes.held?.tasksInProgress ?? []),
    ],
    runsOpen: [...(publicOnes.held?.runsOpen ?? []), ...(privateOnes.held?.runsOpen ?? [])],
  };
  const lastDecisionAt = Math.max(
    publicOnes.held?.lastDecisionAt ?? 0,
    privateOnes.held?.lastDecisionAt ?? 0,
  );
  return {
    version: VERSION,
    session: input.session,
    updatedAt: input.now.toISOString(),
    openedAt: reading.openedAt ?? null,
    ...together,
    filesEdited,
    questionsWithoutDecision: reading.questionTimes.filter((at) => Date.parse(at) > lastDecisionAt)
      .length,
    decisionFilesUncited,
    trees: { public: publicOnes.account, private: privateOnes.account },
    reading,
  };
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

/** Marks the journal at `file` as one whose session ended at `now`. Never throws. */
export function markEnded(file: string, now: Date): void {
  const journal = readJournal(file);
  if (journal === undefined || journal.endedAt !== undefined) return;
  writeJournal(file, { ...journal, endedAt: now.toISOString() }, now);
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
