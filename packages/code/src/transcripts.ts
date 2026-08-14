/**
 * The host's own transcripts, read for NUMBERS and for nothing else.
 *
 * Claude Code writes one JSON object per line under `~/.claude/projects/`, and every
 * assistant message on it carries `message.usage` — the four token counts and the id
 * of the model that produced them. That is the only reason this file exists: the
 * number a person is accountable for is obtainable, and it is obtainable WITHOUT the
 * record growing a field for it (see `RECONSTRUCTION.md`, *Custo/tokens*). The chain
 * gets nothing; the surface crosses and shows.
 *
 * IT READS `usage`, `model` AND AN INSTANT. It never reads, copies, summarises or
 * returns a message's CONTENT, and that is a hard limit rather than a scope note: a
 * transcript is the whole conversation, including whatever a person pasted into it,
 * and a reading that put any of it on a screen would have moved somebody's private
 * text into a report they ran for a token count. Nothing in this module's return
 * types can carry prose — the counts are numbers, the models are ids the host wrote,
 * and the instants are timestamps. `the-cost-comes-from-the-host.test.ts` puts a
 * sentence inside a fixture's `message.content` and asserts the output does not hold
 * it.
 *
 * THE PROJECT DIRECTORY IS DISCOVERED, NEVER COMPOSED, and that is the finding this
 * module is built on rather than a preference. The host names a project directory by
 * flattening the path it was launched in (`/a/b.c` → `-a-b-c`), and that rule was
 * checked here in read-only against a real store: it holds for 140 of the 142
 * top-level transcripts that record a `cwd` at all. But it CANNOT be the key, for
 * three measured reasons:
 *
 *   1. It is lossy. `/` and `.` and `-` all become `-`, so a sibling project
 *      `…/mnema-study` flattens to a name that is a prefix-plus-dash of `…/mnema`'s.
 *      A read keyed on the name would attribute another project's sessions.
 *   2. It is not where the work necessarily is. A session launched in `<repo>/.refactor`
 *      gets its OWN directory, and a session launched in `<repo>` holds subagent
 *      transcripts whose `cwd` is `<repo>/.refactor`. Both are work in this project.
 *   3. The two transcripts that broke the rule record a `cwd` the session MOVED to
 *      (`/var/www/plantae-utilities` → `/var/www/plantae-infra`), so the flattened name
 *      is a fact about where a process started and the `cwd` is a fact about where it
 *      worked. This reading wants the second one.
 *
 * So a transcript belongs to a project when the `cwd` THE HOST ITSELF RECORDED on it
 * is that project's root or under it. That is the host stating which directory the
 * work happened in, and it survives whatever the flattening rule becomes — the
 * characters that would tell the four candidate rules apart (`_`, a space) appear in
 * no path on the machine this was measured on, so the rule is not knowable with
 * confidence and this module deliberately does not need to know it.
 *
 * THE UNIT IS THE HOST'S SESSION, and it is read off the line (`sessionId`) rather
 * than off the file name: a session is one main transcript plus the subagent and
 * workflow transcripts nested beside it, all of which record the parent's id (261 of
 * 275 measured; the 14 that differ carry their own). Grouping by what the line says
 * is what keeps a session's subagents in the session that spawned them.
 *
 * A MESSAGE IS COUNTED ONCE, BY `message.id`, and skipping that is how a naive
 * reading over-reports by a factor of two. The host writes one line per content
 * BLOCK of an assistant message — a text block and a tool call are two lines — and
 * both carry the same `message.usage`. Measured on one 19.6 MiB transcript: 4013
 * assistant lines for 2143 distinct message ids. Summing per line would have claimed
 * roughly twice the tokens that were actually bought.
 */

import { closeSync, type Dirent, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/**
 * Where the host keeps its transcripts, from the environment this process is in.
 *
 * `CLAUDE_CONFIG_DIR` is the host's own override for where its configuration lives —
 * it is what its container examples set (`ENV CLAUDE_CONFIG_DIR=/tmp/.claude`) — so a
 * reading that only knew about `~/.claude` would report "no transcript" for every run
 * on a machine that moved it, which is a wrong answer wearing the shape of a right
 * one. The home directory arrives as an argument rather than being read here, because
 * the whole surface resolves discovery from an injected environment (`env.ts`) and a
 * test drives it with a sandbox.
 */
export function hostTranscriptRoot(home: string, processEnv: NodeJS.ProcessEnv): string {
  const configured = processEnv.CLAUDE_CONFIG_DIR;
  return configured === undefined || configured === ''
    ? join(home, '.claude', 'projects')
    : join(configured, 'projects');
}

/** One of the host's sessions, as much of it as can be known without reading it. */
export interface HostSession {
  /** The session id the host recorded on its own lines. */
  readonly id: string;
  /** The transcript files that carry it — the main one and its subagents. */
  readonly files: readonly string[];
  /** The earliest instant recorded on any of them, in the host's own spelling. */
  readonly firstAt: string;
  /**
   * When the host last WROTE any of these files, as milliseconds.
   *
   * It is the file's modification time and not a recorded instant, and it is used for
   * one thing only: deciding whether a session overlaps a run's window. Reading the
   * true last instant would mean reading every transcript of the store — a gigabyte on
   * the machine this was measured on — to answer a question about which few of them
   * matter. It is never reported, so nothing a reader sees is derived from it.
   *
   * It fails in the safe direction. A copied file gets a NEWER mtime, so a session can
   * only ever look like it lasted longer than it did — which turns an attribution into
   * an ambiguity ("two sessions overlap"), and this reading refuses to attribute an
   * ambiguous one. It cannot turn an ambiguity into a confident wrong number.
   */
  readonly lastWrittenMs: number;
}

/** The four counts the host writes, summed. */
export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

/** What one session cost, and what the reading could not read. */
export interface SessionNumbers extends TokenCounts {
  /** How many distinct assistant messages the counts came from. */
  readonly messages: number;
  /** The model ids that produced them, distinct, in the order first seen. */
  readonly models: readonly string[];
  /**
   * Lines this reading passed over: one that is not JSON, and one that announces an
   * assistant message carrying no `usage` it can read.
   *
   * It is COUNTED rather than swallowed because the two failures a reader has to be
   * able to tell apart are "this session cost little" and "this reading understood
   * little of it". A line that is neither of those — a user turn, an attachment, a
   * file snapshot — is not in the class and is not counted: it was never expected to
   * carry a number, and counting it would put four figures of noise on every line.
   */
  readonly passedOver: number;
}

/**
 * How much earlier than the truth a modification time is allowed to read.
 *
 * IT IS NOT A FUDGE FACTOR, and it was found by a test rather than reasoned about: a
 * transcript written in the same millisecond a run opened came back with
 * `mtimeMs = 1786675936289.999` against a run that started at `1786675936290`, so the
 * comparison failed by one THOUSANDTH of a millisecond and the session vanished.
 * `mtimeMs` is a double built from a nanosecond field, and it does not always land on
 * the integer millisecond the record's instants are written in.
 *
 * Two seconds and not one microsecond, because the float is the smaller of the two
 * problems: a filesystem's own timestamp granularity is one second on several and two
 * on FAT, so an mtime can genuinely be up to that much earlier than the last write.
 * The whole of what the slack costs is opening a few more files; what it buys is that
 * this comparison can never DROP a transcript that counted, which is the only direction
 * that loses information a reader could have had.
 */
const MTIME_SLACK_MS = 2_000;

/**
 * Whether a file the host last wrote at `lastWrittenMs` could still hold something at
 * or after `instantMs` — the one comparison this reading makes against a modification
 * time.
 *
 * ONE function because two call sites make it: the cheap prune below, which decides
 * whether to open a file at all, and the overlap test in `commands/usage.ts`, which
 * decides whether a session meets a run's window. Two readings of the same comparison
 * would be two opinions about the same boundary, and the second one to gain the slack
 * would be the one nobody noticed.
 */
export function reachesAtOrAfter(lastWrittenMs: number, instantMs: number): boolean {
  return lastWrittenMs + MTIME_SLACK_MS >= instantMs;
}

/**
 * Every session of the host's store whose recorded `cwd` is `projectRoot` or under it.
 *
 * `notWrittenBeforeMs` drops a file the host has not touched since then WITHOUT
 * OPENING IT, which is the whole of what makes this affordable: a caller knows the
 * earliest window it could possibly attribute to, and a transcript last written before
 * it cannot hold a message inside any of them. The prune is one-sided on purpose — an
 * mtime that is wrong is wrong in the direction of reading MORE files (see
 * {@link reachesAtOrAfter}) — so it drops nothing that could have counted.
 *
 * Nothing is opened for writing and nothing is created: a missing store is an ordinary
 * answer (no host here, or a machine that moved it), and it comes back empty.
 */
export function sessionsOfProject(
  root: string,
  projectRoot: string,
  notWrittenBeforeMs = Number.NEGATIVE_INFINITY,
): readonly HostSession[] {
  const found = new Map<string, { files: string[]; firstAt: string; lastWrittenMs: number }>();
  for (const path of transcriptFiles(root)) {
    const written = modifiedMs(path);
    if (written === undefined || !reachesAtOrAfter(written, notWrittenBeforeMs)) continue;
    const said = whatItSaysAboutItself(path);
    if (said === undefined) continue;
    if (!isAtOrUnder(said.cwd, projectRoot)) continue;
    const held = found.get(said.session);
    if (held === undefined) {
      found.set(said.session, { files: [path], firstAt: said.at, lastWrittenMs: written });
      continue;
    }
    held.files.push(path);
    if (said.at < held.firstAt) held.firstAt = said.at;
    if (written > held.lastWrittenMs) held.lastWrittenMs = written;
  }
  return [...found]
    .map(([id, held]) => ({
      id,
      files: held.files,
      firstAt: held.firstAt,
      lastWrittenMs: held.lastWrittenMs,
    }))
    .sort((a, b) =>
      a.firstAt === b.firstAt ? a.id.localeCompare(b.id) : a.firstAt < b.firstAt ? -1 : 1,
    );
}

/**
 * The numbers one session holds, over every file that carries it.
 *
 * The set of seen message ids spans the whole session rather than each file, because a
 * subagent's transcript and its parent's are two files of one conversation and a
 * message written into both is one message that was bought once.
 */
export function numbersOf(session: HostSession): SessionNumbers {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let passedOver = 0;
  const counted = new Set<string>();
  const models: string[] = [];
  for (const path of session.files) {
    forEachLine(path, (line) => {
      if (line.trim() === '') return true;
      const said = parsed(line);
      if (said === undefined) {
        passedOver += 1;
        return true;
      }
      if (said.type !== 'assistant') return true;
      const message = asObject(said.message);
      const usage = asObject(message?.usage);
      if (usage === undefined) {
        passedOver += 1;
        return true;
      }
      // One line per content BLOCK, all of them carrying the same `usage`: the id is
      // what makes a message the unit. A line with usage and no id is counted alone,
      // which is the honest reading of a shape this has not seen — it can over-count
      // one message, never a whole session.
      const id = typeof message?.id === 'string' ? message.id : undefined;
      if (id !== undefined) {
        if (counted.has(id)) return true;
        counted.add(id);
      }
      input += numberAt(usage, 'input_tokens');
      output += numberAt(usage, 'output_tokens');
      cacheRead += numberAt(usage, 'cache_read_input_tokens');
      cacheCreation += numberAt(usage, 'cache_creation_input_tokens');
      const model = message?.model;
      if (typeof model === 'string' && !models.includes(model)) models.push(model);
      return true;
    });
  }
  return {
    input,
    output,
    cacheRead,
    cacheCreation,
    messages: counted.size,
    models,
    passedOver,
  };
}

// ---------------------------------------------------------------------------
// Finding the files, and asking each one what it is
// ---------------------------------------------------------------------------

/** Every `.jsonl` under the store, however deep the host nested it. */
function transcriptFiles(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      // A store that is not there, or one this process may not read, is an ordinary
      // answer: there is no host transcript to report, and that is what comes back.
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.jsonl')) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

/** When the host last wrote this file, or `undefined` if it cannot be asked. */
function modifiedMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** How far into a transcript this reading looks for the line that identifies it. */
const IDENTIFYING_BYTES = 1_000_000;

/**
 * What a transcript says about itself: which session it is, which directory the work
 * was done in, and when it starts.
 *
 * Read from the first line that carries a `cwd`, which is NOT always the first line —
 * a main transcript often opens with a summary or a title that carries none (measured:
 * 142 of 143 main transcripts, with the identifying line as far in as the fourth). It
 * gives up after {@link IDENTIFYING_BYTES} rather than reading a 92 MiB file to learn
 * its name.
 */
function whatItSaysAboutItself(
  path: string,
): { readonly session: string; readonly cwd: string; readonly at: string } | undefined {
  let answer: { session: string; cwd: string; at: string } | undefined;
  let read = 0;
  forEachLine(path, (line) => {
    read += line.length + 1;
    const said = parsed(line);
    if (said !== undefined && typeof said.cwd === 'string') {
      const session = typeof said.sessionId === 'string' ? said.sessionId : undefined;
      const at = typeof said.timestamp === 'string' ? said.timestamp : undefined;
      if (session !== undefined && at !== undefined) {
        answer = { session, cwd: said.cwd, at };
        return false;
      }
    }
    return read < IDENTIFYING_BYTES;
  });
  return answer;
}

/**
 * Whether `path` is `root` or lives under it, compared as TEXT.
 *
 * Textual for the reason `resolveTrees` is: a symlink makes one directory answer to
 * two names, and following them here would be a second opinion about what a project is
 * (`core/src/topology/resolve.ts`). A session opened through an alias of this project
 * is not attributed, and that is a miss the reader can see — every run comes out with
 * no transcript — rather than a number quietly composed of somebody else's work.
 */
function isAtOrUnder(path: string, root: string): boolean {
  const inside = relative(root, path);
  return inside === '' || (!inside.startsWith('..') && !isAbsolute(inside));
}

// ---------------------------------------------------------------------------
// Reading lines, and reading numbers off them
// ---------------------------------------------------------------------------

/** How much is pulled off the disk at a time. */
const CHUNK = 1 << 16;

/**
 * Calls `visit` with each line of a file, stopping early when it answers `false`.
 *
 * Synchronous and chunked, because the caller is a command that runs once and exits
 * and because a transcript can be 92 MiB — reading one into a string to split it would
 * hold the whole conversation in memory, which is exactly the thing this module is
 * careful never to hold. The decoder is per FILE and not per chunk: a 64 KiB boundary
 * lands in the middle of a multi-byte character often enough to matter, and decoding
 * each chunk on its own turns that character into two replacement bytes — which would
 * corrupt the very ids this reading groups by.
 */
function forEachLine(path: string, visit: (line: string) => boolean): void {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return;
  }
  try {
    const decoder = new StringDecoder('utf8');
    const buffer = Buffer.allocUnsafe(CHUNK);
    let rest = '';
    for (;;) {
      const read = readSync(fd, buffer, 0, CHUNK, null);
      if (read === 0) break;
      rest += decoder.write(buffer.subarray(0, read));
      let cut = rest.indexOf('\n');
      while (cut !== -1) {
        if (!visit(rest.slice(0, cut))) return;
        rest = rest.slice(cut + 1);
        cut = rest.indexOf('\n');
      }
    }
    rest += decoder.end();
    if (rest !== '') visit(rest);
  } finally {
    closeSync(fd);
  }
}

/** One line of a transcript, as an object, or `undefined` when it is not one. */
function parsed(line: string): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(line));
  } catch {
    return undefined;
  }
}

/** A value as an object, or `undefined` — the shape guard every read here goes through. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * One count off a `usage` object: the number it holds, or zero.
 *
 * Zero for anything that is not a finite number, INCLUDING a field that is not there.
 * The host has already changed the shape of this object once — `cache_creation` became
 * an object of its own beside the flat `cache_creation_input_tokens` — so a reading
 * that threw on an unexpected value would be a verb that stops working on a host
 * upgrade, and one that trusted it would sum a string.
 */
function numberAt(usage: Record<string, unknown>, field: string): number {
  const value = usage[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
