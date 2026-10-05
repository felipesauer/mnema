/**
 * THE HOOKS FILE SAYS ONLY WHAT THE HOST READS — an event the host has never heard of is a hook
 * that never runs, and a key it does not know is a field that is dropped without a word.
 *
 * Nothing else in the repository would say so: the handlers are real files and the suite runs
 * them, but it runs them as the TEST names them, not as the host would find them through
 * `plugin/hooks/hooks.json`. A typo in the event (`SessionStart` written `SessionStarts`) or in a
 * key (`timeout` written `timeOut`) leaves every handler green and the plugin mute.
 *
 * The lists live in `support/hook-keys-the-host-reads.ts`, with the date and the page they were
 * read off. This file holds that the plugin's file answers to them, and that the check itself
 * lights when the defect is put back: each case below feeds it a copy of the real file with one
 * thing wrong.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { whatTheHostDoesNotRead } from './support/hook-keys-the-host-reads.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const HOOKS = join(REPO, 'plugin', 'hooks', 'hooks.json');

function theRealFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(HOOKS, 'utf-8')) as Record<string, unknown>;
}

type Handler = Record<string, unknown>;
type Group = Record<string, unknown> & { hooks: Handler[] };
type Copy = Record<string, unknown> & { hooks: Record<string, Group[]> };

/** A deep copy the case can break without touching the file on disk. */
function aCopy(): Copy {
  return structuredClone(theRealFile()) as Copy;
}

/** The first group of an event of a copy; it throws rather than hand back nothing. */
function groupOf(file: Copy, event: string): Group {
  const group = file.hooks[event]?.[0];
  if (group === undefined) throw new Error(`the real file declares no ${event}`);
  return group;
}

/** The first handler of the first group of an event of a copy. */
function handlerOf(file: Copy, event: string): Handler {
  const handler = groupOf(file, event).hooks[0];
  if (handler === undefined) throw new Error(`the real file declares no handler under ${event}`);
  return handler;
}

describe('plugin/hooks/hooks.json', () => {
  it('names only events and keys the host documents', () => {
    expect(whatTheHostDoesNotRead(theRealFile())).toEqual([]);
  });

  it('is not vacuous: it reads events, matcher groups and both kinds of handler', () => {
    const file = aCopy();
    const types = new Set(
      Object.values(file.hooks).flatMap((groups) =>
        groups.flatMap((group) => group.hooks.map((handler) => handler.type)),
      ),
    );
    expect([...types].sort()).toEqual(['command', 'mcp_tool']);
    expect(Object.keys(file.hooks).length).toBeGreaterThan(2);
  });

  it('accuses an event the host does not publish', () => {
    const file = aCopy();
    file.hooks.SessionStarts = file.hooks.SessionStart as Group[];
    delete file.hooks.SessionStart;
    expect(whatTheHostDoesNotRead(file)).toEqual(['event "SessionStarts"']);
  });

  it('accuses a key of a command handler the host does not read', () => {
    const file = aCopy();
    const handler = handlerOf(file, 'Stop');
    handler.timeOut = handler.timeout;
    delete handler.timeout;
    expect(whatTheHostDoesNotRead(file)).toEqual(['Stop handler (command) key "timeOut"']);
  });

  it('accuses a key an mcp_tool handler has no use for', () => {
    const file = aCopy();
    handlerOf(file, 'PreToolUse').command = 'node x';
    expect(whatTheHostDoesNotRead(file)).toEqual(['PreToolUse handler (mcp_tool) key "command"']);
  });

  it('accuses a matcher group key, a top-level key and a type the host does not run', () => {
    const file = aCopy();
    groupOf(file, 'PreToolUse').matchers = 'Write';
    file.hook = {};
    handlerOf(file, 'PreCompact').type = 'shell';
    expect(whatTheHostDoesNotRead(file).sort()).toEqual([
      'PreCompact handler type "shell"',
      'PreToolUse matcher group key "matchers"',
      'top-level key "hook"',
    ]);
  });
});
