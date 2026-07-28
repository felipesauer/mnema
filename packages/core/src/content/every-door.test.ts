import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureMemory,
  linkKnowledge,
  recordHandoff,
  recordObservation,
} from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import {
  acceptDecision,
  recordDecision,
  supersedeDecision,
} from '../workflow/decision-operations.js';
import { revokeKey } from '../workflow/identity-operations.js';
import { createTask, transitionTask, type WriteContext } from '../workflow/operations.js';
import { endRun, startRun } from '../workflow/session-operations.js';
import { createSkill, recordConsultation, reviewSkill } from '../workflow/skill-operations.js';
import { FIELD_BYTE_LIMIT } from './screen.js';
import { detectSecrets } from './secrets.js';

/**
 * The invariant this file exists for: EVERY write goes through the content door.
 *
 * Not "the ones the author remembered". The authority invariant taught this lesson
 * once already — as a copied block it was simply MISSING from the four knowledge
 * facts, and a self-authorized capture reached the chain before anyone noticed. So
 * these tests drive every operation that appends free text, then read the WHOLE
 * chain back and scan every payload generically. A field a future operation adds
 * and forgets to screen fails here, without anyone having to remember to extend a
 * list — the scan does not know the field names.
 *
 * And the assertion is always the same one: the value is ABSENT from what was
 * appended. Never that a counter moved (see `secrets.test.ts` for why).
 */

const upcasters = catalogUpcasters();

/** The value every operation below is asked to record. It must never be found. */
const SECRET = 'AKIAIOSFODNN7EXAMPLE';

/** A second class, so a field carrying two is covered by the same sweep. */
const PASSWORD_URL = 'postgres://svc:Tr0ub4dor3@db.internal/app';
const PASSWORD = 'Tr0ub4dor3';

describe('the content door runs at every write point', () => {
  let root: string;
  let ctx: WriteContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnema-door-'));
    ctx = { writer: openChainForWriting(root, { keyRoot: root }), layout: { root }, upcasters };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Every string anywhere in every appended payload — the generic sweep. */
  function recordedText(): string[] {
    const found: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        found.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const item of Object.values(value)) collect(item);
      }
    };
    for (const event of orderedEvents(ctx.layout, upcasters)) collect(event.payload);
    return found;
  }

  it('takes the credential out of every field of every operation', () => {
    // One pass through the whole writing surface, with the secret in EVERY
    // free-text field each operation carries.
    const task = createTask(ctx, { title: `open ${SECRET}`, which: 'agent' });
    expect(task.ok).toBe(true);
    if (!task.ok) return;

    const moved = transitionTask(ctx, {
      id: task.id,
      action: 'cancel',
      fields: {
        reason: `dropping ${SECRET}`,
        note: `see ${PASSWORD_URL}`,
        feedback: `and ${SECRET}`,
        pr_url: `https://u:${PASSWORD}@git.internal/pr/1`,
        links: [`https://u:${PASSWORD}@wiki.internal/x`, `about ${SECRET}`],
      },
      which: 'agent',
    });
    expect(moved.ok).toBe(true);

    const decision = recordDecision(ctx, {
      title: `use ${SECRET}`,
      rationale: `because ${PASSWORD_URL}`,
      which: 'agent',
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    const successor = recordDecision(ctx, { title: 'the replacement', rationale: 'why' });
    expect(successor.ok).toBe(true);
    if (!successor.ok) return;

    expect(
      supersedeDecision(ctx, {
        id: decision.id,
        by: successor.id,
        fields: { reason: `replaced because of ${SECRET}` },
        which: 'agent',
      }).ok,
    ).toBe(true);

    const accepted = recordDecision(ctx, { title: 'accepted one', rationale: 'why' });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(
      acceptDecision(ctx, {
        id: accepted.id,
        fields: { note: `agreed, and ${SECRET}` },
        which: 'agent',
      }).ok,
    ).toBe(true);

    const skill = createSkill(ctx, {
      name: `deploy with ${SECRET}`,
      body: `run it against ${PASSWORD_URL}`,
      which: 'agent',
    });
    expect(skill.ok).toBe(true);
    if (!skill.ok) return;
    expect(
      reviewSkill(ctx, {
        id: skill.id,
        fields: { note: `reviewed, ${SECRET}` },
        which: 'agent',
      }).ok,
    ).toBe(true);

    expect(captureMemory(ctx, { content: `remember ${SECRET}`, which: 'agent' }).ok).toBe(true);
    expect(
      recordObservation(ctx, {
        // The reference too: it is an id by contract but never validated, so it is
        // a field a credential can arrive in like any other.
        about: `about ${SECRET}`,
        topic: `topic ${SECRET}`,
        text: `text ${PASSWORD_URL}`,
        which: 'agent',
      }).ok,
    ).toBe(true);
    expect(
      recordHandoff(ctx, {
        task: `task ${SECRET}`,
        fromAgent: `from ${SECRET}`,
        toAgent: `to ${PASSWORD_URL}`,
        which: 'agent',
      }).ok,
    ).toBe(true);
    expect(
      linkKnowledge(ctx, {
        subject: `subject ${SECRET}`,
        target: `target ${PASSWORD_URL}`,
        rel: `relates-to ${SECRET}`,
        which: 'agent',
      }).ok,
    ).toBe(true);

    const run = startRun(ctx, { agent: `agent ${SECRET}`, goal: `goal ${PASSWORD_URL}` });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(endRun(ctx, { run: run.id, outcome: `outcome ${SECRET}` }).ok).toBe(true);

    // The identity family's one free-text field.
    expect(revokeKey(ctx, { revokedFp: 'f'.repeat(64), reason: `retired: ${SECRET}` }).ok).toBe(
      true,
    );

    // THE assertion, over the whole chain: nothing appended holds either value,
    // and no payload string anywhere reads as a credential of any class.
    const text = recordedText();
    expect(text.length).toBeGreaterThan(0);
    for (const value of text) {
      expect(value).not.toContain(SECRET);
      expect(value).not.toContain(PASSWORD);
      expect(detectSecrets(value)).toEqual([]);
    }
  });

  it('reports what it replaced on every operation that replaced something', () => {
    // The scrub is never silent (the caller has to be able to rotate), so every
    // operation carries the report back. Absence of the report is what says
    // "nothing was taken out" — asserted on the clean write below.
    const task = createTask(ctx, { title: `open ${SECRET}` });
    expect(task.ok && task.replaced).toEqual(['aws-access-key']);

    const memory = captureMemory(ctx, { content: `remember ${PASSWORD_URL}` });
    expect(memory.ok && memory.replaced).toEqual(['url-password']);

    const decision = recordDecision(ctx, {
      title: `use ${SECRET}`,
      rationale: `because ${PASSWORD_URL}`,
    });
    // Both fields, both classes, one report.
    expect(decision.ok && decision.replaced).toEqual(['aws-access-key', 'url-password']);

    const clean = captureMemory(ctx, { content: 'nothing sensitive here' });
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(clean.replaced).toBeUndefined();
  });
});

describe('the size limit refuses without appending anything', () => {
  let root: string;
  let ctx: WriteContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnema-cap-'));
    ctx = { writer: openChainForWriting(root, { keyRoot: root }), layout: { root }, upcasters };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const oversize = 'x'.repeat(FIELD_BYTE_LIMIT + 1);

  /** How many events the chain holds right now. */
  function eventCount(): number {
    return orderedEvents(ctx.layout, upcasters).length;
  }

  it('refuses every birth and every fact, leaving the chain untouched', () => {
    // Nothing has been written yet, so the chain is empty — which makes "appended
    // nothing" checkable as an absolute, not only as a delta.
    expect(eventCount()).toBe(0);

    const refusals = [
      createTask(ctx, { title: oversize }),
      recordDecision(ctx, { title: oversize, rationale: 'why' }),
      recordDecision(ctx, { title: 'ok', rationale: oversize }),
      createSkill(ctx, { name: oversize, body: 'b' }),
      createSkill(ctx, { name: 'n', body: oversize }),
      captureMemory(ctx, { content: oversize }),
      recordObservation(ctx, { about: 'x', topic: oversize, text: 't' }),
      recordObservation(ctx, { about: 'x', topic: 'k', text: oversize }),
      // The REFERENCE fields, which no fact validates: they are the only path by
      // which an unbounded value could still reach the chain, and a fat event is
      // exactly what the limit exists to keep out.
      recordObservation(ctx, { about: oversize, topic: 'k', text: 't' }),
      recordHandoff(ctx, { task: 'x', fromAgent: oversize, toAgent: 'b' }),
      recordHandoff(ctx, { task: 'x', fromAgent: 'a', toAgent: oversize }),
      recordHandoff(ctx, { task: oversize, fromAgent: 'a', toAgent: 'b' }),
      linkKnowledge(ctx, { subject: 'a', target: 'b', rel: oversize }),
      linkKnowledge(ctx, { subject: oversize, target: 'b', rel: 'r' }),
      linkKnowledge(ctx, { subject: 'a', target: oversize, rel: 'r' }),
      recordConsultation(ctx, { skill: oversize }),
      startRun(ctx, { agent: oversize }),
      startRun(ctx, { agent: 'a', goal: oversize }),
      revokeKey(ctx, { revokedFp: 'f'.repeat(64), reason: oversize }),
    ];

    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false);
      if (refusal.ok) continue;
      expect(refusal.code).toBe('CONTENT_TOO_LARGE');
    }

    // Not one event — not even the `identity.founded` a write seeds on its way in.
    // That is what makes the refusal free: the caller can fix the input and retry
    // into a chain that never heard about the attempt.
    expect(eventCount()).toBe(0);
  });

  it('refuses a transition and a close, leaving the record exactly as it was', () => {
    const task = createTask(ctx, { title: 'a real task' });
    expect(task.ok).toBe(true);
    if (!task.ok) return;
    const run = startRun(ctx, { agent: 'agent' });
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const before = eventCount();

    expect(
      transitionTask(ctx, { id: task.id, action: 'cancel', fields: { reason: oversize } }).ok,
    ).toBe(false);
    expect(
      transitionTask(ctx, {
        id: task.id,
        action: 'cancel',
        fields: { reason: 'ok', links: ['x'.repeat(FIELD_BYTE_LIMIT + 1)] },
      }).ok,
    ).toBe(false);
    expect(endRun(ctx, { run: run.id, outcome: oversize }).ok).toBe(false);

    expect(eventCount()).toBe(before);

    // And the task did not move: a refused transition is not a half-applied one.
    const moved = transitionTask(ctx, { id: task.id, action: 'cancel', fields: { reason: 'now' } });
    expect(moved.ok && moved.to).toBe('CANCELED');
  });

  it('refuses BEFORE the gate, so an oversize proof is not a gate refusal', () => {
    const task = createTask(ctx, { title: 'a real task' });
    expect(task.ok).toBe(true);
    if (!task.ok) return;

    // `start` is not legal from DRAFT, so the gate would refuse this move on its
    // own. The content door answers first — which is the ordering that makes an
    // oversize field cost nothing at all, not even reading the task's state.
    const refused = transitionTask(ctx, {
      id: task.id,
      action: 'start',
      fields: { reason: oversize },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('CONTENT_TOO_LARGE');
  });
});
