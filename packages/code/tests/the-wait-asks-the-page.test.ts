/**
 * The wait asks the PAGE the same question the case asks.
 *
 * WHAT THIS EXISTS TO CATCH, and it was red on the trunk for weeks under a wrong name. A step
 * of a driven terminal waited for a line to have gone by asking whether it was in what ARRIVED
 * since the step began, while the case then asserted it was off the replayed PAGE. Arriving is
 * cumulative: a line drawn once early in the step stays in that window for the rest of it,
 * however far the roll has since pushed it. So the two asked different questions of different
 * objects, the step ended on the first frame satisfying the weaker one, and the case read a page
 * that still held the line — 4 red in 6 runs of the seventeen files that drive a terminal, and
 * green whenever the file ran alone.
 *
 * IT WAS READ AS MACHINE CONTENTION FOR THREE DELIVERIES, and it is not: the failure carries an
 * assertion at 1.6 s, not the 30 s of a wait that never finished. Load only changes how often
 * the weaker question is satisfied early.
 *
 * AND THE OBVIOUS FIX IS WRONG, measured: widening the arrived-bytes wait to cover the oldest
 * line made it 7 red in 10, all timeouts, because the line keeps being redrawn and so keeps
 * arriving. The absence of something the screen repaints is not observable as "it has not
 * arrived since".
 *
 * WHAT THIS FILE COVERS: the instrument's own contract. That the empirical rate went from 4 in 6
 * to 0 in 6, and the whole suite from red to 3455 of 3455 three times over, is in the delivery's
 * report — a rate is not a case.
 */

import { describe, expect, it } from 'vitest';
import { aPageWithout, FRAME_IS_DRAWN } from './support/pty.js';

const PROMPT = 'mnema>';

describe('a page is not asked about before there is one', () => {
  it('refuses to be built with nothing to wait for', () => {
    // A wait with no absence ends on the first frame, which is the defect wearing the fix's
    // clothes.
    expect(() => aPageWithout(PROMPT, 80, 24)).toThrow(/nothing to wait for/);
  });

  it('is still waiting while no frame has been drawn at all', () => {
    // THE HALF THAT MATTERS MOST. A replay that finds no frame has found no page, and a page
    // that does not exist has not lost anything — answering `true` there would end the step
    // before the session had drawn, which is exactly how the sibling instrument was wrong before
    // it was given its presence half.
    const wait = aPageWithout(PROMPT, 80, 24, 'the oldest line');
    expect(wait('', 0), 'ended on an empty stream').toBe(false);
    expect(wait('nothing here resembles a frame', 0), 'ended on bytes with no frame').toBe(false);
  });

  it('is still waiting when a frame ended but no page was drawn at that width', () => {
    // THE PATH THE OTHER TWO CASES DO NOT REACH, and it took a mutation to notice: they stop at
    // the presence half and never get as far as the replay. `theSettledScreen` THROWS when no
    // frame in the stream was drawn at the asked width — it refuses to read the end of the
    // stream as a page — so the replay's refusal is a throw and not an empty answer, and the
    // step has to read it as "not yet" rather than as "gone".
    const framed = `${PROMPT} the oldest line${FRAME_IS_DRAWN}`;
    const wait = aPageWithout(PROMPT, 80, 24, 'the oldest line');
    expect(wait(framed, 0), 'ended on a stream with no page at that width').toBe(false);
  });

  it('is still waiting when a frame was drawn before the step, not by it', () => {
    // The presence half: the prompt has to be in what arrived SINCE, or the wait is approving a
    // page the keystroke has not reached yet.
    const before = `${PROMPT} an answer${FRAME_IS_DRAWN}`;
    const wait = aPageWithout(PROMPT, 80, 24, 'the oldest line');
    expect(wait(before, before.length), 'ended on a frame from before the step').toBe(false);
  });
});
