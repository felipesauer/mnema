/**
 * WHAT THE PAGE LISTS IS ONE FUNCTION OF THE RECORD'S EVENTS.
 *
 * The events here are built by the chain's own builders (`decisionBirth`, `memoryCaptured`, ...),
 * so a fixture cannot say a state, a relation or a payload the product would not write. The cases
 * hold what `pageModel` makes of them: which notes sit under which decision, what a retraction
 * leaves visible, whose act each is and in what words, the addresses, the order of the timeline
 * (the record's, not the clock's) and when an `ADR-<n>` may be an anchor.
 */

import {
  ASKS_FOR_A_PERSON_RELATION,
  type CatalogEvent,
  decisionBirth,
  decisionTransitioned,
  GOVERNS_RELATION,
  knowledgeLinked,
  memoryCaptured,
  noteRetracted,
  observationRecorded,
  REFUSES_A_WRITE_RELATION,
  taskCreated,
} from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { A_PERSON } from '../one-line.js';
import { actWording, pageModel } from './model.js';

const ALICE = 'mnid:aaaaaaaaaaaaaaaa';
const BOB = 'mnid:bbbbbbbbbbbbbbbb';
const FP = 'f'.repeat(64);

/** The envelope of the nth event: one second apart, unless the case sets the clock. */
function at(n: number, subject: string, who = ALICE, which?: string) {
  const second = String(n).padStart(2, '0');
  return {
    at: `2026-01-01T00:00:${second}.000Z`,
    who,
    signerFp: FP,
    subject,
    ...(which !== undefined ? { which } : {}),
  };
}

function decided(
  n: number,
  id: string,
  adr: string,
  title: string,
  state?: 'accepted' | 'rejected',
): CatalogEvent[] {
  const [recorded, born] = decisionBirth(at(n, id), {
    title,
    rationale: `why ${title}`,
    adr,
    initial: 'proposed',
  });
  const moved =
    state === undefined
      ? []
      : [
          decisionTransitioned(at(n + 1, id, BOB, 'claude-code'), {
            from: 'proposed',
            to: state,
            action: state === 'accepted' ? 'accept' : 'reject',
            fields: { note: 'agreed' },
          }),
        ];
  return [recorded as CatalogEvent, born as CatalogEvent, ...moved];
}

describe('the model of the page', () => {
  it('puts an observation under the decision it is about, and a linked memory under the one it is linked to, either way', () => {
    const model = pageModel([
      ...decided(1, 'd-1', 'ADR-1', 'Keep money in cents', 'accepted'),
      ...decided(5, 'd-2', 'ADR-2', 'Dates in UTC'),
      observationRecorded(at(9, 'o-1'), {
        about: 'd-1',
        topic: 'cents',
        text: 'floats lose a cent',
      }),
      memoryCaptured(at(10, 'm-1'), { content: 'the ledger rounds half to even' }),
      knowledgeLinked(at(11, 'm-1'), { target: 'd-1', rel: 'relates-to' }),
      memoryCaptured(at(12, 'm-2'), { content: 'dates cross the dateline' }),
      knowledgeLinked(at(13, 'd-2'), { target: 'm-2', rel: 'relates-to' }),
      memoryCaptured(at(14, 'm-3'), { content: 'a loose thought' }),
      observationRecorded(at(15, 'o-2'), {
        about: 'a-task',
        topic: 't',
        text: 'about no decision',
      }),
    ]);
    const [first, second] = model.decisions;
    expect(first?.notes.map((n) => n.id)).toEqual(['o-1', 'm-1']);
    expect(second?.notes.map((n) => n.id)).toEqual(['m-2']);
    expect(model.otherNotes.map((n) => n.id)).toEqual(['m-3', 'o-2']);
    expect(model.otherNotes[1]?.about).toBe('a-task');
    expect(model.counts).toEqual({
      decisions: 2,
      inForce: 1,
      notes: 5,
      timeline: expect.any(Number),
    });
  });

  it('says a note that was taken back whole, with when, by whom and why', () => {
    const model = pageModel([
      ...decided(1, 'd-1', 'ADR-1', 'Keep money in cents'),
      observationRecorded(at(5, 'o-1', ALICE, 'claude-code'), {
        about: 'd-1',
        topic: 'cents',
        text: 'floats lose a cent',
      }),
      noteRetracted(at(6, 'o-1', ALICE, 'codex'), { reason: 'it was a rounding bug' }),
    ]);
    expect(model.decisions[0]?.notes[0]).toMatchObject({
      id: 'o-1',
      text: 'floats lose a cent',
      which: 'claude-code',
      retracted: {
        at: '2026-01-01T00:00:06.000Z',
        who: ALICE,
        which: 'codex',
        reason: 'it was a rounding bug',
      },
    });
    expect(model.timeline.map((e) => e.kind)).toEqual([
      'decision-recorded',
      'decision-moved',
      'note-recorded',
      'note-retracted',
    ]);
  });

  it("applies the first writer's note and the first writer's retraction, as the projections do", () => {
    const model = pageModel([
      ...decided(1, 'd-1', 'ADR-1', 'Keep money in cents'),
      memoryCaptured(at(5, 'm-1', ALICE), { content: 'the original' }),
      // Another identity writes the same id later, and then tries to take the note back.
      memoryCaptured(at(6, 'm-1', BOB), { content: 'a rewrite by a stranger' }),
      noteRetracted(at(7, 'm-1', BOB), { reason: 'not yours to take back' }),
      knowledgeLinked(at(8, 'm-1'), { target: 'd-1', rel: 'relates-to' }),
    ]);
    const [note] = model.decisions[0]?.notes ?? [];
    expect(note).toMatchObject({ text: 'the original', who: ALICE });
    expect(note?.retracted).toBeUndefined();
    // Neither the stranger's writing nor the retraction that was not applied is an act of the timeline.
    expect(model.timeline.map((e) => e.kind)).toEqual([
      'decision-recorded',
      'decision-moved',
      'note-recorded',
    ]);
  });

  it("serves a note's later writing by the same identity, in place of the earlier, with the agent that wrote that one", () => {
    const model = pageModel([
      ...decided(1, 'd-1', 'ADR-1', 'Keep money in cents'),
      memoryCaptured(at(5, 'm-1', ALICE, 'first-agent'), { content: 'the first words' }),
      memoryCaptured(at(6, 'm-1', ALICE, 'second-agent'), { content: 'the corrected words' }),
      knowledgeLinked(at(7, 'm-1'), { target: 'd-1', rel: 'relates-to' }),
    ]);
    expect(model.decisions[0]?.notes).toHaveLength(1);
    expect(model.decisions[0]?.notes[0]).toMatchObject({
      text: 'the corrected words',
      which: 'second-agent',
      at: '2026-01-01T00:00:06.000Z',
    });
    // One note, one act on the timeline: the one that is served.
    expect(model.timeline.filter((e) => e.kind === 'note-recorded')).toHaveLength(1);
    expect(model.timeline.find((e) => e.kind === 'note-recorded')?.which).toBe('second-agent');
  });

  it('words an act with no agent as a person and one with an agent as the agent', () => {
    const model = pageModel([
      ...decided(1, 'd-1', 'ADR-1', 'Keep money in cents', 'accepted'),
      memoryCaptured(at(5, 'm-1', ALICE), { content: 'by hand' }),
      memoryCaptured(at(6, 'm-2', ALICE, 'claude-code'), { content: 'by an agent' }),
    ]);
    const [by, byAgent] = model.otherNotes;
    expect(by?.which).toBeUndefined();
    expect(actWording(by?.which)).toBe(A_PERSON);
    expect(byAgent?.which).toBe('claude-code');
    expect(actWording(byAgent?.which)).toBe('agent claude-code');
    // The accepting move came from an agent, the recording from a person.
    expect(model.decisions[0]?.acceptedBy).toEqual({ who: BOB, which: 'claude-code' });
    expect(model.decisions[0]?.recordedBy).toEqual({ who: ALICE });
  });

  it('lists the addresses a rule is at and the other relations apart, by the relations the chain names', () => {
    const model = pageModel([
      ...decided(1, 'd-1', 'ADR-1', 'Keep money in cents', 'accepted'),
      knowledgeLinked(at(5, 'd-1'), { target: 'packages/code', rel: GOVERNS_RELATION }),
      knowledgeLinked(at(6, 'd-1'), {
        target: 'packages/core/src',
        rel: ASKS_FOR_A_PERSON_RELATION,
      }),
      knowledgeLinked(at(7, 'd-1'), { target: 'docs/format.md', rel: REFUSES_A_WRITE_RELATION }),
      knowledgeLinked(at(8, 'd-1'), { target: 'd-2', rel: 'relates-to' }),
      ...decided(9, 'd-2', 'ADR-2', 'Dates in UTC'),
    ]);
    expect(model.decisions[0]?.addresses).toEqual([
      { rel: GOVERNS_RELATION, target: 'packages/code' },
      { rel: ASKS_FOR_A_PERSON_RELATION, target: 'packages/core/src' },
      { rel: REFUSES_A_WRITE_RELATION, target: 'docs/format.md' },
    ]);
    expect(model.decisions[0]?.linkedTo).toEqual([{ rel: 'relates-to', target: 'd-2' }]);
    // The same link is on the other card, seen from the other end.
    expect(model.decisions[1]?.linkedTo).toEqual([{ rel: 'relates-to', target: 'd-1' }]);
  });

  it("orders the timeline by the record's order, not by the clock", () => {
    // The second decision's events carry earlier times than the first's, and come after it in the stream.
    const early = decided(1, 'd-2', 'ADR-2', 'Written later, stamped earlier');
    const late = decided(30, 'd-1', 'ADR-1', 'Written first, stamped later');
    const model = pageModel([...late, ...early]);
    expect(model.timeline.map((e) => e.subject)).toEqual(['d-1', 'd-1', 'd-2', 'd-2']);
    expect(model.timeline.map((e) => e.at)).toEqual([
      '2026-01-01T00:00:30.000Z',
      '2026-01-01T00:00:30.000Z',
      '2026-01-01T00:00:01.000Z',
      '2026-01-01T00:00:01.000Z',
    ]);
  });

  it('lets an ADR label be an anchor only when no other decision of the page carries it', () => {
    const model = pageModel([
      ...decided(1, 'd-1', 'ADR-7', 'Minted on one machine'),
      ...decided(3, 'd-2', 'ADR-7', 'Minted on another'),
      ...decided(5, 'd-3', 'ADR-8', 'Alone'),
    ]);
    expect(model.decisions.map((d) => [d.id, d.adrIsUnique])).toEqual([
      ['d-1', false],
      ['d-2', false],
      ['d-3', true],
    ]);
  });

  it('does not model what is not a decision or a note about one', () => {
    const model = pageModel([
      ...decided(1, 'd-1', 'ADR-1', 'Keep money in cents'),
      taskCreated(at(5, 't-1'), { title: 'a task the page must not show' }),
    ]);
    expect(model.timeline.map((e) => e.subject)).toEqual(['d-1', 'd-1']);
    expect(JSON.stringify(model)).not.toContain('a task the page must not show');
  });
});
