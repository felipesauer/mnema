/**
 * The three answers about a pattern move, and the border between the two that are
 * silences.
 *
 * THE BORDER IS THE WHOLE READING. Two of the three answers are the record saying
 * nothing, and they are not the same news: a run that recorded a consultation of some
 * OTHER pattern has proved the witness was operating, so its silence about THIS one is
 * an assertion; a run that recorded no consultation at all has proved nothing, and
 * reading its silence as "moved without consulting" is the defect this module exists to
 * refuse — it would name the people who curate patterns correctly, with `mnema show`,
 * as the ones who skipped the reading.
 *
 * Nothing here is typed as an event. Every fact goes in through the bench that writes a
 * real, signed chain, so a case is over a record the product could have produced: the
 * `run` on a move is the envelope slot `skill-operations.ts` fills from the pinned run,
 * and a consultation is what the agent surface writes when it serves a body.
 */

import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthSkill,
  consultSkill,
  deprecateSkill,
  makeBench,
  moveSkill,
  startRun,
} from '../../tests/support/chain.js';
import { type PatternMove, patternMoveWitness } from './pattern-moves.js';

describe('patternMoveWitness — which of three answers the record gives about a move', () => {
  let benches: Bench[] = [];
  afterEach(() => {
    for (const b of benches) rmSync(b.root, { recursive: true, force: true });
    benches = [];
  });

  function bench(): Bench {
    const b = makeBench();
    benches.push(b);
    return b;
  }

  /** The ids of the moves in one answer, so a case can name the whole list. */
  function ids(moves: readonly PatternMove[]): string[] {
    return moves.map((m) => m.skill);
  }

  it('a run that was served the body, then moved it, is CONSULTED', () => {
    const b = bench();
    startRun(b, 'run-a', { agent: 'claude' });
    birthSkill(b, 'sk-1', 'Small PRs');
    consultSkill(b, 'sk-1', { run: 'run-a' });
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review', { run: 'run-a' });

    const witness = patternMoveWitness(b.events());
    expect(ids(witness.consulted)).toEqual(['sk-1']);
    expect(witness.movedWithoutConsulting).toEqual([]);
    expect(witness.notObservable).toEqual([]);
  });

  it('a run that was served SOME OTHER body, and moved this one, MOVED WITHOUT CONSULTING', () => {
    const b = bench();
    startRun(b, 'run-a', { agent: 'claude' });
    birthSkill(b, 'sk-read', 'The one it read');
    birthSkill(b, 'sk-moved', 'The one it moved');
    consultSkill(b, 'sk-read', { run: 'run-a' });
    moveSkill(b, 'sk-moved', 'proposed', 'reviewed', 'review', { run: 'run-a' });

    const witness = patternMoveWitness(b.events());
    expect(ids(witness.movedWithoutConsulting)).toEqual(['sk-moved']);
    expect(witness.consulted).toEqual([]);
    expect(witness.notObservable).toEqual([]);
  });

  it('a run that recorded NO consultation at all does not accuse — it is NOT OBSERVABLE', () => {
    // The border. The record holds a run and a move inside it and nothing else, which
    // is exactly what a person curating a pattern leaves behind: `mnema show` serves a
    // body and records nothing, structurally. Reading this silence as the answer above
    // is the defect; the assertion that matters is the SECOND line, not the first.
    const b = bench();
    startRun(b, 'run-quiet', { agent: 'claude' });
    birthSkill(b, 'sk-1', 'Small PRs');
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review', { run: 'run-quiet' });

    const witness = patternMoveWitness(b.events());
    expect(ids(witness.notObservable)).toEqual(['sk-1']);
    expect(witness.movedWithoutConsulting).toEqual([]);
    expect(witness.consulted).toEqual([]);
  });

  it('two runs, one silent and one that read something else, land in DIFFERENT answers', () => {
    // The two silences side by side in one stream, so the border is a comparison and
    // not two cases that could each be satisfied by the same collapsed rule.
    const b = bench();
    startRun(b, 'run-quiet', { agent: 'claude' });
    startRun(b, 'run-read', { agent: 'claude' });
    birthSkill(b, 'sk-other', 'What run-read was served');
    birthSkill(b, 'sk-quiet', 'Moved by the silent run');
    birthSkill(b, 'sk-loud', 'Moved by the reading run');
    consultSkill(b, 'sk-other', { run: 'run-read' });
    moveSkill(b, 'sk-quiet', 'proposed', 'reviewed', 'review', { run: 'run-quiet' });
    moveSkill(b, 'sk-loud', 'proposed', 'reviewed', 'review', { run: 'run-read' });

    const witness = patternMoveWitness(b.events());
    expect(ids(witness.notObservable)).toEqual(['sk-quiet']);
    expect(ids(witness.movedWithoutConsulting)).toEqual(['sk-loud']);
  });

  it('a move carrying no run at all is NOT OBSERVABLE, whatever other runs read', () => {
    const b = bench();
    startRun(b, 'run-a', { agent: 'claude' });
    birthSkill(b, 'sk-1', 'Small PRs');
    consultSkill(b, 'sk-1', { run: 'run-a' });
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review');

    const witness = patternMoveWitness(b.events());
    expect(ids(witness.notObservable)).toEqual(['sk-1']);
    expect(witness.consulted).toEqual([]);
    expect(witness.movedWithoutConsulting).toEqual([]);
  });

  it('a consultation carrying no run witnesses nothing for the run that moved next', () => {
    // It names no session, so there is no move it can be the reading FOR. Counting it
    // would credit the reading to whichever session happened to move a pattern after it.
    const b = bench();
    startRun(b, 'run-a', { agent: 'claude' });
    birthSkill(b, 'sk-1', 'Small PRs');
    consultSkill(b, 'sk-1');
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review', { run: 'run-a' });

    const witness = patternMoveWitness(b.events());
    expect(ids(witness.notObservable)).toEqual(['sk-1']);
    expect(witness.consulted).toEqual([]);
  });

  it('a run that read TWO patterns read BOTH of them, not just the last', () => {
    // THE COLLECTION ACCUMULATES PER RUN: a session's second consultation joins its first
    // rather than replacing it. That is the left-hand side of the `??` in the collect, and
    // nothing else in this suite reached it — every other case here gives a run exactly one
    // consultation, so a collection keeping only the LAST reading of each session answered
    // all of them identically. Measured: with the accumulation dropped, this case is the
    // one that reddens, and it names `sk-first` as MOVED WITHOUT CONSULTING — an accusation
    // against a session that demonstrably read it.
    const b = bench();
    startRun(b, 'run-a', { agent: 'claude' });
    birthSkill(b, 'sk-first', 'The one it read first');
    birthSkill(b, 'sk-second', 'The one it read second');
    consultSkill(b, 'sk-first', { run: 'run-a' });
    consultSkill(b, 'sk-second', { run: 'run-a' });
    moveSkill(b, 'sk-first', 'proposed', 'reviewed', 'review', { run: 'run-a' });
    moveSkill(b, 'sk-second', 'proposed', 'reviewed', 'review', { run: 'run-a' });

    const witness = patternMoveWitness(b.events());
    expect(ids(witness.consulted)).toEqual(['sk-first', 'sk-second']);
    expect(witness.movedWithoutConsulting).toEqual([]);
    expect(witness.notObservable).toEqual([]);
  });

  it('the order inside the session is not asked: a consultation AFTER the move still counts', () => {
    // The unit is the SESSION and not the instant, because the stream is a k-way merge
    // across trees whose total order is this product's tie-break and not an order two
    // writers agreed on.
    const b = bench();
    startRun(b, 'run-a', { agent: 'claude' });
    birthSkill(b, 'sk-1', 'Small PRs');
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review', { run: 'run-a' });
    consultSkill(b, 'sk-1', { run: 'run-a' });

    expect(ids(patternMoveWitness(b.events()).consulted)).toEqual(['sk-1']);
  });

  it('asks about `review` and `adopt`, and about no other move of a pattern', () => {
    // `reject` and `deprecate` take a pattern OUT of the path toward being served as
    // instruction, and a body nobody will be handed again is not this reading's business.
    const b = bench();
    startRun(b, 'run-a', { agent: 'claude' });
    for (const id of ['sk-review', 'sk-adopt', 'sk-reject', 'sk-deprecate']) {
      birthSkill(b, id, `Pattern ${id}`);
    }
    moveSkill(b, 'sk-review', 'proposed', 'reviewed', 'review', { run: 'run-a' });
    moveSkill(b, 'sk-adopt', 'reviewed', 'adopted', 'adopt', { run: 'run-a' });
    moveSkill(b, 'sk-reject', 'proposed', 'rejected', 'reject', { run: 'run-a' });
    deprecateSkill(b, 'sk-deprecate', { run: 'run-a' });

    const witness = patternMoveWitness(b.events());
    const all = [...witness.consulted, ...witness.movedWithoutConsulting, ...witness.notObservable];
    expect(ids(all).sort()).toEqual(['sk-adopt', 'sk-review']);
    // A skill's BIRTH is a `skill.transitioned` too, and its action is not one of the
    // two, so the birth pair of four patterns adds nothing to any answer.
    expect(all).toHaveLength(2);
  });

  it('carries the run and the agent the event carried, and neither key when it carried none', () => {
    // Two moves of one pattern, alike but for the envelope: the first is a person
    // acting directly with nothing pinned, the second an agent inside a session. The
    // absence of a key IS the fact, so the comparison is over the whole object.
    const b = bench();
    startRun(b, 'run-a', { agent: 'claude' });
    birthSkill(b, 'sk-1', 'Small PRs');
    moveSkill(b, 'sk-1', 'proposed', 'reviewed', 'review');
    moveSkill(b, 'sk-1', 'reviewed', 'adopted', 'adopt', { which: 'claude', run: 'run-a' });

    const [byHand, byAgent] = patternMoveWitness(b.events()).notObservable;
    // `toStrictEqual` and not `toEqual`: the latter treats a key present and undefined
    // as a key absent, so the whole property this case exists for would be invisible to
    // it. Measured — carrying `run: event.run` unconditionally left this case GREEN under
    // `toEqual` and reddens it under `toStrictEqual`.
    expect(byHand).toStrictEqual({
      skill: 'sk-1',
      action: 'review',
      at: '2026-01-01T00:00:02.000Z',
    });
    expect(byAgent).toStrictEqual({
      skill: 'sk-1',
      action: 'adopt',
      at: '2026-01-01T00:00:03.000Z',
      run: 'run-a',
      which: 'claude',
    });
  });

  it('carries the sentence saying what it cannot witness, in the answer itself', () => {
    // The qualification rides WITH the data, because a caveat kept in the prose beside
    // a table travels one copy of that table and then stops. The surface prints it under
    // the counts and the JSON carries it; here it is asserted to be there at all, and to
    // be the claim that the third answer is not an accusation.
    const witness = patternMoveWitness([]);
    expect(witness.note).toContain(
      'a move whose run recorded no consultation at all is NOT OBSERVABLE here — never a move made without consulting',
    );
    expect(witness.note).toContain(
      'a consultation is recorded when the AGENT surface serves a body',
    );
    expect(witness.note).toContain('Nothing was refused, and nothing was written to produce it.');
  });

  it('an empty record answers three empty lists and still says what it cannot witness', () => {
    const witness = patternMoveWitness([]);
    expect(witness.consulted).toEqual([]);
    expect(witness.movedWithoutConsulting).toEqual([]);
    expect(witness.notObservable).toEqual([]);
    expect(witness.note.length).toBeGreaterThan(0);
  });
});
