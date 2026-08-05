/**
 * The document `mnema brief` prints: its bytes, its skeleton, and what an empty
 * record makes it say.
 *
 * The bytes are a REQUIREMENT of this reading and not a quality of it. The only
 * thing that can tell a stale `AGENTS.md` from a live one is `mnema brief | diff -
 * AGENTS.md`, so the document has to be a pure function of the record: the same
 * governance twice is the same text twice, and anything in it that moved on its own
 * would report a difference in nothing and train its reader to ignore the check.
 *
 * ONE LINE PER RULE is asserted next to the rest of its class, in
 * `one-line-per-item.test.ts` — a title that broke its bullet in two would add a
 * rule the project never made, to the one file whose purpose is that an agent obeys
 * it.
 */

import type { Brief } from '@mnema/copilot';
import { describe, expect, it } from 'vitest';
import { briefDocument } from './brief.js';

/** What governs, as the composition hands it over. */
function governance(over: Partial<Brief> = {}): Brief {
  return { decisions: [], skills: [], ...over };
}

/** One decision in force, named the way the record names it. */
function decision(n: number, title = `A call numbered ${n}`) {
  return {
    id: `0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b${String(n).padStart(2, '0')}`,
    adr: `ADR-${n}`,
    title,
  };
}

/** One adopted pattern. */
function pattern(n: number, name = `Pattern number ${n}`) {
  return { id: `0198f3c1-7a2e-7b41-9c05-3d8e6f2a2b${String(n).padStart(2, '0')}`, name };
}

/** The document as one string, the way a stream receives it. */
function printed(brief: Brief): string {
  return briefDocument(brief).join('\n');
}

describe('the brief is the same bytes for the same record', () => {
  it('prints identically twice, over the same governance', () => {
    const same = governance({ decisions: [decision(2), decision(1)], skills: [pattern(1)] });
    expect(printed(same)).toBe(printed(same));
  });

  it('prints identically for two equal inputs that are not the same object', () => {
    // The stronger half: equal by value is enough. A document that closed over
    // anything else — an instant, a directory, a counter — would pass the assertion
    // above (the same object twice) and fail this one.
    const first = governance({ decisions: [decision(1)], skills: [pattern(1)] });
    const second = governance({ decisions: [decision(1)], skills: [pattern(1)] });
    expect(printed(first)).toBe(printed(second));
  });

  it('holds nothing volatile: no instant, no path, no identity, no run', () => {
    // What a timestamp, a working directory, an anchor or a session id would look
    // like if one ever reached this text. The ids in the fixture are the record's own
    // and they are the only long values here, so each pattern is checked against a
    // document that HAS content.
    const text = printed(
      governance({ decisions: [decision(1), decision(2)], skills: [pattern(1)] }),
    );
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(text).not.toMatch(/mnid:/);
    expect(text).not.toMatch(/(^|[^\w-])\/(?:home|tmp|Users)\//);
    // Non-vacuity: the assertions above are over a document that is not empty, and
    // the values the record DOES put in it are there.
    expect(text).toContain('A call numbered 1');
    expect(text).toContain('Pattern number 1');
  });
});

describe('the brief costs one line per rule', () => {
  it('grows by exactly one line per decision and per pattern', () => {
    // The whole size claim, as a slope. A rule is a NAME — a title, a label, an id —
    // so it is one line; the argument behind it and the text of a pattern are what a
    // second read serves. Anything that printed a rule over two lines, or a blank
    // between them, would break this and would double the cost of the file that is
    // read on every prompt.
    const none = briefDocument(governance()).length;
    const oneEach = briefDocument(
      governance({ decisions: [decision(1)], skills: [pattern(1)] }),
    ).length;
    const twoEach = briefDocument(
      governance({ decisions: [decision(1), decision(2)], skills: [pattern(1), pattern(2)] }),
    ).length;
    expect(twoEach - oneEach).toBe(2);
    // The skeleton is what the first rule costs on top of the slope: the two headings
    // change what they say when a list stops being empty, so the step from none to one
    // is not the slope and is not asserted as if it were.
    expect(oneEach - none).toBeGreaterThan(0);
    // And the fixed part is small enough to be worth having in a file read on every
    // prompt: measured at 21 lines with both lists empty, against the ~200 the market
    // publishes for a whole project memory.
    expect(none).toBeLessThanOrEqual(25);
  });

  it('says how many rules there are, and prints exactly that many', () => {
    // The count is in the heading and the bullets are under it, so a reader — or a
    // script — checks one against the other. They are the same number by
    // construction; this is what makes the construction provable.
    const text = printed(
      governance({
        decisions: [decision(1), decision(2), decision(3)],
        skills: [pattern(1), pattern(2)],
      }),
    );
    expect(text).toContain('## Decisions in force (3)');
    expect(text).toContain('## Patterns adopted (2)');
    expect(text.split('\n').filter((line) => line.startsWith('- **'))).toHaveLength(5);
  });

  it('names each decision by its ADR label, its title and its id — and no rationale', () => {
    const text = printed(
      governance({
        decisions: [decision(7, 'Keep the runbook in the record')],
        skills: [pattern(3, 'One slice per PR')],
      }),
    );
    expect(text).toContain(
      '- **ADR-7 — Keep the runbook in the record** · `0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b07`',
    );
    expect(text).toContain('- **One slice per PR** · `0198f3c1-7a2e-7b41-9c05-3d8e6f2a2b03`');
    // The doors the file points at are the AGENT's, because the reader of the file is
    // an agent: the command line's own doors are named in `mnema brief --help`. Each
    // is named beside the list it serves, so an empty list names no door — there is
    // nothing behind it to ask for.
    expect(text).toContain('`read_record`');
    expect(text).toContain('`skills`');
    expect(printed(governance())).not.toContain('`read_record`');
  });
});

describe('the brief has the same skeleton whether or not anything was decided', () => {
  it('keeps both headings when both lists are empty', () => {
    // A section that disappeared with its list would make the diff of a first
    // decision look like a rewrite of the file — and, worse, an absent section says
    // nothing at all, where an empty one can say that nobody has decided yet.
    const text = printed(governance());
    expect(text).toContain('## Decisions in force (0)');
    expect(text).toContain('## Patterns adopted (0)');
    expect(text.split('\n').filter((line) => line.startsWith('- **'))).toEqual([]);
  });

  it('says nobody has decided yet, and NOT that there are no rules', () => {
    // The two are different facts, and the reader of this file is exactly the reader
    // that cannot tell them apart: an agent told there is nothing governing here
    // proceeds as if that were settled. So the empty answer says which one it is, in
    // words, and denies the other reading out loud.
    const text = printed(governance());
    expect(text).toContain('Nothing has been decided here yet');
    expect(text).toContain('not the same as there being no rules');
    expect(text).toContain('No pattern has been adopted here yet');
    expect(text).toContain('not the same as there being no way');
  });

  it('always says what the file is and how to make it again', () => {
    // Present in both states, because a person who finds a stale copy is not
    // necessarily the person who generated it — and a generated file with no marker
    // is a file somebody edits by hand.
    for (const brief of [governance(), governance({ decisions: [decision(1)] })]) {
      const text = printed(brief);
      expect(text.startsWith('<!-- Generated by `mnema brief`')).toBe(true);
      expect(text).toContain('Do not edit by hand.');
      expect(text).toContain('mnema brief > AGENTS.md');
      expect(text).toContain('mnema brief | diff - AGENTS.md');
      // What the content IS: the project's own text, not an instruction from mnema.
      expect(text).toContain('not instructions from mnema');
    }
  });

  it('carries no work list — not a task, not a state, not a queue', () => {
    // Asserted here as well as over the composition, because the document is where a
    // list would be ADDED: the shape invites one (a heading, some bullets), and a
    // queue copied into a file that is regenerated by hand is wrong between two runs.
    const text = printed(
      governance({ decisions: [decision(1)], skills: [pattern(1)] }),
    ).toLowerCase();
    for (const absent of ['task', 'in_progress', 'to do', 'next up', 'work item']) {
      expect(text, `the document mentions ${absent}`).not.toContain(absent);
    }
  });
});
