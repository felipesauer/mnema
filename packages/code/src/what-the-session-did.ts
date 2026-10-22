/**
 * What one session of the host did, read off its own transcript: which files its tool calls
 * wrote, and when it opened.
 *
 * IT READS THE SHAPE OF A LINE AND NEVER A MESSAGE'S WORDS: with ONE function that does, said where
 * it stands ({@link whatThePersonSaid}), and used by the one reader that is switched off until a
 * person switches it on. The answer is a set of paths the
 * session's tool calls named, an instant, and whether the last response wrote anything: a
 * line that is not an assistant's tool call is passed over without being looked into. This is
 * the limit `transcripts.ts` keeps for token counts, with one difference that is stated
 * rather than hidden: a PATH is what a person typed or what the model chose, so it is
 * content, and the module that returns it returns it to a caller that prints a COUNT.
 *
 * ONLY A WRITE THAT HAPPENED COUNTS. A tool call the host answered with an error (a hook that
 * refused it, an edit that matched nothing) is an attempt, and its result line says so; it is
 * not a file written. A call whose result is not in the transcript is counted, as before.
 *
 * THE TOOLS THAT WRITE ARE A TABLE OF THE HOST'S OWN NAMES ({@link WRITING_TOOLS}) and each
 * names the field its path is in. A tool this table does not know is not counted, so a host
 * that renames one makes the count read low and never makes it read high; the line the
 * verb prints says what it counted, which is the claim it can stand behind.
 *
 * ONE FILE, THE MAIN TRANSCRIPT. A subagent's calls are written to a transcript of their own
 * beside it, and are not read here: what comes back is what THIS conversation's own tool calls
 * wrote, and the sentence that carries it says so.
 *
 * A RESPONSE IS WHAT FOLLOWS THE LAST PERSON'S PROMPT. Tool results are `user` lines too, so a
 * prompt is the `user` line whose content is text and whose sender is a person: the host flags
 * text it injected (`isMeta`) and names a sender that is not `human` on task notifications and a
 * subagent's hand-back, so neither is mistaken for somebody typing.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { decisionFileAt } from './decision-files.js';
import { asObject, forEachLine, forEachLineFrom, parsed } from './transcripts.js';

/**
 * The host's tools that write a file, and the field of each one's input that names it.
 *
 * Claude Code's own names. The plugin's per-edit hook matches `Write|Edit|NotebookEdit`; a
 * multi-edit tool is counted too, because a file it changed was changed.
 */
export const WRITING_TOOLS: Readonly<Record<string, string>> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

/** What one session's transcript says it did. */
export interface SessionDid {
  /** The earliest instant recorded on any line, in the host's own spelling. */
  readonly openedAt: string | undefined;
  /** The files its own tool calls wrote, each once, as absolute paths. */
  readonly editedFiles: readonly string[];
  /** Whether the response after the last prompt wrote a file. */
  readonly lastResponseEdited: boolean;
}

/**
 * Where a reading of a transcript stands, so the next one starts there and reads only what the host
 * wrote since: a byte offset and the few facts that cannot be rebuilt from the new part alone.
 *
 * A FILE IS KEPT BY A DIGEST OF ITS PATH, never by the path: this is what a journal on disk holds, and
 * it holds the shape of what happened and none of what was said. The one path it keeps is the
 * project-relative name of a file that holds decisions, because whether the record cites it can
 * change after it was written and has to be asked again.
 */
export interface Reading {
  /** The byte the next reading starts at: the end of the last complete line read. */
  bytes: number;
  openedAt: string | undefined;
  /** Prompts seen: what separates one response from the next. */
  response: number;
  /** Writes of the current response that happened or have no answer yet. */
  writesInResponse: number;
  /** For each file (by digest), how many of its writes happened or have no answer yet. */
  files: Record<string, number>;
  /** The calls with no answer yet, by the host's id: their file and the response they belong to. */
  pending: Record<string, { file: string; response: number }>;
  /** The instants the person answered the host's question tool. */
  questionTimes: string[];
  /** Project-relative names of the files written that hold decisions. */
  decisionFiles: string[];
}

/** The reading of a transcript no one has read. */
export function emptyReading(): Reading {
  return {
    bytes: 0,
    openedAt: undefined,
    response: 0,
    writesInResponse: 0,
    files: {},
    pending: {},
    questionTimes: [],
    decisionFiles: [],
  };
}

/** How many unanswered calls and answers a reading keeps: the rest is the oldest, and is let go. */
const KEPT = 200;

function digestOf(file: string): string {
  return createHash('sha256').update(file).digest('hex').slice(0, 16);
}

/**
 * Reads what the host wrote to the transcript at `path` since `reading` stopped, and folds it into
 * `reading`. Returns false when the file cannot be opened. A file shorter than the offset is a
 * different file (a rewritten transcript): the reading starts over from nothing.
 *
 * `where.paths`, when given, is told the path of each digest it meets: a caller that wants the
 * paths (a whole read, in memory) asks for them, and a reading kept on disk never has them.
 * `where.root` is the project's directory, for the one question that needs a path inside it:
 * whether a file written holds decisions.
 */
export function readTheNewPart(
  path: string,
  reading: Reading,
  where: { readonly cwd: string; readonly root?: string; readonly paths?: Map<string, string> },
): boolean {
  let from = reading.bytes;
  if (from > 0 && statSize(path) < from) {
    Object.assign(reading, emptyReading());
    from = 0;
  }
  const { end, size } = forEachLineFrom(path, from, (line) => {
    const said = parsed(line);
    if (said === undefined) return;
    const at = typeof said.timestamp === 'string' ? said.timestamp : undefined;
    if (at !== undefined && (reading.openedAt === undefined || at < reading.openedAt)) {
      reading.openedAt = at;
    }
    if (said.type === 'user' && isAPrompt(said)) {
      reading.response += 1;
      reading.writesInResponse = 0;
      return;
    }
    if (said.type === 'user') {
      for (const id of idsOfFailedCalls(said)) {
        const call = reading.pending[id];
        if (call === undefined) continue;
        const left = (reading.files[call.file] ?? 1) - 1;
        if (left <= 0) delete reading.files[call.file];
        else reading.files[call.file] = left;
        if (call.response === reading.response) reading.writesInResponse -= 1;
      }
      for (const id of idsOfAnsweredCalls(said)) delete reading.pending[id];
      if (answersToTheQuestionTool(said) !== undefined && at !== undefined) {
        reading.questionTimes.push(at);
        if (reading.questionTimes.length > KEPT) reading.questionTimes.shift();
      }
      return;
    }
    if (said.type !== 'assistant') return;
    const cwd = typeof said.cwd === 'string' ? said.cwd : where.cwd;
    for (const { id, file, content } of filesWritten(said)) {
      const absolute = isAbsolute(file) ? file : resolve(cwd, file);
      const digest = digestOf(absolute);
      where.paths?.set(digest, absolute);
      reading.files[digest] = (reading.files[digest] ?? 0) + 1;
      reading.writesInResponse += 1;
      if (id !== undefined) reading.pending[id] = { file: digest, response: reading.response };
      if (where.root !== undefined) {
        const inside = relative(where.root, absolute);
        if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) {
          const name = inside.split(sep).join('/');
          if (decisionFileAt(name, content) !== undefined && !reading.decisionFiles.includes(name)) {
            reading.decisionFiles.push(name);
          }
        }
      }
    }
    const ids = Object.keys(reading.pending);
    if (ids.length > KEPT) {
      for (const id of ids.slice(0, ids.length - KEPT)) delete reading.pending[id];
    }
  });
  if (size === -1) return false;
  reading.bytes = end;
  return true;
}

function statSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

/**
 * Reads the transcript at `path`, or `undefined` when it cannot be read at all.
 *
 * `cwd` resolves a relative path a tool call named, for the one reason distinct spellings of
 * one file must be one file: the host names a path as the model wrote it.
 */
export function whatTheSessionDid(path: string, cwd: string): SessionDid | undefined {
  const reading = emptyReading();
  const paths = new Map<string, string>();
  if (!readTheNewPart(path, reading, { cwd, paths }) || reading.bytes === 0) return undefined;
  return {
    openedAt: reading.openedAt,
    editedFiles: Object.keys(reading.files).flatMap((digest) => paths.get(digest) ?? []),
    lastResponseEdited: reading.writesInResponse > 0,
  };
}

/** The ids of the tool calls a `user` line says the host answered with an error. */
function idsOfFailedCalls(line: Record<string, unknown>): string[] {
  const content = asObject(line.message)?.content;
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    const result = asObject(block);
    if (result?.type === 'tool_result' && result.is_error === true) {
      if (typeof result.tool_use_id === 'string') ids.push(result.tool_use_id);
    }
  }
  return ids;
}

/** The ids of the tool calls a `user` line carries a result for, whatever the result is. */
function idsOfAnsweredCalls(line: Record<string, unknown>): string[] {
  const content = asObject(line.message)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const result = asObject(block);
    return result?.type === 'tool_result' && typeof result.tool_use_id === 'string'
      ? [result.tool_use_id]
      : [];
  });
}

/** The writes the tool calls of one assistant line name, for the tools that write a file. */
function filesWritten(
  line: Record<string, unknown>,
): { id: string | undefined; file: string; content: string }[] {
  const content = asObject(line.message)?.content;
  if (!Array.isArray(content)) return [];
  const files: { id: string | undefined; file: string; content: string }[] = [];
  for (const block of content) {
    const call = asObject(block);
    if (call === undefined || call.type !== 'tool_use' || typeof call.name !== 'string') continue;
    const field = WRITING_TOOLS[call.name];
    const named = field === undefined ? undefined : asObject(call.input)?.[field];
    if (typeof named === 'string' && named !== '') {
      const input = asObject(call.input);
      const written = input?.['content'] ?? input?.['new_string'];
      files.push({
        id: typeof call.id === 'string' ? call.id : undefined,
        file: named,
        content: typeof written === 'string' ? written : '',
      });
    }
  }
  return files;
}

/**
 * Whether a `user` line is a person's prompt: text, not a tool result, not text the host
 * injected, not a notification or a subagent's hand-back.
 */
function isAPrompt(line: Record<string, unknown>): boolean {
  if (line.isMeta === true || line.isSidechain === true) return false;
  const sender = asObject(line['origin']);
  if (sender !== undefined && sender.kind !== 'human') return false;
  const content = asObject(line.message)?.content;
  if (typeof content === 'string') return true;
  return (
    Array.isArray(content) &&
    content.some((block) => asObject(block)?.type === 'text') &&
    !content.some((block) => asObject(block)?.type === 'tool_result')
  );
}

/** One thing a person typed into a session, and where it is. */
export interface WhatThePersonSaid {
  /** The line of the transcript it is on, counted from 1: what a finding cites. */
  readonly line: number;
  /** The host's own id for the line, when it wrote one. */
  readonly uuid: string | undefined;
  /** The session the line belongs to, as the host wrote it. */
  readonly session: string | undefined;
  /** The words, as the person typed them, or the option they chose in the host's question tool. */
  readonly text: string;
  /**
   * The question these words answer, where they answer one the agent asked: the question the host's
   * question tool put, or the last sentence of a response that ended in a question mark.
   */
  readonly question?: string | undefined;
}

/**
 * Every prompt a person typed in the transcript at `path`, in order, and every answer they gave to
 * a question the agent asked: the one place this module reads WORDS and not the shape of a line,
 * and it is why it is a function of its own.
 *
 * AN ANSWER IS READ TWO WAYS. The answer to the host's question tool is not a prompt: the host
 * writes it as the tool's result, with the questions and the options chosen in `toolUseResult`
 * (Claude Code's format), so that line is read for them and every other tool result is passed
 * over. And a prompt typed right after a response whose last text ends in a question mark is an
 * answer to that question, which is read off the end of that text: its last sentence, and no more.
 *
 * IT RETURNS PROSE, and the caller is `user-corrections.ts`, which quotes at most one sentence of
 * a prompt into a record that stays on this machine. Nothing else reads it, and nothing prints it:
 * a transcript is the whole conversation, including whatever a person pasted into it.
 */
export function whatThePersonSaid(path: string): readonly WhatThePersonSaid[] {
  const said: WhatThePersonSaid[] = [];
  let lines = 0;
  // The question the last response ended in, until the next prompt answers it.
  let asked: string | undefined;
  forEachLine(path, (line) => {
    lines += 1;
    const read = parsed(line);
    if (read === undefined) return true;
    if (read.type === 'assistant' && read.isSidechain !== true) {
      asked = questionEndingThe(read);
      return true;
    }
    if (read.type !== 'user') return true;
    const where = {
      line: lines,
      uuid: typeof read.uuid === 'string' ? read.uuid : undefined,
      session: typeof read.sessionId === 'string' ? read.sessionId : undefined,
    };
    if (!isAPrompt(read)) {
      const chosen = answersToTheQuestionTool(read);
      if (chosen !== undefined) said.push({ ...where, ...chosen });
      return true;
    }
    const question = asked;
    asked = undefined;
    const content = asObject(read.message)?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((block) => asObject(block))
              .flatMap((block) =>
                block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
              )
              .join('\n')
          : '';
    if (text.trim() === '') return true;
    said.push({ ...where, text, ...(question === undefined ? {} : { question }) });
    return true;
  });
  return said;
}

/**
 * The question an assistant line ends in: the last sentence of its last text, when that ends in a
 * question mark and no tool call follows it on the line. Anything else is `undefined`.
 */
function questionEndingThe(line: Record<string, unknown>): string | undefined {
  const content = asObject(line.message)?.content;
  if (!Array.isArray(content)) return undefined;
  const blocks = content.map((block) => asObject(block));
  const last = blocks.at(-1);
  if (last?.type !== 'text' || typeof last.text !== 'string') return undefined;
  const flat = last.text.trim().replace(/\s+/g, ' ');
  if (!flat.endsWith('?')) return undefined;
  const sentences = flat.split(/(?<=[.!?:])\s+/);
  return sentences.at(-1);
}

/**
 * What the person chose in the host's question tool, read off the line that carries its result:
 * each question and its answer, joined, or `undefined` for any other line. A line the host injected
 * or a subagent's is not the person's.
 */
function answersToTheQuestionTool(
  line: Record<string, unknown>,
): { text: string; question: string } | undefined {
  if (line.isMeta === true || line.isSidechain === true) return undefined;
  const answers = asObject(asObject(line['toolUseResult'])?.answers);
  if (answers === undefined) return undefined;
  const pairs = Object.entries(answers).filter(
    (pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1].trim() !== '',
  );
  if (pairs.length === 0) return undefined;
  return {
    text: pairs.map(([, chosen]) => chosen).join('; '),
    question: pairs.map(([question]) => question).join('; '),
  };
}
