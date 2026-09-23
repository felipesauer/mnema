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

import type { Brief, ChannelState } from '@mnema/copilot';
import { describe, expect, it } from 'vitest';
import { briefDocument } from './brief.js';

/**
 * What governs, as the composition hands it over.
 *
 * The push is ON by default because that is the composition's own answer for a record
 * nobody switched: the state carries no attribution at all, and the cases that need it
 * OFF say so with the switch that decided it (A13 — nothing here writes a value the
 * product could not produce).
 */
function governance(over: Partial<Brief> = {}): Brief {
  return {
    decisions: [],
    skills: [],
    collisions: [],
    addressed: 0,
    asking: 0,
    // Nothing waiting by default, so every case that is not about the waiting paragraph
    // reads the skeleton's own sentence — and the cases that ARE about it say a number.
    decisionsAwaiting: 0,
    skillsAwaiting: 0,
    editPush: { channel: 'edit-rules-push', on: true },
    asksAPerson: { channel: 'edit-asks-a-person', on: true },
    ...over,
  };
}

/**
 * The push, switched off by somebody — what the composition answers when a tree holds an
 * off switch for it.
 *
 * Every field the state can carry is filled the way one write fills them, because a state
 * that is off is a state a switch put there: `by`, `at` and `travels` are never absent on
 * an off answer, and a fixture that omitted them would test a shape the reading cannot
 * return.
 */
const SWITCHED_OFF: ChannelState = {
  channel: 'edit-rules-push',
  on: false,
  by: '0198f3c1-7a2e-7b41-9c05-3d8e6f2a9f01',
  at: '2026-08-19T11:04:07.512Z',
  travels: true,
};

/**
 * The GATE, switched off by somebody — the same shape for the other channel.
 *
 * A second fixture rather than the one above with its `channel` changed, because the
 * document says a different sentence for each and a case that reused one state could pass
 * while the composition printed the push's words under the gate's number.
 */
const GATE_SWITCHED_OFF: ChannelState = {
  channel: 'edit-asks-a-person',
  on: false,
  by: '0198f3c1-7a2e-7b41-9c05-3d8e6f2a9f02',
  at: '2026-08-19T12:15:33.007Z',
  travels: true,
};

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

/**
 * The same rule, with the provenance the record asserts for it — as many sources as asked
 * for.
 *
 * A13: every target here is a value a `derived-from` link really takes. The relation holds
 * whatever the writer typed, a path or an id, and neither is validated on the way in.
 */
function derivedFrom(rule: { readonly id: string }, sources: number) {
  return {
    ...rule,
    origin: Array.from({ length: sources }, (_, at) => `docs/adr/ADR-00${at + 1}-a-source.md`),
  };
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

describe('the brief explains the silence at an edit, per channel', () => {
  /**
   * A CASE THIS FILE DID NOT HAVE, and the omission was found by the linter rather than by
   * a red: {@link SWITCHED_OFF} was written for the switch and then nothing here used it.
   * The end-to-end guard covers the push's sentence through the CLI
   * (`tests/the-switch-is-a-fact.test.ts`) and the line-layer guard covers its two record
   * values, but no case in the composition's OWN file asserted which sentence it prints. So
   * both channels get one here, and the fixtures are what they were written for.
   */
  it('says what arrives while both channels are on', () => {
    const text = printed(governance({ decisions: [decision(1)] }));
    expect(text).toContain('the rules');
    expect(text).toContain('arrive on their own');
    expect(text).toContain('the write waits until a person decides');
    // And neither switched-off sentence, because neither is switched off.
    expect(text).not.toContain('was switched off by');
  });

  it('replaces the push’s sentence when the push is off, and names who and when', () => {
    const text = printed(governance({ decisions: [decision(1)], editPush: SWITCHED_OFF }));
    expect(text).toContain('NOTHING of them arrives when a file is about');
    expect(text).toContain(`edit-rules-push was switched off by ${SWITCHED_OFF.by ?? ''}`);
    expect(text).toContain(SWITCHED_OFF.at ?? '');
    // The two sentences describe the same silence and only one is true; printing both would
    // leave a reader — a model — to pick.
    expect(text).not.toContain('arrive on their own');
    // And the GATE's sentence is untouched: the two switches are separate, and turning off
    // the text must not read as turning off what stops somebody.
    expect(text).toContain('the write waits until a person decides');
  });

  it('replaces the gate’s sentence when the gate is off, and names who and when', () => {
    const text = printed(governance({ decisions: [decision(1)], asksAPerson: GATE_SWITCHED_OFF }));
    expect(text).toContain('NONE of them waits now');
    expect(text).toContain(`edit-asks-a-person was switched off by ${GATE_SWITCHED_OFF.by ?? ''}`);
    expect(text).toContain(GATE_SWITCHED_OFF.at ?? '');
    expect(text).not.toContain('the write waits until a person decides');
    // And the push's sentence is untouched, which is the other direction of the same claim.
    expect(text).toContain('arrive on their own');
  });

  it('says both, when both are off — and does not confuse one for the other', () => {
    const text = printed(
      governance({
        decisions: [decision(1)],
        editPush: SWITCHED_OFF,
        asksAPerson: GATE_SWITCHED_OFF,
      }),
    );
    // Each names ITS OWN channel and its own anchor. A composition that read one state for
    // both would print one of these twice, and the document would attribute a switch to
    // somebody who never made it.
    expect(text).toContain(`edit-rules-push was switched off by ${SWITCHED_OFF.by ?? ''}`);
    expect(text).toContain(`edit-asks-a-person was switched off by ${GATE_SWITCHED_OFF.by ?? ''}`);
    expect(SWITCHED_OFF.by).not.toBe(GATE_SWITCHED_OFF.by);
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
    // prompt: measured at 42 lines with both lists empty, against the ~200 the market
    // publishes for a whole project memory. It was 21 before the document had to name
    // the scope it carries and say what its counts count, 25 before it said how many of
    // the rules have an ADDRESS, 30 before that paragraph grew the switch, and 34 before
    // each heading said how many are recorded here AWAITING A JUDGEMENT.
    //
    // THE LAST FOUR ARE THE WAITING PARAGRAPHS, one blank and one sentence under each
    // heading, and they are the growth that buys back an impression the document was
    // leaving. Measured on a real project: `## Decisions in force (6)` over a record of
    // 247 decisions, true in every word and read as "this project decided six things".
    //
    // THE LAST FOUR ARE THE GATE, and they are the growth in this list that is not about
    // explaining a silence. The record can hold a rule that STOPS a write, and a reader
    // who first learns that from a refusal learns it at the worst moment there is — so
    // these lines are the only warning this product gives, and they are paid once per
    // session against a channel that fires up to 3,424 times in one. They are three lines
    // and a blank because the pointer at `governing_rules` was not repeated: that read
    // answers for both relations, and the paragraph above already names it.
    //
    // AND THE LAST TWO SAY WHAT THE RECIPE DOES TO THE FILE IT IS REDIRECTED INTO, which
    // is the one growth here that is not a declaration about the RECORD. It is a fact
    // about the shell, and it is in the skeleton because the recipe is: the published
    // line was `mnema brief > AGENTS.md`, and on a real project that file held 126 lines
    // of the repository's own method. Two lines in a file read once against a method
    // file replaced in silence is not a trade this needed a measurement to settle.
    //
    // AND THE LAST TWO ARE THE GESTURE — how a decision of the reader's OWN gets into
    // this record (`HOW_A_DECISION_ENTERS`). It is the only thing here that is about the
    // reader's next move rather than about the content, and what put it in was a field
    // measurement rather than symmetry: on one project the document arrived in five
    // sessions and none of them recorded a decision, and the session after somebody
    // wrote the gesture by hand into that repository's own method file recorded one the
    // same day. The document was already arriving; what was missing was the door in.
    //
    // THE HEADLINE NUMBER ABOVE SAID 38 WHILE THIS LINE SAID 40, and that drift is worth
    // naming because it is what a bound cannot catch: the delivery that took the skeleton
    // from 38 to 40 moved the assertion and left the sentence that quotes it, so the
    // prose under-reported the file by two lines for a release. Both are 42 now, and a
    // number in this comment is read as a measurement, not as a memory.
    //
    // THE BOUND NOW SITS ON THE MEASURED VALUE, AND THAT IS THIS DELIVERY'S DEBT rather
    // than an oversight. The rule was that the bound moves with the measurement and stays
    // above it, so that the next honest sentence is a DECISION about what this file is
    // worth and not a test that goes red under somebody who was not asking the question.
    // The gesture spent the last two lines of that slack, and the bound was NOT raised
    // with it: raising it IS the decision, and a delivery that raises its own ceiling has
    // taken that decision with nobody looking. So the next line added here is red, and the
    // conversation that red forces is the one this bound has always existed for.
    expect(none).toBe(42);
    expect(none).toBeLessThanOrEqual(42);
  });

  it('grows by one line per rule however many sources the rule names', () => {
    // TWO THINGS THIS CASE DOES THAT THE SLOPE ABOVE DOES NOT, and both were measured by
    // putting the defect back.
    //
    // 1. THE SLOPE IS BLIND TO A FIELD THIS FILE'S FIXTURE DOES NOT SET. Printing a rule's
    //    provenance on a LINE OF ITS OWN — the shape `presentation/record.ts` uses, and
    //    the one the delivery that put this fact here refused — left `twoEach - oneEach`
    //    at exactly 2 and that whole case green, because no rule in it has a provenance.
    // 2. THE SLOPE COUNTS ELEMENTS OF AN ARRAY AND NOT LINES OF A DOCUMENT. With the
    //    fixture fixed, the same mutation STILL passed: a `\n` written into one element
    //    is two lines in the file and one element in the list. So what is measured here is
    //    the TEXT, which is what `mnema brief > AGENTS.md` writes and what `diff` reads.
    //    The one-line rule the fixed prose obeys is not enough on its own: `oneLine`
    //    closes a break arriving through a VALUE, and this closes one written by the
    //    module itself.
    const lines = (over: Parameters<typeof governance>[0]): number =>
      printed(governance(over)).split('\n').length;
    const bare = lines({ decisions: [decision(1)] });
    expect(lines({ decisions: [derivedFrom(decision(1), 1)] })).toBe(bare);
    expect(lines({ decisions: [derivedFrom(decision(1), 3)] })).toBe(bare);
    // And the slope itself, over rules that all carry one: still exactly one line each,
    // for decisions and patterns alike.
    const oneEach = lines({
      decisions: [derivedFrom(decision(1), 1)],
      skills: [derivedFrom(pattern(1), 2)],
    });
    const twoEach = lines({
      decisions: [derivedFrom(decision(1), 1), derivedFrom(decision(2), 3)],
      skills: [derivedFrom(pattern(1), 2), derivedFrom(pattern(2), 1)],
    });
    expect(twoEach - oneEach).toBe(2);
    // NOT VACUOUS: the provenances are on the lines, so what was just measured is the cost
    // of a document that carries them and not of one that dropped them.
    const text = printed(governance({ decisions: [derivedFrom(decision(1), 3)] }));
    expect(text.split('derived from')).toHaveLength(4);
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

  it('names the scope it carries, and says the number is of what is printed', () => {
    // The document leaves rules out — the ones that do not travel — and an omission a
    // reader cannot see is the failure this product exists not to have. So the file
    // declares its own scope before any content, and declares what its counts count,
    // in BOTH states: an empty document is exactly where a reader would otherwise
    // conclude that nothing governs anywhere.
    //
    // Where the private rules are dropped is not here (the composition hands over the
    // trees that travel), which is why this asserts the DECLARATION and the count
    // discipline; that the drop happened is asserted over the record, in
    // `commands/brief.test.ts`.
    for (const brief of [governance(), governance({ decisions: [decision(1)] })]) {
      const text = printed(brief);
      expect(text).toContain('COMMITTED to this project');
      expect(text).toContain('a clone of the repository');
      expect(text).toContain('nothing kept privately on one machine or for one person');
      expect(text).toContain('each heading counts what is printed under it');
    }
    // And it says it BEFORE the content, which is the whole point of a declaration: a
    // reader who stops at the first rule has already read the scope.
    const lines = briefDocument(governance({ decisions: [decision(1)] }));
    const declared = lines.findIndex((line) => line.includes('COMMITTED to this project'));
    const firstRule = lines.findIndex((line) => line.startsWith('- **'));
    expect(declared).toBeGreaterThanOrEqual(0);
    expect(firstRule).toBeGreaterThan(declared);
  });

  it('tallies no omission of SCOPE — no "(1 of 4)", no count of the private tree', () => {
    // The second half of the declaration, as an ABSENCE. A heading that said "(1 of 4)"
    // — or a line counting the private rules — would put a fact about a tree that does
    // not travel into a file that gets committed, and would make the document move when
    // that tree moves, which is what the byte-check exists to rule out.
    //
    // THIS CASE WAS CALLED "counts nothing it did not print" AND THAT NAME WAS TOO WIDE.
    // The document now counts what the STATE left out (the case below), and the two are
    // not the same claim: a private rule's number moves when another tree moves, on one
    // machine, and a proposal's number moves only when THIS record does. What is refused
    // here is the first, and the name says so now.
    const text = printed(governance({ decisions: [decision(1)], skills: [pattern(1)] }));
    expect(text).toContain('## Decisions in force (1)');
    expect(text).toContain('## Patterns adopted (1)');
    expect(text).not.toMatch(/\(\d+\s+of\s+\d+\)/);
    expect(text).not.toMatch(/omitted|hidden|not shown|elsewhere in the record/i);
    // The only numbers in PARENTHESES are the two counts of what is printed. The
    // sentence that used to stand here said "the only numbers in the document", and it
    // was already false when it was written — the address count and the gate count are
    // both bare numbers in the first two paragraphs.
    expect(text.match(/\(\d+\)/g)).toEqual(['(1)', '(1)']);
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

/**
 * The document under each heading, split at the second one — what a reader of that
 * section actually has in front of it.
 *
 * Every case about the waiting paragraphs reads through this rather than through the
 * whole text, and that is the one thing they could not do without it: the two paragraphs
 * differ by a NOUN, so a composition that printed the patterns' sentence under the
 * decisions' heading would leave both sentences present in the document and every
 * `toContain` over the whole of it green.
 */
function sections(brief: Brief): { decisions: string; patterns: string } {
  const lines = briefDocument(brief);
  const split = lines.findIndex((line) => line.startsWith('## Patterns adopted'));
  if (split < 0) throw new Error('fixture: the document printed no patterns heading');
  return {
    decisions: lines.slice(0, split).join('\n'),
    patterns: lines.slice(split).join('\n'),
  };
}

describe('the brief says what is recorded here and awaiting a judgement', () => {
  it('says the number under each heading, and the two numbers do not swap', () => {
    // THE DEFECT THIS PARAGRAPH EXISTS FOR, at the scale it was measured: a heading that
    // says six over a record holding 247 decisions. Every word of the heading is true and
    // the reader of this file — a model, reading this file alone — comes away believing
    // the project decided six things.
    //
    // TWO DIFFERENT VALUES, AND THEY ARE READ OFF DIFFERENT HALVES OF THE DOCUMENT. A
    // case with one number, or with both numbers equal, passes over a composition that
    // printed the same count twice and over one that swapped them.
    const both = sections(
      governance({
        decisions: [decision(1)],
        skills: [pattern(1)],
        decisionsAwaiting: 241,
        skillsAwaiting: 7,
      }),
    );
    expect(both.decisions).toContain('## Decisions in force (1)');
    expect(both.decisions).toContain(
      '241 more decisions are recorded here and awaiting a judgement, and none is below.',
    );
    expect(both.patterns).toContain('## Patterns adopted (1)');
    expect(both.patterns).toContain(
      '7 more patterns are recorded here and awaiting a judgement, and none is below.',
    );
    // Neither number reached the other section — the half that makes the assertion above
    // about placement rather than about presence.
    expect(both.patterns).not.toContain('241');
    expect(both.decisions).not.toContain('7 more');
  });

  it('moves with the count: a second record, a second number, nothing else changed', () => {
    // The guard that cannot be satisfied by a constant. A paragraph that printed a fixed
    // number — or the count of what is PRINTED, which is the number already in the
    // heading — passes any case that asserts one value; it fails the moment two records
    // that differ only in what is waiting have to print two different documents.
    const fewer = printed(governance({ decisions: [decision(1)], decisionsAwaiting: 3 }));
    const more = printed(governance({ decisions: [decision(1)], decisionsAwaiting: 241 }));
    expect(fewer).toContain('3 more decisions are recorded here');
    expect(more).toContain('241 more decisions are recorded here');
    expect(fewer).not.toContain('241');
    expect(more).not.toContain('3 more decisions');
    // And the heading did NOT move: what is in force is one decision in both, so the
    // number in the paragraph is not a second reading of the list's length.
    for (const text of [fewer, more]) expect(text).toContain('## Decisions in force (1)');
  });

  it('agrees with itself at one, in the document’s own two-constant shape', () => {
    const one = sections(
      governance({ decisions: [decision(1)], decisionsAwaiting: 1, skillsAwaiting: 1 }),
    );
    expect(one.decisions).toContain(
      '1 more decision is recorded here and awaiting a judgement, and it is not below.',
    );
    expect(one.patterns).toContain(
      '1 more pattern is recorded here and awaiting a judgement, and it is not below.',
    );
  });

  it('says ZERO in words, under both headings, and never makes the paragraph vanish', () => {
    // The skeleton rule, on the paragraph that would most plausibly have been left out
    // when it has nothing to report. A section that disappeared at zero would make the
    // first proposal read as a rewrite of the file — and a reader told that nothing is
    // waiting knows something a reader told nothing does not.
    const empty = sections(governance());
    expect(empty.decisions).toContain('No other decision recorded here is awaiting a judgement.');
    expect(empty.patterns).toContain('No other pattern recorded here is awaiting a judgement.');
    // And with rules in force, which is the other state the paragraph has to hold in.
    const inForce = sections(governance({ decisions: [decision(1)], skills: [pattern(1)] }));
    expect(inForce.decisions).toContain('No other decision recorded here is awaiting a judgement.');
    expect(inForce.patterns).toContain('No other pattern recorded here is awaiting a judgement.');
  });

  it('COUNTS and never lists — no title, no id, no state of what is waiting', () => {
    // The line between this paragraph and the work queue the verb refuses to carry. A
    // count over the record moves when the record moves, which is what keeps `mnema brief
    // | diff - AGENTS.md` meaning one thing; a list of 241 names is a queue, and a copy of
    // a queue in a hand-regenerated file is wrong between two runs.
    const text = printed(
      governance({ decisions: [decision(1)], skills: [pattern(1)], decisionsAwaiting: 241 }),
    );
    expect(text).toContain('241 more decisions are recorded here');
    // Exactly one bullet per rule IN FORCE, and no state word anywhere: the paragraph
    // adds a number and nothing that reads like an item.
    expect(text.split('\n').filter((line) => line.startsWith('- **'))).toHaveLength(2);
    expect(text).not.toMatch(/\bproposed\b|\breviewed\b|\brejected\b/i);
  });

  it('holds the document’s own rules while it counts: no clock, no path, no identity', () => {
    // The paragraph is pure over the record like everything else here — a state is a
    // fact of the chain, so two clones print the same number.
    const text = printed(
      governance({
        decisions: [decision(1), decision(2)],
        skills: [pattern(1)],
        decisionsAwaiting: 241,
        skillsAwaiting: 7,
      }),
    );
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(text).not.toMatch(/(^|[^\w-])\/(?:home|tmp|Users)\//);
    // Non-vacuity: the numbers this case is about really are in the text it scanned.
    expect(text).toContain('241 more decisions');
    expect(text).toContain('7 more patterns');
  });

  it('names the door its own reader can open, and not the person’s', () => {
    // The division the verb's help states: the file is read by an agent, so the door in
    // it is an agent's. `mnema status` answers the same question for the person who
    // typed a verb, and it is named in `mnema brief --help` rather than here.
    const text = printed(governance({ decisions: [decision(1)], decisionsAwaiting: 241 }));
    expect(text).toContain('ask `bootstrap` for what is waiting');
    expect(text).not.toContain('mnema status');
    // And the pointer is not repeated under the second heading — that read answers for
    // both, and a line here would be paid for on every prompt to say it twice.
    expect(text.split('`bootstrap`')).toHaveLength(2);
  });
});

describe('the brief declares a label that names more than one rule', () => {
  /** The same two rules, with and without the clash between their labels. */
  const rules = { decisions: [decision(1, 'Round over the total'), decision(2)] };
  const clash = { adr: 'ADR-1', ids: [decision(1).id, '0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b09'] };

  it('adds NOTHING when every label names one rule — by the list, not by a spot check', () => {
    // The ordinary case has to be byte-for-byte what it was, because the only thing that
    // detects a stale copy is `mnema brief | diff - AGENTS.md`: a line that appeared for
    // a record with no clash would report a difference in nothing, once, to every reader
    // at the same time.
    const quiet = briefDocument(governance(rules));
    const declared = briefDocument(governance({ ...rules, collisions: [clash] }));
    // Where the block goes, and how long it is — taken from the two documents rather
    // than typed here, so the removal below cannot be tuned to pass.
    const at = declared.findIndex((line) => line.includes('more than one rule'));
    const added = declared.length - quiet.length;
    expect(at).toBeGreaterThan(0);
    expect(added).toBeGreaterThan(0);
    // Take the inserted block out of the longer document and it IS the shorter one —
    // every line, in order. Nothing else moved, and nothing was reworded.
    const withoutBlock = [...declared.slice(0, at - 1), ...declared.slice(at - 1 + added)];
    expect(withoutBlock).toEqual(quiet);
  });

  it('names the label and EVERY id that carries it', () => {
    // A reader told a citation is ambiguous and not told which rules hold the label has
    // been told to distrust a handle with no way to stop. Both ids are on the line, and
    // one of them is a rule this document does not print — which is regularly the other
    // half of a clash, and the reason the ids are not filtered to what is listed.
    const text = printed(governance({ ...rules, collisions: [clash] }));
    expect(text).toContain(
      '- `ADR-1` — `0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b01`, `0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b09`',
    );
    // And it says what to do instead, in the file itself.
    expect(text).toContain('Cite these by id rather than by label');
  });

  it('declares it BEFORE the rules, and does not borrow the shape of one', () => {
    // Two properties in one case. The declaration is above the bullets, because a reader
    // who takes a label has already passed it by the time they use it; and the clash line
    // does not open with `- **`, which is what the heading counts and what a reader counts
    // against it. A warning shaped like a rule would be counted as a rule.
    const lines = briefDocument(governance({ ...rules, collisions: [clash] }));
    const declared = lines.findIndex((line) => line.includes('more than one rule'));
    const firstRule = lines.findIndex((line) => line.startsWith('- **'));
    expect(declared).toBeGreaterThanOrEqual(0);
    expect(firstRule).toBeGreaterThan(declared);
    expect(lines.filter((line) => line.startsWith('- **'))).toHaveLength(2);
    expect(printed(governance({ ...rules, collisions: [clash] }))).toContain(
      '## Decisions in force (2)',
    );
  });

  it('holds the document`s own rules while it declares: no clock, no count, no work list', () => {
    // The declaration is text in the same file, so it is held to the same three things
    // the rest of it is: nothing volatile (or the diff moves on its own), no number
    // beside the two counts of what is printed (or a reader cannot tell which number
    // counts the list), and no work.
    const text = printed(governance({ ...rules, skills: [pattern(1)], collisions: [clash] }));
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/mnid:/);
    expect(text.match(/\(\d+\)/g)).toEqual(['(2)', '(1)']);
    for (const absent of ['task', 'in_progress', 'to do', 'next up', 'work item']) {
      expect(text.toLowerCase(), `the declaration mentions ${absent}`).not.toContain(absent);
    }
  });

  it('says "more than one" and lists all THREE, when three rules hold the label', () => {
    // The wording has to survive a third holder, and so does the line: a declaration
    // that said "two rules" would be false the moment a third clone landed, and a line
    // that printed two of three ids would have a reader reconcile the wrong pair.
    const ids = [decision(1).id, decision(2).id, decision(3).id];
    const text = printed(governance({ ...rules, collisions: [{ adr: 'ADR-1', ids }] }));
    for (const id of ids) expect(text).toContain(id);
    expect(text).toContain('more than one rule');
    expect(text).not.toMatch(/\btwo rules\b/);
  });

  it('prints one line per clash, and the same bytes for the same record', () => {
    const two = governance({
      decisions: [decision(1), decision(2)],
      collisions: [
        clash,
        { adr: 'ADR-2', ids: [decision(2).id, '0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b0a'] },
      ],
    });
    const lines = briefDocument(two);
    expect(lines.filter((line) => line.startsWith('- `'))).toHaveLength(2);
    expect(printed(two)).toBe(printed(two));
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
      expect(text).toContain('mnema brief > <this file>');
      expect(text).toContain('mnema brief | diff - <this file>');
      // AND WHAT THE `>` DOES, which is the half the recipe was published without. A
      // reader who follows it over a file that already has content loses all of it,
      // and this module is one of the two places that can say so — the verb writes
      // nothing, so nothing downstream gets a chance to refuse. Asserted as the two
      // facts separately, because a wording that kept "replaces" and dropped "whole"
      // would read as a line-by-line update.
      expect(text).toContain('replaces the whole of the file it names');
      expect(text).toContain('nothing else in that file survives a regeneration');
      // And it names NO file of somebody else's: this module cannot know where the
      // document was put, and a name printed here is read as the name to use.
      expect(text).not.toContain('AGENTS.md');
      expect(text).not.toContain('CLAUDE.md');
      // WHOSE the content is: the project's own people and agents wrote it. And no longer
      // what it is NOT — the sentence ended "not instructions from mnema", the idiom that
      // marks text a model must not act on, and the clause went.
      expect(text).toContain('the people and agents working on it wrote');
      expect(text).not.toContain('not instructions');
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

/**
 * The one thing this document says about its READER'S next move.
 *
 * WHY IT HAS CASES OF ITS OWN, and it is a finding rather than a habit. The delivery that
 * added the gesture deleted it again and ran the suite: TWO tests went red, and both were
 * pinning something else — the golden of the whole transcript, and the skeleton's line
 * count. Nothing in this file named the sentence, so a reword that kept the line count
 * would have moved a byte of the document a session opens with and been reported as a
 * snapshot to accept. These cases are what makes that reword a question.
 */
describe('the brief says how a decision of the reader’s own gets in', () => {
  const gesture = (brief: Brief) =>
    briefDocument(brief).filter((line) => line.includes('record_decision'));

  it('names the door, in the state where the reader needs it most', () => {
    // The empty record is the document of the day somebody ran `mnema init`, and its
    // reader has nothing above to copy the shape from. A gesture printed only beside a
    // list of rules would reach every project except the one that has decided nothing —
    // which is the project where a first decision has the most to gain from being in.
    expect(printed(governance())).toContain(
      'A decision made here enters this record with `record_decision`, awaiting a judgement.',
    );
  });

  it('says it whatever the record holds, and on one line', () => {
    // One line is the whole budget the skeleton's bound had, and a second one is what a
    // sentence grows into when somebody explains it. Asserted over three states so the
    // case cannot pass on the empty one alone.
    for (const brief of [
      governance(),
      governance({ decisions: [decision(1)], skills: [pattern(1)] }),
      governance({ decisions: [decision(1)], decisionsAwaiting: 3 }),
    ]) {
      expect(gesture(brief)).toHaveLength(1);
    }
  });

  it('lands the decision in the words the waiting paragraph uses', () => {
    // The two say one thing or they say two. A decision is born awaiting a judgement, so
    // a reader told only that `record_decision` records one would look under the heading
    // above and not find it; and the words are the waiting paragraph's own, so a reword
    // of either that left the other behind is red here rather than a document that
    // describes its own record twice, differently.
    expect(gesture(governance())[0]).toContain('awaiting a judgement');
    expect(printed(governance({ decisionsAwaiting: 2 }))).toContain(
      'recorded here and awaiting a judgement',
    );
  });

  it('is about the RECORD and says nothing about how to do the work', () => {
    // The line `record-framing.ts` holds, and the reason "Follow them." was removed: the
    // document may name a door of this product and may not instruct a reader about
    // somebody else's code. The gesture names where a decision GOES; it does not say to
    // decide, how to decide, or what to decide about — and a sentence that grew any of
    // those would be the removed one returning under a new name.
    // Non-vacuity FIRST, and it is a defect this case had: with the sentence deleted the
    // filter returns nothing, the fallback is the empty string, and every absence below
    // holds over a document that says nothing at all. Measured — the mutation that removed
    // the gesture reddened the three cases above and left this one green.
    const [line, ...rest] = gesture(governance());
    expect(line, 'the document says nothing about how a decision gets in').toBeDefined();
    expect(rest).toEqual([]);
    for (const ordered of ['follow', 'you must', 'make sure', 'always', 'before you']) {
      expect(
        (line ?? '').toLowerCase(),
        `the gesture orders the reader to ${ordered}`,
      ).not.toContain(ordered);
    }
  });
});
