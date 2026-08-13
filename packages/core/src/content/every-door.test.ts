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
 * chain back and scan every payload generically.
 *
 * WHAT IS GENERIC HERE, AND WHAT IS A LIST — because the two halves of this file
 * are not the same kind of thing, and two doc-comments that said otherwise are what
 * this paragraph replaces. The first claimed that "a field a future operation adds
 * and forgets to screen fails here, without anyone having to remember to extend a
 * list". That was false, and measured false: `alternatives` was added to
 * `decision.recorded` with the screen deliberately bypassed, and the whole suite of
 * 2,059 tests stayed green — this file included, ten of ten. Only the READ half is
 * generic (the sweep below walks every string of every event and knows no field
 * names); the WRITE half is a hand-written list of calls with hand-written
 * arguments, so a field no call below passes is a field no assertion can see. That
 * much is still true of THIS file and always will be.
 *
 * The second claim is the one that is now out of date, and it was the honest reading
 * at the time: that closing it "is the door's own slice", and that until then
 * "extending the lists below is a step a field-adding change owes by hand". That
 * slice happened. `every-field.test.ts` next door drives every kind with every value
 * asked for BY FIELD PATH, from a classification (`fields.ts`) the compiler forces
 * to stay total over the catalog's declarations — so a text field added to any
 * payload fails the build until it is classified, fails that file until a driver
 * passes it, and fails it again until the operation screens it. What this file
 * covers is the axis that one does not: the WRITE POINTS, driven the way a caller
 * really calls them, several operations deep, in one chain read back whole. Two
 * files, two axes; neither is the other's list.
 *
 * And the assertion is always the same one: the value is ABSENT from what was
 * appended. Never that a counter moved (see `secrets.test.ts` for why).
 *
 * THE SWEEP READS THE WHOLE EVENT, envelope included. It used to read payloads
 * only, and that is precisely how `which` — the envelope's one free-text field, and
 * the one stamped on EVERY event of a session — reached the chain unscreened while
 * this file stayed green. A sweep that knows which half of an event to look at is a
 * list, and a list is what nobody remembers to extend.
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

  /** Every string anywhere in every appended event — the generic sweep. */
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
    // The whole event, not `event.payload`: the envelope carries `which`, and a
    // payload-only sweep is exactly what let a credential through it.
    for (const event of orderedEvents(ctx.layout, upcasters)) collect(event);
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
      alternatives: `we turned down ${PASSWORD_URL}, and also ${SECRET}`,
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
    expect(
      endRun(ctx, { run: run.id, which: `agent ${SECRET}`, outcome: `outcome ${SECRET}` }).ok,
    ).toBe(true);

    // The identity family's one free-text field.
    expect(revokeKey(ctx, { revokedFp: 'f'.repeat(64), reason: `retired: ${SECRET}` }).ok).toBe(
      true,
    );

    // THE assertion, over the whole chain: nothing appended holds either value,
    // and no string anywhere — envelope or payload — reads as a credential.
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

    // The third text field a decision carries reports through the same one screen,
    // in field order — so a credential typed into what was TURNED DOWN is named in
    // the reply exactly as one typed into the reason it was chosen.
    const alternatives = recordDecision(ctx, {
      title: 'clean',
      rationale: 'clean',
      alternatives: `we rejected ${SECRET}`,
    });
    expect(alternatives.ok && alternatives.replaced).toEqual(['aws-access-key']);

    const clean = captureMemory(ctx, { content: 'nothing sensitive here' });
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(clean.replaced).toBeUndefined();
  });
});

/**
 * The envelope's executing agent, which the sweep above used to miss.
 *
 * `which` is the agent that executed a fact, and it is one of the two envelope
 * fields a CALLER supplies — `who` and `signerFp` come from a key, `at` from a
 * clock, and `subject` from a mint on most of the kinds there are. It is the worst
 * of them for a credential: it is stamped on EVERY event of a session, so one dirty
 * value is as many disclosures as the session has facts, and over MCP it comes from
 * the client's announced name — nobody types it and nobody reads it.
 *
 * The other one is `run`, and the sentence this replaces called it a mint: "`subject`
 * and `run` [come] from a mint". A run id is minted, but not by the write that
 * stamps it — the caller hands it back in, and no operation here proves it names a
 * session. It goes through the same door now, and the field classification is what
 * found it.
 */
describe('the executing agent goes through the same door', () => {
  let root: string;
  let ctx: WriteContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnema-which-'));
    ctx = { writer: openChainForWriting(root, { keyRoot: root }), layout: { root }, upcasters };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Every string of every appended event, envelope included. */
  function recorded(): string[] {
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
    for (const event of orderedEvents(ctx.layout, upcasters)) collect(event);
    return found;
  }

  /** An agent name carrying a credential — the value that must never be recorded. */
  const DIRTY = `agent-${SECRET}`;

  it('takes the credential out of the agent name at every write point', () => {
    // The whole writing surface again, but with the secret in `which` ONLY and
    // every payload field clean. A payload-only sweep passes this while the chain
    // holds the credential on every one of these events — which is what happened.
    const task = createTask(ctx, { title: 'clean title', which: DIRTY });
    expect(task.ok).toBe(true);
    if (!task.ok) return;
    expect(transitionTask(ctx, { id: task.id, action: 'submit', which: DIRTY }).ok).toBe(true);

    const decision = recordDecision(ctx, { title: 'clean', rationale: 'clean', which: DIRTY });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(
      acceptDecision(ctx, { id: decision.id, fields: { note: 'clean' }, which: DIRTY }).ok,
    ).toBe(true);

    const skill = createSkill(ctx, { name: 'clean', body: 'clean', which: DIRTY });
    expect(skill.ok).toBe(true);
    if (!skill.ok) return;
    expect(reviewSkill(ctx, { id: skill.id, fields: { note: 'clean' }, which: DIRTY }).ok).toBe(
      true,
    );
    expect(recordConsultation(ctx, { skill: skill.id, which: DIRTY }).ok).toBe(true);

    expect(captureMemory(ctx, { content: 'clean', which: DIRTY }).ok).toBe(true);
    expect(
      recordObservation(ctx, { about: 'x', topic: 'clean', text: 'clean', which: DIRTY }).ok,
    ).toBe(true);
    expect(recordHandoff(ctx, { task: 'x', fromAgent: 'a', toAgent: 'b', which: DIRTY }).ok).toBe(
      true,
    );
    expect(linkKnowledge(ctx, { subject: 'a', target: 'b', rel: 'r', which: DIRTY }).ok).toBe(true);
    // The session's agent IS its `which`, in the payload and on the envelope both.
    expect(startRun(ctx, { agent: DIRTY, goal: 'clean' }).ok).toBe(true);

    const text = recorded();
    expect(text.length).toBeGreaterThan(0);
    for (const value of text) {
      expect(value).not.toContain(SECRET);
      expect(detectSecrets(value)).toEqual([]);
    }
    // And the agent survived as an agent — the record still says which one executed.
    expect(text).toContain('agent-<SECRET:aws-access-key>');
  });

  it('reports the agent name it cleaned even when the payload was clean', () => {
    // The failure this closes is not a leak but a SILENCE: the fact was recorded
    // with a placeholder and nobody was told, so a live credential stayed
    // unrotated because the reply read as an ordinary success.
    const task = createTask(ctx, { title: 'nothing sensitive here', which: DIRTY });
    expect(task.ok && task.replaced).toEqual(['aws-access-key']);

    const memory = captureMemory(ctx, { content: 'nothing sensitive here', which: DIRTY });
    expect(memory.ok && memory.replaced).toEqual(['aws-access-key']);

    // Both halves in one report, the payload's class and the agent's, with no
    // caller having to merge two reports (or forget to).
    const both = captureMemory(ctx, { content: `db at ${PASSWORD_URL}`, which: DIRTY });
    expect(both.ok && both.replaced).toEqual(['url-password', 'aws-access-key']);

    // A gated move reports it too — its own screen only ever saw the proof fields.
    expect(task.ok).toBe(true);
    if (!task.ok) return;
    const moved = transitionTask(ctx, {
      id: task.id,
      action: 'submit',
      fields: { note: 'clean' },
      which: DIRTY,
    });
    expect(moved.ok && moved.replaced).toEqual(['aws-access-key']);

    // And the consultation, the one write whose report used to have nowhere to go.
    const skill = createSkill(ctx, { name: 'n', body: 'b' });
    expect(skill.ok).toBe(true);
    if (!skill.ok) return;
    const consulted = recordConsultation(ctx, { skill: skill.id, which: DIRTY });
    expect(consulted.ok && consulted.replaced).toEqual(['aws-access-key']);

    // Absence still means "nothing was taken out", on the same field.
    const clean = captureMemory(ctx, { content: 'clean', which: 'agent' });
    expect(clean.ok && clean.replaced).toBeUndefined();
  });

  it('records an all-credential agent name as the bare placeholder', () => {
    // The degenerate case, decided rather than left to chance: a `which` that is
    // ENTIRELY a credential comes back as `<SECRET:…>`. Odd to read, but honest,
    // and strictly better than stamping the key itself on every event of a session
    // — and the caller is told, so it can reconnect with a name.
    const task = createTask(ctx, { title: 'clean', which: SECRET });
    expect(task.ok && task.replaced).toEqual(['aws-access-key']);
    expect(recorded()).toContain('<SECRET:aws-access-key>');
    expect(recorded().join('\n')).not.toContain(SECRET);
  });

  it('refuses an oversize agent name without appending anything', () => {
    // Nothing has been written, so "appended nothing" is checkable as an absolute.
    expect(orderedEvents(ctx.layout, upcasters).length).toBe(0);
    const oversize = 'y'.repeat(FIELD_BYTE_LIMIT + 1);

    const refusals = [
      createTask(ctx, { title: 'ok', which: oversize }),
      recordDecision(ctx, { title: 'ok', rationale: 'ok', which: oversize }),
      createSkill(ctx, { name: 'n', body: 'b', which: oversize }),
      captureMemory(ctx, { content: 'ok', which: oversize }),
      recordObservation(ctx, { about: 'x', topic: 'k', text: 't', which: oversize }),
      recordHandoff(ctx, { task: 'x', fromAgent: 'a', toAgent: 'b', which: oversize }),
      linkKnowledge(ctx, { subject: 'a', target: 'b', rel: 'r', which: oversize }),
      recordConsultation(ctx, { skill: 'x', which: oversize }),
      startRun(ctx, { agent: oversize }),
    ];
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false);
      if (refusal.ok) continue;
      expect(refusal.code).toBe('CONTENT_TOO_LARGE');
    }
    expect(orderedEvents(ctx.layout, upcasters).length).toBe(0);
  });

  it('still refuses the anchor as the agent, on the screened value', () => {
    // The authority invariant is unchanged and is still judged on the string the
    // chain would store: screening runs BEFORE the comparison, so no caller can
    // compare one form and record another.
    const task = createTask(ctx, { title: 'a task' });
    expect(task.ok).toBe(true);
    const who = ctx.writer.anchor;

    const self = createTask(ctx, { title: 'clean', which: who });
    expect(self.ok).toBe(false);
    if (self.ok) return;
    expect(self.code).toBe('WHO_IS_WHICH');

    // A gated move too, and with surrounding whitespace, which canonicalization
    // strips before the comparison.
    if (!task.ok) return;
    const moved = transitionTask(ctx, { id: task.id, action: 'submit', which: `  ${who}  ` });
    expect(moved.ok).toBe(false);
    if (moved.ok) return;
    expect(moved.code).toBe('WHO_IS_WHICH');
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
      // The optional field is under the same ceiling as the required ones: the
      // limit is a property of a text FIELD, not of whether the caller had to
      // supply it.
      recordDecision(ctx, { title: 'ok', rationale: 'why', alternatives: oversize }),
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
    expect(endRun(ctx, { run: run.id, which: 'agent', outcome: oversize }).ok).toBe(false);

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
