/**
 * `mnema after-a-write`: what a file a session just wrote means to the record, for a `PostToolUse`
 * hook on Claude Code's `Write` and `Edit`.
 *
 * TWO FILES MEAN SOMETHING, AND EVERY OTHER IS SILENCE.
 *
 *   - A NOTE OF THE HOST'S OWN MEMORY (`host-memory.ts` says where it is). Where somebody switched
 *     `host-memory-mirror` on, the note is copied into this machine's PRIVATE tree as a memory,
 *     whatever the agent does next: the host's memory is kept apart from the record, and a session
 *     that writes there has written down something it learnt about this project. The copy carries a
 *     marker with the file's name and a hash of its content, so a note is copied once per content and
 *     a note the host rewrote is copied again. The index (`MEMORY.md`) and a note about the person
 *     (`type: user`) are never copied. The agent is told the id in one line, and the person in the
 *     `systemMessage`.
 *   - A FILE THAT HOLDS DECISIONS (`decision-files.ts` says which). Where the record cites the file
 *     nowhere, the session is told, once per session and file, which command reads it into the
 *     record. NOTHING IS WRITTEN for it, and never to the public tree: what enters the record from
 *     there enters through a verb somebody runs.
 *
 * A HOST RUNS IT, AND IT NEVER FAILS THE HOST. Every outcome that is not one of the two replies is
 * the empty reply `{}`; what went wrong is a note on the second stream, and nothing reads it to
 * decide.
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { channelIsOn, type ScopedCache } from '@mnema/context';
import {
  DERIVED_FROM_RELATION,
  type DiscoveryEnv,
  readHostMemory,
  resolveTrees,
} from '@mnema/core';
import { type DecisionFileReading, decisionFileAt } from '../decision-files.js';
import { hostMemoryMarker, hostMemoryPlace, isHostMemoryNote } from '../host-memory.js';
import {
  DECISION_FILE_WRITTEN_CHANNEL,
  HOST_MEMORY_MIRROR_CHANNEL,
  STARTS_OFF,
} from '../record-framing.js';
import { withScopedCaches } from '../tree-sources.js';
import { runMemory } from './memory.js';

/** What the command needs: injected so it is testable. */
export interface AfterAWriteContext {
  /** Where the host started the hook: the project is resolved from it. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
  /** `$CLAUDE_CONFIG_DIR` as the host exported it: where its memory lives unless a setting moves it. */
  readonly hostConfigDir?: string | undefined;
  /** The agent `MNEMA_AGENT_KEY` named, for the copy's signature. */
  readonly agentKey?: string;
}

/** The reply for the host, and what the run has to say beside it. */
export interface AfterAWriteDone {
  readonly ok: true;
  /** The JSON the host reads on stdout: `{}` unless there is something to say. */
  readonly reply: object;
  /** Lines for the second stream: what could not be done, and why. */
  readonly notes: readonly string[];
}

/** The name the copies are recorded under: the actor is a reader, not a person and not a model. */
export const HOST_MEMORY_READER = 'mnema-host-memory';

/** The tools this answers, by the name the host gives them in the payload. */
const WRITES = new Set(['Write', 'Edit']);

/** The silence, with what to say about it on the second stream. */
function silent(notes: readonly string[] = []): AfterAWriteDone {
  return { ok: true, reply: {}, notes };
}

/** A reply the host hands the session beside the result of the write. */
function besideTheResult(line: string, extra: object = {}): AfterAWriteDone {
  return {
    ok: true,
    reply: {
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: line },
      ...extra,
    },
    notes: [],
  };
}

/** A field of an object, when it is a string. */
function text(of: unknown, key: string): string | undefined {
  if (typeof of !== 'object' || of === null) return undefined;
  const value = (of as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** Answers the hook payload `input.payload`: a copy, a line, or `{}`. */
export function runAfterAWrite(
  ctx: AfterAWriteContext,
  input: { readonly payload: string },
): AfterAWriteDone {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.payload);
    if (typeof parsed !== 'object' || parsed === null) return silent();
    payload = parsed as Record<string, unknown>;
  } catch {
    return silent(['The hook input was not JSON, so the write was not read.']);
  }
  if (payload['hook_event_name'] !== 'PostToolUse') return silent();
  if (!WRITES.has(String(payload['tool_name']))) return silent();
  const named = text(payload['tool_input'], 'file_path');
  if (named === undefined || named === '') return silent();
  const file = isAbsolute(named) ? resolve(named) : resolve(ctx.cwd, named);

  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return silent();

  const place = hostMemoryPlace(
    { CLAUDE_CONFIG_DIR: ctx.hostConfigDir, home: ctx.env.home },
    ctx.cwd,
  );
  if (isHostMemoryNote(file, place)) return mirrored(ctx, trees, file);

  const root = dirname(trees.projectPublic);
  const rel = relative(root, file);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return silent();
  const path = rel.split(sep).join('/');
  const written =
    text(payload['tool_input'], 'content') ?? text(payload['tool_input'], 'new_string') ?? '';
  const reading = decisionFileAt(path, written);
  if (reading === undefined) return silent();
  const transcript = text(payload, 'transcript_path');
  return withScopedCaches(trees, (sources): AfterAWriteDone => {
    if (!channelIsOn(sources, DECISION_FILE_WRITTEN_CHANNEL, STARTS_OFF)) return silent();
    if (cites(sources, path)) return silent();
    const line = decisionFileLine(path, reading);
    if (transcript !== undefined && toldBefore(transcript, leadOf(path))) return silent();
    return besideTheResult(line);
  });
}

/** Copies a note of the host's memory into the private tree, once per content. */
function mirrored(
  ctx: AfterAWriteContext,
  trees: ReturnType<typeof resolveTrees>,
  file: string,
): AfterAWriteDone {
  // THE CHANNEL IS ASKED BEFORE THE NOTE IS READ: where it is off, a note is never opened.
  const on = withScopedCaches(trees, (sources) =>
    channelIsOn(sources, HOST_MEMORY_MIRROR_CHANNEL, STARTS_OFF),
  );
  if (!on) return silent();
  let content: string;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    return silent([`The note ${file} could not be read, so it was not copied.`]);
  }
  const note = readHostMemory(content);
  if (note === undefined) {
    return silent([`The note ${file} has no name and body, so it was not copied.`]);
  }
  // A NOTE ABOUT THE PERSON IS THEIRS: the host keeps it to know who it works with, and the record
  // is about the project.
  if (note.type?.toLowerCase() === 'user') return silent();
  const marker = hostMemoryMarker(file, content);
  const copied = withScopedCaches(trees, (sources) =>
    sources
      .filter((source) => source.scope !== 'global')
      .some((source) => source.cache.listMemories().some((one) => one.content.includes(marker))),
  );
  if (copied) return silent();
  const done = runMemory(
    {
      cwd: ctx.cwd,
      env: ctx.env,
      ...(ctx.agentKey !== undefined ? { agentKey: ctx.agentKey } : {}),
    },
    {
      content: `${note.name}\n\n${note.body}\n\n${marker}`,
      // ALWAYS THE PRIVATE TREE: the host's memory is this machine's, and a clone never gets it.
      scope: 'private',
      which: HOST_MEMORY_READER,
    },
  );
  if (!done.ok) {
    return silent([
      `The note ${file} was not copied: ${done.reason === 'REFUSED' ? done.message : done.reason}`,
    ]);
  }
  const name = basename(file);
  return besideTheResult(
    `This note of the host’s memory, ${name}, was copied into this machine’s private tree of the project’s record as memory ${done.id}.`,
    {
      systemMessage: `mnema copied the host memory note ${name} into this machine’s private tree: ${done.id}.`,
    },
  );
}

/** Whether the record already cites the file: a decision derived from it, or any link to it. */
function cites(sources: readonly ScopedCache[], path: string): boolean {
  return sources.some(
    (source) =>
      source.cache.listLinksTo(path).length > 0 ||
      source.cache
        .linksByRelation(DERIVED_FROM_RELATION)
        .some(
          (edge) =>
            edge.target === path ||
            edge.target.startsWith(`${path}:`) ||
            edge.target.startsWith(`${path}#`),
        ),
  );
}

/** What every line about a file opens with: how the session is told once per file. */
function leadOf(path: string): string {
  return `\`${path}\` was written`;
}

/** The line a session is handed about a decision file: what it is, and the door that reads it. */
function decisionFileLine(path: string, reading: DecisionFileReading): string {
  const lead = leadOf(path);
  switch (reading.door) {
    case 'adr-directory':
      return `${lead} in a directory of decision files, and this project’s record cites it nowhere: \`mnema decision import ${reading.directory}\` lists the decisions it would propose from there, and records them with \`--write\`.`;
    case 'rulings':
      return `${lead} with \`Ruling:\` lines, and this project’s record cites it nowhere: \`mnema decision import --format rulings ${path}\` lists the decisions it would propose from them, and records them with \`--write\`.`;
    case 'record-decision':
      return `${lead} with lines in the shape of a decision, and this project’s record cites it nowhere: \`record_decision\` records one, with its reasons and the alternatives turned down.`;
  }
}

/**
 * Whether the session was already handed a line about this file: the host writes what a hook added
 * beside a tool's result into the transcript (`hook_additional_context`), so the transcript is
 * where "once per session and file" is read from, and nothing is kept for it here.
 */
function toldBefore(transcript: string, lead: string): boolean {
  let lines: string[];
  try {
    lines = readFileSync(transcript, 'utf-8').split('\n');
  } catch {
    return false;
  }
  for (const line of lines) {
    if (!line.includes('hook_additional_context')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const attachment = (entry as { attachment?: { type?: unknown; content?: unknown } }).attachment;
    if (attachment?.type !== 'hook_additional_context') continue;
    const content = attachment.content;
    const said = Array.isArray(content) ? content : [content];
    if (said.some((one) => typeof one === 'string' && one.includes(lead))) return true;
  }
  return false;
}
