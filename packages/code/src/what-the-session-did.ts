/**
 * What one session of the host did, read off its own transcript: which files its tool calls
 * wrote, and when it opened.
 *
 * IT READS THE SHAPE OF A LINE AND NEVER A MESSAGE'S WORDS — with ONE function that does, said where
 * it stands ({@link whatThePersonSaid}), and used by the one reader that is switched off until a
 * person switches it on. The answer is a set of paths the
 * session's tool calls named, an instant, and whether the last response wrote anything — a
 * line that is not an assistant's tool call is passed over without being looked into. This is
 * the limit `transcripts.ts` keeps for token counts, with one difference that is stated
 * rather than hidden: a PATH is what a person typed or what the model chose, so it is
 * content, and the module that returns it returns it to a caller that prints a COUNT.
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
 * prompt is the `user` line whose content is text and whose sender is a person — the host flags
 * text it injected (`isMeta`) and names a sender that is not `human` on task notifications and a
 * subagent's hand-back, so neither is mistaken for somebody typing.
 */

import { isAbsolute, resolve } from 'node:path';
import { asObject, forEachLine, parsed } from './transcripts.js';

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
 * Reads the transcript at `path`, or `undefined` when it cannot be read at all.
 *
 * `cwd` resolves a relative path a tool call named, for the one reason distinct spellings of
 * one file must be one file: the host names a path as the model wrote it.
 */
export function whatTheSessionDid(path: string, cwd: string): SessionDid | undefined {
  let lines = 0;
  let openedAt: string | undefined;
  const edited = new Set<string>();
  let lastResponseEdited = false;
  forEachLine(path, (line) => {
    lines += 1;
    const said = parsed(line);
    if (said === undefined) return true;
    const at = typeof said.timestamp === 'string' ? said.timestamp : undefined;
    if (at !== undefined && (openedAt === undefined || at < openedAt)) openedAt = at;
    if (said.type === 'user' && isAPrompt(said)) {
      lastResponseEdited = false;
      return true;
    }
    if (said.type !== 'assistant') return true;
    const where = typeof said.cwd === 'string' ? said.cwd : cwd;
    for (const file of filesWritten(said)) {
      edited.add(isAbsolute(file) ? file : resolve(where, file));
      lastResponseEdited = true;
    }
    return true;
  });
  return lines === 0 ? undefined : { openedAt, editedFiles: [...edited], lastResponseEdited };
}

/** The paths the tool calls of one assistant line name, for the tools that write a file. */
function filesWritten(line: Record<string, unknown>): string[] {
  const content = asObject(line.message)?.content;
  if (!Array.isArray(content)) return [];
  const files: string[] = [];
  for (const block of content) {
    const call = asObject(block);
    if (call === undefined || call.type !== 'tool_use' || typeof call.name !== 'string') continue;
    const field = WRITING_TOOLS[call.name];
    const named = field === undefined ? undefined : asObject(call.input)?.[field];
    if (typeof named === 'string' && named !== '') files.push(named);
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
  /** The line of the transcript it is on, counted from 1 — what a finding cites. */
  readonly line: number;
  /** The host's own id for the line, when it wrote one. */
  readonly uuid: string | undefined;
  /** The session the line belongs to, as the host wrote it. */
  readonly session: string | undefined;
  /** The words, as the person typed them. */
  readonly text: string;
}

/**
 * Every prompt a person typed in the transcript at `path`, in order — the one place this module
 * reads WORDS and not the shape of a line, and it is why it is a function of its own.
 *
 * IT RETURNS PROSE, and the caller is `user-corrections.ts`, which quotes at most one sentence of
 * a prompt into a record that stays on this machine. Nothing else reads it, and nothing prints it:
 * a transcript is the whole conversation, including whatever a person pasted into it.
 */
export function whatThePersonSaid(path: string): readonly WhatThePersonSaid[] {
  const said: WhatThePersonSaid[] = [];
  let lines = 0;
  forEachLine(path, (line) => {
    lines += 1;
    const read = parsed(line);
    if (read === undefined || read.type !== 'user' || !isAPrompt(read)) return true;
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
    said.push({
      line: lines,
      uuid: typeof read.uuid === 'string' ? read.uuid : undefined,
      session: typeof read.sessionId === 'string' ? read.sessionId : undefined,
      text,
    });
    return true;
  });
  return said;
}
