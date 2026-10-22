/**
 * What an agent is told about a task, through the tools it calls: the description it was opened
 * with, the brief the last handoff carried, who has it and what happened last, whether the file a
 * link ends in is still there, and a decision found by the label it is cited by.
 *
 * Each case drives the tool that answers it, over a real session on a real tree, and asserts on the
 * value the tool returns: a text recorded through one tool is read back through another.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import {
  runBootstrap,
  runCreateTask,
  runNextActionsTool,
  runReadRecordTool,
  runRecordDecision,
  runRecordHandoff,
  runRecordObservation,
  runReferencesTool,
  runSearchTool,
  runTaskTransition,
} from '../src/mcp/tools.js';

let sandbox: string;
let project: string;
let env: DiscoveryEnv;
let session: Session;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-task-prose-'));
  env = { home: join(sandbox, 'home') };
  mkdirSync(env.home, { recursive: true });
  project = join(sandbox, 'repo');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
  session = openSession({
    clientName: 'claude-code',
    roots: [pathToFileURL(project).href],
    env,
  });
});

afterEach(() => {
  closeSession(session);
  rmSync(sandbox, { recursive: true, force: true });
});

/** A task moved to IN_PROGRESS: the state a handoff is about. */
function aTaskInProgress(description?: string): string {
  const made = runCreateTask(session, {
    title: 'Wire the importer',
    ...(description !== undefined ? { description } : {}),
  });
  if (!made.ok) throw new Error(`create refused: ${made.message}`);
  for (const action of ['submit', 'start']) {
    const moved = runTaskTransition(session, { id: made.id, action });
    if (!moved.ok) throw new Error(`${action} refused: ${moved.message}`);
  }
  return made.id;
}

describe('read_record of a task', () => {
  it('serves the description, the last handoff with its brief, and the notes newest first', () => {
    const id = aTaskInProgress('Move the importer to the new schema.\nKeep the old reader.');
    const handed = runRecordHandoff(session, {
      task: id,
      from: 'alice',
      to: 'bob',
      brief: 'The schema is done; start at src/import.ts.',
    });
    expect(handed.ok).toBe(true);
    runRecordObservation(session, { about: id, topic: 'finding', text: 'Three duplicate keys' });
    runRecordObservation(session, { about: id, topic: 'blocker', text: 'The vendor API is down' });

    const read = runReadRecordTool(session, { id });
    if (!read.ok || read.value.kind !== 'task') throw new Error('the task was not read');
    const { story } = read.value;
    expect(story?.description).toMatchObject({
      text: 'Move the importer to the new schema.\nKeep the old reader.',
    });
    expect(story?.handoff).toMatchObject({
      from: 'alice',
      to: 'bob',
      brief: { text: 'The schema is done; start at src/import.ts.' },
    });
    expect(story?.notes.items.map((note) => [note.topic, note.line])).toEqual([
      ['blocker', 'The vendor API is down'],
      ['finding', 'Three duplicate keys'],
    ]);
    expect(story?.notes.total).toBe(2);
  });

  it('serves a task nobody wrote beside exactly as it was: no story at all', () => {
    const made = runCreateTask(session, { title: 'Plain' });
    if (!made.ok) throw new Error('create refused');
    const read = runReadRecordTool(session, { id: made.id });
    expect(read.ok && read.value.kind === 'task' && 'story' in read.value).toBe(false);
  });
});

describe('the opening read and next_actions say who has a task and what happened last', () => {
  it('names the agent the task was handed to, and the newest note or move', () => {
    const id = aTaskInProgress();
    runRecordHandoff(session, { task: id, from: 'alice', to: 'bob', brief: 'Over to you.' });
    const [item] = runBootstrap(session).work;
    expect(item).toMatchObject({
      id,
      owner: { name: 'bob', via: 'handoff' },
      lastFact: { line: expect.stringContaining('brief: Over to you.') },
    });
    runRecordObservation(session, { about: id, topic: 'finding', text: 'Three duplicate keys' });
    expect(runBootstrap(session).work[0]?.lastFact?.line).toBe('finding: Three duplicate keys');

    const next = runNextActionsTool(session, { id });
    expect(next.ok && next.owner).toEqual({ name: 'bob', via: 'handoff' });
    expect(next.ok && next.lastFact?.line).toBe('finding: Three duplicate keys');
  });

  it('names whoever started the task when it was never handed over', () => {
    const id = aTaskInProgress();
    expect(runBootstrap(session).work[0]).toMatchObject({
      id,
      owner: { name: 'claude-code', via: 'start' },
      lastFact: { line: 'start → IN_PROGRESS' },
    });
  });
});

describe('audit_refs of a path', () => {
  it('says whether the file exists today and the sha256 of its bytes, and writes nothing', () => {
    writeFileSync(join(project, 'a.txt'), 'hello\n');
    const present = runReferencesTool(session, { id: 'a.txt' });
    expect(present.ok && present.value.file).toEqual({
      path: 'a.txt',
      exists: true,
      kind: 'file',
      bytes: 6,
      sha256: createHash('sha256').update('hello\n').digest('hex'),
    });
    const absent = runReferencesTool(session, { id: 'nothere.txt' });
    expect(absent.ok && absent.value.file).toEqual({ path: 'nothere.txt', exists: false });
  });

  it('reads nothing outside the project, and nothing for a record', () => {
    const outside = runReferencesTool(session, { id: '../elsewhere.txt' });
    expect(outside.ok && 'file' in outside.value).toBe(false);
    const id = aTaskInProgress();
    const record = runReferencesTool(session, { id });
    expect(record.ok && 'file' in record.value).toBe(false);
  });
});

describe('search by the label a decision is cited by', () => {
  it('finds the decision that carries ADR-1, whatever the case', () => {
    const decided = runRecordDecision(session, {
      title: 'Use sqlite',
      rationale: 'It is simple enough.',
    });
    if (!decided.ok) throw new Error('decision refused');
    for (const term of ['ADR-1', 'adr-1']) {
      const found = runSearchTool(session, { term });
      expect(found.ok && found.value.hits.map((hit) => hit.id)).toEqual([decided.id]);
    }
  });
});
