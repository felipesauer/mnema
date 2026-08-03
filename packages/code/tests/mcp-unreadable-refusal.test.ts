/**
 * What the agent's surface says when an argument would have made a record no read
 * could open.
 *
 * This is the second half of the door, and the half the agent lives on. The core
 * refuses the write and hands back a typed refusal; the MCP tools have to relay it
 * as DATA — code and message — so the server shapes it into a tool error the agent
 * reads and retries from. Anything that reached the agent as a thrown engine error
 * would arrive as an SDK failure with no field named and nothing to fix, which this
 * series has already recorded as the worse outcome.
 *
 * There is a case per (tool, field), and deliberately not one loop over a list of
 * tools: seven tools each relaying the same refusal is seven places one can be
 * dropped, and the failure has to name the tool that dropped it.
 *
 * Each case asserts three things, because two of them would let the defect back:
 *   1. the reply is a refusal with `UNREADABLE_EVENT` and NAMES the field;
 *   2. nothing was appended — read off the tree's own events, not off the reply;
 *   3. the record still READS afterwards, which is the whole point: the entry that
 *      was kept out is precisely the one that would have made every later read of
 *      this project fail, forever.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters, ensureTree } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, orderedEvents, PROJECT_DIR } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import {
  runCaptureMemory,
  runCreateSkill,
  runCreateTask,
  runLinkKnowledge,
  runRecordDecision,
  runRecordHandoff,
  runRecordObservation,
} from '../src/mcp/tools.js';

let sandbox: string;
let env: DiscoveryEnv;
let project: string;
let session: Session;

const upcasters = catalogUpcasters();

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-mcp-unreadable-'));
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'home', '.local', 'share') };
  project = join(sandbox, 'a-project');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
  session = openSession({
    clientName: 'claude-code',
    roots: [pathToFileURL(project).href],
    env,
  });
  // One real write first, so the session is WARM: a connection founds this
  // installation's anchor and opens its run on the first write it makes, and those
  // two events would otherwise land on the way into the first refusal and make
  // "nothing was appended" read as "two things were". Warming it up leaves the
  // counts below measuring the refusal and nothing else — and it is also the state a
  // real session is in by the time an agent gets an argument wrong.
  const warm = runCaptureMemory(session, { content: 'the record already exists' });
  expect(warm.ok).toBe(true);
});

afterEach(() => {
  closeSession(session);
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Every event the session's trees hold, replayed.
 *
 * A REPLAY and not a line count, because the replay is the thing at stake: it parses
 * every entry, so it throws on exactly the record this door keeps out. "The count
 * did not move" and "the record still opens" are one call.
 */
function recordedEvents(): CatalogEvent[] {
  const found: CatalogEvent[] = [];
  for (const scope of ['public', 'private', 'global'] as const) {
    const root = chainRootForScope(session.trees, scope);
    if (root === undefined) continue;
    found.push(...orderedEvents({ root }, upcasters));
  }
  return found;
}

/** Asserts a tool's reply is the door's refusal, naming `field`, having written nothing. */
function refused(
  reply: { readonly ok: boolean; readonly code?: string; readonly message?: string },
  field: string,
  before: number,
): void {
  expect(reply.ok).toBe(false);
  expect(reply.code).toBe('UNREADABLE_EVENT');
  expect(reply.message).toContain(field);
  expect(reply.message).toContain('The fact was NOT recorded');
  // Read off the disk: the reply saying nothing was written is not evidence that
  // nothing was. And the replay proves the record still opens.
  expect(recordedEvents().length).toBe(before);
}

describe('the agent surface relays the refusal instead of throwing', () => {
  it('refuses an empty task title', () => {
    const before = recordedEvents().length;
    refused(runCreateTask(session, { title: '' }), 'payload.title', before);
  });

  it('refuses an empty decision title, and an empty rationale', () => {
    let before = recordedEvents().length;
    refused(runRecordDecision(session, { title: '', rationale: 'why' }), 'payload.title', before);
    before = recordedEvents().length;
    refused(runRecordDecision(session, { title: 't', rationale: '' }), 'payload.rationale', before);
  });

  it('refuses an empty skill name, and an empty body', () => {
    let before = recordedEvents().length;
    refused(runCreateSkill(session, { name: '', body: 'b' }), 'payload.name', before);
    before = recordedEvents().length;
    refused(runCreateSkill(session, { name: 'n', body: '' }), 'payload.body', before);
  });

  it('refuses an empty memory', () => {
    const before = recordedEvents().length;
    refused(runCaptureMemory(session, { content: '' }), 'payload.content', before);
  });

  it('refuses an empty observation, in each of its three fields', () => {
    for (const [input, field] of [
      [{ about: '', topic: 'k', text: 't' }, 'payload.about'],
      [{ about: 'x', topic: '', text: 't' }, 'payload.topic'],
      [{ about: 'x', topic: 'k', text: '' }, 'payload.text'],
    ] as const) {
      const before = recordedEvents().length;
      refused(runRecordObservation(session, input), field, before);
    }
  });

  it('refuses an empty handoff, including the task that becomes the SUBJECT', () => {
    // The task is the envelope's subject, not a payload field — so a check written
    // over payload fields only would have let this one through, and did.
    for (const [input, field] of [
      [{ task: '', from: 'a', to: 'b' }, 'at subject'],
      [{ task: 't', from: '', to: 'b' }, 'payload.fromAgent'],
      [{ task: 't', from: 'a', to: '' }, 'payload.toAgent'],
    ] as const) {
      const before = recordedEvents().length;
      refused(runRecordHandoff(session, input), field, before);
    }
  });

  it('refuses an empty link, in each of its three fields', () => {
    for (const [input, field] of [
      [{ subject: '', target: 'y', rel: 'r' }, 'at subject'],
      [{ subject: 'x', target: '', rel: 'r' }, 'payload.target'],
      [{ subject: 'x', target: 'y', rel: '' }, 'payload.rel'],
    ] as const) {
      const before = recordedEvents().length;
      refused(runLinkKnowledge(session, input), field, before);
    }
  });

  it('still records the same facts when the fields are there', () => {
    // The non-vacuity half: the tools above are refusing an ARGUMENT, not refusing
    // to work. Without this, a door that refused everything would pass every case.
    expect(runCreateTask(session, { title: 'a real task' }).ok).toBe(true);
    expect(runCaptureMemory(session, { content: 'a real memory' }).ok).toBe(true);
    expect(runRecordDecision(session, { title: 't', rationale: 'why' }).ok).toBe(true);
    expect(runCreateSkill(session, { name: 'n', body: 'b' }).ok).toBe(true);
    expect(runRecordObservation(session, { about: 'x', topic: 'k', text: 't' }).ok).toBe(true);
    expect(runRecordHandoff(session, { task: 't', from: 'a', to: 'b' }).ok).toBe(true);
    expect(runLinkKnowledge(session, { subject: 'x', target: 'y', rel: 'r' }).ok).toBe(true);
    // And the record opens, with every one of those facts in it.
    const kinds = recordedEvents().map((event) => event.kind);
    for (const kind of [
      'task.created',
      'memory.captured',
      'decision.recorded',
      'skill.created',
      'observation.recorded',
      'handoff.recorded',
      'knowledge.linked',
    ]) {
      expect(kinds, kind).toContain(kind);
    }
  });
});
