/**
 * The level, as a function: what it answers, in which ORDER it decides, and what
 * each requirement accepts.
 *
 * These are pure-input tests over the derivation, and they exist beside the
 * end-to-end ones (chain.test.ts, the-verdict-tells-the-truth.test.ts) rather than
 * instead of them: a chain on disk can only reach the combinations a chain can
 * reach, and the order of the decisions has to hold for every combination, including
 * the ones only a table can produce (a break WITH a residual is the dangerous one).
 */

import { describe, expect, it } from 'vitest';

import {
  LEVEL_REQUIREMENTS,
  type LevelRequirement,
  levelHeadline,
  meetsRequirement,
  PROVEN_LEVELS,
  type ProvenFacts,
  type ProvenLevel,
  provenLevel,
  requiredLevel,
  weakerLevel,
} from './level.js';

/** A fully proven record, as facts — each test bends one thing about it. */
const PROVEN: ProvenFacts = {
  unreadable: false,
  hasIssue: false,
  signedEvents: 6,
  uncheckpointedEvents: 0,
  witness: 'not-covered',
};

describe('the level a verification reached', () => {
  it('names every event covered by a verified signature as fully signed', () => {
    expect(provenLevel(PROVEN)).toBe('fully-signed');
  });

  it('names a residual above a real checkpoint as signed THROUGH the last checkpoint', () => {
    expect(provenLevel({ ...PROVEN, uncheckpointedEvents: 3 })).toBe(
      'signed-through-last-checkpoint',
    );
  });

  it('names a record with no verified checkpoint as hash-chain-only', () => {
    // The state the old sentence called `verified (T1/T2/T4)`: nothing signed was
    // checked, because there was nothing signed to check.
    expect(provenLevel({ ...PROVEN, signedEvents: 0, uncheckpointedEvents: 6 })).toBe(
      'hash-chain-only',
    );
  });

  it('names the empty record hash-chain-only too, not fully signed', () => {
    // Vacuously "every event is covered" is true and useless. No signature was
    // checked here either, and that is the true thing to say — it is also what a
    // tail whose events AND checkpoints were all deleted looks like.
    expect(provenLevel({ ...PROVEN, signedEvents: 0, uncheckpointedEvents: 0 })).toBe(
      'hash-chain-only',
    );
  });

  it('names any issue broken', () => {
    expect(provenLevel({ ...PROVEN, hasIssue: true })).toBe('broken');
  });

  it('names an unreadable record unreadable, below broken', () => {
    expect(provenLevel({ ...PROVEN, unreadable: true, hasIssue: true })).toBe('unreadable');
  });

  it('DECIDES A BREAK FIRST — a residual can never soften one', () => {
    // The inversion this whole change had to avoid. A truncated tail whose
    // checkpoint no longer covers it is `FAILED` today; a sentence that qualifies
    // ("no signature was checked") must not become a sentence that excuses. Every
    // shape of coverage, with a break present, is still a break.
    for (const signedEvents of [0, 1, 6]) {
      for (const uncheckpointedEvents of [0, 1, 6]) {
        const level = provenLevel({
          ...PROVEN,
          hasIssue: true,
          signedEvents,
          uncheckpointedEvents,
        });
        expect(level, `signed=${signedEvents} residual=${uncheckpointedEvents}`).toBe('broken');
      }
    }
    // And with a break AND an unreadable line, the weaker of the two wins: the
    // record could not be read, which is less than having been checked.
    expect(provenLevel({ ...PROVEN, hasIssue: true, unreadable: true })).toBe('unreadable');
  });

  it('never reports the witness level while nothing provides a witness', () => {
    // `WitnessStatus` has one member and it is not coverage, so the top rung is
    // unreachable BY THE TYPE. Said out loud so a reader does not take its presence
    // in the union for a claim that T3 works.
    expect(provenLevel(PROVEN)).not.toBe('externally-witnessed');
  });
});

describe('what a caller may require', () => {
  it('accepts, for each requirement, exactly the levels at or above what it asks', () => {
    // The whole matrix, both directions — a requirement that accepted one level too
    // many is the shape of a gate that passes a forged record.
    const accepted: Readonly<Record<LevelRequirement, readonly ProvenLevel[]>> = {
      chained: [
        'hash-chain-only',
        'signed-through-last-checkpoint',
        'fully-signed',
        'externally-witnessed',
      ],
      signed: ['fully-signed', 'externally-witnessed'],
      witnessed: ['externally-witnessed'],
    };
    for (const requirement of LEVEL_REQUIREMENTS) {
      for (const level of PROVEN_LEVELS) {
        expect(meetsRequirement(level, requirement), `${level} vs --require=${requirement}`).toBe(
          (accepted[requirement] as readonly string[]).includes(level),
        );
      }
    }
  });

  it('refuses a break and an unreadable record under EVERY requirement, the default included', () => {
    for (const requirement of LEVEL_REQUIREMENTS) {
      expect(meetsRequirement('broken', requirement)).toBe(false);
      expect(meetsRequirement('unreadable', requirement)).toBe(false);
    }
  });

  it('says which level each requirement asks for, so a surface can name what it wanted', () => {
    expect(requiredLevel('chained')).toBe('hash-chain-only');
    expect(requiredLevel('signed')).toBe('fully-signed');
    expect(requiredLevel('witnessed')).toBe('externally-witnessed');
  });
});

describe('how a level reads', () => {
  it('gives every level a sentence, and only the two failures say FAILED', () => {
    // Totality is a type property; this is the part a type cannot say — that no
    // level reaches a reader as `undefined`, and that no level short of a full proof
    // borrows the fully-proven wording.
    for (const level of PROVEN_LEVELS) {
      const headline = levelHeadline(level);
      expect(headline, level).toMatch(/^local integrity /);
      expect(headline.includes('FAILED'), level).toBe(level === 'broken' || level === 'unreadable');
    }
    // The two wordings that must not drift, because a reader learned them: the
    // record that is entirely proven, and the one with a real break.
    expect(levelHeadline('fully-signed')).toBe('local integrity verified (T1/T2/T4)');
    expect(levelHeadline('broken')).toBe('local integrity FAILED — see issues');
    // The two that used to borrow the first one.
    expect(levelHeadline('hash-chain-only')).toBe(
      'local integrity verified (T1 only) — no signature was checked',
    );
    expect(levelHeadline('signed-through-last-checkpoint')).toBe(
      'local integrity verified (T1/T2/T4) up to the last checkpoint',
    );
    // And the one that names what could not be read.
    expect(levelHeadline('unreadable')).toContain('UNREADABLE');
  });

  it('never says a layer worked where it did not run', () => {
    // The defect, stated as a property: `T2/T4` may appear only in a sentence about
    // a record whose signatures were actually checked.
    expect(levelHeadline('hash-chain-only')).not.toContain('T2/T4');
    expect(levelHeadline('unreadable')).not.toContain('T2/T4');
  });
});

describe('folding several chains into one level', () => {
  it('answers the WEAKER of two, in either order', () => {
    // One record can be several chains — a project keeps its committed tree and this
    // machine's private one — and the aggregate has to be the weak one, whichever
    // order the trees were read in.
    expect(weakerLevel('fully-signed', 'broken')).toBe('broken');
    expect(weakerLevel('broken', 'fully-signed')).toBe('broken');
    expect(weakerLevel('fully-signed', 'hash-chain-only')).toBe('hash-chain-only');
    expect(weakerLevel('signed-through-last-checkpoint', 'unreadable')).toBe('unreadable');
    expect(weakerLevel('unreadable', 'broken')).toBe('unreadable');
  });

  it('is the ORDER of the levels, over every pair — never a favourite', () => {
    // Totality where a table cannot be written: every pair of levels, both ways
    // round, answering the one that {@link PROVEN_LEVELS} puts first. A fold that
    // returned the STRONGER of two would pass a gate on the healthy half of a record,
    // which is the defect this exists against.
    for (const [aRank, a] of PROVEN_LEVELS.entries()) {
      for (const [bRank, b] of PROVEN_LEVELS.entries()) {
        const expected = aRank <= bRank ? a : b;
        expect(weakerLevel(a, b), `${a} vs ${b}`).toBe(expected);
        expect(weakerLevel(b, a), `${b} vs ${a}`).toBe(expected);
      }
    }
  });

  it('agrees with what a requirement accepts, so one comparison is enough', () => {
    // What lets an exit code read ONE level: a minimum is met by the weakest of
    // several chains exactly when it is met by every one of them. If this drifted, an
    // adapter would have to ask per tree and the two answers could disagree.
    for (const requirement of LEVEL_REQUIREMENTS) {
      for (const a of PROVEN_LEVELS) {
        for (const b of PROVEN_LEVELS) {
          expect(
            meetsRequirement(weakerLevel(a, b), requirement),
            `${a} + ${b} under ${requirement}`,
          ).toBe(meetsRequirement(a, requirement) && meetsRequirement(b, requirement));
        }
      }
    }
  });

  it('is idempotent on one level, so a single chain folds to itself', () => {
    for (const level of PROVEN_LEVELS) expect(weakerLevel(level, level)).toBe(level);
  });
});
